/**
 * 写作智能体编排共享类型定义
 *
 * 来源：spec §二 Task 15（WritingAgentService 编排：读大纲→写章→自审→修复→更新表→下一章）
 *
 * 设计约束：
 *  - 固定编排循环（非动态 agent loop）：读大纲→写章→checkPlot→applyAutoFix→updateTable→下一章
 *  - 不替换现有逐按钮流程：用户手动触发"智能体写作"按钮
 *  - 支持取消与断点续跑（checkpoint 持久化）
 *  - 进度事件通过 IPC 推送（主进程 → 渲染进程）
 *
 * 该文件为共享类型真源（single source of truth）：
 *  - 主进程 src/main/services/agent/writing/writingAgentTypes.ts re-export 本文件类型
 *  - 渲染进程通过 src/renderer/types/electron.d.ts 引用本文件类型
 */

import type { PlotCheckReport } from './writing.types';

// ==================== 编排请求 ====================

/**
 * 智能体写作请求。
 */
export interface AgentWritingRequest {
  /** 项目 ID */
  projectId: string;
  /** 起始章节索引（0-based，默认从第一个未完成章节开始） */
  startChapterIndex?: number;
  /** 结束章节索引（0-based，默认到大纲最后一章） */
  endChapterIndex?: number;
  /** 模型配置 */
  modelConfig: {
    model: string;
    temperature: number;
    maxTokens: number;
  };
  /** 素材资源 ID */
  resources?: {
    worldBookIds?: string[];
    characterCardIds?: string[];
    userPersonaIds?: string[];
    knowledgeItemIds?: string[];
    writingStyleIds?: string[];
  };
  /** 生成参数 */
  generationParams: {
    style: string;
    perspective: string;
    novelType?: string;
    constraints?: string[];
  };
  /** 自定义模板 ID */
  customNovelTypeId?: string;
  customWritingStyleId?: string;
  /** 编排选项 */
  options?: AgentWritingOptions;
}

/**
 * 编排选项。
 */
export interface AgentWritingOptions {
  /** 是否在写章后执行剧情检查（默认 true） */
  enablePlotCheck?: boolean;
  /** 是否自动修复 critical/high 问题（默认 true） */
  enableAutoFix?: boolean;
  /** 是否在写章后整理状态表（默认 true） */
  enableTableOrganize?: boolean;
  /** 自动修复的最低严重级别（默认 'high'） */
  autoFixMinSeverity?: 'critical' | 'high' | 'medium' | 'low';
  /** 单章最大重试次数（生成失败时，默认 2） */
  maxRetriesPerChapter?: number;
  /** 跳过已有内容的章节（默认 true） */
  skipExistingChapters?: boolean;
}

// ==================== 进度事件 ====================

/**
 * 编排进度事件类型。
 */
export type AgentWritingEventType =
  | 'started'           // 编排开始
  | 'chapter_started'   // 章节开始
  | 'chapter_writing'   // 章节写作中
  | 'chapter_written'   // 章节写作完成
  | 'chapter_checking'  // 章节检查中
  | 'chapter_checked'   // 章节检查完成
  | 'chapter_fixing'    // 章节修复中
  | 'chapter_fixed'     // 章节修复完成
  | 'chapter_organizing' // 表格整理中
  | 'chapter_organized'  // 表格整理完成
  | 'chapter_completed'  // 章节全部完成
  | 'chapter_skipped'    // 章节跳过（已有内容）
  | 'chapter_failed'     // 章节失败
  | 'progress'          // 通用进度更新
  | 'completed'         // 编排完成
  | 'cancelled'         // 编排取消
  | 'error';            // 编排错误

/**
 * 编排进度事件。
 */
export interface AgentWritingEvent {
  /** 事件类型 */
  type: AgentWritingEventType;
  /** 当前章节索引 */
  chapterIndex?: number;
  /** 当前章节标题 */
  chapterTitle?: string;
  /** 总章节数 */
  totalChapters?: number;
  /** 已完成章节数 */
  completedChapters?: number;
  /** 进度百分比（0-100） */
  percent?: number;
  /** 事件消息 */
  message?: string;
  /** 剧情检查报告（chapter_checked 事件） */
  plotCheckReport?: PlotCheckReport;
  /** 修复的问题数（chapter_fixed 事件） */
  fixedIssueCount?: number;
  /** 错误信息（chapter_failed / error 事件） */
  error?: string;
  /** 时间戳 */
  timestamp: number;
}

// ==================== 编排结果 ====================

/**
 * 单章编排结果。
 */
export interface ChapterAgentResult {
  /** 章节索引 */
  chapterIndex: number;
  /** 章节标题 */
  chapterTitle: string;
  /** 生成的章节内容 */
  content: string;
  /** 字数 */
  wordCount: number;
  /** 剧情检查报告（若执行了检查） */
  plotCheckReport?: PlotCheckReport;
  /** 修复的问题数 */
  fixedIssueCount?: number;
  /** 是否跳过（已有内容） */
  skipped?: boolean;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 耗时（ms） */
  durationMs: number;
}

/**
 * 编排总结果。
 */
export interface AgentWritingResult {
  /** 是否成功完成 */
  success: boolean;
  /** 项目 ID */
  projectId: string;
  /** 起始章节 */
  startChapterIndex: number;
  /** 结束章节 */
  endChapterIndex: number;
  /** 总章节数 */
  totalChapters: number;
  /** 成功章节数 */
  succeededChapters: number;
  /** 失败章节数 */
  failedChapters: number;
  /** 跳过章节数 */
  skippedChapters: number;
  /** 每章结果 */
  chapterResults: ChapterAgentResult[];
  /** 总耗时（ms） */
  totalDurationMs: number;
  /** 是否被取消 */
  cancelled: boolean;
  /** 错误信息 */
  error?: string;
  /** checkpoint（用于断点续跑） */
  checkpoint?: AgentWritingCheckpoint;
}

// ==================== 断点续跑 ====================

/**
 * 编排 checkpoint（断点续跑用）。
 *
 * 每完成一章后保存，支持从断点恢复。
 */
export interface AgentWritingCheckpoint {
  /** 项目 ID */
  projectId: string;
  /** 起始章节 */
  startChapterIndex: number;
  /** 下一个待写章节索引 */
  nextChapterIndex: number;
  /** 结束章节 */
  endChapterIndex: number;
  /** 已完成章节结果 */
  completedChapters: ChapterAgentResult[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

// ==================== 状态查询 ====================

/**
 * 编排状态查询结果（IPC writing-agent:status 返回）。
 */
export interface AgentWritingStatus {
  /** 是否正在运行 */
  running: boolean;
  /** 是否存在 checkpoint（可断点续跑） */
  hasCheckpoint: boolean;
  /** checkpoint 摘要（无 checkpoint 时为 null） */
  checkpoint: {
    projectId: string;
    nextChapterIndex: number;
    endChapterIndex: number;
    completedChapters: number;
    updatedAt: number;
  } | null;
}

// ==================== 严重级别工具 ====================

/**
 * 问题严重级别排序值（用于过滤自动修复）。
 */
export const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * 判断问题严重级别是否满足最低阈值。
 */
export function meetsSeverityThreshold(
  severity: string,
  minSeverity: 'critical' | 'high' | 'medium' | 'low'
): boolean {
  const sevValue = SEVERITY_ORDER[severity] ?? 0;
  const minValue = SEVERITY_ORDER[minSeverity] ?? 0;
  return sevValue >= minValue;
}

// ==================== 渲染进程别名 ====================

/**
 * 渲染进程使用的请求类型别名（与主进程 AgentWritingRequest 一致）。
 */
export type WritingAgentRequest = AgentWritingRequest;

/**
 * 渲染进程使用的事件类型别名（与主进程 AgentWritingEvent 一致）。
 */
export type WritingAgentEvent = AgentWritingEvent;

/**
 * 渲染进程使用的结果类型别名（与主进程 AgentWritingResult 一致）。
 */
export type WritingAgentResult = AgentWritingResult;

/**
 * 渲染进程使用的状态类型别名（与主进程 AgentWritingStatus 一致）。
 */
export type WritingAgentStatus = AgentWritingStatus;
