/**
 * 表达多样性诊断指标 — diversityMetrics
 *
 * Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 1
 *
 * 纯函数工具：对最近 N 条 assistant 回复计算 5 项客观指标，
 * 供 hooks.ts onComplete 运行时日志采集（基线建立与改造效果对比），
 * 不参与对话主流程决策，计算失败不影响任何功能。
 *
 * 指标定义：
 * 1. openingRepetitionRate — 开头句式重复率：某条回复剥离格式标记后的
 *    开头 4 字符与任一更早回复的开头 4 字符相同的比例
 * 2. distinct3 — 字符 3-gram 多样性：全部 3-gram 去重数 / 总数（0-1，越高越多样）
 * 3. structuralTemplateRate — 结构模板率：符合"动作开场 + 含对话 + 含动作描写"
 *    固定顺序的比例（*动作* "对话" *心理* 三板斧模板）
 * 4. crossTurnJaccard — 跨轮 Jaccard 均值：相邻回复字符 4-gram Jaccard 相似度的平均值
 * 5. actionPhraseConcentration — 高频动作短语集中度：top-5 星号短语出现次数占全部
 *    星号短语次数的比例（0-1，越高越单一）
 */

import { nGramJaccard } from './similarityUtils';

/** 指标计算的默认回溯窗口 */
export const DEFAULT_METRICS_WINDOW = 10;

/** 开头 4-gram 的字符数 */
const OPENING_GRAM_SIZE = 4;

/** distinct 指标的 n-gram 字符数 */
const DISTINCT_N = 3;

// ==================== 内部工具 ====================

/**
 * 剥离回复开头的格式标记（空白 / 星号 / 引号），返回"可见开头"文本。
 * 动作标记 * 与引号 " 「 属于格式噪音，句式指纹应基于实际文字。
 */
function stripLeadingFormatMarks(text: string): string {
  return text.replace(/^[\s*"「『“]+/, '');
}

/** 提取回复中全部星号包裹的动作短语（小写化、去空白） */
export function extractActionPhrases(reply: string): string[] {
  if (!reply) return [];
  const phrases: string[] = [];
  const pattern = /\*([^*\n]{2,}?)\*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(reply)) !== null) {
    const phrase = match[1].trim().toLowerCase();
    if (phrase) phrases.push(phrase);
  }
  return phrases;
}

/** 判断单条回复是否符合"动作开场 + 含对话 + 含动作"的固定结构模板 */
function isStructuralTemplate(reply: string): boolean {
  if (!reply) return false;
  const stripped = reply.replace(/^\s+/, '');
  const startsWithAction = stripped.startsWith('*');
  const hasDialogue = /"[^"]+"|「[^」]+」/.test(reply);
  const actionCount = (reply.match(/\*[^*\n]{2,}?\*/g) || []).length;
  // 动作开场 + 有对话 + 至少 2 处动作描写（动作-对话-动作交替模板）
  return startsWithAction && hasDialogue && actionCount >= 2;
}

// ==================== 指标函数 ====================

/**
 * 开头句式重复率：开头 4 字符与任一更早回复重合的回复占比。
 * 输入少于 2 条时无意义，返回 0。
 */
export function openingRepetitionRate(replies: string[]): number {
  if (replies.length < 2) return 0;
  const openings = replies.map(r => stripLeadingFormatMarks(r).slice(0, OPENING_GRAM_SIZE));
  let repeated = 0;
  for (let i = 1; i < openings.length; i++) {
    if (!openings[i]) continue;
    for (let j = 0; j < i; j++) {
      if (openings[j] && openings[j] === openings[i]) {
        repeated++;
        break;
      }
    }
  }
  // 分母为"可比较的回复数"（从第 2 条起）
  return repeated / (replies.length - 1);
}

/**
 * distinct-3：全部字符 3-gram 的去重比例（0-1）。
 * 空输入返回 0；单字符等极短文本按短 gram 处理。
 */
export function distinct3(replies: string[]): number {
  const text = replies.join('');
  if (text.length === 0) return 0;
  const total = Math.max(0, text.length - DISTINCT_N + 1);
  if (total === 0) return 0;
  const grams = new Set<string>();
  for (let i = 0; i <= text.length - DISTINCT_N; i++) {
    grams.add(text.slice(i, i + DISTINCT_N));
  }
  return grams.size / total;
}

/**
 * 结构模板率：符合"动作开场 + 含对话 + ≥2 处动作描写"固定模板的回复占比。
 */
export function structuralTemplateRate(replies: string[]): number {
  if (replies.length === 0) return 0;
  return replies.filter(isStructuralTemplate).length / replies.length;
}

/**
 * 跨轮 Jaccard 均值：相邻回复（时间顺序）4-gram Jaccard 的平均值。
 * 复用 similarityUtils.nGramJaccard（重试去重同款算法）。
 * 输入少于 2 条时返回 0。
 */
export function crossTurnJaccard(replies: string[]): number {
  if (replies.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < replies.length; i++) {
    sum += nGramJaccard(replies[i - 1], replies[i], 4);
  }
  return sum / (replies.length - 1);
}

/**
 * 高频动作短语集中度：top-5 星号短语次数占全部星号短语次数的比例。
 * 无动作短语时返回 0。
 */
export function actionPhraseConcentration(replies: string[]): number {
  const allPhrases = replies.flatMap(extractActionPhrases);
  if (allPhrases.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const p of allPhrases) {
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  const top5 = [...counts.values()].sort((a, b) => b - a).slice(0, 5);
  const topSum = top5.reduce((s, c) => s + c, 0);
  return topSum / allPhrases.length;
}

// ==================== 聚合报告 ====================

/** 多样性诊断报告 */
export interface DiversityReport {
  /** 参与统计的回复条数 */
  sampleSize: number;
  /** 开头句式重复率（0-1，目标 < 0.2） */
  openingRepetition: number;
  /** distinct-3（0-1，目标 > 0.55） */
  distinct3: number;
  /** 结构模板率（0-1，目标 < 0.4） */
  structuralTemplate: number;
  /** 跨轮 Jaccard 均值（0-1，目标 < 0.25） */
  crossTurnJaccard: number;
  /** 高频动作短语集中度（0-1，目标 < 0.35） */
  actionConcentration: number;
}

/**
 * 计算多样性诊断报告（聚合 5 项指标）。
 *
 * @param replies 按时间顺序排列的 assistant 回复（旧 → 新）
 * @param window 取末尾 N 条参与统计（默认 10）
 */
export function computeDiversityReport(replies: string[], window: number = DEFAULT_METRICS_WINDOW): DiversityReport {
  const sample = Array.isArray(replies) ? replies.slice(-window).filter(r => typeof r === 'string' && r.trim()) : [];
  return {
    sampleSize: sample.length,
    openingRepetition: openingRepetitionRate(sample),
    distinct3: distinct3(sample),
    structuralTemplate: structuralTemplateRate(sample),
    crossTurnJaccard: crossTurnJaccard(sample),
    actionConcentration: actionPhraseConcentration(sample),
  };
}

/**
 * 将报告格式化为单行日志文本（hooks.ts addLog 用）。
 */
export function formatDiversityReport(report: DiversityReport): string {
  return (
    `[Diversity] sample=${report.sampleSize} ` +
    `openingRep=${report.openingRepetition.toFixed(2)} ` +
    `distinct3=${report.distinct3.toFixed(2)} ` +
    `template=${report.structuralTemplate.toFixed(2)} ` +
    `crossJaccard=${report.crossTurnJaccard.toFixed(2)} ` +
    `actionConc=${report.actionConcentration.toFixed(2)}`
  );
}
