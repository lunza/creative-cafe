/**
 * EmbeddingCache 单元测试
 *
 * 来源：spec §二 Task 10（SubTask 10.1 LRU + SubTask 10.2 SQLite 持久化）
 *
 * 覆盖：
 *  1. LRU 内存缓存：get/set/淘汰/TTL/模型隔离
 *  2. SQLite 持久化：内存未命中 → 查持久化 → 回填内存
 *  3. set 双写：内存 + 持久化均写入
 *  4. 降级：持久化抛错不阻断 get/set
 *  5. invalidateByModel / clear 双清
 *  6. 向量序列化往返（Float32Array ↔ Buffer）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  EmbeddingCache,
  SqliteEmbeddingCachePersistence,
  type IEmbeddingCachePersistence,
} from '../EmbeddingCache';
import type { EmbeddingCacheRow } from '../agent/memory/sqliteBackend';

// ==================== Mock 持久化后端 ====================

/**
 * 内存版 IEmbeddingCachePersistence mock，模拟 SQLite 行为。
 * 用于验证 EmbeddingCache 与持久化层的交互逻辑，无需 better-sqlite3 原生模块。
 */
class MockPersistence implements IEmbeddingCachePersistence {
  store = new Map<string, EmbeddingCacheRow>();
  getCalls = 0;
  upsertCalls = 0;
  shouldThrow = false;

  get(cacheKey: string): EmbeddingCacheRow | undefined {
    this.getCalls += 1;
    if (this.shouldThrow) throw new Error('mock persistence failure');
    return this.store.get(cacheKey);
  }
  upsert(row: EmbeddingCacheRow): void {
    this.upsertCalls += 1;
    if (this.shouldThrow) throw new Error('mock persistence failure');
    this.store.set(row.cache_key, row);
  }
  deleteByKey(cacheKey: string): void {
    this.store.delete(cacheKey);
  }
  deleteByModel(modelName: string): number {
    let removed = 0;
    for (const [key, row] of this.store) {
      if (row.model_name === modelName) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
  clear(): void {
    this.store.clear();
  }
}

// ==================== 测试数据 ====================

const SAMPLE_VECTOR = Array.from({ length: 8 }, (_, i) => (i + 1) * 0.1);

function makeCache(maxSize = 100): EmbeddingCache {
  return new EmbeddingCache({ maxSize, ttlMs: 0 });
}

// ==================== 测试用例 ====================

describe('EmbeddingCache - LRU 内存缓存 (SubTask 10.1)', () => {
  let cache: EmbeddingCache;

  beforeEach(() => {
    cache = makeCache(3);
  });

  it('set/get 基本读写', () => {
    cache.set('hello', 'm1', { vector: SAMPLE_VECTOR, dimension: 8, model: 'm1', mode: 'remote' });
    const cached = cache.get('hello', 'm1');
    expect(cached).toBeDefined();
    expect(cached!.vector).toEqual(SAMPLE_VECTOR);
    expect(cached!.model).toBe('m1');
    expect(cached!.mode).toBe('remote');
  });

  it('未命中返回 undefined 并计 miss', () => {
    const cached = cache.get('missing', 'm1');
    expect(cached).toBeUndefined();
    expect(cache.getStats().misses).toBe(1);
    expect(cache.getStats().hits).toBe(0);
  });

  it('命中计 hit 且 hitRate 正确', () => {
    cache.set('a', 'm1', { vector: SAMPLE_VECTOR, dimension: 8, model: 'm1', mode: 'remote' });
    cache.get('a', 'm1'); // hit
    cache.get('b', 'm1'); // miss
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5);
  });

  it('LRU 淘汰：超 maxSize 删除最久未使用', () => {
    cache.set('a', 'm1', { vector: SAMPLE_VECTOR, dimension: 8, model: 'm1', mode: 'remote' });
    cache.set('b', 'm1', { vector: SAMPLE_VECTOR, dimension: 8, model: 'm1', mode: 'remote' });
    cache.set('c', 'm1', { vector: SAMPLE_VECTOR, dimension: 8, model: 'm1', mode: 'remote' });
    expect(cache.size).toBe(3);
    // 插入第 4 个，淘汰 a（最久未使用）
    cache.set('d', 'm1', { vector: SAMPLE_VECTOR, dimension: 8, model: 'm1', mode: 'remote' });
    expect(cache.size).toBe(3);
    expect(cache.get('a', 'm1')).toBeUndefined();
    expect(cache.get('d', 'm1')).toBeDefined();
    expect(cache.getStats().evictions).toBeGreaterThanOrEqual(1);
  });

  it('LRU 顺序更新：get 后该条目不被淘汰', () => {
    cache.set('a', 'm1', { vector: SAMPLE_VECTOR, dimension: 8, model: 'm1', mode: 'remote' });
    cache.set('b', 'm1', { vector: SAMPLE_VECTOR, dimension: 8, model: 'm1', mode: 'remote' });
    cache.set('c', 'm1', { vector: SAMPLE_VECTOR, dimension: 8, model: 'm1', mode: 'remote' });
    // 访问 a，使其成为最近使用
    cache.get('a', 'm1');
    // 插入 d，应淘汰 b（而非 a）
    cache.set('d', 'm1', { vector: SAMPLE_VECTOR, dimension: 8, model: 'm1', mode: 'remote' });
    expect(cache.get('a', 'm1')).toBeDefined();
    expect(cache.get('b', 'm1')).toBeUndefined();
  });

  it('模型隔离：相同文本不同模型不冲突', () => {
    cache.set('hello', 'm1', { vector: [1, 2], dimension: 2, model: 'm1', mode: 'remote' });
    cache.set('hello', 'm2', { vector: [3, 4], dimension: 2, model: 'm2', mode: 'remote' });
    expect(cache.get('hello', 'm1')!.vector).toEqual([1, 2]);
    expect(cache.get('hello', 'm2')!.vector).toEqual([3, 4]);
  });

  it('文本标准化：trim + lowercase 提升命中率', () => {
    cache.set('  Hello World  ', 'm1', { vector: [1], dimension: 1, model: 'm1', mode: 'remote' });
    // 不同大小写/空白应命中同一缓存键
    expect(cache.get('hello world', 'm1')).toBeDefined();
    expect(cache.get(' HELLO WORLD ', 'm1')).toBeDefined();
  });

  it('TTL 过期：超时后未命中', () => {
    const ttlCache = new EmbeddingCache({ maxSize: 100, ttlMs: 50 });
    ttlCache.set('a', 'm1', { vector: [1], dimension: 1, model: 'm1', mode: 'remote' });
    expect(ttlCache.get('a', 'm1')).toBeDefined();
    // 手动推进：直接操作时间不可行，用 fake timer
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(ttlCache.get('a', 'm1')).toBeUndefined();
        resolve();
      }, 80);
    });
  });
});

describe('EmbeddingCache - SQLite 持久化 (SubTask 10.2)', () => {
  let cache: EmbeddingCache;
  let mock: MockPersistence;

  beforeEach(() => {
    cache = makeCache(100);
    mock = new MockPersistence();
    cache.attachPersistence(mock);
  });

  it('get 内存未命中 → 查持久化 → 回填内存', () => {
    // 通过 cache1.set 写入持久化（使用正确的 SHA-256 哈希键）
    const cache1 = makeCache(100);
    cache1.attachPersistence(mock);
    cache1.set('persistent-entry', 'm1', {
      vector: SAMPLE_VECTOR, dimension: 8, model: 'm1', mode: 'remote',
    });
    expect(mock.store.size).toBe(1);

    // 模拟重启：新建 cache2（内存为空），接同一持久化
    const cache2 = makeCache(100);
    cache2.attachPersistence(mock);

    // 内存未命中，应查持久化
    const cached = cache2.get('persistent-entry', 'm1');
    expect(cached).toBeDefined();
    // Float32 序列化有精度损失，用近似比较
    expect(cached!.vector.length).toBe(SAMPLE_VECTOR.length);
    for (let i = 0; i < SAMPLE_VECTOR.length; i++) {
      expect(Math.abs(cached!.vector[i] - SAMPLE_VECTOR[i])).toBeLessThan(1e-6);
    }
    expect(cached!.dimension).toBe(8);
    expect(mock.getCalls).toBe(1);

    // 回填内存：第二次 get 不应再查持久化
    mock.getCalls = 0;
    cache2.get('persistent-entry', 'm1');
    expect(mock.getCalls).toBe(0);
    expect(cache2.getStats().persistenceHits).toBe(1);
  });

  it('set 双写：内存 + 持久化', () => {
    cache.set('hello', 'm1', { vector: SAMPLE_VECTOR, dimension: 8, model: 'm1', mode: 'local' });

    // 内存有
    expect(cache.get('hello', 'm1')).toBeDefined();
    // 持久化也有
    expect(mock.upsertCalls).toBe(1);
    expect(mock.store.size).toBe(1);
    const row = Array.from(mock.store.values())[0];
    expect(row.model_name).toBe('m1');
    expect(row.mode).toBe('local');
    expect(row.dimension).toBe(8);
  });

  it('向量序列化往返：Float32Array ↔ Buffer 精度保持', () => {
    const floatVec = [0.123456, -0.789012, 1.5, 0, -2.25];
    cache.set('precision', 'm1', { vector: floatVec, dimension: 5, model: 'm1', mode: 'remote' });

    // 清空内存，强制走持久化
    cache.clear();
    // clear 也清了持久化，需重新 set
    cache.set('precision', 'm1', { vector: floatVec, dimension: 5, model: 'm1', mode: 'remote' });
    // 模拟内存丢失（重启）：新建 cache 接同一持久化
    const newCache = makeCache(100);
    newCache.attachPersistence(mock);
    const restored = newCache.get('precision', 'm1');
    expect(restored).toBeDefined();
    // Float32 精度
    expect(restored!.vector.length).toBe(5);
    for (let i = 0; i < floatVec.length; i++) {
      expect(Math.abs(restored!.vector[i] - floatVec[i])).toBeLessThan(1e-6);
    }
  });

  it('降级：持久化 get 抛错不阻断，返回 undefined', () => {
    mock.shouldThrow = true;
    cache.set('a', 'm1', { vector: [1], dimension: 1, model: 'm1', mode: 'remote' });
    // set 时持久化抛错，但内存仍写入
    expect(cache.get('a', 'm1')).toBeDefined();
    expect(cache.getStats().persistenceErrors).toBeGreaterThanOrEqual(1);

    // get 内存未命中时持久化抛错，应返回 undefined 而非抛出
    const result = cache.get('missing', 'm1');
    expect(result).toBeUndefined();
  });

  it('降级：无持久化时纯内存模式正常工作', () => {
    const memOnly = makeCache(100);
    memOnly.attachPersistence(null);
    memOnly.set('a', 'm1', { vector: [1], dimension: 1, model: 'm1', mode: 'remote' });
    expect(memOnly.get('a', 'm1')).toBeDefined();
    expect(memOnly.getStats().persistenceHits).toBe(0);
  });

  it('invalidateByModel 双清：内存 + 持久化', () => {
    cache.set('a', 'm1', { vector: [1], dimension: 1, model: 'm1', mode: 'remote' });
    cache.set('b', 'm2', { vector: [2], dimension: 1, model: 'm2', mode: 'remote' });
    cache.set('c', 'm1', { vector: [3], dimension: 1, model: 'm1', mode: 'remote' });

    const removed = cache.invalidateByModel('m1');
    expect(removed).toBeGreaterThanOrEqual(2); // 内存 2 + 持久化 2
    expect(cache.get('a', 'm1')).toBeUndefined();
    expect(cache.get('c', 'm1')).toBeUndefined();
    expect(cache.get('b', 'm2')).toBeDefined();
    // 持久化侧 m1 也被清
    expect(Array.from(mock.store.values()).filter(r => r.model_name === 'm1').length).toBe(0);
  });

  it('clear 双清：内存统计 + 持久化', () => {
    cache.set('a', 'm1', { vector: [1], dimension: 1, model: 'm1', mode: 'remote' });
    cache.set('b', 'm1', { vector: [2], dimension: 1, model: 'm1', mode: 'remote' });
    cache.clear();
    expect(cache.size).toBe(0);
    expect(mock.store.size).toBe(0);
    expect(cache.getStats().hits).toBe(0);
  });

  it('delete 双删：避免回填已删除条目', () => {
    cache.set('a', 'm1', { vector: [1], dimension: 1, model: 'm1', mode: 'remote' });
    expect(cache.delete('a', 'm1')).toBe(true);
    // 持久化也删除
    expect(mock.store.size).toBe(0);
    // 新 cache 接同一持久化，不应回填
    const newCache = makeCache(100);
    newCache.attachPersistence(mock);
    expect(newCache.get('a', 'm1')).toBeUndefined();
  });
});

describe('EmbeddingCache - SqliteEmbeddingCachePersistence 序列化契约', () => {
  it('vectorToBuffer / bufferToVector 往返一致', () => {
    // 通过 set/get 间接验证序列化路径
    const cache = makeCache(100);
    const mock = new MockPersistence();
    cache.attachPersistence(mock);

    const vec = [0.5, -0.25, 1.25, 0, 99.5];
    cache.set('rt', 'm1', { vector: vec, dimension: 5, model: 'm1', mode: 'remote' });

    // 持久化存储的 vector 是 Buffer（Float32）
    const row = mock.store.get(Array.from(mock.store.keys())[0])!;
    expect(Buffer.isBuffer(row.vector)).toBe(true);
    expect(row.vector.byteLength).toBe(5 * 4); // 5 floats * 4 bytes

    // 反序列化精度
    const newCache = makeCache(100);
    newCache.attachPersistence(mock);
    const restored = newCache.get('rt', 'm1')!;
    expect(restored.vector.length).toBe(5);
    for (let i = 0; i < vec.length; i++) {
      expect(Math.abs(restored.vector[i] - vec[i])).toBeLessThan(1e-6);
    }
  });
});

describe('SqliteEmbeddingCachePersistence - 未初始化后端降级', () => {
  it('backend.isInitialized=false 时所有操作安全返回（不抛错）', () => {
    // 构造一个未初始化的 backend mock
    const uninitializedBackend = {
      isInitialized: false,
      prepare: () => {
        throw new Error('should not be called when not initialized');
      },
    } as any;

    const persistence = new SqliteEmbeddingCachePersistence(uninitializedBackend);
    expect(persistence.get('any')).toBeUndefined();
    expect(() => persistence.upsert({} as any)).not.toThrow();
    expect(() => persistence.deleteByKey('any')).not.toThrow();
    expect(persistence.deleteByModel('any')).toBe(0);
    expect(() => persistence.clear()).not.toThrow();
  });
});
