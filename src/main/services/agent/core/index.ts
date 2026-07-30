/**
 * core/ 模块 barrel export —— 智能体底座核心引擎统一出口
 *
 * 按需导出，避免循环依赖。import 路径示例：
 *   import { AgentCore, AgentLoop } from './core';
 *   import { AgentLifecycle } from './core';
 */

// 高层入口
export { AgentCore, createAgentCore, type AgentCoreConfig } from './agentCore';

// 核心循环
export { AgentLoop, type AgentLoopConfig } from './agentLoop';

// 生命周期管理
export {
  AgentLifecycle,
  runWithLifecycle,
  type AgentLifecycleState,
  type AgentLifecycleEvent,
  type LifecycleListener,
} from './lifecycle';

// 上下文管理
export {
  AgentContextBuilder,
  deriveToolCallContext,
  isToolCallingEnabled,
  type AgentRunContext,
  type AgentContextBuilderOptions,
} from './context';

// 执行车道
export {
  executeToolCalls,
  parseToolCallArgs,
  DEFAULT_TOOL_EXECUTION_MODE,
  type ToolExecutionMode,
  type ToolCallOutcome,
  type LaneOptions,
} from './lanes';

// 沙盒隔离
export {
  runInSandbox,
  toToolExecutionContext,
  formatToolError,
  DEFAULT_PERMISSION,
  DEFAULT_TOOL_TIMEOUT_MS,
  type ToolExecutionContext,
  type ToolPermission,
  type SandboxOptions,
} from './sandbox';

// 超时控制
export {
  AgentTimeoutController,
  resolveAgentTimeoutMs,
  throwIfAborted,
  DEFAULT_AGENT_TIMEOUT_MS,
  MIN_AGENT_TIMEOUT_MS,
  MAX_AGENT_TIMEOUT_MS,
  type AbortReason,
  type TimeoutResolutionOptions,
} from './timeout';

// Usage 追踪
export {
  UsageTracker,
  mergeUsage,
  DEFAULT_MAX_TOTAL_TOKENS,
  type TokenUsage,
  type ToolDurationRecord,
  type AccumulatedUsage,
} from './usage';
