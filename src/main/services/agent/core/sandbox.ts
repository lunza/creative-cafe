/**
 * 工具执行沙盒 —— 适配 openclaw runWithAgentToolExecutionContext 理念
 *
 * 来源：g:\AI\creative-cafe\sillytavern-source\openclaw-main\packages\agent-core\src\agent-loop.ts
 *       （L271-L460 executeToolCalls* / runWithAgentToolExecutionContext）
 *       + packages/agent-core/src/tool-execution-context.ts
 * 决策：适配（spec §三）。openclaw 通过 ToolExecutionContext 隔离工具执行，
 *       限制工具可访问的资源（如禁用文件系统、限制网络）。本项目照搬其隔离理念，
 *       简化为：超时保护 + 错误捕获 + 资源权限声明 + 执行上下文注入。
 *
 * 职责：
 *  1. ToolExecutionContext：工具执行时注入的上下文（sessionId / characterId / mode）
 *  2. runInSandbox：在沙盒中执行工具，统一捕获异常、记录耗时、应用超时
 *  3. ToolPermission：声明式权限控制（哪些工具可访问文件系统/网络/数据库）
 *  4. 防御性边界：工具执行失败不传播到 agentLoop，转为 ToolExecutionResult
 *
 * 设计约束（openclaw AGENTS.md）：
 *  - 工具是 prompt：失败时返回模型可理解的错误信息，而非抛异常中断循环
 *  - 沙盒边界明确：工具不能直接访问 agentLoop 内部状态
 *  - 超时保护：单个工具执行超时（默认 30 秒）自动中断
 */

import type { ToolExecutionResult, ToolCallContext } from '../contracts';
import { toAgentError, AgentError } from '../infra/errors';

// ==================== 沙盒上下文 ====================

/**
 * 工具执行上下文（沙盒内可见）。
 *
 * 工具执行器通过此上下文访问运行时信息，而非直接读取 agentLoop 状态。
 * 参考 openclaw ToolExecutionContext，简化为本项目所需的字段。
 */
export interface ToolExecutionContext {
  /** 当前会话 ID */
  sessionId?: string;
  /** 当前角色卡 ID */
  characterId?: string;
  /** 当前模式（与 contracts.ToolCallContext.mode 对齐，含 Task 17 新增的 'worldbook'） */
  mode?: 'dialogue' | 'writing' | 'game' | 'worldbook';
  /** 用户 ID（权限隔离） */
  userId?: string;
  /** AbortSignal（工具可主动检查取消状态） */
  signal?: AbortSignal;
  /** 日志函数（沙盒内禁止直接 console.log，统一走日志） */
  log?: (level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) => void;
}

/**
 * 从 ToolCallContext（contracts）转换为 ToolExecutionContext（沙盒）。
 *
 * agentLoop 调用工具时传入的是 contracts.ToolCallContext，
 * sandbox 内部使用更丰富的 ToolExecutionContext（含 signal / log）。
 */
export function toToolExecutionContext(
  context: ToolCallContext | undefined,
  extras?: Partial<ToolExecutionContext>
): ToolExecutionContext {
  return {
    sessionId: context?.sessionId,
    characterId: context?.characterId,
    mode: context?.mode,
    userId: context?.userId,
    ...extras,
  };
}

// ==================== 工具权限 ====================

/**
 * 工具资源权限（声明式沙盒边界）。
 *
 * 参考 openclaw ToolExecutionContext 的权限模型，简化为：
 *  - filesystem: 是否允许访问文件系统
 *  - network: 是否允许网络请求
 *  - database: 是否允许数据库读写
 *  - subprocess: 是否允许启动子进程（本项目首期全部禁用）
 */
export interface ToolPermission {
  filesystem?: boolean;
  network?: boolean;
  database?: boolean;
  subprocess?: boolean;
}

/**
 * 默认权限：全部禁用（最小权限原则）。
 *
 * 工具需显式声明所需权限，未声明的权限默认不可用。
 * 内置工具（如 searchWorldbook）通过 database:true 访问 SQLite。
 */
export const DEFAULT_PERMISSION: ToolPermission = {
  filesystem: false,
  network: false,
  database: false,
  subprocess: false,
};

// ==================== 沙盒执行 ====================

/**
 * 沙盒执行选项。
 */
export interface SandboxOptions {
  /** 单工具执行超时（默认 30 秒） */
  toolTimeoutMs?: number;
  /** AbortSignal（与超时合并，任一触发即取消） */
  signal?: AbortSignal;
  /** 默认日志函数 */
  log?: ToolExecutionContext['log'];
}

/**
 * 默认单工具超时（30 秒）。
 */
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

/**
 * 在沙盒中执行工具。
 *
 * 职责：
 *  1. 超时保护：toolTimeoutMs 后自动中断（通过 AbortController）
 *  2. 异常捕获：工具抛出的任何错误转为 ToolExecutionResult（不传播到 agentLoop）
 *  3. 耗时记录：返回 durationMs
 *  4. 取消传播：外部 signal 取消时联动取消工具执行
 *
 * @param executor 工具执行函数（接收沙盒上下文，返回 ToolExecutionResult）
 * @param context 工具调用上下文（contracts.ToolCallContext）
 * @param options 沙盒选项
 * @returns 包含结果与耗时的对象
 */
export async function runInSandbox(
  executor: (ctx: ToolExecutionContext) => Promise<ToolExecutionResult>,
  context?: ToolCallContext,
  options: SandboxOptions = {}
): Promise<{ result: ToolExecutionResult; durationMs: number }> {
  const startTime = Date.now();
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;

  // 构建沙盒 AbortController：合并超时与外部 signal
  const sandboxController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    sandboxController.abort(new Error(`tool timeout after ${toolTimeoutMs}ms`));
  }, toolTimeoutMs);
  (timeoutHandle as unknown as { unref?: () => void })?.unref?.();

  // 串联外部 signal
  if (options.signal) {
    if (options.signal.aborted) {
      sandboxController.abort((options.signal as unknown as { reason?: unknown }).reason);
    } else {
      const onExternalAbort = () => {
        sandboxController.abort(
          (options.signal as unknown as { reason?: unknown }).reason
        );
        options.signal!.removeEventListener('abort', onExternalAbort);
      };
      options.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  // 构建沙盒上下文
  const sandboxCtx: ToolExecutionContext = toToolExecutionContext(context, {
    signal: sandboxController.signal,
    log: options.log ?? defaultLog,
  });

  let result: ToolExecutionResult;
  try {
    result = await executor(sandboxCtx);
  } catch (err) {
    // 异常捕获：转为模型可理解的错误信息（不传播到 agentLoop）
    const agentErr = toAgentError(err, 'Tool execution failed');
    const userMsg = formatToolError(agentErr);
    result = {
      success: false,
      content: userMsg,
      continueLoop: true, // 让模型决定下一步（重试或换路径）
    };
  } finally {
    clearTimeout(timeoutHandle);
  }

  return {
    result,
    durationMs: Date.now() - startTime,
  };
}

// ==================== 内部工具 ====================

/**
 * 默认日志函数（console，带 [agent-sandbox] 前缀）。
 */
function defaultLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, unknown>
): void {
  const prefix = '[agent-sandbox]';
  const ctxStr = context ? ` ${JSON.stringify(context)}` : '';
  switch (level) {
    case 'info':
      console.info(`${prefix} ${message}${ctxStr}`);
      break;
    case 'warn':
      console.warn(`${prefix} ${message}${ctxStr}`);
      break;
    case 'error':
      console.error(`${prefix} ${message}${ctxStr}`);
      break;
  }
}

/**
 * 格式化工具错误为模型可理解的消息。
 *
 * 设计约束（openclaw AGENTS.md）：
 *  - 失败文本说明下一步该试什么，不 dead-end
 *  - 不暴露内部堆栈（安全 + 模型不需要）
 */
export function formatToolError(error: AgentError): string {
  const reason = error.category === 'timeout'
    ? '工具执行超时。请尝试更简单的参数，或拆分为多个小步骤。'
    : error.category === 'validation'
    ? `参数校验失败: ${error.message}。请检查参数格式后重试。`
    : error.category === 'tool'
    ? `工具内部错误: ${error.message}。请尝试其他工具或方法。`
    : `工具执行失败: ${error.message}。请调整参数或尝试其他方法。`;
  return reason;
}
