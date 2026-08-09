/**
 * Pipeline 核心框架
 *
 * Spec: redesign-dialogue-pipeline-architecture / Pipeline 核心框架
 *
 * 基于 Middleware 模式的 Pipeline，作为所有对话处理的统一执行引擎。
 * 按 PrePipeline → AIService → PostPipeline → LogicEngine 顺序执行各 Stage，
 * 每个 Stage 接收 Context 对象，执行处理后传递给下一个 Stage。
 * 非致命错误不中断管线，致命错误中断并重新抛出。
 */

import type {
  DialoguePipelineContext,
  PipelineError,
  StageFunction,
} from './pipeline.types';
import type { PipelineLogger } from './PipelineLogger';

/**
 * Stage 定义 — 名称与执行函数的组合。
 */
interface StageDefinition {
  /** Stage 名称 */
  name: string;
  /** Stage 执行函数 */
  fn: StageFunction;
}

/**
 * 可携带 isFatal 标记的错误对象。
 * Stage 函数可通过抛出含 isFatal: false 的错误来表示非致命错误。
 */
interface ThrowableWithErrorFlag extends Error {
  isFatal?: boolean;
}

export class Pipeline {
  /** Pipeline 名称 */
  readonly name: string;
  /** 有序 Stage 列表 */
  private stages: StageDefinition[] = [];

  /**
   * 构造函数。
   * @param name Pipeline 名称（如 'dialogue'、'polish'）
   */
  constructor(name: string) {
    this.name = name;
  }

  /**
   * 注册一个 Stage。
   * Stage 按注册顺序执行。
   *
   * @param name Stage 名称
   * @param fn Stage 执行函数
   */
  addStage(name: string, fn: StageFunction): void {
    this.stages.push({ name, fn });
  }

  /**
   * 执行所有 Stage。
   *
   * - 按 stages 数组顺序依次执行
   * - 每个 Stage 接收 context 对象
   * - Stage 抛出异常时由框架捕获：
   *   - 非致命错误（isFatal: false）：记录到 context.errors 和 logger.error()，继续执行
   *   - 致命错误（isFatal: true 或未标记）：记录到 context.errors 和 logger.error()，中断并重新抛出
   *
   * @param context 管线上下文
   * @param logger 管线日志记录器
   */
  async execute(
    context: DialoguePipelineContext,
    logger: PipelineLogger,
  ): Promise<void> {
    for (const stage of this.stages) {
      try {
        await stage.fn(context);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const isFatal = (error as ThrowableWithErrorFlag).isFatal !== false;

        // 构建管线错误记录
        const pipelineError: PipelineError = {
          stage: stage.name,
          message: error.message,
          stack: error.stack,
          isFatal,
        };
        context.errors.push(pipelineError);

        // 记录错误日志
        logger.error(stage.name, `Stage 执行失败: ${error.message}`, {
          isFatal,
          stack: error.stack,
        });

        // 致命错误中断管线
        if (isFatal) {
          throw error;
        }
        // 非致命错误继续执行下一个 Stage
      }
    }
  }
}
