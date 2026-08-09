/**
 * 消息后处理管线 — PostProcessingPipeline
 *
 * Spec: redesign-dialogue-pipeline-architecture / PostProcessingPipeline
 *
 * 基于插件的消息后处理管线，替换原 onComplete 中的硬编码后处理序列。
 * 按 priority 顺序执行每个活跃插件，每个插件接收上一个插件处理后的内容。
 * 插件将解析结果写入 context 对应字段（emotion / options / tableEditCommands 等）。
 *
 * 执行流程：
 * 1. 获取所有已注册插件，按 priority 升序排列
 * 2. 依次调用 plugin.detect(content, context)
 *    - 返回 true 时调用 plugin.process(content, context)，用返回值更新 content
 *    - 返回 false 时跳过该插件
 * 3. 返回最终处理后的 content
 *
 * 异常处理：单个插件抛出异常时不中断管线，记录到 context.errors 后继续执行。
 */

import type {
  DialoguePipelineContext,
  PipelineError,
  PostProcessPlugin,
} from './pipeline.types';

export class PostProcessingPipeline {
  /** 已注册的插件列表 */
  private plugins: PostProcessPlugin[] = [];

  /**
   * 注册一个后处理插件。
   * 插件按 priority 升序执行（数值越小越先执行）。
   *
   * @param plugin 后处理插件实例
   */
  registerPlugin(plugin: PostProcessPlugin): void {
    this.plugins.push(plugin);
  }

  /**
   * 执行后处理管线。
   *
   * 按 priority 升序依次执行每个插件：
   * - detect 返回 true → 调用 process，用返回值更新 content
   * - detect 返回 false → 跳过
   * - process 抛出异常 → 记录到 context.errors，继续执行下一个插件
   *
   * @param content AI 响应原始内容
   * @param context 管线上下文（插件可读写其中的字段）
   * @returns 处理后的内容
   */
  execute(content: string, context: DialoguePipelineContext): string {
    // 按 priority 升序排列（数值越小越先执行）
    const sorted = [...this.plugins].sort((a, b) => a.priority - b.priority);

    let result = content;

    for (const plugin of sorted) {
      try {
        // 检测内容中是否存在该插件需要处理的标签/模式
        const shouldProcess = plugin.detect(result, context);
        if (!shouldProcess) continue;

        // 执行处理，用返回值更新 content
        const processed = plugin.process(result, context);
        if (typeof processed === 'string') {
          result = processed;
        }
      } catch (err) {
        // 单个插件异常不中断管线，记录错误后继续
        const error = err instanceof Error ? err : new Error(String(err));
        const pipelineError: PipelineError = {
          stage: `PostProcessPlugin:${plugin.name}`,
          message: error.message,
          stack: error.stack,
          isFatal: false,
        };
        context.errors.push(pipelineError);

        // 同时写入管线日志
        context.logs.push({
          level: 'error',
          stage: `PostProcessPlugin:${plugin.name}`,
          timestamp: Date.now(),
          message: `插件执行失败: ${error.message}`,
          data: { stack: error.stack },
        });
      }
    }

    return result;
  }
}
