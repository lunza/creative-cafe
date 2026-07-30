/**
 * 超时控制 —— 适配 openclaw packages/agent-core/src/agent.ts 超时与 abort 理念
 *
 * 来源：g:\AI\creative-cafe\sillytavern-source\openclaw-main\packages\agent-core\src\agent.ts
 *       （L362-L370 abort / signal / runWithLifecycle）
 * 决策：适配（spec §三）。openclaw 通过 AbortController + signal 串联整条调用链；
 *       本项目照搬其 abort 模型，但简化为 agentLoop 单次运行的超时管理器。
 *
 * 职责：
 *  1. resolveAgentTimeoutMs：解析最终超时值（intent 覆盖 > 默认）
 *  2. AgentTimeoutController：封装 AbortController + 超时定时器 + 主动取消
 *  3. 支持外部 abortSignal 串联（如父任务取消时子任务一并取消）
 *
 * 设计约束（openclaw AGENTS.md）：
 *  - 取消立即生效：abort 后循环在下一次 checkpoint 检查 signal.aborted
 *  - 超时与主动取消共用 abort 通道（区分 reason 便于日志）
 *  - finally 必须清理定时器，避免 Node 进程悬挂
 *  - 不阻塞空闲进程退出（timer.unref）
 */

import { AgentError } from '../infra/errors';

// ==================== 默认值 ====================

/**
 * Agent 运行默认超时（5 分钟，与 ChatEngine 对齐）。
 */
export const DEFAULT_AGENT_TIMEOUT_MS = 300_000;

/**
 * Agent 最小超时下限（1 秒，防止误传 0 或负值导致立即超时）。
 */
export const MIN_AGENT_TIMEOUT_MS = 1_000;

/**
 * Agent 最大超时上限（30 分钟，防止误传超大值导致进程长期悬挂）。
 */
export const MAX_AGENT_TIMEOUT_MS = 1_800_000;

// ==================== 超时解析 ====================

/**
 * 超时解析选项。
 */
export interface TimeoutResolutionOptions {
  /** 默认超时（来自 AgentLoop 配置） */
  defaultMs: number;
  /** 显式覆盖（来自 AgentRunIntent.timeoutMs） */
  overrideMs?: number;
}

/**
 * 解析最终超时值。
 *
 * 优先级：overrideMs（若为有效正整数）> defaultMs > DEFAULT_AGENT_TIMEOUT_MS
 * 结果会被 clamp 到 [MIN_AGENT_TIMEOUT_MS, MAX_AGENT_TIMEOUT_MS]。
 *
 * @returns 最终超时毫秒数
 */
export function resolveAgentTimeoutMs(options: TimeoutResolutionOptions): number {
  const candidate =
    Number.isFinite(options.overrideMs) && (options.overrideMs ?? 0) > 0
      ? (options.overrideMs as number)
      : options.defaultMs || DEFAULT_AGENT_TIMEOUT_MS;
  return Math.min(
    Math.max(Math.floor(candidate), MIN_AGENT_TIMEOUT_MS),
    MAX_AGENT_TIMEOUT_MS
  );
}

// ==================== 超时控制器 ====================

/**
 * Agent 运行超时原因。
 * 用于区分「主动取消」与「超时触发」，便于日志与 UI 反馈。
 */
export type AbortReason = 'timeout' | 'cancelled' | 'external';

/**
 * Agent 超时控制器。
 *
 * 封装 AbortController + 超时定时器，提供统一的取消/超时入口。
 * 参考openclaw Agent.abort() / Agent.signal 设计：
 *  - signal：暴露给 agentLoop 用于检查取消状态
 *  - abort(reason)：主动取消（用户取消按钮）
 *  - 超时自动触发 abort('timeout')
 *
 * 用法：
 * ```ts
 * const ctrl = new AgentTimeoutController({ timeoutMs: 60_000 });
 * try {
 *   await agentLoop.run(intent, ctrl.signal);
 * } finally {
 *   ctrl.dispose(); // 必须清理定时器
 * }
 * ```
 */
export class AgentTimeoutController {
  private readonly abortController: AbortController;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** 当前 abort 原因（aborted 后填充） */
  private abortedReason: AbortReason | undefined;

  constructor(options: { timeoutMs: number; externalSignal?: AbortSignal }) {
    this.abortController = new AbortController();

    // 串联外部 signal：父任务取消时联动取消当前 agent
    if (options.externalSignal) {
      this.attachExternal(options.externalSignal);
    }

    // 启动超时定时器
    if (options.timeoutMs > 0) {
      this.timeoutHandle = setTimeout(() => {
        this.abort('timeout');
      }, options.timeoutMs);
      // 不阻塞空闲进程退出
      (this.timeoutHandle as unknown as { unref?: () => void })?.unref?.();
    }
  }

  /** 当前 abort signal（agentLoop 用于检查取消状态） */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /** 是否已取消/超时 */
  get aborted(): boolean {
    return this.abortController.signal.aborted;
  }

  /** abort 原因（未 abort 时为 undefined） */
  get reason(): AbortReason | undefined {
    return this.abortedReason;
  }

  /**
   * 主动取消。
   * @param reason 取消原因（默认 'cancelled'）
   */
  abort(reason: AbortReason = 'cancelled'): void {
    if (this.aborted || this.disposed) return;
    this.abortedReason = reason;
    const msg = reason === 'timeout' ? 'agent timeout' : `agent ${reason}`;
    this.abortController.abort(new Error(msg));
    this.clearTimer();
  }

  /**
   * 释放资源（清理定时器）。
   *
   * 必须在 agentLoop 结束后调用（finally 块），避免定时器悬挂。
   * 不会触发 abort，仅清理。
   */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  /**
   * 串联外部 signal。
   *
   * 父任务取消时联动取消当前 agent。一次性监听，触发后自动解绑。
   */
  private attachExternal(externalSignal: AbortSignal): void {
    if (externalSignal.aborted) {
      // 外部已取消，立即联动
      this.abort('external');
      return;
    }
    const onExternalAbort = () => {
      this.abort('external');
      externalSignal.removeEventListener('abort', onExternalAbort);
    };
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  private clearTimer(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }
}

// ==================== 便捷工具 ====================

/**
 * 检查 abort signal 是否已取消，若取消则抛出 AgentError。
 *
 * agentLoop 在每次迭代开始时调用，避免取消后继续执行无谓的 LLM 调用。
 *
 * @throws AgentError(category='timeout', retryable=true)
 */
export function throwIfAborted(signal?: AbortSignal, message = 'Agent 已被取消或超时'): void {
  if (signal?.aborted) {
    throw new AgentError(message, {
      category: 'timeout',
      retryable: true,
      cause: (signal as unknown as { reason?: unknown }).reason,
    });
  }
}
