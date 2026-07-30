/**
 * WritingAgentService 类型定义 —— 写作智能体编排层
 *
 * 来源：spec §二 Task 15（WritingAgentService 编排：读大纲→写章→自审→修复→更新表→下一章）
 * 决策：自研（spec §三无对应 openclaw 文件）。写作编排是本项目特有业务，
 *       openclaw 无写作场景，此处按 spec §5.2 设计自研编排循环。
 *
 * 设计约束：
 *  - 固定编排循环（非动态 agent loop）：读大纲→写章→checkPlot→applyAutoFix→updateTable→下一章
 *  - 不替换现有逐按钮流程：用户手动触发"智能体写作"按钮
 *  - 支持取消与断点续跑（checkpoint 持久化到 SQLite）
 *  - 进度事件通过回调推送（IPC handler 桥接到渲染进程）
 *
 * 类型真源：src/shared/types/writing-agent.types.ts
 *  本文件 re-export 共享类型，附加主进程专用的 ProgressCallback 类型。
 */

// re-export 共享类型（主进程 + 渲染进程共用）
export type {
  AgentWritingRequest,
  AgentWritingOptions,
  AgentWritingEventType,
  AgentWritingEvent,
  ChapterAgentResult,
  AgentWritingResult,
  AgentWritingCheckpoint,
  AgentWritingStatus,
} from '../../../../shared/types/writing-agent.types';
export { SEVERITY_ORDER, meetsSeverityThreshold } from '../../../../shared/types/writing-agent.types';

// ==================== 主进程专用类型 ====================

/**
 * 进度回调类型（主进程内部使用，渲染进程不直接使用）。
 */
export type AgentWritingProgressCallback = (event: import('../../../../shared/types/writing-agent.types').AgentWritingEvent) => void;
