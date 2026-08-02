/**
 * WorldBookAgent IPC Handlers —— 世界书编写智能体编排 IPC 通道
 *
 * 来源：spec §二 Task 5.1（`implement-worldbook-authoring-agent`）
 * 决策：自研（spec §三无对应 openclaw 文件）。
 *
 * 5 个 IPC 通道（ipcMain.handle）：
 *  1. worldbookAgent:run      - 启动编写会话（入参 {userPrompt, worldBookPath, allowedWorldBookPaths, config?}）
 *  2. worldbookAgent:cancel   - 取消会话（入参 {sessionId}）
 *  3. worldbookAgent:status   - 查询状态（入参 {sessionId?}；无 sessionId 返回所有活跃会话）
 *  4. worldbookAgent:resume   - 续跑会话（入参 {sessionId}）
 *  5. worldbookAgent:answer   - 回答澄清问题（入参 {sessionId, answers}）
 *
 * 事件流推送（webContents.send）：
 *  - worldbookAgent:progress  - 编写进度事件（含 phase / currentDimension / entriesGenerated 等）
 *    clarify 事件包含在 phase='planning_clarifying' 的 progress 事件中（携带 clarifyingQuestions）
 *
 * 设计约束：
 *  - Agent 模式硬约束（spec §Requirement: Agent 模式硬约束）：
 *    每个 handler 入口校验 `useAgent && supportsToolCalling`，
 *    不满足时返回 `{ ok: false, error: 'AGENT_MODE_DISABLED' }`
 *  - 单实例守卫：worldbookAuthoringService 内部已实现 worldBookPath 单实例守卫
 *  - 取消支持：前端可随时调用 worldbookAgent:cancel
 *  - 断点续跑：worldbookAuthoringService.resumeSession 从 MemoryStore 恢复
 *
 * 参考模式：`writing/writingAgentHandlers.ts`（run/cancel/status/resume + progress 事件流）
 * 差异：
 *  - 新增 answer 通道（PLANNING 阶段回答澄清问题）
 *  - status 通道支持无 sessionId 查询全部活跃会话
 *  - 入口 Agent 模式 gating（writingAgentHandlers 无此守卫）
 */

import { ipcMain, type IpcMainInvokeEvent, BrowserWindow } from 'electron';
import {
  getWorldBookAuthoringService,
  getWorldBookAuthoringServiceSync,
} from '../../../services/agent/worldbook/worldbookAuthoringService';
import { agentModeService } from '../../../services/agent/management';
import { createLogger } from '../../../services/logger';
import type {
  WorldBookAuthoringRunRequest,
  WorldBookAuthoringRunResult,
  WorldBookAuthoringConfig,
  WorldBookAuthoringProgressCallback,
} from '../../../services/agent/worldbook/worldbookAuthoringTypes';
import type { AuthoringProgressEvent } from '../../../../shared/types/worldbook-authoring.types';
import { DEFAULT_AUTHORING_CONFIG } from '../../../../shared/types/worldbook-authoring.types';

const logger = createLogger('worldbook-agent-handlers');

// ==================== Agent 模式 gating ====================

/**
 * Agent 模式 gating 结果（spec §Requirement: Agent 模式硬约束）。
 */
interface AgentGateResult {
  ok: boolean;
  error?: 'AGENT_MODE_DISABLED';
  reason?: string;
}

/**
 * 校验 Agent 模式 gating（Task 10: 统一使用 agentModeService.isAgentModeActive()）。
 *
 * agentModeService 内部已整合 override（auto/force-on/force-off）+ supportsToolCalling
 * 双条件判定，无需在此重复读取设置或探测能力。
 *
 * 未激活时返回 `{ ok: false, error: 'AGENT_MODE_DISABLED' }`，
 * handler 应立即返回此结果，不执行后续业务逻辑。
 *
 * @returns AgentGateResult
 */
async function checkAgentGate(): Promise<AgentGateResult> {
  try {
    if (!agentModeService.isAgentModeActive()) {
      return {
        ok: false,
        error: 'AGENT_MODE_DISABLED',
        reason: 'Agent 模式未激活',
      };
    }
    return { ok: true };
  } catch (err) {
    logger.error(
      'Agent gate: check failed',
      err instanceof Error ? err.message : String(err)
    );
    return {
      ok: false,
      error: 'AGENT_MODE_DISABLED',
      reason: 'Agent 模式校验异常',
    };
  }
}

// ==================== 获取 webContents ====================

/**
 * 获取首个浏览器窗口的 webContents（用于在 run handler 之外推送事件）。
 *
 * writingAgentHandlers 直接使用 event.sender.send；worldbookAgent 也优先使用 event.sender。
 * 此辅助函数仅作为兜底（理论上不会调用，因为 run handler 一定有 event.sender）。
 */
function getFirstWebContents(): Electron.WebContents | null {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) return null;
  const win = windows[0];
  if (win.isDestroyed()) return null;
  return win.webContents;
}

// ==================== IPC 通道注册 ====================

/**
 * 注册世界书编写智能体 IPC handler。
 *
 * 在 `worldBookHandlers.ts` 中聚合调用（参考 writingHandlers.ts 调用 registerWritingAgentHandlers）。
 */
export function registerWorldBookAgentHandlers(): void {
  registerRunHandler();
  registerCancelHandler();
  registerStatusHandler();
  registerResumeHandler();
  registerAnswerHandler();

  logger.info(
    'WorldBook agent IPC handlers registered (5 channels + progress stream)'
  );
}

// ==================== worldbookAgent:run ====================

/**
 * worldbookAgent:run 通道。
 *
 * 启动编写会话：
 *  1. Agent 模式 gating（useAgent && supportsToolCalling）
 *  2. 调用 worldbookAuthoringService.run({..., onProgress: 桥接到 webContents.send})
 *  3. 进度事件通过 event.sender.send('worldbookAgent:progress', event) 实时推送
 *
 * 入参字段：
 *  - userPrompt: 用户初始提示
 *  - worldBookPath: 主世界书绝对路径
 *  - allowedWorldBookPaths?: 沙盒白名单（默认 [worldBookPath]）
 *  - config?: 编写配置（未提供时使用 DEFAULT_AUTHORING_CONFIG + 当前 AI 引擎 LLM 配置）
 */
function registerRunHandler(): void {
  ipcMain.handle(
    'worldbookAgent:run',
    async (
      event: IpcMainInvokeEvent,
      request: {
        userPrompt: string;
        worldBookPath: string;
        allowedWorldBookPaths?: string[];
        config?: WorldBookAuthoringConfig;
      }
    ) => {
      // Agent 模式 gating
      const gate = await checkAgentGate();
      if (!gate.ok) {
        return {
          ok: false,
          error: gate.error,
          reason: gate.reason,
        } as WorldBookAgentRunResponse;
      }

      try {
        const service = await getWorldBookAuthoringService();

        // 构造进度回调：桥接到渲染进程事件流
        const onProgress: WorldBookAuthoringProgressCallback = (
          progressEvent: AuthoringProgressEvent
        ) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('worldbookAgent:progress', progressEvent);
          }
        };

        // 构造运行请求
        const runRequest: WorldBookAuthoringRunRequest = {
          userPrompt: request.userPrompt,
          worldBookPath: request.worldBookPath,
          allowedWorldBookPaths:
            request.allowedWorldBookPaths ?? [request.worldBookPath],
          config: (request.config ?? DEFAULT_AUTHORING_CONFIG) as WorldBookAuthoringConfig,
          onProgress,
        };

        logger.info('WorldBook agent run started', undefined, {
          worldBookPath: request.worldBookPath,
          userPromptPreview: request.userPrompt.slice(0, 60),
        });

        const result = await service.run(runRequest);

        return {
          ok: true,
          result,
        } as WorldBookAgentRunResponse;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('WorldBook agent run failed', message);
        return {
          ok: false,
          error: 'RUN_FAILED',
          reason: message,
        } as WorldBookAgentRunResponse;
      }
    }
  );
}

// ==================== worldbookAgent:cancel ====================

/**
 * worldbookAgent:cancel 通道。
 *
 * 取消指定会话：调用 worldbookAuthoringService.cancel(sessionId)。
 * 已生成的草稿条目保留（spec §Requirement: 断点续跑与取消）。
 */
function registerCancelHandler(): void {
  ipcMain.handle(
    'worldbookAgent:cancel',
    async (_event: IpcMainInvokeEvent, args: { sessionId: string }) => {
      // Agent 模式 gating
      const gate = await checkAgentGate();
      if (!gate.ok) {
        return { ok: false, error: gate.error, reason: gate.reason };
      }

      const sessionId = args?.sessionId;
      if (!sessionId) {
        return { ok: false, error: 'INVALID_ARGS', reason: 'sessionId 必填' };
      }

      try {
        // 优先用同步单例（可能未初始化，此时无会话可取消）
        const service = getWorldBookAuthoringServiceSync();
        if (!service) {
          return {
            ok: false,
            error: 'NO_ACTIVE_SESSION',
            reason: '编排服务未初始化，无活跃会话',
          };
        }

        const cancelled = service.cancel(sessionId);
        if (!cancelled) {
          return {
            ok: false,
            error: 'SESSION_NOT_FOUND',
            reason: `会话 ${sessionId} 不存在或已结束`,
          };
        }

        // 推送取消事件到渲染进程（若 webContents 可用）
        const webContents = getFirstWebContents();
        if (webContents && !webContents.isDestroyed()) {
          webContents.send('worldbookAgent:progress', {
            phase: 'cancelled',
            entriesGenerated: 0,
            targetEntries: 0,
            currentActivity: '会话已取消',
            message: `会话 ${sessionId} 已取消`,
            timestamp: Date.now(),
          } as AuthoringProgressEvent);
        }

        logger.info('WorldBook agent cancelled', undefined, { sessionId });
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('WorldBook agent cancel failed', message);
        return { ok: false, error: 'CANCEL_FAILED', reason: message };
      }
    }
  );
}

// ==================== worldbookAgent:status ====================

/**
 * worldbookAgent:status 通道。
 *
 * 查询会话状态：
 *  - 入参 {sessionId}：返回单个会话状态
 *  - 入参无 sessionId（或为 undefined）：返回所有活跃会话摘要
 *
 * 注：worldbookAuthoringService 暂未提供"列出全部会话"接口，
 *     此处对无 sessionId 的场景返回 { ok: true, sessions: [] }（占位），
 *     单会话查询走 getSessionStatus(sessionId)。
 */
function registerStatusHandler(): void {
  ipcMain.handle(
    'worldbookAgent:status',
    async (
      _event: IpcMainInvokeEvent,
      args?: { sessionId?: string }
    ) => {
      // Agent 模式 gating
      const gate = await checkAgentGate();
      if (!gate.ok) {
        return { ok: false, error: gate.error, reason: gate.reason };
      }

      try {
        const service = getWorldBookAuthoringServiceSync();
        if (!service) {
          // 服务未初始化：无 sessionId 返回空列表；有 sessionId 返回 not found
          if (!args?.sessionId) {
            return { ok: true, sessions: [] };
          }
          return {
            ok: false,
            error: 'SESSION_NOT_FOUND',
            reason: '编排服务未初始化',
          };
        }

        // 无 sessionId：返回所有活跃会话（占位为空数组，待 service 提供列表接口）
        if (!args?.sessionId) {
          // 注：worldbookAuthoringService 当前未暴露 listSessions，
          //     此处保守返回空数组，前端可通过其他途径（如 memoryStore.search）查询历史会话。
          return { ok: true, sessions: [] };
        }

        // 有 sessionId：查询单会话状态
        const status = service.getSessionStatus(args.sessionId);
        if (!status.found) {
          return {
            ok: false,
            error: 'SESSION_NOT_FOUND',
            reason: `会话 ${args.sessionId} 不存在`,
          };
        }

        return {
          ok: true,
          session: status.session,
          state: status.state,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('WorldBook agent status failed', message);
        return { ok: false, error: 'STATUS_FAILED', reason: message };
      }
    }
  );
}

// ==================== worldbookAgent:resume ====================

/**
 * worldbookAgent:resume 通道。
 *
 * 从断点恢复会话：调用 worldbookAuthoringService.resumeSession(sessionId, {onProgress, signal})。
 * 进度事件继续通过 event.sender.send('worldbookAgent:progress', event) 推送。
 */
function registerResumeHandler(): void {
  ipcMain.handle(
    'worldbookAgent:resume',
    async (
      event: IpcMainInvokeEvent,
      args: { sessionId: string }
    ) => {
      // Agent 模式 gating
      const gate = await checkAgentGate();
      if (!gate.ok) {
        return {
          ok: false,
          error: gate.error,
          reason: gate.reason,
        } as WorldBookAgentRunResponse;
      }

      const sessionId = args?.sessionId;
      if (!sessionId) {
        return {
          ok: false,
          error: 'INVALID_ARGS',
          reason: 'sessionId 必填',
        } as WorldBookAgentRunResponse;
      }

      try {
        const service = await getWorldBookAuthoringService();

        // 构造进度回调：桥接到渲染进程事件流
        const onProgress: WorldBookAuthoringProgressCallback = (
          progressEvent: AuthoringProgressEvent
        ) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('worldbookAgent:progress', progressEvent);
          }
        };

        logger.info('WorldBook agent resume started', undefined, { sessionId });

        const result = await service.resumeSession(sessionId, { onProgress });

        return {
          ok: true,
          result,
        } as WorldBookAgentRunResponse;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('WorldBook agent resume failed', message);
        return {
          ok: false,
          error: 'RESUME_FAILED',
          reason: message,
        } as WorldBookAgentRunResponse;
      }
    }
  );
}

// ==================== worldbookAgent:answer ====================

/**
 * worldbookAgent:answer 通道。
 *
 * 回答 PLANNING 阶段的澄清问题：调用 worldbookAuthoringService.submitAnswers(sessionId, answers)。
 *
 * 触发场景：
 *  - 编排服务进入 PLANNING 阶段，通过 progress 事件推送 phase='planning_clarifying' +
 *    clarifyingQuestions（携带问题列表）
 *  - 前端展示问题，用户回答后调用本通道提交答案
 *  - 编排服务中等待中的 Promise 被 resolve，继续 buildPlan 流程
 *
 * 注：若 10 分钟超时未回答，编排服务自动将所有未回答问题标记为 skipped 并继续。
 */
function registerAnswerHandler(): void {
  ipcMain.handle(
    'worldbookAgent:answer',
    async (
      _event: IpcMainInvokeEvent,
      args: {
        sessionId: string;
        answers: Array<{
          questionId: string;
          answer?: string;
          skipped: boolean;
        }>;
      }
    ) => {
      // Agent 模式 gating
      const gate = await checkAgentGate();
      if (!gate.ok) {
        return { ok: false, error: gate.error, reason: gate.reason };
      }

      const sessionId = args?.sessionId;
      if (!sessionId) {
        return { ok: false, error: 'INVALID_ARGS', reason: 'sessionId 必填' };
      }
      if (!Array.isArray(args?.answers)) {
        return {
          ok: false,
          error: 'INVALID_ARGS',
          reason: 'answers 必须为数组',
        };
      }

      try {
        const service = getWorldBookAuthoringServiceSync();
        if (!service) {
          return {
            ok: false,
            error: 'NO_ACTIVE_SESSION',
            reason: '编排服务未初始化',
          };
        }

        const accepted = await service.submitAnswers(sessionId, args.answers);
        if (!accepted) {
          return {
            ok: false,
            error: 'NOT_AWAITING_ANSWERS',
            reason: `会话 ${sessionId} 不存在或未在等待澄清问题回答`,
          };
        }

        logger.info('WorldBook agent answers submitted', undefined, {
          sessionId,
          answerCount: args.answers.length,
        });

        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('WorldBook agent answer failed', message);
        return { ok: false, error: 'ANSWER_FAILED', reason: message };
      }
    }
  );
}

// ==================== 应用退出清理 ====================

/**
 * 取消所有活跃的世界书编写智能体会话（应用退出时调用）。
 *
 * 与 writingAgentHandlers.abortActiveWritingAgent 对齐。
 */
export function abortActiveWorldBookAgent(): void {
  try {
    const service = getWorldBookAuthoringServiceSync();
    if (!service) return;
    // 注：worldbookAuthoringService 单例在 run 时由 pathToSession 守卫；
    //     退出时仅触发内存清理，未持久化的运行时状态会被丢弃。
    //     已持久化的 session 可通过 resumeSession 恢复。
    // 此处保守不调用具体方法（service 暂未暴露 listActiveSessions），
    // 由 service 内部 sessionTimeout 兜底处理。
    logger.info('Abort active WorldBook agent on shutdown (best-effort)');
  } catch (err) {
    logger.warn(
      'Failed to abort WorldBook agent on shutdown',
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ==================== 响应类型 ====================

/**
 * run / resume handler 的响应类型。
 */
interface WorldBookAgentRunResponse {
  ok: boolean;
  /** 错误码（ok=false 时存在） */
  error?:
    | 'AGENT_MODE_DISABLED'
    | 'RUN_FAILED'
    | 'RESUME_FAILED'
    | 'INVALID_ARGS';
  /** 错误原因（人类可读） */
  reason?: string;
  /** 运行结果（ok=true 时存在） */
  result?: WorldBookAuthoringRunResult;
}
