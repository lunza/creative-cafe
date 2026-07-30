/**
 * SqliteVecBackend 单元测试
 *
 * 验证目标（spec: sqlite-vec-vector-backend-upgrade.md §验证）：
 *   1. add/search（含 metadata 过滤）/getById/countByPrefix/deleteByPrefix/clear
 *   2. dimension 校验（assertDimension 抛错）
 *   3. 批量插入（addBatch）
 *   4. 行为等价性：cosine 排序与 score = 1 - distance
 *
 * 测试策略：
 *   better-sqlite3 / sqlite-vec 为原生模块，在纯 node vitest 环境无法加载
 *   （ABI 不匹配）。采用 FakeVectorDb 内存版数据库，实现 SqliteDatabase 接口
 *   的 SQL 子集（对齐 fakeBackend.ts 模式），search 用手动 cosine 相似度
 *   替代 vec0 MATCH KNN 查询。
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as path from 'path';

// ============ Mock electron ============
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata'),
  },
}));

// ============ Mock storageService ============
vi.mock('../storageService', () => ({
  getStorageService: vi.fn(() => ({
    getSettings: vi.fn(() => ({
      vector: {
        dimension: 4,
        embeddingMode: 'remote',
      },
    })),
  })),
}));

// ============ Mock EmbeddingService（loadDimensionFromConfig 自动探测路径用） ============
vi.mock('../EmbeddingService', () => ({
  embeddingService: {
    generateEmbedding: vi.fn(),
  },
}));

// ============ Partial mock sqliteVecUtils ============
// 保留 prepareVecStatement / VEC0_TEXT_PK_SUPPORTED 真实实现（纯 JS 逻辑，不依赖原生模块），
// 仅替换需要原生模块的 openVectorDatabase / ensureVectorSchema。
vi.mock('../vector/sqliteVecUtils', async (importActual) => {
  const actual = await importActual() as any;
  return {
    ...actual,
    openVectorDatabase: vi.fn(),
    ensureVectorSchema: vi.fn(),
  };
});

// 静音 console 以保持测试输出整洁
vi.spyOn(console, 'error').mockImplementation(() => undefined);
vi.spyOn(console, 'warn').mockImplementation(() => undefined);
vi.spyOn(console, 'log').mockImplementation(() => undefined);

import { SqliteVecBackend } from '../SqliteVecBackend';
import { openVectorDatabase, ensureVectorSchema } from '../vector/sqliteVecUtils';

// ============ FakeVectorDb - 内存版向量数据库 ============

interface FakeRow {
  id: string;
  embedding: Float32Array;
  metadata: Record<string, any>;
}

interface SqliteStatementLike {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
}

/**
 * 内存版向量数据库，实现 SqliteDatabase 接口的 SQL 子集。
 *
 * 覆盖的 SQL 模式（按 SqliteVecBackend.ts 实际调用）：
 *   vec_items：
 *     - INSERT OR REPLACE INTO vec_items(id, embedding) VALUES (?, ?)
 *     - DELETE FROM vec_items WHERE id = ?
 *     - DELETE FROM vec_items WHERE id IN (?, ?, ...)
 *     - DELETE FROM vec_items
 *     - SELECT COUNT(*) AS c FROM vec_items
 *     - SELECT v.id AS id, v.distance AS distance, m.* FROM vec_items v JOIN item_metadata m ...
 *   item_metadata：
 *     - INSERT OR REPLACE INTO item_metadata(id, ...) VALUES (?, ...)
 *     - SELECT text, source, ... FROM item_metadata WHERE id = ?
 *     - SELECT COUNT(*) AS c FROM item_metadata WHERE id LIKE ? ESCAPE '\'
 *     - SELECT id FROM item_metadata WHERE id LIKE ? ESCAPE '\'
 *     - DELETE FROM item_metadata WHERE id = ?
 *     - DELETE FROM item_metadata WHERE id LIKE ? ESCAPE '\'
 *     - DELETE FROM item_metadata
 */
class FakeVectorDb {
  readonly vecItems = new Map<string, FakeRow>();
  readonly metadata = new Map<string, Record<string, any>>();
  closed = false;

  reset(): void {
    this.vecItems.clear();
    this.metadata.clear();
    this.closed = false;
  }

  pragma(_pragma: string): unknown {
    return undefined;
  }

  exec(sql: string): void {
    const norm = sql.replace(/\s+/g, ' ').trim();
    if (/^DELETE FROM vec_items/i.test(norm)) {
      this.vecItems.clear();
      return;
    }
    if (/^DELETE FROM item_metadata/i.test(norm)) {
      this.metadata.clear();
      return;
    }
    if (/^DELETE FROM id_map/i.test(norm)) {
      return; // rowid 降级方案测试时无 op
    }
    // CREATE TABLE / CREATE INDEX / CREATE VIRTUAL TABLE 等 DDL 忽略
  }

  prepare(sql: string): SqliteStatementLike {
    const norm = sql.replace(/\s+/g, ' ').trim();

    // ==================== vec_items ====================

    if (/^INSERT OR REPLACE INTO vec_items\(id, embedding\) VALUES \(\?, \?\)/i.test(norm)) {
      return {
        run: (...params) => {
          const [id, embedding] = params as [string, Float32Array];
          this.vecItems.set(id, { id, embedding, metadata: {} });
          return { changes: 1, lastInsertRowid: this.vecItems.size };
        },
        get: () => undefined,
        all: () => [],
      };
    }

    if (/^DELETE FROM vec_items WHERE id = \?/i.test(norm)) {
      return {
        run: (...params) => {
          const [id] = params as [string];
          const existed = this.vecItems.delete(id);
          return { changes: existed ? 1 : 0, lastInsertRowid: 0 };
        },
        get: () => undefined,
        all: () => [],
      };
    }

    if (/^DELETE FROM vec_items WHERE id IN \(/i.test(norm)) {
      return {
        run: (...params) => {
          let changes = 0;
          for (const id of params as string[]) {
            if (this.vecItems.delete(id)) changes++;
          }
          return { changes, lastInsertRowid: 0 };
        },
        get: () => undefined,
        all: () => [],
      };
    }

    if (/^SELECT COUNT\(\*\) AS c FROM vec_items/i.test(norm)) {
      return {
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
        get: () => ({ c: this.vecItems.size }),
        all: () => [],
      };
    }

    // KNN 搜索（TEXT PK 方案）：SELECT v.id AS id, v.distance AS distance, m.* FROM vec_items v JOIN item_metadata m ON v.id = m.id WHERE v.embedding MATCH ? AND v.k = ? [AND ...] ORDER BY v.distance
    if (/^SELECT v\.id AS id, v\.distance AS distance/i.test(norm)) {
      return {
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
        get: () => undefined,
        all: (...params) => {
          const [queryVec, topK, ...filterParams] = params as [Float32Array, number, ...unknown[]];
          return this.knnSearch(queryVec, topK, norm, filterParams);
        },
      };
    }

    // ==================== item_metadata ====================

    if (/^INSERT OR REPLACE INTO item_metadata/i.test(norm)) {
      return {
        run: (...params) => {
          const [id, text, source, sourceId, characterId, worldBookPath, tags, createdAt, updatedAt, extra] =
            params as [string, string, string, string, string, string, string, number, number, string];
          this.metadata.set(id, {
            id,
            text: text ?? '',
            source: source ?? '',
            sourceId: sourceId ?? '',
            characterId: characterId ?? undefined,
            worldBookPath: worldBookPath ?? undefined,
            tags: tags ? JSON.parse(tags) : undefined,
            createdAt: createdAt ?? 0,
            updatedAt: updatedAt ?? 0,
            ...(extra ? JSON.parse(extra) : {}),
          });
          // 同步 metadata 到 vec_items 行（供 search JOIN 用）
          const vecRow = this.vecItems.get(id);
          if (vecRow) vecRow.metadata = this.metadata.get(id)!;
          return { changes: 1, lastInsertRowid: this.metadata.size };
        },
        get: () => undefined,
        all: () => [],
      };
    }

    if (/^SELECT text, source, sourceId, characterId, worldBookPath, tags, createdAt, updatedAt, extra FROM item_metadata WHERE id = \?/i.test(norm)) {
      return {
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
        get: (...params) => {
          const [id] = params as [string];
          const row = this.metadata.get(id);
          if (!row) return undefined;
          return {
            text: row.text ?? null,
            source: row.source ?? null,
            sourceId: row.sourceId ?? null,
            characterId: row.characterId ?? null,
            worldBookPath: row.worldBookPath ?? null,
            tags: row.tags ? JSON.stringify(row.tags) : null,
            createdAt: row.createdAt ?? null,
            updatedAt: row.updatedAt ?? null,
            extra: row.extra ? JSON.stringify(row.extra) : null,
          };
        },
        all: () => [],
      };
    }

    if (/^SELECT COUNT\(\*\) AS c FROM item_metadata WHERE id LIKE \?/i.test(norm)) {
      return {
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
        get: (...params) => {
          const [likePattern] = params as [string];
          const regex = this.likeToRegex(likePattern);
          const c = [...this.metadata.keys()].filter((id) => regex.test(id)).length;
          return { c };
        },
        all: () => [],
      };
    }

    if (/^SELECT id FROM item_metadata WHERE id LIKE \?/i.test(norm)) {
      return {
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
        get: () => undefined,
        all: (...params) => {
          const [likePattern] = params as [string];
          const regex = this.likeToRegex(likePattern);
          return [...this.metadata.keys()].filter((id) => regex.test(id)).map((id) => ({ id }));
        },
      };
    }

    if (/^DELETE FROM item_metadata WHERE id = \?/i.test(norm)) {
      return {
        run: (...params) => {
          const [id] = params as [string];
          const existed = this.metadata.delete(id);
          return { changes: existed ? 1 : 0, lastInsertRowid: 0 };
        },
        get: () => undefined,
        all: () => [],
      };
    }

    if (/^DELETE FROM item_metadata WHERE id LIKE \?/i.test(norm)) {
      return {
        run: (...params) => {
          const [likePattern] = params as [string];
          const regex = this.likeToRegex(likePattern);
          let changes = 0;
          for (const id of [...this.metadata.keys()]) {
            if (regex.test(id)) {
              this.metadata.delete(id);
              this.vecItems.delete(id);
              changes++;
            }
          }
          return { changes, lastInsertRowid: 0 };
        },
        get: () => undefined,
        all: () => [],
      };
    }

    // ==================== id_map (rowid 降级方案) ====================
    // rowid 方案测试较少，提供最小实现
    if (/^SELECT rowid AS r FROM id_map WHERE id = \?/i.test(norm)) {
      return {
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
        get: () => undefined, // 简化：rowid 方案测试中不使用
        all: () => [],
      };
    }
    if (/^INSERT INTO id_map/i.test(norm) || /^INSERT INTO vec_items\(rowid, embedding\)/i.test(norm)) {
      return {
        run: () => ({ changes: 1, lastInsertRowid: 0 }),
        get: () => undefined,
        all: () => [],
      };
    }
    if (/^DELETE FROM (vec_items|id_map) WHERE rowid = \?/i.test(norm)) {
      return {
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
        get: () => undefined,
        all: () => [],
      };
    }

    throw new Error(`[FakeVectorDb] unhandled SQL: ${norm}`);
  }

  transaction<T>(fn: () => T): () => T {
    return () => fn();
  }

  close(): void {
    this.closed = true;
  }

  // ============ 内部辅助 ============

  /**
   * KNN 搜索：手动计算 cosine distance，对齐 vec0 行为。
   * score = 1 - distance（distance = 1 - cosine_similarity）。
   */
  private knnSearch(
    queryVec: Float32Array,
    topK: number,
    sql: string,
    filterParams: unknown[]
  ): any[] {
    const results: any[] = [];

    // 解析 filter 条件（从 SQL 中的 AND m.xxx = ? 子句）
    const filterColumns = this.extractFilterColumns(sql);

    for (const [id, row] of this.vecItems) {
      const meta = this.metadata.get(id);
      if (!meta) continue;

      // 应用 metadata 过滤
      let filtered = false;
      for (let i = 0; i < filterColumns.length; i++) {
        const col = filterColumns[i];
        const expected = filterParams[i];
        if (meta[col] !== expected) {
          filtered = true;
          break;
        }
      }
      if (filtered) continue;

      const distance = 1 - this.cosineSimilarity(queryVec, row.embedding);
      results.push({
        id,
        distance,
        text: meta.text ?? null,
        source: meta.source ?? null,
        sourceId: meta.sourceId ?? null,
        characterId: meta.characterId ?? null,
        worldBookPath: meta.worldBookPath ?? null,
        tags: meta.tags ? JSON.stringify(meta.tags) : null,
        createdAt: meta.createdAt ?? null,
        updatedAt: meta.updatedAt ?? null,
        extra: meta.extra ? JSON.stringify(meta.extra) : null,
      });
    }

    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, topK);
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * 从 SQL 中提取 filter 列名（m.xxx = ? 模式）。
   */
  private extractFilterColumns(sql: string): string[] {
    const matches = sql.match(/m\.(\w+) = \?/g) || [];
    return matches.map((m) => m.match(/m\.(\w+)/)![1]);
  }

  /**
   * LIKE 模式转 RegExp（处理 ESCAPE '\' 转义的 _、%、\）。
   */
  private likeToRegex(pattern: string): RegExp {
    let regex = '^';
    let i = 0;
    while (i < pattern.length) {
      const ch = pattern[i];
      if (ch === '\\' && i + 1 < pattern.length) {
        const next = pattern[i + 1];
        if (next === '_' || next === '%' || next === '\\') {
          regex += next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          i += 2;
          continue;
        }
      }
      if (ch === '_') {
        regex += '.';
      } else if (ch === '%') {
        regex += '.*';
      } else {
        regex += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      i++;
    }
    return new RegExp(regex + '$');
  }
}

// ============ 测试辅助 ============

let fakeDb: FakeVectorDb;

async function createBackend(opts?: {
  dimension?: number;
  source?: string;
  sourceId?: string;
}): Promise<SqliteVecBackend> {
  const backend = new SqliteVecBackend();
  // 注入 fakeDb 到 mock
  vi.mocked(openVectorDatabase).mockResolvedValue(fakeDb as any);

  // 覆盖 storageService 返回的 dimension
  const { getStorageService } = await import('../storageService');
  const mockGetSettings = vi.fn(() => ({
    vector: { dimension: opts?.dimension ?? 4, embeddingMode: 'remote' },
  }));
  vi.mocked(getStorageService).mockReturnValue({ getSettings: mockGetSettings } as any);

  await backend.initialize({
    source: opts?.source || 'default',
    sourceId: opts?.sourceId || 'default',
  });
  return backend;
}

function makeVector(values: number[]): number[] {
  return values;
}

// ============ 测试用例 ============

describe('SqliteVecBackend', () => {
  beforeEach(() => {
    fakeDb = new FakeVectorDb();
    vi.clearAllMocks();
    vi.mocked(openVectorDatabase).mockResolvedValue(fakeDb as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============ 纯逻辑测试 ============

  describe('assertDimension', () => {
    it('应接受维度匹配的向量', async () => {
      const backend = await createBackend({ dimension: 4 });
      expect(() => backend.assertDimension([1, 2, 3, 4])).not.toThrow();
    });

    it('应在维度不匹配时抛出 Error', async () => {
      const backend = await createBackend({ dimension: 4 });
      expect(() => backend.assertDimension([1, 2, 3])).toThrow(/dimension mismatch/i);
    });

    it('应在空向量时抛出 Error', async () => {
      const backend = await createBackend({ dimension: 4 });
      expect(() => backend.assertDimension([])).toThrow(/empty vector/i);
    });
  });

  describe('getMode', () => {
    it('应返回 sqlite-vec', async () => {
      const backend = await createBackend();
      expect(backend.getMode()).toBe('sqlite-vec');
    });
  });

  describe('getStoreFilePath', () => {
    it('default source 路径应为 vectors/default/{dim}/vectors.db', async () => {
      const backend = await createBackend({ dimension: 1024 });
      const filePath = backend.getStoreFilePath();
      expect(filePath).toBe(path.join('/tmp/test-userdata', 'vectors', 'default', '1024', 'vectors.db'));
    });

    it('非 default source 路径应含 sourceId', async () => {
      const backend = await createBackend({
        source: 'worldbook',
        sourceId: 'wb_test.json',
        dimension: 4096,
      });
      const filePath = backend.getStoreFilePath();
      expect(filePath).toBe(path.join('/tmp/test-userdata', 'vectors', 'worldbook', 'wb_test.json', '4096', 'vectors.db'));
    });

    it('含冒号的 sourceId 应取 doc_ 部分', async () => {
      const backend = await createBackend({
        source: 'knowledge',
        sourceId: 'kb:doc_abc123:extra',
        dimension: 4,
      });
      const filePath = backend.getStoreFilePath();
      expect(filePath).toContain('doc_abc123');
      expect(filePath).not.toContain(':');
    });
  });

  describe('getDimension', () => {
    it('应返回初始化时的维度', async () => {
      const backend = await createBackend({ dimension: 2560 });
      expect(backend.getDimension()).toBe(2560);
    });
  });

  // ============ CRUD 测试 ============

  describe('add + getById', () => {
    it('应添加向量并通过 getById 获取', async () => {
      const backend = await createBackend({ dimension: 4 });
      const vec = makeVector([0.1, 0.2, 0.3, 0.4]);
      await backend.add('item-1', vec, {
        text: 'hello world',
        source: 'test',
        sourceId: 'test-1',
      });

      const item = await backend.getById('item-1');
      expect(item).not.toBeNull();
      expect(item!.id).toBe('item-1');
      expect(item!.metadata.text).toBe('hello world');
      expect(item!.metadata.source).toBe('test');
      expect(item!.vector).toEqual([]); // getById 返回空 vector（对齐 vecstore 行为）
    });

    it('getById 不存在的 id 应返回 null', async () => {
      const backend = await createBackend({ dimension: 4 });
      const item = await backend.getById('nonexistent');
      expect(item).toBeNull();
    });

    it('add 应在维度不匹配时抛出 Error', async () => {
      const backend = await createBackend({ dimension: 4 });
      await expect(
        backend.add('item-1', [1, 2, 3], { text: 'test' })
      ).rejects.toThrow(/dimension mismatch/i);
    });

    it('add 同一 id 应覆盖（INSERT OR REPLACE 语义）', async () => {
      const backend = await createBackend({ dimension: 4 });
      await backend.add('item-1', [1, 0, 0, 0], { text: 'original', source: 'a' });
      await backend.add('item-1', [0, 1, 0, 0], { text: 'updated', source: 'b' });

      const item = await backend.getById('item-1');
      expect(item!.metadata.text).toBe('updated');
      expect(item!.metadata.source).toBe('b');
    });
  });

  describe('addBatch', () => {
    it('应批量添加多个向量', async () => {
      const backend = await createBackend({ dimension: 4 });
      const items: any[] = [
        { id: 'b1', vector: [1, 0, 0, 0], metadata: { text: 'batch1', source: 'test', sourceId: 'b1', createdAt: Date.now(), updatedAt: Date.now() } },
        { id: 'b2', vector: [0, 1, 0, 0], metadata: { text: 'batch2', source: 'test', sourceId: 'b2', createdAt: Date.now(), updatedAt: Date.now() } },
        { id: 'b3', vector: [0, 0, 1, 0], metadata: { text: 'batch3', source: 'test', sourceId: 'b3', createdAt: Date.now(), updatedAt: Date.now() } },
      ];
      await backend.addBatch(items);

      expect(await backend.count()).toBe(3);
      expect((await backend.getById('b1'))!.metadata.text).toBe('batch1');
      expect((await backend.getById('b3'))!.metadata.text).toBe('batch3');
    });

    it('addBatchNoPersist 应与 addBatch 行为一致', async () => {
      const backend = await createBackend({ dimension: 4 });
      const items: any[] = [
        { id: 'n1', vector: [1, 0, 0, 0], metadata: { text: 'no-persist-1', source: 'test', sourceId: 'n1', createdAt: Date.now(), updatedAt: Date.now() } },
        { id: 'n2', vector: [0, 1, 0, 0], metadata: { text: 'no-persist-2', source: 'test', sourceId: 'n2', createdAt: Date.now(), updatedAt: Date.now() } },
      ];
      await backend.addBatchNoPersist(items);
      expect(await backend.count()).toBe(2);
    });

    it('空数组应安全处理', async () => {
      const backend = await createBackend({ dimension: 4 });
      await backend.addBatch([]);
      expect(await backend.count()).toBe(0);
    });
  });

  describe('search', () => {
    it('应按 cosine 相似度排序返回结果', async () => {
      const backend = await createBackend({ dimension: 4 });
      await backend.add('s1', [1, 0, 0, 0], { text: 'east' });
      await backend.add('s2', [0, 1, 0, 0], { text: 'north' });
      await backend.add('s3', [0.9, 0.1, 0, 0], { text: 'near-east' });

      const results = await backend.search([1, 0, 0, 0], 3);
      expect(results.length).toBe(3);
      // 最相似的是 s1 (cosine=1, distance=0, score=1)
      expect(results[0].id).toBe('s1');
      expect(results[0].score).toBeCloseTo(1, 5);
      // s3 应排在 s2 前面（与 s1 更相似）
      expect(results[1].id).toBe('s3');
      expect(results[2].id).toBe('s2');
    });

    it('score 应等于 1 - distance', async () => {
      const backend = await createBackend({ dimension: 4 });
      await backend.add('a', [1, 0, 0, 0], { text: 'a' });
      await backend.add('b', [0, 1, 0, 0], { text: 'b' });

      const results = await backend.search([1, 0, 0, 0], 2);
      expect(results[0].score).toBeCloseTo(1, 5); // distance=0
      expect(results[1].score).toBeCloseTo(0, 5); // distance=1（正交）
    });

    it('应支持 metadata 过滤（source 字段）', async () => {
      const backend = await createBackend({ dimension: 4 });
      await backend.add('f1', [1, 0, 0, 0], { text: 'wb1', source: 'worldbook' });
      await backend.add('f2', [1, 0, 0, 0], { text: 'kb1', source: 'knowledge' });
      await backend.add('f3', [0.9, 0.1, 0, 0], { text: 'wb2', source: 'worldbook' });

      const results = await backend.search([1, 0, 0, 0], 10, { source: 'worldbook' });
      expect(results.length).toBe(2);
      expect(results.every((r) => r.metadata.source === 'worldbook')).toBe(true);
    });

    it('维度不匹配的查询应返回空数组', async () => {
      const backend = await createBackend({ dimension: 4 });
      await backend.add('d1', [1, 0, 0, 0], { text: 'test' });

      const results = await backend.search([1, 0, 0], 10); // 3 维查询 4 维 store
      expect(results).toEqual([]);
    });

    it('topK 应限制返回数量', async () => {
      const backend = await createBackend({ dimension: 4 });
      for (let i = 0; i < 10; i++) {
        await backend.add(`k${i}`, [Math.random(), Math.random(), 0, 0], { text: `item${i}` });
      }

      const results = await backend.search([1, 0, 0, 0], 3);
      expect(results.length).toBe(3);
    });
  });

  describe('count + countByPrefix', () => {
    it('count 应返回总数', async () => {
      const backend = await createBackend({ dimension: 4 });
      await backend.add('c1', [1, 0, 0, 0], { text: 'a' });
      await backend.add('c2', [0, 1, 0, 0], { text: 'b' });

      expect(await backend.count()).toBe(2);
    });

    it('countByPrefix 应按前缀统计', async () => {
      const backend = await createBackend({ dimension: 4 });
      await backend.add('worldbook:wb1:entry1', [1, 0, 0, 0], { text: 'a' });
      await backend.add('worldbook:wb1:entry2', [0, 1, 0, 0], { text: 'b' });
      await backend.add('worldbook:wb2:entry1', [0, 0, 1, 0], { text: 'c' });
      await backend.add('knowledge:doc1:chunk1', [0, 0, 0, 1], { text: 'd' });

      expect(await backend.countByPrefix('worldbook:wb1')).toBe(2);
      expect(await backend.countByPrefix('worldbook:wb2')).toBe(1);
      expect(await backend.countByPrefix('worldbook')).toBe(3);
      expect(await backend.countByPrefix('knowledge')).toBe(1);
    });

    it('countByPrefix 应转义 LIKE 通配符', async () => {
      const backend = await createBackend({ dimension: 4 });
      await backend.add('doc_100', [1, 0, 0, 0], { text: 'a' });
      await backend.add('doc_200', [0, 1, 0, 0], { text: 'b' });

      // 搜索 'doc_1' 不应匹配 'doc_200'（_ 是 LIKE 单字符通配符，需转义）
      expect(await backend.countByPrefix('doc_1')).toBe(1);
    });
  });

  describe('deleteByPrefix', () => {
    it('应按前缀删除并返回删除数量', async () => {
      const backend = await createBackend({ dimension: 4 });
      await backend.add('wb:a:1', [1, 0, 0, 0], { text: 'a1' });
      await backend.add('wb:a:2', [0, 1, 0, 0], { text: 'a2' });
      await backend.add('wb:b:1', [0, 0, 1, 0], { text: 'b1' });

      const deleted = await backend.deleteByPrefix('wb:a');
      expect(deleted).toBe(2);
      expect(await backend.count()).toBe(1);
      expect(await backend.getById('wb:b:1')).not.toBeNull();
    });

    it('不匹配任何项时应返回 0', async () => {
      const backend = await createBackend({ dimension: 4 });
      await backend.add('x1', [1, 0, 0, 0], { text: 'a' });

      const deleted = await backend.deleteByPrefix('nonexistent');
      expect(deleted).toBe(0);
    });
  });

  describe('remove', () => {
    it('应删除单个向量', async () => {
      const backend = await createBackend({ dimension: 4 });
      await backend.add('r1', [1, 0, 0, 0], { text: 'remove-me' });
      expect(await backend.count()).toBe(1);

      await backend.remove('r1');
      expect(await backend.count()).toBe(0);
      expect(await backend.getById('r1')).toBeNull();
    });

    it('删除不存在的 id 应安全处理', async () => {
      const backend = await createBackend({ dimension: 4 });
      await expect(backend.remove('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('update', () => {
    it('应更新向量并合并 metadata', async () => {
      const backend = await createBackend({ dimension: 4 });
      await backend.add('u1', [1, 0, 0, 0], { text: 'original', source: 'test', tag1: 'v1' });

      await backend.update('u1', [0, 1, 0, 0], { text: 'updated' });

      const item = await backend.getById('u1');
      expect(item!.metadata.text).toBe('updated');
      // 原 metadata 应保留（合并语义）
      expect(item!.metadata.source).toBe('test');
    });
  });

  describe('clear', () => {
    it('应清空所有向量', async () => {
      const backend = await createBackend({ dimension: 4 });
      await backend.add('cl1', [1, 0, 0, 0], { text: 'a' });
      await backend.add('cl2', [0, 1, 0, 0], { text: 'b' });
      await backend.add('cl3', [0, 0, 1, 0], { text: 'c' });
      expect(await backend.count()).toBe(3);

      await backend.clear();
      expect(await backend.count()).toBe(0);
    });
  });

  describe('size', () => {
    it('应返回当前向量数量（同步）', async () => {
      const backend = await createBackend({ dimension: 4 });
      expect(backend.size()).toBe(0);

      await backend.add('sz1', [1, 0, 0, 0], { text: 'a' });
      await backend.add('sz2', [0, 1, 0, 0], { text: 'b' });
      expect(backend.size()).toBe(2);
    });
  });

  // ============ 生命周期测试 ============

  describe('initialize', () => {
    it('应调用 openVectorDatabase 和 ensureVectorSchema', async () => {
      const backend = await createBackend({ dimension: 4 });
      expect(backend.initialized).toBe(true);
      expect(openVectorDatabase).toHaveBeenCalledTimes(1);
      expect(ensureVectorSchema).toHaveBeenCalledTimes(1);
    });

    it('重复调用 initialize 应幂等', async () => {
      const backend = new SqliteVecBackend();
      vi.mocked(openVectorDatabase).mockResolvedValue(fakeDb as any);
      const { getStorageService } = await import('../storageService');
      vi.mocked(getStorageService).mockReturnValue({
        getSettings: vi.fn(() => ({ vector: { dimension: 4 } })),
      } as any);

      await backend.initialize({ source: 'default' });
      await backend.initialize({ source: 'default' });

      expect(openVectorDatabase).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy', () => {
    it('应关闭 db 连接并标记未初始化', async () => {
      const backend = await createBackend({ dimension: 4 });
      expect(backend.initialized).toBe(true);

      await backend.destroy();
      expect(backend.initialized).toBe(false);
      expect(fakeDb.closed).toBe(true);
    });
  });

  describe('handleDimensionChange', () => {
    it('维度变更应重新打开数据库', async () => {
      const backend = await createBackend({ dimension: 4 });
      expect(backend.getDimension()).toBe(4);

      // 切换到 1024 维
      const newFakeDb = new FakeVectorDb();
      vi.mocked(openVectorDatabase).mockResolvedValue(newFakeDb as any);

      await backend.handleDimensionChange(1024);
      expect(backend.getDimension()).toBe(1024);
      expect(openVectorDatabase).toHaveBeenCalledTimes(2); // 初始化 + 维度变更
    });

    it('相同维度应跳过', async () => {
      const backend = await createBackend({ dimension: 4 });
      const callCountBefore = vi.mocked(openVectorDatabase).mock.calls.length;

      await backend.handleDimensionChange(4);

      expect(vi.mocked(openVectorDatabase).mock.calls.length).toBe(callCountBefore);
    });
  });

  describe('persist', () => {
    it('应安全调用不抛出（no-op + WAL checkpoint）', async () => {
      const backend = await createBackend({ dimension: 4 });
      await expect(backend.persist()).resolves.not.toThrow();
    });
  });

  // ============ 初始化守卫测试 ============

  describe('ensureInitialized', () => {
    it('未初始化时调用方法应抛出 Error', () => {
      const backend = new SqliteVecBackend();
      expect(() => backend.getDimension()).toThrow(/尚未初始化/);
    });
  });
});
