/**
 * 【Phase 2 / M2 - conversation-mode-optimization-report】图片生成阶段耗时统计。
 *
 * 为每个阶段维护 EMA（指数移动平均）耗时，供 ImageStageProgress 显示
 * "预计≈ Ns"。纯内存统计（页面刷新即重置），无持久化。
 *
 * 使用约定：同一时间仅一个图片生成进行中（generatingMessageIdRef 单一），
 * 故跟踪器内部只维护"当前活跃阶段"；enter 新阶段时自动结算上一阶段耗时。
 */
import type { TraitPromptPhase } from '../../../services/characterChatService';

const EMA_ALPHA = 0.3;
const durations: Partial<Record<TraitPromptPhase, number>> = {};
let activePhase: TraitPromptPhase | null = null;
let activeSince = 0;

function recordElapsed(): void {
  if (!activePhase || activeSince === 0) return;
  const elapsed = (Date.now() - activeSince) / 1000;
  activeSince = 0;
  if (elapsed <= 0) return;
  const prev = durations[activePhase];
  durations[activePhase] = prev == null ? elapsed : prev * (1 - EMA_ALPHA) + elapsed * EMA_ALPHA;
}

/** 进入新阶段：自动结算上一阶段耗时并开始计时 */
export function trackPhaseEnter(phase: TraitPromptPhase): void {
  if (activePhase !== phase) {
    recordElapsed();
    activePhase = phase;
    activeSince = Date.now();
  }
}

/** 生成结束（成功/失败/异常）：结算当前阶段耗时并清空 */
export function trackPhaseFinish(): void {
  recordElapsed();
  activePhase = null;
  activeSince = 0;
}

/** 返回指定阶段的预计耗时（秒，四舍五入，最小 1 秒）；无历史统计时返回 null */
export function getPhaseEstimateSeconds(phase: TraitPromptPhase): number | null {
  const d = durations[phase];
  return d == null ? null : Math.max(1, Math.round(d));
}
