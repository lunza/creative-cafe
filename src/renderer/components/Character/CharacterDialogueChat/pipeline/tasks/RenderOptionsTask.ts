/**
 * 逻辑任务 — RenderOptionsTask
 *
 * Spec: redesign-dialogue-pipeline-architecture / LogicEngine / RenderOptionsTask
 *
 * 当后处理管线解析到辅助模式推荐选项时，触发 UI 层渲染选项按钮。
 *
 * 对应当前逻辑：hooks onComplete 中将 suggestedOptions 写入消息并 dispatch STREAM_COMPLETE
 * （CharacterDialogueChat.hooks.ts L1497）
 *
 * Priority: 200
 */

import type { LogicTask, DialoguePipelineContext, SuggestedOption } from '../pipeline.types';

/** RenderOptionsTask 构造参数 */
export interface RenderOptionsTaskOptions {
  /** 选项渲染回调 — 由集成层（Task 13/14）接入 React state dispatch */
  onOptionsRender: (messageId: string, options: SuggestedOption[]) => void;
  /** 目标消息 ID */
  messageId: string;
}

export class RenderOptionsTask implements LogicTask {
  readonly name = 'RenderOptionsTask';
  readonly priority = 200;

  private readonly options: RenderOptionsTaskOptions;

  constructor(options: RenderOptionsTaskOptions) {
    this.options = options;
  }

  condition(context: DialoguePipelineContext): boolean {
    return context.suggestedOptions !== null && context.suggestedOptions.length > 0;
  }

  async execute(context: DialoguePipelineContext): Promise<void> {
    const options = context.suggestedOptions!;
    console.log(`[RenderOptionsTask] 渲染辅助模式选项: messageId=${this.options.messageId}, count=${options.length}`);
    this.options.onOptionsRender(this.options.messageId, options);
  }

  onError(error: Error, context: DialoguePipelineContext): void {
    console.error(`[RenderOptionsTask] 选项渲染失败: ${error.message}`);
    context.logs.push({
      level: 'error',
      stage: 'LogicEngine',
      timestamp: Date.now(),
      message: `选项渲染失败: ${error.message}`,
    });
  }
}
