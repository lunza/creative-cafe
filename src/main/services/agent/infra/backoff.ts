/**
 * 退避策略（Backoff）—— 照抄 openclaw packages/retry/src/index.ts 核心逻辑
 *
 * 来源：g:\AI\creative-cafe\sillytavern-source\openclaw-main\packages\retry\src\index.ts
 * 决策：照抄（spec §三）。纯逻辑、无外部依赖、直接可用。
 *
 * 职责：
 *  1. computeBackoff：按指数退避策略计算下一次重试延迟（含抖动）
 *  2. sleepWithAbort：可中止的 sleep（支持 AbortSignal，重试循环取消时立即 reject）
 *
 * 设计约束：
 *  - 不引入 openclaw 的 packages/retry 依赖链，仅保留核心算法
 *  - MAX_TIMER_TIMEOUT_MS = 2^31-1 ms（Node setTimeout 上限），防止超长延迟崩溃
 */

const MAX_TIMER_TIMEOUT_MS = 2_147_000_000;

/**
 * 退避策略配置
 */
export interface BackoffPolicy {
  /** 初始延迟（ms） */
  initialMs: number;
  /** 最大延迟上限（ms） */
  maxMs: number;
  /** 退避因子（指数基数，通常为 2） */
  factor: number;
  /** 抖动比例 [0, 1]，避免多客户端同步重试（thundering herd） */
  jitter: number;
}

/**
 * 按指数退避策略计算下一次重试延迟。
 *
 * 公式：base = min(maxMs, initialMs * factor^(attempt-1))
 *       delay = min(maxMs, round(base + base * jitter * random()))
 *
 * @param policy 退避策略
 * @param attempt 当前尝试次数（从 1 开始）
 * @returns 延迟毫秒数
 */
export function computeBackoff(policy: BackoffPolicy, attempt: number): number {
  const base = Math.min(
    policy.maxMs,
    policy.initialMs * policy.factor ** Math.max(attempt - 1, 0)
  );
  const jitter = base * policy.jitter * Math.random();
  return Math.min(policy.maxMs, Math.round(base + jitter));
}

/**
 * 可中止的 sleep。
 *
 * 在 ms 毫秒后 resolve；若 abortSignal 被触发则立即 reject（携带 abort reason）。
 * 用于重试循环中「等待下一次重试」阶段，支持用户主动取消。
 *
 * @param ms 等待毫秒数（<=0 立即 resolve，非有限数视为 0）
 * @param abortSignal 可选的中止信号
 * @param options.ref=false 时 timer.unref()，避免阻止 Node 退出
 */
export async function sleepWithAbort(
  ms: number,
  abortSignal?: AbortSignal,
  options: { ref?: boolean } = {}
): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }
  const delayMs = Math.min(Math.max(Math.floor(ms), 1), MAX_TIMER_TIMEOUT_MS);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => abortSignal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      cleanup();
      const abortError = new Error('aborted');
      (abortError as any).cause = (abortSignal as any)?.reason ?? new Error('aborted');
      reject(abortError);
    };
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    if (abortSignal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => {
      settled = true;
      cleanup();
      timer = null;
      resolve();
    }, delayMs);
    // 重试循环不应因 sleep 而阻止空闲进程退出
    if (options.ref === false) {
      (timer as any)?.unref?.();
    }
    if (abortSignal?.aborted) {
      onAbort();
    }
  });
}
