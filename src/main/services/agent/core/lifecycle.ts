/**
 * Agent 生命周期管理 —— 适配 openclaw runWithLifecycle / processEvents 理念
 *
 * 来源：g:\AI\creative-cafe\sillytavern-source\openclaw-main\packages\agent-core\src\agent.ts
 *       （L538-L581 runWithLifecycle / finishRun / handleRunFailure / processEvents）
 * 决策：适配（spec §三）。openclaw 通过 runWithLifecycle 包装 executor，
 *       统一管理 isStreaming / activeRun / 事件分发。本项目照搬其生命周期模型，
 *       简化为单实例 AgentLifecycle（无并发 run，spec §二 maxIterations=8 单循环）。
 *
 * 职责：
 *  1. AgentLifecycleState：生命周期状态（idle / running / stopping / error）
 *  2. AgentLifecycle：封装 run() 入口，统一管理状态转换与事件分发
 *  3. 事件系统：agent_start / turn_start / tool_call / turn_end / agent_end
 *  4. 单 run 守卫：同一时刻仅允许一个 run（openclaw 抛错，本项目排队或拒绝）
 *
 * 设计约束（openclaw AGENTS.md）：
 *  - 生命周期事件是 prompt：监听器通过事件感知 agent 状态，无需轮询
 *  - 失败不静默：run 失败时分发 error 事件，调用方可感知
 *  - finally 必须重置状态：避免生命周期卡在 running
 */

import { toAgentError, AgentError } from '../infra/errors';

// ==================== 生命周期状态 ====================

/**
 * Agent 生命周期状态。
 *
 * 状态转换：
 *   idle ──run()──→ running ──abort()──→ stopping ──→ idle
 *    ↑                  │
 *    │                  └──error──→ error ──run()──→ running
 *    └──────────────────────done──────────────────────┘
 */
export type AgentLifecycleState = 'idle' | 'running' | 'stopping' | 'error';

/**
 * 生命周期事件类型。
 *
 * 参考 openclaw AgentEvent，简化为本项目所需的事件子集：
 *  - agent_start: run 开始
 *  - turn_start: 单轮 LLM 调用开始
 *  - tool_call: 工具调用（start / end）
 *  - turn_end: 单轮结束（含 LLM 输出或工具结果）
 *  - agent_end: run 结束（含最终结果或错误）
 *  - error: 运行错误（不导致 agent_end，仅通知）
 */
export type AgentLifecycleEvent =
  | { type: 'agent_start'; timestamp: number }
  | { type: 'turn_start'; iteration: number; timestamp: number }
  | {
      type: 'tool_call';
      name: string;
      args: Record<string, unknown>;
      phase: 'start' | 'end';
      result?: unknown;
      durationMs?: number;
      timestamp: number;
    }
  | {
      type: 'turn_end';
      iteration: number;
      finishReason?: string;
      timestamp: number;
    }
  | {
      type: 'agent_end';
      finishReason: string;
      iterations: number;
      error?: string;
      timestamp: number;
    }
  | { type: 'error'; error: AgentError; timestamp: number };

/**
 * 生命周期事件监听器。
 */
export type LifecycleListener = (event: AgentLifecycleEvent) => void | Promise<void>;

// ==================== AgentLifecycle ====================

/**
 * Agent 生命周期管理器。
 *
 * 封装 run() 入口，统一管理状态转换与事件分发。
 * agentLoop 通过 lifecycle.emit() 推送事件，外部通过 lifecycle.on() 监听。
 *
 * 单 run 守卫：同一时刻仅允许一个 run，并发 run 抛错（参考 openclaw Agent.prompt）。
 */
export class AgentLifecycle {
  private state: AgentLifecycleState = 'idle';
  private readonly listeners = new Set<LifecycleListener>();
  private currentRunAbort: AbortController | null = null;
  /** 当前 run 的开始时间戳（用于耗时统计） */
  private currentRunStartedAt: number | null = null;

  /** 当前状态 */
  get currentState(): AgentLifecycleState {
    return this.state;
  }

  /** 是否正在运行 */
  get isRunning(): boolean {
    return this.state === 'running' || this.state === 'stopping';
  }

  /** 当前 run 的 AbortSignal（用于串联子任务） */
  get signal(): AbortSignal | undefined {
    return this.currentRunAbort?.signal;
  }

  /**
   * 注册事件监听器。
   * @returns 取消注册函数
   */
  on(listener: LifecycleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 分发事件。
   *
   * 监听器按注册顺序同步调用（async 监听器不阻塞，错误不传播）。
   */
  emit(event: AgentLifecycleEvent): void {
    for (const listener of this.listeners) {
      try {
        const ret = listener(event);
        if (ret instanceof Promise) {
          // 异步监听器错误不传播，仅记录
          ret.catch(err => {
            console.warn('[AgentLifecycle] Async listener failed:', err);
          });
        }
      } catch (err) {
        // 同步监听器错误不传播，仅记录
        console.warn('[AgentLifecycle] Listener failed:', err);
      }
    }
  }

  /**
   * 启动 run。
   *
   * 状态转换：idle/error → running。
   * 单 run 守卫：若已在 running，抛错（调用方应等待当前 run 结束）。
   *
   * @returns AbortController（用于取消当前 run）
   * @throws AgentError(category='agent') 若已在 running
   */
  startRun(): AbortController {
    if (this.isRunning) {
      throw new AgentError(
        'Agent is already running. Wait for completion or cancel first.',
        { category: 'agent', retryable: false }
      );
    }
    this.state = 'running';
    this.currentRunStartedAt = Date.now();
    this.currentRunAbort = new AbortController();
    this.emit({ type: 'agent_start', timestamp: this.currentRunStartedAt });
    return this.currentRunAbort;
  }

  /**
   * 标记单轮开始。
   */
  startTurn(iteration: number): void {
    this.emit({ type: 'turn_start', iteration, timestamp: Date.now() });
  }

  /**
   * 标记单轮结束。
   */
  endTurn(iteration: number, finishReason?: string): void {
    this.emit({ type: 'turn_end', iteration, finishReason, timestamp: Date.now() });
  }

  /**
   * 标记工具调用事件。
   */
  emitToolCall(
    name: string,
    args: Record<string, unknown>,
    phase: 'start' | 'end',
    extras?: { result?: unknown; durationMs?: number }
  ): void {
    this.emit({
      type: 'tool_call',
      name,
      args,
      phase,
      result: extras?.result,
      durationMs: extras?.durationMs,
      timestamp: Date.now(),
    });
  }

  /**
   * 请求停止当前 run。
   *
   * 状态转换：running → stopping。
   * agentLoop 在下一次 checkpoint 检查 signal.aborted 后停止。
   */
  stop(): void {
    if (this.state !== 'running') return;
    this.state = 'stopping';
    this.currentRunAbort?.abort(new Error('lifecycle.stop requested'));
  }

  /**
   * 结束当前 run。
   *
   * 状态转换：running/stopping → idle（成功）或 error（失败）。
   * 必须在 agentLoop.run() 的 finally 块中调用，避免状态卡在 running。
   *
   * @param finishReason 结束原因
   * @param iterations 总迭代次数
   * @param error 错误信息（finishReason='error' 时存在）
   */
  endRun(finishReason: string, iterations: number, error?: string): void {
    const isError = finishReason === 'error' || Boolean(error);
    this.state = isError ? 'error' : 'idle';
    const startedAt = this.currentRunStartedAt ?? Date.now();
    this.emit({
      type: 'agent_end',
      finishReason,
      iterations,
      error,
      timestamp: Date.now(),
    });
    this.currentRunAbort = null;
    this.currentRunStartedAt = null;
    // 性能日志（开发调试用）
    if (this.listeners.size > 0) {
      console.debug(
        `[AgentLifecycle] run ended: finishReason=${finishReason}, iterations=${iterations}, durationMs=${Date.now() - startedAt}${error ? `, error=${error}` : ''}`
      );
    }
  }

  /**
   * 重置到 idle 状态（强制清理，仅在异常恢复时使用）。
   */
  forceReset(): void {
    this.state = 'idle';
    this.currentRunAbort = null;
    this.currentRunStartedAt = null;
  }
}

// ==================== 便捷工具 ====================

/**
 * 在生命周期管理下运行 executor。
 *
 * 参考 openclaw runWithLifecycle：
 *  1. startRun() → 状态转换为 running
 *  2. 执行 executor(signal)
 *  3. 成功 → endRun('stop', iterations)
 *  4. 失败 → endRun('error', iterations, message)
 *  5. finally → 状态重置（endRun 已处理）
 *
 * @param lifecycle 生命周期管理器
 * @param executor 执行函数（接收 AbortSignal，返回结果与迭代次数）
 * @returns executor 的返回值
 */
export async function runWithLifecycle<T>(
  lifecycle: AgentLifecycle,
  executor: (signal: AbortSignal) => Promise<{ result: T; iterations: number; finishReason: string }>
): Promise<T> {
  const abortController = lifecycle.startRun();
  try {
    const { result, iterations, finishReason } = await executor(abortController.signal);
    lifecycle.endRun(finishReason, iterations);
    return result;
  } catch (err) {
    const agentErr = toAgentError(err, 'Agent run failed');
    lifecycle.endRun('error', 0, agentErr.message);
    throw agentErr;
  }
}
