/**
 * Agent IPC Handlers —— 智能体底座 IPC 通道注册
 *
 * 来源：spec §二 Task 9.1（注册 agent:run/cancel/toolCall/token/done +
 *       skill:list/invoke + memory:search + learning:dream）
 *       spec §二 Task 18（learning 模块完整接入：dream/goal/steer/feedback）
 * 决策：自研（spec §三无对应 openclaw 文件）。
 *
 * 17 个 IPC 通道：
 *  1. agent:run                  - 启动 agent 运行（ipcMain.handle，返回 AgentRunResult）
 *  2. agent:cancel               - 取消运行中的 agent（ipcMain.handle）
 *  3. agent:toolCall             - 工具调用事件流（event.sender.send 推送）
 *  4. agent:token                - 文本 token 流式推送（event.sender.send 推送）
 *  5. agent:done                 - agent 完成事件（event.sender.send 推送）
 *  6. skill:list                 - 列出可用技能（ipcMain.handle）
 *  7. skill:invoke               - 调用技能（ipcMain.handle）
 *  8. memory:search              - 检索记忆（ipcMain.handle）
 *  9. learning:dream             - 手动触发 dreaming（Task 18 完整实现）
 *  10. learning:cancelDream      - 取消正在进行的 dreaming
 *  11. learning:getDreamingStatus - 查询 dreaming 运行状态
 *  12. learning:createGoal       - 创建会话目标
 *  13. learning:getGoal          - 获取当前会话目标
 *  14. learning:updateGoal       - 更新目标状态（complete | blocked）
 *  15. learning:clearGoal        - 清除会话目标
 *  16. learning:steer            - 写入引导消息
 *  17. learning:listSteer        - 列出 pending 引导消息
 *  18. learning:recordFeedback   - 记录用户反馈
 *  19. learning:runReflection    - 触发反馈反思
 *
 * 设计约束：
 *  - agent:run 支持流式推送：通过 event.sender.send 向渲染进程推送 token/toolCall/done 事件
 *  - 单实例守卫：同一 sender 仅允许一个活跃 agent run
 *  - 降级保护：agent 底座未初始化时返回清晰错误，不崩溃
 *  - learning 模块降级：SQLite/LLM provider 未初始化时返回空结果而非崩溃
 *  - 遵循现有 IPC 模式（ipcMain.handle + event.sender.send）
 */

import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { AIService } from '../../services/AIService';
import { createLogger } from '../../services/logger';
import type { AgentRunIntent, AgentRunResult, ToolCallContext } from '../../services/agent/contracts';
import { AgentCore } from '../../services/agent/core/agentCore';
import { AIServiceAdapter } from '../../services/agent/llm/llmProvider';
import { CapabilityDetector, CONSERVATIVE_FALLBACK } from '../../services/agent/llm/capabilityDetector';
import { getToolRegistry, registerUpdateStateTableTool, registerDialogueTools, registerWorldbookTools, type ITableEditExecutor, type IDialogueToolServices, type IWorldbookToolServices } from '../../services/agent/tools';
import { initAgentBackendIfNeeded } from '../../services/agent/memory/sqliteBackend';
import { agentModeService } from '../../services/agent/management/agentModeService';
import { agentConfigService } from '../../services/agent/management/agentConfigService';
import type { AgentModeOverride, AgentConfig } from '../../services/agent/management/agentConfigTypes';
import { getStorageService } from '../../services/storageService';
import { aiConfigProvider } from '../../services/ai/AIConfigProvider';
import type { FallbackProvider } from '../../services/agent/failoverPolicy';
import { getSkillRegistry } from '../../services/agent/skills/skillRegistry';
import { loadBuiltinSkillsSync, loadWorkspaceSkills, importSkillFromDir, importSkillFromUrl, uninstallSkill, createSkill, editSkill } from '../../services/agent/skills/skillLoader';
import { getUserDataPath } from '../../utils/appPath';
import {
  createSession,
  listSessions,
  switchSession,
  deleteSession,
  renameSession,
  saveSessionMessages,
  loadSessionMessages,
} from '../../services/agent/sessionManager';

const logger = createLogger('agent-handlers');

// ==================== 活跃 agent 管理 ====================

/**
 * 活跃 agent run 记录。
 * 同一 sender 仅允许一个活跃 run（单实例守卫）。
 */
interface ActiveAgentRun {
  agentCore: AgentCore;
  senderId: number;
  startedAt: number;
}

const activeRuns = new Map<number, ActiveAgentRun>();

// ==================== 懒初始化单例 ====================

let aiServiceInstance: AIService | null = null;
let capabilityDetector: CapabilityDetector | null = null;

/**
 * 获取 AIService 单例（懒初始化）。
 */
function getAIService(): AIService {
  if (!aiServiceInstance) {
    aiServiceInstance = new AIService();
  }
  return aiServiceInstance;
}

/**
 * 获取 CapabilityDetector 单例（懒初始化）。
 */
function getCapabilityDetector(): CapabilityDetector {
  if (!capabilityDetector) {
    capabilityDetector = new CapabilityDetector(getAIService());
  }
  return capabilityDetector;
}

// ==================== IPC 通道注册 ====================

/**
 * 注册所有 agent 相关 IPC handler。
 *
 * 在 setupIpcHandlers 中调用。
 */
export function registerAgentHandlers(): void {
  registerAgentRunHandler();
  registerAgentCancelHandler();
  registerSkillHandlers();
  registerMemorySearchHandler();
  registerLearningHandlers();
  registerAgentModeHandlers();
  registerAgentConfigHandlers();
  registerSessionHandlers();
  registerFailoverHandlers();

  // 注册 agentModeService.onModeChanged 回调，广播到所有窗口（仅注册一次）
  agentModeService.onModeChanged((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('agent:modeChanged', status);
      }
    }
  });

  // 【重点标记 - 启动时根据缓存的能力清单初始化 Agent 模式状态】
  // 修复系统模式显示错误：项目启动后自动读取上次配置的 capabilities 缓存，
  // 正确初始化 agentModeService，使系统模式能正确显示为 Agent 或普通模式。
  // 此前 agentModeService 默认状态为 active=false（普通模式），
  // 即使缓存的能力清单中 supportsToolCalling=true，模式也不会更新。
  try {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    const activeEngineId = settings?.activeEngineId;
    const aiEngines = settings?.aiEngines;
    if (aiEngines && activeEngineId) {
      const activeEngine = aiEngines.find((e: any) => e.id === activeEngineId);
      if (activeEngine) {
        agentModeService.reevaluate({
          useAgent: activeEngine.useAgent ?? false,
          agentModeOverride: activeEngine.agentModeOverride ?? 'auto',
          capabilities: activeEngine.capabilities,
        });
        logger.info('AgentModeService initialized from cached settings', undefined, {
          active: agentModeService.isAgentModeActive(),
          override: activeEngine.agentModeOverride ?? 'auto',
          supportsToolCalling: activeEngine.capabilities?.supportsToolCalling ?? false,
        });
      }
    }
  } catch (err) {
    logger.warn('Failed to initialize AgentModeService from cached settings', err instanceof Error ? err.message : String(err));
  }

  // 启动期懒初始化 agent SQLite 后端（幂等）。
  // 成功后 memory:search / EmbeddingCache 持久化 / learning 模块均可使用；
  // 失败（如 better-sqlite3 未安装）静默降级，agent:run 仍可工作（无记忆检索）。
  initAgentBackendIfNeeded()
    .then((backend) => {
      if (backend) {
        logger.info('Agent SQLite backend initialized', undefined, { path: 'agent/memory.db' });
        // Task 18: 初始化 learning 模块（dreaming / goal / steer / feedback）
        // 依赖 SQLite backend + LLM provider + memory provider，三者就绪后才能启动
        initLearningServicesSafely();

        // 初始化智能体配置服务（注册系统预置智能体，幂等）。
        // agent-config:* IPC 依赖此初始化；失败时降级（IPC 返回错误，不崩溃）。
        agentConfigService.init()
          .then(() => logger.info('AgentConfigService initialized (system agents registered)'))
          .catch((err) => logger.warn(
            'AgentConfigService init failed (agent-config:* IPC will return errors)',
            err instanceof Error ? err.message : String(err),
          ));
      } else {
        logger.warn('Agent SQLite backend unavailable (degrading: memory:search returns empty, embedding cache in-memory only, learning module disabled)');
      }
    })
    .catch((err) => {
      logger.warn('Agent SQLite backend init failed (degrading)', err instanceof Error ? err.message : String(err));
    });

  logger.info('Agent IPC handlers registered (run/cancel/skill/memory/learning/mode/config/session/failover)');
}

// ==================== Learning 模块懒初始化 ====================

/**
 * Learning 模块是否已初始化（避免重复初始化）。
 */
let learningInitialized = false;

/**
 * 安全初始化 learning 模块。
 *
 * 在 SQLite backend 就绪后调用。失败时静默降级（learning IPC 返回空结果），
 * 不影响 agent:run 等核心功能。
 */
function initLearningServicesSafely(): void {
  if (learningInitialized) return;
  try {
    const { initLearningServices } = require('../../services/agent/learning');
    const { getMemoryStore } = require('../../services/agent/memory/memoryStore');
    const { WriteProvenanceService } = require('../../services/agent/memory/writeProvenance');
    const { getAgentBackend } = require('../../services/agent/memory/sqliteBackend');

    const backend = getAgentBackend();
    // 初始化 WriteProvenanceService 和 MemoryStore（若尚未初始化）
    const provenance = new WriteProvenanceService(backend);
    try {
      getMemoryStore({ backend, provenance });
    } catch {
      // MemoryStore 已初始化，忽略
    }
    const memoryProvider = getMemoryStore();

    // 创建 LLM provider（共享 AIServiceAdapter，无流式回调）
    const aiService = getAIService();
    const { AIServiceAdapter } = require('../../services/agent/llm/llmProvider');
    const llmProvider = new AIServiceAdapter(aiService);

    // 获取默认模型名（从 AIService 配置读取）
    let defaultModel: string | undefined;
    aiService.getConfig().then((config: any) => {
      defaultModel = config.model;
    }).catch(() => {
      // ignore
    });

    // 初始化 learning 模块（含 cronScheduler 启动 + dreaming 定时任务注册）
    initLearningServices({
      backend,
      llmProvider,
      memoryProvider,
      defaultModel,
      autoStartScheduler: true,
      verbose: false,
    });
    learningInitialized = true;
    logger.info('Learning services initialized (dreaming/goal/steer/feedback)');
  } catch (err) {
    logger.warn(
      'Learning services init failed (degrading: learning IPC returns empty)',
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * 安全获取 dreaming 服务（未初始化时返回 null）。
 */
async function getDreamingServiceSafely(): Promise<any | null> {
  if (!learningInitialized) return null;
  try {
    const { getDreamingService } = require('../../services/agent/learning');
    return getDreamingService();
  } catch {
    return null;
  }
}

/**
 * 安全获取 goal tracker（未初始化时返回 null）。
 */
async function getGoalTrackerSafely(): Promise<any | null> {
  if (!learningInitialized) return null;
  try {
    const { getGoalTracker } = require('../../services/agent/learning');
    return getGoalTracker();
  } catch {
    return null;
  }
}

/**
 * 安全获取 steer engine（未初始化时返回 null）。
 */
async function getSteerEngineSafely(): Promise<any | null> {
  if (!learningInitialized) return null;
  try {
    const { getSteerEngine } = require('../../services/agent/learning');
    return getSteerEngine();
  } catch {
    return null;
  }
}

/**
 * 安全获取 feedback loop（未初始化时返回 null）。
 */
async function getFeedbackLoopSafely(): Promise<any | null> {
  if (!learningInitialized) return null;
  try {
    const { getFeedbackLoop } = require('../../services/agent/learning');
    return getFeedbackLoop();
  } catch {
    return null;
  }
}

// ==================== agent:run ====================

/**
 * agent:run 通道。
 *
 * 启动 agent 运行，支持流式推送：
 *  - agent:token 事件：文本 chunk（边生成边推送）
 *  - agent:toolCall 事件：工具调用 start/end
 *  - agent:done 事件：运行完成（含 AgentRunResult）
 *
 * 参数（AgentRunIntent）：
 *  - systemPrompt: 系统提示词
 *  - messages: 对话历史
 *  - context: 工具调用上下文（sessionId / characterId / mode）
 *  - maxIterations?: 最大迭代次数
 *  - timeoutMs?: 超时
 */
function registerAgentRunHandler(): void {
  ipcMain.handle('agent:run', async (event: IpcMainInvokeEvent, intent: AgentRunIntent) => {
    const senderId = event.sender.id;

    // 单实例守卫：同一 sender 仅允许一个活跃 run
    if (activeRuns.has(senderId)) {
      return {
        success: false,
        error: 'Agent is already running. Cancel the current run first.',
      } as AgentRunFallbackResult;
    }

    try {
      const aiService = getAIService();
      const detector = getCapabilityDetector();

      // 探测模型能力
      const config = await aiService.getConfig();
      let capabilities = CONSERVATIVE_FALLBACK;
      try {
        capabilities = await detector.detect({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          apiKeyTransmission: config.apiKeyTransmission,
          modelName: config.model,
        });
      } catch (err) {
        logger.warn('Capability detection failed, using conservative fallback', err instanceof Error ? err.message : String(err));
      }

      // 创建 LLM 适配器（流式 chunk 通过 event.sender.send 推送）
      const llmProvider = new AIServiceAdapter(aiService, (chunk: string) => {
        // 推送 token 流
        if (!event.sender.isDestroyed()) {
          event.sender.send('agent:token', { chunk, timestamp: Date.now() });
        }
      });

      // 创建 AgentCore（工具提供方为 ToolRegistry，已注册 updateStateTable 工具）
      // 注：不设置 onTextChunk —— 流式 token 已由 AIServiceAdapter.onStreamChunk 实时推送，
      // 若同时设置 onTextChunk 会导致完整内容在 streamChat 返回后被二次推送（内容重复）。
      const agentCore = new AgentCore({
        llmProvider,
        toolProvider: getToolProvider(),
        capabilities,
        maxIterations: intent.maxIterations,
        timeoutMs: intent.timeoutMs,
        onToolCall: (info) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('agent:toolCall', {
              name: info.name,
              args: info.args,
              phase: info.phase,
              result: info.result,
              durationMs: info.durationMs,
              timestamp: Date.now(),
            });
          }
        },
      });

      // 记录活跃 run
      activeRuns.set(senderId, {
        agentCore,
        senderId,
        startedAt: Date.now(),
      });

      // 订阅 lifecycle 事件（推送 done）
      agentCore.on((lifecycleEvent) => {
        if (lifecycleEvent.type === 'agent_end' && !event.sender.isDestroyed()) {
          event.sender.send('agent:done', {
            finishReason: lifecycleEvent.finishReason,
            iterations: lifecycleEvent.iterations,
            error: lifecycleEvent.error,
            timestamp: lifecycleEvent.timestamp,
          });
        }
      });

      // 运行 agent
      const result: AgentRunResult = await agentCore.run(intent);

      return { success: true, result } as AgentRunFallbackResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('agent:run failed', err instanceof Error ? err.message : String(err));
      return { success: false, error: message } as AgentRunFallbackResult;
    } finally {
      activeRuns.delete(senderId);
    }
  });
}

// ==================== agent:cancel ====================

/**
 * agent:cancel 通道。
 *
 * 取消当前 sender 的活跃 agent run。
 */
function registerAgentCancelHandler(): void {
  ipcMain.handle('agent:cancel', async (event: IpcMainInvokeEvent) => {
    const senderId = event.sender.id;
    const active = activeRuns.get(senderId);
    if (!active) {
      return { success: false, error: 'No active agent run to cancel' };
    }
    try {
      active.agentCore.cancel();
      logger.info('Agent run cancelled', undefined, { senderId });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('agent:cancel failed', err instanceof Error ? err.message : String(err));
      return { success: false, error: message };
    }
  });
}

// ==================== skill:list / skill:invoke ====================

/**
 * skill:list 和 skill:invoke 通道。
 *
 * skill:list 每次调用都重新扫描技能目录（清空注册表后重新加载内置 + 工作区技能），
 * 返回给前端用于技能配置面板。此前使用 skillsLoaded 布尔标志永久缓存，新增技能必须重启应用。
 */
function registerSkillHandlers(): void {
  ipcMain.handle('skill:list', async () => {
    try {
      const registry = getSkillRegistry();
      // 每次调用重新扫描：清空注册表后重新加载内置 + 工作区技能
      registry.clear();
      const builtinEntries = loadBuiltinSkillsSync();
      const workspaceEntries = await loadWorkspaceSkills(getUserDataPath());
      registry.registerAll([...builtinEntries, ...workspaceEntries]);

      const entries = registry.list();
      const skills = entries.map(entry => ({
        name: entry.skill.name,
        title: entry.frontmatter.title || entry.skill.name,
        description: entry.skill.description,
        emoji: entry.frontmatter.emoji,
        source: entry.skill.source,
        userInvocable: entry.exposure?.userInvocable ?? entry.invocation?.userInvocable ?? true,
      }));
      return { success: true, skills };
    } catch (err) {
      console.error('[SkillHandlers] skill:list error:', err);
      return { success: false, skills: [], error: String(err) };
    }
  });

  ipcMain.handle('skill:invoke', async (
    _event: IpcMainInvokeEvent,
    _args: { skillName: string; args: Record<string, unknown>; context?: ToolCallContext }
  ) => {
    return {
      success: false,
      error: 'Skill invocation not yet implemented. Use dedicated agent IPC channels (e.g. worldbookAgent:run) instead.',
    };
  });

  // skill:importFromDir — 从本地目录导入技能
  ipcMain.handle('skill:importFromDir', async (_event: IpcMainInvokeEvent, dirPath: string) => {
    try {
      const entry = await importSkillFromDir(dirPath);
      if (!entry) {
        return { success: false, error: 'Failed to import skill from directory' };
      }
      return { success: true, skillName: entry.skill.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('skill:importFromDir failed', message);
      return { success: false, error: message };
    }
  });

  // skill:importFromUrl — 从 URL 下载并导入技能
  ipcMain.handle('skill:importFromUrl', async (_event: IpcMainInvokeEvent, url: string) => {
    try {
      const entry = await importSkillFromUrl(url);
      if (!entry) {
        return { success: false, error: 'Failed to import skill from URL' };
      }
      return { success: true, skillName: entry.skill.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('skill:importFromUrl failed', message);
      return { success: false, error: message };
    }
  });

  // skill:uninstall — 卸载工作区技能（内置技能不允许卸载）
  ipcMain.handle('skill:uninstall', async (_event: IpcMainInvokeEvent, skillName: string) => {
    try {
      const deleted = await uninstallSkill(skillName);
      if (!deleted) {
        // 区分内置技能和工作区不存在的技能
        const builtinSkills = loadBuiltinSkillsSync();
        const isBuiltin = builtinSkills.some(entry => entry.skill.name === skillName);
        if (isBuiltin) {
          return { success: false, error: '内置技能不允许卸载' };
        }
        return { success: false, error: `Skill '${skillName}' not found in workspace skills directory` };
      }
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('skill:uninstall failed', message);
      return { success: false, error: message };
    }
  });

  // skill:getDetail — 获取技能详情（SKILL.md body 内容）
  ipcMain.handle('skill:getDetail', async (_event: IpcMainInvokeEvent, skillName: string) => {
    try {
      const entry = getSkillRegistry().get(skillName);
      if (!entry) {
        return { success: false, error: `Skill '${skillName}' not found` };
      }
      return {
        success: true,
        detail: {
          name: entry.skill.name,
          description: entry.skill.description,
          body: entry.skill.body,
          source: entry.skill.source,
          filePath: entry.skill.filePath,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('skill:getDetail failed', message);
      return { success: false, error: message };
    }
  });

  // skill:create — 创建工作区技能（写入 SKILL.md）
  ipcMain.handle('skill:create', async (_event: IpcMainInvokeEvent, args: { name: string; description: string; emoji?: string; body: string }) => {
    try {
      const entry = await createSkill(args);
      if (!entry) {
        return { success: false, error: 'Failed to create skill (invalid name, duplicate, or write error)' };
      }
      return { success: true, skillName: entry.skill.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('skill:create failed', message);
      return { success: false, error: message };
    }
  });

  // skill:edit — 编辑工作区技能（更新 SKILL.md）
  ipcMain.handle('skill:edit', async (_event: IpcMainInvokeEvent, args: { name: string; description: string; emoji?: string; body: string }) => {
    try {
      const entry = await editSkill(args);
      if (!entry) {
        return { success: false, error: 'Failed to edit skill (builtin skill, not found, or write error)' };
      }
      return { success: true, skillName: entry.skill.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('skill:edit failed', message);
      return { success: false, error: message };
    }
  });

  // skill:getPromptSnippet — 获取格式化后的技能 prompt 片段（注入 system prompt 用）
  ipcMain.handle('skill:getPromptSnippet', async () => {
    try {
      const registry = getSkillRegistry();
      const prompt = registry.buildSnapshot();
      return { success: true, prompt };
    } catch (err) {
      logger.error('skill:getPromptSnippet failed', err instanceof Error ? err.message : String(err));
      return { success: false, prompt: '', error: String(err) };
    }
  });
}

// ==================== memory:search ====================

/**
 * memory:search 通道。
 *
 * 检索记忆（通过 MemoryStore.search）。
 * MemoryStore 初始化依赖 SQLite backend（Task 8 已实现）。
 */
function registerMemorySearchHandler(): void {
  ipcMain.handle('memory:search', async (
    _event: IpcMainInvokeEvent,
    query: {
      query: string;
      types?: string[];
      limit?: number;
      characterId?: string;
      sessionId?: string;
    }
  ) => {
    try {
      // 懒初始化 MemoryStore（若未初始化则返回空结果）
      // 注：MemoryStore 初始化需先调用 getAgentBackend().init(dbPath)
      //     此处通过 try-catch 降级，避免未初始化时崩溃
      const { getMemoryStore } = await import('../../services/agent/memory/memoryStore');
      let memoryStore;
      try {
        memoryStore = getMemoryStore();
      } catch {
        return { success: true, entries: [] };
      }

      const entries = await memoryStore.search({
        query: query.query,
        types: query.types as Array<'lore' | 'persona' | 'dialogue' | 'chapter' | 'agent' | 'skill'> | undefined,
        limit: query.limit,
        characterId: query.characterId,
        sessionId: query.sessionId,
      });

      return { success: true, entries };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('memory:search failed', err instanceof Error ? err.message : String(err));
      return { success: false, error: message, entries: [] };
    }
  });
}

// ==================== learning:* （Task 18 完整实现） ====================

/**
 * 注册 learning 模块的所有 IPC handler（11 个通道）。
 *
 * Task 18 实现：dreaming / goal / steer / feedback 完整接入。
 * 所有 handler 在 learning 模块未初始化时返回明确的降级响应（不崩溃）。
 */
function registerLearningHandlers(): void {
  // 1. learning:dream —— 手动触发 dreaming
  ipcMain.handle('learning:dream', async (_event: IpcMainInvokeEvent, args: { sessionId?: string }) => {
    const service = await getDreamingServiceSafely();
    if (!service) {
      return { success: false, error: 'Learning services not initialized (SQLite backend unavailable)' };
    }
    try {
      const result = await service.runAll(args?.sessionId);
      return { success: true, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('learning:dream failed', msg);
      return { success: false, error: msg };
    }
  });

  // 2. learning:cancelDream —— 取消正在进行的 dreaming
  ipcMain.handle('learning:cancelDream', async () => {
    const service = await getDreamingServiceSafely();
    if (!service) return { success: false, error: 'Learning services not initialized' };
    try {
      service.cancel();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 3. learning:getDreamingStatus —— 查询 dreaming 运行状态
  ipcMain.handle('learning:getDreamingStatus', async () => {
    const service = await getDreamingServiceSafely();
    if (!service) return { success: true, running: false };
    return { success: true, running: service.isRunning };
  });

  // 4. learning:createGoal —— 创建会话目标
  ipcMain.handle(
    'learning:createGoal',
    async (
      _event: IpcMainInvokeEvent,
      args: { sessionId: string; characterId?: string; objective: string; tokenBudget?: number }
    ) => {
      const tracker = await getGoalTrackerSafely();
      if (!tracker) return { success: false, error: 'Learning services not initialized' };
      try {
        const goal = await tracker.createGoal(args);
        return { success: true, goal };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('learning:createGoal failed', msg);
        return { success: false, error: msg };
      }
    }
  );

  // 5. learning:getGoal —— 获取当前会话目标
  ipcMain.handle('learning:getGoal', async (_event: IpcMainInvokeEvent, sessionId: string) => {
    const tracker = await getGoalTrackerSafely();
    if (!tracker) return { success: true, goal: null };
    try {
      const goal = await tracker.getGoal(sessionId);
      return { success: true, goal };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), goal: null };
    }
  });

  // 6. learning:updateGoal —— 更新目标状态
  ipcMain.handle(
    'learning:updateGoal',
    async (
      _event: IpcMainInvokeEvent,
      args: {
        sessionId: string;
        status: 'complete' | 'blocked';
        note?: string;
        blocker?: string;
        tokensDelta?: number;
        actor?: 'user' | 'agent' | 'system';
      }
    ) => {
      const tracker = await getGoalTrackerSafely();
      if (!tracker) return { success: false, error: 'Learning services not initialized' };
      try {
        const goal = await tracker.updateStatus(args);
        return { success: true, goal };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('learning:updateGoal failed', msg);
        return { success: false, error: msg };
      }
    }
  );

  // 7. learning:clearGoal —— 清除会话目标
  ipcMain.handle('learning:clearGoal', async (_event: IpcMainInvokeEvent, sessionId: string) => {
    const tracker = await getGoalTrackerSafely();
    if (!tracker) return { success: false, error: 'Learning services not initialized' };
    try {
      await tracker.clearGoal(sessionId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 8. learning:steer —— 写入引导消息
  ipcMain.handle(
    'learning:steer',
    async (
      _event: IpcMainInvokeEvent,
      args: { sessionId: string; content: string; source: 'user' | 'system' | 'agent'; label?: string }
    ) => {
      const engine = await getSteerEngineSafely();
      if (!engine) return { success: false, error: 'Learning services not initialized' };
      try {
        const id = await engine.enqueueSteer(args);
        return { success: true, id };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('learning:steer failed', msg);
        return { success: false, error: msg };
      }
    }
  );

  // 9. learning:listSteer —— 列出 pending 引导消息
  ipcMain.handle('learning:listSteer', async (_event: IpcMainInvokeEvent, sessionId: string) => {
    const engine = await getSteerEngineSafely();
    if (!engine) return { success: true, messages: [] };
    try {
      // listSteer 内部调用 listPendingMessages（private），此处通过 leasePendingSteer
      // 返回当前 pending 的 lease 批次信息（不消费 lease，仅查询）
      // 简化实现：直接查询数据库（与 listPendingMessages 一致逻辑）
      // 注：完整 lease/inject/ack 流程由 agentLoop 内部调用，IPC 层仅提供查询能力
      const batch = await engine.leasePendingSteer(sessionId);
      if (!batch) return { success: true, messages: [] };
      // 立即 release（IPC 查询不应消费 lease）
      await engine.releaseLeasedSteer(batch.leaseId, batch.messageIds, 'ipc_query');
      return {
        success: true,
        messages: batch.messageIds.map((id: string, i: number) => ({
          id,
          promptPreview: batch.prompt.split('\n\n')[i + 1]?.slice(0, 100) ?? '',
        })),
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), messages: [] };
    }
  });

  // 10. learning:recordFeedback —— 记录用户反馈
  ipcMain.handle(
    'learning:recordFeedback',
    async (
      _event: IpcMainInvokeEvent,
      args: {
        sessionId: string;
        characterId?: string;
        agentResponse?: string;
        userComment?: string;
        kind: 'thumb_down' | 'low_rating' | 'comment' | 'correction';
        rating?: number;
      }
    ) => {
      const loop = await getFeedbackLoopSafely();
      if (!loop) return { success: false, error: 'Learning services not initialized' };
      try {
        const id = await loop.recordFeedback(args);
        return { success: true, id };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('learning:recordFeedback failed', msg);
        return { success: false, error: msg };
      }
    }
  );

  // 11. learning:runReflection —— 触发反馈反思
  ipcMain.handle(
    'learning:runReflection',
    async (
      _event: IpcMainInvokeEvent,
      args: { sessionId: string; agentResponse?: string; userComment?: string }
    ) => {
      const loop = await getFeedbackLoopSafely();
      if (!loop) return { success: false, error: 'Learning services not initialized' };
      try {
        const result = await loop.runReflection(args);
        return { success: true, result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('learning:runReflection failed', msg);
        return { success: false, error: msg };
      }
    }
  );
}

// ==================== 工具函数 ====================

/**
 * agent:run 返回类型（含 success 标志）。
 */
interface AgentRunFallbackResult {
  success: boolean;
  result?: AgentRunResult;
  error?: string;
}

/**
 * 获取工具提供方（ToolRegistry 单例）。
 *
 * 首次调用时注册：
 *  - updateStateTable 工具（占位 executor，模式接入时注入实际 executor）
 *  - 对话组工具（searchWorldbook / searchHistory / addMemoryNote，Task 16.1）
 *
 * 对话组工具通过 IDialogueToolServices 接口注入实际服务实现，
 * 复用现有 worldBookService / chatSessionRepository / memoryStore。
 */
function getToolProvider() {
  const registry = getToolRegistry();

  // 注册 updateStateTable 工具（若尚未注册）
  const hasUpdateStateTable = registry.listTools().some(t => t.name === 'updateStateTable');
  if (!hasUpdateStateTable) {
    const placeholderExecutor: ITableEditExecutor = {
      execute: async (_context, _commands) => ({
        success: false,
        executed: 0,
        errors: ['Table executor not yet wired for this mode. Tool is registered but execution requires mode-specific integration.'],
      }),
    };
    try {
      registerUpdateStateTableTool(registry, placeholderExecutor);
    } catch {
      // 工具可能已被注册（并发场景），忽略
    }
  }

  // 注册对话组工具（Task 16.1）
  const hasSearchWorldbook = registry.listTools().some(t => t.name === 'searchWorldbook');
  if (!hasSearchWorldbook) {
    try {
      registerDialogueTools(registry, createDialogueToolServices());
    } catch {
      // 工具可能已被注册（并发场景），忽略
    }
  }

  // 注册世界书组工具（Task 17.1）
  const hasCreateEntry = registry.listTools().some(t => t.name === 'createEntry');
  if (!hasCreateEntry) {
    try {
      registerWorldbookTools(registry, createWorldbookToolServices());
    } catch {
      // 工具可能已被注册（并发场景），忽略
    }
  }

  return registry;
}

/**
 * 创建对话组工具的服务实现（桥接现有服务）。
 *
 * 复用 worldBookService / chatSessionRepository / memoryStore，
 * 通过 IDialogueToolServices 接口注入，保持工具代码低耦合。
 */
function createDialogueToolServices(): IDialogueToolServices {
  return {
    // searchWorldbook: 复用 worldBookService 向量检索 + readWorldBook 条目读取
    searchWorldBookEntries: async (query, topK) => {
      try {
        const { worldBookService } = await import('../../services/worldBookService');
        return await worldBookService.searchWorldBookEntriesByVector(query, topK);
      } catch (err) {
        logger.warn('searchWorldBookEntries failed', err instanceof Error ? err.message : String(err));
        return [];
      }
    },

    readWorldBookEntry: async (filePath, entryUid) => {
      try {
        const { worldBookService } = await import('../../services/worldBookService');
        const worldBook = await worldBookService.readWorldBook(filePath);
        if (!worldBook?.entries) return null;
        const entry = worldBook.entries.find(
          (e: Record<string, unknown>) => String(e.uid || '') === entryUid
        );
        if (!entry) return null;
        return {
          name: String(entry.comment || entry.key || entryUid),
          content: String(entry.content || ''),
          comment: entry.comment ? String(entry.comment) : undefined,
        };
      } catch (err) {
        logger.warn('readWorldBookEntry failed', err instanceof Error ? err.message : String(err));
        return null;
      }
    },

    // searchHistory: 复用 chatLogService 关键词搜索（使用已初始化的 ctx）
    searchChatHistory: async (keyword, chatId) => {
      try {
        const { chatLogService } = await import('../../services/memory/chatLogService');
        const results = await chatLogService.searchChatMessages(keyword, chatId);
        return results.map((msg) => ({
          role: String(msg.role || 'unknown'),
          content: String(msg.content || ''),
          timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : undefined,
          chatId: typeof (msg as any).chatId === 'string' ? (msg as any).chatId : undefined,
        }));
      } catch (err) {
        logger.warn('searchChatHistory failed', err instanceof Error ? err.message : String(err));
        return [];
      }
    },

    // addMemoryNote: 复用 memoryStore 写入 agent 记忆
    addMemoryNote: async (content, metadata) => {
      try {
        const { getMemoryStore } = await import('../../services/agent/memory/memoryStore');
        let memoryStore;
        try {
          memoryStore = getMemoryStore();
        } catch {
          // memoryStore 未初始化（SQLite backend 不可用），降级返回成功但不持久化
          logger.warn('addMemoryNote: memoryStore not initialized, note will not be persisted');
          return { success: false, error: 'Memory store not initialized' };
        }
        const id = await memoryStore.write({
          type: 'agent',
          content,
          source: 'dialogue:addMemoryNote',
          metadata,
        });
        return { success: true, id };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn('addMemoryNote failed', errMsg);
        return { success: false, error: errMsg };
      }
    },
  };
}

/**
 * 创建世界书组工具的服务实现（桥接现有 worldBookService）。
 *
 * Task 17.1：世界书自驱工具（createEntry/expandFromContext/generateKeywords/sortEntries）
 * 复用 worldBookService 的 readWorldBook / writeWorldBook，
 * 通过 IWorldbookToolServices 接口注入，保持工具代码低耦合。
 *
 * 写入的条目均带 autoGenerated=true 标记，进入待审阅区（SubTask 17.2 UI）。
 */
function createWorldbookToolServices(): IWorldbookToolServices {
  return {
    readWorldBook: async (filePath) => {
      try {
        const { worldBookService } = await import('../../services/worldBookService');
        const worldBook = await worldBookService.readWorldBook(filePath);
        if (!worldBook) return null;
        // worldBookService.readWorldBook 返回的 entries 可能是 Record<string, entry>，
        // 统一转为数组形式以便工具层处理
        const entriesRaw = (worldBook as any).entries;
        let entriesArr: Array<Record<string, unknown>> | undefined;
        if (Array.isArray(entriesRaw)) {
          entriesArr = entriesRaw as Array<Record<string, unknown>>;
        } else if (entriesRaw && typeof entriesRaw === 'object') {
          entriesArr = Object.values(entriesRaw) as Array<Record<string, unknown>>;
        }
        return {
          name: (worldBook as any).name,
          description: (worldBook as any).description,
          entries: entriesArr,
        };
      } catch (err) {
        logger.warn('readWorldBook failed', err instanceof Error ? err.message : String(err));
        return null;
      }
    },

    writeWorldBook: async (filePath, data) => {
      try {
        const { worldBookService } = await import('../../services/worldBookService');
        // worldBookService.writeWorldBook 接受 Record<string, entry> 或 Array，
        // 内部 standardizeWorldBookContent 会重新分配 uid/id。
        // 为保留我们指定的 uid，将 entries 数组转回 Record（key=uid）
        let entriesToWrite = data.entries;
        if (Array.isArray(data.entries)) {
          const record: Record<string, Record<string, unknown>> = {};
          for (const e of data.entries) {
            const uid = String(e.uid ?? Object.keys(record).length + 1);
            record[uid] = e;
          }
          entriesToWrite = record;
        }
        const fullData = { ...data, entries: entriesToWrite };
        const result = await worldBookService.writeWorldBook(filePath, fullData);
        return { success: !!result.success, error: result.error };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn('writeWorldBook failed', errMsg);
        return { success: false, error: errMsg };
      }
    },

    getWorldBookDescription: async (filePath) => {
      try {
        const { worldBookService } = await import('../../services/worldBookService');
        const worldBook = await worldBookService.readWorldBook(filePath);
        return String((worldBook as any)?.description || '');
      } catch {
        return '';
      }
    },
  };
}

// ==================== 应用退出清理 ===================

/**
 * 取消所有活跃 agent run（应用退出时调用）。
 */
export function abortAllActiveAgentRuns(): void {
  for (const [senderId, run] of activeRuns) {
    try {
      run.agentCore.cancel();
      logger.info('Aborted active agent run on shutdown', undefined, { senderId });
    } catch (err) {
      logger.error('Failed to abort agent run on shutdown', err instanceof Error ? err.message : String(err));
    }
  }
  activeRuns.clear();
}

// ==================== Agent 模式管理 IPC ====================

/**
 * 注册 Agent 模式管理 IPC handler（3 个通道）。
 *
 * 通道：
 *  1. agent:isModeActive    - 查询 Agent 模式是否激活
 *  2. agent:getModeStatus   - 获取完整模式状态
 *  3. agent:setModeOverride - 设置覆盖开关并持久化到 settings.json
 */
function registerAgentModeHandlers(): void {
  // agent:isModeActive — 查询 Agent 模式是否激活
  ipcMain.handle('agent:isModeActive', async () => {
    try {
      return { ok: true, active: agentModeService.isAgentModeActive() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('agent:isModeActive failed', message);
      return { ok: false, error: message };
    }
  });

  // agent:getModeStatus — 获取完整模式状态
  ipcMain.handle('agent:getModeStatus', async () => {
    try {
      return { ok: true, status: agentModeService.getStatus() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('agent:getModeStatus failed', message);
      return { ok: false, error: message };
    }
  });

  // agent:setModeOverride — 设置覆盖开关
  ipcMain.handle(
    'agent:setModeOverride',
    async (_event: IpcMainInvokeEvent, args: { override: AgentModeOverride }) => {
      try {
        agentModeService.setOverride(args.override);

        // 持久化 override 到 settings.json，使重载后仍保持用户选择
        try {
          const storageService = getStorageService();
          const settings = storageService.getSettings();
          const activeEngineId = settings?.activeEngineId;
          const aiEngines = settings?.aiEngines;
          if (aiEngines && activeEngineId) {
            const activeEngine = aiEngines.find((e: any) => e.id === activeEngineId);
            if (activeEngine) {
              activeEngine.agentModeOverride = args.override;
              storageService.setSettings(settings);
            }
          }
        } catch (persistErr) {
          logger.warn(
            'Failed to persist agentModeOverride to settings',
            persistErr instanceof Error ? persistErr.message : String(persistErr),
          );
        }

        return { ok: true, status: agentModeService.getStatus() };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('agent:setModeOverride failed', message);
        return { ok: false, error: message };
      }
    },
  );

  logger.info('Agent mode handlers registered (3 channels)');
}

// ==================== Agent 配置管理 IPC ====================

/**
 * 广播 agent-config:changed 事件到所有渲染进程。
 *
 * 配置变更（update / toggle / updateSkills）成功后调用，
 * 通知所有窗口刷新智能体配置列表（useAgentConfigs 订阅此事件）。
 */
function broadcastConfigChanged(
  agentId: string,
  action: 'created' | 'updated' | 'deleted' | 'toggled' | 'skills-updated',
): void {
  const payload = { agentId, action };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('agent-config:changed', payload);
    }
  }
}

/**
 * 注册 Agent 配置管理 IPC handler（7 个通道）。
 *
 * 通道：
 *  1. agent-config:list          - 列出全部智能体配置
 *  2. agent-config:get           - 获取单个智能体配置
 *  3. agent-config:update        - 更新智能体配置（Partial<AgentConfig>）
 *  4. agent-config:toggle        - 切换智能体启用/禁用状态
 *  5. agent-config:updateSkills  - 更新技能白名单
 *  6. agent-config:create        - 创建用户自定义智能体（强制 isSystem: false）
 *  7. agent-config:delete        - 删除用户自定义智能体（系统预置不可删除）
 *
 * 【重点标记 - 参数结构陷阱】preload 将参数封装为对象（{ id } / { id, patch } /
 * { id, skills }），因此 handler 第二参数为对象而非位置参数。若按位置参数
 * （如 `(_event, id: string)`）接收，id 实际为 { id: '...' } 对象，
 * 会导致 agentConfigService.getById({...}) 类型与运行时错误。
 *
 * 【重点标记 - 服务方法名】agentConfigService 实际方法名为 list / getById /
 * update / toggleStatus / updateSkills，并非 listConfigs / getConfig /
 * updateConfig。调用错误的方法名会导致编译失败。
 *
 * 写操作成功后通过 broadcastConfigChanged 广播 agent-config:changed 事件。
 */
function registerAgentConfigHandlers(): void {
  // agent-config:list — 列出全部智能体配置
  ipcMain.handle('agent-config:list', async () => {
    try {
      const configs = await agentConfigService.list();
      return { ok: true, configs };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('agent-config:list failed', message);
      return { ok: false, error: message };
    }
  });

  // agent-config:get — 获取单个智能体配置
  ipcMain.handle(
    'agent-config:get',
    async (_event: IpcMainInvokeEvent, args: { id: string }) => {
      try {
        const config = await agentConfigService.getById(args.id);
        return { ok: true, config };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('agent-config:get failed', message);
        return { ok: false, error: message };
      }
    },
  );

  // agent-config:update — 更新智能体配置（Partial<AgentConfig>）
  ipcMain.handle(
    'agent-config:update',
    async (_event: IpcMainInvokeEvent, args: { id: string; patch: Partial<AgentConfig> }) => {
      try {
        const config = await agentConfigService.update(args.id, args.patch);
        broadcastConfigChanged(args.id, 'updated');
        return { ok: true, config };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('agent-config:update failed', message);
        return { ok: false, error: message };
      }
    },
  );

  // agent-config:toggle — 切换智能体启用/禁用状态
  ipcMain.handle(
    'agent-config:toggle',
    async (_event: IpcMainInvokeEvent, args: { id: string }) => {
      try {
        const config = await agentConfigService.toggleStatus(args.id);
        broadcastConfigChanged(args.id, 'toggled');
        return { ok: true, config };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('agent-config:toggle failed', message);
        return { ok: false, error: message };
      }
    },
  );

  // agent-config:updateSkills — 更新技能白名单
  ipcMain.handle(
    'agent-config:updateSkills',
    async (_event: IpcMainInvokeEvent, args: { id: string; skills: string[] }) => {
      try {
        const config = await agentConfigService.updateSkills(args.id, args.skills);
        broadcastConfigChanged(args.id, 'skills-updated');
        return { ok: true, config };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('agent-config:updateSkills failed', message);
        return { ok: false, error: message };
      }
    },
  );

  // agent-config:create — 创建用户自定义智能体
  ipcMain.handle(
    'agent-config:create',
    async (_event: IpcMainInvokeEvent, args: { config: Omit<AgentConfig, 'id' | 'createdAt' | 'updatedAt' | 'isSystem'> }) => {
      try {
        // 强制 isSystem: false，防止前端伪造系统预置智能体
        const config = await agentConfigService.create({
          ...args.config,
          isSystem: false,
        });
        broadcastConfigChanged(config.id, 'created');
        return { ok: true, config };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('agent-config:create failed', message);
        return { ok: false, error: message };
      }
    },
  );

  // agent-config:delete — 删除用户自定义智能体（系统预置不可删除，后端已有保护）
  ipcMain.handle(
    'agent-config:delete',
    async (_event: IpcMainInvokeEvent, args: { id: string }) => {
      try {
        await agentConfigService.delete(args.id);
        broadcastConfigChanged(args.id, 'deleted');
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('agent-config:delete failed', message);
        return { ok: false, error: message };
      }
    },
  );

  logger.info('Agent config handlers registered (7 channels)');
}

// ==================== Session 管理 IPC（Task 6） ====================

/**
 * 注册会话管理 IPC handler（7 个通道）。
 *
 * 通道：
 *  1. session:create       - 创建新会话
 *  2. session:list         - 列出当前角色所有会话
 *  3. session:switch       - 切换会话（更新 lastActiveAt）
 *  4. session:delete       - 删除会话（同时删除消息历史文件）
 *  5. session:rename       - 重命名会话标题
 *  6. session:saveMessages - 保存会话消息历史
 *  7. session:loadMessages - 加载会话消息历史
 *
 * 持久化路径：
 *  - 会话列表：{userDataPath}/sessions/{characterCardId}/sessions.json
 *  - 消息历史：{userDataPath}/sessions/{characterCardId}/{sessionId}.json
 */
function registerSessionHandlers(): void {
  // session:create — 创建新会话
  ipcMain.handle(
    'session:create',
    async (_event: IpcMainInvokeEvent, args: { characterCardId: string; title?: string }) => {
      try {
        const result = await createSession(args.characterCardId, args.title);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('session:create failed', message);
        return { success: false, error: message };
      }
    },
  );

  // session:list — 列出当前角色所有会话
  ipcMain.handle(
    'session:list',
    async (_event: IpcMainInvokeEvent, args: { characterCardId: string }) => {
      try {
        const result = await listSessions(args.characterCardId);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('session:list failed', message);
        return { success: false, sessions: [], error: message };
      }
    },
  );

  // session:switch — 切换会话
  ipcMain.handle(
    'session:switch',
    async (_event: IpcMainInvokeEvent, args: { characterCardId: string; sessionId: string }) => {
      try {
        const result = await switchSession(args.characterCardId, args.sessionId);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('session:switch failed', message);
        return { success: false, error: message };
      }
    },
  );

  // session:delete — 删除会话
  ipcMain.handle(
    'session:delete',
    async (_event: IpcMainInvokeEvent, args: { characterCardId: string; sessionId: string }) => {
      try {
        const result = await deleteSession(args.characterCardId, args.sessionId);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('session:delete failed', message);
        return { success: false, error: message };
      }
    },
  );

  // session:rename — 重命名会话标题
  ipcMain.handle(
    'session:rename',
    async (
      _event: IpcMainInvokeEvent,
      args: { characterCardId: string; sessionId: string; newTitle: string },
    ) => {
      try {
        const result = await renameSession(args.characterCardId, args.sessionId, args.newTitle);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('session:rename failed', message);
        return { success: false, error: message };
      }
    },
  );

  // session:saveMessages — 保存会话消息历史
  ipcMain.handle(
    'session:saveMessages',
    async (
      _event: IpcMainInvokeEvent,
      args: {
        characterCardId: string;
        sessionId: string;
        messages: Array<{ role: string; content: string; timestamp?: number; [key: string]: unknown }>;
      },
    ) => {
      try {
        const result = await saveSessionMessages(
          args.characterCardId,
          args.sessionId,
          args.messages,
        );
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('session:saveMessages failed', message);
        return { success: false, error: message };
      }
    },
  );

  // session:loadMessages — 加载会话消息历史
  ipcMain.handle(
    'session:loadMessages',
    async (_event: IpcMainInvokeEvent, args: { characterCardId: string; sessionId: string }) => {
      try {
        const result = await loadSessionMessages(args.characterCardId, args.sessionId);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('session:loadMessages failed', message);
        return { success: false, messages: [], error: message };
      }
    },
  );

  logger.info('Session handlers registered (7 channels)');
}

/**
 * 根据当前 settings 重新评估 Agent 模式状态。
 *
 * 供 settingHandlers 在保存设置后调用，确保引擎切换或能力更新后
 * agentModeService 状态与缓存的能力清单保持同步。
 */
export function reevaluateAgentModeFromSettings(settings: any): void {
  try {
    const activeEngineId = settings?.activeEngineId;
    const aiEngines = settings?.aiEngines;
    if (aiEngines && activeEngineId) {
      const activeEngine = aiEngines.find((e: any) => e.id === activeEngineId);
      if (activeEngine) {
        agentModeService.reevaluate({
          useAgent: activeEngine.useAgent ?? false,
          agentModeOverride: activeEngine.agentModeOverride ?? 'auto',
          capabilities: activeEngine.capabilities,
        });
      }
    }
  } catch (err) {
    logger.warn('reevaluateAgentModeFromSettings failed', err instanceof Error ? err.message : String(err));
  }
}

// ==================== 故障转移 IPC（Task 10） ====================

/**
 * 故障转移事件类型。
 */
export interface FailoverEvent {
  /** 事件类型：retry（重试）/ switch（切换 provider） */
  type: 'retry' | 'switch';
  /** 原 provider 标识 */
  fromProvider?: string;
  /** 目标 provider 标识 */
  toProvider?: string;
  /** 目标模型名称 */
  toModel?: string;
  /** 故障原因（错误消息） */
  reason: string;
  /** 重试次数（type=retry 时有效） */
  attempt?: number;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 广播故障转移事件到所有渲染窗口。
 *
 * 当发生重试或 provider 切换时调用，前端通过 `ai:failover` 事件订阅，
 * 展示 toast 通知（如"已切换到备用模型 {model}"）。
 *
 * @param event 故障转移事件详情
 */
export function broadcastFailoverEvent(event: FailoverEvent): void {
  logger.info('Failover event broadcast', undefined, event);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('ai:failover', event);
    }
  }
}

/**
 * 注册故障转移相关 IPC handler（Task 10.5）。
 *
 * 2 个 IPC 通道 + 1 个事件广播：
 *  1. ai:getFallbackProviders - 获取备用 provider 列表（ipcMain.handle）
 *  2. ai:setFallbackProviders - 设置备用 provider 列表（ipcMain.handle）
 *  3. ai:failover             - 故障转移事件广播（broadcastFailoverEvent 推送）
 */
function registerFailoverHandlers(): void {
  // ai:getFallbackProviders — 获取备用 provider 列表
  ipcMain.handle('ai:getFallbackProviders', async () => {
    try {
      const providers = aiConfigProvider.getFallbackProviders();
      return { success: true, providers };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('ai:getFallbackProviders failed', message);
      return { success: false, providers: [], error: message };
    }
  });

  // ai:setFallbackProviders — 设置备用 provider 列表
  ipcMain.handle(
    'ai:setFallbackProviders',
    async (_event: IpcMainInvokeEvent, args: { providers: FallbackProvider[] }) => {
      try {
        aiConfigProvider.setFallbackProviders(args.providers);
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('ai:setFallbackProviders failed', message);
        return { success: false, error: message };
      }
    },
  );

  logger.info('Failover handlers registered (2 channels + 1 broadcast event)');
}
