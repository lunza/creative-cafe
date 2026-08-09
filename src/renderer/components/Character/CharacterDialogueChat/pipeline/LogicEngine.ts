/**
 * 逻辑执行引擎 — LogicEngine
 *
 * Spec: redesign-dialogue-pipeline-architecture / LogicEngine
 *
 * 负责在后处理管线（PostProcessingPipeline）完成后，按优先级顺序执行所有
 * 条件满足的 LogicTask，调度副作用（UI 更新、存储保存、向量化触发等）。
 *
 * 设计原则：
 * - 任务按 priority 升序排列（数值越小越先执行）
 * - 每个任务独立 try-catch，单个任务失败不阻塞其他任务
 * - 所有任务顺序执行（非并行），保证状态可预测
 * - 失败任务通过 onError 回调处理并记录日志
 */

import type { LogicTask, DialoguePipelineContext } from './pipeline.types';

export class LogicEngine {
  /** 已注册的逻辑任务列表 */
  private tasks: LogicTask[] = [];

  /**
   * 注册一个逻辑任务。
   * 任务按 priority 排序，数值越小优先级越高。
   * @param task 要注册的逻辑任务
   */
  registerTask(task: LogicTask): void {
    this.tasks.push(task);
    // 按 priority 升序排序（数值越小越先执行）
    this.tasks.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 执行所有已注册的逻辑任务。
   *
   * 遍历按 priority 排序的任务列表，对每个任务：
   * 1. 检查 condition(context) 是否满足
   * 2. 满足则执行 execute(context)
   * 3. 执行过程中抛出的异常被捕获，调用 task.onError 或记录日志
   * 4. 单个任务失败不影响后续任务执行
   *
   * @param context 管线上下文
   */
  async execute(context: DialoguePipelineContext): Promise<void> {
    for (const task of this.tasks) {
      // 检查任务执行条件
      let shouldExecute = false;
      try {
        shouldExecute = task.condition(context);
      } catch (err) {
        // condition 本身抛异常时记录日志，不阻塞后续任务
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[LogicEngine] 任务 "${task.name}" condition 检查失败: ${errorMsg}`);
        context.logs.push({
          level: 'warn',
          stage: 'LogicEngine',
          timestamp: Date.now(),
          message: `任务 "${task.name}" condition 检查失败: ${errorMsg}`,
        });
        continue;
      }

      if (!shouldExecute) {
        continue;
      }

      // 执行任务（独立 try-catch，失败不阻塞其他任务）
      try {
        await task.execute(context);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));

        if (task.onError) {
          try {
            task.onError(error, context);
          } catch (onErrorErr) {
            // onError 自身抛异常时仅记录日志，避免级联失败
            const onErrMsg = onErrorErr instanceof Error ? onErrorErr.message : String(onErrorErr);
            console.error(`[LogicEngine] 任务 "${task.name}" onError 回调执行失败: ${onErrMsg}`);
          }
        } else {
          // 未定义 onError 时记录到 context.logs 和控制台
          console.warn(`[LogicEngine] 任务 "${task.name}" 执行失败: ${error.message}`);
        }

        // 将错误记录到管线上下文
        context.logs.push({
          level: 'warn',
          stage: 'LogicEngine',
          timestamp: Date.now(),
          message: `任务 "${task.name}" 执行失败: ${error.message}`,
          data: { taskName: task.name, error: error.message },
        });
      }
    }
  }
}
