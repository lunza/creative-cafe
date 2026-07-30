/**
 * EmbeddingCache —— content-hash → vector LRU 缓存（内存 + SQLite 持久化）
 *
 * 来源：spec §二 Task 10（EmbeddingService 缓存，P1 性能修复）
 *       SubTask 10.1：content-hash → vector LRU 内存缓存
 *       SubTask 10.2：缓存持久化到 SQLite（跨重启复用）
 * 决策：自研。P1 性能瓶颈：每次 generateEmbedding 都调用远程 API 或本地模型，
 *       重复文本（如世界书条目、角色描述）产生冗余请求。
 *
 * 职责：
 *  1. content-hash → vector LRU 内存缓存（Map + maxSize 淘汰）
 *  2. SHA-256 哈希文本（标准化：trim + lowercase 提升命中率）
 *  3. 按模型名隔离缓存（模型切换时缓存自动隔离）
 *  4. SQLite 持久化（可选，通过 attachPersistence 启用）
 *     - get 内存未命中 → 查 SQLite → 回填内存（warm-up）
 *     - set 双写（内存 + SQLite），SQLite 写失败仅记日志不抛错
 *     - vector 序列化：Float32Array ↔ Buffer（紧凑存储，4 字节/维）
 *
 * 设计约束：
 *  - 缓存键：SHA-256(normalizedText + modelName)
 *  - LRU 淘汰：Map 保持插入顺序，超 maxSize 时删除最旧条目
 *  - 缓存值：{ vector, dimension, model, mode, timestamp }
 *  - 线程安全：单进程同步访问（Electron 主进程单线程）
 *  - 降级保护：缓存初始化失败 / SQLite 不可用不影响 EmbeddingService 正常工作
 */

import { createHash } from 'crypto';
import type { AgentSqliteBackend, EmbeddingCacheRow } from './agent/memory/sqliteBackend';

// ==================== 类型定义 ====================

export interface CachedEmbedding {
  vector: number[];
  dimension: number;
  model: string;
  mode: 'local' | 'remote';
  timestamp: number;
}

export interface EmbeddingCacheOptions {
  /** 最大缓存条目数（默认 1000） */
  maxSize?: number;
  /** 缓存 TTL（毫秒，默认 0 = 永不过期） */
  ttlMs?: number;
}

// ==================== 持久化后端接口（最小契约） ====================

/**
 * EmbeddingCache 持久化后端契约。
 *
 * 仅依赖 AgentSqliteBackend 的 prepare/transaction 子集，便于测试替换。
 * 实际实现复用 getAgentBackend()（共享 WAL 连接 + embedding_cache 表）。
 */
export interface IEmbeddingCachePersistence {
  /** 按缓存键查询持久化条目 */
  get(cacheKey: string): EmbeddingCacheRow | undefined;
  /** 写入（UPSERT）持久化条目 */
  upsert(row: EmbeddingCacheRow): void;
  /** 按缓存键删除单条持久化条目 */
  deleteByKey(cacheKey: string): void;
  /** 按模型名删除持久化条目 */
  deleteByModel(modelName: string): number;
  /** 清空持久化缓存 */
  clear(): void;
}

// ==================== 向量序列化 ====================

/**
 * number[] → Buffer（Float32Array，4 字节/维）。
 *
 * 相比 JSON 字符串（~15 字节/维）节省 ~70% 存储，且读写更快。
 */
function vectorToBuffer(vector: number[]): Buffer {
  const float32 = new Float32Array(vector);
  // 拷贝以脱离 ArrayBuffer（避免 better-sqlite3 持有视图导致意外截断）
  return Buffer.from(float32.buffer.slice(float32.byteOffset, float32.byteOffset + float32.byteLength));
}

/**
 * Buffer → number[]（Float32Array 反序列化）。
 */
function bufferToVector(buf: Buffer): number[] {
  const float32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(float32);
}

// ==================== EmbeddingCache 实现 ====================

/**
 * Embedding LRU 缓存（内存 + 可选 SQLite 持久化）。
 *
 * 使用 Map（保持插入顺序）实现 LRU：
 *  - get/delete 时重新插入到末尾（标记为最近使用）
 *  - 超 maxSize 时删除 Map 第一个条目（最久未使用）
 *
 * 持久化（attachPersistence 后启用）：
 *  - get 内存未命中 → 查 SQLite → 命中则回填内存
 *  - set 双写内存 + SQLite（SQLite 失败仅记日志，不阻断）
 *
 * 用法：
 * ```ts
 * const cache = new EmbeddingCache({ maxSize: 2000 });
 *
 * // 查询缓存
 * const cached = cache.get(text, modelName);
 * if (cached) return cached;
 *
 * // 生成并缓存
 * const result = await generateEmbedding(text);
 * if (result.success) {
 *   cache.set(text, modelName, result);
 * }
 * ```
 */
export class EmbeddingCache {
  private readonly cache = new Map<string, CachedEmbedding>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  /** SQLite 持久化后端（attachPersistence 后启用，null = 仅内存） */
  private persistence: IEmbeddingCachePersistence | null = null;
  /** 缓存统计（用于性能监控） */
  private stats = { hits: 0, misses: 0, sets: 0, evictions: 0, persistenceHits: 0, persistenceErrors: 0 };

  constructor(options: EmbeddingCacheOptions = {}) {
    // 允许任意正数 maxSize（含小值，便于测试 LRU 淘汰）；非正数或缺省回退 1000
    this.maxSize = options.maxSize && options.maxSize > 0 ? options.maxSize : 1000;
    this.ttlMs = options.ttlMs ?? 0;
  }

  /**
   * 接入 SQLite 持久化后端。
   *
   * 在 EmbeddingService.initialize 中调用：initAgentBackendIfNeeded() 成功后注入。
   * 注入后 get/set/clear/invalidateByModel 自动双写。
   * 失败（backend 为 null）保持仅内存模式，调用方正常工作。
   */
  attachPersistence(persistence: IEmbeddingCachePersistence | null): void {
    this.persistence = persistence;
  }

  /**
   * 生成缓存键。
   *
   * 键 = SHA-256(normalizedText + '|' + modelName)
   * 标准化：trim + lowercase（提升相似文本命中率）
   */
  private static computeKey(text: string, modelName: string): string {
    const normalized = text.trim().toLowerCase();
    return createHash('sha256')
      .update(`${normalized}|${modelName}`)
      .digest('hex');
  }

  /**
   * 查询缓存。
   *
   * 查询顺序：内存 LRU → （未命中）SQLite 持久化 → 回填内存
   *
   * @returns 缓存命中时返回 CachedEmbedding，未命中或过期返回 undefined
   */
  get(text: string, modelName: string): CachedEmbedding | undefined {
    const key = EmbeddingCache.computeKey(text, modelName);
    const entry = this.cache.get(key);

    if (entry) {
      // TTL 检查
      if (this.ttlMs > 0 && Date.now() - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        // 落到下方持久化查询
      } else {
        // LRU：重新插入到末尾（标记为最近使用）
        this.cache.delete(key);
        this.cache.set(key, entry);
        this.stats.hits += 1;
        return entry;
      }
    }

    // 内存未命中 → 查 SQLite 持久化
    if (this.persistence) {
      try {
        const row = this.persistence.get(key);
        if (row) {
          const persisted: CachedEmbedding = {
            vector: bufferToVector(row.vector),
            dimension: row.dimension,
            model: row.model_name,
            mode: row.mode as 'local' | 'remote',
            timestamp: row.created_at,
          };
          // 回填内存（warm-up），不计入 sets 统计
          this.backfillMemory(key, persisted);
          this.stats.persistenceHits += 1;
          this.stats.hits += 1;
          return persisted;
        }
      } catch (err) {
        this.stats.persistenceErrors += 1;
        // 持久化查询失败不阻断：降级为未命中
        console.warn('[EmbeddingCache] persistence get failed (degrading):', err instanceof Error ? err.message : String(err));
      }
    }

    this.stats.misses += 1;
    return undefined;
  }

  /**
   * 回填内存缓存（来自 SQLite 命中），遵循 maxSize 淘汰。
   */
  private backfillMemory(key: string, entry: CachedEmbedding): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, entry);
    while (this.cache.size > this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
      this.stats.evictions += 1;
    }
  }

  /**
   * 写入缓存（双写内存 + SQLite）。
   *
   * 超过 maxSize 时淘汰最旧条目（LRU）。
   * SQLite 写失败仅记日志，不影响内存缓存与调用方。
   */
  set(text: string, modelName: string, value: Omit<CachedEmbedding, 'timestamp'>): void {
    const key = EmbeddingCache.computeKey(text, modelName);
    const entry: CachedEmbedding = {
      ...value,
      timestamp: Date.now(),
    };

    // 若键已存在，先删除（重新插入到末尾）
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, entry);
    this.stats.sets += 1;

    // LRU 淘汰
    while (this.cache.size > this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
      this.stats.evictions += 1;
    }

    // SQLite 双写（异步容错：失败不阻断）
    if (this.persistence) {
      try {
        this.persistence.upsert({
          cache_key: key,
          model_name: modelName,
          vector: vectorToBuffer(value.vector),
          dimension: value.dimension,
          mode: value.mode,
          created_at: entry.timestamp,
          last_accessed_at: entry.timestamp,
        });
      } catch (err) {
        this.stats.persistenceErrors += 1;
        console.warn('[EmbeddingCache] persistence upsert failed (degrading):', err instanceof Error ? err.message : String(err));
      }
    }
  }

  /**
   * 删除指定缓存条目（内存 + SQLite）。
   *
   * 双删以保证一致性：避免内存删除后下次 get 从 SQLite 回填已失效条目。
   */
  delete(text: string, modelName: string): boolean {
    const key = EmbeddingCache.computeKey(text, modelName);
    const removed = this.cache.delete(key);
    if (this.persistence) {
      try {
        this.persistence.deleteByKey(key);
      } catch (err) {
        this.stats.persistenceErrors += 1;
        console.warn('[EmbeddingCache] persistence delete failed (degrading):', err instanceof Error ? err.message : String(err));
      }
    }
    return removed;
  }

  /**
   * 清除所有缓存（内存 + SQLite）。
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0, persistenceHits: 0, persistenceErrors: 0 };
    if (this.persistence) {
      try {
        this.persistence.clear();
      } catch (err) {
        console.warn('[EmbeddingCache] persistence clear failed (degrading):', err instanceof Error ? err.message : String(err));
      }
    }
  }

  /**
   * 当前内存缓存大小。
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * 获取缓存统计信息。
   */
  getStats(): { hits: number; misses: number; sets: number; evictions: number; persistenceHits: number; persistenceErrors: number; hitRate: number; size: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      size: this.cache.size,
    };
  }

  /**
   * 按模型名清除缓存（模型切换时调用）。
   *
   * 由于缓存键包含 modelName，内存侧需遍历所有条目检查 model 字段；
   * SQLite 侧按 model_name 索引删除。
   */
  invalidateByModel(modelName: string): number {
    let removed = 0;
    for (const [key, entry] of this.cache) {
      if (entry.model === modelName) {
        this.cache.delete(key);
        removed += 1;
      }
    }
    if (this.persistence) {
      try {
        removed += this.persistence.deleteByModel(modelName);
      } catch (err) {
        this.stats.persistenceErrors += 1;
        console.warn('[EmbeddingCache] persistence invalidateByModel failed (degrading):', err instanceof Error ? err.message : String(err));
      }
    }
    return removed;
  }
}

// ==================== SQLite 持久化实现 ====================

/**
 * 基于 AgentSqliteBackend 的 EmbeddingCache 持久化实现。
 *
 * 复用 agent SQLite 连接（WAL）与 embedding_cache 表（schema 见 sqliteBackend.ts）。
 * 所有操作同步（better-sqlite3 同步 API），事务内执行保证原子性。
 */
export class SqliteEmbeddingCachePersistence implements IEmbeddingCachePersistence {
  constructor(private readonly backend: AgentSqliteBackend) {}

  get(cacheKey: string): EmbeddingCacheRow | undefined {
    if (!this.backend.isInitialized) return undefined;
    const select = this.backend.prepare(
      `SELECT * FROM embedding_cache WHERE cache_key = ?`
    );
    const row = select.get<EmbeddingCacheRow>(cacheKey);
    if (row) {
      // 命中时同步更新 last_accessed_at（持久化侧 LRU 近似）
      const update = this.backend.prepare(
        `UPDATE embedding_cache SET last_accessed_at = ? WHERE cache_key = ?`
      );
      update.run(Date.now(), cacheKey);
    }
    return row;
  }

  upsert(row: EmbeddingCacheRow): void {
    if (!this.backend.isInitialized) return;
    const stmt = this.backend.prepare(
      `INSERT INTO embedding_cache (cache_key, model_name, vector, dimension, mode, created_at, last_accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         vector = excluded.vector,
         dimension = excluded.dimension,
         mode = excluded.mode,
         last_accessed_at = excluded.last_accessed_at`
    );
    stmt.run(
      row.cache_key,
      row.model_name,
      row.vector,
      row.dimension,
      row.mode,
      row.created_at,
      row.last_accessed_at
    );
  }

  deleteByKey(cacheKey: string): void {
    if (!this.backend.isInitialized) return;
    const stmt = this.backend.prepare(`DELETE FROM embedding_cache WHERE cache_key = ?`);
    stmt.run(cacheKey);
  }

  deleteByModel(modelName: string): number {
    if (!this.backend.isInitialized) return 0;
    const stmt = this.backend.prepare(`DELETE FROM embedding_cache WHERE model_name = ?`);
    const result = stmt.run(modelName);
    return result.changes;
  }

  clear(): void {
    if (!this.backend.isInitialized) return;
    this.backend.prepare(`DELETE FROM embedding_cache`).run();
  }
}

// ==================== 单例 ====================

let cacheInstance: EmbeddingCache | null = null;

/**
 * 获取 EmbeddingCache 单例。
 */
export function getEmbeddingCache(options?: EmbeddingCacheOptions): EmbeddingCache {
  if (!cacheInstance) {
    cacheInstance = new EmbeddingCache(options);
  }
  return cacheInstance;
}

/**
 * 重置缓存单例（仅测试用）。
 */
export function resetEmbeddingCache(): void {
  cacheInstance = null;
}
