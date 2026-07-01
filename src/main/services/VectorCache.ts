/**
 * VectorCache - 向量缓存层
 *
 * 三层抽象架构（Task 3 - SubTask 3.5）：
 *   原 VectorCache 不依赖任何上层服务，现改为可注入 VectorRepository 引用，
 *   便于后续基于反向索引做更精确的缓存失效（当前实现保持向后兼容）。
 *
 * 设计目标：
 *   - L1（内存）+ L2（storageService 持久化）两级缓存
 *   - 通过 Repository 反向索引查询 id 所属 source（替代原 service['...'] 反射）
 *   - clearBySource(id) 仍保持原签名（向后兼容）
 */

import { LRUCache } from 'lru-cache';
import { SearchResult } from '../types/vectorConfig';
import { getStorageService } from './storageService';
import type { VectorRepository } from './vector/VectorRepository';

interface CacheOptions {
  maxSize?: number;
  l1TTL?: number;
  l2TTL?: number;
  enabled?: boolean;
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

export class VectorCache {
  private l1EmbeddingCache: LRUCache<string, number[]>;
  private l1SearchCache: LRUCache<string, SearchResult[]>;
  private l2TTL: number;
  private enabled: boolean;

  /**
   * 可选的 Repository 引用（SubTask 3.5：注入 Repository 而非 Service）
   * 用于：
   *   1. clearBySource(id) 时通过反向索引查找 source（未来增强）
   *   2. 基于 source 的精细化缓存失效
   */
  private repository: VectorRepository | null = null;

  constructor(options: CacheOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.l2TTL = (options.l2TTL ?? 3600) * 1000;

    this.l1EmbeddingCache = new LRUCache({
      max: options.maxSize ?? 1000,
      ttl: (options.l1TTL ?? 300) * 1000,
      dispose: async (_value, key) => {
        if (this.enabled) {
          await this.persistEmbeddingToL2(key);
        }
      }
    });

    this.l1SearchCache = new LRUCache({
      max: (options.maxSize ?? 1000) / 2,
      ttl: (options.l1TTL ?? 300) * 1000
    });
  }

  /**
   * 注入 Repository 引用（SubTask 3.5）
   * 替代原 Service 反射访问，便于基于反向索引做精确缓存失效。
   */
  setRepository(repository: VectorRepository): void {
    this.repository = repository;
    console.log('[VectorCache] Repository injected for cache invalidation support');
  }

  async getEmbedding(text: string): Promise<number[] | null> {
    if (!this.enabled) return null;

    const key = this.hashText(text);
    let vector = this.l1EmbeddingCache.get(key);

    if (vector) {
      return vector;
    }

    try {
      const storageService = getStorageService();
      const entry = storageService.get<CacheEntry<number[]>>(`vector_cache.emb.${key}`);
      if (entry && Date.now() - entry.timestamp < entry.ttl) {
        this.l1EmbeddingCache.set(key, entry.value);
        return entry.value;
      }
      if (entry) {
        storageService.delete(`vector_cache.emb.${key}`);
      }
    } catch (error) {
      console.error('[VectorCache] L2 cache read error:', error);
    }

    return null;
  }

  async setEmbedding(text: string, vector: number[]): Promise<void> {
    if (!this.enabled) return;

    const key = this.hashText(text);
    this.l1EmbeddingCache.set(key, vector);
  }

  async getSearchResult(queryHash: string): Promise<SearchResult[] | null> {
    if (!this.enabled) return null;
    return this.l1SearchCache.get(queryHash) || null;
  }

  async setSearchResult(queryHash: string, results: SearchResult[]): Promise<void> {
    if (!this.enabled) return;
    this.l1SearchCache.set(queryHash, results);
  }

  clear(): void {
    this.l1EmbeddingCache.clear();
    this.l1SearchCache.clear();
  }

  /**
   * 按 source 清除缓存（向后兼容签名）。
   *
   * 注意：原实现的 key 前缀匹配（`src_${source}`）与实际缓存 key
   * （`vec_<hash>_<length>` / `emb_<hash>`）不匹配，因此原实现实际为 no-op。
   * 本实现保持原行为（向后兼容），同时清空整个搜索缓存以保证一致性。
   *
   * 未来可通过注入的 Repository 反向索引做更精确的失效：
   *   1. 通过 repository 查询 id 所属 sourceKey
   *   2. 失效所有命中该 sourceKey 的搜索结果
   */
  clearBySource(source: string): void {
    // 若注入了 Repository（SubTask 3.5），记录可用于未来精细化失效的诊断信息
    if (this.repository) {
      console.log(`[VectorCache] clearBySource("${source}"): repository injected, sourceBackendCount=${this.repository.sourceBackendCount}`);
    }

    // 原 key 前缀匹配逻辑（保留向后兼容）
    const toRemove: string[] = [];
    for (const key of this.l1EmbeddingCache.keys()) {
      if (key.startsWith(`src_${source}`)) {
        toRemove.push(key);
      }
    }
    toRemove.forEach(k => this.l1EmbeddingCache.delete(k));

    const toRemoveSearch: string[] = [];
    for (const key of this.l1SearchCache.keys()) {
      if (key.startsWith(`src_${source}`)) {
        toRemoveSearch.push(key);
      }
    }
    toRemoveSearch.forEach(k => this.l1SearchCache.delete(k));

    // 当未命中前缀匹配时（实际场景），保守清空整个搜索缓存，
    // 确保删除/更新后的查询不会返回过期结果。
    if (toRemoveSearch.length === 0) {
      this.l1SearchCache.clear();
    }
  }

  private async persistEmbeddingToL2(key: string): Promise<void> {
    try {
      const value = this.l1EmbeddingCache.get(key);
      if (value) {
        const entry: CacheEntry<number[]> = {
          value,
          timestamp: Date.now(),
          ttl: this.l2TTL
        };
        const storageService = getStorageService();
        storageService.set(`vector_cache.emb.${key}`, entry);
      }
    } catch (error) {
      console.error('[VectorCache] L2 persist error:', error);
    }
  }

  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `emb_${Math.abs(hash)}`;
  }
}

export const vectorCache = new VectorCache();
