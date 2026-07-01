/**
 * 向量存储三层抽象架构 - 统一 re-export（Task 3）
 *
 * 架构层级（自下而上）：
 *   IVectorBackend        - 单源存储后端契约（WASM/SQLite/远程 等可替换）
 *   VectorRepository      - 多源路由 + 反向索引 Map<id, sourceKey>
 *   VectorStoreService    - Facade（缓存 + Strategy + IPC 适配）- 位于上层 services/VectorStoreService.ts
 *
 * 策略类位于 strategies/ 子目录。
 *
 * 使用方式：
 *   import { IVectorBackend, VectorRepository } from './vector';
 *   import { VecstoreBackend } from './VecstoreVectorStore';
 */

// 接口
export type { IVectorBackend, DimensionChangeEvent } from './IVectorBackend';
export { VECTOR_DIMENSION_CHANGE_EVENT } from './IVectorBackend';

// 仓储
export { VectorRepository } from './VectorRepository';
export type {
  RepositoryBackendEntry,
  IdReverseIndexEntry,
  BackendFactory,
} from './VectorRepository';

// 策略
export type {
  BatchProcessingStrategy,
  SearchStrategy,
  SearchStrategyContext,
} from './strategies';
export {
  NormalBatchStrategy,
  DeferredBatchStrategy,
  NoPersistBatchStrategy,
  ScopeIdsSearchStrategy,
  SourceTypeSearchStrategy,
  AggregateSearchStrategy,
} from './strategies';
