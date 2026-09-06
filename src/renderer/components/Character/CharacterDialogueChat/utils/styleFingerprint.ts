/**
 * 风格指纹与创意轮换 — styleFingerprint
 *
 * Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 3
 *
 * 防长程重复的"仅提示词层"防线（无额外生成成本）：
 * 1. extractStyleFingerprint — 从最近 N 条 assistant 回复提取句式指纹
 *    （开场类型 + 动作短语集合），纯前端计算 <10ms
 * 2. buildStyleAvoidancePrompt — 检测到重复信号时生成自然语言规避指令
 *    （描述性表述而非命令式，避免模型机械执行）
 * 3. buildCreativeRotationPrompt — 12 种表达策略轮换池，按 seed 选定注入，
 *    将"多样性"从被动惩罚转为主动引导
 *
 * seed 设计：末条用户消息哈希 + 重试次数 × 97。
 * - 跨轮变化：用户消息不同 → seed 不同
 * - 重试变化：dedupConfig.retryCount 递增 → seed 变化，避免坏指令重复
 */

import { extractActionPhrases } from './diversityMetrics';

/** 指纹提取的默认回溯窗口（最近 5 条 assistant 回复） */
export const STYLE_FINGERPRINT_WINDOW = 5;

/** 触发规避指令的最低 assistant 历史条数 */
const MIN_REPLIES_FOR_AVOIDANCE = 3;

/** 同类型开场占比阈值（≥3/5） */
const OPENING_TYPE_THRESHOLD = 0.6;

/** 动作短语重复次数阈值 */
const ACTION_PHRASE_REPEAT_THRESHOLD = 3;

// ==================== 类型定义 ====================

/** 回复开场类型 */
export type OpeningType = 'action' | 'dialogue' | 'narration';

/** 风格指纹 */
export interface StyleFingerprint {
  /** 各回复的开场类型（按时间顺序） */
  openingTypes: OpeningType[];
  /** 各回复的动作短语（小写化） */
  actionPhrases: string[];
}

// ==================== 指纹提取 ====================

/**
 * 判定单条回复的开场类型。
 * - action：以星号（动作/神态/心理标记）开头
 * - dialogue：以引号（英文/中文）开头
 * - narration：其他（直接叙述）
 */
export function detectOpeningType(reply: string): OpeningType {
  const stripped = reply.replace(/^\s+/, '');
  if (stripped.startsWith('*')) return 'action';
  if (/^["“「『]/.test(stripped)) return 'dialogue';
  return 'narration';
}

/**
 * 从最近 N 条 assistant 回复提取风格指纹。
 *
 * @param replies 按时间顺序排列的 assistant 回复（旧 → 新）
 */
export function extractStyleFingerprint(replies: string[]): StyleFingerprint {
  const valid = Array.isArray(replies)
    ? replies.filter(r => typeof r === 'string' && r.trim())
    : [];
  return {
    openingTypes: valid.map(detectOpeningType),
    actionPhrases: valid.flatMap(extractActionPhrases),
  };
}

// ==================== 规避指令 ====================

/** 开场类型的中文描述（用于生成自然语言指令） */
const OPENING_TYPE_LABEL: Record<OpeningType, string> = {
  action: '动作描写',
  dialogue: '对话',
  narration: '叙述',
};

/**
 * 构建风格规避指令。
 *
 * 触发条件（满足任一）：
 * 1. 同一开场类型占比 ≥ 60%（如 ≥3/5 条都以动作开场）
 * 2. 某动作短语出现 ≥3 次
 *
 * 无信号或样本不足时返回空串（不注入）。
 *
 * 措辞设计：描述性而非命令式（"你最近几次…这次不妨…"），
 * 避免模型把规避指令当作必须执行的硬规则反而生硬。
 */
export function buildStyleAvoidancePrompt(fingerprint: StyleFingerprint): string {
  const { openingTypes, actionPhrases } = fingerprint;
  if (openingTypes.length < MIN_REPLIES_FOR_AVOIDANCE) return '';

  const hints: string[] = [];

  // 信号 1：开场类型单一化
  const typeCounts = new Map<OpeningType, number>();
  for (const t of openingTypes) {
    typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
  }
  let dominantType: OpeningType | null = null;
  let dominantCount = 0;
  for (const [t, c] of typeCounts) {
    if (c > dominantCount) {
      dominantType = t;
      dominantCount = c;
    }
  }
  if (
    dominantType &&
    dominantCount / openingTypes.length >= OPENING_TYPE_THRESHOLD &&
    dominantCount >= 3
  ) {
    const label = OPENING_TYPE_LABEL[dominantType];
    const alternatives = (['action', 'dialogue', 'narration'] as OpeningType[])
      .filter(t => t !== dominantType)
      .map(t => OPENING_TYPE_LABEL[t])
      .join('、');
    hints.push(
      `你最近几次回复都以${label}开场，这次不妨换一种切入方式（${alternatives}），让开场更有变化。`
    );
  }

  // 信号 2：动作短语高重复
  const phraseCounts = new Map<string, number>();
  for (const p of actionPhrases) {
    phraseCounts.set(p, (phraseCounts.get(p) || 0) + 1);
  }
  const repeatedPhrases = [...phraseCounts.entries()]
    .filter(([, c]) => c >= ACTION_PHRASE_REPEAT_THRESHOLD)
    .sort((a, b) => b[1] - a[1]);
  if (repeatedPhrases.length > 0) {
    const phrase = repeatedPhrases[0][0];
    hints.push(
      `「${phrase}」这类表达你已经用过多次，换用更具体、更贴合当下情绪的描写。`
    );
  }

  if (hints.length === 0) return '';

  return `\n【表达提醒】\n${hints.join('\n')}`;
}

// ==================== 创意轮换 ====================

/**
 * 表达策略轮换池（12 种）。
 * 正向替代而非否定式规避——给模型一个"可以怎么做"的抓手。
 */
export const CREATIVE_ROTATION_POOL: readonly string[] = [
  '从一句直接的对话开始这次回复',
  '先描绘一个环境细节，再进入对话',
  '用短促的句子表现当下的急切或紧张',
  '让角色先沉默片刻再开口，用停顿制造张力',
  '从角色的一个具体感官体验切入（触觉、嗅觉或听觉）',
  '用一句内心独白开场',
  '让回复在一个未完成的动作处收尾，留出悬念',
  '对话中插入一次打断或自我修正，像真人说话那样',
  '用一个反问或俏皮的回应开场',
  '先写角色对眼前环境的反应，再回应对方',
  '让这次回复的节奏比平时更慢、更从容',
  '从一个出人意料的小动作开始',
];

/**
 * 简单字符串哈希（FNV-1a 32 位变体）。
 * 用于轮换 seed 生成，无密码学要求。
 */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 构建创意轮换指令。
 *
 * seed 需包含重试次数（调用方传入 `retryCount * 97`），
 * 确保去重重试时策略自动变化。
 *
 * @param seed 轮换种子（末条用户消息哈希 + 重试次数 × 97）
 * @returns 轮换指令文本（始终非空）
 */
export function buildCreativeRotationPrompt(seed: number): string {
  const strategy = CREATIVE_ROTATION_POOL[Math.abs(seed) % CREATIVE_ROTATION_POOL.length];
  return `\n【表达方式建议】这次回复可以尝试：${strategy}（仅供参考，以符合角色与当前情境为先）`;
}
