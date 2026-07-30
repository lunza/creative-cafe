/**
 * 错误分类与规范化 —— 适配 openclaw src/infra/errors.ts 理念
 *
 * 来源：g:\AI\creative-cafe\sillytavern-source\openclaw-main\src\infra\（errors 相关）
 * 决策：适配（spec §三）。openclaw 的错误分类理念好（区分 transient / permanent /
 *       retryable），但依赖其 monorepo packages。本项目将其核心理念内联，
 *       合并项目现有错误码（network / server / api / validation / unknown）。
 *
 * 职责：
 *  1. AgentError：统一错误基类，携带 category / retryable / cause
 *  2. 错误分类：network / timeout / rateLimit / validation / tool / agent / unknown
 *  3. isRetryable：判断错误是否值得重试（transient 错误可重试）
 *  4. toAgentError：将任意 thrown 值规范化为 AgentError
 *  5. fromHttpStatusCode：从 HTTP 状态码推断错误类别
 *
 * 设计约束：
 *  - 与 ChatEngine.classifyError 保持兼容（network/server/api/validation/unknown）
 *  - retryable 默认 true（transient 假设），仅 validation/tool 明确不可重试
 */

// ==================== 错误类别 ====================

export type ErrorCategory =
  | 'network' // 网络错误（连接失败、DNS、超时）
  | 'timeout' // 超时（请求超时、agent 运行超时）
  | 'rateLimit' // 限流（HTTP 429）
  | 'server' // 服务端错误（HTTP 5xx）
  | 'api' // API 错误（认证失败、key 无效）
  | 'validation' // 校验错误（参数非法、格式错误）
  | 'tool' // 工具执行错误（工具内部抛出）
  | 'agent' // agent 逻辑错误（循环超限、状态不一致）
  | 'unknown'; // 未知错误

// ==================== AgentError ====================

/**
 * 智能体底座统一错误类。
 *
 * 所有 agent 模块（llm/core/memory/skills/learning）抛出的错误应规范化为 AgentError，
 * 携带 category（分类）与 retryable（是否可重试）信息，供 retryAsync / agentLoop 决策。
 */
export class AgentError extends Error {
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      category?: ErrorCategory;
      retryable?: boolean;
      statusCode?: number;
      cause?: unknown;
      context?: Record<string, unknown>;
    } = {}
  ) {
    super(message);
    // ES2020 Error 不支持 cause 构造参数，手动赋值
    if (options.cause !== undefined) {
      (this as any).cause = options.cause;
    }
    this.name = 'AgentError';
    this.category = options.category ?? 'unknown';
    this.retryable = options.retryable ?? getDefaultRetryable(this.category);
    this.statusCode = options.statusCode;
    this.context = options.context;
  }
}

// ==================== 默认可重试性 ====================

/**
 * 根据错误类别推断默认可重试性。
 *
 * transient 错误（network/timeout/rateLimit/server）默认可重试；
 * permanent 错误（validation/tool/agent/api）默认不可重试。
 */
export function getDefaultRetryable(category: ErrorCategory): boolean {
  switch (category) {
    case 'network':
    case 'timeout':
    case 'rateLimit':
    case 'server':
      return true;
    case 'api':
    case 'validation':
    case 'tool':
    case 'agent':
    case 'unknown':
    default:
      return false;
  }
}

// ==================== 规范化 ====================

/**
 * 将任意 thrown 值规范化为 AgentError。
 *
 * - 已是 AgentError → 原样返回
 * - 是 Error → 包装为 AgentError（category 从 message 推断）
 * - 字符串 → 包装为 AgentError
 * - 其他 → 包装为 AgentError（fallback message）
 */
export function toAgentError(
  value: unknown,
  fallbackMessage = 'Non-Error thrown'
): AgentError {
  if (value instanceof AgentError) return value;
  if (value instanceof Error) {
    return new AgentError(value.message, {
      cause: value,
      category: inferCategoryFromMessage(value.message),
    });
  }
  if (typeof value === 'string') {
    return new AgentError(value, { category: inferCategoryFromMessage(value) });
  }
  const error = new AgentError(fallbackMessage, { cause: value });
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
    Object.assign(error, value);
  }
  return error;
}

/**
 * 从错误消息关键词推断错误类别（兜底启发式）。
 */
function inferCategoryFromMessage(message: string): ErrorCategory {
  const lower = (message || '').toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests')) {
    return 'rateLimit';
  }
  if (lower.includes('fetch') || lower.includes('network') || lower.includes('connect') || lower.includes('econnrefused')) {
    return 'network';
  }
  if (lower.includes('unauthorized') || lower.includes('api key') || lower.includes('auth') || lower.includes('401') || lower.includes('403')) {
    return 'api';
  }
  if (lower.includes('validation') || lower.includes('invalid') || lower.includes('400') || lower.includes('422')) {
    return 'validation';
  }
  if (lower.includes('server') || lower.includes('500') || lower.includes('502') || lower.includes('503')) {
    return 'server';
  }
  return 'unknown';
}

// ==================== HTTP 状态码映射 ====================

/**
 * 从 HTTP 状态码推断错误类别。
 */
export function fromHttpStatusCode(statusCode: number): ErrorCategory {
  if (statusCode === 429) return 'rateLimit';
  if (statusCode === 401 || statusCode === 403) return 'api';
  if (statusCode === 400 || statusCode === 422) return 'validation';
  if (statusCode >= 500) return 'server';
  if (statusCode >= 404) return 'unknown';
  return 'unknown';
}

// ==================== 便捷工厂 ====================

export const errors = {
  network: (message: string, cause?: unknown): AgentError =>
    new AgentError(message, { category: 'network', cause }),
  timeout: (message: string, cause?: unknown): AgentError =>
    new AgentError(message, { category: 'timeout', cause }),
  rateLimit: (message: string, retryAfterMs?: number): AgentError =>
    new AgentError(message, {
      category: 'rateLimit',
      retryable: true,
      context: retryAfterMs ? { retryAfterMs } : undefined,
    }),
  validation: (message: string, context?: Record<string, unknown>): AgentError =>
    new AgentError(message, { category: 'validation', retryable: false, context }),
  tool: (message: string, toolName?: string): AgentError =>
    new AgentError(message, {
      category: 'tool',
      retryable: false,
      context: toolName ? { toolName } : undefined,
    }),
  agent: (message: string, context?: Record<string, unknown>): AgentError =>
    new AgentError(message, { category: 'agent', retryable: false, context }),
};
