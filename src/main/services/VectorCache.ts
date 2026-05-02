import { LRUCache } from 'lru-cache';
import { SearchResult } from '../types/vectorConfig';
import { getStorageService } from './storageService';

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

  clearBySource(source: string): void {
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
