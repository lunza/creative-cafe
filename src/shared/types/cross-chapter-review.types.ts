/**
 * 跨章节连贯性审查类型（Spec: add-cross-chapter-coherence-review）
 *
 * 章节定位契约（与 PlotCheckerService / TableOrganizeService 同一契约）：
 * 本模块所有 chapterIndex / position 均为 **0 基数组位置**（project.outline.chapters 下标），
 * UI 展示"第N章" = position + 1。
 *
 * 混合路线：
 * - text_repetition（文本重复）由主进程本地句级扫描产出（零 token，source='local'）
 * - plot_repetition / plot_contradiction 由 AI 语义审查产出（source='ai'）
 * - 两路命中同一雷同句时合并为一条（source='local+ai'）
 */

/** AI 严格度（三档映射到提示词判据文案） */
export type CrossCheckStrictness = 'strict' | 'standard' | 'lenient';

/** 问题类型 */
export type CrossCheckIssueType =
  | 'plot_repetition'
  | 'plot_contradiction'
  | 'text_repetition';

export type CrossCheckSeverity = 'high' | 'medium' | 'low';

/** 问题来源：本地扫描 / AI 语义审查 / 两路同时命中（合并） */
export type CrossCheckIssueSource = 'local' | 'ai' | 'local+ai';

/** 单侧章节引用（章节A 或 章节B） */
export interface CrossCheckChapterRef {
  /** 0 基数组位置（project.outline.chapters 下标） */
  index: number;
  title: string;
  /** 原文逐字引文 */
  quote: string;
  /** 引文能否在章节正文中逐字定位（AI 引文校验失败时 false，不静默丢弃） */
  located?: boolean;
}

/** 本地扫描：一组雷同句示例（a/b 为完整原句，phrase 为最长公共片段） */
export interface CrossCheckSimilarPair {
  a: string;
  b: string;
  /** 最长公共片段 */
  phrase: string;
  /** 匹配字符数 / 较短句长度（0-1，仅展示参考） */
  similarity: number;
}

export interface CrossCheckIssue {
  id: string;
  type: CrossCheckIssueType;
  severity: CrossCheckSeverity;
  description: string;
  chapterA: CrossCheckChapterRef;
  chapterB: CrossCheckChapterRef;
  source: CrossCheckIssueSource;
  /** 本地扫描：该问题组内最长公共片段长度（字） */
  maxPhraseLen?: number;
  /** 本地扫描：≤3 组雷同句示例 */
  similarPairs?: CrossCheckSimilarPair[];
}

/** 细粒度审查参数（按项目持久化于 localStorage，key 含 projectId） */
export interface CrossCheckParams {
  /** 起始章节位置（0 基） */
  startPos: number;
  /** 章节数（2-5，受本地模型上下文限制） */
  count: number;
  /** 章节比对距离 N（1-10，默认 2）：仅比较 |i-j| ≤ N 的章节对，作用于本地扫描与 AI 提示词 */
  distance: number;
  /** 文本相似度阈值（0.50-0.95，默认 0.75）：作用于本地扫描（映射到最小公共片段长度） */
  similarityThreshold: number;
  /** AI 严格度（默认 standard） */
  aiStrictness: CrossCheckStrictness;
  /** 是否启用 AI 语义审查（默认 true；关闭时仅本地扫描） */
  enableAiReview: boolean;
  /** 用户自定义提示词（可选，经 withCustomPrompt 注入 system prompt 末尾） */
  customPrompt?: string;
}

/** 默认参数与边界常量 */
export const CROSS_CHECK_DEFAULTS = {
  count: 2,
  maxCount: 5,
  distance: 2,
  distanceMin: 1,
  distanceMax: 10,
  similarityThreshold: 0.75,
  similarityMin: 0.5,
  similarityMax: 0.95,
  aiStrictness: 'standard' as CrossCheckStrictness,
} as const;

/** 问题类型展示名 */
export const CROSS_CHECK_ISSUE_TYPE_LABELS: Record<CrossCheckIssueType, string> = {
  plot_repetition: '重复剧情',
  plot_contradiction: '情节矛盾',
  text_repetition: '文本重复',
};

/** 严重度展示名 */
export const CROSS_CHECK_SEVERITY_LABELS: Record<CrossCheckSeverity, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export interface CrossCheckStats {
  /** 实际参与审查的章节数（跳过无正文） */
  chapters: number;
  /** 比较的章节对数量 */
  pairs: number;
  localCount: number;
  aiCount: number;
  durationMs: number;
}

export interface CrossCheckReport {
  issues: CrossCheckIssue[];
  stats: CrossCheckStats;
  /** 实际参与审查的章节位置（0 基，升序） */
  checkedPositions: number[];
  /** 用户中止（保留中止前已产出的本地扫描结果） */
  cancelled?: boolean;
  /** 中止时所处阶段 */
  cancelledPhase?: 'local' | 'ai';
  /** AI 阶段失败原因（本地结果仍保留） */
  aiError?: string;
}

/** 流式进度事件（writing:crossCheck:stream） */
export interface CrossCheckStreamEvent {
  projectId: string;
  /** local=本地扫描阶段 / ai=AI 语义审查阶段 */
  phase: 'local' | 'ai';
  /** 正文增量 */
  chunk: string;
  /** 思考流增量 */
  reasoning: string;
  /** 阶段消息（如"本地扫描完成，发现 N 处雷同"） */
  message?: string;
}

/** 一键修复建议（suggestFix 产出，用户确认后写回） */
export interface CrossCheckFixSuggestion {
  /** 目标章节位置（0 基） */
  chapterIndex: number;
  chapterTitle: string;
  /** 原文（必须能在目标章正文中逐字定位） */
  originalText: string;
  /** 改写后文本 */
  replacementText: string;
  /** 建议说明（为什么这样改） */
  explanation: string;
}
