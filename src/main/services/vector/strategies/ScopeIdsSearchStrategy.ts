/**
 * ScopeIdsSearchStrategy - 按 scopeIds 范围搜索策略
 *
 * 三层抽象架构（Task 3 - SubTask 3.4）：
 *   原 VectorStoreService.ScopeIdsSearchStrategy 类迁出到此独立文件。
 *
 * 行为保持：
 *   对每个 scopeId 通过 VectorRegistryService 查找对应 source/sourceId，
 *   在对应 backend 上执行 search(topK*2)，最后合并并按相似度排序取 topK。
 */

import type { SearchResult } from '../../../types/vectorConfig';
import type { SearchStrategy, SearchStrategyContext } from './SearchStrategy';

export class ScopeIdsSearchStrategy implements SearchStrategy {
  constructor(
    private ctx: SearchStrategyContext,
    private scopeIds: string[]
  ) {}

  async search(query: number[], topK: number, filter?: Record<string, any>): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];

    for (const scopeId of this.scopeIds) {
      // 通过 Registry 查找 scopeId 对应的 source/sourceId
      const { vectorRegistryService } = await import('../../VectorRegistryService');
      const entry = await vectorRegistryService.getVectorFileById(scopeId);
      if (entry) {
        const scopeResults = await this.ctx.searchSource(
          entry.sourceType,
          entry.sourceId,
          query,
          topK * 2,
          filter
        );
        allResults.push(...scopeResults);
      }
    }

    return allResults.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
