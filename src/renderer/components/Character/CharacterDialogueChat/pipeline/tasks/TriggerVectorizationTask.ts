/**
 * 逻辑任务 — TriggerVectorizationTask
 *
 * Spec: redesign-dialogue-pipeline-architecture / LogicEngine / TriggerVectorizationTask
 *
 * 每 5 轮对话（即 10 条 user+assistant 消息）自动触发增量向量化，
 * 为后续轮次的 RAG 检索积累向量数据。采用 fire-and-forget 模式。
 *
 * 对应当前逻辑：hooks onComplete 中 shouldTriggerIncrementalVectorize 判定后
 * 调用 window.electronAPI.chatHistory.vectorizeIncremental
 * （CharacterDialogueChat.hooks.ts L1555-L1603）
 *
 * Priority: 500
 */

import type { LogicTask, DialoguePipelineContext } from '../pipeline.types';

/** TriggerVectorizationTask 构造参数 */
export interface TriggerVectorizationTaskOptions {
  /** 聊天会话 ID（characterCardName 或 characterCardId） */
  chatId: string;
  /** 当前消息总数（含本轮 user+assistant 配对） */
  messageCount: number;
}

export class TriggerVectorizationTask implements LogicTask {
  readonly name = 'TriggerVectorizationTask';
  readonly priority = 500;

  private readonly options: TriggerVectorizationTaskOptions;

  constructor(options: TriggerVectorizationTaskOptions) {
    this.options = options;
  }

  condition(_context: DialoguePipelineContext): boolean {
    // 每 5 轮（10 条消息）触发一次增量向量化
    return this.options.messageCount > 0 && this.options.messageCount % 10 === 0;
  }

  async execute(context: DialoguePipelineContext): Promise<void> {
    const chatId = this.options.chatId;
    const messageCount = this.options.messageCount;

    console.log(`[TriggerVectorizationTask] 触发增量向量化: chatId=${chatId}, messageCount=${messageCount}`);

    // fire-and-forget：不 await，错误由 .catch 内部记录
    const chatHistoryApi = (window as any).electronAPI?.chatHistory;
    if (!chatHistoryApi) {
      console.warn('[TriggerVectorizationTask] electronAPI.chatHistory 不可用，跳过向量化');
      return;
    }

    // 构造最近消息列表供向量化使用
    // 从 messagesToSend 中提取最近 10 条消息
    const recentMessages = context.messagesToSend.slice(-10).map(msg => ({
      role: msg.role,
      content: msg.content,
      id: msg.id,
      name: msg.speakerName,
      timestamp: msg.timestamp,
    }));

    chatHistoryApi
      .vectorizeIncremental(chatId, recentMessages)
      .then(() => {
        console.log(`[TriggerVectorizationTask] 增量向量化完成: chatId=${chatId}`);
      })
      .catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[TriggerVectorizationTask] 增量向量化失败（fire-and-forget）: ${errMsg}`);
      });

    context.logs.push({
      level: 'info',
      stage: 'LogicEngine',
      timestamp: Date.now(),
      message: `增量向量化已触发（fire-and-forget）: chatId=${chatId}, messageCount=${messageCount}`,
    });
  }

  onError(error: Error, context: DialoguePipelineContext): void {
    console.error(`[TriggerVectorizationTask] 任务执行失败: ${error.message}`);
    context.logs.push({
      level: 'error',
      stage: 'LogicEngine',
      timestamp: Date.now(),
      message: `增量向量化任务失败: ${error.message}`,
    });
  }
}
