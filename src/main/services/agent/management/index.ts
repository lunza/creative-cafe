/**
 * management/ 模块 barrel export —— 智能体配置与模式管理统一出口
 *
 * 来源：spec §add-agent-mode-management-and-center / Task 2
 *
 * 导出：
 *  - AgentModeService 单例与类（agentModeService）
 *  - 模式管理类型（AgentModeStatus / AgentModeOverride 等，来自 agentConfigTypes）
 *  - 主进程专用类型（SystemAgentDefinition）
 *
 * import 路径示例：
 *   import { agentModeService } from '@/main/services/agent/management';
 *   import type { AgentModeStatus, AgentModeOverride } from '@/main/services/agent/management';
 */

// Agent 模式管理服务（Task 2）
export { agentModeService, AgentModeService, type ActiveEngineSnapshot } from './agentModeService';

// Agent 配置管理服务（Task 3）
export { agentConfigService, AgentConfigService } from './agentConfigService';

// 共享核心类型 + IPC payload 类型 + 主进程专用类型（re-export 自 agentConfigTypes）
export type {
  AgentType,
  AgentStatus,
  AgentModeOverride,
  AgentModeReason,
  AgentModeStatus,
  AgentIdentity,
  AgentConfig,
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
  AgentConfigChangedEvent,
  SystemAgentDefinition,
} from './agentConfigTypes';
