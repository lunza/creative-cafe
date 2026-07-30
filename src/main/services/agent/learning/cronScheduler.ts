/**
 * CronScheduler —— ILearningScheduler 实现（轻量自研 + pacing/stagger 防失控）
 *
 * 来源：spec §二 Task 18.1（learning/cronScheduler.ts）
 * 决策：适配（spec §三表格：schedule.ts 适配，本项目用轻量自研 cron 表达式解析）。
 *       openclaw 依赖 Croner，本项目按 OpenAI tool_calls 协议自研精简 cron。
 *
 * 职责：
 *  1. 实现 contracts.ts ILearningScheduler 接口
 *  2. 注册定时任务（cron 表达式 + pacing + stagger）→ 落库 cron_jobs 表
 *  3. setInterval(1s) 轮询 cron_jobs.next_run，到点触发任务
 *  4. pacing 钳位 + stagger 抖动（防失控 / 防锁步）
 *  5. 单实例守卫（全局一个 CronScheduler，避免重复调度）
 *
 * Cron 表达式支持子集（5 字段）：
 *  - minute (0-59)
 *  - hour (0-23)
 *  - day-of-month (1-31)
 *  - month (1-12)
 *  - day-of-week (0-6, 0=Sunday)
 *  - 每字段支持：星号 / 数字 / 逗号列表 / 范围 / 步长（如 0/5 表示每 5 分钟）
 *
 * 设计约束（openclaw pacing/stagger 规范）：
 *  - 任务执行后调用 resolvePacedNextRunAtMs 钳位下次执行时间
 *  - top-of-hour recurring cron 自动应用 5 分钟 stagger
 *  - 任务失败不立即重试，按 cron 表达式重新调度
 *  - allowConcurrent=false 时跳过仍在执行的任务（单实例守卫）
 */

import type { ILearningScheduler, ScheduleOptions } from '../contracts';
import type { AgentSqliteBackend } from '../memory/sqliteBackend';
import { toAgentError } from '../infra/errors';
import { resolvePacedNextRunAtMs } from './pacing';
import { resolveCronStaggerMs, applyStaggerJitter } from './stagger';

// ==================== 类型定义 ====================

/**
 * Cron 任务记录（对应 cron_jobs 表）。
 */
export interface CronJobRecord {
  id: string;
  label?: string;
  cronExpr: string;
  nextRun: number;
  lastRun?: number;
  lastStatus?: 'success' | 'failed' | 'skipped';
  lastError?: string;
  minIntervalMs?: number;
  staggerMs?: number;
  allowConcurrent: boolean;
  payload?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 任务回调（异步）。
 *
 * 回调返回的 nextDelayMs（可选）会被 pacing 钳位后作为下次执行的延迟建议
 * （照抄 openclaw：LLM 可主动提议下次执行时间，但被 pacing 钳位防失控）。
 */
export type CronTaskCallback = () => Promise<{ nextDelayMs?: number } | void>;

/**
 * 内部任务条目（注册时缓存回调，避免序列化）。
 */
interface InternalJobEntry {
  id: string;
  callback: CronTaskCallback;
  options: ScheduleOptions;
  /** 当前是否正在执行（allowConcurrent=false 时用于跳过） */
  running: boolean;
}

// ==================== Cron 表达式解析（精简版） ====================

/**
 * 解析 cron 字段为「匹配的数值集合」。
 *
 * 支持：
 *  - 星号 → 全部值
 *  - 星号/n → 步长（如 星号/5 表示每 5 分钟）
 *  - 数字
 *  - 逗号列表：1,5,10
 *  - 范围：1-5
 *  - 范围 + 步长：1-10/2
 *
 * @param field cron 字段字符串
 * @param min 字段最小值
 * @param max 字段最大值
 */
function parseCronField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  const parts = field.split(',').map((p) => p.trim());

  for (const part of parts) {
    if (part === '*' || part === '?') {
      for (let i = min; i <= max; i++) result.add(i);
      continue;
    }

    // 步长形式
    const stepMatch = part.match(/^(\*|\?|\d+(?:-\d+)?)\/(\d+)$/);
    if (stepMatch) {
      const rangePart = stepMatch[1];
      const step = Number(stepMatch[2]);
      let start: number, end: number;
      if (rangePart === '*' || rangePart === '?') {
        start = min;
        end = max;
      } else if (rangePart.includes('-')) {
        const [s, e] = rangePart.split('-').map(Number);
        start = s;
        end = e;
      } else {
        start = Number(rangePart);
        end = max;
      }
      for (let i = start; i <= end; i += step) {
        if (i >= min && i <= max) result.add(i);
      }
      continue;
    }

    // 范围形式
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      for (let i = start; i <= end; i++) {
        if (i >= min && i <= max) result.add(i);
      }
      continue;
    }

    // 单数字
    const num = Number(part);
    if (Number.isInteger(num) && num >= min && num <= max) {
      result.add(num);
      continue;
    }

    throw new Error(`invalid cron field part: ${part} (range ${min}-${max})`);
  }

  return result;
}

/**
 * Cron 表达式解析结果（5 字段集合）。
 */
export interface ParsedCronExpr {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
}

/**
 * 解析 5 字段 cron 表达式。
 *
 * @throws Error 如果格式错误
 */
export function parseCronExpression(expr: string): ParsedCronExpr {
  const fields = expr.trim().split(/\s+/).filter(Boolean);
  if (fields.length !== 5) {
    throw new Error(`cron expression must have 5 fields, got ${fields.length}: ${expr}`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return {
    minute: parseCronField(minute, 0, 59),
    hour: parseCronField(hour, 0, 23),
    dayOfMonth: parseCronField(dayOfMonth, 1, 31),
    month: parseCronField(month, 1, 12),
    dayOfWeek: parseCronField(dayOfWeek, 0, 6),
  };
}

/**
 * 计算从 fromMs 开始，下一个匹配 cron 表达式的时间戳。
 *
 * 算法：逐分钟向前搜索，最多搜索 366 天（避免死循环）。
 *
 * @param parsed 已解析的 cron 表达式
 * @param fromMs 起始时间戳（毫秒）
 * @returns 下次匹配时间戳（毫秒）
 */
export function getNextCronRunMs(parsed: ParsedCronExpr, fromMs: number): number {
  const from = new Date(fromMs);
  // 从下一分钟开始（秒清零）
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes() + 1, 0, 0);

  const maxIter = 366 * 24 * 60; // 最多搜索一年
  for (let i = 0; i < maxIter; i++) {
    const candidate = new Date(start.getTime() + i * 60 * 1000);
    if (
      parsed.minute.has(candidate.getMinutes()) &&
      parsed.hour.has(candidate.getHours()) &&
      parsed.dayOfMonth.has(candidate.getDate()) &&
      parsed.month.has(candidate.getMonth() + 1) &&
      parsed.dayOfWeek.has(candidate.getDay())
    ) {
      return candidate.getTime();
    }
  }
  // 一年内无匹配（异常 cron 表达式，如 2月30日）
  throw new Error(`no matching time within 1 year for cron expression`);
}

// ==================== CronScheduler 实现 ====================

/**
 * 学习调度器。
 *
 * 实现 ILearningScheduler 接口，照抄 openclaw pacing/stagger 理念。
 *
 * 生命周期：
 *  - start()：启动 setInterval 轮询（1 秒间隔）
 *  - stop()：清除 interval，不再触发新任务（正在执行的任务继续完成）
 *  - schedule()：注册任务（落库 + 缓存回调 + 计算 nextRun）
 *  - cancel()：取消任务（从库删除 + 从内存删除回调）
 *
 * 单实例守卫：全局一个 cronSchedulerInstance，避免重复调度同一任务。
 */
export class CronScheduler implements ILearningScheduler {
  private readonly backend: AgentSqliteBackend;
  private readonly jobs = new Map<string, InternalJobEntry>();
  private intervalHandle: NodeJS.Timeout | null = null;
  private started = false;
  /** 轮询间隔毫秒（默认 1 秒） */
  private readonly pollIntervalMs: number;
  /** 调度时钟函数（测试可注入） */
  private readonly nowFn: () => number;

  constructor(config: {
    backend: AgentSqliteBackend;
    pollIntervalMs?: number;
    nowFn?: () => number;
  }) {
    this.backend = config.backend;
    this.pollIntervalMs = config.pollIntervalMs ?? 1000;
    this.nowFn = config.nowFn ?? Date.now;
  }

  // ==================== 生命周期 ====================

  /**
   * 启动调度器。
   *
   * 启动后每秒轮询 cron_jobs 表，触发到点任务。
   * 幂等：重复调用无副作用。
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.intervalHandle = setInterval(() => {
      this.tick().catch((err) => {
        console.warn('[CronScheduler] tick failed:', err);
      });
    }, this.pollIntervalMs);
    // unref：调度器不阻止进程退出
    if (typeof this.intervalHandle.unref === 'function') {
      this.intervalHandle.unref();
    }
  }

  /**
   * 停止调度器。
   *
   * 清除 interval，正在执行的任务继续完成（不强制中断）。
   * 内存中的任务回调保留（便于 restart），但 cron_jobs 表保留持久化记录。
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  // ==================== 任务注册 ====================

  /**
   * 注册定时任务。
   *
   * @param cron 5 字段 cron 表达式
   * @param task 任务回调
   * @param options 调度选项（label / minIntervalMs / staggerMs / allowConcurrent）
   * @returns 任务 ID
   */
  schedule(cron: string, task: CronTaskCallback, options?: ScheduleOptions): string {
    const id = generateJobId();
    const now = this.nowFn();

    // 解析 cron 表达式
    const parsed = parseCronExpression(cron);
    let nextRun = getNextCronRunMs(parsed, now);

    // 应用 stagger（top-of-hour recurring 自动 5 分钟）
    const staggerMs = resolveCronStaggerMs({ kind: 'cron', expr: cron, staggerMs: options?.staggerMs });
    nextRun = applyStaggerJitter(nextRun, staggerMs);

    // pacing 钳位（minIntervalMs 作为下界）
    if (options?.minIntervalMs) {
      const pacing = { min: `${options.minIntervalMs}ms` };
      nextRun = resolvePacedNextRunAtMs({
        nowMs: now,
        delayMs: nextRun - now,
        pacing,
      });
    }

    // 落库
    const job: CronJobRecord = {
      id,
      label: options?.label,
      cronExpr: cron,
      nextRun,
      minIntervalMs: options?.minIntervalMs,
      staggerMs,
      allowConcurrent: options?.allowConcurrent ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.persistJob(job);

    // 缓存回调
    this.jobs.set(id, {
      id,
      callback: task,
      options: options ?? {},
      running: false,
    });

    return id;
  }

  /**
   * 取消任务。
   */
  cancel(taskId: string): void {
    this.jobs.delete(taskId);
    try {
      const stmt = this.backend.prepare(`DELETE FROM cron_jobs WHERE id = ?`);
      stmt.run(taskId);
    } catch (err) {
      console.warn(`[CronScheduler] cancel failed for ${taskId}:`, err);
    }
  }

  /**
   * 获取待执行任务状态。
   */
  getPendingTasks(): Array<{ id: string; nextRun: number; label?: string }> {
    try {
      const stmt = this.backend.prepare(
        `SELECT id, label, next_run FROM cron_jobs ORDER BY next_run ASC`
      );
      const rows = stmt.all<{ id: string; label: string | null; next_run: number }>();
      return rows.map((r) => ({ id: r.id, nextRun: r.next_run, label: r.label ?? undefined }));
    } catch {
      return [];
    }
  }

  // ==================== Dreaming 触发 ====================

  /**
   * 手动触发 dreaming（短期→长期记忆摘要）。
   *
   * 不经过 cron 调度，直接调用 dreamingService。
   * 具体实现由 DreamingService 注入（构造时通过 setDreamingCallback）。
   */
  async dreamNow(sessionId?: string): Promise<void> {
    if (this.dreamingCallback) {
      try {
        await this.dreamingCallback(sessionId);
      } catch (err) {
        console.warn('[CronScheduler] dreamNow failed:', err);
      }
    }
  }

  /**
   * 注入 dreaming 回调（避免循环依赖：DreamingService 依赖 CronScheduler 注册定时任务，
   * CronScheduler 依赖 DreamingService 执行 dreamNow）。
   */
  setDreamingCallback(cb: (sessionId?: string) => Promise<void>): void {
    this.dreamingCallback = cb;
  }

  private dreamingCallback: ((sessionId?: string) => Promise<void>) | null = null;

  // ==================== 内部调度逻辑 ====================

  /**
   * 单次轮询：检查所有到点任务并触发。
   *
   * 算法：
   *  1. 查询 next_run <= now 的所有任务
   *  2. 对每个任务：
   *     - 若 running && !allowConcurrent → 标记 skipped，计算下次 nextRun
   *     - 否则标记 running=true，异步执行回调
   *     - 回调完成后：根据 nextDelayMs（可选）+ pacing 计算 nextRun，更新库
   */
  private async tick(): Promise<void> {
    if (!this.started) return;
    const now = this.nowFn();

    let dueJobs: CronJobRecord[];
    try {
      const stmt = this.backend.prepare(
        `SELECT * FROM cron_jobs WHERE next_run <= ? ORDER BY next_run ASC`
      );
      const rows = stmt.all<any>(now);
      dueJobs = rows.map(rowToCronJobRecord);
    } catch (err) {
      console.warn('[CronScheduler] query due jobs failed:', err);
      return;
    }

    for (const job of dueJobs) {
      const entry = this.jobs.get(job.id);
      if (!entry) {
        // 内存中无回调（可能是进程重启后未注册），删除库记录避免重复触发
        this.cancel(job.id);
        continue;
      }

      if (entry.running && !job.allowConcurrent) {
        // 仍在执行，跳过本次，下次再试
        this.updateJobStatus(job.id, 'skipped', undefined, this.computeNextRun(job, now));
        continue;
      }

      // 异步执行（不阻塞 tick）
      entry.running = true;
      this.executeJob(job, entry).catch((err) => {
        console.warn(`[CronScheduler] job ${job.id} execution failed:`, err);
      });
    }
  }

  /**
   * 执行单个任务。
   */
  private async executeJob(job: CronJobRecord, entry: InternalJobEntry): Promise<void> {
    let status: 'success' | 'failed' = 'success';
    let error: string | undefined;
    let nextDelayMs: number | undefined;

    try {
      const result = await entry.callback();
      nextDelayMs = result?.nextDelayMs;
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
    } finally {
      entry.running = false;
    }

    // 计算下次执行时间
    const now = this.nowFn();
    const nextRun = this.computeNextRun(job, now, nextDelayMs);
    this.updateJobStatus(job.id, status, error, nextRun);
  }

  /**
   * 计算下次执行时间。
   *
   * @param job 任务记录
   * @param now 当前时间
   * @param proposedDelayMs 回调提议的延迟（可选，被 pacing 钳位）
   */
  private computeNextRun(job: CronJobRecord, now: number, proposedDelayMs?: number): number {
    let nextRun: number;

    if (proposedDelayMs !== undefined) {
      // 回调主动提议延迟 → pacing 钳位
      const pacing: { min?: string; max?: string } = {};
      if (job.minIntervalMs) pacing.min = `${job.minIntervalMs}ms`;
      nextRun = resolvePacedNextRunAtMs({
        nowMs: now,
        delayMs: proposedDelayMs,
        pacing,
      });
    } else {
      // 按 cron 表达式计算
      try {
        const parsed = parseCronExpression(job.cronExpr);
        nextRun = getNextCronRunMs(parsed, now);
        // 应用 stagger
        nextRun = applyStaggerJitter(nextRun, job.staggerMs ?? 0);
      } catch {
        // cron 解析失败（不应发生），1 小时后重试
        nextRun = now + 60 * 60 * 1000;
      }
    }

    // pacing 下界（minIntervalMs）
    if (job.minIntervalMs) {
      const minNext = now + job.minIntervalMs;
      if (nextRun < minNext) nextRun = minNext;
    }

    return nextRun;
  }

  // ==================== 持久化辅助 ====================

  private persistJob(job: CronJobRecord): void {
    try {
      const stmt = this.backend.prepare(
        `INSERT INTO cron_jobs (id, label, cron_expr, next_run, last_run, last_status, last_error,
          min_interval_ms, stagger_ms, allow_concurrent, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      stmt.run(
        job.id,
        job.label ?? null,
        job.cronExpr,
        job.nextRun,
        job.lastRun ?? null,
        job.lastStatus ?? null,
        job.lastError ?? null,
        job.minIntervalMs ?? null,
        job.staggerMs ?? null,
        job.allowConcurrent ? 1 : 0,
        job.payload ?? null,
        job.createdAt,
        job.updatedAt
      );
    } catch (err) {
      throw toAgentError(err, `CronScheduler.persistJob failed for ${job.id}`);
    }
  }

  private updateJobStatus(
    id: string,
    status: 'success' | 'failed' | 'skipped',
    error: string | undefined,
    nextRun: number
  ): void {
    try {
      const now = this.nowFn();
      const stmt = this.backend.prepare(
        `UPDATE cron_jobs
         SET last_run = ?, last_status = ?, last_error = ?, next_run = ?, updated_at = ?
         WHERE id = ?`
      );
      stmt.run(now, status, error ?? null, nextRun, now, id);
    } catch (err) {
      console.warn(`[CronScheduler] updateJobStatus failed for ${id}:`, err);
    }
  }
}

// ==================== 工具函数 ====================

/**
 * 将数据库行转换为 CronJobRecord。
 */
function rowToCronJobRecord(row: any): CronJobRecord {
  return {
    id: row.id,
    label: row.label ?? undefined,
    cronExpr: row.cron_expr,
    nextRun: row.next_run,
    lastRun: row.last_run ?? undefined,
    lastStatus: row.last_status ?? undefined,
    lastError: row.last_error ?? undefined,
    minIntervalMs: row.min_interval_ms ?? undefined,
    staggerMs: row.stagger_ms ?? undefined,
    allowConcurrent: row.allow_concurrent === 1,
    payload: row.payload ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

let jobCounter = 0;
function generateJobId(): string {
  jobCounter += 1;
  return `cron_${Date.now()}_${jobCounter}`;
}

// ==================== 单例 ====================

let schedulerInstance: CronScheduler | null = null;

/**
 * 获取 CronScheduler 单例。
 *
 * 首次调用需传入 config，后续调用可省略。
 */
export function getCronScheduler(config?: {
  backend: AgentSqliteBackend;
  pollIntervalMs?: number;
}): CronScheduler {
  if (!schedulerInstance && config) {
    schedulerInstance = new CronScheduler(config);
  }
  if (!schedulerInstance) {
    throw new Error('CronScheduler not initialized. Call getCronScheduler(config) first.');
  }
  return schedulerInstance;
}

/**
 * 重置单例（仅测试用）。
 */
export function resetCronScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.stop();
    schedulerInstance = null;
  }
}
