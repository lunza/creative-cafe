/**
 * 写作模式 2.0（V2）类型契约
 *
 * Spec: refactor-writing-mode-v2 / Phase 0
 *
 * 设计原则（对应 spec.md「G. 关键架构规则」）：
 * 1. 数据兼容：持久化数据结构直接复用 V1 的 writing.types.ts（V1/V2 共用同一项目库，零迁移）。
 * 2. 全类型化：WritingV2API 接口覆盖 preload `writingV2` 命名空间的每个通道，
 *    禁止 any 穿透（规则 3）。
 * 3. 单一流水线：V2 仅保留 shard 分片生成（chunk 体系在 V2 舍弃）。
 *
 * 注意：本文件只定义"契约"，不重复定义数据结构。
 * 通道复用现有 `writing:*` IPC（主进程 handler 零改动），V2 仅在新入口下使用本契约。
 */

import type {
  WritingProject,
  WritingConfig,
  GeneratedOutline,
  ChapterOutline,
  ChapterVersion,
  PlotCheckHistoryEntry,
  WorkInfo,
  StoryLine,
  CharacterRelationship,
  WorldbuildingNotes,
  WritingParameters,
  ModelConfig,
  WritingResourceConfig,
  ChainOfThought,
  WritingError,
  ChapterInfo,
  ShardOutline,
  ShardDetail,
  ShardIntegrationMarker,
  ShardOutlineGenerationRequest,
  ShardOutlineGenerationResult,
  ShardContentGenerationRequest,
  OutlineGenerationRequest,
  OutlineGenerationResult,
  AISplitSuggestion,
  AIMergeSuggestion,
  PlotCheckIssue,
  DimensionScore,
  PlotCheckReport,
  LogicCheckIssue,
  LogicCheckResult,
  QuickFixSuggestion,
  AutoFixDiff,
  BatchFixIssueInfo,
  BatchFixRequest,
  BatchFixResult,
  TableOrganizeChangeRecord,
  TableOrganizeVersionSnapshot,
  WritingStyleResource,
  CustomNovelTypeTemplate,
  CustomWritingStyleTemplate,
} from './writing.types';
import type { WritingTableData, WritingTableConfig } from './writing-table.types';
import {
  ProjectStatus,
  ChapterStatus,
  ExportFormat,
  NovelType,
  NarrativePerspective,
  WritingStyle,
  ShardStatus,
  PlotCheckDimension,
  IssueSeverity,
  LogicContradictionType,
  PLOT_CHECK_DIMENSION_LABELS,
  ISSUE_SEVERITY_LABELS,
  LOGIC_CONTRADICTION_TYPE_LABELS,
  WritingStyleStatus,
} from './writing.types';

// ==================== 数据形状复用（单一来源 = writing.types.ts） ====================

export type {
  WritingProject,
  WritingConfig,
  GeneratedOutline,
  ChapterOutline,
  ChapterVersion,
  PlotCheckHistoryEntry,
  WorkInfo,
  StoryLine,
  CharacterRelationship,
  WorldbuildingNotes,
  WritingParameters,
  ModelConfig,
  WritingResourceConfig,
  ChainOfThought,
  WritingError,
  ChapterInfo,
  ShardOutline,
  ShardDetail,
  ShardIntegrationMarker,
  ShardOutlineGenerationRequest,
  ShardOutlineGenerationResult,
  ShardContentGenerationRequest,
  OutlineGenerationRequest,
  OutlineGenerationResult,
  AISplitSuggestion,
  AIMergeSuggestion,
  PlotCheckIssue,
  DimensionScore,
  PlotCheckReport,
  LogicCheckIssue,
  LogicCheckResult,
  QuickFixSuggestion,
  AutoFixDiff,
  BatchFixIssueInfo,
  BatchFixRequest,
  BatchFixResult,
  TableOrganizeChangeRecord,
  TableOrganizeVersionSnapshot,
  WritingTableData,
  WritingTableConfig,
  WritingStyleResource,
  CustomNovelTypeTemplate,
  CustomWritingStyleTemplate,
};
// 以下为运行时枚举（渲染层按值使用），走值导入 + 值导出
export {
  ProjectStatus,
  ChapterStatus,
  ExportFormat,
  NovelType,
  NarrativePerspective,
  WritingStyle,
  ShardStatus,
  PlotCheckDimension,
  IssueSeverity,
  LogicContradictionType,
  PLOT_CHECK_DIMENSION_LABELS,
  ISSUE_SEVERITY_LABELS,
  LOGIC_CONTRADICTION_TYPE_LABELS,
  WritingStyleStatus,
};

// ==================== V2 新增：结果信封 ====================

/** 通用操作结果 */
export interface V2BoolResult {
  success: boolean;
  error?: string;
}

/** 项目列表结果 */
export interface V2LoadProjectsResult {
  success: boolean;
  projects: WritingProject[];
  error?: string;
}

/** 创建项目结果 */
export interface V2CreateProjectResult {
  success: boolean;
  projectId: string;
  error?: string;
}

/** 大纲生成结果（流式：完整内容经 onOutlineChunk 事件推送，invoke 返回收尾信息） */
export interface V2GenerateOutlineResult {
  success: boolean;
  outline: GeneratedOutline | null;
  /** 解析失败时保留的原始文本，成功时亦返回 */
  outlineRaw: string | null;
  chainOfThought?: ChainOfThought | null;
  error?: string;
}

/** 导出结果 */
export interface V2ExportResult {
  success: boolean;
  /** 导出成功时返回文件绝对路径 */
  filePath?: string;
  error?: string;
}

/** AI 拆并建议结果（data 为 AISplitSuggestion | AIMergeSuggestion） */
export interface V2SuggestionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** 大纲原始文本解析结果（writingV2:parseOutline，不创建项目） */
export interface V2ParseOutlineResult {
  success: boolean;
  outline: GeneratedOutline | null;
  error?: string;
}

// ==================== V2 新增：流式事件载荷 ====================

/** 大纲流式 chunk 事件（通道 writing:stream:chunk） */
export interface V2OutlineStreamChunkEvent {
  chunk: string;
}

/**
 * 分片流式事件（通道 writing:chunk:*）
 * V2 语义：chunkIndex 即 shardIndex（主进程复用 chunk 事件通道承载分片流）。
 */
export interface V2ShardStreamStartEvent {
  projectId: string;
  chapterIndex: number;
  /** V2 中恒等于 shardIndex */
  chunkIndex: number;
}

export interface V2ShardStreamProgressEvent extends V2ShardStreamStartEvent {
  chunk: string;
}

/** 分片思考流增量事件（思考模型 reasoning_content 透出，通道 writing:chunk:reasoning） */
export interface V2ShardStreamReasoningEvent extends V2ShardStreamStartEvent {
  chunk: string;
}

/** 章节内容 AI 味审核结果（通道 writing:checkChapterDeAi） */
export interface V2ChapterDeAiCheckResult {
  success: boolean;
  /** 用户主动停止（writing:cancelDeAiCheck）时为 true，前端据此提示"已停止"而非报错 */
  cancelled?: boolean;
  error?: string;
  passed?: boolean;
  comment?: string;
  issues?: string[];
  revisedContent?: string;
}

/** AI 味审核过程流式增量事件（通道 writing:deai:stream，思考流/正文分字段透出） */
export interface V2DeAiStreamEvent {
  /** 正文 JSON 增量（delta.content） */
  chunk: string;
  /** 思考流增量（delta.reasoning_content，思考模型） */
  reasoning: string;
}

export interface V2ShardStreamCompleteEvent extends V2ShardStreamStartEvent {
  content: string;
}

export interface V2ShardStreamErrorEvent extends V2ShardStreamStartEvent {
  error: WritingError;
}

// ==================== V2 新增：AI 拆并请求/结果类型化 ====================

/** AI 章节拆分建议请求 */
export interface V2AISplitRequest {
  chapterTitle: string;
  chapterContent: string;
  splitCount: number;
  modelConfig: ModelConfig;
}

/** AI 章节合并建议请求 */
export interface V2AIMergeRequest {
  chapters: Array<{ index: number; title: string; content: string }>;
  modelConfig: ModelConfig;
}

// ==================== V2 P2：剧情检查结果类型化 ====================

/** 章节剧情检查结果（通道 writing:checkChapter） */
export interface V2PlotCheckResult {
  success: boolean;
  report: PlotCheckReport | null;
  error?: string | null;
}

/** 单条问题自动修正请求 */
export interface V2AutoFixRequest {
  projectId: string;
  chapterIndex: number;
  content: string;
  /** 维度问题或逻辑问题（issueType 区分） */
  issue: PlotCheckIssue | LogicCheckIssue;
  issueType?: 'dimension' | 'logic';
  modelConfig?: ModelConfig;
}

/** 单条问题自动修正结果 */
export interface V2AutoFixResult {
  success: boolean;
  fixedContent: string;
  diffs: AutoFixDiff[];
  error?: string | null;
}

/** 逻辑矛盾记录行（主进程 LogicCheckRecorder 的数值列结构） */
export interface V2LogicCheckRecord {
  /** 流水号 */
  '0': string;
  /** 唯一 id */
  '1': string;
  /** 异常类型 */
  '2': string;
  /** 具体情节描述 */
  '3': string;
  /** 矛盾点分析 */
  '4': string;
  /** 章节信息 */
  '5': string;
  /** 严重程度 */
  '6': string;
  /** 改进建议 */
  '7': string;
  /** 检测时间 */
  '8': string;
}

/** 逻辑记录查询结果 */
export interface V2LogicRecordsResult {
  success: boolean;
  records: V2LogicCheckRecord[];
  error?: string;
}

// ==================== V2 P2：表格整理结果类型化 ====================

/** 表格数据查询结果 */
export interface V2TableDataResult {
  success: boolean;
  data: WritingTableData | null;
  error?: string;
}

/** 表格配置查询结果 */
export interface V2TableConfigResult {
  success: boolean;
  config: WritingTableConfig | null;
  error?: string;
}

/** 表格模板（主进程 tableTemplateService 结构） */
export interface V2TableTemplate {
  id: string;
  name: string;
  description: string;
  sheets: Array<{ name: string; headers: string[]; description?: string; order?: number }>;
  isCopy?: boolean;
  /** 自定义模板（可编辑/删除）；内置模板为 false */
  custom?: boolean;
}

/** 自定义模板保存输入（内置模板不可修改） */
export type V2TableTemplateInput = Omit<V2TableTemplate, 'custom' | 'isCopy'>;

/** 模板操作结果（saveTableTemplate / deleteTableTemplate） */
export interface V2TableTemplateOpResult {
  success: boolean;
  template?: V2TableTemplate;
  error?: string;
}

/** 单行 AI 重整理结果（reorganizeRow） */
export interface V2ReorganizeRowResult {
  success: boolean;
  row?: Record<string, unknown>;
  error?: string;
}

/** 表格模板列表结果 */
export interface V2TableTemplatesResult {
  success: boolean;
  templates: V2TableTemplate[];
  error?: string;
}

/** 表格整理结果（organizeTable / organizeSingleSheet） */
export interface V2TableOrganizeResult {
  success: boolean;
  processedCount: number;
  errorCount: number;
  errors: string[];
  error?: string;
  /** 因用户取消而提前结束（已处理部分保留） */
  cancelled?: boolean;
}

/** 章节整理状态 */
export interface V2ChapterOrganizeStatus {
  chapterIndex: number;
  title: string;
  status: string;
}

/** 章节整理状态查询结果 */
export interface V2ChapterOrganizeStatusResult {
  success: boolean;
  status: V2ChapterOrganizeStatus[];
  error?: string;
}

/** 表格版本快照查询结果 */
export interface V2VersionSnapshotResult {
  success: boolean;
  snapshot: TableOrganizeVersionSnapshot | null;
  error?: string;
}

/** 表格整理进度事件（通道 writing:table:organizeProgress） */
export interface V2TableOrganizeProgressEvent {
  projectId: string;
  current: number;
  total: number;
  message: string;
  percent: number;
  currentChunk: number;
  totalChunks: number;
  timestamp: number;
}

/**
 * V2 表格整理子域 API（preload `writingV2.table`，复用 writing:table:* 通道）。
 */
export interface V2TableAPI {
  getTableData: (projectId: string) => Promise<V2TableDataResult>;
  saveTableData: (
    projectId: string,
    sheetName: string,
    sheetData: Record<string, unknown>[]
  ) => Promise<V2BoolResult>;
  clearTableData: (projectId: string) => Promise<V2BoolResult>;
  updateRowInTable: (
    projectId: string,
    sheetName: string,
    rowIndex: number,
    rowData: Record<string, unknown>
  ) => Promise<V2BoolResult & { result?: boolean }>;
  getTableConfig: (projectId: string) => Promise<V2TableConfigResult>;
  saveTableConfig: (projectId: string, config: WritingTableConfig) => Promise<V2BoolResult>;
  associateTableTemplate: (
    projectId: string,
    templateId: string,
    templateName: string,
    templateSheets: Array<{ name: string; headers: string[]; description?: string }>
  ) => Promise<V2BoolResult>;
  getAllTemplates: () => Promise<V2TableTemplatesResult>;
  /** AI 表格整理（进度经 onOrganizeProgress 推送） */
  organizeTable: (
    projectId: string,
    modelConfig: ModelConfig,
    chapterIndex?: number,
    requirements?: string,
    skipOrganized?: boolean
  ) => Promise<V2TableOrganizeResult>;
  organizeSingleSheet: (
    projectId: string,
    sheetName: string,
    modelConfig: ModelConfig,
    chapterIndex?: number,
    requirements?: string
  ) => Promise<V2TableOrganizeResult>;
  reorganizeRow: (
    projectId: string,
    sheet: string,
    rowIndex: number,
    rowData: Record<string, unknown>,
    requirements: string,
    modelConfig: ModelConfig
  ) => Promise<V2ReorganizeRowResult>;
  getChapterOrganizeStatus: (projectId: string) => Promise<V2ChapterOrganizeStatusResult>;
  /** 请求取消进行中的整理任务（当前分片完成后生效） */
  cancelOrganize: (projectId: string) => Promise<V2BoolResult>;
  getVersionSnapshot: (projectId: string) => Promise<V2VersionSnapshotResult>;
  confirmVersion: (projectId: string) => Promise<V2BoolResult>;
  rollbackVersion: (projectId: string) => Promise<V2BoolResult>;
  /** 保存自定义模板（新建/更新，内置模板受保护） */
  saveTableTemplate: (template: V2TableTemplateInput) => Promise<V2TableTemplateOpResult>;
  /** 删除自定义模板（内置模板受保护） */
  deleteTableTemplate: (id: string) => Promise<V2TableTemplateOpResult>;
  /** 整理进度事件（通道 writing:table:organizeProgress） */
  onOrganizeProgress: (callback: (data: V2TableOrganizeProgressEvent) => void) => () => void;
}

// ==================== V2 P3：资源/风格/模板结果类型化 ====================

/** 资源候选项（世界书/角色卡/人设，统一 {id,name,path} 形状） */
export interface V2ResourceCandidate {
  /** 绑定用 id（V1 语义：文件相对路径 path） */
  id: string;
  name: string;
  path: string;
  description?: string;
}

/** 资源候选列表结果 */
export interface V2ResourceCandidateListResult {
  success: boolean;
  candidates: V2ResourceCandidate[];
  error?: string;
}

/** 风格学习上传结果（writing:style:upload） */
export interface V2StyleUploadResult {
  success: boolean;
  taskId?: string;
  error?: string;
}

/** 风格列表结果 */
export interface V2StyleListResult {
  success: boolean;
  styles: WritingStyleResource[];
  error?: string;
}

/** 风格详情结果 */
export interface V2StyleGetResult {
  success: boolean;
  style: WritingStyleResource | null;
  error?: string;
}

/** 活跃学习任务结果 */
export interface V2StyleActiveTasksResult {
  success: boolean;
  activeTaskIds: string[];
  error?: string;
}

/** 风格学习任务失败事件（通道 writing:style:error） */
export interface V2StyleErrorEvent {
  taskId: string;
  error: string;
}

/** 模板列表结果（预置 + 自定义合并） */
export interface V2TemplateListResult<T> {
  success: boolean;
  templates: T[];
  error?: string;
}

/** 模板保存结果 */
export interface V2TemplateSaveResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * V2 素材绑定子域 API（preload `writingV2.resources`，复用 V1 列表通道）。
 */
export interface V2ResourceAPI {
  /** 可绑定的世界书列表（worldBook:list，path 为绑定 id） */
  listWorldBooks: () => Promise<V2ResourceCandidateListResult>;
  /** 可绑定的角色卡列表（character:list） */
  listCharacters: () => Promise<V2ResourceCandidateListResult>;
  /** 可绑定的人设列表（avatar:list + avatar.read 解析 JSON 名称/描述） */
  listPersonas: () => Promise<V2ResourceCandidateListResult>;
  /** 按 id 加载资源详情与上下文摘要（writing:loadResources） */
  loadResources: (params: {
    worldBookIds?: string[];
    characterCardIds?: string[];
    userPersonaIds?: string[];
  }) => Promise<{ success: boolean; summary?: string; error?: string }>;
}

/**
 * V2 风格学习子域 API（preload `writingV2.style`，复用 writing:style:* 通道）。
 */
export interface V2StyleAPI {
  upload: (req: { filePath: string; fileName: string; fileSize: number }) => Promise<V2StyleUploadResult>;
  list: () => Promise<V2StyleListResult>;
  get: (resourceId: string) => Promise<V2StyleGetResult>;
  remove: (resourceId: string) => Promise<V2BoolResult>;
  cancel: (taskId: string) => Promise<V2BoolResult>;
  getActiveTasks: () => Promise<V2StyleActiveTasksResult>;
  /** 学习任务失败事件（通道 writing:style:error） */
  onError: (callback: (data: V2StyleErrorEvent) => void) => () => void;
}

/**
 * V2 模板管理子域 API（preload `writingV2.templates`，复用 writing:template:* 通道）。
 */
export interface V2TemplateAPI {
  novelTypeList: () => Promise<V2TemplateListResult<CustomNovelTypeTemplate>>;
  novelTypeSave: (template: CustomNovelTypeTemplate) => Promise<V2TemplateSaveResult>;
  novelTypeDelete: (id: string) => Promise<V2BoolResult>;
  writingStyleList: () => Promise<V2TemplateListResult<CustomWritingStyleTemplate>>;
  writingStyleSave: (template: CustomWritingStyleTemplate) => Promise<V2TemplateSaveResult>;
  writingStyleDelete: (id: string) => Promise<V2BoolResult>;
}

// ==================== V2 新增：preload API 契约（全类型化，禁止 any） ====================

/**
 * `window.electronAPI.writingV2` 的完整类型契约。
 *
 * 所有通道复用现有 `writing:*` IPC handler（主进程零改动）。
 * 事件监听器统一返回 unsubscribe 函数。
 */
export interface WritingV2API {
  // ========== 项目 CRUD（复用 writing: 项目通道） ==========
  loadProjects: () => Promise<V2LoadProjectsResult>;
  createProject: (config: WritingConfig) => Promise<V2CreateProjectResult>;
  saveProject: (project: WritingProject) => Promise<V2BoolResult>;
  deleteProject: (projectId: string) => Promise<V2BoolResult>;

  // ========== 大纲（AI 生成流式 + 解析） ==========
  /** AI 大纲生成；流式 chunk 经 onOutlineChunk 推送 */
  generateOutline: (request: OutlineGenerationRequest) => Promise<V2GenerateOutlineResult>;
  /** 解析大纲原始文本为结构化大纲（不创建项目；V1 的 saveOutline 会新建项目，V2 不用） */
  parseOutline: (rawContent: string) => Promise<V2ParseOutlineResult>;
  /** 取消当前项目的大纲/章节生成 */
  cancelGeneration: (projectId: string) => Promise<V2BoolResult>;

  // ========== 章节内容持久化 ==========
  /** 章节内容自动保存（防抖由渲染层负责） */
  autoSaveChapter: (params: {
    projectId: string;
    chapterIndex: number;
    content: string;
  }) => Promise<V2BoolResult>;
  /** 保存章节版本快照 */
  saveVersion: (params: {
    projectId: string;
    chapterIndex: number;
    content: string;
    note?: string;
  }) => Promise<V2BoolResult>;
  /** 恢复章节版本 */
  restoreVersion: (params: {
    projectId: string;
    chapterIndex: number;
    versionId: string;
  }) => Promise<V2BoolResult>;

  // ========== shard 分片生成流水线（V2 唯一生成流水线） ==========
  /** 生成章节分片大纲（同步返回，无流式） */
  generateShardOutline: (
    request: ShardOutlineGenerationRequest
  ) => Promise<ShardOutlineGenerationResult & { success: boolean; error?: string }>;
  /** 生成分片内容（流式：事件经 onShardStream* 推送，chunkIndex = shardIndex） */
  generateShardContent: (
    request: ShardContentGenerationRequest
  ) => Promise<V2BoolResult>;

  // ========== AI 章节拆并建议 ==========
  aiSuggestSplit: (request: V2AISplitRequest) => Promise<V2SuggestionResult<AISplitSuggestion>>;
  aiSuggestMerge: (request: V2AIMergeRequest) => Promise<V2SuggestionResult<AIMergeSuggestion>>;

  // ========== 导出（替代 V1 EXPORT 空壳） ==========
  /** 按章节选择导出（writingV2:exportWithChapters）；chapterIndices 为空数组时导出全部 */
  exportWithChapters: (
    projectId: string,
    format: ExportFormat,
    chapterIndices: number[]
  ) => Promise<V2ExportResult>;

  // ========== P2：剧情检查（复用 writing:checkChapter 等通道） ==========
  /** 章节剧情检查（多维度评分 + 逻辑异常检测） */
  checkChapter: (params: {
    projectId: string;
    chapterIndex: number;
    content: string;
    previousChapters?: { index: number; title: string; content: string }[];
  }) => Promise<V2PlotCheckResult>;
  /** 章节内容 AI 味审核（humanizer 规则审读 + 修订文本，通道 writing:checkChapterDeAi） */
  checkChapterDeAi: (params: {
    chapterTitle: string;
    content: string;
    modelConfig: import('./writing.types').ModelConfig;
    /** 用户自定义审核要求（可选），注入 system prompt 末尾（最高优先级） */
    customPrompt?: string;
  }) => Promise<V2ChapterDeAiCheckResult>;
  /** 中止进行中的章节 AI 味审核（通道 writing:cancelDeAiCheck） */
  cancelDeAiCheck: () => Promise<V2BoolResult>;
  /** 单条问题自动修正 */
  autoFixIssue: (params: V2AutoFixRequest) => Promise<V2AutoFixResult>;
  /** 批量问题修正 */
  batchFixIssues: (req: BatchFixRequest) => Promise<BatchFixResult>;
  /** 查询逻辑矛盾记录（跨项目全局表） */
  getLogicCheckRecords: () => Promise<V2LogicRecordsResult>;
  /** 清空逻辑矛盾记录 */
  clearLogicCheckRecords: () => Promise<V2BoolResult>;

  // ========== 跨章节连贯性审查（Spec: add-cross-chapter-coherence-review，writing:crossCheck* 通道） ==========
  /** 跨章审查（本地文本雷同扫描 + AI 语义审查；流式进度经 onCrossCheckStream 推送） */
  crossCheckReview: (params: {
    projectId: string;
    params: import('./cross-chapter-review.types').CrossCheckParams;
  }) => Promise<{
    success: boolean;
    report: import('./cross-chapter-review.types').CrossCheckReport | null;
    error: string | null;
  }>;
  /** 中止跨章审查（cancelled 标记契约） */
  crossCheckCancel: () => Promise<{ success: boolean; error?: string }>;
  /** 一键修复建议（AI 生成改写，锚点校验通过后才返回成功） */
  crossCheckSuggestFix: (params: {
    projectId: string;
    issue: import('./cross-chapter-review.types').CrossCheckIssue;
    checkedPositions: number[];
    customPrompt?: string;
  }) => Promise<{
    success: boolean;
    suggestion?: import('./cross-chapter-review.types').CrossCheckFixSuggestion;
    error?: string;
  }>;

  // ========== P2：表格整理子域（复用 writing:table:* 通道） ==========
  table: V2TableAPI;

  // ========== P3：素材绑定子域（复用 V1 列表通道 + writing:loadResources） ==========
  resources: V2ResourceAPI;

  // ========== P3：风格学习子域（复用 writing:style:* 通道） ==========
  style: V2StyleAPI;

  // ========== P3：模板管理子域（复用 writing:template:* 通道） ==========
  templates: V2TemplateAPI;

  // ========== 流式事件监听（每个返回 unsubscribe 函数） ==========
  /** 大纲流式 chunk（通道 writing:stream:chunk） */
  onOutlineChunk: (callback: (data: V2OutlineStreamChunkEvent) => void) => () => void;
  /** 分片开始（通道 writing:chunk:start） */
  onShardStreamStart: (callback: (data: V2ShardStreamStartEvent) => void) => () => void;
  /** 分片内容增量（通道 writing:chunk:progress） */
  onShardStreamProgress: (callback: (data: V2ShardStreamProgressEvent) => void) => () => void;
  /** 分片思考流增量（通道 writing:chunk:reasoning，思考模型 reasoning_content 透出） */
  onShardStreamReasoning: (callback: (data: V2ShardStreamReasoningEvent) => void) => () => void;
  /** AI 味审核过程流式增量（通道 writing:deai:stream） */
  onDeAiStream: (callback: (data: V2DeAiStreamEvent) => void) => () => void;
  /** 跨章审查流式进度（通道 writing:crossCheck:stream） */
  onCrossCheckStream: (callback: (data: import('./cross-chapter-review.types').CrossCheckStreamEvent) => void) => () => void;
  /** 分片完成（通道 writing:chunk:complete） */
  onShardStreamComplete: (callback: (data: V2ShardStreamCompleteEvent) => void) => () => void;
  /** 分片错误（通道 writing:chunk:error） */
  onShardStreamError: (callback: (data: V2ShardStreamErrorEvent) => void) => () => void;

  // ========== 全流程创作流水线（新增 writing:pipeline:* 通道） ==========
  pipeline: PipelineAPI;

  // ========== 漫画解析子域（manga:* 通道） ==========
  manga: V2MangaAPI;
}

// ==================== 小说全流程创作流水线 API（Pipeline） ====================

/** 流水线阶段 */
export type PipelineStage =
  | 'IDLE'
  | 'INIT'
  | 'OUTLINE'
  | 'CHAPTER'
  | 'COMPOSE'
  | 'DONE'
  | 'ERROR';

/** 流水线错误码 */
export type PipelineErrorCode =
  | 'VALIDATION'
  | 'RESOURCE'
  | 'AI'
  | 'EXPORT'
  | 'CANCELLED'
  | 'INTERNAL';

/** runAll 中途失败时保留的部分结果 */
export interface PipelinePartialResult {
  projectId?: string;
  completedChapters: number;
}

/** 统一响应信封 */
export interface PipelineEnvelope<T = undefined> {
  success: boolean;
  data?: T;
  /** 可读中文错误（含失败阶段） */
  error?: string;
  code?: PipelineErrorCode;
  /** 失败发生的阶段 */
  stage?: PipelineStage;
  /** 部分结果（runAll 中途失败） */
  partial?: PipelinePartialResult;
}

/** 资源条目（id 与既有资源绑定语义一致：文件路径/相对路径） */
export interface PipelineResourceItem {
  id: string;
  name: string;
}

export interface PipelineResourcesData {
  characters: PipelineResourceItem[];
  worldBooks: PipelineResourceItem[];
}

/** 创建最小角色卡参数 */
export interface PipelineCreateCharacterParams {
  name: string;
  profile: string;
  personality: string;
  scenario?: string;
}

export interface PipelineCharacterResult {
  id: string;
  name: string;
}

/** 流水线初始化参数（项目 + 资源绑定） */
export interface PipelineInitParams {
  creativeDescription: string;
  /** 项目标题（缺省取创意描述前 20 字） */
  title?: string;
  novelType: string;
  narrativePerspective: string;
  writingStyle?: string;
  targetWordCount: number;
  chapterCount: number;
  characterCardIds: string[];
  worldBookIds: string[];
  modelConfig: ModelConfig;
}

export interface PipelineInitData {
  projectId: string;
}

export interface PipelineOutlineChapter {
  index: number;
  title: string;
  summary: string;
}

export interface PipelineOutlineData {
  chapterCount: number;
  chapters: PipelineOutlineChapter[];
}

export interface PipelineChapterData {
  chapterIndex: number;
  wordCount: number;
  shardCount: number;
}

export interface PipelineComposeData {
  filePath: string;
  wordCount: number;
  chapterCount: number;
}

export interface PipelineRunAllData {
  projectId: string;
  filePath: string;
  wordCount: number;
  chapterCount: number;
}

export interface PipelineStatusData {
  stage: PipelineStage;
  currentChapter: number;
  totalChapters: number;
  running: boolean;
}

/** 流水线进度事件（通道 writing:pipeline:progress） */
export interface PipelineProgressEvent {
  projectId: string;
  stage: PipelineStage;
  /** 当前进度（阶段内：分片/章节序号） */
  current: number;
  total: number;
  message: string;
  percent: number;
}

// ---------- E2E ----------

export interface PipelineE2EParams {
  /** smoke: 3 章 × 2000 字；full: 3 章共 20000 字；v2-integrated: 写作模式2.0整合测试（4 章 20000 字 + 表格整理 + 剧情审核单条修正 + 表格上下文注入） */
  scale: 'smoke' | 'full' | 'v2-integrated';
}

export interface PipelineE2EAssertion {
  name: string;
  passed: boolean;
  detail: string;
}

export interface PipelineE2EReport {
  scale: 'smoke' | 'full' | 'v2-integrated';
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  characterNames: string[];
  worldBookName: string;
  projectId: string;
  exportPath: string;
  wordCount: number;
  chapterCount: number;
  assertions: PipelineE2EAssertion[];
  verdict: 'PASS' | 'FAIL';
  error?: string;
  /** 模型基准（v2-integrated 专用；ModelConfig 可直接作为生成/检查/修正的模型配置） */
  modelBaseline?: ModelConfig;
  /** 素材选择结果（v2-integrated 专用；缺失资源记入 missingResources） */
  resources?: {
    worldBook: { id: string; name: string } | null;
    character: { id: string; name: string } | null;
    persona: { id: string; name: string } | null;
    writingStyle: string;
  };
  missingResources?: string[];
  /** 大纲基准（v2-integrated 专用） */
  outline?: { chapterCount: number; chapters: Array<{ index: number; title: string; summary: string }>; durationMs: number };
  /** 逐章整合测试记录（v2-integrated 专用） */
  chapters?: PipelineV2ChapterRecord[];
}

/** v2-integrated 单条修正记录 */
export interface PipelineV2IssueFixRecord {
  issueTitle: string;
  issueType: 'dimension' | 'logic';
  severity: string;
  success: boolean;
  diffCount: number;
  diffSample: string;
  error?: string;
  durationMs: number;
}

/** v2-integrated 章节创作记录 */
export interface PipelineV2ChapterRecord {
  index: number;
  title: string;
  generation: { startedAt: number; finishedAt: number; durationMs: number; wordCount: number; shardCount: number; tableInjectionChars: number; tableSheets: number; tableRows: number };
  plotCheck: { startedAt: number; finishedAt: number; durationMs: number; score: number; totalIssues: number; issues: Array<{ title: string; type: 'dimension' | 'logic'; severity: string; suggestion: string; originalText?: string }> } | null;
  fixes: { beforeWordCount: number; afterWordCount: number; successCount: number; failedCount: number; records: PipelineV2IssueFixRecord[] } | null;
  table: { startedAt: number; finishedAt: number; durationMs: number; success: boolean; sheets: number; rows: number; verify: { fieldComplete: boolean; rowMatches: boolean; contentMatches: boolean; keyAlignment: boolean; detail: string } } | null;
}

export interface PipelineE2EResult {
  report: PipelineE2EReport;
}

/**
 * 全流程创作流水线 API
 * 端点（IPC 通道）：writing:pipeline:*，详见 docs/writing-pipeline-api.md
 */
export interface PipelineAPI {
  /** 列出可选角色卡/世界书（通道 writing:pipeline:listResources） */
  listResources: () => Promise<PipelineEnvelope<PipelineResourcesData>>;
  /** 创建最小角色卡（通道 writing:pipeline:createCharacterCard） */
  createCharacterCard: (
    params: PipelineCreateCharacterParams
  ) => Promise<PipelineEnvelope<PipelineCharacterResult>>;
  /** 初始化项目 + 资源绑定（通道 writing:pipeline:init） */
  init: (params: PipelineInitParams) => Promise<PipelineEnvelope<PipelineInitData>>;
  /** 生成大纲并落盘（通道 writing:pipeline:generateOutline） */
  generateOutline: (projectId: string) => Promise<PipelineEnvelope<PipelineOutlineData>>;
  /** 生成单章（分片大纲→逐分片→合并落盘，通道 writing:pipeline:generateChapter） */
  generateChapter: (
    projectId: string,
    chapterIndex: number,
    shardCount?: number
  ) => Promise<PipelineEnvelope<PipelineChapterData>>;
  /** 成书导出（通道 writing:pipeline:compose） */
  compose: (
    projectId: string,
    format: ExportFormat,
    chapterIndices?: number[]
  ) => Promise<PipelineEnvelope<PipelineComposeData>>;
  /** 一键全流程：init → outline → 逐章 → compose（通道 writing:pipeline:runAll） */
  runAll: (params: PipelineInitParams) => Promise<PipelineEnvelope<PipelineRunAllData>>;
  /** 流水线状态（通道 writing:pipeline:status） */
  status: (projectId: string) => Promise<PipelineEnvelope<PipelineStatusData>>;
  /** 取消（当前分片完成后停止后续流程，通道 writing:pipeline:cancel） */
  cancel: (projectId: string) => Promise<PipelineEnvelope>;
  /** dev-only E2E 执行器（通道 writing:pipeline:runE2E，非 dev 拒绝） */
  runE2E: (params: PipelineE2EParams) => Promise<PipelineEnvelope<PipelineE2EResult>>;
  /** 流水线进度事件（通道 writing:pipeline:progress） */
  onProgress: (callback: (event: PipelineProgressEvent) => void) => () => void;
}

// ==================== 漫画解析模式（Spec: integrate-comic-parsing-mode） ====================

/** 阅读顺序 */
export type MangaReadingOrder = 'leftToRight' | 'rightToLeft';

/** 漫画文本源语言（辅助 AI 文本提取） */
export type MangaSourceLanguage =
  | 'japanese'
  | 'chinese'
  | 'english'
  | 'korean'
  | 'french'
  | 'spanish'
  | 'german'
  | 'russian'
  | 'other';

/** 漫画色彩模式 */
export type MangaColorMode = 'bw' | 'color';

/** 漫画类型（每种类型注入不同的 AI 解析提示，辅助理解图片内容） */
export type MangaComicType =
  | 'doujinshi' // 同人志（同人漫画）
  | 'manga' // 漫画（日式漫画）
  | 'artist-cg' // 画师原创 CG 插画
  | 'game-cg' // 游戏 CG（游戏截图 / 游戏原画）
  | 'western' // 欧美向作品
  | 'non-h' // 非成人向、全年龄
  | 'image-set' // 图片合集
  | 'cosplay' // 角色扮演（cos 照）
  | 'asian-porn' // 亚洲成人影像
  | 'misc'; // 杂项、其他分类

/** 漫画背景信息（用户提供，辅助 AI 理解漫画内容） */
export interface MangaMetaInfo {
  /** 漫画名称 */
  title?: string;
  /** 主要角色（姓名 + 简要描述） */
  characters?: string;
  /** 漫画主题/题材（如 科幻冒险 / 校园日常） */
  theme?: string;
  /** 故事背景/其他补充说明 */
  background?: string;
  /** 文本源语言（如 日文/英文，辅助文本提取，不填则自动识别） */
  sourceLanguage?: MangaSourceLanguage;
  /** 色彩模式（黑白/彩色，辅助场景分析，不填则自动识别） */
  colorMode?: MangaColorMode;
  /** 漫画类型（辅助 AI 按类型特点理解画面，不填则按通用漫画处理） */
  comicType?: MangaComicType;
}

/** 已解析漫画记录（应用级全局持久化，漫画解析页签以列表展示、可恢复继续解析） */
export interface MangaComicRecord {
  id: string;
  /** 来源文件夹绝对路径（按此去重） */
  folderPath: string;
  /** 文件夹名（展示用） */
  folderName: string;
  /** 导入时的页面列表 */
  pages: MangaPage[];
  readingOrder: MangaReadingOrder;
  /** 已完成的逐页分析（含用户修正） */
  analyses: Array<{ pageIndex: number; analysis: MangaPageAnalysis }>;
  /** 漫画背景信息快照（记录自包含，与项目解耦） */
  mangaMeta?: MangaMetaInfo;
  /** 已生成的故事大纲快照（Markdown，随记录持久化，重开漫画时恢复） */
  outline?: string;
  createdAt: number;
  updatedAt: number;
}

/** 漫画页面文件信息 */
export interface MangaPage {
  /** 页面序号（1-based，按文件名数字前缀排序） */
  index: number;
  /** 文件名（如 "01.png"） */
  fileName: string;
  /** 绝对路径 */
  absolutePath: string;
  /** 文件大小（字节） */
  fileSize: number;
}

/** 漫画文本提取（单条对话/旁白/拟音） */
export interface MangaTextExtraction {
  /** 文本内容 */
  content: string;
  /** 文本类型 */
  type: 'dialogue' | 'narration' | 'soundEffect';
  /** 位置描述（如 "top-center"） */
  position: string;
}

/** 漫画格子（分镜）分析 */
export interface MangaPanelAnalysis {
  /** 格子序号（按阅读顺序） */
  panelIndex: number;
  /** 该格剧情描述 */
  plot: string;
  /** 该格情绪描述 */
  emotion: string;
  /** 该格内的文本提取 */
  texts: MangaTextExtraction[];
}

/** 角色分析（单页内） */
export interface MangaCharacterAnalysis {
  /** 角色名或描述 */
  name: string;
  /** 表情描述 */
  expression: string;
  /** 动作描述 */
  action: string;
}

/** 场景分析（单页） */
export interface MangaSceneAnalysis {
  /** 环境描述 */
  environment: string;
  /** 时间 */
  time: string;
  /** 地点 */
  location: string;
  /** 氛围 */
  atmosphere: string;
}

/** 单页漫画完整分析结果 */
export interface MangaPageAnalysis {
  /** AI 返回的结构化分析 */
  pageAnalysis: {
    characters: MangaCharacterAnalysis[];
    scene: MangaSceneAnalysis;
    panels: MangaPanelAnalysis[];
    overallEmotion: string;
    narrativeContinuity: string;
  };
  /** 分析时的阅读顺序 */
  readingOrder: MangaReadingOrder;
  /** 分析时间戳 */
  analyzedAt: number;
  /** 用户是否手动修正过 */
  userModified: boolean;
}

/** 单页摘要（用于跨页上下文表格） */
export interface MangaPageSummary {
  /** 页面序号 */
  pageIndex: number;
  /** 角色简要（如 "小明(兴奋), 神秘人(严肃)"） */
  characters: string;
  /** 场景简要（如 "学校走廊/白天"） */
  scene: string;
  /** 关键剧情（取首个分镜剧情，兼容旧字段） */
  keyPlot: string;
  /** 情感基调 */
  emotion: string;
  /** 重要对话（最多 1 条） */
  keyDialogue: string;
  /** 分镜数量 */
  panelCount: number;
  /** 逐分镜剧情（"分镜1: …；分镜2: …"，保留全部分镜） */
  panelPlots: string;
  /** 角色动作摘要（"角色名: 动作; …"） */
  actions: string;
  /** 关键文本摘录（对话/旁白/拟音，带引号与类型，总长截断 300 字） */
  texts: string;
  /** 叙事衔接说明（与前后页的关联） */
  continuity: string;
}

/** 角色跨页汇总 */
export interface MangaCharacterSummary {
  /** 角色名 */
  name: string;
  /** 出现记录 */
  appearances: Array<{
    pageIndex: number;
    expression: string;
    action: string;
  }>;
}

/** 章节切分建议 */
export interface MangaChapterSuggestion {
  chapterIndex: number;
  title: string;
  summary: string;
  /** 对应页码范围 [起始页, 结束页] */
  pageRange: [number, number];
}

/** 全书漫画分析完整结果 */
export interface MangaAnalysisResult {
  pages: MangaPageAnalysis[];
  characters: MangaCharacterSummary[];
  storyOutline: string;
  chapterSuggestions: MangaChapterSuggestion[];
  folderPath: string;
  totalPages: number;
  analyzedAt: number;
  /** 用户提供的漫画背景信息（可选，导出 Markdown 时写入「漫画信息」段） */
  mangaMeta?: MangaMetaInfo;
}

// ---------- 漫画解析 IPC 结果类型 ----------

/** 文件夹扫描结果（manga:scanFolder） */
export interface V2MangaScanResult {
  success: boolean;
  pages: MangaPage[];
  total: number;
  error?: string;
}

/** 单页分析结果（manga:analyzePage） */
export interface V2MangaAnalyzeResult {
  success: boolean;
  analysis: MangaPageAnalysis | null;
  summary: MangaPageSummary | null;
  /** 用户主动停止（manga:cancel）时为 true，前端据此提示"已停止"而非报错 */
  cancelled?: boolean;
  error?: string;
}

/** 上下文表格生成结果（manga:buildContextTable） */
export interface V2MangaContextResult {
  success: boolean;
  table: string;
  error?: string;
}

/** 故事大纲生成结果（manga:generateOutline） */
export interface V2MangaOutlineResult {
  success: boolean;
  outline: string;
  /** 用户主动停止（manga:cancel）时为 true */
  cancelled?: boolean;
  error?: string;
}

/**
 * 漫画大纲 AI 审核结果（manga:auditOutline）
 * 与世界书条目 AI 审核（world-book.audit-content）同款审核契约：
 * 重点检测 AI 味（去AI味规则约束），通过/不通过 + 修订/优化文本
 */
export interface V2MangaAudit {
  /** 是否通过审核（无明显 AI 味且内容完整 = true） */
  passed: boolean;
  /** 问题列表（逐条具体问题描述，与章节 AI 味审核 issues 对齐；无问题时为空数组） */
  issues: string[];
  /** 审核说明（具体原因/问题位置） */
  suggestions: string;
  /** 审核并修改后的文本（通过时为原文，不通过时为去 AI 味修订版） */
  revisedText: string;
  /** 优化建议（仅 passed=true 时填写） */
  optimizationSuggestions?: string;
  /** 优化后文本（仅 passed=true 时填写，无优化空间时为原文） */
  optimizedText?: string;
}

/** 大纲 AI 审核结果（manga:auditOutline） */
export interface V2MangaAuditResult {
  success: boolean;
  audit?: V2MangaAudit | null;
  /** 用户主动停止（manga:cancel）时为 true */
  cancelled?: boolean;
  error?: string;
}

/**
 * AI 生成的写作项目草稿（manga:generateProjectDraft）
 * 基于全部解析内容自动补全项目创建字段，经用户确认调整后创建项目
 */
export interface V2MangaProjectDraft {
  /** 项目名称（≤20 字，创建后覆盖由创意描述截取的项目名） */
  title: string;
  /** 创意描述（≥10 字，基于漫画内容生成） */
  creativeDescription: string;
  novelType: NovelType;
  narrativePerspective: NarrativePerspective;
  writingStyle: WritingStyle;
  targetWordCount: number;
  chapterCount: number;
  additionalRequirements?: string;
}

/** 项目草稿生成结果（manga:generateProjectDraft） */
export interface V2MangaProjectDraftResult {
  success: boolean;
  draft?: V2MangaProjectDraft | null;
  /** 用户主动停止（manga:cancel）时为 true */
  cancelled?: boolean;
  error?: string;
}

/** 角色信息 AI 生成结果（manga:generateCharacterInfo，Spec: add-ai-character-gen-to-manga-meta） */
export interface V2MangaCharacterGenResult {
  success: boolean;
  /** 格式化后的角色描述文本，每角色一行「姓名（定位）：外貌；性格」，成功时回填至主要角色字段 */
  charactersText?: string;
  /** 用户主动停止（manga:cancel）时为 true */
  cancelled?: boolean;
  error?: string;
}

/** 导出结果（manga:exportAnalysis） */
export interface V2MangaExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

/**
 * 漫画解析子域 API（preload `writingV2.manga`，通道 manga:*）。
 */
export interface V2MangaAPI {
  /** 扫描文件夹内图片文件，按数字序号排序（通道 manga:scanFolder） */
  scanFolder: (folderPath: string) => Promise<V2MangaScanResult>;
  /** 单页漫画多模态 AI 分析（通道 manga:analyzePage） */
  analyzePage: (params: {
    imagePath: string;
    readingOrder: MangaReadingOrder;
    previousSummaries: MangaPageSummary[];
    pageIndex: number;
    /** 用户对页面内容的引导提示（可选），注入 AI 提示词辅助识别 */
    userGuidance?: string;
    /** 漫画背景信息（可选），注入 AI 提示词辅助角色识别与剧情理解 */
    mangaMeta?: MangaMetaInfo;
    /** 用户自定义提示词（可选），注入 system prompt 末尾（最高优先级） */
    customPrompt?: string;
  }) => Promise<V2MangaAnalyzeResult>;
  /** 生成跨页上下文 Markdown 表格（通道 manga:buildContextTable） */
  buildContextTable: (summaries: MangaPageSummary[]) => Promise<V2MangaContextResult>;
  /** 基于全部页面分析生成故事大纲（通道 manga:generateOutline，可选携带漫画背景信息与自定义提示词） */
  generateOutline: (
    summaries: MangaPageSummary[],
    mangaMeta?: MangaMetaInfo,
    customPrompt?: string
  ) => Promise<V2MangaOutlineResult>;
  /**
   * 大纲 AI 审核：检测 AI 味 + 内容完整性，返回 issues 问题列表 + 修订/优化文本（通道 manga:auditOutline）。
   * 审核规则与章节「检查 AI 味」同款（HUMANIZER_POLISH_RULES）；
   * summaries 传入时以漫画解析全文作为完整性/一致性审核的源素材参照；
   * customPrompt 为用户自定义审核要求（可选，最高优先级）。
   */
  auditOutline: (
    outline: string,
    mangaMeta?: MangaMetaInfo,
    summaries?: MangaPageSummary[],
    customPrompt?: string
  ) => Promise<V2MangaAuditResult>;
  /** 基于全部解析内容 + 大纲，AI 生成写作项目字段草稿（通道 manga:generateProjectDraft，可选自定义提示词） */
  generateProjectDraft: (
    summaries: MangaPageSummary[],
    outline: string,
    mangaMeta?: MangaMetaInfo,
    customPrompt?: string
  ) => Promise<V2MangaProjectDraftResult>;
  /**
   * 角色信息 AI 生成（通道 manga:generateCharacterInfo，Spec: add-ai-character-gen-to-manga-meta）。
   * 基于上传的人物图片识别视觉特征，结合漫画整体分析结果（summaries 经 buildContextTable 注入）、
   * 当前表单漫画背景（mangaMeta）与已有角色文本（currentCharacters），生成格式化角色描述。
   */
  generateCharacterInfo: (params: {
    /** 人物参考图片的本地路径（渲染层经 file:selectFile 选择） */
    imagePath: string;
    /** 当前漫画全部页面分析摘要（可选，空数组表示新建模式无分析结果） */
    summaries?: MangaPageSummary[];
    /** 当前表单中的漫画背景信息（可选） */
    mangaMeta?: MangaMetaInfo;
    /** 主要角色字段已有文本（可选，AI 需整合保留其中的有效信息） */
    currentCharacters?: string;
    /** 用户自定义提示词（可选，注入 system prompt 末尾，最高优先级） */
    customPrompt?: string;
  }) => Promise<V2MangaCharacterGenResult>;
  /**
   * 中止进行中的漫画类 AI 请求（通道 manga:cancel）。
   * key 缺省时取消全部（页面分析/大纲生成/大纲审核/项目草稿生成/角色信息生成）。
   */
  cancel: (key?: 'analyzePage' | 'generateOutline' | 'auditOutline' | 'generateProjectDraft' | 'generateCharacterInfo') => Promise<{
    success: boolean;
    cancelledCount: number;
  }>;
  /** 导出分析结果为 Markdown 文件（通道 manga:exportAnalysis） */
  exportAnalysis: (params: {
    result: MangaAnalysisResult;
    savePath: string;
  }) => Promise<V2MangaExportResult>;
}
