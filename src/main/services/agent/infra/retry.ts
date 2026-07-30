/**
 * 重试运行器（Retry Runner）—— 适配 openclaw packages/retry/src/index.ts
 *
 * 来源：g:\AI\creative-cafe\sillytavern-source\openclaw-main\packages\retry\src\index.ts
 *       + g:\AI\creative-cafe\sillytavern-source\openclaw-main\src\infra\retry.ts
 * 决策：适配（spec §三）。openclaw 原版依赖 packages/retry + secure-random +
 *       retry-attempt-errors，本项目无 monorepo packages 结构，故将核心逻辑
 *       内联为自包含实现，保留 API 兼容（retryAsync / RetrySupervisor）。
 *
 * 职责：
 *  1. retryAsync：运行异步操作直到成功 / 策略停止 / 尝试次数耗尽
 *  2. RetrySupervisor：有状态重试控制器，支持 cancel / reset / next
 *  3. resolveRetryConfig：合并默认配置与覆盖配置
 *  4. toRetryError：将任意 thrown 值规范化为 Error
 *
 * 设计约束：
 *  - 不引入 openclaw packages/ 依赖，核心算法直接内联
 *  - 保留 openclaw 的 jitter 策略（symmetric / positive / full）
 *  - 保留 Retry-After header 支持（retryAfterMs 回调）
 */

import { computeBackoff, type BackoffPolicy } from './backoff';

// ==================== 类型定义 ====================

export type { BackoffPolicy } from './backoff';

export interface RetryConfig {
  /** 最大尝试次数（默认 3） */
  attempts?: number;
  /** 最小延迟（ms，默认 300） */
  minDelayMs?: number;
  /** 最大延迟上限（ms，默认 30000） */
  maxDelayMs?: number;
  /** 抖动：分数（对称/正向）或 'full'（完全抖动） */
  jitter?: number | 'full';
}

export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  err: unknown;
  label?: string;
  delayMs: number;
}

export interface RetryOptions extends RetryConfig {
  label?: string;
  /** 自定义是否重试（默认全部重试） */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** 从错误中提取 Retry-After ms（如 HTTP 429 响应头） */
  retryAfterMs?: (err: unknown) => number | undefined;
  /** Retry-After 延迟上限（默认等于 maxDelayMs） */
  retryAfterMaxDelayMs?: number;
  /** 自定义延迟计算（覆盖默认指数退避） */
  delayMs?: number | ((context: RetryDelayContext) => number);
  /** 每次重试前的回调（用于日志/监控） */
  onRetry?: (info: RetryInfo) => unknown;
  /** 自定义随机数源（测试注入） */
  random?: () => number;
  /** 自定义 sleep（测试注入） */
  sleep?: (ms: number) => Promise<void>;
}

interface RetryDelayContext {
  attempt: number;
  maxAttempts: number;
  err: unknown;
  label?: string;
}

// ==================== 默认配置 ====================

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  attempts: 3,
  minDelayMs: 300,
  maxDelayMs: 30_000,
  jitter: 0,
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

// ==================== 工具函数 ====================

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampNumber(
  value: unknown,
  fallback: number,
  min?: number,
  max?: number
): number {
  const next = asFiniteNumber(value);
  if (next === undefined) return fallback;
  return Math.min(Math.max(next, min ?? Number.NEGATIVE_INFINITY), max ?? Number.POSITIVE_INFINITY);
}

function resolveAttemptCount(value: unknown, fallback: number): number {
  return Math.max(1, Math.round(asFiniteNumber(value) ?? fallback));
}

function resolveRetryDelayMs(value: number): number {
  const finite =
    value === Number.POSITIVE_INFINITY
      ? 2_147_000_000
      : (asFiniteNumber(value) ?? 0);
  return Math.min(Math.max(Math.round(finite), 0), 2_147_000_000);
}

function resolveJitterConfig(value: unknown, fallback: number | 'full'): number | 'full' {
  if (value === 'full') return 'full';
  const fraction = asFiniteNumber(value);
  return fraction === undefined ? fallback : Math.min(Math.max(fraction, 0), 1);
}

/**
 * 合并默认重试配置与覆盖配置。
 */
export function resolveRetryConfig(
  defaults: Required<RetryConfig> = DEFAULT_RETRY_CONFIG,
  overrides?: RetryConfig
): Required<RetryConfig> {
  const attempts = resolveAttemptCount(overrides?.attempts, defaults.attempts);
  const minDelayMs = resolveRetryDelayMs(
    clampNumber(overrides?.minDelayMs, defaults.minDelayMs, 0)
  );
  const maxDelayMs = Math.max(
    minDelayMs,
    resolveRetryDelayMs(clampNumber(overrides?.maxDelayMs, defaults.maxDelayMs, 0))
  );
  return {
    attempts,
    minDelayMs,
    maxDelayMs,
    jitter: resolveJitterConfig(overrides?.jitter, defaults.jitter),
  };
}

/**
 * 将任意 thrown 值规范化为 Error。
 */
export function toRetryError(value: unknown, fallbackMessage = 'Non-Error thrown'): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  const error = new Error(fallbackMessage);
  // ES2020 Error 不支持 cause 构造参数，手动赋值
  (error as any).cause = value;
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
    Object.assign(error, value);
  }
  return error;
}

// ==================== 抖动计算 ====================

type JitterMode = 'symmetric' | 'positive';

function applyJitter(
  delayMs: number,
  jitter: number | 'full',
  mode: JitterMode,
  random: () => number
): number {
  if (jitter === 'full') {
    if (mode === 'symmetric') {
      // 超上限的 Retry-After 无法满足，向下抖动避免客户端同步锁步
      return Math.max(0, Math.round(delayMs * (0.5 + random() * 0.5)));
    }
    return Math.max(0, Math.ceil(delayMs * (1 + random())));
  }
  if (jitter <= 0) {
    return mode === 'positive' ? Math.ceil(delayMs) : delayMs;
  }
  const fraction = random();
  const offset = mode === 'positive' ? fraction * jitter : (fraction * 2 - 1) * jitter;
  const raw = delayMs * (1 + offset);
  // Retry-After 是下界，正向抖动必须向上取整
  return Math.max(0, mode === 'positive' ? Math.ceil(raw) : Math.round(raw));
}

// ==================== retryAsync 主函数 ====================

/**
 * 运行异步操作直到成功 / 策略停止 / 尝试次数耗尽。
 *
 * 用法：
 *   const result = await retryAsync(() => fetch(url), { attempts: 5, maxDelayMs: 10000 });
 *   const result = await retryAsync(fn, 3, 500);  // 简写：3 次，初始延迟 500ms
 *
 * @param fn 异步操作（返回 Promise）
 * @param attemptsOrOptions 尝试次数（数字）或完整选项
 * @param initialDelayMs 简写模式下的初始延迟（默认 300ms）
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  attemptsOrOptions: number | RetryOptions = 3,
  initialDelayMs = 300
): Promise<T> {
  const attemptErrors: unknown[] = [];

  // 简写模式：仅传次数
  if (typeof attemptsOrOptions === 'number') {
    const attempts = resolveAttemptCount(attemptsOrOptions, DEFAULT_RETRY_CONFIG.attempts);
    for (let index = 0; index < attempts; index += 1) {
      try {
        return await fn();
      } catch (err) {
        attemptErrors.push(err);
        if (index === attempts - 1) break;
        await defaultSleep(resolveRetryDelayMs(initialDelayMs * 2 ** index));
      }
    }
    throw toRetryError(attemptErrors.at(-1) ?? new Error('Retry failed'));
  }

  // 完整选项模式
  const options = attemptsOrOptions;
  const resolved = resolveRetryConfig(DEFAULT_RETRY_CONFIG, options);
  const maxAttempts = resolved.attempts;
  const minDelayMs = resolved.minDelayMs;
  const maxDelayMs = resolved.maxDelayMs > 0 ? resolved.maxDelayMs : Number.POSITIVE_INFINITY;
  const retryAfterMaxDelayMs =
    options.retryAfterMaxDelayMs === undefined
      ? maxDelayMs
      : Math.max(
          minDelayMs,
          resolveRetryDelayMs(clampNumber(options.retryAfterMaxDelayMs, maxDelayMs, 0))
        );
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? (() => true);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      attemptErrors.push(err);
      if (attempt >= maxAttempts || !shouldRetry(err, attempt)) {
        break;
      }

      const context: RetryDelayContext = {
        attempt,
        maxAttempts,
        err,
        label: options.label,
      };
      const retryAfterMs = options.retryAfterMs?.(err);
      const hasRetryAfter = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs);
      const configuredDelay =
        typeof options.delayMs === 'function' ? options.delayMs(context) : options.delayMs;
      const resolvedConfiguredDelay =
        configuredDelay === undefined ? undefined : resolveRetryDelayMs(configuredDelay);
      const baseDelay = hasRetryAfter
        ? Math.max(retryAfterMs!, minDelayMs)
        : resolvedConfiguredDelay === undefined
          ? minDelayMs * 2 ** (attempt - 1)
          : Math.max(resolvedConfiguredDelay, minDelayMs);
      const delayCap = hasRetryAfter ? retryAfterMaxDelayMs : maxDelayMs;
      let delay = Math.min(baseDelay, delayCap);

      const canHonorRetryAfter = hasRetryAfter && (retryAfterMs ?? 0) <= delayCap;
      const wantsPositiveDraw =
        resolved.jitter === 'full'
          ? !hasRetryAfter || canHonorRetryAfter
          : canHonorRetryAfter;
      delay = applyJitter(delay, resolved.jitter, wantsPositiveDraw ? 'positive' : 'symmetric', random);
      delay = Math.min(Math.max(delay, minDelayMs), delayCap);

      await options.onRetry?.({ ...context, delayMs: delay });
      if (delay > 0) {
        await sleep(delay);
      }
    }
  }

  throw toRetryError(attemptErrors.at(-1) ?? new Error('Retry failed'));
}

// ==================== RetrySupervisor 有状态控制器 ====================

/**
 * 有状态重试控制器。
 *
 * 适用于需要外部控制重试节奏的场景（如 agentLoop 的工具调用重试）。
 * 提供 cancel / reset / next 接口，支持 AbortSignal 集成。
 */
export class RetrySupervisor {
  attempts = 0;
  nextDelayOverrideMs: number | undefined;
  private initialMs: number;
  private pendingAbort: AbortController | undefined;

  constructor(
    private readonly policy: BackoffPolicy,
    private readonly maxAttempts = Number.POSITIVE_INFINITY
  ) {
    this.initialMs = policy.initialMs;
  }

  reset(initialMs = this.policy.initialMs): void {
    this.cancel();
    this.attempts = 0;
    this.initialMs = initialMs;
    this.nextDelayOverrideMs = undefined;
  }

  cancel(reason: unknown = new Error('retry cancelled')): void {
    this.pendingAbort?.abort(reason);
    this.pendingAbort = undefined;
  }

  /**
   * 获取下一次重试的延迟与中止信号。
   * @returns undefined 表示已达上限；否则返回 { attempt, delayMs, signal }
   */
  next(abortSignal?: AbortSignal): { attempt: number; delayMs: number; signal: AbortSignal } | undefined {
    const override = this.nextDelayOverrideMs;
    this.nextDelayOverrideMs = undefined;
    if (override === undefined && ++this.attempts > Math.ceil(this.maxAttempts)) {
      return undefined;
    }
    const attempt = Math.max(this.attempts, 1);
    const delayMs =
      override ?? computeBackoff({ ...this.policy, initialMs: this.initialMs }, attempt);
    this.cancel();
    const pendingAbort = new AbortController();
    this.pendingAbort = pendingAbort;
    return {
      attempt,
      delayMs,
      signal: abortSignal
        ? AbortSignal.any([pendingAbort.signal, abortSignal])
        : pendingAbort.signal,
    };
  }
}
