/**
 * 游戏模式 AI 叙事服务（主进程）
 *
 * 接收玩家行动 → 构建 prompt → 调用 AIService.streamChatAPI 流式生成 →
 * 解析末尾 <tableEdit> → 应用表格命令 → 通过回调推送流式 chunk 与完成事件。
 *
 * 设计要点：
 *
 * 1. **依赖注入**：GameRepository / GameSaveRepository / GameTableRepository
 *    在本任务时尚未实现（属于 Task 4-6 的范围），因此本服务通过 setter
 *    方法接收这些仓库依赖。未注册时服务会优雅降级：
 *    - GameRepository 未注册：要求请求方在 request.modelConfig 中提供模型配置
 *    - GameSaveRepository 未注册：跳过剧情日志读取，使用空 narrativeLog
 *    - GameTableRepository 未注册：跳过表格读取与应用，但仍解析 tableEdit 供审计
 *
 * 2. **模板信息流**：游戏模板注册中心在渲染进程（含 React 组件），主进程无法
 *    直接访问。因此模板的 tableSchema 与 templateSystemPrompt 由渲染进程在
 *    调用时通过 GameNarrativeRequest 的可选字段传入（参见 game.types.ts）。
 *
 * 3. **取消机制**：
 *    - 调用方通过 abortSignal 取消单次生成
 *    - abortAll() 取消所有活跃生成（用于应用退出 / 切换存档场景）
 *
 * 4. **流式 chunk 推送**：AIService 的 onChunk 回调为 (chunk: string) => void，
 *    本服务在此基础上维护 chunk 索引，转发给 NarrativeCallbacks.onChunk(chunk, index)。
 *
 * 5. **tableEdit 应用决策**：
 *    - 仅在 organizeMode === 'async' 时应用（sync 模式由 TableOrganizeService 处理）
 *    - 仅在 GameTableRepository 已注册时应用
 *    - 解析出的命令仍通过 onComplete 返回（供审计），即使未实际应用
 */

import { aiService } from '../AIService';
import { createLogger } from '../logger';
import {
  type GameNarrativeRequest,
  type GameNarrativeComplete,
  type GameTableEditCommand,
  type GameTableEditParseResult,
  type GameMeta,
  type GameLocalConfig,
  type GameSaveData,
  type GameTableData,
  type GameTableSchema,
  type GameNarrativeMessage,
  GameTableEditCommandType
} from '../../../shared/types/game.types';
import { GAME_NARRATIVE_TIMEOUT } from '../../../shared/constants/game.constants';
import { gamePromptBuilder } from './GamePromptBuilder';
import { gameTableEditParser } from './GameTableEditParser';

// ==================== 类型定义 ====================

/**
 * 叙事生成回调
 *
 * - onChunk: 流式 chunk 推送（chunk 为文本片段，index 为序号从 0 开始）
 * - onComplete: 流式生成完成（含完整文本与表格变更摘要）
 * - onError: 错误回调（error 为人类可读消息，code 为错误代码）
 *
 * 调用方通常将这些回调包装为 IPC 事件发送给渲染进程：
 * - onChunk → `game:narrative:chunk` 事件
 * - onComplete → `game:narrative:complete` 事件
 * - onError → `game:narrative:error` 事件
 */
export interface NarrativeCallbacks {
  onChunk: (chunk: string, index: number) => void;
  onComplete: (result: GameNarrativeComplete) => void;
  onError: (error: string, code: string) => void;
}

/**
 * GameRepository 接口契约
 *
 * 与 `src/main/services/game/GameRepository.ts` 的实际签名对齐（同步方法）。
 * 仅声明本服务实际调用的方法，避免过度耦合。
 */
export interface GameRepositoryLike {
  getGameMeta(gameId: string): GameMeta | null;
  getGameConfig(gameId: string): GameLocalConfig;
}

/**
 * GameSaveRepository 接口契约
 *
 * 与 `src/main/services/game/GameSaveRepository.ts` 的实际签名对齐（同步方法）。
 * 注意：现有仓库不直接提供 appendNarrativeMessage 方法，本服务通过
 * loadSave + updateSave({ narrativeLog }) 组合实现剧情消息追加。
 */
export interface GameSaveRepositoryLike {
  loadSave(saveId: string): GameSaveData | null;
  updateSave(
    saveId: string,
    updates: {
      narrativeLog?: GameNarrativeMessage[];
      stateSnapshot?: Record<string, unknown>;
      currentTurn?: number | null;
      currentNodeId?: string | null;
      nodeTitle?: string | null;
      turnCount?: number;
    }
  ): boolean;
}

/**
 * GameTableRepository 接口契约
 *
 * 与 `src/main/services/game/GameTableRepository.ts` 的实际签名对齐（同步方法）。
 *
 * 注意：applyTableEdits 返回 `{ success, changes }` 结构，其中 changes 包含
 * commandsExecuted / affectedSheets / errors 三个字段（与
 * GameNarrativeComplete.tableChanges 对齐）。
 */
export interface GameTableRepositoryLike {
  getTableData(saveId: string): GameTableData | null;
  applyTableEdits(
    saveId: string,
    commands: GameTableEditCommand[]
  ): {
    success: boolean;
    changes: {
      commandsExecuted: number;
      affectedSheets: string[];
      errors: string[];
    };
  };
}

/**
 * 表格变更摘要（无仓库可用时的占位返回）
 */
interface TableChangesSummary {
  commandsExecuted: number;
  affectedSheets: string[];
  errors: string[];
}

// ==================== 日志 ====================

const logger = createLogger('game');

// ==================== 服务实现 ====================

export class GameNarrativeService {
  // 依赖注入（可选，未注入时优雅降级）
  private gameRepository: GameRepositoryLike | null = null;
  private gameSaveRepository: GameSaveRepositoryLike | null = null;
  private gameTableRepository: GameTableRepositoryLike | null = null;

  /**
   * 活跃的 AbortController 集合
   *
   * 用于 abortAll() 取消所有正在进行的生成。
   * generateNarrative 完成或出错时从集合中移除对应 controller。
   */
  private readonly activeControllers: Set<AbortController> = new Set();

  // ==================== 依赖注入 ====================

  /**
   * 注入 GameRepository（主进程启动时调用）
   */
  setGameRepository(repo: GameRepositoryLike | null): void {
    this.gameRepository = repo;
  }

  /**
   * 注入 GameSaveRepository（主进程启动时调用）
   */
  setGameSaveRepository(repo: GameSaveRepositoryLike | null): void {
    this.gameSaveRepository = repo;
  }

  /**
   * 注入 GameTableRepository（主进程启动时调用）
   */
  setGameTableRepository(repo: GameTableRepositoryLike | null): void {
    this.gameTableRepository = repo;
  }

  // ==================== 主入口：生成剧情 ====================

  /**
   * 生成剧情
   *
   * 流程：
   * 1. 读取 gameMeta 与 config（GameRepository 可用时）
   * 2. 读取 saveData（GameSaveRepository 可用时）
   * 3. 读取 tableData（GameTableRepository 可用时）
   * 4. 用 GamePromptBuilder 构建 system + user prompt
   * 5. 调用 AIService.streamChatAPI，通过 callbacks.onChunk 推送流式片段
   * 6. 流式结束后，用 GameTableEditParser 解析完整回复末尾的 tableEdit
   * 7. （async 模式且仓库可用时）调用 GameTableRepository.applyTableEdits
   * 8. 调用 callbacks.onComplete 返回完整文本与表格变更摘要
   *
   * @param request 叙事请求（含 templateSystemPrompt 与 tableSchema）
   * @param callbacks 回调（onChunk / onComplete / onError）
   * @param abortSignal 取消信号（可选）
   */
  async generateNarrative(
    request: GameNarrativeRequest,
    callbacks: NarrativeCallbacks,
    abortSignal?: AbortSignal
  ): Promise<void> {
    const startTime = Date.now();
    const { saveId, gameId } = request;

    // 1. 创建内部 AbortController，并桥接外部 abortSignal
    const controller = new AbortController();
    this.activeControllers.add(controller);

    const onExternalAbort = () => controller.abort();
    if (abortSignal) {
      if (abortSignal.aborted) {
        // 外部信号已取消，直接返回
        this.activeControllers.delete(controller);
        callbacks.onError('叙事生成已被取消', 'aborted');
        return;
      }
      abortSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      // 2. 准备 prompt 所需的上下文数据（仓库同步调用，无需 await）
      const context = this.gatherContext(request);

      // 3. 构建 prompt
      const systemPrompt = gamePromptBuilder.buildSystemPrompt(
        context.gameMeta,
        context.tableSchema,
        context.config,
        request.templateSystemPrompt
      );

      const userPrompt = gamePromptBuilder.buildNarrativePrompt(
        request.userAction,
        context.narrativeLog,
        context.tableData,
        context.tableSchema,
        context.currentTurn ?? undefined
      );

      // 4. 准备 AI 调用参数（resolveModelConfig 内部读取 AIService 配置，仍需 await）
      const { model, temperature, maxTokens } = await this.resolveModelConfig(request, context.config);

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userPrompt }
      ];

      // 5. 流式调用 AIService
      let chunkIndex = 0;
      const fullTextBuffer: string[] = [];

      const result = await aiService.streamChatAPI(
        messages,
        {
          model,
          temperature,
          maxTokens,
          maxRetries: 2,
          timeoutMs: GAME_NARRATIVE_TIMEOUT,
          abortSignal: controller.signal
        },
        (chunk: string) => {
          if (!chunk) return;
          fullTextBuffer.push(chunk);
          callbacks.onChunk(chunk, chunkIndex);
          chunkIndex++;
        }
      );

      // 6. 流式结束，处理完整回复
      const fullText = result.content || fullTextBuffer.join('');
      const generationTime = result.generationTime ?? (Date.now() - startTime);

      // 7. 解析 tableEdit
      const parseResult = gameTableEditParser.parse(fullText);
      const narrativeText = gameTableEditParser.stripTableEditTags(fullText);

      // 8. 应用 tableEdit（仅 async 模式 + 仓库可用 + 有命令时；同步调用）
      const tableChanges = this.applyTableEditsIfNeeded(
        saveId,
        context.config,
        parseResult
      );

      // 9. 持久化剧情消息（仓库可用时；同步调用）
      this.persistNarrativeMessage(
        saveId,
        narrativeText,
        request.userAction,
        context.currentTurn ?? null
      );

      // 10. 回调 onComplete
      const complete: GameNarrativeComplete = {
        saveId,
        fullText: narrativeText,
        tableChanges,
        tableEdits: parseResult.commands.map(cmd => cmd.raw),
        generationTime,
        model: result.model || model
      };

      callbacks.onComplete(complete);
    } catch (error) {
      // 错误分类
      const errMsg = error instanceof Error ? error.message : String(error);
      const lowered = errMsg.toLowerCase();

      let code = 'unknown';
      if (lowered.includes('abort') || lowered.includes('取消') || lowered.includes('中止')) {
        code = 'aborted';
      } else if (lowered.includes('timeout') || lowered.includes('超时')) {
        code = 'timeout';
      } else if (lowered.includes('network') || lowered.includes('fetch') ||
                 lowered.includes('connection') || lowered.includes('econnreset') ||
                 lowered.includes('econnrefused')) {
        code = 'network';
      } else if (lowered.includes('未配置') || lowered.includes('not configured')) {
        code = 'config_missing';
      } else if (lowered.includes('429') || lowered.includes('rate limit')) {
        code = 'rate_limit';
      } else if (lowered.includes('500') || lowered.includes('502') ||
                 lowered.includes('503') || lowered.includes('service')) {
        code = 'service';
      }

      logger.error('GameNarrativeService.generateNarrative 失败', errMsg, {
        saveId,
        gameId,
        code
      });

      callbacks.onError(errMsg, code);
    } finally {
      // 清理 controller
      this.activeControllers.delete(controller);
      if (abortSignal) {
        abortSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  /**
   * 取消所有活跃的叙事生成
   *
   * 用于应用退出、用户切换存档、用户主动停止等场景。
   * 调用后所有未完成的 generateNarrative 调用都会触发 onError(code='aborted')。
   */
  abortAll(): void {
    if (this.activeControllers.size === 0) return;

    logger.info('GameNarrativeService.abortAll: 取消所有活跃叙事生成', undefined, {
      count: this.activeControllers.size
    });

    this.activeControllers.forEach(controller => controller.abort());
    this.activeControllers.clear();
  }

  // ==================== 上下文收集 ====================

  /**
   * 收集 prompt 所需的上下文数据
   *
   * 从已注入的仓库中读取 gameMeta / config / saveData / tableData，
   * 并合并 request 中的覆盖字段（templateSystemPrompt / tableSchema）。
   */
  private gatherContext(request: GameNarrativeRequest): {
    gameMeta: GameMeta;
    config: GameLocalConfig;
    tableSchema: GameTableSchema | undefined;
    tableData: GameTableData | null;
    narrativeLog: GameNarrativeMessage[];
    currentTurn: number | null;
  } {
    // 1. 读取 gameMeta
    let gameMeta: GameMeta | null = null;
    if (this.gameRepository) {
      try {
        gameMeta = this.gameRepository.getGameMeta(request.gameId);
      } catch (e) {
        logger.warn('读取 GameMeta 失败，使用占位元数据', this.errorToString(e));
      }
    }
    if (!gameMeta) {
      gameMeta = this.fallbackGameMeta(request);
    }

    // 2. 读取 config（getGameConfig 在仓库中始终返回有效值，不会为 null）
    let config: GameLocalConfig | null = null;
    if (this.gameRepository) {
      try {
        config = this.gameRepository.getGameConfig(request.gameId);
      } catch (e) {
        logger.warn('读取 GameLocalConfig 失败，使用默认配置', this.errorToString(e));
      }
    }
    if (!config) {
      config = this.fallbackConfig(request);
    }

    // 3. 读取 saveData（含 narrativeLog 与 currentTurn）
    let narrativeLog: GameNarrativeMessage[] = [];
    let currentTurn: number | null = null;
    if (this.gameSaveRepository) {
      try {
        const saveData = this.gameSaveRepository.loadSave(request.saveId);
        if (saveData) {
          narrativeLog = saveData.narrativeLog || [];
          currentTurn = saveData.meta?.currentTurn ?? null;
        }
      } catch (e) {
        logger.warn('读取 SaveData 失败，使用空剧情日志', this.errorToString(e));
      }
    }

    // 4. 读取 tableSchema：优先 request，次选 saveData 中已存储的 schema
    let tableSchema: GameTableSchema | undefined = request.tableSchema;
    if (!tableSchema) {
      // saveData 中无 schema（schema 仅由模板声明，不持久化在 save 中）
      // 留空，prompt builder 会输出"未配置 schema"提示
    }

    // 5. 读取 tableData
    let tableData: GameTableData | null = null;
    if (this.gameTableRepository) {
      try {
        tableData = this.gameTableRepository.getTableData(request.saveId);
      } catch (e) {
        logger.warn('读取 TableData 失败', this.errorToString(e));
      }
    }

    return {
      gameMeta,
      config,
      tableSchema,
      tableData,
      narrativeLog,
      currentTurn
    };
  }

  // ==================== 表格命令应用 ====================

  /**
   * 根据配置决定是否应用 tableEdit 命令
   *
   * 应用条件：organizeMode === 'async' && GameTableRepository 已注入 && commands 非空
   * 否则返回仅含解析结果摘要的占位（仍包含 errors 字段供审计）。
   */
  private applyTableEditsIfNeeded(
    saveId: string,
    config: GameLocalConfig,
    parseResult: GameTableEditParseResult
  ): TableChangesSummary {
    // 非命令时直接返回空摘要
    if (parseResult.commands.length === 0 && parseResult.errors.length === 0) {
      return { commandsExecuted: 0, affectedSheets: [], errors: [] };
    }

    // sync 模式：不应用，但保留解析结果供审计
    if (config.organizeMode !== 'async') {
      return {
        commandsExecuted: 0,
        affectedSheets: [],
        errors: parseResult.errors
      };
    }

    // async 模式但仓库未注入：返回解析摘要
    if (!this.gameTableRepository) {
      logger.warn('GameTableRepository 未注入，跳过 tableEdit 应用', undefined, {
        commandsCount: parseResult.commands.length
      });
      return {
        commandsExecuted: 0,
        affectedSheets: this.extractAffectedSheets(parseResult.commands),
        errors: parseResult.errors
      };
    }

    // 实际应用（同步调用，但 GameTableRepository 内部已处理错误，不会抛出）
    try {
      const result = this.gameTableRepository.applyTableEdits(saveId, parseResult.commands);
      // 合并解析阶段与应用阶段的错误
      return {
        commandsExecuted: result.changes.commandsExecuted,
        affectedSheets: result.changes.affectedSheets,
        errors: [...parseResult.errors, ...result.changes.errors]
      };
    } catch (e) {
      const errMsg = this.errorToString(e);
      logger.error('applyTableEdits 失败', errMsg, { saveId });
      return {
        commandsExecuted: 0,
        affectedSheets: this.extractAffectedSheets(parseResult.commands),
        errors: [...parseResult.errors, `应用表格命令失败: ${errMsg}`]
      };
    }
  }

  /**
   * 从命令列表提取受影响的 sheet 索引（去重）
   *
   * 注意：此处返回的是 sheetIndex 数字列表（1-based）。
   * GameTableRepository.applyTableEdits 应返回 sheetName 列表（更友好）。
   */
  private extractAffectedSheets(commands: GameTableEditCommand[]): string[] {
    const set = new Set<number>();
    commands.forEach(cmd => set.add(cmd.sheetIndex));
    return Array.from(set).sort((a, b) => a - b).map(String);
  }

  // ==================== 剧情消息持久化 ====================

  /**
   * 持久化玩家行动与 AI 回复到剧情日志
   *
   * 实现方式：loadSave 读取当前 narrativeLog → 追加两条新消息 → updateSave 写回。
   * （现有 GameSaveRepository 不直接提供 appendNarrativeMessage 方法）
   *
   * 失败不中断主流程（已生成的叙事文本仍会通过 onComplete 返回）。
   */
  private persistNarrativeMessage(
    saveId: string,
    narrativeText: string,
    userAction: string,
    currentTurn: number | null
  ): void {
    if (!this.gameSaveRepository) return;

    const timestamp = Date.now();
    const turn = currentTurn ?? undefined;

    try {
      // 1. 读取当前存档
      const saveData = this.gameSaveRepository.loadSave(saveId);
      if (!saveData) {
        logger.warn('持久化剧情消息失败：存档不存在', undefined, { saveId });
        return;
      }

      // 2. 追加玩家行动与 AI 叙事两条消息
      const newLog: GameNarrativeMessage[] = [
        ...(saveData.narrativeLog || []),
        {
          id: `${timestamp}_user`,
          role: 'user',
          content: userAction,
          timestamp,
          turn
        },
        {
          id: `${timestamp}_assistant`,
          role: 'assistant',
          content: narrativeText,
          timestamp: timestamp + 1,
          turn
        }
      ];

      // 3. 写回存档（仅更新 narrativeLog 字段，其他字段保持不变）
      const ok = this.gameSaveRepository.updateSave(saveId, { narrativeLog: newLog });
      if (!ok) {
        logger.warn('持久化剧情消息失败：updateSave 返回 false', undefined, { saveId });
      }
    } catch (e) {
      logger.warn('持久化剧情消息失败（不中断主流程）', this.errorToString(e), { saveId });
    }
  }

  // ==================== 模型配置解析 ====================

  /**
   * 解析模型配置
   *
   * 优先级：request.modelConfig > config（GameLocalConfig） > AIService 引擎配置
   */
  private async resolveModelConfig(
    request: GameNarrativeRequest,
    config: GameLocalConfig
  ): Promise<{ model: string; temperature: number; maxTokens: number }> {
    if (request.modelConfig) {
      return request.modelConfig;
    }

    // 从 AIService 读取活跃引擎配置
    const aiConfig = await aiService.getConfig();
    const engineConfig = await aiService.getEngineConfig();

    return {
      model: aiConfig.model,
      temperature: config.temperature ?? engineConfig.temperature,
      maxTokens: config.maxTokens ?? engineConfig.maxTokens
    };
  }

  /**
   * 将 catch 块中的 unknown 错误转为字符串
   *
   * TypeScript 4.4+ 默认 catch 变量为 unknown 类型，需安全转换后才能
   * 传给 logger.warn/error 的 details 参数（string 类型）。
   */
  private errorToString(e: unknown): string {
    if (e instanceof Error) {
      return e.message + (e.stack ? `\n${e.stack}` : '');
    }
    if (typeof e === 'string') return e;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }

  // ==================== 占位数据（仓库未注入时的回退） ====================

  private fallbackGameMeta(request: GameNarrativeRequest): GameMeta {
    return {
      id: request.gameId,
      type: request.gameType,
      title: '未命名游戏',
      subtitle: '',
      description: '',
      gameplay: '',
      developer: '',
      version: '0.0.0',
      status: 'in_development' as any,
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  private fallbackConfig(request: GameNarrativeRequest): GameLocalConfig {
    return {
      activeEngineId: null,
      temperature: 0.7,
      maxTokens: 32768,
      organizeMode: request.organizeMode ?? 'async',
      ansiTheme: 'default',
      autoSave: true
    };
  }
}

// ==================== 单例导出 ====================

export const gameNarrativeService = new GameNarrativeService();

// 重新导出 GameTableEditCommandType 以方便 IPC handler 同文件使用
export { GameTableEditCommandType };
