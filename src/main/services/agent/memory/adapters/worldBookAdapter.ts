/**
 * WorldBook 记忆适配器 —— 桥接 worldBookService 到 IMemoryAdapter
 *
 * 来源：spec §二 Task 8.3（adapters/worldBookAdapter）
 * 决策：适配（spec §三）。现有 worldBookService 已实现关键词匹配 + 向量检索，
 *       本适配器将其结果转换为 MemoryEntry 格式，供 MemoryStore 统一检索。
 *
 * 职责：
 *  1. 桥接 worldBookService.matchKeywords → MemoryEntry[]（关键词检索）
 *  2. 桥接 worldBookService.searchWorldBookEntriesByVector → MemoryEntry[]（向量检索）
 *  3. 仅提供只读检索，写入走原 worldBookService（保持数据一致性）
 *
 * 设计约束（spec §5.1 双轨并行）：
 *  - 不修改 worldBookService 源码
 *  - 适配器失败不中断 MemoryStore.search（降级：跳过）
 */

import type { MemoryEntry, MemoryQuery, MemoryType } from '../../contracts';
import type { IMemoryAdapter } from '../memoryStore';

// ==================== WorldBook 适配器 ====================

/**
 * WorldBook 服务接口（worldBookService 的子集，用于解耦）。
 *
 * 仅声明适配器需要的方法，避免直接依赖具体实现。
 */
export interface IWorldBookService {
  /** 关键词匹配检索 */
  matchKeywords(text: string, worldBookPaths?: string[]): Promise<unknown[]>;
  /** 向量检索 */
  searchWorldBookEntriesByVector(query: string, topK?: number): Promise<unknown[]>;
  /** 读取世界书内容 */
  readWorldBook(filePath: string): Promise<{ entries?: Record<string, unknown> } | null>;
}

/**
 * WorldBook 记忆适配器。
 *
 * 将 worldBookService 的检索结果转换为 MemoryEntry 格式。
 * type='lore'（世界书条目）。
 */
export class WorldBookAdapter implements IMemoryAdapter {
  readonly type: MemoryType = 'lore';

  constructor(private readonly worldBookService: IWorldBookService) {}

  async search(query: MemoryQuery): Promise<MemoryEntry[]> {
    const limit = query.limit ?? 10;
    const results: MemoryEntry[] = [];

    try {
      // 1. 关键词检索
      const keywordMatches = await this.worldBookService.matchKeywords(query.query);
      for (const match of keywordMatches) {
        const entry = this.toMemoryEntry(match);
        if (entry) results.push(entry);
      }

      // 2. 向量检索（若关键词结果不足）
      if (results.length < limit) {
        const vectorMatches = await this.worldBookService.searchWorldBookEntriesByVector(
          query.query,
          limit
        );
        for (const match of vectorMatches) {
          const entry = this.toMemoryEntry(match);
          if (entry && !results.some(r => r.source === entry.source)) {
            results.push(entry);
          }
        }
      }

      return results.slice(0, limit);
    } catch (err) {
      console.warn('[WorldBookAdapter] search failed:', err);
      return [];
    }
  }

  async read(source: string): Promise<MemoryEntry | null> {
    try {
      // source 格式：worldBook:<filePath>:<entryKey>
      const parts = source.split(':');
      if (parts.length < 3) return null;
      const [, filePath, entryKey] = parts;
      const book = await this.worldBookService.readWorldBook(filePath);
      if (!book?.entries) return null;
      const entry = (book.entries as Record<string, unknown>)[entryKey];
      return entry ? this.toMemoryEntry(entry, source) : null;
    } catch (err) {
      console.warn('[WorldBookAdapter] read failed:', err);
      return null;
    }
  }

  /**
   * 将 worldBook 条目转换为 MemoryEntry。
   *
   * 兼容多种返回格式（matchKeywords / searchWorldBookEntriesByVector / readWorldBook）。
   */
  private toMemoryEntry(raw: unknown, explicitSource?: string): MemoryEntry | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const content = String(obj.content ?? obj.text ?? '');
    if (!content) return null;

    const entryKey = String(obj.uid ?? obj.id ?? obj.name ?? 'unknown');
    const source = explicitSource ?? `worldBook:${entryKey}`;
    const score = typeof obj.score === 'number' ? obj.score : undefined;

    return {
      id: `lore_${entryKey}`,
      type: 'lore',
      content,
      source,
      score,
      metadata: {
        keys: obj.key,
        secondaryKeys: obj.secondaryKeys,
        tags: obj.tags,
        comment: obj.comment,
      },
      timestamp: Date.now(),
    };
  }
}
