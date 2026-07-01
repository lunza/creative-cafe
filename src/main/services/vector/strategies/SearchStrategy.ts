/**
 * SearchStrategy - 搜索策略接口
 *
 * 三层抽象架构（Task 3 - SubTask 3.4）：
 *   原 VectorStoreService.SearchStrategy 接口迁出到此独立文件。
 *
 * 设计目标：
 *   - 支持 scopeIds / sourceType / aggregate 等多种搜索模式
 *   - 策略可替换，不污染主 Facade
 */

import type { SearchResult } from '../../../types/vectorConfig';

export interface SearchStrategy {
  search(
    query: number[],
    topK: number,
    filter?: Record<string, any>
  ): Promise<SearchResult[]>;
}

/**
 * 搜索策略上下文接口：暴露策略所需的 Repository / 默认 backend 等访问能力
 */
export interface SearchStrategyContext {
  /** 默认 backend（含 search 方法） */
  searchDefault(query: number[], topK: number, filter?: Record<string, any>): Promise<SearchResult[]>;
  /** 在指定 source 上搜索 */
  searchSource(source: string, sourceId: string, query: number[], topK: number, filter?: Record<string, any>): Promise<SearchResult[]>;
  /** 在所有已注册 source 上搜索并合并 */
  searchAll(query: number[], topK: number, filter?: Record<string, any>): Promise<SearchResult[]>;
}
