/**
 * 写溯源（Write Provenance）—— 适配 openclaw 写溯源理念
 *
 * 来源：spec §二 Task 8.2（writeProvenance.ts）
 *       参考 openclaw AGENTS.md "写溯源" 章节
 * 决策：适配（spec §三）。openclaw 通过 audit 表记录每次写操作的 who/what/when/why，
 *       本项目照搬其理念，简化为 audit 表的 CRUD 封装。
 *
 * 职责：
 *  1. recordWrite：记录写操作到 audit 表（含 before/after 状态快照）
 *  2. queryAudit：按目标/操作者/时间范围查询审计日志
 *  3. buildProvenance：构建写溯源链（追溯某条记忆的完整修改历史）
 *
 * 设计约束（openclaw AGENTS.md）：
 *  - 写溯源是 prompt：每次写操作必须记录原因（reason），便于后续追溯
 *  - before/after 状态快照支持回滚（未来扩展）
 *  - 审计日志不可变（仅追加，不修改/删除）
 *  - 事务内写入（与业务写入同一事务，保证原子性）
 */

import type { AgentSqliteBackend, AuditRow } from './sqliteBackend';
import { toAgentError } from '../infra/errors';

// ==================== 类型定义 ====================

/**
 * 写操作类型。
 */
export type WriteAction =
  | 'create' // 创建
  | 'update' // 更新
  | 'delete' // 删除
  | 'archive' // 归档
  | 'restore'; // 恢复

/**
 * 写溯源记录（创建时传入）。
 */
export interface WriteProvenanceRecord {
  /** 操作者（'agent' / 'user' / 'system' / 工具名） */
  actor: string;
  /** 操作类型 */
  action: WriteAction;
  /** 目标类型（'memory' / 'worldbook' / 'character' / 'chapter' / 'skill'） */
  targetType: string;
  /** 目标 ID */
  targetId?: string;
  /** 操作前状态（JSON 字符串，用于回滚） */
  beforeState?: string;
  /** 操作后状态（JSON 字符串，用于审计） */
  afterState?: string;
  /** 操作原因（必填，openclaw 要求每次写操作记录原因） */
  reason: string;
  /** 关联的 run ID（agent 运行 ID） */
  runId?: string;
  /** 关联的会话 ID */
  sessionId?: string;
}

// ==================== WriteProvenanceService ====================

/**
 * 写溯源服务。
 *
 * 通过 AgentSqliteBackend 将写操作记录到 audit 表。
 * memoryStore / adapters 在执行写操作时调用此服务记录溯源。
 */
export class WriteProvenanceService {
  constructor(private readonly backend: AgentSqliteBackend) {}

  /**
   * 记录一次写操作。
   *
   * 应在业务写入的同一事务内调用，保证溯源与业务写入原子性。
   *
   * @param record 写溯源记录
   * @returns 审计记录 ID
   */
  recordWrite(record: WriteProvenanceRecord): string {
    const id = generateAuditId();
    const timestamp = Date.now();

    try {
      const stmt = this.backend.prepare(
        `INSERT INTO audit (id, actor, action, target_type, target_id, before_state, after_state, reason, run_id, session_id, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      stmt.run(
        id,
        record.actor,
        record.action,
        record.targetType,
        record.targetId ?? null,
        record.beforeState ?? null,
        record.afterState ?? null,
        record.reason,
        record.runId ?? null,
        record.sessionId ?? null,
        timestamp
      );
      return id;
    } catch (err) {
      // 溯源写入失败不应中断业务（降级：仅记录日志）
      console.error('[WriteProvenance] Failed to record write:', err);
      throw toAgentError(err, 'WriteProvenance.recordWrite failed');
    }
  }

  /**
   * 在事务中记录写操作。
   *
   * 与业务写入放在同一事务，保证原子性。
   *
   * @param fn 业务写入函数（返回溯源记录）
   * @returns 业务写入函数的返回值
   */
  recordInTransaction<T>(fn: () => { result: T; provenance: WriteProvenanceRecord }): T {
    return this.backend.transaction(() => {
      const { result, provenance } = fn();
      this.recordWrite(provenance);
      return result;
    });
  }

  /**
   * 查询审计日志。
   *
   * @param filter 过滤条件
   * @returns 审计记录列表（按时间倒序）
   */
  queryAudit(filter: {
    targetType?: string;
    targetId?: string;
    actor?: string;
    since?: number;
    until?: number;
    limit?: number;
  }): AuditRow[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.targetType) {
      conditions.push('target_type = ?');
      params.push(filter.targetType);
    }
    if (filter.targetId) {
      conditions.push('target_id = ?');
      params.push(filter.targetId);
    }
    if (filter.actor) {
      conditions.push('actor = ?');
      params.push(filter.actor);
    }
    if (filter.since !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(filter.since);
    }
    if (filter.until !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(filter.until);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);

    const stmt = this.backend.prepare(
      `SELECT * FROM audit ${whereClause} ORDER BY timestamp DESC LIMIT ?`
    );
    return stmt.all<AuditRow>(...params, limit);
  }

  /**
   * 构建写溯源链（某目标的完整修改历史）。
   *
   * @param targetType 目标类型
   * @param targetId 目标 ID
   * @returns 修改历史（按时间正序，最早的在前）
   */
  buildProvenance(targetType: string, targetId: string): AuditRow[] {
    const stmt = this.backend.prepare(
      `SELECT * FROM audit WHERE target_type = ? AND target_id = ? ORDER BY timestamp ASC`
    );
    return stmt.all<AuditRow>(targetType, targetId);
  }
}

// ==================== ID 生成 ====================

let auditCounter = 0;

/**
 * 生成审计记录 ID。
 *
 * 格式：audit_<timestamp>_<counter>
 * 单调递增，保证同一毫秒内的多条记录不冲突。
 */
function generateAuditId(): string {
  auditCounter += 1;
  return `audit_${Date.now()}_${auditCounter}`;
}
