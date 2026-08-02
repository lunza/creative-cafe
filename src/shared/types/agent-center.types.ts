/**
 * 智能体管理中心共享类型（SSOT）
 *
 * 来源：spec §add-agent-mode-management-and-center（智能体模式管理与智能体管理中心）
 *
 * 参照 openclaw src/config/types.agents.ts 的 AgentConfig 范式简化适配。
 * 定义本项目智能体管理中心所需的配置类型、模式管理类型与 IPC payload 类型。
 *
 * 类型真源（single source of truth）：
 *  - 主进程 src/main/services/agent/management/agentConfigTypes.ts re-export 本文件核心类型，
 *    并附加主进程专用的 SystemAgentDefinition 类型。
 *  - 渲染进程通过 @shared/types 或直接引用本文件获取类型。
 */

// ==================== 核心类型 ====================

/** 智能体类型 */
export type AgentType = 'dialogue' | 'writing' | 'worldbook' | 'game' | 'custom';

/** 智能体状态 */
export type AgentStatus = 'enabled' | 'disabled';

/** Agent 模式覆盖设置（三态开关） */
export type AgentModeOverride = 'auto' | 'force-on' | 'force-off';

/** Agent 模式激活原因 */
export type AgentModeReason =
  | 'tool-calling-supported'    // auto 模式下模型支持工具调用
  | 'force-on'                  // 用户强制开启
  | 'force-off'                 // 用户强制关闭
  | 'tool-calling-unsupported'; // auto 模式下模型不支持工具调用

/** Agent 模式状态 */
export interface AgentModeStatus {
  /** 当前 Agent 模式是否激活 */
  active: boolean;
  /** 激活/关闭原因 */
  reason: AgentModeReason;
  /** 当前模型是否支持工具调用 */
  supportsToolCalling: boolean;
  /** 用户覆盖设置 */
  override: AgentModeOverride;
  /** 上次变更时间戳（Unix ms） */
  lastChangedAt: number;
}

/** 智能体身份标识 */
export interface AgentIdentity {
  /** 图标 emoji */
  emoji?: string;
  /** 主题色 */
  color?: string;
}

/** 智能体配置（参照 openclaw AgentConfig 简化适配） */
export interface AgentConfig {
  /** 唯一标识（如 'dialogue-agent', 'writing-agent'） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 人类可读描述 */
  description: string;
  /** 智能体类型 */
  type: AgentType;
  /** 启用/禁用状态 */
  status: AgentStatus;
  /** 系统预置（不可删除） */
  isSystem: boolean;
  /** 技能白名单（参照 openclaw AgentConfig.skills） */
  skills: string[];
  /** 运行模式 */
  mode: 'dialogue' | 'writing' | 'game' | 'worldbook';
  /** 身份标识 */
  identity?: AgentIdentity;
  /** 类型特定配置（如写作智能体的编排选项） */
  config?: Record<string, unknown>;
  /** 创建时间（Unix ms） */
  createdAt: number;
  /** 更新时间（Unix ms） */
  updatedAt: number;
}

// ==================== IPC Payload 类型 ====================

/** agent:isModeActive 返回值 */
export interface IsModeActiveResult {
  ok: boolean;
  active?: boolean;
  error?: string;
}

/** agent:getModeStatus 返回值 */
export interface GetModeStatusResult {
  ok: boolean;
  status?: AgentModeStatus;
  error?: string;
}

/** agent:setModeOverride 请求参数 */
export interface SetModeOverrideRequest {
  override: AgentModeOverride;
}

/** agent:setModeOverride 返回值 */
export interface SetModeOverrideResult {
  ok: boolean;
  status?: AgentModeStatus;
  error?: string;
}

/** agent-config:list 返回值 */
export interface AgentConfigListResult {
  ok: boolean;
  configs?: AgentConfig[];
  error?: string;
}

/** agent-config:get 请求参数 */
export interface AgentConfigGetRequest {
  id: string;
}

/** agent-config:get 返回值 */
export interface AgentConfigGetResult {
  ok: boolean;
  config?: AgentConfig;
  error?: string;
}

/** agent-config:update 请求参数 */
export interface AgentConfigUpdateRequest {
  id: string;
  patch: Partial<AgentConfig>;
}

/** agent-config:update 返回值 */
export interface AgentConfigUpdateResult {
  ok: boolean;
  config?: AgentConfig;
  error?: string;
}

/** agent-config:toggle 请求参数 */
export interface AgentConfigToggleRequest {
  id: string;
}

/** agent-config:toggle 返回值 */
export interface AgentConfigToggleResult {
  ok: boolean;
  config?: AgentConfig;
  error?: string;
}

/** agent-config:updateSkills 请求参数 */
export interface AgentConfigUpdateSkillsRequest {
  id: string;
  skills: string[];
}

/** agent-config:updateSkills 返回值 */
export interface AgentConfigUpdateSkillsResult {
  ok: boolean;
  config?: AgentConfig;
  error?: string;
}

/** agent-config:changed 事件推送 */
export interface AgentConfigChangedEvent {
  agentId: string;
  action: 'created' | 'updated' | 'deleted' | 'toggled' | 'skills-updated';
}

/** agent-config:create 请求参数 */
export interface AgentConfigCreateRequest {
  config: Omit<AgentConfig, 'id' | 'createdAt' | 'updatedAt' | 'isSystem'>;
}

/** agent-config:create 返回值 */
export interface AgentConfigCreateResult {
  ok: boolean;
  config?: AgentConfig;
  error?: string;
}

/** agent-config:delete 请求参数 */
export interface AgentConfigDeleteRequest {
  id: string;
}

/** agent-config:delete 返回值 */
export interface AgentConfigDeleteResult {
  ok: boolean;
  error?: string;
}
