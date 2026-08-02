/**
 * 故障转移策略 —— 错误分类、指数退避重试、Provider 切换
 *
 * 来源：spec §二 Task 10（故障转移策略后端）
 * 决策：自研（spec §三无对应 openclaw 文件）。
 *
 * 职责：
 *  1. classifyError：将错误消息分类为 transient / non_transient / detectable
 *  2. exponentialBackoffRetry：对瞬态错误进行指数退避重试（最多 3 次，1s/2s/4s）
 *  3. selectNextProvider：从 fallbackProviders 列表中选择下一个 provider
 *  4. delay：可测试的延迟函数
 *
 * 设计约束：
 *  - 纯函数模块，不持有状态，状态由调用方管理
 *  - 不修改现有 ChatEngine 或 AIService 的错误处理逻辑（独立模块，后续集成）
 *  - 所有重试/切换通过 logger 记录审计日志
 *  - 指数退避使用 delay 函数，不使用 setTimeout 直接调用（便于测试）
 */

import { createLogger } from '../logger';

const logger = createLogger('failover-policy');

// ==================== 常量 ====================

/** 最大重试次数 */
export const MAX_RETRIES = 3;

/** 指数退避延迟数组（毫秒），对应第 1/2/3 次重试 */
export const RETRY_DELAYS_MS = [1000, 2000, 4000];

/** 上下文窗口硬性最小 token 数（低于此值必须压缩或裁剪） */
export const HARD_MIN_TOKENS = 4000;

/** 上下文窗口警告阈值（低于此值显示黄色警告） */
export const WARN_BELOW_TOKENS = 8000;

// ==================== 类型定义 ====================

/**
 * 故障转移错误分类。
 *
 * - transient：瞬态错误（限流、超时、服务过载），可通过重试解决
 * - non_transient：非瞬态错误（认证失败、模型不存在），需切换 provider
 * - detectable：可探测错误（服务端内部错误），可重试但重试次数减半
 */
export type FailoverErrorCategory = 'transient' | 'non_transient' | 'detectable';

/**
 * 分类后的错误信息。
 */
export interface ClassifiedError {
  /** 错误分类 */
  category: FailoverErrorCategory;
  /** 是否可重试 */
  isRetryable: boolean;
  /** 是否应切换 provider */
  shouldSwitchProvider: boolean;
  /** 原始错误消息 */
  message: string;
  /** 最大重试次数（detectable 类别减半） */
  maxRetries: number;
}

/**
 * 备用 Provider 配置。
 */
export interface FallbackProvider {
  /** Provider 标识（如 'openai' / 'anthropic' / 'local'） */
  provider: string;
  /** 模型名称 */
  model: string;
  /** API Key */
  apiKey: string;
  /** Base URL */
  baseUrl: string;
}

// ==================== 错误分类 ====================

/**
 * 将错误消息分类为 transient / non_transient / detectable。
 *
 * 分类规则：
 * - transient（瞬态）：rate_limit / 429 / timeout / timed out / overloaded / 503 / 502 /
 *   network / connection / econnreset / econnrefused / socket / enotfound / eai_again
 *   → isRetryable=true, shouldSwitchProvider=false, maxRetries=MAX_RETRIES
 *
 * - non_transient（非瞬态）：auth / 401 / 403 / api key / invalid key / model_not_found /
 *   model not found / invalid model
 *   → isRetryable=false, shouldSwitchProvider=true, maxRetries=0
 *
 * - detectable（可探测）：500 / server error / internal error
 *   → isRetryable=true, shouldSwitchProvider=false, maxRetries=减半（1次）
 *
 * - 其他 → non_transient, shouldSwitchProvider=true
 *
 * @param errorMessage 原始错误消息
 * @returns 分类后的错误信息
 */
export function classifyError(errorMessage: string): ClassifiedError {
  const msg = (errorMessage || '').toLowerCase();

  // 瞬态错误：限流、超时、过载、网络问题
  const transientKeywords = [
    'rate_limit', 'rate limit', '429', 'too many requests',
    'timeout', 'timed out',
    'overloaded',
    '503', 'service unavailable',
    '502', 'bad gateway',
    'network', 'connection', 'econnreset', 'econnrefused',
    'socket', 'enotfound', 'eai_again',
  ];
  if (transientKeywords.some((kw) => msg.includes(kw))) {
    return {
      category: 'transient',
      isRetryable: true,
      shouldSwitchProvider: false,
      message: errorMessage,
      maxRetries: MAX_RETRIES,
    };
  }

  // 非瞬态错误：认证失败、模型不存在
  const nonTransientKeywords = [
    'auth', '401', '403', 'unauthorized', 'forbidden',
    'api key', 'invalid key', 'api_key_invalid',
    'model_not_found', 'model not found', 'invalid model',
  ];
  if (nonTransientKeywords.some((kw) => msg.includes(kw))) {
    return {
      category: 'non_transient',
      isRetryable: false,
      shouldSwitchProvider: true,
      message: errorMessage,
      maxRetries: 0,
    };
  }

  // 可探测错误：服务端内部错误（可重试，但重试次数减半）
  const detectableKeywords = ['500', 'server error', 'internal error', 'internal server error'];
  if (detectableKeywords.some((kw) => msg.includes(kw))) {
    return {
      category: 'detectable',
      isRetryable: true,
      shouldSwitchProvider: false,
      message: errorMessage,
      maxRetries: Math.floor(MAX_RETRIES / 2), // 减半 → 1 次
    };
  }

  // 默认：非瞬态，切换 provider
  return {
    category: 'non_transient',
    isRetryable: false,
    shouldSwitchProvider: true,
    message: errorMessage,
    maxRetries: 0,
  };
}

// ==================== 延迟函数 ====================

/**
 * 延迟指定毫秒数。
 *
 * 使用 Promise 封装 setTimeout，便于测试时 mock。
 *
 * @param ms 延迟毫秒数
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== 指数退避重试 ====================

/**
 * 指数退避重试泛型函数。
 *
 * 对瞬态错误按 1s/2s/4s 间隔重试，最多 MAX_RETRIES 次。
 * 每次重试通过 logger 记录审计日志。
 *
 * @param operation 要重试的异步操作
 * @param options 配置选项
 * @returns 操作结果
 * @throws 当所有重试耗尽后抛出最后一个错误
 */
export async function exponentialBackoffRetry<T>(
  operation: () => Promise<T>,
  options?: {
    /** 最大重试次数（默认 MAX_RETRIES） */
    maxRetries?: number;
    /** 重试延迟数组（默认 RETRY_DELAYS_MS） */
    delays?: number[];
    /** 自定义判断是否应该重试的函数（默认根据 classifyError 判断 isRetryable） */
    shouldRetry?: (error: Error, attempt: number) => boolean;
    /** 重试回调（用于审计日志 / 事件通知） */
    onRetry?: (error: Error, attempt: number, nextDelayMs: number) => void;
    /** 上下文标签（用于日志标识） */
    contextLabel?: string;
  },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES;
  const delays = options?.delays ?? RETRY_DELAYS_MS;
  const shouldRetry = options?.shouldRetry ?? ((error: Error) => {
    const classified = classifyError(error.message);
    return classified.isRetryable;
  });
  const onRetry = options?.onRetry;
  const label = options?.contextLabel ?? 'operation';

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // 最后一次尝试不再判断重试
      if (attempt >= maxRetries) {
        logger.error(
          `${label} exhausted all retries`,
          lastError.message,
          { attempt: attempt + 1, maxAttempts: maxRetries + 1 },
        );
        break;
      }

      // 判断是否应该重试
      if (!shouldRetry(lastError, attempt)) {
        logger.warn(
          `${label} error not retryable, aborting retries`,
          lastError.message,
          { attempt: attempt + 1, category: classifyError(lastError.message).category },
        );
        break;
      }

      const delayMs = delays[attempt] ?? delays[delays.length - 1];

      // 审计日志：记录重试事件
      logger.warn(
        `${label} retrying after error`,
        lastError.message,
        { attempt: attempt + 1, nextDelayMs: delayMs, maxRetries },
      );

      if (onRetry) {
        onRetry(lastError, attempt + 1, delayMs);
      }

      await delay(delayMs);
    }
  }

  throw lastError ?? new Error(`${label} failed with unknown error`);
}

// ==================== Provider 切换 ====================

/**
 * 从 fallbackProviders 列表中选择下一个 provider。
 *
 * 策略：循环选择（round-robin），从当前 provider 的下一个位置开始。
 * 选择结果通过 logger 记录审计日志。
 *
 * @param fallbackProviders 备用 provider 列表
 * @param currentProviderId 当前使用的 provider 标识（可选）
 * @returns 下一个 provider，无可用时返回 null
 */
export function selectNextProvider(
  fallbackProviders: FallbackProvider[],
  currentProviderId?: string,
): FallbackProvider | null {
  if (!fallbackProviders || fallbackProviders.length === 0) {
    logger.warn('selectNextProvider: no fallback providers available');
    return null;
  }

  // 无当前 provider，返回第一个
  if (!currentProviderId) {
    const next = fallbackProviders[0];
    logger.info('selectNextProvider: selecting first provider', undefined, {
      provider: next.provider,
      model: next.model,
    });
    return next;
  }

  // 找到当前 provider 的索引，返回下一个（循环）
  const currentIndex = fallbackProviders.findIndex((p) => p.provider === currentProviderId);
  if (currentIndex === -1) {
    // 当前 provider 不在列表中，返回第一个
    const next = fallbackProviders[0];
    logger.info('selectNextProvider: current provider not in list, selecting first', undefined, {
      currentProviderId,
      nextProvider: next.provider,
      model: next.model,
    });
    return next;
  }

  const nextIndex = (currentIndex + 1) % fallbackProviders.length;
  const next = fallbackProviders[nextIndex];
  logger.info('selectNextProvider: switching to next provider', undefined, {
    from: currentProviderId,
    to: next.provider,
    model: next.model,
  });
  return next;
}
