/**
 * SQLite 后端 —— agent 记忆存储 schema 与初始化
 *
 * 来源：spec §二 Task 8.1（sqliteBackend.ts，schema: agent_memory/agent_usage/cron_jobs/skills/audit）
 * 决策：适配（spec §三）。openclaw 用 Kysely + better-sqlite3，本项目直接用
 *       sqliteUtils 封装 + 原生 SQL schema。
 *
 * 职责：
 *  1. 定义 5 张核心表的 schema（agent_memory / agent_usage / cron_jobs / skills / audit）
 *  2. AgentSqliteBackend：封装数据库初始化、lazy ensure、CRUD 预编译语句
 *  3. 提供 query / write / transaction 接口供 memoryStore 调用
 *
 * 表设计（参考 openclaw AGENTS.md SQLite 规范）：
 *  - agent_memory: agent 自主记忆（dreaming 摘要、工具执行记录、经验沉淀）
 *  - agent_usage: token 用量统计（按会话/模型/日期聚合）
 *  - cron_jobs: 定时任务（dreaming / goalTracker / feedbackLoop）
 *  - skills: 技能元数据（SKILL.md 解析后的 frontmatter + 状态）
 *  - audit: 写溯源（writeProvenance，记录每次写操作的 who/what/when/why）
 *
 * 设计约束：
 *  - 纯增量表不 bump schema version（lazy ensure + 下次自然 bump 合入）
 *  - WAL 模式（sqliteUtils.openAgentDatabase 已启用）
 *  - 外键约束开启（sqliteUtils 已启用）
 *  - 事务内禁止 await（openclaw AGENTS.md 规范）
 */

import {
  openAgentDatabase,
  runTransaction,
  ensureSchema,
  prepareStatement,
  type SqliteDatabase,
  type SqliteStatement,
} from '../infra/sqliteUtils';
import { toAgentError } from '../infra/errors';
import * as path from 'path';

// ==================== Schema 定义 ====================

/**
 * Agent 记忆库 schema（5 张核心表）。
 *
 * 幂等建表（CREATE TABLE IF NOT EXISTS），首次初始化时执行。
 */
export const AGENT_SCHEMA_STATEMENTS: readonly string[] = [
  // 1. agent_memory：agent 自主记忆
  //    存储 dreaming 摘要、工具执行经验、长期上下文等
  `CREATE TABLE IF NOT EXISTS agent_memory (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    metadata TEXT,
    embedding BLOB,
    score REAL,
    character_id TEXT,
    session_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ttl INTEGER
  )`,

  // 索引：按类型/角色/会话查询
  `CREATE INDEX IF NOT EXISTS idx_agent_memory_type ON agent_memory(type)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_memory_character ON agent_memory(character_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_memory_session ON agent_memory(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_memory_created ON agent_memory(created_at DESC)`,

  // 2. agent_usage：token 用量统计
  //    按会话/模型/日期聚合，用于成本分析与上限保护
  `CREATE TABLE IF NOT EXISTS agent_usage (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    model_name TEXT,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    llm_calls INTEGER DEFAULT 0,
    tool_calls INTEGER DEFAULT 0,
    tool_duration_ms INTEGER DEFAULT 0,
    run_id TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_usage_session ON agent_usage(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_usage_model ON agent_usage(model_name)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_usage_created ON agent_usage(created_at DESC)`,

  // 3. cron_jobs：定时任务（dreaming / goalTracker / feedbackLoop）
  //    照抄 openclaw pacing/stagger 理念
  `CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY,
    label TEXT,
    cron_expr TEXT NOT NULL,
    next_run INTEGER NOT NULL,
    last_run INTEGER,
    last_status TEXT,
    last_error TEXT,
    min_interval_ms INTEGER,
    stagger_ms INTEGER,
    allow_concurrent INTEGER DEFAULT 0,
    payload TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run)`,

  // 4. skills：技能元数据
  //    SKILL.md 解析后的 frontmatter + 运行时状态
  `CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    frontmatter TEXT NOT NULL,
    body TEXT,
    source_path TEXT,
    exposure_runtime INTEGER DEFAULT 0,
    exposure_prompt INTEGER DEFAULT 0,
    user_invocable INTEGER DEFAULT 0,
    disable_model_invocation INTEGER DEFAULT 0,
    installed_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_invoked_at INTEGER,
    invoke_count INTEGER DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_skills_exposure ON skills(exposure_runtime, exposure_prompt)`,

  // 5. audit：写溯源（writeProvenance）
  //    记录每次写操作的 who / what / when / why（openclaw writeProvenance 理念）
  `CREATE TABLE IF NOT EXISTS audit (
    id TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    before_state TEXT,
    after_state TEXT,
    reason TEXT,
    run_id TEXT,
    session_id TEXT,
    timestamp INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_target ON audit(target_type, target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit(actor)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit(timestamp DESC)`,

  // 6. embedding_cache：Embedding content-hash → vector 持久化缓存（spec §二 Task 10.2）
  //    跨进程重启复用 embedding 结果，避免重复调用远程 API / 本地 ONNX 推理
  `CREATE TABLE IF NOT EXISTS embedding_cache (
    cache_key TEXT PRIMARY KEY,
    model_name TEXT NOT NULL,
    vector BLOB NOT NULL,
    dimension INTEGER NOT NULL,
    mode TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_accessed_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_embedding_cache_model ON embedding_cache(model_name)`,
  `CREATE INDEX IF NOT EXISTS idx_embedding_cache_last_accessed ON embedding_cache(last_accessed_at DESC)`,
];

// ==================== AgentSqliteBackend ====================

/**
 * Agent SQLite 后端。
 *
 * 封装数据库连接 + schema 初始化 + 预编译语句缓存。
 * memoryStore / writeProvenance / cronScheduler 通过此 backend 访问 SQLite。
 *
 * 生命周期：
 *  - init()：首次调用时打开数据库 + ensureSchema（lazy）
 *  - close()：应用退出或 agent 模块卸载时调用
 */
export class AgentSqliteBackend {
  private db: SqliteDatabase | null = null;
  private initialized = false;

  /** 数据库是否已初始化 */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /** 底层数据库实例（init 后可用） */
  get database(): SqliteDatabase {
    if (!this.db) {
      throw new Error('AgentSqliteBackend not initialized. Call init() first.');
    }
    return this.db;
  }

  /**
   * 初始化数据库（lazy ensure）。
   *
   * @param dbPath 数据库文件路径（如 <userData>/agent/memory.db）
   */
  async init(dbPath: string): Promise<void> {
    if (this.initialized) return;
    try {
      this.db = await openAgentDatabase(dbPath);
      ensureSchema(this.db, [...AGENT_SCHEMA_STATEMENTS]);
      this.initialized = true;
    } catch (err) {
      throw toAgentError(err, `AgentSqliteBackend.init failed for path: ${dbPath}`);
    }
  }

  /**
   * 获取预编译语句（带缓存）。
   */
  prepare(sql: string): SqliteStatement {
    return prepareStatement(this.database, sql);
  }

  /**
   * 执行同步事务（事务内禁止 await）。
   */
  transaction<T>(fn: () => T): T {
    return runTransaction(this.database, fn);
  }

  /**
   * 关闭数据库连接。
   *
   * 应用退出时调用，释放文件句柄。
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }
}

// ==================== 内存条目行类型 ====================

/**
 * agent_memory 表的行类型（SQLite 查询结果）。
 */
export interface AgentMemoryRow {
  id: string;
  type: string;
  content: string;
  source: string;
  metadata: string | null;
  embedding: Buffer | null;
  score: number | null;
  character_id: string | null;
  session_id: string | null;
  created_at: number;
  updated_at: number;
  ttl: number | null;
}

/**
 * audit 表的行类型。
 */
export interface AuditRow {
  id: string;
  actor: string;
  action: string;
  target_type: string;
  target_id: string | null;
  before_state: string | null;
  after_state: string | null;
  reason: string | null;
  run_id: string | null;
  session_id: string | null;
  timestamp: number;
}

/**
 * embedding_cache 表的行类型。
 */
export interface EmbeddingCacheRow {
  cache_key: string;
  model_name: string;
  vector: Buffer;
  dimension: number;
  mode: string;
  created_at: number;
  last_accessed_at: number;
}

// ==================== 单例 ====================

let backendInstance: AgentSqliteBackend | null = null;

/**
 * 获取 AgentSqliteBackend 单例。
 *
 * 全局共享一个数据库连接（WAL 模式支持并发读）。
 * 首次调用返回未初始化实例，需调用 init(dbPath) 后才能使用。
 */
export function getAgentBackend(): AgentSqliteBackend {
  if (!backendInstance) {
    backendInstance = new AgentSqliteBackend();
  }
  return backendInstance;
}

// ==================== 启动期懒初始化 ====================

/**
 * Agent 数据库文件路径（相对 userData）。
 *
 * `<userData>/agent/memory.db` —— 集中存放 agent 记忆 / 用量 / cron / 技能 / 溯源 / embedding 缓存。
 */
export function getAgentDbPath(): string {
  // 动态引入避免在 better-sqlite3 未安装时影响 appPath 模块加载
  const { getUserDataPath } = require('../../../utils/appPath');
  // 使用 path.join 保证跨平台分隔符正确（Windows 反斜杠 / POSIX 正斜杠）
  return path.join(getUserDataPath(), 'agent', 'memory.db');
}

/** 初始化尝试结果（避免重复抛错） */
let initAttempted = false;
let initSucceeded = false;
let initError: string | null = null;

/**
 * 幂等初始化 Agent SQLite 后端。
 *
 * 在 `setupIpcHandlers` / `embeddingService.initialize` 中调用：
 *  - 首次调用：创建 `<userData>/agent/` 目录，打开 WAL 数据库，ensureSchema
 *  - 后续调用：直接返回（幂等）
 *  - 失败（如 better-sqlite3 未安装）：记录错误，返回 null，调用方降级
 *
 * @returns 已初始化的 backend；不可用时返回 null（调用方必须降级，不得抛错）
 */
export async function initAgentBackendIfNeeded(): Promise<AgentSqliteBackend | null> {
  if (initSucceeded) {
    return getAgentBackend();
  }
  if (initAttempted) {
    // 之前已尝试并失败，直接返回 null（避免重复打日志）
    return null;
  }
  initAttempted = true;
  try {
    const dbPath = getAgentDbPath();
    // 确保目录存在（path.dirname 跨平台取目录）
    const fs = require('fs');
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const backend = getAgentBackend();
    await backend.init(dbPath);
    initSucceeded = true;
    initError = null;
    return backend;
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    // 不抛出：底座异常时降级到旧路径（spec §无缝集成与降级）
    console.warn(`[AgentSqliteBackend] init failed (degrading to in-memory): ${initError}`);
    return null;
  }
}

/**
 * 查询 agent 后端初始化状态（用于诊断 / IPC）。
 */
export function getAgentBackendStatus(): { initialized: boolean; error: string | null } {
  return { initialized: initSucceeded, error: initError };
}
