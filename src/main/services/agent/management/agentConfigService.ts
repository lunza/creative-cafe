/**
 * AgentConfigService —— 智能体配置管理服务
 *
 * 来源：spec §add-agent-mode-management-and-center / Task 3
 *
 * 职责：
 *  1. 管理系统预置智能体（对话 / 写作 / 世界书）的注册与初始化
 *  2. 提供智能体配置的 CRUD 接口（list / getById / create / update / delete）
 *  3. 提供技能白名单更新（updateSkills）与状态切换（toggleStatus）
 *  4. 内存缓存（Map<string, AgentConfig>）+ SQLite 持久化
 *  5. 系统预置智能体删除保护
 *
 * 数据流向：
 *  - 读操作：优先命中内存缓存；首次读取时从 SQLite 加载全量
 *  - 写操作：同步更新 SQLite + 内存缓存
 *
 * 序列化约定：
 *  - skills: string[] → JSON 字符串
 *  - identity: AgentIdentity → JSON 字符串（可 null）
 *  - config: Record<string, unknown> → JSON 字符串（可 null）
 *  - isSystem: boolean → INTEGER (0/1)
 *
 * 单例：模块导出唯一实例 agentConfigService。
 */

import type {
  AgentConfig,
  AgentType,
  AgentStatus,
  SystemAgentDefinition,
} from './agentConfigTypes';
import type { AgentSqliteBackend } from '../memory/sqliteBackend';
import { getAgentBackend, initAgentBackendIfNeeded, getAgentBackendStatus } from '../memory/sqliteBackend';
import { toAgentError } from '../infra/errors';

// ==================== 系统预置智能体定义 ====================

/**
 * 系统预置智能体定义。
 *
 * init() 时幂等注册：若 agent_configs 表中已存在对应 id 则跳过。
 */
const SYSTEM_AGENTS: SystemAgentDefinition[] = [
  {
    id: 'system-agent',
    name: '系统智能体',
    description: 'Creative Cafe 统一系统智能体，具备多轮对话、工具调用、多步推理和任务分解能力。支持通过斜杠指令执行世界书列表、角色卡列表、世界书编写、世界书审核等系统级任务，也可直接处理代码开发、问题解答、任务规划等复杂需求。',
    type: 'custom',
    mode: 'dialogue',
    skills: [
      // 对话智能体技能
      'state-table-edit', 'chat-history-search', 'worldbook-search',
      // 写作智能体技能
      'plot-check', 'outline-generate', 'chapter-write', 'description-polish', 'table-organize',
      // 世界书智能体技能
      'worldbook-author', 'worldbook-generate', 'worldbook-keywords', 'worldbook-sort',
    ],
    identity: { emoji: '🤖', color: '#1890ff' },
  },
];

// ==================== SQLite 行类型 ====================

/**
 * agent_configs 表的行类型（SQLite 查询结果）。
 */
interface AgentConfigRow {
  id: string;
  name: string;
  description: string | null;
  type: string;
  status: string;
  is_system: number;
  skills: string;
  mode: string;
  identity: string | null;
  config: string | null;
  created_at: number;
  updated_at: number;
}

// ==================== 序列化工具 ====================

/**
 * 将数据库行转换为 AgentConfig。
 *
 * 解析 JSON 字段（skills / identity / config），转换 is_system INTEGER → boolean。
 */
function rowToConfig(row: AgentConfigRow): AgentConfig {
  let identity: AgentConfig['identity'];
  if (row.identity) {
    try {
      identity = JSON.parse(row.identity);
    } catch {
      // identity 解析失败时忽略
    }
  }

  let config: AgentConfig['config'];
  if (row.config) {
    try {
      config = JSON.parse(row.config);
    } catch {
      // config 解析失败时忽略
    }
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    type: row.type as AgentType,
    status: row.status as AgentStatus,
    isSystem: row.is_system === 1,
    skills: safeParseArray(row.skills),
    mode: row.mode as AgentConfig['mode'],
    identity,
    config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 安全解析 JSON 字符串为数组，解析失败时返回空数组。
 */
function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ==================== ID 生成 ====================

let configCounter = 0;

/**
 * 生成智能体配置 ID。
 *
 * 格式：agent_<timestamp>_<counter>
 */
function generateConfigId(): string {
  configCounter += 1;
  return `agent_${Date.now()}_${configCounter}`;
}

// ==================== AgentConfigService ====================

/**
 * 智能体配置管理服务。
 *
 * 内存缓存 + SQLite 持久化双轨：
 *  - 首次读操作触发全量加载（lazy）
 *  - 所有写操作同步更新 SQLite 与内存缓存
 *
 * 生命周期：
 *  - init()：确保 SQLite 后端就绪 + 注册系统预置智能体（幂等）
 *  - 其他方法：依赖 init() 完成，未初始化时抛出明确错误
 */
export class AgentConfigService {
  private readonly cache = new Map<string, AgentConfig>();
  private cacheLoaded = false;
  private initPromise: Promise<void> | null = null;

  /**
   * 初始化服务：确保 SQLite 后端就绪，注册系统预置智能体。
   *
   * 幂等：已存在的系统智能体不会重复插入。
   * 多次调用安全：返回同一个 Promise，避免并发 init 竞态。
   */
  async init(): Promise<void> {
    if (this.cacheLoaded) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    const backend = await initAgentBackendIfNeeded();
    if (!backend) {
      const status = getAgentBackendStatus();
      throw new Error(
        'AgentSqliteBackend unavailable. ' +
          (status.error ? `Init error: ${status.error}` : 'better-sqlite3 not installed or init failed.') +
          ' Cannot initialize AgentConfigService.',
      );
    }

    // 加载已有配置到缓存
    this.loadCache();

    // 迁移：删除旧的三个预置智能体（dialogue-agent/writing-agent/worldbook-agent）
    const LEGACY_AGENT_IDS = ['dialogue-agent', 'writing-agent', 'worldbook-agent'];
    for (const legacyId of LEGACY_AGENT_IDS) {
      if (this.cache.has(legacyId)) {
        const stmt = backend.prepare('DELETE FROM agent_configs WHERE id = ?');
        stmt.run(legacyId);
        this.cache.delete(legacyId);
        console.log(`[AgentConfigService] Migrated: removed legacy agent "${legacyId}"`);
      }
    }

    // 注册/更新系统预置智能体（upsert：已存在的记录也会被更新）
    // 【重要】不能简单 skip 已有记录，否则代码中新增的 isSystem/description/skills
    // 等字段变更无法同步到数据库，导致运行时 isSystem=false 等问题
    for (const def of SYSTEM_AGENTS) {
      const existing = this.cache.get(def.id);
      const now = Date.now();
      const config: AgentConfig = {
        id: def.id,
        name: def.name,
        description: def.description,
        type: def.type,
        status: 'enabled',
        isSystem: true,
        skills: [...def.skills],
        mode: def.mode,
        identity: { ...def.identity },
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      if (existing) {
        this.updateConfig(backend, config);
      } else {
        this.insertConfig(backend, config);
      }
      this.cache.set(config.id, config);
    }
  }

  /**
   * 返回所有智能体配置。
   *
   * 首次调用时从 SQLite 加载全量到缓存，后续直接返回缓存。
   * 自动等待 init() 完成，避免竞态。
   */
  async list(): Promise<AgentConfig[]> {
    await this.init();
    return Array.from(this.cache.values());
  }

  /**
   * 按 ID 获取智能体配置。
   *
   * @returns 配置对象；不存在时返回 null
   * 自动等待 init() 完成，避免竞态。
   */
  async getById(id: string): Promise<AgentConfig | null> {
    await this.init();
    return this.cache.get(id) ?? null;
  }

  /**
   * 创建新的智能体配置。
   *
   * 生成 ID、设置时间戳，插入 SQLite 并更新缓存。
   */
  async create(
    config: Omit<AgentConfig, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<AgentConfig> {
    try {
      const backend = this.getBackend();
      const now = Date.now();
      const newConfig: AgentConfig = {
        ...config,
        id: generateConfigId(),
        createdAt: now,
        updatedAt: now,
      };

      this.insertConfig(backend, newConfig);
      this.cache.set(newConfig.id, newConfig);
      return newConfig;
    } catch (err) {
      throw toAgentError(err, 'AgentConfigService.create failed');
    }
  }

  /**
   * 更新智能体配置（部分更新）。
   *
   * 合并 patch，更新 updatedAt，保存到 SQLite 与缓存。
   * id 与 createdAt 不可被 patch 覆盖。
   */
  async update(id: string, patch: Partial<AgentConfig>): Promise<AgentConfig> {
    try {
      await this.init();
      const existing = this.cache.get(id);
      if (!existing) {
        throw new Error(`Agent config not found: ${id}`);
      }

      const updated: AgentConfig = {
        ...existing,
        ...patch,
        // 不可变字段：防止 patch 覆盖
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      };

      const backend = this.getBackend();
      this.updateConfig(backend, updated);
      this.cache.set(id, updated);
      return updated;
    } catch (err) {
      throw toAgentError(err, `AgentConfigService.update failed for id: ${id}`);
    }
  }

  /**
   * 删除智能体配置。
   *
   * 系统预置智能体（isSystem === true）不可删除，抛出错误。
   */
  async delete(id: string): Promise<void> {
    try {
      await this.init();
      const existing = this.cache.get(id);
      if (!existing) {
        throw new Error(`Agent config not found: ${id}`);
      }
      if (existing.isSystem) {
        throw new Error(`Cannot delete system agent: ${id}`);
      }

      const backend = this.getBackend();
      const stmt = backend.prepare('DELETE FROM agent_configs WHERE id = ?');
      stmt.run(id);
      this.cache.delete(id);
    } catch (err) {
      throw toAgentError(err, `AgentConfigService.delete failed for id: ${id}`);
    }
  }

  /**
   * 更新智能体的技能白名单。
   */
  async updateSkills(id: string, skills: string[]): Promise<AgentConfig> {
    return this.update(id, { skills });
  }

  /**
   * 切换智能体启用/禁用状态。
   */
  async toggleStatus(id: string): Promise<AgentConfig> {
    await this.init();
    const existing = this.cache.get(id);
    if (!existing) {
      throw new Error(`Agent config not found: ${id}`);
    }
    const newStatus: AgentStatus = existing.status === 'enabled' ? 'disabled' : 'enabled';
    return this.update(id, { status: newStatus });
  }

  // ==================== 内部方法 ====================

  /**
   * 获取已初始化的 SQLite 后端。
   *
   * 后端未初始化时抛出明确错误（调用方应先 init()）。
   */
  private getBackend(): AgentSqliteBackend {
    const backend = getAgentBackend();
    if (!backend.isInitialized) {
      throw new Error(
        'AgentSqliteBackend not initialized. Call agentConfigService.init() first.',
      );
    }
    return backend;
  }

  /**
   * 从 SQLite 加载全量配置到缓存（仅首次）。
   */
  private loadCache(): void {
    const backend = this.getBackend();
    const stmt = backend.prepare('SELECT * FROM agent_configs ORDER BY created_at ASC');
    const rows = stmt.all<AgentConfigRow>();
    this.cache.clear();
    for (const row of rows) {
      this.cache.set(row.id, rowToConfig(row));
    }
    this.cacheLoaded = true;
  }

  /**
   * 插入配置到 SQLite。
   */
  private insertConfig(backend: AgentSqliteBackend, config: AgentConfig): void {
    const stmt = backend.prepare(
      `INSERT INTO agent_configs
        (id, name, description, type, status, is_system, skills, mode, identity, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      config.id,
      config.name,
      config.description || null,
      config.type,
      config.status,
      config.isSystem ? 1 : 0,
      JSON.stringify(config.skills),
      config.mode,
      config.identity ? JSON.stringify(config.identity) : null,
      config.config ? JSON.stringify(config.config) : null,
      config.createdAt,
      config.updatedAt,
    );
  }

  /**
   * 更新 SQLite 中的配置。
   */
  private updateConfig(backend: AgentSqliteBackend, config: AgentConfig): void {
    const stmt = backend.prepare(
      `UPDATE agent_configs SET
        name = ?, description = ?, type = ?, status = ?, is_system = ?,
        skills = ?, mode = ?, identity = ?, config = ?, updated_at = ?
       WHERE id = ?`,
    );
    stmt.run(
      config.name,
      config.description || null,
      config.type,
      config.status,
      config.isSystem ? 1 : 0,
      JSON.stringify(config.skills),
      config.mode,
      config.identity ? JSON.stringify(config.identity) : null,
      config.config ? JSON.stringify(config.config) : null,
      config.updatedAt,
      config.id,
    );
  }
}

// ==================== 单例 ====================

/** 智能体配置管理服务单例（全应用共享） */
export const agentConfigService = new AgentConfigService();