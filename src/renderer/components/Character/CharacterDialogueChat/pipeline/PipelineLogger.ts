/**
 * 分级日志系统 — PipelineLogger
 *
 * Spec: redesign-dialogue-pipeline-architecture / PipelineLogger
 *
 * 覆盖管线全生命周期的调试信息、性能指标和错误追踪。
 * 日志条目写入构造函数传入的数组（即 context.logs），
 * 支持通过 trace 方法自动记录 Stage 执行耗时。
 */

import type {
  LogLevel,
  PipelineLogEntry,
  PipelineMetrics,
} from './pipeline.types';

export class PipelineLogger {
  /** 日志条目数组引用（通常为 context.logs） */
  private entries: PipelineLogEntry[];

  /**
   * 构造函数。
   * @param entries 日志条目数组，通常传入 context.logs
   */
  constructor(entries: PipelineLogEntry[]) {
    this.entries = entries;
  }

  /**
   * 记录 debug 级别日志。
   */
  debug(stage: string, message: string, data?: unknown): void {
    this.push('debug', stage, message, data);
  }

  /**
   * 记录 info 级别日志。
   */
  info(stage: string, message: string, data?: unknown): void {
    this.push('info', stage, message, data);
  }

  /**
   * 记录 warn 级别日志。
   */
  warn(stage: string, message: string, data?: unknown): void {
    this.push('warn', stage, message, data);
  }

  /**
   * 记录 error 级别日志。
   */
  error(stage: string, message: string, data?: unknown): void {
    this.push('error', stage, message, data);
  }

  /**
   * 性能追踪 — 包装异步函数，自动记录执行耗时。
   * 执行完成后推送一条带 duration 字段的 info 级别日志。
   *
   * @param stage Stage 名称
   * @param fn 被追踪的函数（同步或异步）
   * @returns 函数执行结果
   */
  async trace<T>(stage: string, fn: () => T | Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      return result;
    } finally {
      const duration = performance.now() - start;
      this.push('info', stage, `trace 完成`, undefined, duration);
    }
  }

  /**
   * 获取当前管线的全部日志条目。
   */
  getEntries(): PipelineLogEntry[] {
    return this.entries;
  }

  /**
   * 获取性能指标摘要 — 从日志条目中聚合计算。
   * totalDuration 为所有带 duration 的 trace 条目耗时之和；
   * stageDurations 为各 Stage 的 trace 耗时之和；
   * stageCounts 为各 Stage 的日志条目总数。
   */
  getMetrics(): PipelineMetrics {
    const stageDurations: Record<string, number> = {};
    const stageCounts: Record<string, number> = {};
    let totalDuration = 0;

    for (const entry of this.entries) {
      // 统计各 Stage 日志条目数
      stageCounts[entry.stage] = (stageCounts[entry.stage] ?? 0) + 1;

      // 聚合 trace 耗时
      if (typeof entry.duration === 'number') {
        stageDurations[entry.stage] = (stageDurations[entry.stage] ?? 0) + entry.duration;
        totalDuration += entry.duration;
      }
    }

    return {
      totalDuration,
      stageDurations,
      stageCounts,
    };
  }

  /**
   * 内部方法 — 推送一条日志条目到 entries 数组。
   */
  private push(
    level: LogLevel,
    stage: string,
    message: string,
    data?: unknown,
    duration?: number,
  ): void {
    const entry: PipelineLogEntry = {
      level,
      stage,
      timestamp: Date.now(),
      message,
    };
    if (data !== undefined) {
      entry.data = data;
    }
    if (duration !== undefined) {
      entry.duration = duration;
    }
    this.entries.push(entry);
  }
}
