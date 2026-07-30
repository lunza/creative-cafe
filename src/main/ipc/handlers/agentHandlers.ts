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

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { AIService } from '../../services/AIService';
import { createLogger } from '../../services/logger';
import type { AgentRunIntent, AgentRunResult, ToolCallContext } from '../../services/agent/contracts';
import { AgentCore } from '../../services/agent/core/agentCore';
import { AIServiceAdapter } from '../../services/agent/llm/llmProvider';
import { CapabilityDetector, CONSERVATIVE_FALLBACK } from '../../services/agent/llm/capabilityDetector';
import { getToolRegistry, registerUpdateStateTableTool, registerDialogueTools, registerWorldbookTools, type ITableEditExecutor, type IDialogueToolServices, type IWorldbookToolServices } from '../../services/agent/tools';
import { initAgentBackendIfNeeded } from '../../services/agent/memory/sqliteBackend';

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
      } else {
        logger.warn('Agent SQLite backend unavailable (degrading: memory:search returns empty, embedding cache in-memory only, learning module disabled)');
      }
    })
    .catch((err) => {
      logger.warn('Agent SQLite backend init failed (degrading)', err instanceof Error ? err.message : String(err));
    });

  logger.info('Agent IPC handlers registered (17 channels)');
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
      const agentCore = new AgentCore({
        llmProvider,
        toolProvider: getToolProvider(),
        capabilities,
        maxIterations: intent.maxIterations,
        timeoutMs: intent.timeoutMs,
        onTextChunk: (chunk) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('agent:token', { chunk, timestamp: Date.now() });
          }
        },
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
 * 技能系统在阶段 3 实现（Task 14），此处注册占位 handler，
 * 返回「技能系统尚未初始化」提示，避免渲染进程调用时无响应。
 */
function registerSkillHandlers(): void {
  ipcMain.handle('skill:list', async () => {
    // 阶段 3 接入：调用 skillRegistry.list()
    return { success: true, skills: [] as Array<{ name: string; title?: string; description?: string }> };
  });

  ipcMain.handle('skill:invoke', async (
    _event: IpcMainInvokeEvent,
    _args: { skillName: string; args: Record<string, unknown>; context?: ToolCallContext }
  ) => {
    // 阶段 3 接入：调用 skillRegistry.invoke()
    return {
      success: false,
      error: 'Skill system not yet initialized (planned for phase 3)',
    };
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
