import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import init, { WasmVecStore } from 'vecstore-wasm';
import { VectorItem, SearchResult, VectorStoreMode } from '../types/vectorConfig';

const STORE_FILE = 'vecstore.json';

export class VecstoreVectorStore {
  private store: WasmVecStore | null = null;
  private dimension: number = 384;
  private storeMode: VectorStoreMode = 'vecstore';
  private initialized = false;
  private wasmReady = false;

  async initialize(): Promise<void> {
    try {
      if (this.initialized) return;

      console.log('[VecstoreVectorStore] Initializing WASM module...');
      await init();
      this.wasmReady = true;

      const storePath = this.getStoreFilePath();
      this.store = new WasmVecStore(this.dimension);

      if (fs.existsSync(storePath)) {
        const data = fs.readFileSync(storePath, 'utf-8');
        this.store.import_json(data);
        console.log(`[VecstoreVectorStore] Loaded ${this.store.len()} vectors from disk`);
      } else {
        console.log('[VecstoreVectorStore] Created new empty store');
      }

      this.initialized = true;
    } catch (error) {
      console.error('[VecstoreVectorStore] 初始化失败:', error);
      throw error;
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('VecstoreVectorStore 尚未初始化');
    }
  }

  private getStoreFilePath(): string {
    return path.join(app.getPath('userData'), STORE_FILE);
  }

  async add(id: string, vector: number[], metadata: Record<string, any>): Promise<void> {
    this.ensureInitialized();
    if (!this.store) return;

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

    this.store.upsert(id, new Float32Array(vector), item.metadata);

    if (metadata.text) {
      this.store.index_text(id, metadata.text);
    }

    await this.persist();
  }

  async addBatch(items: { id: string; vector: number[]; metadata: Record<string, any> }[]): Promise<void> {
    this.ensureInitialized();
    for (const item of items) {
      await this.add(item.id, item.vector, item.metadata);
    }
  }

  async search(query: number[], topK: number, filter?: Record<string, any>): Promise<SearchResult[]> {
    this.ensureInitialized();
    if (!this.store) return [];

    let filterStr: string | null = null;
    if (filter) {
      const conditions = Object.entries(filter)
        .map(([key, value]) => `${key} = '${String(value).replace(/'/g, "''")}'`)
        .join(' AND ');
      filterStr = conditions || null;
    }

    const results = this.store.query(new Float32Array(query), topK, filterStr);

    return results.map((r: any) => ({
      id: r.id,
      score: r.score,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata
    }));
  }

  async update(id: string, vector: number[], metadata?: Record<string, any>): Promise<void> {
    this.ensureInitialized();
    if (!this.store) return;

    const existingMetadata = this.getMetadata(id);
    const updatedMetadata = metadata ? { ...existingMetadata, ...metadata, updatedAt: Date.now() } : existingMetadata;

    this.store.upsert(id, new Float32Array(vector), updatedMetadata);

    if (metadata?.text) {
      this.store.index_text(id, metadata.text);
    }

    await this.persist();
  }

  private getMetadata(id: string): Record<string, any> {
    if (!this.store) return {};

    const results = this.store.query(new Float32Array(384).fill(0), 1, null);
    for (const r of results) {
      if (r.id === id) {
        return typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata || {};
      }
    }
    return {};
  }

  async delete(id: string): Promise<void> {
    this.ensureInitialized();
    if (!this.store) return;

    this.store.remove(id);
    await this.persist();
  }

  async count(): Promise<number> {
    this.ensureInitialized();
    return this.store ? this.store.len() : 0;
  }

  getMode(): VectorStoreMode {
    return this.storeMode;
  }

  async rebuildIndex(): Promise<void> {
    await this.persist();
  }

  async persist(): Promise<void> {
    try {
      if (!this.store) return;

      const data = this.store.export_json();
      const storePath = this.getStoreFilePath();
      fs.writeFileSync(storePath, data, 'utf-8');
    } catch (error) {
      console.error('[VecstoreVectorStore] 持久化失败:', error);
    }
  }

  async load(): Promise<void> {
    await this.initialize();
  }

  async clear(): Promise<void> {
    this.ensureInitialized();
    if (!this.store) return;

    while (this.store.len() > 0) {
      const results = this.store.query(new Float32Array(this.dimension).fill(0), this.store.len(), null);
      for (const r of results) {
        this.store.remove(r.id);
      }
    }
    await this.persist();
  }

  async getById(id: string): Promise<VectorItem | null> {
    this.ensureInitialized();
    if (!this.store) return null;

    const results = this.store.query(new Float32Array(this.dimension).fill(0), this.store.len(), null);
    for (const r of results) {
      if (r.id === id) {
        return {
          id: r.id,
          vector: [],
          metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata
        };
      }
    }
    return null;
  }

  async countByPrefix(prefix: string): Promise<number> {
    this.ensureInitialized();
    if (!this.store) return 0;
    const results = this.store.query(new Float32Array(this.dimension).fill(0), this.store.len(), null);
    let count = 0;
    for (const r of results) {
      if (r.id.startsWith(prefix)) count++;
    }
    return count;
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    this.ensureInitialized();
    if (!this.store) return 0;
    const results = this.store.query(new Float32Array(this.dimension).fill(0), this.store.len(), null);
    const idsToDelete: string[] = [];
    for (const r of results) {
      if (r.id.startsWith(prefix)) idsToDelete.push(r.id);
    }
    for (const id of idsToDelete) {
      this.store.remove(id);
    }
    if (idsToDelete.length > 0) await this.persist();
    return idsToDelete.length;
  }

  async destroy(): Promise<void> {
    if (this.store) {
      this.store.free();
      this.store = null;
    }
    this.initialized = false;
  }
}

export const vecstoreVectorStore = new VecstoreVectorStore();
