/**
 * Agent Loop —— 工具调用循环（自研，对接项目 AIService）
 *
 * 来源：spec §二 Task 7.1（agentLoop.ts，tool_calls 循环，自研，maxIterations=8）
 * 决策：自研（spec §三）。openclaw 的 agent 循环分散在 runtime/agents，
 *       本项目按 OpenAI tool_calls 协议自研精简版。
 *
 * 职责（核心循环）：
 *  1. 调用 LLM（带 tools 参数）
 *  2. 若 LLM 返回 tool_calls → 执行工具 → 将结果以 role='tool' 消息回灌 → 再次调用 LLM
 *  3. 若 LLM 返回 content（finishReason='stop'）→ 返回最终内容
 *  4. 循环直到 maxIterations 或 finishReason='stop'
 *
 * 循环不变量（openclaw AGENTS.md 理念）：
 *  - 每次迭代携带已准备的事实（capabilities / tools / context），不在循环内重新发现
 *  - 工具结果是 prompt：返回模型下一步需要的信息，而非简单 ack
 *  - 失败文本说明下一步该试什么，不 dead-end
 *
 * 设计约束：
 *  - maxIterations 默认 8（spec §二），防止无限循环
 *  - 超时默认 300000ms（5 分钟），与 ChatEngine 对齐
 *  - 工具执行失败不中断循环，将错误信息回灌给 LLM（让模型自行决策重试或换路径）
 *  - abortSignal 支持用户主动取消
 *  - 通过 lanes 执行工具调用（默认 sequential，支持 parallel）
 *  - 通过 sandbox 隔离工具执行（超时 + 异常捕获）
 *  - 通过 usage 追踪 token 消耗（含上限保护）
 */

import type {
  ILLMProvider,
  IToolProvider,
  ToolCallContext,
  AgentRunIntent,
  AgentRunResult,
  ToolExecutionResult,
  ToolDefinition,
} from '../contracts';
import type { ModelCapabilities } from '../llm/capabilityDetector';
import { toAgentError } from '../infra/errors';
import { resolveAgentTimeoutMs, AgentTimeoutController, throwIfAborted } from './timeout';
import { UsageTracker, DEFAULT_MAX_TOTAL_TOKENS, type TokenUsage } from './usage';
import { executeToolCalls, DEFAULT_TOOL_EXECUTION_MODE, type ToolExecutionMode } from './lanes';
import type { SandboxOptions } from './sandbox';

// ==================== AgentLoop 配置 ====================

export interface AgentLoopConfig {
  /** LLM 提供方 */
  llmProvider: ILLMProvider;
  /** 工具提供方 */
  toolProvider: IToolProvider;
  /** 模型能力（决定是否启用 tool calling） */
  capabilities: ModelCapabilities;
  /** 最大迭代次数（默认 8） */
  maxIterations?: number;
  /** 超时毫秒（默认 300000 = 5 分钟） */
  timeoutMs?: number;
  /** token 上限（默认 200K，防止死循环烧 token） */
  maxTotalTokens?: number;
  /** 工具执行模式（默认 'sequential'） */
  toolExecutionMode?: ToolExecutionMode;
  /** 沙盒选项（透传给 runInSandbox） */
  sandboxOptions?: SandboxOptions;
  /** 流式文本回调（边生成边推送 UI） */
  onTextChunk?: (chunk: string) => void;
  /** 工具调用回调（每次工具执行前后通知） */
  onToolCall?: (info: {
    name: string;
    args: Record<string, unknown>;
    phase: 'start' | 'end';
    result?: ToolExecutionResult;
    durationMs?: number;
  }) => void;
}

// ==================== AgentLoop 实现 ====================

/**
 * Agent 工具调用循环。
 *
 * 这是智能体底座的核心引擎。接收 AgentRunIntent，通过 LLM + 工具的迭代循环
 * 产生 AgentRunResult。
 *
 * 循环流程：
 *   ┌→ 调用 LLM（带 tools）
 *   │   ↓
 *   │  finishReason='tool_calls'?
 *   │   ├─ 是 → 执行工具 → 回灌结果 → ┌↑
 *   │   └─ 否 → 返回 content
 *   ↓
 *   maxIterations? → 返回（finishReason='maxIterations'）
 */
export class AgentLoop {
  private readonly config: Required<
    Omit<AgentLoopConfig, 'onTextChunk' | 'onToolCall' | 'sandboxOptions'>
  > & {
    onTextChunk?: (chunk: string) => void;
    onToolCall?: AgentLoopConfig['onToolCall'];
    sandboxOptions?: SandboxOptions;
  };
  private readonly usageTracker: UsageTracker;
  private timeoutController: AgentTimeoutController | null = null;

  constructor(config: AgentLoopConfig) {
    this.config = {
      ...config,
      maxIterations: config.maxIterations ?? 8,
      timeoutMs: config.timeoutMs ?? 300_000,
      maxTotalTokens: config.maxTotalTokens ?? DEFAULT_MAX_TOTAL_TOKENS,
      toolExecutionMode: config.toolExecutionMode ?? DEFAULT_TOOL_EXECUTION_MODE,
      sandboxOptions: config.sandboxOptions,
    };
    this.usageTracker = new UsageTracker({ maxTotalTokens: this.config.maxTotalTokens });
  }

  /**
   * 运行 agent 循环。
   *
   * @param intent 运行意图（systemPrompt + messages + context）
   * @returns 运行结果（content + toolCallHistory + iterations + finishReason）
   */
  async run(intent: AgentRunIntent): Promise<AgentRunResult> {
    const maxIterations = intent.maxIterations ?? this.config.maxIterations;
    const timeoutMs = resolveAgentTimeoutMs({
      defaultMs: this.config.timeoutMs,
      overrideMs: intent.timeoutMs,
    });

    // 初始化超时控制器（含外部 signal 串联）
    this.timeoutController = new AgentTimeoutController({
      timeoutMs,
      externalSignal: undefined, // intent 未提供 externalSignal，由 cancel() 触发
    });

    // 构建消息序列（systemPrompt + 历史）
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [...intent.messages];
    const toolCallHistory: AgentRunResult['toolCallHistory'] = [];

    // 判断是否启用工具调用（双条件：能力支持 + 有可用工具）
    const toolCallingEnabled = this.config.capabilities.supportsToolCalling === true;
    let availableTools: ToolDefinition[] = [];
    if (toolCallingEnabled) {
      availableTools = this.config.toolProvider.getToolDefinitions(intent.context);
    }

    try {
      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        // 检查取消/超时
        throwIfAborted(this.timeoutController.signal);

        // 调用 LLM
        const llmResult = await this.config.llmProvider.streamChat({
          systemPrompt: intent.systemPrompt,
          messages,
          modelName: this.resolveModelName(intent.context),
          tools: availableTools.length > 0 ? availableTools : undefined,
          parallelToolCalls: false,
        });

        // 累计 usage（超限时停止迭代）
        const withinLimit = this.usageTracker.addUsage(llmResult.usage as TokenUsage | undefined);
        if (!withinLimit) {
          return this.buildResult(
            llmResult.content || '',
            toolCallHistory,
            iteration,
            'length',
            `达到 token 上限 ${this.config.maxTotalTokens}`
          );
        }

        // 推送流式文本
        if (llmResult.content && this.config.onTextChunk) {
          this.config.onTextChunk(llmResult.content);
        }

        // 判断是否需要执行工具
        const hasToolCalls = llmResult.toolCalls && llmResult.toolCalls.length > 0;

        if (!hasToolCalls || llmResult.finishReason === 'stop') {
          // 无工具调用或已完成 → 返回最终内容
          return this.buildResult(
            llmResult.content,
            toolCallHistory,
            iteration,
            (llmResult.finishReason as AgentRunResult['finishReason']) ?? 'stop'
          );
        }

        // 有工具调用 → 执行工具并回灌结果
        // 1. 先将 assistant 的 tool_calls 消息加入历史
        messages.push({
          role: 'assistant',
          content: llmResult.content || '',
        });

        // 2. 通过 lanes 执行工具（默认 sequential）
        const outcomes = await executeToolCalls(
          llmResult.toolCalls!,
          this.config.toolProvider,
          intent.context,
          {
            mode: this.config.toolExecutionMode,
            sandbox: {
              ...this.config.sandboxOptions,
              signal: this.timeoutController.signal,
            },
            onToolCall: this.config.onToolCall,
          }
        );

        // 3. 回灌工具结果到 messages，并记录到 toolCallHistory
        for (const outcome of outcomes) {
          toolCallHistory.push({
            name: outcome.toolCall.function.name,
            args: outcome.args,
            result: outcome.result,
            durationMs: outcome.durationMs,
          });
          this.usageTracker.addToolDuration({
            name: outcome.toolCall.function.name,
            durationMs: outcome.durationMs,
            success: outcome.result.success,
          });
          // 将工具结果以 user 消息回灌（简化：避免改 contracts 的 messages 类型）
          messages.push({
            role: 'user',
            content: `[Tool: ${outcome.toolCall.function.name}] Result:\n${outcome.result.content}`,
          });
        }
        // 循环继续 → 再次调用 LLM（携带工具结果）
      }

      // 达到 maxIterations
      return this.buildResult(
        '',
        toolCallHistory,
        maxIterations,
        'maxIterations',
        `达到最大迭代次数 ${maxIterations}`
      );
    } catch (err) {
      const agentErr = toAgentError(err, 'AgentLoop.run failed');
      // 超时/取消归类为 timeout，其他归类为 error
      const finishReason: AgentRunResult['finishReason'] =
        agentErr.category === 'timeout' ? 'timeout' : 'error';
      return this.buildResult(
        '',
        toolCallHistory,
        0,
        finishReason,
        agentErr.message
      );
    } finally {
      this.timeoutController.dispose();
      this.timeoutController = null;
    }
  }

  /**
   * 取消当前运行的 agent 循环。
   */
  cancel(): void {
    this.timeoutController?.abort('cancelled');
  }

  /**
   * 获取 usage 追踪器（用于统计 token 消耗）。
   */
  getUsage(): ReturnType<UsageTracker['getUsage']> {
    return this.usageTracker.getUsage();
  }

  // ==================== 内部方法 ====================

  /**
   * 解析模型名称。
   *
   * AIServiceAdapter 内部通过 AIConfigProvider.getActiveEngine() 获取模型名，
   * 此处返回空字符串即可（AIServiceAdapter 忽略 modelName 字段）。
   * 保留 context 透传供未来多模型路由扩展。
   */
  private resolveModelName(context?: ToolCallContext): string {
    // 当前实现：AIServiceAdapter 从 AIConfigProvider 获取模型名，忽略此字段。
    // 未来可扩展为 context.modelName 或多模型路由表。
    void context;
    return '';
  }

  /**
   * 构建运行结果。
   */
  private buildResult(
    content: string,
    toolCallHistory: AgentRunResult['toolCallHistory'],
    iterations: number,
    finishReason: AgentRunResult['finishReason'],
    error?: string
  ): AgentRunResult {
    return {
      content,
      toolCallHistory,
      iterations,
      finishReason,
      usage: this.usageTracker.getUsage(),
      error,
    };
  }
}
