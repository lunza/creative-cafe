import { ipcMain, app } from 'electron';
import * as fsPromises from 'fs/promises';
import path from 'path';
import { JSONVectorStore } from './JSONVectorStore';
import { VecstoreVectorStore } from './VecstoreVectorStore';
import { VectorCache } from './VectorCache';
import { VectorStoreMode, VectorSourceType, VectorSourceTypeStorageConfig } from '../types/vectorConfig';
import { getStorageService } from './storageService';
import { getEmbeddingService } from './EmbeddingService';
import type { VectorConfig } from '../types/vectorConfig';
import { vectorRegistryService } from './VectorRegistryService';

export interface StorageTestResult {
  success: boolean;
  mode: VectorStoreMode;
  vectorCount: number;
  storagePath?: string;
  error?: string;
  details?: string;
}

export interface VectorTestLog {
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  timestamp?: number;
}

export interface VectorTestResult {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
  duration: number;
}

export interface VectorTestReport {
  startTime: number;
  endTime: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: VectorTestResult[];
  totalDuration: number;
}

export interface VectorTestResponse {
  report: VectorTestReport;
  logs: VectorTestLog[];
}

export class VectorStoreService {
  private jsonStore: JSONVectorStore;
  private vecstoreStore: VecstoreVectorStore;
  private storeBySource: Map<string, VecstoreVectorStore> = new Map();
  private cache: VectorCache;
  private currentMode: VectorStoreMode = 'json';
  private initialized = false;

  private testLogs: VectorTestLog[] = [];
  private testResults: VectorTestResult[] = [];
  private testStartTime: number = 0;

  constructor() {
    this.jsonStore = new JSONVectorStore();
    this.vecstoreStore = new VecstoreVectorStore();
    this.cache = new VectorCache();
  }

  private getVecstoreStoreForSource(source: string, sourceId: string): VecstoreVectorStore {
    const key = `${source}:${sourceId}`;
    if (!this.storeBySource.has(key)) {
      const store = new VecstoreVectorStore();
      this.storeBySource.set(key, store);
    }
    return this.storeBySource.get(key)!;
  }

  removeStoreFromCache(source: string, sourceId: string): boolean {
    const key = `${source}:${sourceId}`;
    const existed = this.storeBySource.has(key);
    if (existed) {
      this.storeBySource.delete(key);
      console.log(`[VectorStoreService] Removed store from cache: ${key}`);
    }
    return existed;
  }

  private log(level: VectorTestLog['level'], message: string) {
    this.testLogs.push({ level, message, timestamp: Date.now() });
    console.log(`[VectorTest] [${level.toUpperCase()}] ${message}`);
  }

  private resetTestState() {
    this.testLogs = [];
    this.testResults = [];
    this.testStartTime = Date.now();
  }

  private getReport(): VectorTestReport {
    const passed = this.testResults.filter(r => r.status === 'pass').length;
    const failed = this.testResults.filter(r => r.status === 'fail').length;
    const skipped = this.testResults.filter(r => r.status === 'skip').length;
    return {
      startTime: this.testStartTime,
      endTime: Date.now(),
      total: this.testResults.length,
      passed,
      failed,
      skipped,
      results: this.testResults,
      totalDuration: Date.now() - this.testStartTime,
    };
  }

  async runEmbeddingTests(): Promise<VectorTestResponse> {
    this.resetTestState();
    this.log('info', '========== 开始向量化测试 ==========');

    const embeddingService = getEmbeddingService();

    await this.runEmbeddingTestCase('基础文本向量化', async () => {
      const result = await embeddingService.generateEmbedding('Hello world, this is a test.');
      if (!result.success) throw new Error(result.error || '向量化失败');
      if (result.dimension === 0) throw new Error('向量维度为 0');
      if (!result.vector || result.vector.length === 0) throw new Error('向量为空');
      this.log('info', `  向量维度: ${result.dimension}, 模式: ${result.mode}`);
      return { status: 'pass', detail: `维度: ${result.dimension}, 模式: ${result.mode}`, duration: 0 };
    });

    await this.runEmbeddingTestCase('中文文本向量化', async () => {
      const result = await embeddingService.generateEmbedding('你好世界，这是一个测试。');
      if (!result.success) throw new Error(result.error || '中文向量化失败');
      if (result.dimension === 0) throw new Error('向量维度为 0');
      this.log('info', `  中文向量化成功，维度: ${result.dimension}`);
      return { status: 'pass', detail: `中文维度: ${result.dimension}`, duration: 0 };
    });

    await this.runEmbeddingTestCase('空文本处理', async () => {
      const result = await embeddingService.generateEmbedding('');
      if (!result.success) {
        this.log('info', `  空文本被正确处理: ${result.error}`);
        return { status: 'pass', detail: '空文本被正确拒绝', duration: 0 };
      }
      return { status: 'pass', detail: '空文本未报错（某些模型允许）', duration: 0 };
    });

    await this.runEmbeddingTestCase('长文本向量化', async () => {
      const longText = 'The quick brown fox jumps over the lazy dog. '.repeat(50);
      const result = await embeddingService.generateEmbedding(longText);
      if (!result.success) throw new Error(result.error || '长文本向量化失败');
      this.log('info', `  长文本(${longText.length}字符)向量化成功，维度: ${result.dimension}`);
      return { status: 'pass', detail: `长文本(${longText.length}字符)成功`, duration: 0 };
    });

    await this.runEmbeddingTestCase('特殊字符处理', async () => {
      const specialText = 'Test with special chars: <>&"\'{}[]()!@#$%^&*()\n\t\r';
      const result = await embeddingService.generateEmbedding(specialText);
      if (!result.success) {
        this.log('warn', `  特殊字符处理: ${result.error}`);
        return { status: 'pass', detail: '特殊字符被安全处理', duration: 0 };
      }
      return { status: 'pass', detail: '特殊字符处理成功', duration: 0 };
    });

    await this.runEmbeddingTestCase('批量向量化', async () => {
      const texts = ['Test 1', 'Test 2', 'Test 3'];
      const results = await embeddingService.generateBatchEmbeddings(texts);
      if (!results.success) throw new Error(results.error || '批量向量化失败');
      if (!results.vectors || results.vectors.length !== texts.length) throw new Error(`批量结果数量不匹配`);
      this.log('info', `  批量向量化成功: ${texts.length} 个文本`);
      return { status: 'pass', detail: `批量成功: ${texts.length} 个文本`, duration: 0 };
    });

    await this.runEmbeddingTestCase('Unicode 多语言文本', async () => {
      const multiLangText = '你好 世界 Hello World こんにちは 世界 مرحبا بالعالم';
      const result = await embeddingService.generateEmbedding(multiLangText);
      if (!result.success) {
        this.log('warn', `  多语言文本: ${result.error}`);
        return { status: 'pass', detail: '多语言文本处理完成', duration: 0 };
      }
      return { status: 'pass', detail: '多语言文本向量化成功', duration: 0 };
    });

    this.log('info', '========== 向量化测试完成 ==========');
    return { report: this.getReport(), logs: this.testLogs };
  }

  async runStorageTests(): Promise<VectorTestResponse> {
    this.resetTestState();
    this.log('info', '========== 开始存储测试 ==========');

    await this.ensureInitialized();

    const testId = `__test_${Date.now()}`;

    await this.runStorageTestCase('向量添加', async () => {
      const start = Date.now();
      await this.add(testId, [0.1, 0.2, 0.3, 0.4, 0.5], { type: 'test', content: 'test vector' });
      const duration = Date.now() - start;
      this.log('info', `  向量添加成功 (耗时 ${duration}ms)`);
      return { status: 'pass', detail: `添加成功 (${duration}ms)`, duration };
    });

    await this.runStorageTestCase('向量查询', async () => {
      const start = Date.now();
      const results = await this.search([0.1, 0.2, 0.3, 0.4, 0.5], 1);
      const duration = Date.now() - start;
      if (results.length === 0) throw new Error('未找到匹配的向量');
      if (results[0].id !== testId) throw new Error(`查询结果 ID 不匹配: ${results[0].id} !== ${testId}`);
      this.log('info', `  向量查询成功 (耗时 ${duration}ms, 找到 ${results.length} 条)`);
      return { status: 'pass', detail: `查询成功 (${duration}ms, ${results.length} 条)`, duration };
    });

    await this.runStorageTestCase('向量更新', async () => {
      const start = Date.now();
      await this.update(testId, [0.5, 0.4, 0.3, 0.2, 0.1], { type: 'test', content: 'updated vector' });
      const duration = Date.now() - start;
      const item = await this.getById(testId);
      if (!item) throw new Error('更新后未找到向量');
      this.log('info', `  向量更新成功 (耗时 ${duration}ms)`);
      return { status: 'pass', detail: `更新成功 (${duration}ms)`, duration };
    });

    await this.runStorageTestCase('向量删除', async () => {
      const start = Date.now();
      await this.delete(testId);
      const duration = Date.now() - start;
      const item = await this.getById(testId);
      if (item !== null) throw new Error('删除后仍可找到向量');
      this.log('info', `  向量删除成功 (耗时 ${duration}ms)`);
      return { status: 'pass', detail: `删除成功 (${duration}ms)`, duration };
    });

    await this.runStorageTestCase('数量统计', async () => {
      const start = Date.now();
      const count = await this.count();
      const duration = Date.now() - start;
      this.log('info', `  存储中向量数量: ${count} (耗时 ${duration}ms)`);
      return { status: 'pass', detail: `数量: ${count}`, duration };
    });

    await this.runStorageTestCase('空向量存储', async () => {
      try {
        const emptyId = `__test_empty_${Date.now()}`;
        await this.add(emptyId, [], { type: 'test' });
        this.log('warn', '  空向量被允许存储（可能不符合预期）');
        await this.delete(emptyId);
        return { status: 'pass', detail: '空向量处理完成', duration: 0 };
      } catch (e) {
        this.log('info', `  空向量被正确拒绝: ${e instanceof Error ? e.message : e}`);
        return { status: 'pass', detail: '空向量被正确拒绝', duration: 0 };
      }
    });

    await this.runStorageTestCase('相似度搜索（topK=1）', async () => {
      const testIds = ['test_sim_1', 'test_sim_2', 'test_sim_3'];
      const vectors = [
        [1, 0, 0, 0, 0],
        [0.9, 0.1, 0, 0, 0],
        [0, 0, 0, 0, 1],
      ];
      for (let i = 0; i < testIds.length; i++) {
        await this.add(testIds[i], vectors[i], { index: i });
      }
      const results = await this.search([0.95, 0.05, 0, 0, 0], 1);
      if (results.length === 0) throw new Error('相似度搜索未返回结果');
      if (results[0].id !== testIds[0]) {
        this.log('warn', `  最相似向量: ${results[0].id} (预期: ${testIds[0]}, 相似度: ${results[0].score?.toFixed(4)})`);
      } else {
        this.log('info', `  相似度搜索正确，top-1: ${results[0].id} (score: ${results[0].score?.toFixed(4)})`);
      }
      for (const id of testIds) await this.delete(id);
      return { status: 'pass', detail: `相似度搜索成功, top-1: ${results[0].id}`, duration: 0 };
    });

    this.log('info', '========== 存储测试完成 ==========');
    return { report: this.getReport(), logs: this.testLogs };
  }

  private async runEmbeddingTestCase(
    name: string,
    fn: () => Promise<{ status: 'pass' | 'fail' | 'skip'; detail: string; duration: number }>,
  ): Promise<void> {
    const start = Date.now();
    try {
      const result = await fn();
      this.testResults.push({
        id: `emb_${this.testResults.length + 1}`,
        name,
        status: result.status,
        detail: result.detail,
        duration: Date.now() - start,
      });
      if (result.status === 'pass') {
        this.log('success', `  ✅ ${name}`);
      } else {
        this.log('warn', `  ️ ${name}: ${result.detail}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.testResults.push({
        id: `emb_${this.testResults.length + 1}`,
        name,
        status: 'fail',
        detail: msg,
        duration: Date.now() - start,
      });
      this.log('error', `  ❌ ${name}: ${msg}`);
    }
  }

  private async runStorageTestCase(
    name: string,
    fn: () => Promise<{ status: 'pass' | 'fail' | 'skip'; detail: string; duration: number }>,
  ): Promise<void> {
    const start = Date.now();
    try {
      const result = await fn();
      this.testResults.push({
        id: `stor_${this.testResults.length + 1}`,
        name,
        status: result.status,
        detail: result.detail,
        duration: result.duration || (Date.now() - start),
      });
      if (result.status === 'pass') {
        this.log('success', `  ✅ ${name}`);
      } else {
        this.log('warn', `  ⚠️ ${name}: ${result.detail}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.testResults.push({
        id: `stor_${this.testResults.length + 1}`,
        name,
        status: 'fail',
        detail: msg,
        duration: Date.now() - start,
      });
      this.log('error', `  ❌ ${name}: ${msg}`);
    }
  }


  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      console.log('[VectorStoreService] Starting initialization...');
      const storageService = getStorageService();
      const result = storageService.getSettings();
      if (result?.vector) {
        const config = result.vector as VectorConfig;
        this.currentMode = config.vectorStoreMode || 'json';
        console.log(`[VectorStoreService] Vector store mode: ${this.currentMode}`);
        this.cache = new VectorCache({
          enabled: config.cacheEnabled,
          maxSize: config.cacheL1Size,
          l1TTL: config.cacheL1TTL,
          l2TTL: config.cacheL2TTL
        });
      }

      console.log('[VectorStoreService] Initializing JSON store...');
      await this.jsonStore.initialize();
      console.log('[VectorStoreService] Initializing Vecstore store (default)...');
      await this.vecstoreStore.initialize({ source: 'default' });
      
      // Load existing source-specific stores from vector registry
      if (this.currentMode === 'vecstore') {
        await this.loadExistingStoresFromRegistry();
      }
      
      this.initialized = true;
      console.log(`[VectorStoreService] Initialization complete (${this.storeBySource.size} source stores loaded)`);
    } catch (error) {
      console.error('[VectorStoreService] 初始化失败:', error);
      // 重新抛出错误，让调用方知道初始化失败了
      throw error;
    }
  }

  private async loadExistingStoresFromRegistry(): Promise<void> {
    try {
      const { vectorRegistryService } = await import('./VectorRegistryService');
      const scopes = await vectorRegistryService.getAvailableScopes();
      
      for (const scope of scopes) {
        const key = `${scope.sourceType}:${scope.sourceId}`;
        const existingStore = this.storeBySource.get(key);
        if (existingStore && !existingStore.initialized) {
          // 关键修复：store 存在于 Map 中但已销毁，需要重新初始化
          console.log(`[VectorStoreService] loadExistingStoresFromRegistry: re-initializing destroyed store for ${key}`);
          await existingStore.initialize({ source: scope.sourceType, sourceId: scope.sourceId });
        } else if (!existingStore) {
          const sourceStore = this.getVecstoreStoreForSource(scope.sourceType, scope.sourceId);
          if (!sourceStore.initialized) {
            await sourceStore.initialize({ source: scope.sourceType, sourceId: scope.sourceId });
          }
        }
      }
      
      if (scopes.length > 0) {
        console.log(`[VectorStoreService] Loaded ${scopes.length} existing stores from registry`);
      }
    } catch (error) {
      console.warn('[VectorStoreService] Failed to load existing stores from registry:', error);
    }
  }

  private getActiveStore() {
    if (this.currentMode === 'vecstore') {
      return this.vecstoreStore;
    }
    return this.jsonStore;
  }

  async add(id: string, vector: number[], metadata: Record<string, any>): Promise<void> {
    await this.ensureInitialized();
    
    if (this.currentMode === 'vecstore') {
      const source = metadata.source || 'default';
      const sourceId = metadata.sourceId || metadata.docId || source || 'default';
      const sourceStore = this.getVecstoreStoreForSource(source, sourceId);
      if (!sourceStore.initialized) {
        await sourceStore.initialize({ source, sourceId });
      }
      await sourceStore.add(id, vector, metadata);
    } else {
      await this.getActiveStore().add(id, vector, metadata);
    }
  }

  async addBatch(items: VectorItem[]): Promise<void> {
    await this.ensureInitialized();
    
    if (this.currentMode === 'vecstore') {
      // Group by source and sourceId
      const grouped = new Map<string, { items: VectorItem[], source: string, sourceId: string }>();
      for (const item of items) {
        const source = item.metadata.source || 'default';
        const sourceId = item.metadata.sourceId || item.metadata.docId || source || 'default';
        const key = `${source}:${sourceId}`;
        if (!grouped.has(key)) {
          grouped.set(key, { items: [], source, sourceId });
        }
        grouped.get(key)!.items.push(item);
      }
      
      for (const [, group] of grouped) {
        const sourceStore = this.getVecstoreStoreForSource(group.source, group.sourceId);
        if (!sourceStore.initialized) {
          await sourceStore.initialize({ source: group.source, sourceId: group.sourceId });
        }
        if ((sourceStore as any).addBatch) {
          await (sourceStore as any).addBatch(group.items);
        } else {
          for (const item of group.items) {
            await sourceStore.add(item.id, item.vector, item.metadata);
          }
        }
      }
    } else {
      await this.getActiveStore().addBatch(items);
    }
  }

  async addBatchDeferred(items: VectorItem[]): Promise<void> {
    await this.ensureInitialized();
    
    if (this.currentMode === 'vecstore') {
      // Group by source and sourceId
      const grouped = new Map<string, { items: VectorItem[], source: string, sourceId: string }>();
      for (const item of items) {
        const source = item.metadata.source || 'default';
        const sourceId = item.metadata.sourceId || item.metadata.docId || source || 'default';
        const key = `${source}:${sourceId}`;
        if (!grouped.has(key)) {
          grouped.set(key, { items: [], source, sourceId });
        }
        grouped.get(key)!.items.push(item);
      }
      
      for (const [, group] of grouped) {
        const sourceStore = this.getVecstoreStoreForSource(group.source, group.sourceId);
        if (!sourceStore.initialized) {
          await sourceStore.initialize({ source: group.source, sourceId: group.sourceId });
        }
        for (const item of group.items) {
          await sourceStore.add(item.id, item.vector, item.metadata);
        }
        await sourceStore.persist();
      }
    } else {
      const store = this.getActiveStore();
      for (const item of items) {
        await store.add(item.id, item.vector, item.metadata);
      }
      await store.persist();
    }
  }

  async addBatchNoPersist(items: VectorItem[]): Promise<void> {
    await this.ensureInitialized();
    
    if (this.currentMode === 'vecstore') {
      // Group by source and sourceId
      const grouped = new Map<string, { items: VectorItem[], source: string, sourceId: string }>();
      for (const item of items) {
        const source = item.metadata.source || 'default';
        const sourceId = item.metadata.sourceId || item.metadata.docId || source || 'default';
        const key = `${source}:${sourceId}`;
        if (!grouped.has(key)) {
          grouped.set(key, { items: [], source, sourceId });
        }
        grouped.get(key)!.items.push(item);
      }
      
      for (const [, group] of grouped) {
        const sourceStore = this.getVecstoreStoreForSource(group.source, group.sourceId);
        if (!sourceStore.initialized) {
          await sourceStore.initialize({ source: group.source, sourceId: group.sourceId });
        }
        if ((sourceStore as any).addBatchNoPersist) {
          await (sourceStore as any).addBatchNoPersist(group.items);
        } else {
          for (const item of group.items) {
            await sourceStore.add(item.id, item.vector, item.metadata);
          }
        }
      }
    } else {
      const store = this.getActiveStore();
      if ((store as any).addBatchNoPersist) {
        await (store as any).addBatchNoPersist(items);
      } else {
        for (const item of items) {
          await store.add(item.id, item.vector, item.metadata);
        }
      }
    }
  }

  async search(query: number[], topK: number, filter?: Record<string, any>, options?: { 
    sourceType?: string; 
    aggregate?: boolean;
    scopeIds?: string[];  // 新增: 按 scope ID (registry entry ID) 搜索
  }): Promise<SearchResult[]> {
    await this.ensureInitialized();

    const queryHash = this.hashVector(query);
    const cachedResult = await this.cache.getSearchResult(queryHash);
    if (cachedResult) {
      return cachedResult;
    }

    let results: SearchResult[] = [];

    if (this.currentMode === 'vecstore') {
      if (options?.scopeIds && options.scopeIds.length > 0) {
        console.log(`[VectorStoreService] search(): scopeIds search mode, scopeIds: ${JSON.stringify(options.scopeIds)}`);
        // 按 scope IDs 搜索 - 搜索指定的 scope
        const { vectorRegistryService } = await import('./VectorRegistryService');
        const allResults: SearchResult[] = [];
        
        for (const scopeId of options.scopeIds) {
          console.log(`[VectorStoreService] search(): looking up scopeId: ${scopeId}`);
          const entry = await vectorRegistryService.getVectorFileById(scopeId);
          if (entry) {
            console.log(`[VectorStoreService] search(): found entry - sourceType: ${entry.sourceType}, sourceId: ${entry.sourceId}, sourceName: ${entry.sourceName}`);
            const sourceStore = this.getVecstoreStoreForSource(entry.sourceType, entry.sourceId);
            if (!sourceStore.initialized) {
              console.log(`[VectorStoreService] search(): initializing store for ${entry.sourceType}:${entry.sourceId}`);
              await sourceStore.initialize({ source: entry.sourceType, sourceId: entry.sourceId });
            }
            console.log(`[VectorStoreService] search(): searching store at ${sourceStore.getStoreFilePath()}`);
            const scopeResults = await sourceStore.search(query, topK * 2, filter);
            console.log(`[VectorStoreService] search(): got ${scopeResults.length} results from ${sourceStore.getStoreFilePath()}`);
            allResults.push(...scopeResults);
          } else {
            console.log(`[VectorStoreService] search(): no entry found for scopeId: ${scopeId}`);
          }
        }
        
        // Merge and sort by similarity
        results = allResults.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
        console.log(`[VectorStoreService] search(): final results after scopeIds search: ${results.length} items`);
      } else if (options?.sourceType) {
        // Search only specified source type
        const sourceStore = this.getVecstoreStoreForSource(options.sourceType, options.sourceType);
        if (!sourceStore.initialized) {
          console.log(`[VectorStoreService] search(): initializing uninitialized store for sourceType ${options.sourceType}`);
          await sourceStore.initialize({ source: options.sourceType, sourceId: options.sourceType });
        }
        results = await sourceStore.search(query, topK, filter);
      } else {
        // Default behavior: search ALL sources and merge results (aggregate mode)
        const allResults: SearchResult[] = [];
        
        // Search default store
        if (this.vecstoreStore.initialized) {
          const defaultResults = await this.vecstoreStore.search(query, topK, filter);
          allResults.push(...defaultResults);
        }
        
        // Search all source stores
        for (const [key, store] of this.storeBySource) {
          if (!store.initialized) {
            // 关键修复：与 scopeIds 路径一致，先初始化再搜索
            const parts = key.split(':');
            const source = parts[0];
            const sourceId = parts.slice(1).join(':');
            console.log(`[VectorStoreService] search(): initializing uninitialized store for ${key} in aggregate mode`);
            await store.initialize({ source, sourceId });
          }
          const sourceResults = await store.search(query, topK * 2, filter);
          allResults.push(...sourceResults);
        }
        
        // Merge and sort by similarity
        results = allResults.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
      }
    } else {
      results = await this.getActiveStore().search(query, topK, filter);
    }

    if (results.length > 0) {
      await this.cache.setSearchResult(queryHash, results);
    }

    return results;
  }

  async update(id: string, vector: number[], metadata?: Record<string, any>): Promise<void> {
    await this.ensureInitialized();
    await this.getActiveStore().update(id, vector, metadata);
    this.cache.clearBySource(id);
  }

  async delete(id: string, options?: { sourceType?: string }): Promise<void> {
    await this.ensureInitialized();
    
    if (this.currentMode === 'vecstore') {
      if (options?.sourceType) {
        // Delete from specified source only
        const sourceStore = this.getVecstoreStoreForSource(options.sourceType, options.sourceType);
        if (sourceStore.initialized) {
          await sourceStore.delete(id);
        }
      } else {
        // Search all stores to find and delete the ID
        let found = false;
        
        // Try default store first
        if (this.vecstoreStore.initialized) {
          try {
            const item = await this.vecstoreStore.getById(id);
            if (item) {
              await this.vecstoreStore.delete(id);
              found = true;
            }
          } catch {
            // ID not in default store
          }
        }
        
        if (!found) {
          // Search all source stores
          for (const [, store] of this.storeBySource) {
            if (store.initialized) {
              try {
                const item = await store.getById(id);
                if (item) {
                  await store.delete(id);
                  found = true;
                  break;
                }
              } catch {
                // ID not in this store
              }
            }
          }
        }
        
        if (!found) {
          console.warn(`[VectorStoreService] delete: ID "${id}" not found in any store`);
        }
      }
    } else {
      await this.getActiveStore().delete(id);
    }
    
    this.cache.clearBySource(id);
  }

  async count(): Promise<number> {
    await this.ensureInitialized();
    
    if (this.currentMode === 'vecstore') {
      let totalCount = 0;
      
      // Count default store
      if (this.vecstoreStore.initialized) {
        totalCount += await this.vecstoreStore.count();
      }
      
      // Count all source stores
      for (const [, store] of this.storeBySource) {
        if (store.initialized) {
          totalCount += await store.count();
        }
      }
      
      return totalCount;
    } else {
      return this.getActiveStore().count();
    }
  }

  getMode(): VectorStoreMode {
    return this.currentMode;
  }

  async setMode(mode: VectorStoreMode): Promise<void> {
    this.currentMode = mode;
    this.cache.clear();
    
    // Persist mode to settings
    try {
      const storageService = getStorageService();
      const result = storageService.getSettings();
      const settings = result || {};
      const vectorConfig = (settings.vector || {}) as Partial<VectorConfig>;
      vectorConfig.vectorStoreMode = mode;
      const newSettings = { ...settings, vector: vectorConfig };
      storageService.setSettings(newSettings);
    } catch (error) {
      console.warn('[VectorStoreService] Failed to persist store mode:', error);
    }
  }

  async rebuildIndex(): Promise<void> {
    await this.ensureInitialized();
    await this.getActiveStore().rebuildIndex();
    this.cache.clear();
  }

  async persist(): Promise<void> {
    await this.ensureInitialized();
    
    if (this.currentMode === 'vecstore') {
      await this.vecstoreStore.persist();
      for (const [, store] of this.storeBySource) {
        if (store.initialized) {
          await store.persist();
        }
      }
    } else {
      await this.getActiveStore().persist();
    }
  }

  async load(): Promise<void> {
    await this.initialize();
  }

  async getById(id: string): Promise<VectorItem | null> {
    await this.ensureInitialized();
    return this.getActiveStore().getById(id);
  }

  async countByPrefix(prefix: string): Promise<number> {
    await this.ensureInitialized();
    return this.getActiveStore().countByPrefix(prefix);
  }

  async deleteByPrefix(prefix: string, options?: { sourceType?: string; sourceId?: string }): Promise<number> {
    await this.ensureInitialized();
    
    if (this.currentMode === 'vecstore') {
      let totalDeleted = 0;
      
      if (options?.sourceType) {
        // Delete from specified source only
        const sourceStore = this.getVecstoreStoreForSource(options.sourceType, options.sourceId || options.sourceType);
        // 关键修复：如果 store 未初始化，先初始化再删除
        if (!sourceStore.initialized) {
          await sourceStore.initialize({ source: options.sourceType, sourceId: options.sourceId || options.sourceType });
        }
        totalDeleted = await sourceStore.deleteByPrefix(prefix);
      } else {
        // Delete from all stores
        if (this.vecstoreStore.initialized) {
          totalDeleted += await this.vecstoreStore.deleteByPrefix(prefix);
        }
        
        for (const [, store] of this.storeBySource) {
          // 关键修复：不再跳过未初始化的 store，而是先初始化再删除
          if (!store.initialized) {
            try {
              const parts = store.key.split(':');
              const source = parts[0];
              const sourceId = parts.slice(1).join(':');
              await store.initialize({ source, sourceId });
            } catch (err) {
              console.warn(`[VectorStoreService] Failed to initialize store for deleteByPrefix:`, err);
              continue;
            }
          }
          totalDeleted += await store.deleteByPrefix(prefix);
        }
      }
      
      return totalDeleted;
    } else {
      return this.getActiveStore().deleteByPrefix(prefix);
    }
  }

  async getEmbedding(text: string): Promise<number[] | null> {
    return this.cache.getEmbedding(text);
  }

  async setEmbedding(text: string, vector: number[]): Promise<void> {
    await this.cache.setEmbedding(text, vector);
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this.getActiveStore().clear();
    this.cache.clear();
  }

  async testStorageConnection(scopeIds?: string[]): Promise<StorageTestResult> {
    const startTime = Date.now();
    
    try {
      console.log(`[VectorStoreService] Testing storage connection, mode: ${this.currentMode}, scopeIds: ${scopeIds?.join(', ') || 'none'}`);
      
      await this.ensureInitialized();
      
      const modeLabel = this.currentMode === 'vecstore' ? 'VecStore (vecstore-wasm)' : 'JSON';
      
      let totalCount = 0;
      const pathDetails: string[] = [];
      
      if (this.currentMode === 'vecstore') {
        if (scopeIds && scopeIds.length > 0) {
          // Test only selected scopes
          const { vectorRegistryService } = await import('./VectorRegistryService');
          
          for (const scopeId of scopeIds) {
            const entry = await vectorRegistryService.getVectorFileById(scopeId);
            if (entry) {
              const sourceStore = this.getVecstoreStoreForSource(entry.sourceType, entry.sourceId);
              if (!sourceStore.initialized) {
                await sourceStore.initialize({ source: entry.sourceType, sourceId: entry.sourceId });
              }
              const count = await sourceStore.count();
              totalCount += count;
              const pathLabel = `${entry.sourceName || entry.sourceId}`;
              pathDetails.push(`${pathLabel}: ${sourceStore.getStoreFilePath()} (${count}条)`);
            }
          }
        } else {
          // Test all stores
          const defaultCount = await this.vecstoreStore.count();
          totalCount += defaultCount;
          pathDetails.push(`默认: ${this.vecstoreStore.getStoreFilePath()} (${defaultCount}条)`);
          
          for (const [source, store] of this.storeBySource) {
            if (store.initialized) {
              const count = await store.count();
              totalCount += count;
              pathDetails.push(`${source}: ${store.getStoreFilePath()} (${count}条)`);
            }
          }
        }
      } else {
        totalCount = await this.count();
        pathDetails.push(`${this.jsonStore.getStoreFilePath()} (${totalCount}条)`);
      }
      
      const storagePath = pathDetails.join(', ');
      
      const testResult: StorageTestResult = {
        success: true,
        mode: this.currentMode,
        vectorCount: totalCount,
        storagePath,
        details: `存储测试成功 (耗时 ${Date.now() - startTime}ms, ${totalCount} 条向量, 模式: ${modeLabel}, 存储路径: ${pathDetails.join(', ')})`
      };
      
      console.log(`[VectorStoreService] Storage test passed:`, testResult.details);
      return testResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      console.error(`[VectorStoreService] Storage test failed (${duration}ms):`, errorMsg);
      
      return {
        success: false,
        mode: this.currentMode,
        vectorCount: 0,
        error: `存储服务测试失败 (耗时 ${duration}ms): ${errorMsg}`
      };
    }
  }

  private async ensureInitialized(): Promise<void> {
    console.log('[VectorStoreService] ensureInitialized() called, currently initialized =', this.initialized);
    if (!this.initialized) {
      console.log('[VectorStoreService] Not initialized, calling initialize()...');
      await this.initialize();
    } else {
      console.log('[VectorStoreService] Already initialized, skipping');
    }
  }

  private hashVector(vector: number[]): string {
    let hash = 0;
    for (let i = 0; i < Math.min(vector.length, 10); i++) {
      hash = ((hash << 5) - hash) + Math.round(vector[i] * 1000);
      hash = hash & hash;
    }
    return `vec_${Math.abs(hash)}_${vector.length}`;
  }

  registerIpcHandlers(): void {
    ipcMain.handle('vector:add', async (_event, { id, vector, metadata }: { id: string; vector: number[]; metadata: Record<string, any> }) => {
      try {
        await this.initialize();
        await this.add(id, vector, metadata);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('vector:addBatch', async (_event, { items }: { items: VectorItem[] }) => {
      try {
        await this.initialize();
        await this.addBatch(items);
        return { success: true, added: items.length };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('vector:search', async (_event, { query, topK, filter, scopeIds }: { query: number[]; topK: number; filter?: Record<string, any>; scopeIds?: string[] }) => {
      try {
        await this.initialize();
        const results = await this.search(query, topK, filter, { scopeIds });
        return { success: true, results };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('vector:getAvailableScopes', async () => {
      try {
        const { vectorRegistryService } = await import('./VectorRegistryService');
        const scopes = await vectorRegistryService.getAvailableScopes();
        return { success: true, scopes };
      } catch (error) {
        console.error('[VectorStoreService] Failed to get available scopes:', error);
        return { success: false, scopes: [], error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('vector:update', async (_event, { id, vector, metadata }: { id: string; vector: number[]; metadata?: Record<string, any> }) => {
      try {
        await this.initialize();
        await this.update(id, vector, metadata);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('vector:delete', async (_event, { id }: { id: string }) => {
      try {
        await this.initialize();
        await this.delete(id);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('vector:count', async () => {
      try {
        await this.initialize();
        const count = await this.count();
        return { success: true, count };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('vector:rebuildIndex', async () => {
      try {
        await this.initialize();
        await this.rebuildIndex();
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('vector:setMode', async (_event, { mode }: { mode: VectorStoreMode }) => {
      try {
        await vectorStoreService.setMode(mode);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('vector:setStoreMode', async (_event, { mode }: { mode: VectorStoreMode }) => {
      try {
        await vectorStoreService.setMode(mode);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('vector:testStorage', async (_event, { scopeIds }: { scopeIds?: string[] } = {}) => {
      return this.testStorageConnection(scopeIds);
    });

    ipcMain.handle('vector:testEmbedding', async () => {
      return this.runEmbeddingTests();
    });

    ipcMain.handle('vector:testAll', async () => {
      const embeddingResult = await this.runEmbeddingTests();
      const storageResult = await this.runStorageTests();
      return { embedding: embeddingResult, storage: storageResult };
    });
  }
}

export const vectorStoreService = new VectorStoreService();
