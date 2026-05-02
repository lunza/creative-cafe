import { getStorageService } from './storageService';
import { VectorItem, SearchResult, VectorStoreMode } from '../types/vectorConfig';
import { cosineSimilarity } from '../utils/vectorMath';

export class JSONVectorStore {
  private vectors: Map<string, VectorItem> = new Map();
  private storeMode: VectorStoreMode = 'json';

  async initialize(): Promise<void> {
    try {
      const storageService = getStorageService();
      const data = storageService.get<any[]>('vectors');
      if (data && Array.isArray(data)) {
        for (const item of data) {
          this.vectors.set(item.id, item);
        }
      }
    } catch (error) {
      console.error('[JSONVectorStore] 初始化失败:', error);
    }
  }

  async add(id: string, vector: number[], metadata: Record<string, any>): Promise<void> {
    const item: VectorItem = {
      id,
      vector,
      metadata: {
        text: metadata.text || '',
        source: metadata.source || 'unknown',
        sourceId: metadata.sourceId || id,
        ...metadata,
        createdAt: metadata.createdAt || Date.now(),
        updatedAt: Date.now()
      }
    };
    this.vectors.set(id, item);
    await this.persist();
  }

  async addBatch(items: { id: string; vector: number[]; metadata: Record<string, any> }[]): Promise<void> {
    for (const item of items) {
      await this.add(item.id, item.vector, item.metadata);
    }
  }

  async search(query: number[], topK: number, filter?: Record<string, any>): Promise<SearchResult[]> {
    let items = Array.from(this.vectors.values());

    if (filter) {
      items = items.filter(item => {
        for (const [key, value] of Object.entries(filter)) {
          if (item.metadata[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    const results: SearchResult[] = items.map(item => ({
      id: item.id,
      score: cosineSimilarity(query, item.vector),
      metadata: item.metadata
    }));

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async update(id: string, vector: number[], metadata?: Record<string, any>): Promise<void> {
    const item = this.vectors.get(id);
    if (!item) {
      throw new Error(`向量 ${id} 不存在`);
    }
    item.vector = vector;
    if (metadata) {
      item.metadata = { ...item.metadata, ...metadata, updatedAt: Date.now() };
    }
    this.vectors.set(id, item);
    await this.persist();
  }

  async delete(id: string): Promise<void> {
    this.vectors.delete(id);
    await this.persist();
  }

  async count(): Promise<number> {
    return this.vectors.size;
  }

  getMode(): VectorStoreMode {
    return this.storeMode;
  }

  async rebuildIndex(): Promise<void> {
    await this.persist();
  }

  async persist(): Promise<void> {
    try {
      const storageService = getStorageService();
      const data = Array.from(this.vectors.values());
      storageService.set('vectors', data);
    } catch (error) {
      console.error('[JSONVectorStore] 持久化失败:', error);
    }
  }

  async load(): Promise<void> {
    await this.initialize();
  }

  async clear(): Promise<void> {
    this.vectors.clear();
    await this.persist();
  }

  async getById(id: string): Promise<VectorItem | null> {
    return this.vectors.get(id) || null;
  }

  async countByPrefix(prefix: string): Promise<number> {
    let count = 0;
    for (const id of this.vectors.keys()) {
      if (id.startsWith(prefix)) count++;
    }
    return count;
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const idsToDelete: string[] = [];
    for (const id of this.vectors.keys()) {
      if (id.startsWith(prefix)) idsToDelete.push(id);
    }
    for (const id of idsToDelete) {
      this.vectors.delete(id);
    }
    if (idsToDelete.length > 0) await this.persist();
    return idsToDelete.length;
  }
}

export const jsonVectorStore = new JSONVectorStore();
