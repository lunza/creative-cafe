/**
 * VectorStoreService (VectorStoreManager Facade)
 *
 * 三层抽象架构（Task 3 - SubTask 3.4）：
 *   - IVectorBackend        - 单源存储后端契约
 *   - VectorRepository      - 多源路由 + 反向索引
 *   - VectorStoreService    - 本文件：Facade（缓存 + Strategy + IPC 适配）
 *
 * 重构说明：
 *   - 原 Strategy 类已迁出到 src/main/services/vector/strategies/ 独立文件
 *   - 删除 (store as any).addBatch / (store as any).addBatchNoPersist 反射，改为 IVectorBackend 接口调用
 *   - storeBySource Map 改为 LRU Map（SubTask 3.9，max=100 源）
 *   - delete(id) 通过 Repository 反向索引路由（SubTask 3.3，原为全源扫描 O(N)）
 *   - 职责聚焦：仅做缓存、策略选择、IPC 适配；存储逻辑下沉到 Repository / Backend
 *
 * 行为保持：
 *   - 所有外部 API 方法签名不变（add/remove/search/getById/clear/persist 等）
 *   - IPC channel 名不变
 *   - 消费方（ContextManager / ChatVectorizationService / DocumentProcessorService /
 *     KnowledgeBaseService / worldBookService / characterService）调用方式不变
 */

import { ipcMain, app } from 'electron';
import path from 'path';
import { LRUCache } from 'lru-cache';
import { SqliteVecBackend } from './SqliteVecBackend';
import { VectorCache } from './VectorCache';
import { VectorStoreMode } from '../types/vectorConfig';
import { getStorageService } from './storageService';
import { getEmbeddingService } from './EmbeddingService';
import type { VectorConfig, VectorItem, SearchResult } from '../types/vectorConfig';
import { VectorRepository } from './vector/VectorRepository';
import { vectorConfigManager } from './VectorConfigManager';
import {
  NormalBatchStrategy,
  DeferredBatchStrategy,
  NoPersistBatchStrategy,
  ScopeIdsSearchStrategy,
  SourceTypeSearchStrategy,
  AggregateSearchStrategy,
} from './vector/strategies';
import type { BatchProcessingStrategy, SearchStrategy, SearchStrategyContext } from './vector/strategies';

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

interface GroupedVectorItems {
  items: VectorItem[];
  source: string;
  sourceId: string;
}

/**
 * storeBySource LRU 容量上限（SubTask 3.9）
 * 长时间运行时防止源 store 无限增长导致内存泄漏
 */
const SOURCE_BACKEND_LRU_MAX = 100;

/**
 * VectorStoreService - Facade 类（瘦身后）
 *
 * 别名 VectorStoreManager：spec 中描述的目标名。为兼容现有 import 保留 VectorStoreService 类名导出。
 */
export class VectorStoreService {
  /** 默认 backend（source='default'） */
  private defaultBackend: SqliteVecBackend;
  /**
   * 多源 backend 索引（LRU Map）
   * SubTask 3.9：从普通 Map 改为 LRU Map，上限 SOURCE_BACKEND_LRU_MAX
   */
  private storeBySource: LRUCache<string, SqliteVecBackend>;
  /** 仓储层：路由 + 反向索引 */
  private repository: VectorRepository;
  /** 缓存层 */
  private cache: VectorCache;
  private initialized = false;

  // 测试相关状态
  private testLogs: VectorTestLog[] = [];
  private testResults: VectorTestResult[] = [];
  private testStartTime: number = 0;

  constructor() {
    this.defaultBackend = new SqliteVecBackend();
    this.storeBySource = new LRUCache<string, SqliteVecBackend>({
      max: SOURCE_BACKEND_LRU_MAX,
      // LRU 驱逐时尝试 destroy 释放 SQLite 连接资源
      dispose: (backend, _key, _reason) => {
        if (backend.initialized) {
          backend.destroy().catch(err => {
            console.warn(`[VectorStoreService] LRU dispose: failed to destroy backend:`, err);
          });
        }
      },
    });

    // 默认 backend 工厂：动态创建 SqliteVecBackend
    const backendFactory = (_source: string, _sourceId: string) => {
      return new SqliteVecBackend();
    };

    this.repository = new VectorRepository(this.defaultBackend, backendFactory);
    this.cache = new VectorCache();
  }

  // ============ LRU Store 管理 ============

  /**
   * 获取（不存在则创建）指定 source 的 backend。
   * 公共方法：外部消费方（DocumentProcessorService / worldBookService）通过此方法
   * 访问底层 backend 以调用 destroyAndDeleteFiles / getStoreFilePath 等。
   *
   * 注意：方法名保留历史命名（原 vecstore 时期），实际返回 SqliteVecBackend。
   * 消费方仅使用 destroyAndDeleteFiles() 方法，该方法在新 backend 中同样实现，
   * 调用代码零改动（决策 2.3）。
   */
  getVecstoreStoreForSource(source: string, sourceId: string): SqliteVecBackend {
    const key = `${source}:${sourceId}`;
    let backend = this.storeBySource.get(key);
    if (!backend) {
      backend = new SqliteVecBackend();
      this.storeBySource.set(key, backend);
      // 同步注册到 Repository
      this.repository.registerBackend(source, sourceId, backend);
    }
    return backend;
  }

  /**
   * 从 LRU 缓存中移除指定 source 的 backend（不销毁实例，仅从缓存摘除）。
   * 外部消费方在删除世界书/文档后会调用此方法。
   */
  removeStoreFromCache(source: string, sourceId: string): boolean {
    const key = `${source}:${sourceId}`;
    const existed = this.storeBySource.has(key);
    if (existed) {
      this.storeBySource.delete(key);
      this.repository.removeBackendFromCache(source, sourceId);
      console.log(`[VectorStoreService] Removed store from cache: ${key}`);
    }
    return existed;
  }

  private groupItemsBySource(items: VectorItem[]): Map<string, GroupedVectorItems> {
    const grouped = new Map<string, GroupedVectorItems>();
    for (const item of items) {
      const source = item.metadata?.source || 'default';
      const sourceId = item.metadata?.sourceId || item.metadata?.docId || source || 'default';
      const key = `${source}:${sourceId}`;
      if (!grouped.has(key)) {
        grouped.set(key, { items: [], source, sourceId });
      }
      grouped.get(key)!.items.push(item);
    }
    return grouped;
  }

  private async ensureStoreInitialized(source: string, sourceId: string): Promise<SqliteVecBackend> {
    const sourceStore = this.getVecstoreStoreForSource(source, sourceId);
    if (!sourceStore.initialized) {
      await sourceStore.initialize({ source, sourceId });
    }
    return sourceStore;
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
      return { status: 'pass' as const, detail: `维度: ${result.dimension}, 模式: ${result.mode}`, duration: 0 };
    });

    await this.runEmbeddingTestCase('中文文本向量化', async () => {
      const result = await embeddingService.generateEmbedding('你好世界，这是一个测试。');
      if (!result.success) throw new Error(result.error || '中文向量化失败');
      if (result.dimension === 0) throw new Error('向量维度为 0');
      this.log('info', `  中文向量化成功，维度: ${result.dimension}`);
      return { status: 'pass' as const, detail: `中文维度: ${result.dimension}`, duration: 0 };
    });

    await this.runEmbeddingTestCase('空文本处理', async () => {
      const result = await embeddingService.generateEmbedding('');
      if (!result.success) {
        this.log('info', `  空文本被正确处理: ${result.error}`);
        return { status: 'pass' as const, detail: '空文本被正确拒绝', duration: 0 };
      }
      return { status: 'pass' as const, detail: '空文本未报错（某些模型允许）', duration: 0 };
    });

    await this.runEmbeddingTestCase('批量向量化', async () => {
      const texts = ['Test 1', 'Test 2', 'Test 3'];
      const results = await embeddingService.generateBatchEmbeddings(texts);
      if (!results.success) throw new Error(results.error || '批量向量化失败');
      if (!results.vectors || results.vectors.length !== texts.length) throw new Error(`批量结果数量不匹配`);
      this.log('info', `  批量向量化成功: ${texts.length} 个文本`);
      return { status: 'pass' as const, detail: `批量成功: ${texts.length} 个文本`, duration: 0 };
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
      this.log('info', `  向量查询成功 (耗时 ${duration}ms, 找到 ${results.length} 条)`);
      return { status: 'pass', detail: `查询成功 (${duration}ms, ${results.length} 条)`, duration };
    });

    await this.runStorageTestCase('数量统计', async () => {
      const start = Date.now();
      const count = await this.count();
      const duration = Date.now() - start;
      this.log('info', `  存储中向量数量: ${count} (耗时 ${duration}ms)`);
      return { status: 'pass', detail: `数量: ${count}`, duration };
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
        this.log('success', `  PASS ${name}`);
      } else {
        this.log('warn', `  SKIP ${name}: ${result.detail}`);
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
      this.log('error', `  FAIL ${name}: ${msg}`);
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
        this.log('success', `  PASS ${name}`);
      } else {
        this.log('warn', `  WARN ${name}: ${result.detail}`);
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
      this.log('error', `  FAIL ${name}: ${msg}`);
    }
  }

  // ============ 生命周期 ============

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      console.log('[VectorStoreService] Starting initialization...');
      const storageService = getStorageService();
      const result = storageService.getSettings();
      if (result?.vector) {
        const config = result.vector as VectorConfig;
        this.cache = new VectorCache({
          enabled: config.cacheEnabled,
          maxSize: config.cacheL1Size,
          l1TTL: config.cacheL1TTL,
          l2TTL: config.cacheL2TTL
        });
      }

      // SubTask 3.5：注入 Repository 引用到 Cache（替代原 Service 反射访问）
      this.cache.setRepository(this.repository);

      console.log('[VectorStoreService] Initializing default SqliteVecBackend...');
      await this.defaultBackend.initialize({ source: 'default' });

      // 加载已注册的 source stores
      await this.loadExistingStoresFromRegistry();

      // SubTask 3.11：监听 dimension 变更事件，转发给 Repository（重建所有 backend）
      this.setupDimensionChangeListener();

      this.initialized = true;
      console.log(`[VectorStoreService] Initialization complete (${this.storeBySource.size} source stores loaded)`);
    } catch (error) {
      console.error('[VectorStoreService] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * SubTask 3.11：监听 VectorConfigManager 的 dimension 变更事件，
   * 转发给 Repository（再由 Repository 通知所有 backend 重建实例）。
   */
  private dimensionChangeUnsubscribe: (() => void) | null = null;
  private setupDimensionChangeListener(): void {
    if (this.dimensionChangeUnsubscribe) return; // 已订阅
    this.dimensionChangeUnsubscribe = vectorConfigManager.onDimensionChange(async (event) => {
      console.log(`[VectorStoreService] Dimension change received: ${event.oldDimension} -> ${event.newDimension}, rebuilding all backends`);
      try {
        await this.repository.handleDimensionChange(event.newDimension);
        // 维度变更后清空缓存（旧查询结果在新维度下无效）
        this.cache.clear();
      } catch (err) {
        console.error('[VectorStoreService] Failed to handle dimension change:', err);
      }
    });
  }

  private async loadExistingStoresFromRegistry(): Promise<void> {
    try {
      const { vectorRegistryService } = await import('./VectorRegistryService');
      const scopes = await vectorRegistryService.getAvailableScopes();

      for (const scope of scopes) {
        const key = `${scope.sourceType}:${scope.sourceId}`;
        const existingStore = this.storeBySource.get(key);
        if (existingStore && !existingStore.initialized) {
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

  // ============ CRUD ============

  async add(id: string, vector: number[], metadata: Record<string, any>): Promise<void> {
    await this.ensureInitialized();
    // 通过 Repository 路由（含反向索引维护）
    await this.repository.add(id, vector, metadata);
  }

  private async processBatchWithStrategy(
    items: VectorItem[],
    strategy: BatchProcessingStrategy
  ): Promise<void> {
    await this.ensureInitialized();
    const grouped = this.groupItemsBySource(items);
    for (const [, group] of grouped) {
      const sourceStore = await this.ensureStoreInitialized(group.source, group.sourceId);
      // 通过 IVectorBackend 接口调用，删除 (store as any).addBatch 反射
      await strategy.process(sourceStore, group.items);
    }
  }

  async addBatch(items: VectorItem[]): Promise<void> {
    await this.processBatchWithStrategy(items, new NormalBatchStrategy());
  }

  async addBatchDeferred(items: VectorItem[]): Promise<void> {
    await this.processBatchWithStrategy(items, new DeferredBatchStrategy());
  }

  async addBatchNoPersist(items: VectorItem[]): Promise<void> {
    await this.processBatchWithStrategy(items, new NoPersistBatchStrategy());
  }

  async search(query: number[], topK: number, filter?: Record<string, any>, options?: {
    sourceType?: string;
    aggregate?: boolean;
    scopeIds?: string[];
  }): Promise<SearchResult[]> {
    await this.ensureInitialized();

    // 修复：缓存 key 需包含 topK/filter/scopeIds，否则相同查询文本换 topK 会命中旧缓存
    const queryHash = this.hashVector(query);
    const scopeKey = options?.scopeIds && options.scopeIds.length > 0 ? options.scopeIds.slice().sort().join(',') : '';
    const sourceTypeKey = options?.sourceType || '';
    const filterKey = filter ? JSON.stringify(filter) : '';
    const cacheKey = `${queryHash}_k${topK}_s${scopeKey}_t${sourceTypeKey}_f${filterKey}`;
    const cachedResult = await this.cache.getSearchResult(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // 构建 SearchStrategyContext - 通过 Repository 提供搜索能力
    const ctx: SearchStrategyContext = {
      searchDefault: async (q, k, f) => {
        if (this.defaultBackend.initialized) {
          return this.defaultBackend.search(q, k, f);
        }
        return [];
      },
      searchSource: async (source, sourceId, q, k, f) => {
        const sourceStore = await this.ensureStoreInitialized(source, sourceId);
        return sourceStore.search(q, k, f);
      },
      searchAll: async (q, k, f) => {
        const allResults: SearchResult[] = [];
        if (this.defaultBackend.initialized) {
          const defaultResults = await this.defaultBackend.search(q, k * 2, f);
          allResults.push(...defaultResults);
        }
        for (const [key, store] of this.storeBySource.entries()) {
          if (!store.initialized) {
            const parts = key.split(':');
            const source = parts[0];
            const sourceId = parts.slice(1).join(':');
            try {
              await store.initialize({ source, sourceId });
            } catch (err) {
              console.warn(`[VectorStoreService] searchAll: failed to init store ${key}:`, err);
              continue;
            }
          }
          const sourceResults = await store.search(q, k * 2, f);
          allResults.push(...sourceResults);
        }
        return allResults.sort((a, b) => b.score - a.score).slice(0, k);
      },
    };

    let strategy: SearchStrategy;
    if (options?.scopeIds && options.scopeIds.length > 0) {
      strategy = new ScopeIdsSearchStrategy(ctx, options.scopeIds);
    } else if (options?.sourceType) {
      strategy = new SourceTypeSearchStrategy(ctx, options.sourceType);
    } else {
      strategy = new AggregateSearchStrategy(ctx);
    }

    const results = await strategy.search(query, topK, filter);

    if (results.length > 0) {
      await this.cache.setSearchResult(cacheKey, results);
    }

    return results;
  }

  async update(id: string, vector: number[], metadata?: Record<string, any>): Promise<void> {
    await this.ensureInitialized();
    await this.repository.update(id, vector, metadata);
    this.cache.clearBySource(id);
  }

  /**
   * 修复 SubTask 3.3：delete 通过 Repository 反向索引路由（原为全源扫描 O(N)）
   */
  async delete(id: string, options?: { sourceType?: string }): Promise<void> {
    await this.ensureInitialized();

    if (options?.sourceType) {
      const sourceStore = this.getVecstoreStoreForSource(options.sourceType, options.sourceType);
      if (sourceStore.initialized) {
        await sourceStore.remove(id);
      }
    } else {
      // 通过 Repository 反向索引 O(1) 路由
      const removed = await this.repository.remove(id);
      if (!removed) {
        console.warn(`[VectorStoreService] delete: ID "${id}" not found in any store`);
      }
    }

    this.cache.clearBySource(id);
  }

  async count(): Promise<number> {
    await this.ensureInitialized();
    return this.repository.count();
  }

  getMode(): VectorStoreMode {
    return 'sqlite-vec';
  }

  async rebuildIndex(): Promise<void> {
    await this.ensureInitialized();
    await this.repository.rebuildAll();
    this.cache.clear();
  }

  async persist(): Promise<void> {
    await this.ensureInitialized();
    await this.repository.persist();
  }

  async load(): Promise<void> {
    await this.initialize();
  }

  async getById(id: string): Promise<VectorItem | null> {
    await this.ensureInitialized();
    return this.repository.getById(id);
  }

  async countByPrefix(prefix: string): Promise<number> {
    await this.ensureInitialized();
    return this.repository.countByPrefix(prefix);
  }

  async deleteByPrefix(prefix: string, options?: { sourceType?: string; sourceId?: string }): Promise<number> {
    await this.ensureInitialized();
    return this.repository.deleteByPrefix(prefix, options);
  }

  async getEmbedding(text: string): Promise<number[] | null> {
    return this.cache.getEmbedding(text);
  }

  async setEmbedding(text: string, vector: number[]): Promise<void> {
    await this.cache.setEmbedding(text, vector);
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this.repository.clear();
    this.cache.clear();
  }

  async testStorageConnection(scopeIds?: string[]): Promise<StorageTestResult> {
    const startTime = Date.now();
    try {
      console.log(`[VectorStoreService] Testing storage connection, scopeIds: ${scopeIds?.join(', ') || 'none'}`);
      await this.ensureInitialized();

      let totalCount = 0;
      const pathDetails: string[] = [];

      if (scopeIds && scopeIds.length > 0) {
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
            pathDetails.push(`${entry.sourceName || entry.sourceId}: ${sourceStore.getStoreFilePath()} (${count}条)`);
          }
        }
      } else {
        const defaultCount = await this.defaultBackend.count();
        totalCount += defaultCount;
        pathDetails.push(`默认: ${this.defaultBackend.getStoreFilePath()} (${defaultCount}条)`);

        for (const [source, store] of this.storeBySource.entries()) {
          if (store.initialized) {
            const count = await store.count();
            totalCount += count;
            pathDetails.push(`${source}: ${store.getStoreFilePath()} (${count}条)`);
          }
        }
      }

      const storagePath = pathDetails.join(', ');
      const testResult: StorageTestResult = {
        success: true,
        mode: 'sqlite-vec',
        vectorCount: totalCount,
        storagePath,
        details: `存储测试成功 (耗时 ${Date.now() - startTime}ms, ${totalCount} 条向量, 模式: sqlite-vec, 存储路径: ${pathDetails.join(', ')})`
      };
      console.log(`[VectorStoreService] Storage test passed:`, testResult.details);
      return testResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      console.error(`[VectorStoreService] Storage test failed (${duration}ms):`, errorMsg);
      return {
        success: false,
        mode: 'sqlite-vec',
        vectorCount: 0,
        error: `存储服务测试失败 (耗时 ${duration}ms): ${errorMsg}`
      };
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
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

  /**
   * IPC handler 包装器：统一处理 initialize + try/catch + 标准化返回格式
   *
   * 返回值约定：
   *   - fn 返回 undefined / void → { success: true }
   *   - fn 返回对象 → { success: true, ...data }（spread 到顶层，保持原 IPC 响应形状）
   *   - 抛出异常 → { success: false, error: string }
   */
  private wrapIpc<TArgs, TResult = void | Record<string, any> | undefined>(
    fn: (args: TArgs) => Promise<TResult>,
    opts: { skipInit?: boolean } = {}
  ): (_event: unknown, args: TArgs) => Promise<Record<string, any>> {
    return async (_event, args) => {
      try {
        if (!opts.skipInit) await this.initialize();
        const data = await fn(args) as Record<string, any> | undefined | void;
        // spread 到顶层（如 { added: 5 } → { success: true, added: 5 }）
        // void / undefined → 空对象，无字段
        return { success: true, ...((data as Record<string, any> | undefined) || {}) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    };
  }

  registerIpcHandlers(): void {
    ipcMain.handle('vector:add', this.wrapIpc(async ({ id, vector, metadata }) => {
      await this.add(id, vector, metadata);
    }));

    ipcMain.handle('vector:addBatch', this.wrapIpc(async ({ items }) => {
      await this.addBatch(items);
      return { added: items.length };
    }));

    ipcMain.handle('vector:search', this.wrapIpc(async ({ query, topK, filter, scopeIds }) => {
      const results = await this.search(query, topK, filter, { scopeIds });
      return { results };
    }));

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

    ipcMain.handle('vector:getById', this.wrapIpc(async ({ id }) => {
      const item = await this.getById(id);
      if (!item) throw new Error(`Item "${id}" not found`);
      return { item };
    }));

    ipcMain.handle('vector:update', this.wrapIpc(async ({ id, vector, metadata }) => {
      await this.update(id, vector, metadata);
    }));

    ipcMain.handle('vector:delete', this.wrapIpc(async ({ id }) => {
      await this.delete(id);
    }));

    ipcMain.handle('vector:count', this.wrapIpc(async () => {
      const count = await this.count();
      return { count };
    }));

    ipcMain.handle('vector:rebuildIndex', this.wrapIpc(async () => {
      await this.rebuildIndex();
    }));

    ipcMain.handle('vector:getStorePath', async () => {
      return path.join(app.getPath('userData'), 'vectors');
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

// 兼容性别名：spec 中描述目标名为 VectorStoreManager
export const VectorStoreManager = VectorStoreService;

export const vectorStoreService = new VectorStoreService();
