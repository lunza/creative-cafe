/**
 * 逻辑任务 — SaveChatTask
 *
 * Spec: redesign-dialogue-pipeline-architecture / LogicEngine / SaveChatTask
 *
 * 将当前聊天消息保存到存储。始终执行（condition 恒为 true）。
 *
 * 对应当前逻辑：hooks onComplete 中 saveChatToStore 调用
 * （CharacterDialogueChat.hooks.ts L1500-L1521）
 *
 * Priority: 700
 */

import type { LogicTask, DialoguePipelineContext, ChatMessage } from '../pipeline.types';

/** SaveChatTask 构造参数 */
export interface SaveChatTaskOptions {
  /** 保存回调 — 由集成层（Task 13/14）接入 saveChatToStore */
  onSave: (messages: ChatMessage[]) => void;
  /** 待保存的消息列表 */
  messages: ChatMessage[];
}

export class SaveChatTask implements LogicTask {
  readonly name = 'SaveChatTask';
  readonly priority = 700;

  private readonly options: SaveChatTaskOptions;

  constructor(options: SaveChatTaskOptions) {
    this.options = options;
  }

  condition(_context: DialoguePipelineContext): boolean {
    // 始终执行
    return true;
  }

  async execute(context: DialoguePipelineContext): Promise<void> {
    console.log(`[SaveChatTask] 保存聊天记录: messageCount=${this.options.messages.length}`);

    // 使用 setTimeout(0) 延迟保存，避免在状态更新过程中执行异步操作
    // （与现有 hooks 逻辑一致：L1517 setTimeout(() => saveChatToStore(...), 0)）
    setTimeout(() => {
      try {
        this.options.onSave(this.options.messages);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[SaveChatTask] 保存聊天记录失败: ${errMsg}`);
      }
    }, 0);

    context.logs.push({
      level: 'info',
      stage: 'LogicEngine',
      timestamp: Date.now(),
      message: `聊天记录保存已调度: ${this.options.messages.length} 条消息`,
    });
  }

  onError(error: Error, context: DialoguePipelineContext): void {
    console.error(`[SaveChatTask] 任务执行失败: ${error.message}`);
    context.logs.push({
      level: 'error',
      stage: 'LogicEngine',
      timestamp: Date.now(),
      message: `保存聊天记录任务失败: ${error.message}`,
    });
  }
}
