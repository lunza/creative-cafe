/**
 * 逻辑任务统一导出
 *
 * Spec: redesign-dialogue-pipeline-architecture / LogicEngine
 *
 * 所有预置逻辑任务通过此文件统一导出，供集成层（Task 13/14）注册到 LogicEngine。
 */

export { UpdateEmotionTask } from './UpdateEmotionTask';
export type { UpdateEmotionTaskOptions } from './UpdateEmotionTask';

export { RenderOptionsTask } from './RenderOptionsTask';
export type { RenderOptionsTaskOptions } from './RenderOptionsTask';

export { ExecuteTableEditTask } from './ExecuteTableEditTask';
export type { ExecuteTableEditTaskOptions } from './ExecuteTableEditTask';

export { TriggerSyncOrganizeTask } from './TriggerSyncOrganizeTask';
export type { TriggerSyncOrganizeTaskOptions } from './TriggerSyncOrganizeTask';

export { TriggerVectorizationTask } from './TriggerVectorizationTask';
export type { TriggerVectorizationTaskOptions } from './TriggerVectorizationTask';

export { DedupRetryTask } from './DedupRetryTask';
export type { DedupRetryTaskOptions } from './DedupRetryTask';

export { SaveChatTask } from './SaveChatTask';
export type { SaveChatTaskOptions } from './SaveChatTask';

export { UpdateTokenUsageTask } from './UpdateTokenUsageTask';
export type { UpdateTokenUsageTaskOptions } from './UpdateTokenUsageTask';
