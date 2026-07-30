/**
 * 基础设施 barrel export —— 智能体底座 infra 模块统一出口
 *
 * 按需导出，避免循环依赖。import 路径示例：
 *   import { retryAsync, createDedupeCache, AgentError, openAgentDatabase } from './infra';
 */

// 退避策略
export { computeBackoff, sleepWithAbort, type BackoffPolicy } from './backoff';

// 重试运行器
export {
  retryAsync,
  RetrySupervisor,
  resolveRetryConfig,
  toRetryError,
  type RetryConfig,
  type RetryInfo,
  type RetryOptions,
} from './retry';

// 去重缓存
export {
  createDedupeCache,
  resolveGlobalDedupeCache,
  type DedupeCache,
  type DedupeCacheOptions,
} from './dedupe';

// 错误分类
export {
  AgentError,
  errors,
  toAgentError,
  getDefaultRetryable,
  fromHttpStatusCode,
  type ErrorCategory,
} from './errors';

// SQLite 工具
export {
  openAgentDatabase,
  runTransaction,
  ensureSchema,
  prepareStatement,
  type SqliteDatabase,
  type SqliteStatement,
} from './sqliteUtils';
