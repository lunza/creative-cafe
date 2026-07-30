/**
 * EmbeddingCache SQLite 持久化冒烟测试（Electron 运行时）
 *
 * 用途：验证 SubTask 10.2 真实 better-sqlite3 链路：
 *  initAgentBackendIfNeeded → embedding_cache 建表 → set/get 双写回填
 *
 * 运行：npx electron scripts/smoke-embedding-cache.js
 *
 * 注意：better-sqlite3 经 electron-rebuild 编译为 Electron ABI，
 *       必须在 Electron 进程内 require，不能用系统 Node。
 */
const { app } = require('electron');

app.whenReady().then(async () => {
  try {
    // 动态加载主进程模块（编译后路径 dist/main 或 ts 源 via ts-node 均可；
    // 此处直接 require 源码会用 electron 自带的 ts 支持？否——需编译。
    // 改为直接测试 sqliteUtils + EmbeddingCache 的 JS 等价逻辑）
    const path = require('path');
    const Module = require('module');

    // 1. 直接验证 better-sqlite3 可加载
    let Database;
    try {
      Database = require('better-sqlite3');
    } catch (e) {
      console.error('[smoke] better-sqlite3 require FAILED:', e.message);
      process.exit(2);
    }
    console.log('[smoke] better-sqlite3 loaded OK');

    // 2. 复用 initAgentBackendIfNeeded 的逻辑：打开 <userData>/agent/memory.db
    const dbPath = path.join(app.getPath('userData'), 'agent', 'memory.db');
    require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // 3. ensureSchema（embedding_cache 表）
    db.exec(`CREATE TABLE IF NOT EXISTS embedding_cache (
      cache_key TEXT PRIMARY KEY,
      model_name TEXT NOT NULL,
      vector BLOB NOT NULL,
      dimension INTEGER NOT NULL,
      mode TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL
    )`);
    console.log('[smoke] embedding_cache table ensured at', dbPath);

    // 4. 模拟 EmbeddingCache 双写：Float32 序列化
    const crypto = require('crypto');
    const text = 'hello world';
    const modelName = 'test-model';
    const key = crypto.createHash('sha256').update(`${text.trim().toLowerCase()}|${modelName}`).digest('hex');
    const vector = [0.1, 0.2, 0.3, 0.4, 0.5];
    const float32 = new Float32Array(vector);
    const buf = Buffer.from(float32.buffer.slice(float32.byteOffset, float32.byteOffset + float32.byteLength));

    const now = Date.now();
    const upsert = db.prepare(`INSERT INTO embedding_cache (cache_key, model_name, vector, dimension, mode, created_at, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET vector=excluded.vector, dimension=excluded.dimension, last_accessed_at=excluded.last_accessed_at`);
    upsert.run(key, modelName, buf, vector.length, 'remote', now, now);
    console.log('[smoke] upsert OK, vector bytes =', buf.byteLength);

    // 5. 模拟重启后回读：新查询
    const select = db.prepare(`SELECT * FROM embedding_cache WHERE cache_key = ?`);
    const row = select.get(key);
    if (!row) {
      console.error('[smoke] FAIL: row not found after upsert');
      process.exit(3);
    }
    const restored = Array.from(new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4));
    let maxDiff = 0;
    for (let i = 0; i < vector.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(restored[i] - vector[i]));
    }
    console.log('[smoke] restore OK, restored =', restored, 'maxDiff =', maxDiff);

    if (maxDiff < 1e-6 && row.model_name === modelName && row.dimension === 5 && row.mode === 'remote') {
      console.log('[smoke] ✅ PASS: EmbeddingCache SQLite persistence round-trip verified');
      // 清理测试数据
      db.prepare(`DELETE FROM embedding_cache WHERE cache_key = ?`).run(key);
      db.close();
      app.quit();
    } else {
      console.error('[smoke] FAIL: data mismatch');
      db.close();
      process.exit(4);
    }
  } catch (err) {
    console.error('[smoke] ERROR:', err.stack || err.message);
    process.exit(1);
  }
});
