/**
 * Stagger —— 防锁步抖动窗口（照抄 openclaw src/cron/stagger.ts）
 *
 * 来源：spec §二 Task 18.1（learning/stagger.ts）
 * 决策：照抄（spec §三表格明确：stagger.ts 照抄，纯逻辑、无外部依赖、直接可用）。
 *
 * 职责：
 *  1. resolveDefaultCronStaggerMs：对 top-of-hour recurring cron 自动应用 5 分钟抖动，
 *     防止所有用户/任务在整点同时触发（thundering herd）
 *  2. normalizeCronStaggerMs：规范化显式 stagger 配置（保留 0 表示「精确按计划执行」）
 *  3. resolveCronStaggerMs：合并显式与默认（显式优先）
 *
 * 与 cronScheduler 的关系：
 *  - cronScheduler 注册任务时，若未显式指定 staggerMs，对 top-of-hour cron 应用默认 5 分钟
 *  - 实际下次执行时间 = nextRun + random(0, staggerMs)，避免多任务同时触发
 *
 * 设计约束（openclaw stagger.ts 原则）：
 *  - 仅对 recurring top-of-hour cron 应用默认 stagger（如 "0 * * * *"）
 *  - 显式 staggerMs=0 表示「精确执行」（用户主动选择不抖动）
 *  - 显式配置优先于默认
 */

// ==================== 常量 ====================

/**
 * Top-of-hour recurring cron 的默认抖动窗口（照抄 openclaw DEFAULT_TOP_OF_HOUR_STAGGER_MS）。
 *
 * 5 分钟窗口：nextRun + random(0, 5min)，将整点任务分散到 [整点, 整点+5min]。
 */
export const DEFAULT_TOP_OF_HOUR_STAGGER_MS = 5 * 60 * 1000;

// ==================== Cron 表达式解析（精简版） ====================

/**
 * 解析 cron 表达式为字段数组。
 *
 * 支持 5 字段（min hour day month weekday）或 6 字段（sec min hour day month weekday）。
 */
function parseCronFields(expr: string): string[] {
  return expr.trim().split(/\s+/).filter(Boolean);
}

/**
 * Hour 字段合法部分：数字 / 数字范围 / 步长 / 通配符。
 */
const HOUR_LIST_PART = /^(?:\d+|\d+-\d+)(?:\/\d+)?$|^[*?](?:\/\d+)?$/;

/**
 * 判断 hour 字段是否含通配符（* / ?），即「recurring」。
 */
function hasRecurringWildcardHour(field: string): boolean {
  const parts = field.split(',');
  return (
    parts.every((part) => HOUR_LIST_PART.test(part)) &&
    parts.some((part) => part.startsWith('*') || part.startsWith('?'))
  );
}

/**
 * 判断 cron 表达式是否为 top-of-hour recurring。
 *
 * 即：minute=0 且 hour 含通配符（如 "0 * * * *" / "0 0,12 * * *" 不算，因 hour 无通配）。
 *
 * 仅对这类表达式应用默认 5 分钟 stagger，防止整点 thundering herd。
 */
function isRecurringTopOfHourCronExpr(expr: string): boolean {
  const fields = parseCronFields(expr);
  if (fields.length === 5) {
    const [minuteField, hourField] = fields;
    return (
      minuteField === '0' &&
      !!hourField &&
      hasRecurringWildcardHour(hourField)
    );
  }
  if (fields.length === 6) {
    const [secondField, minuteField, hourField] = fields;
    return (
      secondField === '0' &&
      minuteField === '0' &&
      !!hourField &&
      hasRecurringWildcardHour(hourField)
    );
  }
  return false;
}

// ==================== Stagger 规范化 ====================

/**
 * 解析严格非负整数（照抄 openclaw parseStrictNonNegativeInteger 精简版）。
 *
 * 仅接受十进制数字字符串，拒绝 hex/exponent/小数。
 */
function parseStrictNonNegativeInteger(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) {
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < 0) {
    return undefined;
  }
  return n;
}

/**
 * 规范化显式 stagger 值。
 *
 * 照抄 openclaw normalizeCronStaggerMs：
 *  - number 直接用（需非负整数）
 *  - string 解析为非负整数
 *  - 0 保留（表示「精确按计划执行」，用户主动选择不抖动）
 *  - 无效值返回 undefined（让调用方走默认逻辑）
 */
export function normalizeCronStaggerMs(raw: unknown): number | undefined {
  const numeric =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? (parseStrictNonNegativeInteger(raw) ?? Number.NaN)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  const normalized = Math.max(0, Math.floor(numeric));
  return Number.isSafeInteger(normalized) ? normalized : undefined;
}

// ==================== Stagger 解析 ====================

/**
 * 返回 top-of-hour recurring cron 的默认 stagger（5 分钟）。
 *
 * 非 top-of-hour 表达式返回 undefined（不应用默认）。
 */
export function resolveDefaultCronStaggerMs(expr: string): number | undefined {
  return isRecurringTopOfHourCronExpr(expr) ? DEFAULT_TOP_OF_HOUR_STAGGER_MS : undefined;
}

/**
 * Cron 调度配置子集（仅取 stagger 相关字段）。
 */
export interface CronStaggerSchedule {
  kind: 'cron';
  /** Cron 表达式 */
  expr?: string;
  /** 显式 stagger 毫秒（可选） */
  staggerMs?: unknown;
}

/**
 * 解析有效 stagger（显式优先，回退到默认）。
 *
 * 照抄 openclaw resolveCronStaggerMs：
 *  1. 若显式指定 staggerMs（包括 0），使用显式值
 *  2. 否则若是 top-of-hour recurring，使用默认 5 分钟
 *  3. 否则返回 0（不抖动）
 */
export function resolveCronStaggerMs(schedule: CronStaggerSchedule): number {
  const explicit = normalizeCronStaggerMs(schedule.staggerMs);
  if (explicit !== undefined) {
    return explicit;
  }
  const expr = typeof schedule.expr === 'string' ? schedule.expr : '';
  return resolveDefaultCronStaggerMs(expr) ?? 0;
}

// ==================== 随机抖动应用 ====================

/**
 * 应用 stagger 抖动到下次执行时间。
 *
 * @param nextRunAtMs 原始下次执行时间
 * @param staggerMs 抖动窗口毫秒
 * @param randomFn 随机数生成器（默认 Math.random，测试可注入）
 * @returns 抖动后的执行时间，落在 [nextRunAtMs, nextRunAtMs + staggerMs]
 */
export function applyStaggerJitter(
  nextRunAtMs: number,
  staggerMs: number,
  randomFn: () => number = Math.random
): number {
  if (staggerMs <= 0) {
    return nextRunAtMs;
  }
  const jitter = Math.floor(randomFn() * staggerMs);
  return nextRunAtMs + jitter;
}
