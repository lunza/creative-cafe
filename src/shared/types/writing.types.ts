// 写作模式共享类型定义

// 小说类型
export enum NovelType {
  WEB_NOVEL = 'web_novel',
  ROMANCE = 'romance',
  MARTIAL_ARTS = 'martial_arts',
  FANTASY = 'fantasy',
  FANTASY_MAGIC = 'fantasy_magic',
  MYSTERY = 'mystery',
  SCI_FI = 'sci_fi',
  HISTORICAL = 'historical',
  URBAN = 'urban',
  DOCUMENTARY = 'documentary',
  EROTIC = 'erotic',
  OTHER = 'other'
}

// 叙事视角
export enum NarrativePerspective {
  FIRST_PERSON = 'first_person',
  THIRD_PERSON = 'third_person',
  OMNISCIENT = 'omniscient'
}

// 写作风格
export enum WritingStyle {
  RELAXED = 'relaxed',
  SERIOUS = 'serious',
  HUMOROUS = 'humorous',
  SUSPENSEFUL = 'suspenseful',
  ROMANTIC = 'romantic',
  EPIC = 'epic',
  DETAILED = 'detailed'
}

// 项目状态
export enum ProjectStatus {
  DRAFT = 'draft',
  OUTLINING = 'outlining',
  WRITING = 'writing',
  COMPLETED = 'completed'
}

// 章节状态
export enum ChapterStatus {
  PENDING = 'pending',
  GENERATING = 'generating',
  GENERATED = 'generated',
  CHECKED = 'checked',
  FIXED = 'fixed',
  ORGANIZED = 'organized',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

// 章节类型
export enum ChapterType {
  MAIN_PLOT = 'main_plot',
  SUB_PLOT = 'sub_plot',
  TRANSITION = 'transition',
  CLIMAX = 'climax',
  ENDING = 'ending'
}

// 重要程度
export enum ImportanceLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

// 生成模式
export enum GenerationMode {
  SINGLE = 'single',
  CONTINUOUS = 'continuous'
}

// 写作模式视图
export enum WritingModeView {
  PROJECT_LIST = 'project_list',
  CONFIG = 'config',
  OUTLINE_GENERATING = 'outline_generating',
  OUTLINE_EDITING = 'outline_editing',
  CONTENT_GENERATING = 'content_generating',
  CONTENT_EDITING = 'content_editing',
  CONTENT_GENERATION = 'content_generation'
}

// 生成状态
export enum GenerationState {
  IDLE = 'idle',
  PREPARING = 'preparing',
  GENERATING = 'generating',
  STREAMING = 'streaming',
  SAVING = 'saving',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  STOPPED = 'stopped',
  ERROR = 'error'
}

// 导出格式
export enum ExportFormat {
  TXT = 'txt',
  MARKDOWN = 'md',
  JSON = 'json'
}

// 错误代码
export enum WritingErrorCode {
  CONFIG_VALIDATION = 'CONFIG_VALIDATION',
  RESOURCE_LOAD_FAILED = 'RESOURCE_LOAD_FAILED',
  OUTLINE_GENERATION_FAILED = 'OUTLINE_GENERATION_FAILED',
  CONTENT_GENERATION_FAILED = 'CONTENT_GENERATION_FAILED',
  CONTEXT_OVERFLOW = 'CONTEXT_OVERFLOW',
  AI_SERVICE_UNAVAILABLE = 'AI_SERVICE_UNAVAILABLE',
  SAVE_FAILED = 'SAVE_FAILED',
  USER_CANCELLED = 'USER_CANCELLED',
  TIMEOUT = 'TIMEOUT'
}

// 参考资料
export interface ReferenceMaterial {
  id: string;
  type: 'text' | 'file';
  content: string;
  name: string;
}

// 资源配置
export interface WritingResourceConfig {
  worldBookIds: string[];
  characterCardIds: string[];
  userPersonaIds?: string[];
  knowledgeItemIds?: string[];
  referenceMaterials?: ReferenceMaterial[];
  writingStyleIds?: string[];
}

// 素材类型
export type MaterialType = 'worldbook' | 'character' | 'persona' | 'knowledge' | 'writing-style';

// 素材项
export interface MaterialItem {
  id: string;
  name: string;
  type: MaterialType;
  description?: string;
  path: string;
  isSelected: boolean;
  metadata?: Record<string, any>;
}

// 创作参数
export interface WritingParameters {
  creativeDescription: string;
  novelType: NovelType;
  targetWordCount: number;
  chapterCount: number;
  narrativePerspective: NarrativePerspective;
  writingStyle?: WritingStyle;
  additionalRequirements?: string;
  forbiddenContent?: string[];
  includeEnding?: boolean;
  chapterRangeStart?: number;
  chapterRangeEnd?: number;
}

// 模型配置
export interface ModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

// 思考链
export interface ChainOfThought {
  rawData: string;
  formattedData: string;
  timestamp: number;
  model: string;
}

// 创作配置
export interface WritingConfig {
  resources: WritingResourceConfig;
  parameters: WritingParameters;
  modelConfig: ModelConfig;
  manualMode?: boolean;
  chainOfThought?: ChainOfThought;
}

// 大纲生成请求
export interface OutlineGenerationRequest {
  resources: WritingResourceConfig;
  parameters: WritingParameters;
  modelConfig: ModelConfig;
}

// 大纲生成结果
export interface OutlineGenerationResult {
  outline: GeneratedOutline;
  rawContent: string;
  chainOfThought?: ChainOfThought;
}

// 章节信息
export interface ChapterInfo {
  index: number;
  title: string;
  outline: string;
  characters: string[];
  scenes: string[];
}

// 内容生成请求
export interface ContentGenerationRequest {
  chapterInfo: ChapterInfo;
  previousChapters: {
    index: number;
    title: string;
    summary: string;
    fullContent?: string;
  }[];
  worldBookContext: {
    entryName: string;
    content: string;
    keywords?: string[];
    relevance: number;
  }[];
  characterContext: {
    name: string;
    description: string;
    personality: string;
    mesExample?: string;
  }[];
  userPersonaContext?: {
    name: string;
    description: string;
    traits: string[];
  }[];
  knowledgeContext?: {
    title: string;
    content: string;
    relevance: number;
  }[];
  generationParams: {
    targetWordCount: number;
    style: string;
    perspective: string;
    novelType?: string;
    constraints?: string[];
    writingStyleContext?: string;
  };
  modelConfig: ModelConfig;
  projectId?: string;
  chapterIndex?: number;
  resources?: {
    worldBookIds?: string[];
    characterCardIds?: string[];
    userPersonaIds?: string[];
    knowledgeItemIds?: string[];
    writingStyleIds?: string[];
  };
  writingTableData?: {
    tableConfig?: {
      associatedTemplateId: string;
      associatedTemplateName: string;
    };
    sheets?: string[];
    headers?: Record<string, string[]>;
    data?: Record<string, Record<string, any>[]>;
    sheetDescriptions?: Record<string, string>;
  };
  userSuggestion?: string;
  regenerationSuggestion?: RegenerationSuggestion;
  previousChapterContent?: string; // 上一次生成的完整内容（重新生成时引用）
  generationGuidance?: string; // 持久化的章节创作指导建议
}

// 章节生成用户建议（简洁模式）
export interface GenerationSuggestion {
  suggestion: string;
}

// 章节重新生成结构化建议（高级模式）
export interface RegenerationSuggestion {
  keepContent: string;    // 需保留的优秀部分
  discardContent: string; // 需舍弃的不佳部分
  adjustContent: string;  // 需调整的部分及具体指示
  addContent: string;     // 需新增的部分及具体指示
}

// 作品信息
export interface WorkInfo {
  suggestedTitle: string;
  novelType: NovelType;
  estimatedWordCount: number;
  chapterCount: number;
  creativeDescription?: string;
  isComplete?: boolean;
}

// 故事主线
export interface StoryLine {
  coreConflict: string;
  storyArc: {
    beginning: string;
    development: string;
    climax: string;
    resolution: string;
  };
  theme: string;
}

// 增强版故事主线（支持更全面的故事设定）
export interface EnhancedStoryLine extends StoryLine {
  backstory?: string;
  setting?: string;
  tone?: string;
  genre?: string[];
  subplots?: {
    name: string;
    description: string;
    relatedChapters: number[];
  }[];
  majorEvents?: {
    title: string;
    description: string;
    chapterRange: [number, number];
  }[];
}

// 章节大纲
export interface ChapterOutline {
  index: number;
  title: string;
  summary: string;
  keyPlotPoints: string[];
  characters: string[];
  scenes: string[];
  suspensePoints?: string[];
  targetWordCount: number;
  chapterType?: ChapterType;
  importance?: ImportanceLevel;
  children?: ChapterOutline[];
  content?: string;
  importantSpans?: string[];
  status?: ChapterStatus;
  wordCount?: number;
  chainOfThought?: ChainOfThought;
  versions?: ChapterVersion[];
  lastModified?: number;
  generationGuidance?: string;
  generationInfo?: {
    model: string;
    temperature: number;
    tokensUsed: number;
    generationTime: number;
    generatedAt: number;
  };
}

// 角色关系
export interface CharacterRelationship {
  name: string;
  role: string;
  relationships: {
    targetCharacter: string;
    relationshipType: string;
    description: string;
  }[];
}

// 角色详情（增强版）
export interface CharacterDetail {
  id: string;
  name: string;
  role: string;
  description: string;
  personality: string;
  background: string;
  motivations: string;
  conflicts: string;
  development: string;
  relationships: {
    targetCharacterId: string;
    targetCharacterName: string;
    relationshipType: string;
    description: string;
  }[];
  tags?: string[];
}

// 角色关系网络
export interface CharacterRelationshipNetwork {
  characters: CharacterDetail[];
  relationships: {
    fromCharacterId: string;
    toCharacterId: string;
    type: string;
    description: string;
    intensity: 'low' | 'medium' | 'high' | 'critical';
  }[];
}

// 世界观要点
export interface WorldbuildingNotes {
  category: string;
  points: string[];
}

// 世界观设定
export interface WorldSetting {
  id: string;
  name: string;
  category: string;
  description: string;
  details: string[];
  relatedCharacters?: string[];
  relatedChapters?: number[];
  importance?: ImportanceLevel;
}

// 世界观分组
export interface WorldSettingGroup {
  id: string;
  name: string;
  description: string;
  settings: WorldSetting[];
}

// 大纲编辑区域
export enum OutlineEditSection {
  STORYLINE = 'storyline',
  CHARACTERS = 'characters',
  WORLD = 'world',
  CHAPTERS = 'chapters',
}

// 大纲编辑模式
export enum OutlineEditMode {
  AI_GENERATED = 'ai_generated',
  MANUAL_EDIT = 'manual_edit',
  AI_ASSISTED = 'ai_assisted',
}

// 大纲版本信息
export interface OutlineVersion {
  id: string;
  outline: GeneratedOutline;
  timestamp: number;
  note?: string;
  source: 'auto_save' | 'manual_save' | 'ai_generation' | 'ai_edit' | 'restore';
  isCurrent: boolean;
}

// AI编辑意图
export interface AIEditIntent {
  type: 'storyline' | 'chapter' | 'character' | 'world' | 'continuation';
  instruction: string;
  targetSection?: OutlineEditSection;
  targetId?: string;
  context?: Record<string, any>;
}

// AI编辑结果
export interface AIEditResult {
  success: boolean;
  content?: string;
  changes?: Record<string, any>;
  suggestions?: string[];
  error?: string;
}

// 大纲变更影响分析
export interface OutlineImpactAnalysis {
  affectedChapters: number[];
  affectedCharacters: string[];
  affectedWorldSettings: string[];
  severity: 'low' | 'medium' | 'high';
  description: string;
}

// 生成的大纲
export interface GeneratedOutline {
  workInfo: WorkInfo;
  storyLine: StoryLine;
  chapters: ChapterOutline[];
  characterRelationships: CharacterRelationship[];
  worldbuildingNotes: WorldbuildingNotes[];
  version?: number;
}

// 章节版本
export interface ChapterVersion {
  id: string;
  content: string;
  timestamp: number;
  note?: string;
  isAutoGenerated: boolean;
}

// 章节
export interface Chapter {
  index: number;
  title: string;
  outline: {
    summary: string;
    keyPlotPoints: string[];
    characters: string[];
    scenes: string[];
    suspensePoints?: string[];
    targetWordCount: number;
  };
  content: string;
  status: ChapterStatus;
  wordCount: number;
  versions: ChapterVersion[];
  generationInfo?: {
    model: string;
    temperature: number;
    tokensUsed: number;
    generationTime: number;
    generatedAt: number;
  };
  lastModified: number;
}

// 项目元数据
export interface ProjectMetadata {
  totalWordCount: number;
  completedChapters: number;
  generationSettings: {
    model: string;
    temperature: number;
  };
  continuityInfo: {
    foreshadowing: string[];
    plotThreads: string[];
    characterDevelopment: Record<string, string>;
  };
}

// 写作项目
export interface WritingProject {
  id: string;
  title: string;
  status: ProjectStatus;
  config: WritingConfig;
  outline: GeneratedOutline | null;
  outlineRaw: string | null;
  createdAt: number;
  updatedAt: number;
  lastSavedAt: number;
  metadata: ProjectMetadata;
  aiGenerationHistory?: AIGenerationHistory[];
}

// 生成内容
export interface GeneratedContent {
  chapter: {
    index: number;
    title: string;
    wordCount: number;
  };
  content: string;
  metadata: {
    model: string;
    temperature: number;
    tokensUsed: number;
    generationTime: number;
    finishReason: string;
  };
  continuity: {
    foreshadowing: string[];
    plotThreads: string[];
    characterDevelopment: string[];
  };
}

// 写作错误
export interface WritingError {
  code: WritingErrorCode;
  message: string;
  details?: string;
  recoverable: boolean;
  errorType?: 'timeout' | 'network' | 'service' | 'unknown';
}

// 流式数据
export interface StreamChunkData {
  projectId: string;
  chapterIndex: number;
  chunk: string;
}

export interface StreamCompleteData {
  projectId: string;
  chapterIndex: number;
  content: string;
  metadata: {
    model: string;
    temperature: number;
    tokensUsed: number;
    generationTime: number;
    finishReason: string;
  };
}

export interface StreamErrorData {
  projectId: string;
  chapterIndex: number;
  error: WritingError;
}

// 世界书上下文
export interface WorldBookContext {
  id: string;
  name: string;
  content: string;
  entries?: {
    uid: string;
    name: string;
    content: string;
    keywords: string[];
  }[];
}

// 角色卡上下文
export interface CharacterCardContext {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario?: string;
  firstMessage?: string;
  mesExample?: string;
}

export interface UserPersonaContext {
  id: string;
  name: string;
  description: string;
  avatarPath?: string;
}

// 上下文条目
export interface ContextItem {
  id: string;
  source: string;
  content: string;
  score: number;
  metadata?: Record<string, any>;
}

// 检索选项
export interface RetrieveOptions {
  topK?: number;
  minScore?: number;
  sources?: string[];
  scopeIds?: string[];
  filter?: Record<string, any>;
}

// 生成元数据
export interface GenerationMetadata {
  model: string;
  temperature: number;
  tokensUsed: number;
  generationTime: number;
  finishReason: string;
}

// 大纲操作类型（用于撤销/重做）
export enum OutlineActionType {
  ADD_CHAPTER = 'add_chapter',
  DELETE_CHAPTER = 'delete_chapter',
  UPDATE_CHAPTER = 'update_chapter',
  MOVE_CHAPTER = 'move_chapter',
  MERGE_CHAPTERS = 'merge_chapters',
  SPLIT_CHAPTER = 'split_chapter',
  ADD_SUB_CHAPTER = 'add_sub_chapter',
  DELETE_SUB_CHAPTER = 'delete_sub_chapter',
  MOVE_SUB_CHAPTER = 'move_sub_chapter'
}

// 大纲操作记录
export interface OutlineAction {
  type: OutlineActionType;
  timestamp: number;
  // 操作前的状态（用于撤销）
  before: any;
  // 操作后的状态（用于重做）
  after: any;
  // 操作描述（用于UI显示）
  description: string;
}

// 大纲历史状态
export interface OutlineHistoryState {
  // 章节列表快照
  chapters: ChapterOutline[];
  // 时间戳
  timestamp: number;
  // 操作描述
  description: string;
  // 是否自动保存
  isAutoSave?: boolean;
}

// AI辅助拆分/合并相关类型
export interface AISplitSuggestion {
  splitCount: number;
  titles: string[];
  summaries: string[];
  targetWordCounts: number[];
  keyPlotPoints: string[][];
  confidence: number;
  rawResponse?: string;
}

export interface AIMergeSuggestion {
  mergedTitle: string;
  mergedSummary: string;
  mergedTargetWordCount: number;
  mergedKeyPlotPoints: string[];
  chapterIndices: number[];
  confidence: number;
  rawResponse?: string;
}

export type AIGenerationSuggestion = AISplitSuggestion | AIMergeSuggestion;

export interface AIGenerationHistory {
  id: string;
  type: 'split' | 'merge';
  timestamp: number;
  sourceChapterIndices: number[];
  suggestion: AIGenerationSuggestion;
  isAccepted: boolean;
}

// 写作风格状态
export enum WritingStyleStatus {
  LEARNING = 'LEARNING',
  PROCESSING = 'PROCESSING',
  ANALYZING = 'ANALYZING',
  INTEGRATING = 'INTEGRATING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

// 写作风格阶段
export enum WritingStylePhase {
  FILE_READING = 'FILE_READING',
  TEXT_SPLITTING = 'TEXT_SPLITTING',
  BATCH_ANALYSIS = 'BATCH_ANALYSIS',
  RESULT_INTEGRATION = 'RESULT_INTEGRATION',
  COMPLETED = 'COMPLETED'
}

// 写作风格进度
export interface WritingStyleProgress {
  phase: WritingStylePhase;
  currentChunk: number;
  totalChunks: number;
  status: WritingStyleStatus;
  message: string;
}

// 写作风格分析结果
export interface WritingStyleAnalysis {
  styleOverview: Record<string, any>;
  coreTechniques: string[];
  languageFeatures: Record<string, any>;
  narrativeStructure: Record<string, any>;
  imitableElements: Record<string, any>;
  fullReport: string;
}

// 写作风格资源
export interface WritingStyleResource {
  id: string;
  name: string;
  sourceFile: string;
  fileSize: number;
  analysis: WritingStyleAnalysis | null;
  createdAt: number;
  status: WritingStyleStatus;
  progress: WritingStyleProgress;
}

// 写作风格学习请求
export interface WritingStyleLearningRequest {
  filePath: string;
  fileName: string;
  fileSize: number;
}

// 写作风格分块分析结果
export interface WritingStyleChunkAnalysis {
  chunkIndex: number;
  styleOverview: Record<string, any>;
  coreTechniques: string[];
  languageFeatures: Record<string, any>;
  narrativeStructure: Record<string, any>;
  imitableElements: Record<string, any>;
  partialReport: string;
}

// 剧情检查相关类型
export enum PlotCheckDimension {
  OUTLINE_CONSISTENCY = 'outline_consistency',
  WORLDBOOK_COMPLIANCE = 'worldbook_compliance',
  CHARACTER_CONSISTENCY = 'character_consistency',
  WRITING_STYLE = 'writing_style',
  PLOT_CONTINUITY = 'plot_continuity'
}

export const PLOT_CHECK_DIMENSION_LABELS: Record<PlotCheckDimension, string> = {
  [PlotCheckDimension.OUTLINE_CONSISTENCY]: '大纲一致性',
  [PlotCheckDimension.WORLDBOOK_COMPLIANCE]: '世界书遵循',
  [PlotCheckDimension.CHARACTER_CONSISTENCY]: '角色符合度',
  [PlotCheckDimension.WRITING_STYLE]: '写作风格统一性',
  [PlotCheckDimension.PLOT_CONTINUITY]: '剧情连贯性'
};

export enum IssueSeverity {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low'
}

export const ISSUE_SEVERITY_LABELS: Record<IssueSeverity, string> = {
  [IssueSeverity.HIGH]: '高',
  [IssueSeverity.MEDIUM]: '中',
  [IssueSeverity.LOW]: '低'
};

export interface PlotCheckIssue {
  dimension: PlotCheckDimension;
  severity: IssueSeverity;
  title: string;
  description: string;
  suggestion: string;
  position?: {
    startIndex: number;
    endIndex: number;
    line?: number;
    column?: number;
  };
  originalText?: {
    snippet: string;
    start: number;
    end: number;
  }[];
  references?: {
    type: string;
    name: string;
    summary: string;
  }[];
  fixable?: boolean;
  fixed?: boolean;
  fixResult?: string;
  quickFixable?: boolean;
  quickFixSuggestion?: QuickFixSuggestion;
  corrected?: boolean;
  correctedText?: string;
}

export interface DimensionScore {
  dimension: PlotCheckDimension;
  score: number;
  maxScore: number;
  issues: PlotCheckIssue[];
  passed: boolean;
}

export interface PlotCheckReport {
  overallScore: number;
  dimensions: DimensionScore[];
  totalIssues: number;
  highSeverityCount: number;
  mediumSeverityCount: number;
  lowSeverityCount: number;
  logicCheckResult?: LogicCheckResult;
  checkedAt: number;
  chapterIndex: number;
  batchFixed?: boolean;
  error?: string;
}

export interface PlotCheckRequest {
  projectId: string;
  chapterIndex: number;
  content: string;
}

// 逻辑异常检测相关类型
export enum LogicContradictionType {
  ITEM_STATE = 'item_state',
  ECONOMIC = 'economic',
  CHARACTER_STATE = 'character_state',
  PHYSICAL_LAW = 'physical_law',
  PLOT_SETTING = 'plot_setting',
  MATHEMATICAL = 'mathematical'
}

export const LOGIC_CONTRADICTION_TYPE_LABELS: Record<LogicContradictionType, string> = {
  [LogicContradictionType.ITEM_STATE]: '物品状态矛盾',
  [LogicContradictionType.ECONOMIC]: '经济系统矛盾',
  [LogicContradictionType.CHARACTER_STATE]: '角色状态矛盾',
  [LogicContradictionType.PHYSICAL_LAW]: '物理规律矛盾',
  [LogicContradictionType.PLOT_SETTING]: '剧情设定矛盾',
  [LogicContradictionType.MATHEMATICAL]: '数学逻辑矛盾'
};

export interface LogicCheckIssue {
  type: LogicContradictionType;
  severity: IssueSeverity;
  description: string;
  analysis: string;
  chapterIndex: number;
  chapterTitle?: string;
  position?: {
    startIndex: number;
    endIndex: number;
  };
  suggestion?: string;
  originalText?: {
    snippet: string;
    start: number;
    end: number;
  }[];
  references?: {
    type: string;
    name: string;
    summary: string;
  }[];
  fixable?: boolean;
  fixed?: boolean;
  fixResult?: string;
  quickFixable?: boolean;
  quickFixSuggestion?: QuickFixSuggestion;
  corrected?: boolean;
  correctedText?: string;
}

export interface LogicCheckResult {
  issues: LogicCheckIssue[];
  totalIssues: number;
  highSeverityCount: number;
  mediumSeverityCount: number;
  lowSeverityCount: number;
}

export interface QuickFixSuggestion {
  originalText: string;
  fixedText: string;
  reason: string;
  position?: {
    startIndex: number;
    endIndex: number;
  };
}

export interface QuickFixResult {
  success: boolean;
  suggestion: QuickFixSuggestion | null;
  error?: string;
}

export interface AutoFixDiff {
  originalText: string;
  fixedText: string;
  position: {
    startIndex: number;
    endIndex: number;
  };
}

export interface AutoFixResult {
  success: boolean;
  fixedContent: string;
  diffs: AutoFixDiff[];
  error?: string;
}

export interface BatchFixIssueInfo {
  dimension?: PlotCheckDimension;
  type?: LogicContradictionType;
  severity: IssueSeverity;
  title?: string;
  description: string;
  analysis?: string;
  suggestion: string;
  position?: {
    startIndex: number;
    endIndex: number;
  };
  originalText?: {
    snippet: string;
    start: number;
    end: number;
  }[];
  references?: {
    type: string;
    name: string;
    summary: string;
  }[];
}

export interface BatchFixRequest {
  projectId: string;
  chapterIndex: number;
  content: string;
  issues: BatchFixIssueInfo[];
  modelConfig?: ModelConfig;
}

export interface BatchFixIssueResult {
  index: number;
  success: boolean;
  error?: string;
}

export interface BatchFixResult {
  success: boolean;
  fixedContent: string;
  results: BatchFixIssueResult[];
  error?: string;
}

