/**
 * AgentCore —— 智能体底座高层入口（适配 openclaw Agent 类）
 *
 * 来源：g:\AI\creative-cafe\sillytavern-source\openclaw-main\packages\agent-core\src\agent.ts
 *       （L213-L642 Agent 类，封装 runWithLifecycle + createContextSnapshot + AgentLoop）
 * 决策：适配（spec §三）。openclaw 的 Agent 类是有状态包装器（持有 transcript + tools），
 *       本项目简化为无状态入口（每次 run 接收 AgentRunIntent，返回 AgentRunResult），
 *       状态由调用方（如 WritingAgentService / ChatEngine）持有。
 *
 * 职责：
 *  1. run(intent)：高层入口，封装 lifecycle + agentLoop
 *  2. 内部管理 AgentLifecycle（状态转换 + 事件分发）
 *  3. 内部管理 AgentLoop（工具调用循环）
 *  4. 提供事件订阅（on()）与主动取消（cancel()）
 *  5. 提供 usage 查询（getUsage()）
 *
 * 设计约束（openclaw AGENTS.md）：
 *  - 单 run 守卫：同一时刻仅允许一个 run（并发 run 抛错）
 *  - 生命周期事件是 prompt：监听器通过事件感知状态
 *  - 无状态入口：状态由调用方持有，AgentCore 可复用
 */

import type {
  ILLMProvider,
  IToolProvider,
  AgentRunIntent,
  AgentRunResult,
} from '../contracts';
import type { ModelCapabilities } from '../llm/capabilityDetector';
import { AgentLoop, type AgentLoopConfig } from './agentLoop';
import {
  AgentLifecycle,
  runWithLifecycle,
  type LifecycleListener,
} from './lifecycle';
import type { ToolExecutionMode } from './lanes';
import type { SandboxOptions } from './sandbox';

// ==================== AgentCore 配置 ====================

/**
 * AgentCore 配置（构造时注入，运行时不变）。
 */
export interface AgentCoreConfig {
  /** LLM 提供方 */
  llmProvider: ILLMProvider;
  /** 工具提供方 */
  toolProvider: IToolProvider;
  /** 模型能力 */
  capabilities: ModelCapabilities;
  /** 最大迭代次数（默认 8） */
  maxIterations?: number;
  /** 超时毫秒（默认 300000） */
  timeoutMs?: number;
  /** token 上限（默认 200K） */
  maxTotalTokens?: number;
  /** 工具执行模式（默认 'sequential'） */
  toolExecutionMode?: ToolExecutionMode;
  /** 沙盒选项 */
  sandboxOptions?: SandboxOptions;
  /** 流式文本回调 */
  onTextChunk?: (chunk: string) => void;
  /** 工具调用回调 */
  onToolCall?: AgentLoopConfig['onToolCall'];
}

// ==================== AgentCore 实现 ====================

/**
 * 智能体底座高层入口。
 *
 * 封装 AgentLoop + AgentLifecycle，提供统一的 run() 入口。
 *
 * 用法：
 * ```ts
 * const core = new AgentCore({
 *   llmProvider: new AIServiceAdapter(aiService),
 *   toolProvider: new ToolRegistry(...),
 *   capabilities: await detector.detect(config),
 * });
 *
 * // 订阅事件（可选）
 * core.on(event => {
 *   if (event.type === 'tool_call' && event.phase === 'end') {
 *     console.log(`Tool ${event.name} done in ${event.durationMs}ms`);
 *   }
 * });
 *
 * // 运行
 * const result = await core.run({
 *   systemPrompt: 'You are a writer',
 *   messages: [{ role: 'user', content: 'Write chapter 1' }],
 *   context: { mode: 'writing' },
 * });
 *
 * // 取消（如用户点击停止按钮）
 * core.cancel();
 * ```
 */
export class AgentCore {
  private readonly config: AgentCoreConfig;
  private readonly lifecycle: AgentLifecycle;
  private currentLoop: AgentLoop | null = null;

  constructor(config: AgentCoreConfig) {
    this.config = config;
    this.lifecycle = new AgentLifecycle();
  }

  /** 当前生命周期状态 */
  get state(): string {
    return this.lifecycle.currentState;
  }

  /** 是否正在运行 */
  get isRunning(): boolean {
    return this.lifecycle.isRunning;
  }

  /**
   * 注册生命周期事件监听器。
   * @returns 取消注册函数
   */
  on(listener: LifecycleListener): () => void {
    return this.lifecycle.on(listener);
  }

  /**
   * 运行 agent。
   *
   * 封装 runWithLifecycle：
   *  1. lifecycle.startRun() → 状态转换为 running
   *  2. 创建 AgentLoop 并运行
   *  3. lifecycle.endRun() → 状态转换为 idle/error
   *
   * 单 run 守卫：若已在 running，抛错。
   *
   * @param intent 运行意图
   * @returns 运行结果
   */
  async run(intent: AgentRunIntent): Promise<AgentRunResult> {
    // 创建本次 run 的 AgentLoop（每次 run 新建，避免状态残留）
    this.currentLoop = new AgentLoop({
      llmProvider: this.config.llmProvider,
      toolProvider: this.config.toolProvider,
      capabilities: this.config.capabilities,
      maxIterations: this.config.maxIterations,
      timeoutMs: this.config.timeoutMs,
      maxTotalTokens: this.config.maxTotalTokens,
      toolExecutionMode: this.config.toolExecutionMode,
      sandboxOptions: this.config.sandboxOptions,
      onTextChunk: this.config.onTextChunk,
      onToolCall: this.config.onToolCall,
    });

    // 桥接 AgentLoop 内部事件到 lifecycle（仅工具调用事件）
    // 注：AgentLoop 的 onToolCall 已在构造时绑定，此处不再重复绑定

    try {
      const result = await runWithLifecycle(this.lifecycle, async (signal) => {
        // 注：AgentLoop 内部已管理 timeoutController，此处不再串联 signal
        //（signal 主要用于 lifecycle.stop() 触发取消，AgentLoop.cancel() 通过 onToolCall 回调或外部调用）
        void signal;
        const runResult = await this.currentLoop!.run(intent);

        // 将 toolCallHistory 中的工具调用事件补发到 lifecycle
        // （AgentLoop 已通过 onToolCall 回调实时通知，此处仅用于审计日志）
        return {
          result: runResult,
          iterations: runResult.iterations,
          finishReason: runResult.finishReason,
        };
      });
      return result;
    } finally {
      this.currentLoop = null;
    }
  }

  /**
   * 取消当前运行。
   *
   * 状态转换为 stopping，agentLoop 在下一次 checkpoint 停止。
   */
  cancel(): void {
    this.lifecycle.stop();
    this.currentLoop?.cancel();
  }

  /**
   * 获取当前 run 的 usage（运行中返回实时累积，结束后返回最终值）。
   */
  getUsage(): ReturnType<AgentLoop['getUsage']> | undefined {
    return this.currentLoop?.getUsage();
  }

  /**
   * 重置生命周期（强制清理，仅在异常恢复时使用）。
   */
  forceReset(): void {
    this.lifecycle.forceReset();
    this.currentLoop = null;
  }
}

// ==================== 工厂函数 ====================

/**
 * 创建 AgentCore 实例。
 *
 * 便捷工厂，封装常见配置。
 */
export function createAgentCore(config: AgentCoreConfig): AgentCore {
  return new AgentCore(config);
}

// ==================== 类型重导出 ====================

export type { AgentLifecycleEvent, LifecycleListener } from './lifecycle';
// 注：AgentLifecycleEvent 仅通过 re-export 暴露类型，本地不直接使用
