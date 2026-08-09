/**
 * MemoryStore —— IMemoryProvider 实现（SQLite + adapters 桥接）
 *
 * 来源：spec §二 Task 8.2（memoryStore.ts + writeProvenance + memoryPromptPrepare）
 * 决策：适配（spec §三）。openclaw 的 memory 分散在 dreaming / runtime，
 *       本项目按 IMemoryProvider 契约统一封装，SQLite 存 agent 自主记忆，
 *       adapters 桥接现有资产（worldBook / character / chatHistory / chapter）。
 *
 * 职责：
 *  1. 实现 IMemoryProvider.search/write/read/delete 接口
 *  2. agent 自主记忆走 SQLite（agent_memory 表）
 *  3. 现有资产通过 adapters 桥接（只读检索，写入走原服务）
 *  4. 写操作记录写溯源（writeProvenance）
 *  5. 混合检索：关键词 + 向量（向量检索依赖 EmbeddingService，未来接入）
 *
 * 设计约束（openclaw AGENTS.md）：
 *  - 记忆是 prompt：检索结果返回模型下一步需要的信息
 *  - 双轨并行：新数据（agent 记忆）走 SQLite，旧数据通过 adapter 桥接
 *  - 写溯源：每次写入记录 who/what/when/why
 *  - 事务内写入：业务写入 + 溯源记录原子性
 */

import type {
  IMemoryProvider,
  MemoryQuery,
  MemoryEntry,
  MemoryType,
} from '../contracts';
import type { AgentSqliteBackend, AgentMemoryRow } from './sqliteBackend';
import { WriteProvenanceService } from './writeProvenance';
import { toAgentError } from '../infra/errors';

// ==================== 类型定义 ====================

/**
 * 记忆适配器接口（桥接现有资产）。
 *
 * 各 adapter（worldBookAdapter / characterAdapter / chatHistoryAdapter / chapterAdapter）
 * 实现此接口，将现有服务的数据转换为 MemoryEntry 格式。
 *
 * 适配器仅提供只读检索能力（search），写入走原服务（保持数据一致性）。
 */
export interface IMemoryAdapter {
  /** 适配器对应的记忆类型 */
  readonly type: MemoryType;
  /** 检索记忆（关键词匹配） */
  search(query: MemoryQuery): Promise<MemoryEntry[]>;
  /** 读取单条记忆（按 source 标识） */
  read(source: string): Promise<MemoryEntry | null>;
}

// ==================== MemoryStore 配置 ====================

export interface MemoryStoreConfig {
  /** SQLite 后端 */
  backend: AgentSqliteBackend;
  /** 写溯源服务 */
  provenance: WriteProvenanceService;
  /** 是否启用写溯源（默认 true） */
  enableProvenance?: boolean;
}

// ==================== MemoryStore 实现 ====================

/**
 * Agent 记忆存储。
 *
 * 实现 IMemoryProvider 接口，统一管理 agent 自主记忆 + 现有资产桥接。
 *
 * 数据流向：
 *  - agent 自主记忆（type='agent'/'skill'）→ SQLite agent_memory 表
 *  - 现有资产（type='lore'/'persona'/'dialogue'/'chapter'）→ adapters 桥接
 *
 * 检索策略：
 *  - 先查 SQLite（agent 自主记忆）
 *  - 再查 adapters（现有资产）
 *  - 合并 + 去重 + 排序（按 score 降序）
 */
export class MemoryStore implements IMemoryProvider {
  private readonly backend: AgentSqliteBackend;
  private readonly provenance: WriteProvenanceService;
  private readonly enableProvenance: boolean;
  private readonly adapters = new Map<MemoryType, IMemoryAdapter>();

  constructor(config: MemoryStoreConfig) {
    this.backend = config.backend;
    this.provenance = config.provenance;
    this.enableProvenance = config.enableProvenance ?? true;
  }

  /**
   * 注册记忆适配器。
   *
   * 桥接现有资产（worldBook / character / chatHistory / chapter）到统一检索接口。
   */
  registerAdapter(adapter: IMemoryAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  /**
   * 注销适配器。
   */
  unregisterAdapter(type: MemoryType): void {
    this.adapters.delete(type);
  }

  // ==================== IMemoryProvider 实现 ====================

  /**
   * 检索记忆（混合检索：SQLite + adapters）。
   *
   * @param query 检索查询
   * @returns 记忆条目列表（按 score 降序，limit 截断）
   */
  async search(query: MemoryQuery): Promise<MemoryEntry[]> {
    const limit = query.limit ?? 10;
    const results: MemoryEntry[] = [];

    // 1. 检索 SQLite（agent 自主记忆）
    const sqliteResults = this.searchSqlite(query);
    results.push(...sqliteResults);

    // 2. 检索 adapters（现有资产）
    const targetTypes = query.types ?? [];
    const adapterTypes = targetTypes.length > 0
      ? targetTypes.filter(t => this.adapters.has(t))
      : Array.from(this.adapters.keys());

    for (const type of adapterTypes) {
      const adapter = this.adapters.get(type);
      if (!adapter) continue;
      try {
        const adapterResults = await adapter.search(query);
        results.push(...adapterResults);
      } catch (err) {
        // 适配器失败不中断检索（降级：跳过该适配器）
        console.warn(`[MemoryStore] Adapter ${type} search failed:`, err);
      }
    }

    // 3. 排序 + 去重 + 截断
    const sorted = results
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);

    return sorted;
  }

  /**
   * 写入记忆（agent 自主记忆走 SQLite）。
   *
   * @param entry 记忆条目（不含 id 和 timestamp）
   * @returns 新记忆的 ID
   */
  async write(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): Promise<string> {
    const id = generateMemoryId();
    const now = Date.now();

    try {
      const writeFn = () => {
        const stmt = this.backend.prepare(
          `INSERT INTO agent_memory (id, type, content, source, metadata, score, character_id, session_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        stmt.run(
          id,
          entry.type,
          entry.content,
          entry.source,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
          entry.score ?? null,
          entry.characterId ?? null,
          entry.sessionId ?? null,
          now,
          now
        );
        return id;
      };

      if (this.enableProvenance) {
        // 事务内写入 + 溯源
        return this.provenance.recordInTransaction(() => ({
          result: writeFn(),
          provenance: {
            actor: 'agent',
            action: 'create',
            targetType: 'memory',
            targetId: id,
            afterState: JSON.stringify({ type: entry.type, source: entry.source }),
            reason: `Agent memory write: ${entry.source}`,
            sessionId: entry.sessionId,
          },
        }));
      }
      return writeFn();
    } catch (err) {
      throw toAgentError(err, 'MemoryStore.write failed');
    }
  }

  /**
   * 读取指定 ID 的记忆。
   */
  async read(id: string): Promise<MemoryEntry | null> {
    try {
      const stmt = this.backend.prepare(
        `SELECT * FROM agent_memory WHERE id = ?`
      );
      const row = stmt.get<AgentMemoryRow>(id);
      return row ? rowToMemoryEntry(row) : null;
    } catch (err) {
      throw toAgentError(err, `MemoryStore.read failed for id: ${id}`);
    }
  }

  /**
   * 删除记忆。
   */
  async delete(id: string): Promise<boolean> {
    try {
      const deleteFn = (): boolean => {
        const stmt = this.backend.prepare(`DELETE FROM agent_memory WHERE id = ?`);
        const result = stmt.run(id);
        return result.changes > 0;
      };

      if (this.enableProvenance) {
        return this.provenance.recordInTransaction(() => {
          const deleted = deleteFn();
          return {
            result: deleted,
            provenance: {
              actor: 'agent',
              action: 'delete',
              targetType: 'memory',
              targetId: id,
              reason: 'Agent memory deletion',
            },
          };
        });
      }
      return deleteFn();
    } catch (err) {
      throw toAgentError(err, `MemoryStore.delete failed for id: ${id}`);
    }
  }

  // ==================== 内部方法 ====================

  /**
   * 检索 SQLite 中的 agent 自主记忆。
   *
   * 当前实现：关键词 LIKE 匹配。
   * 未来扩展：向量检索（embedding 列 + 余弦相似度）。
   */
  private searchSqlite(query: MemoryQuery): MemoryEntry[] {
    try {
      const conditions: string[] = [];
      const params: unknown[] = [];

      // 关键词匹配（LIKE，简化实现）
      if (query.query) {
        conditions.push('content LIKE ?');
        params.push(`%${query.query}%`);
      }

      // 类型过滤（仅 agent 自主记忆类型：agent / skill）
      const sqliteTypes: MemoryType[] = ['agent', 'skill'];
      const targetTypes = query.types?.filter(t => sqliteTypes.includes(t)) ?? sqliteTypes;
      if (targetTypes.length > 0) {
        const placeholders = targetTypes.map(() => '?').join(',');
        conditions.push(`type IN (${placeholders})`);
        params.push(...targetTypes);
      }

      // 角色卡过滤
      if (query.characterId) {
        conditions.push('character_id = ?');
        params.push(query.characterId);
      }

      // 会话过滤
      if (query.sessionId) {
        conditions.push('session_id = ?');
        params.push(query.sessionId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Math.min(query.limit ?? 10, 100);

      const stmt = this.backend.prepare(
        `SELECT * FROM agent_memory ${whereClause} ORDER BY created_at DESC LIMIT ?`
      );
      const rows = stmt.all<AgentMemoryRow>(...params, limit);
      return rows.map(rowToMemoryEntry);
    } catch (err) {
      console.warn('[MemoryStore] SQLite search failed:', err);
      return [];
    }
  }
}

// ==================== 工具函数 ====================

/**
 * 将数据库行转换为 MemoryEntry。
 */
function rowToMemoryEntry(row: AgentMemoryRow): MemoryEntry {
  let metadata: Record<string, unknown> | undefined;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      // metadata 解析失败时忽略
    }
  }
  return {
    id: row.id,
    type: row.type as MemoryType,
    content: row.content,
    source: row.source,
    score: row.score ?? undefined,
    metadata,
    timestamp: row.created_at,
  };
}

let memoryCounter = 0;

/**
 * 生成记忆 ID。
 *
 * 格式：mem_<timestamp>_<counter>
 */
function generateMemoryId(): string {
  memoryCounter += 1;
  return `mem_${Date.now()}_${memoryCounter}`;
}

// ==================== 单例管理 ====================

let memoryStoreInstance: MemoryStore | null = null;

/**
 * 获取 MemoryStore 单例。
 *
 * 首次调用需传入 config，后续调用可省略。
 * 单例模式确保全应用共享同一记忆存储。
 */
export function getMemoryStore(config?: MemoryStoreConfig): MemoryStore {
  if (!memoryStoreInstance && config) {
    memoryStoreInstance = new MemoryStore(config);
  }
  if (!memoryStoreInstance) {
    throw new Error('MemoryStore not initialized. Call getMemoryStore(config) first.');
  }
  return memoryStoreInstance;
}

/**
 * 检查 MemoryStore 是否已初始化。
 * 用于在调用 getMemoryStore() 前判断是否可用，避免抛错。
 */
export function isMemoryStoreInitialized(): boolean {
  return memoryStoreInstance !== null;
}

/**
 * 重置 MemoryStore 单例（仅测试用）。
 */
export function resetMemoryStore(): void {
  memoryStoreInstance = null;
}
