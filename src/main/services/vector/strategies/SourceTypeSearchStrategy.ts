/**
 * SourceTypeSearchStrategy - 按 sourceType 搜索策略
 *
 * 三层抽象架构（Task 3 - SubTask 3.4）：
 *   原 VectorStoreService.SourceTypeSearchStrategy 类迁出到此独立文件。
 *
 * 行为保持：
 *   在指定 sourceType 的 backend 上执行 search。
 */

import type { SearchResult } from '../../../types/vectorConfig';
import type { SearchStrategy, SearchStrategyContext } from './SearchStrategy';

export class SourceTypeSearchStrategy implements SearchStrategy {
  constructor(
    private ctx: SearchStrategyContext,
    private sourceType: string
  ) {}

  async search(query: number[], topK: number, filter?: Record<string, any>): Promise<SearchResult[]> {
    // 在 sourceType 同名的 source 上搜索（保持原行为：sourceId = sourceType）
    return this.ctx.searchSource(this.sourceType, this.sourceType, query, topK, filter);
  }
}
