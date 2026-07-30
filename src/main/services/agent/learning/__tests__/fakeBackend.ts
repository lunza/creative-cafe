/**
 * Learning 模块测试共享辅助 —— 内存版 AgentSqliteBackend
 *
 * 背景：better-sqlite3 是原生模块，postinstall 阶段为 Electron 重编译
 * （NODE_MODULE_VERSION 130），在纯 node vitest 环境（ABI 137）无法加载。
 * 现有测试（EmbeddingCache.test.ts 等）均采用 mock 持久化模式。
 *
 * 本 fake 仅实现 cronScheduler / steerEngine 测试用到的 SQL 子集，
 * 用 Map 存储两张表（cron_jobs / agent_memory）的行数据。
 *
 * 覆盖的 SQL（按列顺序硬编码，保证参数映射准确）：
 *  cron_jobs：
 *    - INSERT INTO cron_jobs (id, label, cron_expr, next_run, last_run, last_status,
 *        last_error, min_interval_ms, stagger_ms, allow_concurrent, payload,
 *        created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 *    - DELETE FROM cron_jobs WHERE id = ?
 *    - SELECT id, label, next_run FROM cron_jobs ORDER BY next_run ASC
 *    - SELECT * FROM cron_jobs WHERE next_run <= ? ORDER BY next_run ASC
 *    - UPDATE cron_jobs SET last_run = ?, last_status = ?, last_error = ?,
 *        next_run = ?, updated_at = ? WHERE id = ?
 *  agent_memory：
 *    - INSERT INTO agent_memory (id, type, content, source, metadata, character_id,
 *        session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
 *    - SELECT id, metadata, created_at FROM agent_memory WHERE type = 'agent'
 *        AND source LIKE 'steer:%' AND created_at < ?
 *    - SELECT * FROM agent_memory WHERE type = 'agent' AND source LIKE 'steer:%'
 *        AND session_id = ? ORDER BY created_at ASC
 *    - SELECT metadata FROM agent_memory WHERE id = ?
 *    - UPDATE agent_memory SET metadata = ?, updated_at = ? WHERE id = ?
 */

type Row = Record<string, unknown>;

interface SqliteStatementLike {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get<T = Row>(...params: unknown[]): T | undefined;
  all<T = Row>(...params: unknown[]): T[];
}

/**
 * impl 方法签名统一为 (params: unknown[]) => T，即接受「参数数组」。
 * makeStmt 用 rest 参数收集调用参数后包装为数组传入 impl，
 * 以对齐 better-sqlite3 的 Statement.run(...params) / get(...params) / all(...params) 调用约定。
 */
interface StmtImpl {
  run?(params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get?(params: unknown[]): unknown;
  all?(params: unknown[]): unknown[];
}

function makeStmt(impl: StmtImpl): SqliteStatementLike {
  return {
    run: (...params) => impl.run ? impl.run(params) : { changes: 0, lastInsertRowid: 0 },
    get: (...params) => (impl.get ? impl.get(params) : undefined) as any,
    all: (...params) => (impl.all ? impl.all(params) : []) as any,
  };
}

/**
 * 内存版 AgentSqliteBackend。
 *
 * 仅实现 prepare(sql) 接口，返回 fake statement。
 * 行数据用 Map 存储，键为 id。
 */
export class InMemoryAgentBackend {
  readonly cronJobs = new Map<string, Row>();
  readonly agentMemory = new Map<string, Row>();

  /** 清空所有表数据（每个测试 beforeEach 调用）。 */
  reset(): void {
    this.cronJobs.clear();
    this.agentMemory.clear();
  }

  prepare(sql: string): SqliteStatementLike {
    const norm = sql.replace(/\s+/g, ' ').trim();

    // ==================== cron_jobs ====================

    if (/^INSERT INTO cron_jobs/i.test(norm)) {
      // 列顺序：id, label, cron_expr, next_run, last_run, last_status, last_error,
      //         min_interval_ms, stagger_ms, allow_concurrent, payload, created_at, updated_at
      return makeStmt({
        run: (params) => {
          const [
            id, label, cronExpr, nextRun, lastRun, lastStatus, lastError,
            minInterval, stagger, allowConcurrent, payload, createdAt, updatedAt,
          ] = params;
          this.cronJobs.set(id as string, {
            id,
            label: label ?? null,
            cron_expr: cronExpr,
            next_run: nextRun,
            last_run: lastRun ?? null,
            last_status: lastStatus ?? null,
            last_error: lastError ?? null,
            min_interval_ms: minInterval ?? null,
            stagger_ms: stagger ?? null,
            allow_concurrent: allowConcurrent,
            payload: payload ?? null,
            created_at: createdAt,
            updated_at: updatedAt,
          });
          return { changes: 1, lastInsertRowid: this.cronJobs.size };
        },
      });
    }

    if (/^DELETE FROM cron_jobs WHERE id = \?/i.test(norm)) {
      return makeStmt({
        run: (params) => {
          const [id] = params;
          const existed = this.cronJobs.delete(id as string);
          return { changes: existed ? 1 : 0, lastInsertRowid: 0 };
        },
      });
    }

    if (/^SELECT id, label, next_run FROM cron_jobs ORDER BY next_run ASC/i.test(norm)) {
      return makeStmt({
        all: () =>
          [...this.cronJobs.values()]
            .sort((a, b) => (a.next_run as number) - (b.next_run as number))
            .map((r) => ({ id: r.id, label: r.label ?? null, next_run: r.next_run })),
      });
    }

    if (/^SELECT \* FROM cron_jobs WHERE next_run <= \? ORDER BY next_run ASC/i.test(norm)) {
      return makeStmt({
        all: (params) => {
          const [now] = params;
          return [...this.cronJobs.values()]
            .filter((r) => (r.next_run as number) <= (now as number))
            .sort((a, b) => (a.next_run as number) - (b.next_run as number));
        },
      });
    }

    if (/^UPDATE cron_jobs SET last_run = \?/i.test(norm)) {
      // params: [last_run, last_status, last_error, next_run, updated_at, id]
      return makeStmt({
        run: (params) => {
          const [lastRun, lastStatus, lastError, nextRun, updatedAt, id] = params;
          const row = this.cronJobs.get(id as string);
          if (!row) return { changes: 0, lastInsertRowid: 0 };
          row.last_run = lastRun;
          row.last_status = lastStatus;
          row.last_error = lastError;
          row.next_run = nextRun;
          row.updated_at = updatedAt;
          return { changes: 1, lastInsertRowid: 0 };
        },
      });
    }

    // ==================== agent_memory ====================

    if (/^INSERT INTO agent_memory/i.test(norm)) {
      // 列：id, type, content, source, metadata, character_id(NULL字面量), session_id, created_at, updated_at
      // params（跳过 NULL 字面量）：[id, type, content, source, metadata, session_id, created_at, updated_at]
      return makeStmt({
        run: (params) => {
          const [id, type, content, source, metadata, sessionId, createdAt, updatedAt] = params;
          this.agentMemory.set(id as string, {
            id,
            type,
            content,
            source,
            metadata: metadata ?? null,
            character_id: null,
            session_id: sessionId,
            created_at: createdAt,
            updated_at: updatedAt,
          });
          return { changes: 1, lastInsertRowid: this.agentMemory.size };
        },
      });
    }

    if (
      /^SELECT id, metadata, created_at FROM agent_memory WHERE type = 'agent' AND source LIKE 'steer:%' AND created_at < \?/i.test(
        norm
      )
    ) {
      return makeStmt({
        all: (params) => {
          const [cutoff] = params;
          return [...this.agentMemory.values()]
            .filter(
              (r) =>
                r.type === 'agent' &&
                typeof r.source === 'string' &&
                r.source.startsWith('steer:') &&
                (r.created_at as number) < (cutoff as number)
            )
            .map((r) => ({ id: r.id, metadata: r.metadata ?? null, created_at: r.created_at }));
        },
      });
    }

    if (
      /^SELECT \* FROM agent_memory WHERE type = 'agent' AND source LIKE 'steer:%' AND session_id = \? ORDER BY created_at ASC/i.test(
        norm
      )
    ) {
      return makeStmt({
        all: (params) => {
          const [sessionId] = params;
          return [...this.agentMemory.values()]
            .filter(
              (r) =>
                r.type === 'agent' &&
                typeof r.source === 'string' &&
                r.source.startsWith('steer:') &&
                r.session_id === sessionId
            )
            .sort((a, b) => (a.created_at as number) - (b.created_at as number));
        },
      });
    }

    if (/^SELECT metadata FROM agent_memory WHERE id = \?/i.test(norm)) {
      return makeStmt({
        get: (params) => {
          const [id] = params;
          const row = this.agentMemory.get(id as string);
          return row ? { metadata: row.metadata ?? null } : undefined;
        },
      });
    }

    if (/^UPDATE agent_memory SET metadata = \?, updated_at = \? WHERE id = \?/i.test(norm)) {
      // params: [metadata, updated_at, id]
      return makeStmt({
        run: (params) => {
          const [metadata, updatedAt, id] = params;
          const row = this.agentMemory.get(id as string);
          if (!row) return { changes: 0, lastInsertRowid: 0 };
          row.metadata = metadata;
          row.updated_at = updatedAt;
          return { changes: 1, lastInsertRowid: 0 };
        },
      });
    }

    throw new Error(`[InMemoryAgentBackend] unhandled SQL: ${norm}`);
  }
}
