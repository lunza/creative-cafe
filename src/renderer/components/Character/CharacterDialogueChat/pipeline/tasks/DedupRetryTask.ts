/**
 * 逻辑任务 — DedupRetryTask
 *
 * Spec: redesign-dialogue-pipeline-architecture / LogicEngine / DedupRetryTask
 *
 * 当去重检测判定需要重试时（n-gram jaccard > 0.8 或续写重叠率 > 0.6），
 * 触发 AI 请求重试。最多重试 maxRetries 次，超过后接受当前结果。
 *
 * 对应当前逻辑：hooks onComplete 中 shouldDedupRetry 判定后
 * 重新调用 requestAIResponse（CharacterDialogueChat.hooks.ts L1442-L1467）
 *
 * Priority: 600
 */

import type { LogicTask, DialoguePipelineContext } from '../pipeline.types';

/** DedupRetryTask 构造参数 */
export interface DedupRetryTaskOptions {
  /** 重试回调 — 由集成层（Task 13/14）接入 AI 请求重新生成 */
  onRetry: () => void;
  /** 最大重试次数（spec 约定默认 2 次） */
  maxRetries: number;
}

export class DedupRetryTask implements LogicTask {
  readonly name = 'DedupRetryTask';
  readonly priority = 600;

  private readonly options: DedupRetryTaskOptions;

  constructor(options: DedupRetryTaskOptions) {
    this.options = options;
  }

  condition(context: DialoguePipelineContext): boolean {
    // 去重检测结果存在且需要重试
    return context.dedupInfo !== null && context.dedupInfo.needRetry;
  }

  async execute(context: DialoguePipelineContext): Promise<void> {
    const dedupInfo = context.dedupInfo!;

    // 已重试耗尽时不再触发重试
    if (dedupInfo.exhausted) {
      console.warn(`[DedupRetryTask] 去重重试已耗尽（maxRetries=${this.options.maxRetries}），接受当前结果。原因: ${dedupInfo.reason}`);
      context.logs.push({
        level: 'warn',
        stage: 'LogicEngine',
        timestamp: Date.now(),
        message: `去重重试已耗尽，接受当前结果。原因: ${dedupInfo.reason}`,
      });
      return;
    }

    console.log(`[DedupRetryTask] 触发去重重试: kind=${dedupInfo.kind}, metric=${dedupInfo.metric.toFixed(3)}, maxRetries=${this.options.maxRetries}`);

    context.logs.push({
      level: 'info',
      stage: 'LogicEngine',
      timestamp: Date.now(),
      message: `去重重试触发: kind=${dedupInfo.kind}, metric=${dedupInfo.metric.toFixed(3)}`,
    });

    // 调用重试回调 — 由集成层负责重新触发 AI 请求 + 后处理管线
    this.options.onRetry();
  }

  onError(error: Error, context: DialoguePipelineContext): void {
    console.error(`[DedupRetryTask] 去重重试任务失败: ${error.message}`);
    context.logs.push({
      level: 'error',
      stage: 'LogicEngine',
      timestamp: Date.now(),
      message: `去重重试任务失败: ${error.message}`,
    });
  }
}
