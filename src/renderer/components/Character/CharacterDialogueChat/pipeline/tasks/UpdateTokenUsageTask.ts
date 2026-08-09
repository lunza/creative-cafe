/**
 * 逻辑任务 — UpdateTokenUsageTask
 *
 * Spec: redesign-dialogue-pipeline-architecture / LogicEngine / UpdateTokenUsageTask
 *
 * 当 token 管理开启时，更新 token 用量状态，供 UI 层显示上下文窗口使用情况。
 *
 * 对应当前逻辑：hooks 中 dispatch SET_TOKEN_USAGE
 * （CharacterDialogueChat.hooks.ts L1063-L1070）
 *
 * Priority: 800（最后执行，token 用量更新不影响其他副作用）
 */

import type { LogicTask, DialoguePipelineContext } from '../pipeline.types';

/** UpdateTokenUsageTask 构造参数 */
export interface UpdateTokenUsageTaskOptions {
  /** token 用量更新回调 — 由集成层（Task 13/14）接入 dispatch SET_TOKEN_USAGE */
  onTokenUpdate: (used: number, total: number) => void;
}

export class UpdateTokenUsageTask implements LogicTask {
  readonly name = 'UpdateTokenUsageTask';
  readonly priority = 800;

  private readonly options: UpdateTokenUsageTaskOptions;

  constructor(options: UpdateTokenUsageTaskOptions) {
    this.options = options;
  }

  condition(context: DialoguePipelineContext): boolean {
    // 当 sessionConfig 中 token 管理开启时执行
    // 若 tokenManagementEnabled 未设置则不执行（默认关闭）
    return context.sessionConfig.tokenManagementEnabled === true;
  }

  async execute(context: DialoguePipelineContext): Promise<void> {
    // token 用量信息由 ContextAssembler 在 PrePipeline 阶段计算并存储在 context 中
    // 当前 DialoguePipelineContext 尚无专用 token 用量字段，
    // 集成层（Task 13/14）将通过扩展 context 或构造参数传递实际值。
    //
    // 此处从 sessionConfig 读取配置的上限值，used 值由集成层通过回调注入。
    const total = context.sessionConfig.maxContextTokens ?? 0;
    const used = 0; // 占位值，集成层将通过 onTokenUpdate 闭包注入实际 used 值

    console.log(`[UpdateTokenUsageTask] 更新 token 用量: used=${used}, total=${total}`);
    this.options.onTokenUpdate(used, total);

    context.logs.push({
      level: 'info',
      stage: 'LogicEngine',
      timestamp: Date.now(),
      message: `token 用量已更新: used=${used}, total=${total}`,
    });
  }

  onError(error: Error, context: DialoguePipelineContext): void {
    console.error(`[UpdateTokenUsageTask] 任务执行失败: ${error.message}`);
    context.logs.push({
      level: 'error',
      stage: 'LogicEngine',
      timestamp: Date.now(),
      message: `token 用量更新任务失败: ${error.message}`,
    });
  }
}
