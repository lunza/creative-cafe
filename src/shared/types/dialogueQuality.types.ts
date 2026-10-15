/**
 * 【Phase 4 / L4 - conversation-mode-optimization-report】对话质量检查与人设一致性检查类型。
 *
 * 参考实现：写作模式 V2PlotCheckPanel + PlotCheckerService（多维度评分 + 问题清单 + 自动修正）。
 * 对话模式将「章节」替换为「对话轮次」，「剧情检查」替换为「人设一致性检查」。
 */

/** 对话质量检查维度 */
export enum DialogueQualityDimension {
  /** 人设一致性（OOC 检测）：角色语言风格、性格、身份行为是否与角色卡设定一致 */
  CHARACTER_CONSISTENCY = 'character_consistency',
  /** 对话逻辑连贯性：剧情推进、时间线、角色状态、物品/经济状态是否前后一致 */
  DIALOGUE_COHERENCE = 'dialogue_coherence',
  /** 情感表达合理性：情绪变化是否有触发依据、情绪强度与情境是否匹配 */
  EMOTION_EXPRESSIVENESS = 'emotion_expressiveness',
}

export const DIALOGUE_QUALITY_DIMENSION_LABELS: Record<DialogueQualityDimension, string> = {
  [DialogueQualityDimension.CHARACTER_CONSISTENCY]: '人设一致性',
  [DialogueQualityDimension.DIALOGUE_COHERENCE]: '对话连贯性',
  [DialogueQualityDimension.EMOTION_EXPRESSIVENESS]: '情感表达合理性',
};

/** 问题严重等级 */
export type DialogueQualitySeverity = 'high' | 'medium' | 'low';

export const DIALOGUE_QUALITY_SEVERITY_LABELS: Record<DialogueQualitySeverity, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

/** 单维度评分 */
export interface DialogueQualityDimensionScore {
  dimension: DialogueQualityDimension;
  /** 0-100 分 */
  score: number;
  comment: string;
}

/** 单个质量问题 */
export interface DialogueQualityIssue {
  /** 稳定 ID（检查时生成），用于修正请求定位 */
  id: string;
  dimension: DialogueQualityDimension;
  severity: DialogueQualitySeverity;
  title: string;
  description: string;
  /** 涉及的消息 ID 列表（可空，表示全局性问题） */
  messageIds: string[];
  /** 问题原文摘录（来自对话内容，修正时的 originalText 基准） */
  quote: string;
  /** 修正建议（文字说明） */
  suggestion: string;
  /** 是否支持 AI 自动修正（定位到具体消息时为 true） */
  fixable: boolean;
}

/** 对话质量检查报告 */
export interface DialogueQualityReport {
  overallScore: number;
  dimensions: DialogueQualityDimensionScore[];
  issues: DialogueQualityIssue[];
  totalIssues: number;
  highSeverityCount: number;
  mediumSeverityCount: number;
  lowSeverityCount: number;
  checkedAt: number;
  characterCardName: string;
  /** 参与检查的消息条数 */
  messageCount: number;
}

/** 检查请求中的单条消息引用 */
export interface DialogueQualityMessageRef {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  speakerName?: string;
  timestamp: number;
}

/** 检查请求中的角色卡设定摘要 */
export interface DialogueQualityCharacterCard {
  name: string;
  description: string;
  personality: string;
  mesExample: string;
  scenario?: string;
}

/** 对话质量检查请求 */
export interface DialogueQualityCheckRequest {
  characterCardId: string;
  characterCard: DialogueQualityCharacterCard;
  messages: DialogueQualityMessageRef[];
  /** 记忆表格文本摘要（可选，作为世界设定参考） */
  memoryTableText?: string;
}

/** 单条问题修正请求 */
export interface DialogueQualityFixRequest {
  characterCard: DialogueQualityCharacterCard;
  issue: DialogueQualityIssue;
  /** 被修正的目标消息（issue.messageIds[0] 对应的消息） */
  targetMessage: DialogueQualityMessageRef;
  /** 目标消息前后的上下文消息（最多前 2 条 + 后 1 条） */
  contextMessages: DialogueQualityMessageRef[];
}

/** 单条问题修正结果 */
export interface DialogueQualityFixResult {
  success: boolean;
  fixedContent: string;
  error?: string;
}

/** 检查历史条目（评分趋势用） */
export interface DialogueQualityHistoryEntry {
  id: string;
  characterCardId: string;
  characterCardName: string;
  overallScore: number;
  totalIssues: number;
  dimensionScores: { dimension: DialogueQualityDimension; score: number }[];
  checkedAt: number;
}
