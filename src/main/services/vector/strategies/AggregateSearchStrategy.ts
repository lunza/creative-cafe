/**
 * AggregateSearchStrategy - 聚合搜索策略
 *
 * 三层抽象架构（Task 3 - SubTask 3.4）：
 *   原 VectorStoreService.AggregateSearchStrategy 类迁出到此独立文件。
 *
 * 行为保持：
 *   在默认 backend 和所有 source backend 上各执行 search(topK*2)，
 *   合并后按相似度排序取 topK。
 *
 * 修复点：
 *   原代码使用 `this.service['vecstoreStore']` / `this.service['storeBySource']` 反射访问私有字段，
 *   改为通过 SearchStrategyContext 接口的 searchDefault / searchAll 调用。
 */

import type { SearchResult } from '../../../types/vectorConfig';
import type { SearchStrategy, SearchStrategyContext } from './SearchStrategy';

export class AggregateSearchStrategy implements SearchStrategy {
  constructor(private ctx: SearchStrategyContext) {}

  async search(query: number[], topK: number, filter?: Record<string, any>): Promise<SearchResult[]> {
    return this.ctx.searchAll(query, topK, filter);
  }
}
