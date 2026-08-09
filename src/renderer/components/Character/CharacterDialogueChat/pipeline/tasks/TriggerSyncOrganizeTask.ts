/**
 * 逻辑任务 — TriggerSyncOrganizeTask
 *
 * Spec: redesign-dialogue-pipeline-architecture / LogicEngine / TriggerSyncOrganizeTask
 *
 * 当同步整理模式开启时，延迟 2 秒触发记忆表格同步整理（processChatProgressive）。
 * 延迟 2 秒是为了防抖，避免高频请求。
 *
 * 对应当前逻辑：hooks onComplete 中 setTimeout 延迟 2000ms 调用
 * window.electronAPI.memory.processChatProgressive
 * （CharacterDialogueChat.hooks.ts L1525-L1553）
 *
 * Priority: 400
 */

import type { LogicTask, DialoguePipelineContext } from '../pipeline.types';

/** TriggerSyncOrganizeTask 构造参数 */
export interface TriggerSyncOrganizeTaskOptions {
  /** 同步整理回调 — 由集成层（Task 13/14）接入 processChatProgressive 调用 */
  onSyncOrganize: () => void;
  /** 是否启用同步整理模式 */
  isSyncMode: boolean;
}

export class TriggerSyncOrganizeTask implements LogicTask {
  readonly name = 'TriggerSyncOrganizeTask';
  readonly priority = 400;

  private readonly options: TriggerSyncOrganizeTaskOptions;

  constructor(options: TriggerSyncOrganizeTaskOptions) {
    this.options = options;
  }

  condition(_context: DialoguePipelineContext): boolean {
    return this.options.isSyncMode === true;
  }

  async execute(context: DialoguePipelineContext): Promise<void> {
    console.log('[TriggerSyncOrganizeTask] 延迟 2 秒触发同步整理');

    // 延迟 2000ms 触发，避免高频请求（防抖）
    setTimeout(() => {
      try {
        this.options.onSyncOrganize();
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[TriggerSyncOrganizeTask] 同步整理回调执行失败: ${errMsg}`);
      }
    }, 2000);

    context.logs.push({
      level: 'info',
      stage: 'LogicEngine',
      timestamp: Date.now(),
      message: '同步整理已调度（延迟 2000ms）',
    });
  }

  onError(error: Error, context: DialoguePipelineContext): void {
    console.error(`[TriggerSyncOrganizeTask] 任务执行失败: ${error.message}`);
    context.logs.push({
      level: 'error',
      stage: 'LogicEngine',
      timestamp: Date.now(),
      message: `同步整理任务失败: ${error.message}`,
    });
  }
}
