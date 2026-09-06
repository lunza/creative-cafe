/**
 * SqliteVecBackend - 基于 sqlite-vec 的 IVectorBackend 实现
 *
 * 三层抽象架构（替换 VecstoreBackend）：
 *   - 本类是 IVectorBackend 的具体实现（基于 sqlite-vec + better-sqlite3）
 *   - 多源路由与反向索引由 VectorRepository 承接
 *   - Facade（VectorStoreService）协调缓存与策略
 *
 * 相对 VecstoreBackend 的简化（决策 2.2 / 2.4）：
 *   - metadata 存 DB 表内（item_metadata），无需 metadataCache sidecar Map
 *   - 无需 vecstore_metadata.json 文件
 *   - SQLite 事务即时落盘，persist() 简化为 no-op，无需 debounce 定时器
 *   - search 过滤下推到 SQL WHERE，无需内存过滤
 *   - getById/countByPrefix/deleteByPrefix 全部走 SQL，比 Map 遍历更可靠
 *
 * 路径布局（对齐 vecstore 的目录结构，仅换文件名）：
 *   vectors/{source}/{sourceId}/{dimension}/vectors.db
 *
 * 维度变更处理（决策 2.5）：
 *   不同维度 → 不同 DB 文件，handleDimensionChange 切换 DB 文件
 *   不删除旧维度数据文件（用户切回时可恢复）
 */

import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { app } from 'electron';
import { VectorItem, SearchResult, VectorStoreMode } from '../types/vectorConfig';
import { getStorageService } from './storageService';
import { getDatabaseDir } from '../utils/appPath';
import type { IVectorBackend } from './vector/IVectorBackend';
import type { SqliteDatabase } from './agent/infra/sqliteUtils';
import {
  openVectorDatabase,
  ensureVectorSchema,
  prepareVecStatement,
  VEC0_TEXT_PK_SUPPORTED,
} from './vector/sqliteVecUtils';

const DB_FILE = 'vectors.db';

interface SqliteVecInitOptions {
  source?: string;
  sourceId?: string;
}

/**
 * item_metadata 表的列名白名单（防 SQL 注入）。
 * filter 下推到 SQL WHERE 时，仅允许这些列名。
 */
const METADATA_COLUMN_WHITELIST = new Set([
  'id', 'text', 'source', 'sourceId', 'characterId', 'worldBookPath',
  'tags', 'createdAt', 'updatedAt',
]);

/**
 * SqliteVecBackend - sqlite-vec 的 IVectorBackend 实现
 */
export class SqliteVecBackend implements IVectorBackend {
  public source: string = 'default';
  public sourceId: string = '';
  private db: SqliteDatabase | null = null;
  private dimension: number = 1024;
  private storeMode: VectorStoreMode = 'sqlite-vec';
  private _initialized = false;
  private dbFilePath: string = '';

  /** 标记当前实例是否使用 rowid 降级方案（由 ensureVectorSchema 决定） */
  private useRowidMapping: boolean = false;

  /** rowid 降级方案下的自增 rowid 计数器（TEXT PK 方案无需此字段） */
  private rowidCounter: number = 0;

  get initialized(): boolean {
    return this._initialized;
  }

  // ============ 生命周期 ============

  /**
   * 初始化数据库连接，加载已有数据。
   * 幂等：重复调用直接返回。
   */
  async initialize(options?: SqliteVecInitOptions): Promise<void> {
    if (this._initialized) return;

    try {
      this.source = options?.source || 'default';
      this.sourceId = options?.sourceId || 'default';
      console.log(`[SqliteVecBackend] Initializing for source: ${this.source}, sourceId: ${this.sourceId}...`);

      // STEP 1: 加载维度配置（从 VecstoreVectorStore.ts:291-327 迁移）
      await this.loadDimensionFromConfig();

      // STEP 2: 确保目录存在
      await this.ensureStoreDir();

      // STEP 3: 打开数据库并加载 sqlite-vec 扩展
      this.dbFilePath = this.getStoreFilePath();
      console.log(`[SqliteVecBackend] Database file path: ${this.dbFilePath}`);
      this.db = await openVectorDatabase(this.dbFilePath);

      // STEP 4: 幂等建表
      ensureVectorSchema(this.db, this.dimension);
      this.useRowidMapping = !VEC0_TEXT_PK_SUPPORTED;

      if (this.useRowidMapping) {
        // 初始化 rowid 计数器为当前最大值 + 1
        const row = this.db.prepare('SELECT MAX(rowid) AS m FROM vec_items').get() as { m: number | null } | undefined;
        this.rowidCounter = (row?.m ?? 0) + 1;
        console.log(`[SqliteVecBackend] Using rowid mapping (TEXT PK not supported), rowidCounter starts at ${this.rowidCounter}`);
      }

      this._initialized = true;
      const count = this.count();
      console.log(`[SqliteVecBackend] Initialization complete. DB contains ${count} vectors, dimension=${this.dimension}`);
    } catch (error) {
      console.error('[SqliteVecBackend] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 维度变更时调用：切换到新维度对应的 DB 文件。
   * 不删除旧维度数据文件（用户切回时可恢复）。
   */
  async handleDimensionChange(newDimension: number): Promise<void> {
    if (newDimension === this.dimension) {
      console.log(`[SqliteVecBackend] handleDimensionChange: dimension unchanged (${newDimension}), skipping`);
      return;
    }

    console.log(`[SqliteVecBackend] handleDimensionChange: ${this.dimension} -> ${newDimension}`);

    // 1. 关闭旧 db 连接（SQLite 事务已即时落盘，无需 persist）
    this.closeDb();

    // 2. 更新 dimension 与路径
    this.dimension = newDimension;
    this.dbFilePath = this.getStoreFilePath();

    // 3. 打开新维度 db（若文件存在则加载已有数据，不存在则新建）
    await this.ensureStoreDir();
    this.db = await openVectorDatabase(this.dbFilePath);
    ensureVectorSchema(this.db, this.dimension);
    this.useRowidMapping = !VEC0_TEXT_PK_SUPPORTED;

    if (this.useRowidMapping) {
      const row = this.db.prepare('SELECT MAX(rowid) AS m FROM vec_items').get() as { m: number | null } | undefined;
      this.rowidCounter = (row?.m ?? 0) + 1;
    }

    this._initialized = true;
    const count = this.count();
    console.log(`[SqliteVecBackend] Store ready with dimension ${newDimension}, ${count} vectors`);
  }

  /**
   * 关闭数据库连接（应用退出或维度变更时调用）。
   * SQLite 事务已即时落盘，无需显式 persist。
   */
  async destroy(): Promise<void> {
    this.closeDb();
    this._initialized = false;
    console.log(`[SqliteVecBackend] destroy(): db closed for ${this.source}:${this.sourceId}`);
  }

  /**
   * 销毁 db 连接并物理删除 vectors.db 文件（用于完全删除文档/世界书场景）。
   * 同时删除 -wal / -shm 辅助文件。
   */
  async destroyAndDeleteFiles(): Promise<void> {
    console.log(`[SqliteVecBackend] destroyAndDeleteFiles(): ${this.source}:${this.sourceId}`);

    this.closeDb();
    this._initialized = false;

    let deletedCount = 0;

    // 删除主 db 文件
    if (this.dbFilePath) {
      for (const suffix of ['', '-wal', '-shm']) {
        const filePath = this.dbFilePath + suffix;
        try {
          await fsPromises.unlink(filePath);
          deletedCount++;
        } catch (err: any) {
          if (err?.code !== 'ENOENT') {
            console.warn(`[SqliteVecBackend] Failed to delete ${filePath}:`, err.message);
          }
        }
      }
    }

    console.log(`[SqliteVecBackend] destroyAndDeleteFiles(): deleted ${deletedCount} files`);
  }

  /**
   * 返回当前 db 文件路径（对齐 Repository 期望的方法名）。
   * 保留 getStoreFilePath 名称以减少 VectorStoreService.ts 改动。
   */
  getStoreFilePath(): string {
    const safeSourceId = this.getSafeSourceId();
    const dim = String(this.dimension || 1024);
    if (this.source === 'default' && (safeSourceId === 'default' || !safeSourceId)) {
      return path.join(getDatabaseDir(), 'vectors', this.source, dim, DB_FILE);
    }
    return path.join(getDatabaseDir(), 'vectors', this.source, safeSourceId, dim, DB_FILE);
  }

  // ============ IVectorBackend 核心方法 ============

  /**
   * 添加/更新单个向量。
   * SQLite 事务即时落盘，无需 debounce。
   */
  async add(id: string, vector: number[], metadata: Record<string, any>): Promise<void> {
    this.ensureInitialized();
    this.assertDimension(vector);

    const item: VectorItem = {
      id,
      vector,
      metadata: {
        ...metadata,
        text: metadata.text || '',
        source: metadata.source || 'unknown',
        sourceId: metadata.sourceId || id,
        createdAt: metadata.createdAt || Date.now(),
        updatedAt: Date.now(),
      },
    };

    this.upsertInternal(id, vector, item.metadata);
  }

  /**
   * 批量添加：单事务提交，性能远优于 vecstore 的逐条 upsert + 末尾 persist。
   */
  async addBatch(items: VectorItem[]): Promise<void> {
    this.ensureInitialized();
    if (!this.db || items.length === 0) return;

    for (const item of items) {
      this.assertDimension(item.vector);
    }

    const tx = this.db.transaction(() => {
      for (const item of items) {
        const metadata = {
          ...item.metadata,
          text: item.metadata?.text || '',
          source: item.metadata?.source || 'unknown',
          sourceId: item.metadata?.sourceId || item.id,
          createdAt: item.metadata?.createdAt || Date.now(),
          updatedAt: Date.now(),
        };
        this.upsertInternal(item.id, item.vector, metadata);
      }
    });
    tx();
  }

  /**
   * 批量添加但不 persist。
   * SQLite 事务即持久化，此方法与 addBatch 行为相同；
   * 保留方法签名以满足 IVectorBackend 接口契约。
   */
  async addBatchNoPersist(items: VectorItem[]): Promise<void> {
    await this.addBatch(items);
  }

  /**
   * 更新向量（含 metadata 合并）。
   * INSERT OR REPLACE 语义（同 add）。
   */
  async update(id: string, vector: number[], metadata?: Record<string, any>): Promise<void> {
    this.ensureInitialized();
    if (!this.db) return;
    this.assertDimension(vector);

    // 合并已有 metadata（通过 SQL 查询当前值）
    const existing = this.getMetadataRow(id);
    const mergedMetadata = metadata
      ? { ...(existing || {}), ...metadata, updatedAt: Date.now() }
      : (existing || { updatedAt: Date.now() });

    this.upsertInternal(id, vector, mergedMetadata);
  }

  /**
   * 删除单个向量。
   */
  async remove(id: string): Promise<void> {
    this.ensureInitialized();
    if (!this.db) return;

    const tx = this.db.transaction(() => {
      if (this.useRowidMapping) {
        const row = this.db!.prepare('SELECT rowid AS r FROM id_map WHERE id = ?').get(id) as { r: number } | undefined;
        if (row) {
          this.db!.prepare('DELETE FROM vec_items WHERE rowid = ?').run(row.r);
          this.db!.prepare('DELETE FROM id_map WHERE rowid = ?').run(row.r);
        }
      } else {
        this.db!.prepare('DELETE FROM vec_items WHERE id = ?').run(id);
      }
      this.db!.prepare('DELETE FROM item_metadata WHERE id = ?').run(id);
    });
    tx();
  }

  /**
   * 按 id 获取向量元数据。
   * 性能契约：SQL PRIMARY KEY 查找，O(log n)（B-tree 索引）。
   * 返回 null 表示未找到。
   * 注意：vector 返回空数组，对齐 vecstore 行为（消费方只用 metadata）。
   */
  async getById(id: string): Promise<VectorItem | null> {
    this.ensureInitialized();
    if (!this.db) return null;

    const row = this.getMetadataRow(id);
    if (!row) {
      return null;
    }

    return {
      id,
      vector: [],
      metadata: row as VectorItem['metadata'],
    };
  }

  /**
   * 向量相似度搜索。
   * score = 1 - distance（cosine distance → similarity），对齐 vecstore。
   * filter 下推到 SQL WHERE（白名单列名防注入）。
   *
   * ⚠️ Post-filter 语义（sqlite-vec vec0 已知限制）：
   *   vec0 虚拟表先按向量距离返回 top-K，再应用 WHERE 过滤元数据。
   *   若过滤后剩余条目 < K，结果数会少于 topK，即使库中存在更多匹配条目。
   *   这与原 vecstore 内存后过滤行为一致，语义保持；但调用方不应假设
   *   "filter 后必然返回 K 条"。若需保证 K 条，需扩大 topK 或按 source 分库。
   */
  async search(query: number[], topK: number, filter?: Record<string, any>): Promise<SearchResult[]> {
    this.ensureInitialized();
    if (!this.db) return [];

    // 维度不匹配时返回空（避免无效搜索）
    if (query.length !== this.dimension) {
      console.error(
        `[SqliteVecBackend] search(): dimension mismatch - query has ${query.length} but store expects ${this.dimension}. Returning empty.`
      );
      return [];
    }

    const queryVec = new Float32Array(query);

    if (this.useRowidMapping) {
      return this.searchRowid(queryVec, topK, filter);
    }
    return this.searchTextPk(queryVec, topK, filter);
  }

  /**
   * TEXT 主键方案的搜索实现。
   */
  private searchTextPk(queryVec: Float32Array, topK: number, filter?: Record<string, any>): SearchResult[] {
    const { whereClause, params } = this.buildFilterClause(filter);

    const sql = `
      SELECT v.id AS id, v.distance AS distance,
             m.text AS text, m.source AS source, m.sourceId AS sourceId,
             m.characterId AS characterId, m.worldBookPath AS worldBookPath,
             m.tags AS tags, m.createdAt AS createdAt, m.updatedAt AS updatedAt,
             m.extra AS extra
      FROM vec_items v
      JOIN item_metadata m ON v.id = m.id
      WHERE v.embedding MATCH ? AND v.k = ?${whereClause}
      ORDER BY v.distance
    `;

    const stmt = prepareVecStatement(this.db!, sql);
    const rows = stmt.all(queryVec, topK, ...params) as any[];

    return rows.map(row => ({
      id: row.id,
      score: 1 - row.distance,
      metadata: this.deserializeMetadata(row),
    }));
  }

  /**
   * rowid 降级方案的搜索实现。
   * 需要通过 id_map JOIN 取回字符串 id。
   */
  private searchRowid(queryVec: Float32Array, topK: number, filter?: Record<string, any>): SearchResult[] {
    const { whereClause, params } = this.buildFilterClause(filter);

    const sql = `
      SELECT im.id AS id, v.distance AS distance,
             m.text AS text, m.source AS source, m.sourceId AS sourceId,
             m.characterId AS characterId, m.worldBookPath AS worldBookPath,
             m.tags AS tags, m.createdAt AS createdAt, m.updatedAt AS updatedAt,
             m.extra AS extra
      FROM vec_items v
      JOIN id_map im ON v.rowid = im.rowid
      JOIN item_metadata m ON im.id = m.id
      WHERE v.embedding MATCH ? AND v.k = ?${whereClause}
      ORDER BY v.distance
    `;

    const stmt = prepareVecStatement(this.db!, sql);
    const rows = stmt.all(queryVec, topK, ...params) as any[];

    return rows.map(row => ({
      id: row.id,
      score: 1 - row.distance,
      metadata: this.deserializeMetadata(row),
    }));
  }

  /**
   * 清空当前 store 的所有向量。
   * DELETE 全表（单事务），O(n) 但远快于 vecstore 的重建实例。
   */
  async clear(): Promise<void> {
    this.ensureInitialized();
    if (!this.db) return;

    console.log(`[SqliteVecBackend] clear(): deleting all vectors`);
    const tx = this.db.transaction(() => {
      this.db!.exec('DELETE FROM vec_items');
      this.db!.exec('DELETE FROM item_metadata');
      if (this.useRowidMapping) {
        this.db!.exec('DELETE FROM id_map');
        this.rowidCounter = 1;
      }
    });
    tx();
    console.log(`[SqliteVecBackend] clear(): done`);
  }

  /**
   * 持久化到磁盘。
   * SQLite 事务已即时落盘，此方法为 no-op；
   * 可选触发 WAL checkpoint 加速后续读取。
   */
  async persist(): Promise<void> {
    this.ensureInitialized();
    if (!this.db) return;
    try {
      this.db.pragma('wal_checkpoint(PASSIVE)');
    } catch {
      // checkpoint 失败可忽略（数据已在 WAL 中）
    }
  }

  /**
   * 当前 store 向量总数。
   */
  async count(): Promise<number> {
    this.ensureInitialized();
    return this.size();
  }

  /**
   * 按前缀统计向量数（用于按 docId/characterId 统计）。
   * LIKE 转义防通配符注入。
   */
  async countByPrefix(prefix: string): Promise<number> {
    this.ensureInitialized();
    if (!this.db) return 0;

    const likePattern = this.escapeLikePattern(prefix) + '%';
    const row = this.db.prepare(
      "SELECT COUNT(*) AS c FROM item_metadata WHERE id LIKE ? ESCAPE '\\'"
    ).get(likePattern) as { c: number };
    return row.c;
  }

  /**
   * 按前缀删除向量。
   * @returns 删除的向量数量
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    this.ensureInitialized();
    if (!this.db) return 0;

    const likePattern = this.escapeLikePattern(prefix) + '%';
    let deleted = 0;

    const tx = this.db.transaction(() => {
      // 先收集要删除的 id
      const ids = this.db!.prepare(
        "SELECT id FROM item_metadata WHERE id LIKE ? ESCAPE '\\'"
      ).all(likePattern) as { id: string }[];

      if (ids.length === 0) return;

      if (this.useRowidMapping) {
        for (const { id } of ids) {
          const row = this.db!.prepare('SELECT rowid AS r FROM id_map WHERE id = ?').get(id) as { r: number } | undefined;
          if (row) {
            this.db!.prepare('DELETE FROM vec_items WHERE rowid = ?').run(row.r);
            this.db!.prepare('DELETE FROM id_map WHERE rowid = ?').run(row.r);
          }
        }
      } else {
        // 批量删除：构造 IN (?, ?, ...) 子句
        const placeholders = ids.map(() => '?').join(',');
        this.db!.prepare(`DELETE FROM vec_items WHERE id IN (${placeholders})`).run(...ids.map(i => i.id));
      }

      this.db!.prepare(
        "DELETE FROM item_metadata WHERE id LIKE ? ESCAPE '\\'"
      ).run(likePattern);

      deleted = ids.length;
    });
    tx();

    console.log(`[SqliteVecBackend] deleteByPrefix("${prefix}"): deleted ${deleted}`);
    return deleted;
  }

  // ============ 维度管理 ============

  /**
   * 校验向量维度是否匹配。不匹配时抛出 Error。
   */
  assertDimension(vector: number[]): void {
    if (vector.length === 0) {
      throw new Error(`Vector dimension mismatch: empty vector. Expected ${this.dimension}.`);
    }
    if (vector.length !== this.dimension) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.dimension}, got ${vector.length}. ` +
        'Please check your embedding model configuration.'
      );
    }
  }

  getDimension(): number {
    this.ensureInitialized();
    return this.dimension;
  }

  /**
   * 当前 store 中的向量数量（同步）。
   */
  size(): number {
    if (!this.db) return 0;
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM vec_items').get() as { c: number };
    return row.c;
  }

  getMode(): VectorStoreMode {
    return this.storeMode;
  }

  // ============ 内部辅助方法 ============

  /**
   * 从 VecstoreVectorStore.ts:291-327 迁移：加载维度配置。
   */
  private async loadDimensionFromConfig(): Promise<void> {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      const vectorConfig = settings?.vector;

      if (vectorConfig?.dimension) {
        this.dimension = vectorConfig.dimension;
        console.log(`[SqliteVecBackend] Loaded dimension from config: ${this.dimension}`);
        return;
      }

      if (vectorConfig?.remoteModel && vectorConfig?.remoteApiUrl) {
        try {
          console.log(`[SqliteVecBackend] Auto-detecting dimension from embedding API...`);
          const { embeddingService } = await import('./EmbeddingService');
          const testResult = await embeddingService.generateEmbedding('dimension detection test');
          if (testResult.success && testResult.dimension && testResult.dimension > 0) {
            this.dimension = testResult.dimension;
            console.log(`[SqliteVecBackend] Auto-detected dimension from API: ${this.dimension} (model: ${testResult.model})`);
            return;
          }
        } catch (detectError) {
          console.warn('[SqliteVecBackend] Auto-detection failed, falling back to model inference:', detectError);
        }
      }

      if (vectorConfig?.remoteModel) {
        this.dimension = this.inferDimensionFromModel(vectorConfig.remoteModel);
        console.log(`[SqliteVecBackend] Inferred dimension from model ${vectorConfig.remoteModel}: ${this.dimension}`);
      } else {
        console.log(`[SqliteVecBackend] Using default dimension: ${this.dimension}`);
      }
    } catch (error) {
      console.warn('[SqliteVecBackend] Failed to load dimension from config, using default 1024:', error);
    }
  }

  /**
   * 从 VecstoreVectorStore.ts:329-367 迁移：模型名 → 维度映射。
   */
  private inferDimensionFromModel(modelName: string): number {
    const modelDimensions: Record<string, number> = {
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
      'text-embedding-v1': 1536,
      'text-embedding-v2': 1536,
      'text-embedding-v3': 1536,
      'text-embedding-qwen': 4096,
      'qwen3-embedding-8b': 4096,
      'qwen3-embedding': 4096,
      'qwen3-embedding-4b': 2560,
      'qwen3-emb-4b': 2560,
      'qwen3-embedding-0.6b': 1024,
      'qwen3-emb-0.6b': 1024,
      'electroglyph/qwen3-embedding-0.6b': 1024,
      'onnx-community/qwen3-embedding-0.6b': 1024,
      'onnx-community/qwen3-embedding-4b': 2560,
      'onnx-community/qwen3-embedding-8b': 4096,
      'bge-large-zh-v1.5': 1024,
      'bge-base-zh-v1.5': 768,
      'bge-small-zh-v1.5': 512,
      'm3e-large': 1024,
      'm3e-base': 768,
      'm3e-small': 512,
      'bge-m3': 1024,
    };

    const lowerName = modelName.toLowerCase();
    for (const [model, dim] of Object.entries(modelDimensions)) {
      if (lowerName.includes(model.toLowerCase())) {
        console.log(`[SqliteVecBackend] Dimension detected from model '${modelName}': ${dim}`);
        return dim;
      }
    }

    console.warn(`[SqliteVecBackend] Unknown model '${modelName}', defaulting to 4096.`);
    return 4096;
  }

  /**
   * 从 VecstoreVectorStore.ts:646-664 迁移：安全化 sourceId。
   */
  private getSafeSourceId(): string {
    let safeId = this.sourceId;
    const parts = safeId.split(':');
    if (parts.length >= 2) {
      const docPart = parts.find(p => p.startsWith('doc_'));
      if (docPart) {
        safeId = docPart;
      } else {
        const corePart = parts.find(p => p.length > 5 && !/^[a-z]+$/i.test(p));
        if (corePart) {
          safeId = corePart;
        } else {
          safeId = parts[parts.length - 1];
        }
      }
    }
    safeId = safeId.replace(/[\\/:*?"<>|]/g, '_');
    return safeId || this.sourceId;
  }

  /**
   * 确保存储目录存在。
   */
  private async ensureStoreDir(): Promise<void> {
    const safeSourceId = this.getSafeSourceId();
    let baseDir: string;
    if (this.source === 'default' && (safeSourceId === 'default' || !safeSourceId)) {
      baseDir = path.join(getDatabaseDir(), 'vectors', this.source, String(this.dimension || 1024));
    } else {
      baseDir = path.join(getDatabaseDir(), 'vectors', this.source, safeSourceId, String(this.dimension || 1024));
    }
    await fsPromises.mkdir(baseDir, { recursive: true });
  }

  /**
   * 内部 upsert：根据 useRowidMapping 走不同路径。
   * 必须在事务内调用（调用方负责开事务）。
   */
  private upsertInternal(id: string, vector: number[], metadata: Record<string, any>): void {
    if (!this.db) return;
    const vec = new Float32Array(vector);

    if (this.useRowidMapping) {
      // rowid 方案：先查 id_map 是否已有 rowid
      let row = this.db.prepare('SELECT rowid AS r FROM id_map WHERE id = ?').get(id) as { r: number } | undefined;
      if (!row) {
        const newRowid = this.rowidCounter++;
        this.db.prepare('INSERT INTO id_map(rowid, id) VALUES (?, ?)').run(newRowid, id);
        this.db.prepare('INSERT INTO vec_items(rowid, embedding) VALUES (?, ?)').run(newRowid, vec);
      } else {
        // INSERT OR REPLACE：删除旧记录再插入（vec0 不支持 OR REPLACE）
        this.db.prepare('DELETE FROM vec_items WHERE rowid = ?').run(row.r);
        this.db.prepare('INSERT INTO vec_items(rowid, embedding) VALUES (?, ?)').run(row.r, vec);
      }
    } else {
      // TEXT 主键方案：vec0 虚拟表不支持 INSERT OR REPLACE 冲突解决，
      // 需先 DELETE 旧记录再 INSERT（与 rowid 方案一致）
      this.db.prepare('DELETE FROM vec_items WHERE id = ?').run(id);
      this.db.prepare('INSERT INTO vec_items(id, embedding) VALUES (?, ?)').run(id, vec);
    }

    // metadata 表始终用 TEXT id（无论 vec0 用什么主键）
    this.writeMetadataRow(id, metadata);
  }

  /**
   * 写入 metadata 行（INSERT OR REPLACE）。
   * 未列名字段进 extra（JSON）。
   */
  private writeMetadataRow(id: string, metadata: Record<string, any>): void {
    if (!this.db) return;

    const knownKeys = ['text', 'source', 'sourceId', 'characterId', 'worldBookPath', 'tags', 'createdAt', 'updatedAt'];
    const extra: Record<string, any> = {};
    for (const key of Object.keys(metadata)) {
      if (!knownKeys.includes(key)) {
        extra[key] = metadata[key];
      }
    }

    this.db.prepare(`INSERT OR REPLACE INTO item_metadata
      (id, text, source, sourceId, characterId, worldBookPath, tags, createdAt, updatedAt, extra)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      metadata.text || null,
      metadata.source || null,
      metadata.sourceId || null,
      metadata.characterId || null,
      metadata.worldBookPath || null,
      metadata.tags ? JSON.stringify(metadata.tags) : null,
      metadata.createdAt || Date.now(),
      metadata.updatedAt || Date.now(),
      Object.keys(extra).length > 0 ? JSON.stringify(extra) : null
    );
  }

  /**
   * 读取 metadata 行并反序列化（含 extra 字段合并）。
   */
  private getMetadataRow(id: string): Record<string, any> | null {
    if (!this.db) return null;

    const row = this.db.prepare(
      'SELECT text, source, sourceId, characterId, worldBookPath, tags, createdAt, updatedAt, extra FROM item_metadata WHERE id = ?'
    ).get(id) as any;

    if (!row) return null;
    return this.deserializeMetadata(row);
  }

  /**
   * 将数据库行反序列化为 metadata 对象（含 extra 字段合并 + tags JSON 解析）。
   */
  private deserializeMetadata(row: any): Record<string, any> {
    const metadata: Record<string, any> = {
      text: row.text || '',
      source: row.source || '',
      sourceId: row.sourceId || '',
      characterId: row.characterId || undefined,
      worldBookPath: row.worldBookPath || undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      createdAt: row.createdAt || 0,
      updatedAt: row.updatedAt || 0,
    };

    // 合并 extra 字段
    if (row.extra) {
      try {
        const extra = JSON.parse(row.extra);
        Object.assign(metadata, extra);
      } catch {
        // extra 解析失败忽略
      }
    }

    return metadata;
  }

  /**
   * 构建 search filter 的 SQL WHERE 子句。
   * 白名单列名防注入；未知列名忽略。
   * 支持数组值（生成 IN 子句）和标量值（生成 = 比较）。
   * 空数组生成 1=0（永不匹配），避免 SQL 语法错误。
   */
  private buildFilterClause(filter?: Record<string, any>): { whereClause: string; params: any[] } {
    if (!filter || Object.keys(filter).length === 0) {
      return { whereClause: '', params: [] };
    }

    const conditions: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(filter)) {
      if (!METADATA_COLUMN_WHITELIST.has(key)) {
        console.warn(`[SqliteVecBackend] filter column "${key}" not in whitelist, ignored`);
        continue;
      }

      if (Array.isArray(value)) {
        if (value.length === 0) {
          conditions.push('1=0');
        } else {
          const placeholders = value.map(() => '?').join(', ');
          conditions.push(`m.${key} IN (${placeholders})`);
          params.push(...value);
        }
      } else {
        conditions.push(`m.${key} = ?`);
        params.push(value);
      }
    }

    if (conditions.length === 0) {
      return { whereClause: '', params: [] };
    }

    return {
      whereClause: ' AND ' + conditions.join(' AND '),
      params,
    };
  }

  /**
   * 转义 LIKE 模式中的特殊字符（_、%、\）。
   * 使用 ESCAPE '\' 子句配合。
   */
  private escapeLikePattern(pattern: string): string {
    return pattern.replace(/[\\%_]/g, '\\$&');
  }

  /**
   * 关闭 db 连接（内部辅助）。
   */
  private closeDb(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch (e) {
        console.warn(`[SqliteVecBackend] closeDb: failed to close:`, e);
      }
      this.db = null;
    }
  }

  private ensureInitialized(): void {
    if (!this._initialized) {
      throw new Error('SqliteVecBackend 尚未初始化');
    }
  }
}
