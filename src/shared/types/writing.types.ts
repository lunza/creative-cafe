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
  EPIC = 'epic'
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
  referenceMaterials?: ReferenceMaterial[];
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
}

// 模型配置
export interface ModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

// 创作配置
export interface WritingConfig {
  resources: WritingResourceConfig;
  parameters: WritingParameters;
  modelConfig: ModelConfig;
  manualMode?: boolean;
}

// 大纲生成请求
export interface OutlineGenerationRequest {
  resources: WritingResourceConfig;
  parameters: WritingParameters;
  modelConfig: ModelConfig;
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
    relevance: number;
  }[];
  characterContext: {
    name: string;
    description: string;
    personality: string;
  }[];
  generationParams: {
    targetWordCount: number;
    style: string;
    perspective: string;
    novelType?: string;
    constraints?: string[];
  };
  modelConfig: ModelConfig;
}

// 作品信息
export interface WorkInfo {
  suggestedTitle: string;
  novelType: NovelType;
  estimatedWordCount: number;
  chapterCount: number;
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
  // 手动大纲编辑新增字段
  chapterType?: ChapterType;
  importance?: ImportanceLevel;
  children?: ChapterOutline[];
  content?: string;
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

// 世界观要点
export interface WorldbuildingNotes {
  category: string;
  points: string[];
}

// 生成的大纲
export interface GeneratedOutline {
  workInfo: WorkInfo;
  storyLine: StoryLine;
  chapters: ChapterOutline[];
  characterRelationships: CharacterRelationship[];
  worldbuildingNotes: WorldbuildingNotes[];
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
  outlineHistory: {
    outline: GeneratedOutline;
    rawContent?: string;
    timestamp: number;
    note?: string;
  }[];
  chapters: Chapter[];
  createdAt: number;
  updatedAt: number;
  lastSavedAt: number;
  metadata: ProjectMetadata;
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
