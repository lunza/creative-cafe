/**
 * 策略类汇总导出（SubTask 3.4）
 *
 * 三层抽象架构（Task 3）：
 *   所有 Strategy 类从此文件统一 re-export，便于上层 Facade 一次性 import。
 */

export type { BatchProcessingStrategy } from './BatchProcessingStrategy';
export { NormalBatchStrategy } from './NormalBatchStrategy';
export { DeferredBatchStrategy } from './DeferredBatchStrategy';
export { NoPersistBatchStrategy } from './NoPersistBatchStrategy';

export type { SearchStrategy, SearchStrategyContext } from './SearchStrategy';
export { ScopeIdsSearchStrategy } from './ScopeIdsSearchStrategy';
export { SourceTypeSearchStrategy } from './SourceTypeSearchStrategy';
export { AggregateSearchStrategy } from './AggregateSearchStrategy';
