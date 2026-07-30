/**
 * Pacing —— 防失控 pacing 钳位（照抄 openclaw src/cron/pacing.ts）
 *
 * 来源：spec §二 Task 18.1（learning/pacing.ts）
 * 决策：照抄（spec §三表格明确：pacing.ts 照抄，纯逻辑、无外部依赖、直接可用）。
 *
 * 职责：
 *  1. parseCronPacingBounds：校验 pacing 配置（min/max 必须 > 0，min ≤ max）
 *  2. resolvePacedNextRunAtMs：将一次成功运行的「提议下次执行时间」钳位到
 *     [now+min, now+max] 区间，防止单任务因外部延迟或 LLM 提议过短间隔而失控
 *
 * 设计约束（openclaw pacing.ts 原则）：
 *  - min/max 字符串形式（如 "5m" / "1h"），由 parseDurationMs 解析
 *  - 至少指定 min 或 max 之一
 *  - 钳位是任务局部的（per-job），不影响其他任务
 *
 * 与 cronScheduler 的关系：
 *  - cronScheduler 注册任务时可传 ScheduleOptions.minIntervalMs
 *  - LLM 主动提议下次执行时间时，cronScheduler 调用 resolvePacedNextRunAtMs 钳位
 *  - 钳位后的时间作为 next_run 写入 cron_jobs 表
 */

// ==================== 时间字符串解析 ====================

/**
 * 解析时长字符串为毫秒。
 *
 * 支持格式（与 openclaw parseDurationMs 兼容子集）：
 *  - "30s" / "5m" / "2h" / "1d"
 *  - "500ms"
 *  - 纯数字字符串视为毫秒
 *  - 复合："1h30m" / "2d4h"
 *
 * @throws Error 如果格式无效或结果非正数
 */
export function parseDurationMs(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`duration string is empty`);
  }

  // 纯数字 → 毫秒
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`duration must be positive: ${value}`);
    }
    return n;
  }

  // 复合格式：1h30m / 2d4h / 500ms
  // ⚠️ BUG 修复（Task 18.1 单元测试发现）：原正则 /^(\d+)(ms|s|m|h|d)/g 带 `^` 锚点，
  //   exec 第二次调用时 lastIndex 已前进到字符串中部，但 `^` 只匹配字符串开头，
  //   导致复合格式（如 '1h30m'）只能匹配第一段 '1h'，consumed=2 ≠ length=5 → 抛错。
  //   修复：去掉 `^` 锚点，让 exec 能从任意位置匹配下一段数字+单位。
  //   安全性：consumed !== trimmed.length 校验仍能拒绝含非法字符的输入（如 'abc1h'）。
  const pattern = /(\d+)(ms|s|m|h|d)/g;
  let total = 0;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = pattern.exec(trimmed)) !== null) {
    const num = Number(match[1]);
    const unit = match[2];
    switch (unit) {
      case 'ms':
        total += num;
        break;
      case 's':
        total += num * 1000;
        break;
      case 'm':
        total += num * 60 * 1000;
        break;
      case 'h':
        total += num * 60 * 60 * 1000;
        break;
      case 'd':
        total += num * 24 * 60 * 60 * 1000;
        break;
    }
    consumed += match[0].length;
  }

  if (consumed !== trimmed.length || total <= 0) {
    throw new Error(`invalid duration format: ${value}`);
  }
  return total;
}

// ==================== Pacing 类型与校验 ====================

/**
 * Pacing 配置（与 contracts.ts ScheduleOptions 对齐）。
 */
export interface CronPacing {
  /** 最小间隔（字符串形式：如 "5m" / "1h"） */
  min?: string;
  /** 最大间隔（字符串形式） */
  max?: string;
}

/**
 * Parsed positive pacing bounds.
 * 内部使用毫秒数，校验后供 resolvePacedNextRunAtMs 钳位使用。
 */
export type CronPacingBounds = {
  minMs?: number;
  maxMs?: number;
};

/**
 * 解析单个 pacing 字段为正毫秒数。
 *
 * @throws Error 如果值无效或非正
 */
function parsePositivePacingDuration(value: string, field: 'min' | 'max'): number {
  let durationMs: number;
  try {
    durationMs = parseDurationMs(value);
  } catch {
    throw new Error(`cron pacing ${field} must be a positive duration: ${value}`);
  }
  if (durationMs <= 0) {
    throw new Error(`cron pacing ${field} must be a positive duration: ${value}`);
  }
  return durationMs;
}

/**
 * 校验 pacing 配置并返回毫秒边界。
 *
 * @throws Error 如果 min/max 都未指定，或 min > max
 */
export function parseCronPacingBounds(pacing: CronPacing): CronPacingBounds {
  if (pacing.min === undefined && pacing.max === undefined) {
    throw new Error('cron pacing requires at least one of min or max');
  }
  const minMs =
    pacing.min === undefined ? undefined : parsePositivePacingDuration(pacing.min, 'min');
  const maxMs =
    pacing.max === undefined ? undefined : parsePositivePacingDuration(pacing.max, 'max');
  if (minMs !== undefined && maxMs !== undefined && minMs > maxMs) {
    throw new Error(`cron pacing min must not exceed max: min=${pacing.min} max=${pacing.max}`);
  }
  return { minMs, maxMs };
}

// ==================== 钳位逻辑 ====================

/**
 * 将一次成功运行的「提议下次执行时间」钳位到 pacing 边界。
 *
 * 照抄 openclaw resolvePacedNextRunAtMs：
 *  - proposedAtMs = nowMs + delayMs（LLM 或外部提议的延迟）
 *  - 钳位到 [nowMs + minMs, nowMs + maxMs]
 *  - 若 maxMs 未指定，仅钳位下界；若 minMs 未指定，仅钳位上界
 *
 * @example
 * // 任务提议 1 分钟后再跑，但 pacing 要求至少 5 分钟
 * const next = resolvePacedNextRunAtMs({
 *   nowMs: Date.now(),
 *   delayMs: 60_000,
 *   pacing: { min: '5m' },
 * });
 * // → next = nowMs + 300_000（被钳位到 min）
 *
 * @example
 * // 任务提议 1 小时后再跑，但 pacing 限制最多 30 分钟
 * const next = resolvePacedNextRunAtMs({
 *   nowMs: Date.now(),
 *   delayMs: 60 * 60 * 1000,
 *   pacing: { max: '30m' },
 * });
 * // → next = nowMs + 30 * 60 * 1000（被钳位到 max）
 */
export function resolvePacedNextRunAtMs(params: {
  nowMs: number;
  delayMs: number;
  pacing: CronPacing;
}): number {
  const { minMs, maxMs } = parseCronPacingBounds(params.pacing);
  const proposedAtMs = params.nowMs + params.delayMs;
  const lowerBound = params.nowMs + (minMs ?? 0);
  const upperBound =
    maxMs === undefined ? Number.POSITIVE_INFINITY : params.nowMs + maxMs;
  return Math.min(upperBound, Math.max(lowerBound, proposedAtMs));
}
