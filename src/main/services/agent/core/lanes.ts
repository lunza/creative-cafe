/**
 * 执行车道（Lanes）—— 适配 openclaw ToolExecutionMode / parallel vs sequential 理念
 *
 * 来源：g:\AI\creative-cafe\sillytavern-source\openclaw-main\packages\agent-core\src\agent-loop.ts
 *       （L271-L460 executeToolCalls* / executeToolCallsParallel / executeToolCallsSequential）
 *       + packages/agent-core/src/types.ts（ToolExecutionMode = 'parallel' | 'sequential'）
 * 决策：适配（spec §三）。openclaw 支持 parallel/sequential 两种工具执行模式；
 *       本项目默认 sequential（避免并发状态同步问题），但提供 parallel 选项供未来扩展。
 *
 * 职责：
 *  1. ToolExecutionMode：执行模式（parallel / sequential）
 *  2. executeToolCalls：按指定模式执行多个工具调用
 *  3. SequentialLane：顺序执行车道（默认，状态安全）
 *  4. ParallelLane：并行执行车道（实验性，仅适用于无状态工具）
 *
 * 设计约束（openclaw AGENTS.md）：
 *  - 默认 sequential：避免并发工具修改共享状态（如 updateStateTable）
 *  - parallel 仅用于无状态工具（如 searchWorldbook / searchHistory）
 *  - 单个工具失败不影响其他工具（错误转为 ToolExecutionResult）
 *  - 工具执行结果按调用顺序返回（保持与 LLM 期望对齐）
 */

import type {
  ToolCall,
  ToolExecutionResult,
  ToolCallContext,
} from '../contracts';
import type { IToolProvider } from '../contracts';
import type { SandboxOptions } from './sandbox';
import { runInSandbox } from './sandbox';

// ==================== 执行模式 ====================

/**
 * 工具执行模式。
 *
 * 参考 openclaw ToolExecutionMode：
 *  - 'sequential': 顺序执行（默认，状态安全）
 *  - 'parallel': 并行执行（仅适用于无状态工具）
 */
export type ToolExecutionMode = 'sequential' | 'parallel';

/**
 * 单工具执行结果（含调用元数据）。
 */
export interface ToolCallOutcome {
  /** 原始工具调用 */
  toolCall: ToolCall;
  /** 解析后的参数 */
  args: Record<string, unknown>;
  /** 执行结果 */
  result: ToolExecutionResult;
  /** 执行耗时（毫秒） */
  durationMs: number;
}

// ==================== 执行车道 ====================

/**
 * 执行车道选项。
 */
export interface LaneOptions {
  /** 执行模式（默认 'sequential'） */
  mode?: ToolExecutionMode;
  /** 沙盒选项（透传给 runInSandbox） */
  sandbox?: SandboxOptions;
  /** 工具调用开始/结束回调 */
  onToolCall?: (info: {
    name: string;
    args: Record<string, unknown>;
    phase: 'start' | 'end';
    result?: ToolExecutionResult;
    durationMs?: number;
  }) => void;
}

/**
 * 解析工具调用参数（JSON 字符串 → 对象）。
 *
 * 解析失败时返回 { _rawArguments }，让工具自行处理原始字符串。
 */
export function parseToolCallArgs(toolCall: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(toolCall.function.arguments || '{}');
  } catch {
    return { _rawArguments: toolCall.function.arguments };
  }
}

/**
 * 执行多个工具调用。
 *
 * 根据 mode 选择 sequential 或 parallel 执行。
 * 单个工具失败不中断其他工具（错误转为 ToolExecutionResult）。
 *
 * @param toolCalls LLM 返回的工具调用列表
 * @param toolProvider 工具提供方
 * @param context 工具调用上下文
 * @param options 车道选项
 * @returns 每个工具调用的执行结果（按 toolCalls 顺序）
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  toolProvider: IToolProvider,
  context: ToolCallContext | undefined,
  options: LaneOptions = {}
): Promise<ToolCallOutcome[]> {
  if (toolCalls.length === 0) return [];

  const mode = options.mode ?? 'sequential';
  if (mode === 'parallel') {
    return executeParallel(toolCalls, toolProvider, context, options);
  }
  return executeSequential(toolCalls, toolProvider, context, options);
}

// ==================== SequentialLane ====================

/**
 * 顺序执行车道。
 *
 * 默认模式。工具按顺序执行，前一个完成后再执行下一个。
 * 适用于有状态依赖的工具（如 updateStateTable → searchWorldbook）。
 *
 * 优点：状态安全，易于调试
 * 缺点：无状态工具无法并行加速
 */
async function executeSequential(
  toolCalls: ToolCall[],
  toolProvider: IToolProvider,
  context: ToolCallContext | undefined,
  options: LaneOptions
): Promise<ToolCallOutcome[]> {
  const outcomes: ToolCallOutcome[] = [];

  for (const toolCall of toolCalls) {
    const args = parseToolCallArgs(toolCall);
    options.onToolCall?.({ name: toolCall.function.name, args, phase: 'start' });

    // 在沙盒中执行单个工具
    const { result, durationMs } = await runInSandbox(
      async () => {
        // 注：IToolProvider.executeTool 当前签名仅接收 (name, args, context)，
        // sandbox 的 signal/log 通过 context 透传需要扩展 ToolCallContext，
        // 此处保持当前契约，signal 由 toolProvider 内部处理（未来可扩展）
        return toolProvider.executeTool(toolCall.function.name, args, {
          ...context,
          // 扩展点：未来可在 ToolCallContext 中加入 signal/log
        });
      },
      context,
      options.sandbox
    );

    options.onToolCall?.({
      name: toolCall.function.name,
      args,
      phase: 'end',
      result,
      durationMs,
    });

    outcomes.push({ toolCall, args, result, durationMs });
  }

  return outcomes;
}

// ==================== ParallelLane ====================

/**
 * 并行执行车道（实验性）。
 *
 * 所有工具同时执行，等待全部完成后返回。
 * 仅适用于无状态工具（如 searchWorldbook / searchHistory）。
 *
 * 优点：无状态工具并行加速
 * 缺点：有状态工具并发可能导致竞态条件（如同时 updateStateTable）
 *
 * 安全提示：
 *  - 调用方需确保所有工具调用均为无状态
 *  - 工具提供方可通过 ToolDescriptor.annotations 标记 stateless:true
 *  - 未来可在此处自动检测 stateless 标记并降级为 sequential
 */
async function executeParallel(
  toolCalls: ToolCall[],
  toolProvider: IToolProvider,
  context: ToolCallContext | undefined,
  options: LaneOptions
): Promise<ToolCallOutcome[]> {
  // 启动所有工具执行
  const pending = toolCalls.map(async (toolCall): Promise<ToolCallOutcome> => {
    const args = parseToolCallArgs(toolCall);
    options.onToolCall?.({ name: toolCall.function.name, args, phase: 'start' });

    const { result, durationMs } = await runInSandbox(
      async () => toolProvider.executeTool(toolCall.function.name, args, context),
      context,
      options.sandbox
    );

    options.onToolCall?.({
      name: toolCall.function.name,
      args,
      phase: 'end',
      result,
      durationMs,
    });

    return { toolCall, args, result, durationMs };
  });

  // 等待全部完成（单个失败不中断其他）
  const results = await Promise.allSettled(pending);

  // 将 rejected 转为失败 outcome（保持顺序对齐）
  return results.map((settled, index) => {
    const toolCall = toolCalls[index];
    const args = parseToolCallArgs(toolCall);
    if (settled.status === 'fulfilled') {
      return settled.value;
    }
    // rejected（runInSandbox 应已捕获，此处为兜底）
    const errMsg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
    return {
      toolCall,
      args,
      result: {
        success: false,
        content: `工具执行异常: ${errMsg}`,
        continueLoop: true,
      },
      durationMs: 0,
    } satisfies ToolCallOutcome;
  });
}

// ==================== 默认配置 ====================

/**
 * 默认执行模式：sequential。
 *
 * 参考 spec §二：默认禁用并行工具调用，简化 agentLoop 顺序执行，
 * 避免并发状态同步问题。
 */
export const DEFAULT_TOOL_EXECUTION_MODE: ToolExecutionMode = 'sequential';
