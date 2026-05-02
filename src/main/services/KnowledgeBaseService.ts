import { ipcMain } from 'electron';
import { getStorageService } from './storageService';
import { KnowledgeItem, KnowledgeVersion, SearchOptions, SearchResult, EmbeddingMode } from '../types/vectorConfig';
import { embeddingService } from './EmbeddingService';
import { vectorStoreService } from './VectorStoreService';
import { VectorCache } from './VectorCache';

export class KnowledgeBaseService {
  private items: Map<string, KnowledgeItem> = new Map();
  private initialized = false;
  private cache: VectorCache;

  constructor() {
    this.cache = new VectorCache();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const storageService = getStorageService();
      const data = storageService.get<any[]>('knowledgeBase');
      if (data && Array.isArray(data)) {
        for (const item of data) {
          this.items.set(item.id, item);
        }
      }
      this.initialized = true;
    } catch (error) {
      console.error('[KnowledgeBaseService] 初始化失败:', error);
    }
  }

  async list(filter?: Record<string, any>, page: number = 1, pageSize: number = 20): Promise<{ items: KnowledgeItem[]; total: number }> {
    await this.ensureInitialized();

    let allItems = Array.from(this.items.values());

    if (filter) {
      allItems = allItems.filter(item => {
        for (const [key, value] of Object.entries(filter)) {
          if (key === 'category' && Array.isArray(value)) {
            if (!value.some(v => item.category.includes(v))) return false;
          } else if (key === 'tags' && Array.isArray(value)) {
            if (!value.some(v => item.tags.includes(v))) return false;
          } else if (item[key as keyof KnowledgeItem] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    const total = allItems.length;
    const start = (page - 1) * pageSize;
    const paginatedItems = allItems.slice(start, start + pageSize);

    return { items: paginatedItems, total };
  }

  async create(item: KnowledgeItem): Promise<string> {
    await this.ensureInitialized();

    const id = item.id || `kb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    const newItem: KnowledgeItem = {
      ...item,
      id,
      version: 1,
      history: [],
      metadata: {
        ...item.metadata,
        createdAt: now,
        updatedAt: now,
        createdBy: item.metadata?.createdBy || 'user'
      }
    };

    this.items.set(id, newItem);
    await this.persist();

    if (newItem.content) {
      await this.vectorizeItem(id);
    }

    return id;
  }

  async update(id: string, updates: Partial<KnowledgeItem>): Promise<boolean> {
    await this.ensureInitialized();

    const item = this.items.get(id);
    if (!item) {
      return false;
    }

    const oldVersion: KnowledgeVersion = {
      version: item.version,
      content: item.content,
      timestamp: Date.now(),
      note: (updates.metadata as any)?.versionNote || `版本 ${item.version} 备份`
    };

    item.history.push(oldVersion);
    item.version += 1;

    if (updates.title) item.title = updates.title;
    if (updates.content) item.content = updates.content;
    if (updates.source) item.source = updates.source;
    if (updates.category) item.category = updates.category;
    if (updates.tags) item.tags = updates.tags;
    if (updates.relatedCharacterIds) item.relatedCharacterIds = updates.relatedCharacterIds;
    if (updates.relatedWorldBookPaths) item.relatedWorldBookPaths = updates.relatedWorldBookPaths;

    item.metadata = {
      ...item.metadata,
      ...updates.metadata,
      updatedAt: Date.now()
    };

    this.items.set(id, item);
    await this.persist();

    if (updates.content) {
      await this.vectorizeItem(id);
    }

    return true;
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureInitialized();

    if (!this.items.has(id)) {
      return false;
    }

    this.items.delete(id);
    await vectorStoreService.delete(id);
    await this.persist();
    return true;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    await this.ensureInitialized();

    const topK = options?.topK || 10;
    const minScore = options?.minScore || 0.7;

    const embedResult = await embeddingService.generateEmbedding(query);
    if (!embedResult.success || !embedResult.vector) {
      return this.textSearch(query, topK);
    }

    const queryVector = embedResult.vector;

    let filter: Record<string, any> = { source: 'knowledge' };
    if (options?.categories && options.categories.length > 0) {
      filter.categories = options.categories;
    }
    if (options?.tags && options.tags.length > 0) {
      filter.tags = options.tags;
    }
    if (options?.characterId) {
      filter.characterId = options.characterId;
    }

    const vectorResults = await vectorStoreService.search(queryVector, topK * 2, filter);

    const filteredResults = vectorResults
      .filter(r => r.score >= minScore)
      .slice(0, topK);

    return filteredResults;
  }

  async vectorizeItem(id: string): Promise<boolean> {
    await this.ensureInitialized();

    const item = this.items.get(id);
    if (!item || !item.content) {
      return false;
    }

    const embedResult = await embeddingService.generateEmbedding(item.content);
    if (!embedResult.success || !embedResult.vector) {
      return false;
    }

    item.vector = embedResult.vector;
    item.metadata = {
      ...item.metadata,
      embeddingMode: 'remote',
      embeddingModel: embedResult.model || 'unknown',
      tokenCount: item.content.length
    };

    await vectorStoreService.add(id, embedResult.vector, {
      text: item.content,
      source: 'knowledge',
      sourceId: id,
      title: item.title,
      category: item.category,
      tags: item.tags,
      createdAt: item.metadata.createdAt,
      updatedAt: Date.now()
    });

    await this.persist();
    return true;
  }

  async vectorizeAll(): Promise<{ success: boolean; processed: number }> {
    await this.ensureInitialized();

    let processed = 0;
    for (const item of this.items.values()) {
      if (item.content && !item.vector) {
        const success = await this.vectorizeItem(item.id);
        if (success) processed++;
      }
    }

    return { success: true, processed };
  }

  async getVersion(id: string): Promise<KnowledgeVersion[]> {
    await this.ensureInitialized();

    const item = this.items.get(id);
    if (!item) {
      return [];
    }

    return item.history;
  }

  async restoreVersion(id: string, version: number): Promise<boolean> {
    await this.ensureInitialized();

    const item = this.items.get(id);
    if (!item) {
      return false;
    }

    const targetVersion = item.history.find(v => v.version === version);
    if (!targetVersion) {
      return false;
    }

    const currentVersion: KnowledgeVersion = {
      version: item.version,
      content: item.content,
      timestamp: Date.now(),
      note: `恢复到版本 ${version}`
    };

    item.history.push(currentVersion);
    item.content = targetVersion.content;
    item.version += 1;
    item.metadata.updatedAt = Date.now();

    this.items.set(id, item);
    await this.persist();

    await this.vectorizeItem(id);
    return true;
  }

  private async textSearch(query: string, topK: number): Promise<SearchResult[]> {
    const items = Array.from(this.items.values());
    const queryLower = query.toLowerCase();

    const results: SearchResult[] = items
      .filter(item =>
        item.title.toLowerCase().includes(queryLower) ||
        item.content.toLowerCase().includes(queryLower) ||
        item.tags.some(t => t.toLowerCase().includes(queryLower))
      )
      .map(item => ({
        id: item.id,
        score: 0.5,
        metadata: {
          text: item.content,
          source: 'knowledge',
          title: item.title,
          category: item.category,
          tags: item.tags
        }
      }));

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  private async persist(): Promise<void> {
    try {
      const storageService = getStorageService();
      const data = Array.from(this.items.values());
      storageService.set('knowledgeBase', data);
    } catch (error) {
      console.error('[KnowledgeBaseService] 持久化失败:', error);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  registerIpcHandlers(): void {
    ipcMain.handle('knowledge:list', async (_event, { filter, page, pageSize }: { filter?: Record<string, any>; page?: number; pageSize?: number }) => {
      try {
        await this.initialize();
        const result = await this.list(filter, page || 1, pageSize || 20);
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('knowledge:create', async (_event, { item }: { item: KnowledgeItem }) => {
      try {
        await this.initialize();
        const id = await this.create(item);
        return { success: true, id };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('knowledge:update', async (_event, { id, updates }: { id: string; updates: Partial<KnowledgeItem> }) => {
      try {
        await this.initialize();
        const success = await this.update(id, updates);
        return { success };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('knowledge:delete', async (_event, { id }: { id: string }) => {
      try {
        await this.initialize();
        const success = await this.delete(id);
        return { success };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('knowledge:search', async (_event, { query, options }: { query: string; options?: SearchOptions }) => {
      try {
        await this.initialize();
        const results = await this.search(query, options);
        return { success: true, results };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('knowledge:vectorize', async (_event, { id }: { id: string }) => {
      try {
        await this.initialize();
        const success = await this.vectorizeItem(id);
        return { success };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('knowledge:vectorizeAll', async () => {
      try {
        await this.initialize();
        const result = await this.vectorizeAll();
        return result;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('knowledge:getVersion', async (_event, { id }: { id: string }) => {
      try {
        await this.initialize();
        const versions = await this.getVersion(id);
        return { success: true, versions };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('knowledge:restoreVersion', async (_event, { id, version }: { id: string; version: number }) => {
      try {
        await this.initialize();
        const success = await this.restoreVersion(id, version);
        return { success };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();
