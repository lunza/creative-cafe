/**
 * 经营游戏叙事服务
 *
 * 包装 `GameNarrativeService`，在通用叙事生成流程之上添加经营游戏专属逻辑：
 *
 * 1. **userAction 路由**：根据 userAction 前缀（build: / recruit: / end_turn / 自由文本）
 *    分发到不同处理流程，应用资源变更到 tableData 后再调用通用叙事生成
 * 2. **endTurn 流程**：结算产出 → 触发随机事件 → 回合数 +1 → 触发叙事生成 → 自动存档
 * 3. **prompt 注入**：通过 `request.templateSystemPrompt` 注入 ManagementPromptBuilder
 *    生成的经营专属规则片段
 *
 * 设计原则：
 *
 * - **不修改通用 GameNarrativeService**：本类作为包装层，通过依赖注入持有
 *   `GameNarrativeService` 实例，复用其 generateNarrative / abortAll 等方法
 * - **资源变更通过 applyTableEdits 应用**：双重保险——前端乐观更新 + 后端校验扣减
 * - **endTurn 的状态变更在叙事生成前完成**：让 AI 看到结算后的最新状态
 * - **随机事件使用可注入的随机源**：默认 Math.random，便于测试 mock
 * - **失败不阻塞叙事生成**：资源扣减失败时记日志但仍调用叙事生成，
 *   让 AI 有机会在叙事中提示玩家资源不足
 */

import type {
  GameNarrativeRequest,
  GameMeta,
  GameTableSchema,
  GameTableData,
  GameTableEditCommand
} from '../../../../../shared/types/game.types';
import { GameTableEditCommandType } from '../../../../../shared/types/game.types';
import type {
  GameNarrativeService,
  NarrativeCallbacks
} from '../../GameNarrativeService';
import type {
  GameTableRepositoryLike,
  GameSaveRepositoryLike
} from '../../GameNarrativeService';
import { ManagementPromptBuilder } from './ManagementPromptBuilder';
import { createLogger } from '../../../logger';

// ==================== 类型定义 ====================

/**
 * 随机源接口
 *
 * 默认使用 Math.random；测试中可注入 mock 随机源以确定性地触发特定事件
 */
export interface RandomSource {
  /** 返回 [0, 1) 区间的随机数 */
  next(): number;
}

// ==================== 配置常量 ====================

/**
 * 设施建造资源成本表
 *
 * 简化版成本配置：仅含常见设施。未列出的 facility_id 视为无需资源扣减，
 * 直接触发叙事生成（让 AI 描述建造过程）。
 *
 * 资源键：gold / food / wood / population（与 resources sheet 的唯一id 字段对齐）
 */
const FACILITY_COSTS: Record<string, Partial<Record<ResourceKey, number>>> = {
  farm: { gold: 50, wood: 10 },
  market: { gold: 100, wood: 20 },
  sawmill: { gold: 50 },
  house: { gold: 30, wood: 10 }
};

/**
 * 角色招募资源成本表
 *
 * 招募会扣减金币并增加人口（population +1）
 */
const RECRUIT_COSTS: Record<string, Partial<Record<ResourceKey, number>>> = {
  farmer: { gold: 20 },
  merchant: { gold: 50 },
  lumberjack: { gold: 30 }
};

/**
 * 资源键类型
 *
 * 与 resources sheet 中的唯一id 字段（列 2）保持一致
 */
type ResourceKey = 'gold' | 'food' | 'wood' | 'population';

/**
 * resources sheet 中资源名到资源键的映射
 *
 * 兼容中英文资源名，便于在不同 schema 下工作
 */
const RESOURCE_NAME_TO_KEY: Record<string, ResourceKey> = {
  // 中文
  '金币': 'gold',
  '食物': 'food',
  '木材': 'wood',
  '人口': 'population',
  // 英文（小写匹配）
  'gold': 'gold',
  'food': 'food',
  'wood': 'wood',
  'population': 'population'
};

/**
 * 随机事件配置
 *
 * 概率配置（spec Task 15.3）：
 * - 30% 丰收：食物 +10
 * - 20% 灾害：食物 -20
 * - 10% 旅人来访：人口 +1
 * - 40% 无事件
 *
 * 累积概率按数组顺序判定：next() < 0.3 → 丰收；< 0.5 → 灾害；< 0.6 → 旅人；else 无事件
 */
interface RandomEventConfig {
  /** 事件名称（用于 events sheet 记录与 AI 叙事提示） */
  name: string;
  /** 事件描述（注入到 AI 叙事中的提示） */
  description: string;
  /** 事件效果（资源变更） */
  effect: Partial<Record<ResourceKey, number>>;
  /** 累积概率上界（next() < threshold 时触发） */
  threshold: number;
}

const RANDOM_EVENTS: RandomEventConfig[] = [
  {
    name: 'harvest',
    description: '本回合丰收，作物产量大增',
    effect: { food: 10 },
    threshold: 0.3
  },
  {
    name: 'disaster',
    description: '本回合发生灾害，作物受损',
    effect: { food: -20 },
    threshold: 0.5
  },
  {
    name: 'traveler',
    description: '一位旅人来访并加入了小镇',
    effect: { population: 1 },
    threshold: 0.6
  }
  // 未匹配任何 threshold 时为"无事件"（40%）
];

// ==================== 日志 ====================

const logger = createLogger('game');

// ==================== 服务实现 ====================

/**
 * 经营游戏叙事服务
 *
 * 通过依赖注入持有：
 * - `narrativeService`: 通用 GameNarrativeService 实例（必填）
 * - `promptBuilder`: ManagementPromptBuilder 实例（必填）
 * - `tableRepository`: GameTableRepository 实例（必填，用于读取/应用 tableData）
 * - `saveRepository`: GameSaveRepository 实例（必填，用于更新 save.json 的 currentTurn）
 *
 * 单例导出（managementNarrativeService）在文件末尾，需要主进程启动时
 * 通过构造函数注入实际依赖。在测试中可创建新实例注入 mock 依赖。
 */
export class ManagementNarrativeService {
  constructor(
    private readonly narrativeService: GameNarrativeService,
    private readonly promptBuilder: ManagementPromptBuilder,
    private readonly tableRepository: GameTableRepositoryLike,
    private readonly saveRepository: GameSaveRepositoryLike,
    /** 可注入的随机源，默认使用 Math.random */
    private readonly randomSource: RandomSource = { next: () => Math.random() }
  ) {}

  // ==================== 主入口：generateNarrative ====================

  /**
   * 生成剧情
   *
   * 根据 userAction 前缀分发：
   * - `build:<facility_id>` → 应用资源扣减 → 调用通用 generateNarrative
   * - `recruit:<character_id>` → 应用资源扣减 + 人口增加 → 调用通用 generateNarrative
   * - `end_turn` → 委托给 endTurn 流程
   * - 自由文本 → 直接调用通用 generateNarrative
   *
   * 资源变更通过 GameTableRepository.applyTableEdits 应用（在叙事生成前）。
   * 应用失败时记日志但不阻塞叙事生成（让 AI 有机会在叙事中提示）。
   *
   * @param request 叙事请求（templateSystemPrompt / tableSchema 会被本方法覆盖为经营模板版本）
   * @param callbacks 回调（onChunk / onComplete / onError）
   * @param abortSignal 取消信号（可选）
   */
  async generateNarrative(
    request: GameNarrativeRequest,
    callbacks: NarrativeCallbacks,
    abortSignal?: AbortSignal
  ): Promise<void> {
    const { saveId, userAction } = request;

    // 1. 注入经营模板的 templateSystemPrompt（覆盖请求中可能存在的值）
    const enrichedRequest = await this.enrichRequestWithManagementPrompt(request);

    // 2. 根据 userAction 前缀分发
    if (userAction === 'end_turn') {
      // end_turn 走独立流程（含产出结算 / 随机事件 / 回合 +1 / 自动存档）
      await this.endTurn(saveId, callbacks, abortSignal);
      return;
    }

    if (userAction.startsWith('build:')) {
      const facilityId = userAction.substring('build:'.length).trim();
      this.applyFacilityBuild(saveId, facilityId);
    } else if (userAction.startsWith('recruit:')) {
      const characterId = userAction.substring('recruit:'.length).trim();
      this.applyCharacterRecruit(saveId, characterId);
    }
    // 自由文本：不应用资源变更，直接调用通用叙事生成

    // 3. 调用通用叙事生成（已注入经营 templateSystemPrompt）
    await this.narrativeService.generateNarrative(
      enrichedRequest,
      callbacks,
      abortSignal
    );
  }

  /**
   * 结束回合流程
   *
   * 步骤：
   * 1. 读取当前 tableData
   * 2. 结算产出：遍历 facilities sheet，按 production 字段累加产出；按 resources sheet 的 change_per_turn 字段应用变化
   * 3. 触发随机事件：按概率配置触发其一（30% 丰收 / 20% 灾害 / 10% 旅人 / 40% 无事件）
   * 4. 回合数 +1：更新 stats sheet 中的 turn 字段
   * 5. 自动存档：通过 GameSaveRepository.updateSave 更新 save.json 的 currentTurn
   * 6. 触发 AI 叙事生成：调用 narrativeService.generateNarrative，userAction='end_turn'
   *
   * @param saveId 存档 ID
   * @param callbacks 回调（onChunk / onComplete / onError）
   * @param abortSignal 取消信号（可选）
   */
  async endTurn(
    saveId: string,
    callbacks: NarrativeCallbacks,
    abortSignal?: AbortSignal
  ): Promise<void> {
    // 1. 读取当前 tableData
    const tableData = this.tableRepository.getTableData(saveId);
    if (!tableData) {
      callbacks.onError(`存档 ${saveId} 的表格数据不存在，无法结束回合`, 'table_not_found');
      return;
    }

    // 2. 收集要应用的 tableEdit 命令
    const commands: GameTableEditCommand[] = [];

    // 2a. 触发随机事件（先判定，便于将事件效果合并到产出结算中，避免重复 updateRow）
    const event = this.rollRandomEvent();
    const eventDeltas = event?.effect ?? {};

    // 2b. 结算产出（facilities production + resources change_per_turn + event effect 合并）
    //     合并到单条 updateRow 命令，避免对同一行产生多条覆盖性更新
    const productionCommands = this.settleProduction(tableData, eventDeltas);
    commands.push(...productionCommands);

    // 2c. 在 events sheet 记录事件（仅 insertRow，不重复应用资源效果）
    if (event) {
      const eventInsertCommands = this.buildEventInsertCommands(tableData, event);
      commands.push(...eventInsertCommands);
    }

    // 3. 回合数 +1（更新 stats sheet 的 turn 行）
    const turnCommand = this.incrementTurnCommand(tableData);
    if (turnCommand) {
      commands.push(turnCommand);
    }

    // 5. 应用所有 tableEdit 命令
    if (commands.length > 0) {
      try {
        const result = this.tableRepository.applyTableEdits(saveId, commands);
        if (!result.success) {
          logger.warn('endTurn 应用 tableEdits 部分失败', undefined, {
            saveId,
            errors: result.changes.errors
          });
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error('endTurn applyTableEdits 异常', errMsg, { saveId });
        // 不阻塞后续叙事生成
      }
    }

    // 6. 自动存档（更新 save.json 的 currentTurn）
    const newTurn = this.resolveNewTurn(tableData);
    if (newTurn !== null) {
      try {
        this.saveRepository.updateSave(saveId, {
          currentTurn: newTurn,
          turnCount: newTurn
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.warn('endTurn updateSave 失败（不阻塞叙事生成）', errMsg, { saveId });
      }
    }

    // 7. 构建 end_turn 叙事请求
    const request = await this.buildEndTurnRequest(saveId, tableData, event);

    // 8. 触发 AI 叙事生成
    await this.narrativeService.generateNarrative(request, callbacks, abortSignal);
  }

  // ==================== userAction 处理：build / recruit ====================

  /**
   * 应用建造设施的资源扣减
   *
   * 流程：
   * 1. 查找 FACILITY_COSTS 中 facility_id 的成本配置
   * 2. 读取当前 resources sheet，找到 gold / food / wood / population 对应行
   * 3. 生成 updateRow 命令扣减对应资源
   * 4. 通过 applyTableEdits 应用
   *
   * 资源不足或设施未在成本表中时，跳过扣减但仍让叙事生成（让 AI 提示玩家）。
   */
  private applyFacilityBuild(saveId: string, facilityId: string): void {
    const costs = FACILITY_COSTS[facilityId];
    if (!costs) {
      // 未在成本表中的设施：跳过资源扣减，让 AI 直接叙事
      logger.info('applyFacilityBuild: 设施未在成本表中，跳过资源扣减', undefined, {
        facilityId
      });
      return;
    }

    const tableData = this.tableRepository.getTableData(saveId);
    if (!tableData) {
      logger.warn('applyFacilityBuild: 表格数据不存在', undefined, { saveId });
      return;
    }

    const commands = this.buildResourceDeductionCommands(tableData, costs);
    if (commands.length === 0) {
      return;
    }

    try {
      const result = this.tableRepository.applyTableEdits(saveId, commands);
      if (!result.success) {
        logger.warn('applyFacilityBuild 资源扣减部分失败', undefined, {
          saveId,
          facilityId,
          errors: result.changes.errors
        });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error('applyFacilityBuild applyTableEdits 异常', errMsg, {
        saveId,
        facilityId
      });
    }
  }

  /**
   * 应用招募角色的资源扣减与人口增加
   *
   * 流程：
   * 1. 查找 RECRUIT_COSTS 中 character_id 的成本配置
   * 2. 读取当前 resources sheet
   * 3. 生成 updateRow 命令扣减金币，并增加人口
   * 4. 通过 applyTableEdits 应用
   *
   * 注意 buildResourceDeductionCommands 的语义约定：
   * - costs 中正数表示"扣减量"，负数表示"增加量"
   * - 招募时金币为正（扣减），人口为 -1（即"扣减 -1"等于增加 1）
   */
  private applyCharacterRecruit(saveId: string, characterId: string): void {
    const costs = RECRUIT_COSTS[characterId];
    if (!costs) {
      logger.info('applyCharacterRecruit: 角色未在成本表中，跳过资源扣减', undefined, {
        characterId
      });
      return;
    }

    const tableData = this.tableRepository.getTableData(saveId);
    if (!tableData) {
      logger.warn('applyCharacterRecruit: 表格数据不存在', undefined, { saveId });
      return;
    }

    // 招募会增加 1 人口：将 population 设为 -1（"扣减 -1" 等同于增加 1）
    const effectiveCosts: Partial<Record<ResourceKey, number>> = { ...costs };
    effectiveCosts.population = (effectiveCosts.population ?? 0) - 1;

    const commands = this.buildResourceDeductionCommands(tableData, effectiveCosts);
    if (commands.length === 0) {
      return;
    }

    try {
      const result = this.tableRepository.applyTableEdits(saveId, commands);
      if (!result.success) {
        logger.warn('applyCharacterRecruit 资源扣减部分失败', undefined, {
          saveId,
          characterId,
          errors: result.changes.errors
        });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error('applyCharacterRecruit applyTableEdits 异常', errMsg, {
        saveId,
        characterId
      });
    }
  }

  // ==================== endTurn 内部方法 ====================

  /**
   * 结算产出
   *
   * 遍历 facilities sheet，按 production 字段累加产出。
   * 同时按 resources sheet 的 change_per_turn 字段应用变化。
   * 额外传入的 eventDeltas 会被合并到对应资源的总变化中，
   * 避免对同一资源行产生多条 updateRow 命令互相覆盖。
   *
   * production 字段格式："food:5,gold:10"（资源键:数量，多个用逗号分隔）
   * change_per_turn 字段格式：数字字符串（如 "-2" 表示每回合 -2）
   * eventDeltas 格式：{ food: 10, population: 1 }（正数=增加，负数=扣减）
   *
   * @returns tableEdit 命令列表（updateRow 到 resources sheet）
   */
  private settleProduction(
    tableData: GameTableData,
    eventDeltas: Partial<Record<ResourceKey, number>> = {}
  ): GameTableEditCommand[] {
    const commands: GameTableEditCommand[] = [];

    const resourcesSheetName = tableData.sheets.find(
      s => s.toLowerCase() === 'resources'
    );
    const facilitiesSheetName = tableData.sheets.find(
      s => s.toLowerCase() === 'facilities'
    );

    if (!resourcesSheetName) {
      return commands;
    }

    // 1. 收集 facilities 的产出
    const production: Partial<Record<ResourceKey, number>> = {};
    if (facilitiesSheetName) {
      const facilityRows = tableData.data?.[facilitiesSheetName] || [];
      for (const row of facilityRows) {
        const productionStr = String(row['6'] ?? row['5'] ?? '');
        if (!productionStr) continue;
        const parsed = this.parseProductionString(productionStr);
        for (const [key, value] of Object.entries(parsed)) {
          production[key as ResourceKey] = (production[key as ResourceKey] ?? 0) + value;
        }
      }
    }

    // 2. 应用 resources sheet 的 change_per_turn + production + eventDeltas（合并为单条 updateRow）
    const resourceRows = tableData.data?.[resourcesSheetName] || [];
    resourceRows.forEach((row, idx) => {
      const resourceName = String(row['3'] ?? row['2'] ?? '');
      const resourceKey = RESOURCE_NAME_TO_KEY[resourceName.toLowerCase()] ||
        RESOURCE_NAME_TO_KEY[resourceName];
      if (!resourceKey) return;

      // 合并所有变化：change_per_turn + production + eventDeltas
      const currentValue = Number(row['4'] ?? 0);
      const changePerTurn = Number(row['5'] ?? 0);
      const productionDelta = production[resourceKey] ?? 0;
      const eventDelta = eventDeltas[resourceKey] ?? 0;
      const totalDelta = changePerTurn + productionDelta + eventDelta;

      // 仅在有变化时生成 updateRow 命令（避免无意义的写入）
      if (totalDelta === 0) return;

      const newValue = currentValue + totalDelta;

      commands.push({
        type: GameTableEditCommandType.UPDATE_ROW,
        sheetIndex: this.findSheetIndex(tableData, resourcesSheetName),
        rowIndex: idx + 1,
        rowData: { '4': String(newValue) },
        raw: `updateRow(${this.findSheetIndex(tableData, resourcesSheetName)}, ${idx + 1}, {"4":"${newValue}"})`
      });

      // 已应用的 production 清零，避免重复计入其他资源
      delete production[resourceKey];
    });

    // 3. 若仍有未消费的 production（如 population 这种不在 resources sheet 的）
    //    视为无需持久化（人口通过 facility.house 的 build 流程增加，不在 endTurn 结算）
    return commands;
  }

  /**
   * 解析 production 字符串
   *
   * 格式："food:5,gold:10" → { food: 5, gold: 10 }
   * 容错：
   * - 支持 , 与 ; 分隔
   * - 跳过格式错误的项
   * - 数量字段为数字（容错字符串数字）
   */
  private parseProductionString(str: string): Partial<Record<ResourceKey, number>> {
    const result: Partial<Record<ResourceKey, number>> = {};
    const parts = str.split(/[,;]/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^([a-zA-Z_]+)\s*:\s*(-?\d+)$/);
      if (match) {
        const key = match[1].toLowerCase() as ResourceKey;
        const value = parseInt(match[2], 10);
        if (!isNaN(value)) {
          result[key] = (result[key] ?? 0) + value;
        }
      }
    }
    return result;
  }

  /**
   * 滚动随机事件
   *
   * 使用 randomSource.next() 返回 [0, 1) 的随机数，
   * 与 RANDOM_EVENTS 的 threshold 字段比较，触发首个 threshold 命中的事件。
   * 未命中任何事件时返回 null（40% 概率）。
   */
  private rollRandomEvent(): RandomEventConfig | null {
    const roll = this.randomSource.next();
    for (const event of RANDOM_EVENTS) {
      if (roll < event.threshold) {
        return event;
      }
    }
    return null;
  }

  /**
   * 构建随机事件记录命令（仅 insertRow 到 events sheet）
   *
   * 注意：事件对资源的效果已合并到 settleProduction 的 eventDeltas 参数中，
   * 由 settleProduction 生成单条 updateRow 命令。本方法仅负责在 events sheet
   * 插入一行事件记录（id / turn / description / effect），不重复应用资源变更。
   *
   * 旧实现 buildEventCommands 同时生成 insertRow + updateRow，
   * 会导致对同一资源行产生多条 updateRow 互相覆盖（最后写入者胜）。
   */
  private buildEventInsertCommands(
    tableData: GameTableData,
    event: RandomEventConfig
  ): GameTableEditCommand[] {
    const commands: GameTableEditCommand[] = [];

    const eventsSheetName = tableData.sheets.find(s => s.toLowerCase() === 'events');

    if (eventsSheetName) {
      const eventsSheetIndex = this.findSheetIndex(tableData, eventsSheetName);
      const currentTurn = this.resolveCurrentTurn(tableData) ?? 0;
      const eventId = `event_${Date.now()}`;
      commands.push({
        type: GameTableEditCommandType.INSERT_ROW,
        sheetIndex: eventsSheetIndex,
        rowData: {
          '2': eventId,
          '3': String(currentTurn),
          '4': event.description,
          '5': this.formatEventEffect(event.effect)
        },
        raw: `insertRow(${eventsSheetIndex}, {"2":"${eventId}","3":"${currentTurn}","4":"${event.description}","5":"${this.formatEventEffect(event.effect)}"})`
      });
    }

    return commands;
  }

  /**
   * 格式化事件效果为字符串（如 "food:+10"）
   */
  private formatEventEffect(effect: Partial<Record<ResourceKey, number>>): string {
    return Object.entries(effect)
      .map(([key, value]) => `${key}:${value > 0 ? '+' : ''}${value}`)
      .join(',');
  }

  /**
   * 构建回合数 +1 的命令
   *
   * 查找 stats sheet 中的 turn 行（'2' 或 '3' 字段 = 'turn'），更新 '4' 字段的值。
   * 若 stats sheet 不存在或无 turn 行，返回 null。
   *
   * 字段约定（与 resolveCurrentTurn 对齐）：
   * - 在 '2'（唯一id）或 '3'（键名）字段中查找 'turn' 关键字
   * - 值始终写入 '4' 字段（避免误覆盖 '3' 字段的键名）
   */
  private incrementTurnCommand(tableData: GameTableData): GameTableEditCommand | null {
    const statsSheetName = tableData.sheets.find(s => s.toLowerCase() === 'stats');
    if (!statsSheetName) {
      return null;
    }

    const statsRows = tableData.data?.[statsSheetName] || [];
    let turnRowIndex = -1;
    for (let i = 0; i < statsRows.length; i++) {
      const key = String(statsRows[i]['2'] ?? statsRows[i]['3'] ?? '').toLowerCase();
      if (key === 'turn') {
        turnRowIndex = i;
        break;
      }
    }

    if (turnRowIndex < 0) {
      return null;
    }

    // 始终从 '4' 字段读取当前值（'3' 是键名字符串）
    const currentValue = Number(statsRows[turnRowIndex]['4'] ?? 0);
    const newValue = currentValue + 1;
    const statsSheetIndex = this.findSheetIndex(tableData, statsSheetName);

    return {
      type: GameTableEditCommandType.UPDATE_ROW,
      sheetIndex: statsSheetIndex,
      rowIndex: turnRowIndex + 1,
      rowData: { '4': String(newValue) },
      raw: `updateRow(${statsSheetIndex}, ${turnRowIndex + 1}, {"4":"${newValue}"})`
    };
  }

  // ==================== 通用工具方法 ====================

  /**
   * 构建资源扣减命令
   *
   * 在 resources sheet 中找到 gold / food / wood / population 对应行，
   * 生成 updateRow 命令扣减对应资源。
   *
   * 语义约定（避免歧异）：
   * - costs 中正数表示"扣减量"（如 gold: 50 表示扣减 50 金币）
   * - costs 中负数表示"增加量"（如 population: -1 表示增加 1 人口，即"扣减 -1"）
   * - 0 与 undefined 均跳过
   *
   * @param costs 资源扣减映射（正数=扣减，负数=增加）
   * @returns tableEdit 命令列表
   */
  private buildResourceDeductionCommands(
    tableData: GameTableData,
    costs: Partial<Record<ResourceKey, number>>
  ): GameTableEditCommand[] {
    const commands: GameTableEditCommand[] = [];

    const resourcesSheetName = tableData.sheets.find(
      s => s.toLowerCase() === 'resources'
    );
    if (!resourcesSheetName) {
      return commands;
    }

    const resourcesSheetIndex = this.findSheetIndex(tableData, resourcesSheetName);
    const resourceRows = tableData.data?.[resourcesSheetName] || [];

    resourceRows.forEach((row, idx) => {
      const resourceName = String(row['3'] ?? row['2'] ?? '');
      const resourceKey =
        RESOURCE_NAME_TO_KEY[resourceName.toLowerCase()] ||
        RESOURCE_NAME_TO_KEY[resourceName];
      if (!resourceKey) return;

      const cost = costs[resourceKey];
      if (cost === undefined || cost === 0) return;

      const currentValue = Number(row['4'] ?? 0);
      // cost 为正 → 扣减（currentValue - cost）
      // cost 为负 → 增加（currentValue - (-1) = currentValue + 1）
      const newValue = currentValue - cost;
      commands.push({
        type: GameTableEditCommandType.UPDATE_ROW,
        sheetIndex: resourcesSheetIndex,
        rowIndex: idx + 1,
        rowData: { '4': String(newValue) },
        raw: `updateRow(${resourcesSheetIndex}, ${idx + 1}, {"4":"${newValue}"})`
      });
    });

    return commands;
  }

  /**
   * 查找 sheet 在 tableData.sheets 数组中的 1-based 索引
   */
  private findSheetIndex(tableData: GameTableData, sheetName: string): number {
    const idx = tableData.sheets.indexOf(sheetName);
    return idx + 1; // 1-based
  }

  /**
   * 从 tableData 解析当前回合数
   *
   * 优先从 stats sheet 的 turn 行读取；若不存在，返回 null
   *
   * 字段读取约定（与 managementSchema 的 stats sheet 结构对齐）：
   * - '2' 字段：唯一id（如 'turn'）
   * - '3' 字段：键名（如 'turn'）
   * - '4' 字段：值（如 3）
   *
   * 这里在 '2' 与 '3' 字段中查找 'turn' 关键字（兼容两种命名风格），
   * 但值始终从 '4' 字段读取（避免误读 '3' 字段的键名字符串）。
   */
  private resolveCurrentTurn(tableData: GameTableData): number | null {
    const statsSheetName = tableData.sheets.find(s => s.toLowerCase() === 'stats');
    if (!statsSheetName) {
      return null;
    }

    const statsRows = tableData.data?.[statsSheetName] || [];
    for (const row of statsRows) {
      const key = String(row['2'] ?? row['3'] ?? '').toLowerCase();
      if (key === 'turn') {
        // 始终从 '4' 字段读取值（'3' 是键名字符串，不是数值）
        const rawValue = row['4'];
        const value = Number(rawValue);
        return isNaN(value) ? null : value;
      }
    }
    return null;
  }

  /**
   * 计算 endTurn 后的新回合数
   *
   * 等于 resolveCurrentTurn + 1，若无法读取则返回 null
   */
  private resolveNewTurn(tableData: GameTableData): number | null {
    const current = this.resolveCurrentTurn(tableData);
    if (current === null) {
      return null;
    }
    return current + 1;
  }

  /**
   * 将通用 GameNarrativeRequest 注入经营模板的 prompt 片段
   *
   * 读取 gameMeta 与 tableSchema，调用 ManagementPromptBuilder.buildSystemPrompt
   * 生成经营专属规则片段，覆盖 request.templateSystemPrompt 字段。
   *
   * 注意：tableSchema 优先使用 request.tableSchema（由渲染进程传入），
   * 若未提供则使用一个默认的 5-sheet 经营 schema 占位。
   */
  private async enrichRequestWithManagementPrompt(
    request: GameNarrativeRequest
  ): Promise<GameNarrativeRequest> {
    // 简化处理：使用一个占位的 GameMeta（标题"田园小镇"）
    // 实际生产中通用 GameNarrativeService 会从 GameRepository 读取真实 meta
    // 这里仅用于构建 prompt 片段，标题不影响核心逻辑
    const placeholderMeta: GameMeta = {
      id: request.gameId,
      type: request.gameType,
      title: '田园小镇',
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

    const tableSchema: GameTableSchema = request.tableSchema ?? DEFAULT_MANAGEMENT_SCHEMA;
    const systemPromptFragment = this.promptBuilder.buildSystemPrompt(
      placeholderMeta,
      tableSchema
    );

    return {
      ...request,
      templateSystemPrompt: systemPromptFragment,
      tableSchema
    };
  }

  /**
   * 构建 end_turn 叙事请求
   *
   * 在 userAction 中携带 end_turn 标记，并附带触发的随机事件描述
   * （通过 templateSystemPrompt 的扩展段注入，或直接修改 userAction）。
   *
   * 这里采用：将随机事件描述追加到 userAction 末尾，让 AI 在叙事中体现事件。
   */
  private async buildEndTurnRequest(
    saveId: string,
    tableData: GameTableData,
    event: RandomEventConfig | null
  ): Promise<GameNarrativeRequest> {
    // 重新读取最新的 tableData（应用了产出结算 / 事件 / 回合 +1 之后）
    const latestTableData = this.tableRepository.getTableData(saveId) ?? tableData;

    const currentTurn = this.resolveCurrentTurn(latestTableData) ?? 1;
    const resourcesSheetName = latestTableData.sheets.find(
      s => s.toLowerCase() === 'resources'
    );
    const resourcesSnapshot = resourcesSheetName
      ? latestTableData.data?.[resourcesSheetName] || []
      : [];
    const recentEvents = this.extractRecentEvents(latestTableData);

    // 通过 ManagementPromptBuilder.buildUserPrompt 构建 end_turn 的 user prompt 片段，
    // 然后作为 userAction 传入（让 AI 看到当前回合 / 资源 / 事件）
    const userAction = this.promptBuilder.buildUserPrompt({
      userAction: event ? `end_turn（触发事件：${event.description}）` : 'end_turn',
      currentTurn,
      tableSnapshot: latestTableData,
      recentEvents
    });

    const placeholderMeta: GameMeta = {
      id: 'management',
      type: 'management' as any,
      title: '田园小镇',
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

    const systemPromptFragment = this.promptBuilder.buildSystemPrompt(
      placeholderMeta,
      DEFAULT_MANAGEMENT_SCHEMA
    );

    void resourcesSnapshot; // 保留供未来直接读取资源快照（当前已通过 buildUserPrompt 注入）

    return {
      gameId: 'management',
      saveId,
      gameType: 'management' as any,
      userAction,
      templateSystemPrompt: systemPromptFragment,
      tableSchema: DEFAULT_MANAGEMENT_SCHEMA,
      organizeMode: 'async'
    };
  }

  /**
   * 从 events sheet 提取最近 3 个事件描述
   *
   * 用于 end_turn 的 user prompt 构建
   */
  private extractRecentEvents(tableData: GameTableData): string[] {
    const eventsSheetName = tableData.sheets.find(s => s.toLowerCase() === 'events');
    if (!eventsSheetName) {
      return [];
    }

    const eventRows = tableData.data?.[eventsSheetName] || [];
    // 取最后 3 条，按时间顺序（最旧的在前）
    const recent = eventRows.slice(-3);
    return recent.map(row => String(row['4'] ?? row['3'] ?? '')).filter(s => s.length > 0);
  }
}

// ==================== 默认 Schema ====================

/**
 * 默认经营游戏 schema（5 个 sheet）
 *
 * 与 Task 14 的 managementSchema.ts 对齐，作为 enrichRequestWithManagementPrompt
 * 的回退 schema。生产环境应通过 request.tableSchema 由渲染进程传入实际 schema。
 */
const DEFAULT_MANAGEMENT_SCHEMA: GameTableSchema = {
  sheets: ['characters', 'resources', 'facilities', 'events', 'stats'],
  headers: {
    characters: ['流水号', '唯一id', '角色名', '身份', '状态'],
    resources: ['流水号', '唯一id', '资源名', '数量', '每回合变化'],
    facilities: ['流水号', '唯一id', '设施名', '等级', '建造成本', '产出'],
    events: ['流水号', '唯一id', '回合', '描述', '效果'],
    stats: ['流水号', '唯一id', '键', '值']
  },
  sheetDescriptions: {
    characters: '记录小镇居民，每行一个角色',
    resources: '记录 4 种资源：金币 / 食物 / 木材 / 人口',
    facilities: '记录已建设的设施',
    events: '记录历史事件，按时间倒序追加',
    stats: '记录全局统计（如 turn / total_income）'
  }
};

// ==================== 单例导出 ====================

/**
 * 单例 ManagementNarrativeService
 *
 * 默认不注入实际依赖；主进程启动时需调用方注入：
 *
 * ```ts
 * import { gameNarrativeService } from '../../GameNarrativeService';
 * import { gameTableRepository } from '../../GameTableRepository';
 * import { gameSaveRepository } from '../../GameSaveRepository';
 * import { ManagementNarrativeService, ManagementPromptBuilder } from './ManagementNarrativeService';
 *
 * const service = new ManagementNarrativeService(
 *   gameNarrativeService,
 *   new ManagementPromptBuilder(),
 *   gameTableRepository,
 *   gameSaveRepository
 * );
 * ```
 *
 * 注意：由于 ManagementNarrativeService 是包装层，IPC handler
 * 目前直接调用 GameNarrativeService。后续若引入 management 专属 IPC 频道
 * （如 `game:management:endTurn`），再切换到本单例。
 *
 * 为避免在主进程启动时引入循环依赖，这里仅导出类与构建工厂，
 * 不创建默认实例。具体实例化由调用方负责。
 */

// 导出默认 schema 供外部使用
export { DEFAULT_MANAGEMENT_SCHEMA };
