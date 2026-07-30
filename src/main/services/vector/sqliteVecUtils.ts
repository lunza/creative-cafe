/**
 * sqlite-vec 向量数据库工具封装
 *
 * 职责：
 *  1. openVectorDatabase：打开/创建向量 SQLite 数据库，启用 WAL + 加载 sqlite-vec 扩展
 *  2. ensureVectorSchema：幂等建表（vec0 虚拟表 + item_metadata 元数据表）
 *
 * 设计约束：
 *  - 复用 better-sqlite3（项目已有依赖，agent 记忆库在用）
 *  - 动态 require better-sqlite3 / sqlite-vec，避免编译期硬依赖（参照 sqliteUtils.ts 模式）
 *  - agent 记忆库（openAgentDatabase）不加载 sqlite-vec，保持职责分离
 *  - WAL 模式 + synchronous=NORMAL + busy_timeout=5000（对齐 openAgentDatabase 配置）
 *
 * sqlite-vec API（官方文档确认）：
 *  - sqliteVec.load(db)：自动定位预构建 .dll/.so/.dylib 并调用 db.loadExtension()
 *  - 验证：SELECT vec_version()
 *  - 向量绑定：better-sqlite3 原生支持 Float32Array，直接传入即可
 *
 * vec0 虚拟表主键策略（决策 2.1）：
 *  - 首选 id TEXT PRIMARY KEY（与 VectorItem.id 字符串语义一致）
 *  - 若建表失败（旧版 sqlite-vec 不支持 TEXT 主键），降级为 rowid 方案：
 *    vec0 用默认 rowid，额外建 id_map(rowid, id) 映射表
 *  - VEC0_TEXT_PK_SUPPORTED 标记当前环境是否支持 TEXT 主键
 */

import type { SqliteDatabase, SqliteStatement } from '../agent/infra/sqliteUtils';

// ==================== 动态加载 ====================

let betterSqlite3Module: any | null = null;
let sqliteVecModule: any | null = null;
let loadAttempted = false;

/**
 * 动态加载 better-sqlite3 + sqlite-vec 模块。
 *
 * 采用动态加载原因：
 *  1. better-sqlite3 是原生模块，需 electron-rebuild，未安装/未编译时静态 import
 *     会导致整个向量服务模块加载失败
 *  2. sqlite-vec 依赖平台二进制（.dll/.so/.dylib），通过 optionalDependencies 分发
 *  3. lazy load 减少启动开销
 *
 * @throws Error 如果任一模块未安装或加载失败
 */
async function loadModules(): Promise<{ Database: any; sqliteVec: any }> {
  if (loadAttempted) {
    if (!betterSqlite3Module || !sqliteVecModule) {
      throw new Error(
        '[sqliteVecUtils] better-sqlite3 or sqlite-vec not available. ' +
        'Run `npm install better-sqlite3 sqlite-vec` and `npm run rebuild:native` first.'
      );
    }
    return { Database: betterSqlite3Module, sqliteVec: sqliteVecModule };
  }
  loadAttempted = true;

  try {
    betterSqlite3Module = eval('require')('better-sqlite3');
  } catch (err) {
    throw new Error(
      `[sqliteVecUtils] Failed to load better-sqlite3: ${err instanceof Error ? err.message : String(err)}. ` +
      'Run `npm install better-sqlite3` and `npm run rebuild:native` first.'
    );
  }

  try {
    sqliteVecModule = eval('require')('sqlite-vec');
  } catch (err) {
    throw new Error(
      `[sqliteVecUtils] Failed to load sqlite-vec: ${err instanceof Error ? err.message : String(err)}. ` +
      'Run `npm install sqlite-vec` first.'
    );
  }

  return { Database: betterSqlite3Module, sqliteVec: sqliteVecModule };
}

// ==================== 数据库打开 ====================

/**
 * 打开或创建向量 SQLite 数据库，并加载 sqlite-vec 扩展。
 *
 * 配置（对齐 openAgentDatabase）：
 *  - WAL 模式：读不阻塞写，写串行但更快
 *  - synchronous=NORMAL：WAL 下足够安全且更快
 *  - busy_timeout=5000：写冲突等待 5 秒
 *  - foreign_keys=ON：数据完整性
 *
 * @param dbPath 数据库文件路径（如 <userData>/vectors/worldbook/wb_xxx/1024/vectors.db）
 * @returns SqliteDatabase 实例（已加载 sqlite-vec 扩展）
 *
 * @throws Error 如果 better-sqlite3 / sqlite-vec 加载失败，或 vec_version() 验证失败
 */
export async function openVectorDatabase(dbPath: string): Promise<SqliteDatabase> {
  const { Database, sqliteVec } = await loadModules();

  const db: SqliteDatabase = new Database(dbPath);

  // 启用 WAL 模式（提升并发读写性能）
  db.pragma('journal_mode = WAL');
  // 启用外键约束
  db.pragma('foreign_keys = ON');
  // busy_timeout：写冲突时等待 5 秒
  db.pragma('busy_timeout = 5000');
  // synchronous=NORMAL：WAL 模式下足够安全且更快
  db.pragma('synchronous = NORMAL');

  // 加载 sqlite-vec 扩展（自动定位平台预构建二进制）
  try {
    sqliteVec.load(db);
  } catch (err) {
    try {
      db.close();
    } catch {
      // 忽略关闭错误
    }
    throw new Error(
      `[sqliteVecUtils] Failed to load sqlite-vec extension for ${dbPath}: ` +
      `${err instanceof Error ? err.message : String(err)}. ` +
      'Ensure sqlite-vec platform package (e.g. sqlite-vec-windows-x64) is installed.'
    );
  }

  // 验证扩展可用：SELECT vec_version()
  try {
    const row = db.prepare('SELECT vec_version() AS v').get() as { v: string } | undefined;
    console.log(`[sqliteVecUtils] sqlite-vec loaded, version = ${row?.v || 'unknown'}, db = ${dbPath}`);
  } catch (err) {
    try {
      db.close();
    } catch {
      // 忽略关闭错误
    }
    throw new Error(
      `[sqliteVecUtils] sqlite-vec extension loaded but vec_version() failed: ` +
      `${err instanceof Error ? err.message : String(err)}. Extension may be incompatible.`
    );
  }

  return db;
}

// ==================== Schema 幂等建表 ====================

/**
 * vec0 是否支持 TEXT PRIMARY KEY。
 * 首次 ensureVectorSchema 时检测，失败则降级为 rowid 方案。
 */
export let VEC0_TEXT_PK_SUPPORTED = true;

/**
 * 幂等建表：vec0 虚拟表 + item_metadata 元数据表。
 *
 * Schema 设计（cosine 距离，对齐原 vecstore 行为）：
 *  - vec_items：vec0 虚拟表，存 id + embedding，cosine 距离
 *  - item_metadata：普通表，存完整 metadata（vec0 不存 metadata，JOIN 取回）
 *  - idx_meta_source：按 source/sourceId 查询的索引
 *
 * score = 1 - distance（cosine distance → similarity），与原 vecstore 一致
 *
 * 降级方案：若 id TEXT PRIMARY KEY 建表失败，改用 rowid：
 *  - vec_items 用默认 rowid（INTEGER PRIMARY KEY）
 *  - 额外建 id_map(rowid INTEGER PK, id TEXT UNIQUE) 映射表
 *  - search 后通过 rowid JOIN id_map 取回字符串 id
 *
 * @param db 已加载 sqlite-vec 的数据库实例
 * @param dimension 向量维度（如 1024 / 2560 / 4096）
 */
export function ensureVectorSchema(db: SqliteDatabase, dimension: number): void {
  // 元数据表（无论 TEXT 主键是否支持，都需要）
  db.exec(`CREATE TABLE IF NOT EXISTS item_metadata (
    id TEXT PRIMARY KEY,
    text TEXT,
    source TEXT,
    sourceId TEXT,
    characterId TEXT,
    worldBookPath TEXT,
    tags TEXT,
    createdAt INTEGER,
    updatedAt INTEGER,
    extra TEXT
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_source ON item_metadata(source, sourceId)`);

  // vec0 虚拟表：首选 TEXT 主键
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
      id TEXT PRIMARY KEY,
      embedding float[${dimension}] distance_metric=cosine
    )`);
    VEC0_TEXT_PK_SUPPORTED = true;
  } catch (err) {
    // 降级：rowid 方案
    console.warn(
      `[sqliteVecUtils] vec0 TEXT PRIMARY KEY not supported, falling back to rowid mapping:`,
      err instanceof Error ? err.message : err
    );
    VEC0_TEXT_PK_SUPPORTED = false;

    // 删除可能半创建的表
    try {
      db.exec('DROP TABLE IF EXISTS vec_items');
    } catch {
      // 忽略
    }

    // rowid 方案：vec0 用默认 rowid，id_map 做映射
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
      embedding float[${dimension}] distance_metric=cosine
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS id_map (
      rowid INTEGER PRIMARY KEY,
      id TEXT UNIQUE NOT NULL
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_id_map_id ON id_map(id)`);
  }
}

// ==================== 预编译语句缓存 ====================

const statementCache = new WeakMap<SqliteDatabase, Map<string, SqliteStatement>>();

/**
 * 获取预编译语句（带缓存）。
 *
 * 同一数据库实例 + 同一 SQL 仅编译一次，后续直接返回缓存。
 * WeakMap 确保数据库关闭后缓存自动释放。
 *
 * 与 sqliteUtils.prepareStatement 行为一致，但此处独立维护缓存
 * 以避免与 agent 记忆库的缓存冲突。
 */
export function prepareVecStatement(db: SqliteDatabase, sql: string): SqliteStatement {
  let cache = statementCache.get(db);
  if (!cache) {
    cache = new Map();
    statementCache.set(db, cache);
  }
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}
