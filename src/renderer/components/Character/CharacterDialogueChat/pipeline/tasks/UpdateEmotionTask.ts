/**
 * 逻辑任务 — UpdateEmotionTask
 *
 * Spec: redesign-dialogue-pipeline-architecture / LogicEngine / UpdateEmotionTask
 *
 * 当后处理管线解析到情绪标记时，触发 UI 层更新消息的 emotion 字段，
 * 进而驱动表情图像加载。
 *
 * 对应当前逻辑：hooks onComplete 中将 parsedEmotion 写入消息并 dispatch STREAM_COMPLETE
 * （CharacterDialogueChat.hooks.ts L1497）
 *
 * Priority: 100（最先执行，确保情绪状态尽早更新）
 */

import type { LogicTask, DialoguePipelineContext } from '../pipeline.types';

/** UpdateEmotionTask 构造参数 */
export interface UpdateEmotionTaskOptions {
  /** 情绪更新回调 — 由集成层（Task 13/14）接入 React state dispatch */
  onEmotionUpdate: (messageId: string, emotion: string) => void;
  /** 目标消息 ID */
  messageId: string;
}

export class UpdateEmotionTask implements LogicTask {
  readonly name = 'UpdateEmotionTask';
  readonly priority = 100;

  private readonly options: UpdateEmotionTaskOptions;

  constructor(options: UpdateEmotionTaskOptions) {
    this.options = options;
  }

  condition(context: DialoguePipelineContext): boolean {
    return context.emotion !== null;
  }

  async execute(context: DialoguePipelineContext): Promise<void> {
    const emotion = context.emotion!;
    console.log(`[UpdateEmotionTask] 更新消息情绪: messageId=${this.options.messageId}, emotion=${emotion}`);
    this.options.onEmotionUpdate(this.options.messageId, emotion);
  }

  onError(error: Error, context: DialoguePipelineContext): void {
    console.error(`[UpdateEmotionTask] 情绪更新失败: ${error.message}`);
    context.logs.push({
      level: 'error',
      stage: 'LogicEngine',
      timestamp: Date.now(),
      message: `情绪更新失败: ${error.message}`,
    });
  }
}
