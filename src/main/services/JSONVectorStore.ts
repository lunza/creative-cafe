import { getStorageService } from './storageService';
import { VectorItem, SearchResult, VectorStoreMode } from '../types/vectorConfig';
import { cosineSimilarity } from '../utils/vectorMath';
import * as fs from 'fs';
import path from 'path';

const STORE_FILE = 'vecstore.json';

export class JSONVectorStore {
  private vectors: Map<string, VectorItem> = new Map();
  private storeMode: VectorStoreMode = 'json';
  private vectorsFilePath: string;

  constructor() {
    // Store in app data directory for persistence
    const userDataPath = process.platform === 'win32' 
      ? path.join(process.env.APPDATA || '', 'creative-cafe')
      : path.join(process.env.HOME || '', '.config', 'creative-cafe');
    this.vectorsFilePath = path.join(userDataPath, STORE_FILE);
  }

  getStoreFilePath(): string {
    return this.vectorsFilePath;
  }

  async initialize(): Promise<void> {
    try {
      console.log(`[JSONVectorStore] Initializing from disk: ${this.vectorsFilePath}`);
      
      // Try to load from disk first for persistence
      if (fs.existsSync(this.vectorsFilePath)) {
        console.log(`[JSONVectorStore] Loading existing vectors from disk...`);
        const data = fs.readFileSync(this.vectorsFilePath, 'utf-8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            this.vectors.set(item.id, item);
          }
          console.log(`[JSONVectorStore] Loaded ${this.vectors.size} vectors from disk`);
        }
      }
      
      // Fall back to storageService if disk file doesn't exist
      if (this.vectors.size === 0) {
        console.log(`[JSONVectorStore] No disk file found, checking storageService...`);
        const storageService = getStorageService();
        const data = storageService.get<any[]>('vectors');
        if (data && Array.isArray(data)) {
          for (const item of data) {
            this.vectors.set(item.id, item);
          }
          console.log(`[JSONVectorStore] Loaded ${this.vectors.size} vectors from storageService`);
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

  async addBatchNoPersist(items: { id: string; vector: number[]; metadata: Record<string, any> }[]): Promise<void> {
    for (const item of items) {
      const vectorItem: VectorItem = {
        id: item.id,
        vector: item.vector,
        metadata: {
          text: item.metadata.text || '',
          source: item.metadata.source || 'unknown',
          sourceId: item.metadata.sourceId || item.id,
          ...item.metadata,
          createdAt: item.metadata.createdAt || Date.now(),
          updatedAt: Date.now()
        }
      };
      this.vectors.set(item.id, vectorItem);
    }
    await this.persist();
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
      const data = Array.from(this.vectors.values());
      
      // Save to disk for persistence
      fs.writeFileSync(this.vectorsFilePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`[JSONVectorStore] Persisted ${data.length} vectors to disk: ${this.vectorsFilePath}`);
      
      // Also save to storageService for compatibility
      const storageService = getStorageService();
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
