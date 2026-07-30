/**
 * writing/ 模块 barrel export —— 写作智能体编排层统一出口
 *
 * import 路径示例：
 *   import { WritingAgentService } from './writing';
 *   import type { AgentWritingRequest } from './writing';
 */

export { WritingAgentService } from './writingAgentService';
export {
  meetsSeverityThreshold,
  SEVERITY_ORDER,
} from './writingAgentTypes';
export type {
  AgentWritingRequest,
  AgentWritingOptions,
  AgentWritingEvent,
  AgentWritingEventType,
  AgentWritingProgressCallback,
  AgentWritingResult,
  ChapterAgentResult,
  AgentWritingCheckpoint,
} from './writingAgentTypes';
