/**
 * 智能体配置与模式管理类型定义 —— 主进程类型层
 *
 * 来源：spec §add-agent-mode-management-and-center（智能体模式管理与智能体管理中心）
 *
 * 参照 openclaw src/config/types.agents.ts 的 AgentConfig 范式简化适配。
 *
 * 类型真源：src/shared/types/agent-center.types.ts
 *  本文件 re-export 共享核心类型，并附加主进程专用的 SystemAgentDefinition 类型。
 */

// re-export 共享核心类型（主进程 + 渲染进程共用）
export type {
  AgentType,
  AgentStatus,
  AgentModeOverride,
  AgentModeReason,
  AgentModeStatus,
  AgentIdentity,
  AgentConfig,
} from '../../../../shared/types/agent-center.types';

// re-export IPC payload 类型（主进程 IPC handler 使用）
export type {
  IsModeActiveResult,
  GetModeStatusResult,
  SetModeOverrideRequest,
  SetModeOverrideResult,
  AgentConfigListResult,
  AgentConfigGetRequest,
  AgentConfigGetResult,
  AgentConfigUpdateRequest,
  AgentConfigUpdateResult,
  AgentConfigToggleRequest,
  AgentConfigToggleResult,
  AgentConfigUpdateSkillsRequest,
  AgentConfigUpdateSkillsResult,
  AgentConfigCreateRequest,
  AgentConfigCreateResult,
  AgentConfigDeleteRequest,
  AgentConfigDeleteResult,
  AgentConfigChangedEvent,
} from '../../../../shared/types/agent-center.types';

// ==================== 主进程专用类型 ====================

/**
 * 系统预置智能体定义（主进程专用）。
 *
 * 用于在 agentConfigService 初始化时注册系统预置智能体（对话 / 写作 / 世界书）。
 * 与 AgentConfig 的区别：不含 status / isSystem / createdAt / updatedAt 等运行时字段，
 * 仅描述预置智能体的静态属性。
 */
export interface SystemAgentDefinition {
  id: string;
  name: string;
  description: string;
  type: import('../../../../shared/types/agent-center.types').AgentType;
  mode: import('../../../../shared/types/agent-center.types').AgentConfig['mode'];
  skills: string[];
  identity: import('../../../../shared/types/agent-center.types').AgentIdentity;
}
