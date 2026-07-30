/**
 * SQLite 工具封装 —— WAL 模式 + 事务封装
 *
 * 来源：spec §二 Task 4.3（新增 sqliteUtils.ts）
 * 决策：适配（spec §三）。openclaw 用 Kysely + better-sqlite3，本项目直接用
 *       better-sqlite3 的精简封装，避免引入 Kysely 学习成本。
 *
 * 依赖：需先执行 `pnpm add better-sqlite3` + `electron-rebuild`
 *       （spec §5.4 部署依赖）。本模块采用动态 import，在 better-sqlite3
 *       未安装时提供清晰的错误提示，而非编译期失败。
 *
 * 职责：
 *  1. openAgentDatabase：打开/创建 SQLite 数据库，启用 WAL 模式
 *  2. runTransaction：同步事务封装（openclaw AGENTS.md 规范：事务内不 await）
 *  3. ensureSchema：幂等建表（首次使用时 lazy ensure）
 *  4. prepareStatement：预编译语句缓存
 *
 * 设计约束（遵循 openclaw AGENTS.md SQLite 规范）：
 *  - SQLite 写事务是同步提交段：BEGIN 前完成所有异步规划，事务内不 await
 *  - 纯增量 SQLite 表不 bump schema version（lazy ensure + 下次自然 bump 合入）
 *  - WAL 模式提升并发读性能（spec §4.2 P3 修复配套）
 */

// ==================== 类型定义（better-sqlite3 子集） ====================

/**
 * better-sqlite3 Database 接口子集（仅声明本项目用到的 API）。
 * 避免在 better-sqlite3 未安装时编译失败。
 */
export interface SqliteDatabase {
  pragma(pragma: string): unknown;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

export interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get<T = unknown>(...params: unknown[]): T | undefined;
  all<T = unknown>(...params: unknown[]): T[];
}

// ==================== 动态加载 better-sqlite3 ====================

let betterSqlite3Module: any | null = null;
let loadAttempted = false;

/**
 * 动态加载 better-sqlite3 模块。
 *
 * 采用动态加载而非静态 import，原因：
 *  1. better-sqlite3 是原生模块，需 electron-rebuild，未安装时静态 import 会导致整个
 *     agent 模块加载失败，影响降级路径（底座异常时回退到旧路径）
 *  2. 仅在 MemoryStore 实际初始化时才需要，lazy load 减少启动开销
 *
 * @throws AgentError 如果 better-sqlite3 未安装
 */
async function loadBetterSqlite3(): Promise<any> {
  if (loadAttempted) {
    if (!betterSqlite3Module) {
      throw new AgentError(
        'better-sqlite3 is not installed. Run `pnpm add better-sqlite3` and `electron-rebuild` first.',
        { category: 'agent', retryable: false }
      );
    }
    return betterSqlite3Module;
  }
  loadAttempted = true;
  try {
    // 动态 require better-sqlite3（Electron 主进程环境）
    betterSqlite3Module = eval('require')('better-sqlite3');
  } catch (err) {
    throw new AgentError(
      `Failed to load better-sqlite3: ${err instanceof Error ? err.message : String(err)}. Run \`pnpm add better-sqlite3\` and \`electron-rebuild\` first.`,
      { category: 'agent', retryable: false, cause: err }
    );
  }
  return betterSqlite3Module;
}

// ==================== 数据库打开/初始化 ====================

/**
 * 打开或创建 agent SQLite 数据库。
 *
 * 启用 WAL 模式（Write-Ahead Logging）提升并发读性能：
 *  - 读操作不阻塞写
 *  - 写操作串行但更快
 *
 * @param dbPath 数据库文件路径（如 <userData>/agent/memory.db）
 * @returns SqliteDatabase 实例
 */
export async function openAgentDatabase(dbPath: string): Promise<SqliteDatabase> {
  const Database = await loadBetterSqlite3();
  const db: SqliteDatabase = new Database(dbPath);

  // 启用 WAL 模式（spec §4.2 P3 配套：提升并发读写性能）
  db.pragma('journal_mode = WAL');
  // 启用外键约束（数据完整性）
  db.pragma('foreign_keys = ON');
  // busy_timeout：写冲突时等待 5 秒而非立即报错
  db.pragma('busy_timeout = 5000');
  // synchronous=NORMAL：WAL 模式下足够安全且更快
  db.pragma('synchronous = NORMAL');

  return db;
}

// ==================== 事务封装 ====================

/**
 * 同步事务封装。
 *
 * 遵循 openclaw AGENTS.md 规范：
 *  - SQLite 写事务是同步提交段，事务回调内禁止 await
 *  - BEGIN 前完成所有异步规划（读取、校验、文件 I/O）
 *  - 事务内仅做 reread + validate + write
 *
 * @param db 数据库实例
 * @param fn 事务回调（同步，返回 T）
 * @returns 事务回调的返回值
 *
 * @example
 * const newId = runTransaction(db, () => {
 *   const existing = stmt.get(key);
 *   if (existing) throw new Error('duplicate');
 *   return insertStmt.run({ key, value });
 * });
 */
export function runTransaction<T>(db: SqliteDatabase, fn: () => T): T {
  const tx = db.transaction(fn);
  return tx();
}

// ==================== Schema 幂等建表 ====================

/**
 * 幂等执行建表 SQL（CREATE TABLE IF NOT EXISTS）。
 *
 * 用于首次使用某功能时的 lazy ensure（spec §5.4 首次启动建表）。
 * 纯增量表不 bump schema version（openclaw AGENTS.md 规范）。
 *
 * @param db 数据库实例
 * @param schemaStatements 建表 SQL 语句数组
 */
export function ensureSchema(db: SqliteDatabase, schemaStatements: string[]): void {
  for (const sql of schemaStatements) {
    db.exec(sql);
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
 * @param db 数据库实例
 * @param sql SQL 语句
 * @returns 预编译语句
 */
export function prepareStatement(db: SqliteDatabase, sql: string): SqliteStatement {
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

// ==================== 错误类（前置引用） ====================

// 为避免循环依赖，此处内联 AgentError 的最小子集（仅 sqliteUtils 用到的错误抛出）
class AgentError extends Error {
  readonly category: string;
  readonly retryable: boolean;
  constructor(
    message: string,
    options: { category?: string; retryable?: boolean; cause?: unknown } = {}
  ) {
    super(message);
    // ES2020 Error 不支持 cause 构造参数，手动赋值
    if (options.cause !== undefined) {
      (this as any).cause = options.cause;
    }
    this.name = 'AgentError';
    this.category = options.category ?? 'unknown';
    this.retryable = options.retryable ?? false;
  }
}
