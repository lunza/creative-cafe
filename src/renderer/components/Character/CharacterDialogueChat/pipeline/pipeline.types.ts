/**
 * 对话管线架构 — 核心类型定义
 *
 * Spec: redesign-dialogue-pipeline-architecture
 *
 * 本文件定义管线架构所需的全部类型，包括：
 * - 管线上下文（DialoguePipelineContext）
 * - 意图识别类型（UserIntent / AIIntentType / DetectedIntent）
 * - 扩展接口（PromptProvider / PostProcessPlugin / LogicTask / IntentHandler）
 * - 日志与指标（PipelineLogEntry / PipelineMetrics / PipelineError）
 * - 解析与渲染辅助类型（ParsePattern / ParseResult / RenderOptions 等）
 */

// ===== 从现有类型文件导入并重新导出 =====

import type {
  ChatMessage,
  CharacterInfo,
  AIParameterConfig,
  CharacterSessionConfig,
  EffectiveAIParams,
  ThinkTagMode,
  UserPersona,
} from '../CharacterDialogueChat.types';

import type {
  AIEngineConfig,
  EngineCapabilities,
} from '../../../Common/ChatEngine/ChatEngine.types';

import type { VectorSearchResult } from '../../../KnowledgeBase/shared';

// 重新导出现有类型，供管线模块统一引用
export type {
  ChatMessage,
  CharacterInfo,
  AIParameterConfig,
  CharacterSessionConfig,
  EffectiveAIParams,
  ThinkTagMode,
  UserPersona,
  AIEngineConfig,
  EngineCapabilities,
  VectorSearchResult,
};

// ===== 管线模式 =====

/**
 * 管线执行模式。
 * - dialogue：常规对话
 * - continuation：续写
 * - retry：重试生成
 * - polish：润色用户输入
 * - userReply：AI 生成用户回复
 */
export type PipelineMode = 'dialogue' | 'continuation' | 'retry' | 'polish' | 'userReply';

// ===== 用户意图 =====

/**
 * 用户意图 — 由 UserIntentRecognizer 产出，驱动管线模式选择。
 * 显式意图 confidence=1.0，NLU 隐式意图 confidence<1.0（需用户确认）。
 */
export type UserIntent =
  | { type: 'dialogue'; confidence: number }
  | { type: 'continuation'; confidence: number }
  | { type: 'retry'; confidence: number; targetMessageId: string }
  | { type: 'polish'; confidence: number; targetText: string }
  | { type: 'userReply'; confidence: number };

/**
 * 用户 UI 操作 — 由按钮/快捷键触发，映射到显式 UserIntent。
 */
export type UserAction =
  | { type: 'sendMessage'; text: string }
  | { type: 'continueConversation' }
  | { type: 'retryMessage'; targetMessageId: string }
  | { type: 'polishInput'; targetText: string }
  | { type: 'generateUserReply' };

// ===== AI 意图 =====

/**
 * AI 意图类型 — 对应 AI 响应中的结构化标签。
 */
export type AIIntentType =
  | 'expression'        // 表情情绪标签
  | 'suggested_options' // 辅助模式选项
  | 'table_edit'        // 记忆表格编辑命令
  | 'think_tag'         // 思考标签
  | 'image_generation'  // 图片生成请求（预留）
  | 'narrative';        // 纯叙事内容（无标签）

/**
 * 检测到的 AI 意图 — 由 AIIntentRecognizer 产出。
 */
export interface DetectedIntent {
  /** 意图类型 */
  type: AIIntentType;
  /** 解析后的结构化数据 */
  data: unknown;
  /** 原始匹配文本 */
  rawMatch: string;
  /** 置信度（0-1） */
  confidence: number;
}

/**
 * AI 意图处理器 — 由 ExtensionRegistry 注册，处理特定类型的 AI 意图。
 */
export interface IntentHandler {
  /** 处理检测到的意图，将结果写入 context */
  handle(intent: DetectedIntent, context: DialoguePipelineContext): void;
}

// ===== 提示词 Provider =====

/**
 * 提示词段落分区。
 */
export type PromptSection = 'header' | 'context' | 'instruction' | 'suffix';

/**
 * 提示词 Provider — 模块化提示词构建单元。
 * 按 section 分组、组内按 priority 排序后依次调用。
 */
export interface PromptProvider {
  /** Provider 名称（唯一标识） */
  name: string;
  /** 注入优先级（数值越小越先注入） */
  priority: number;
  /** 所属段落分区 */
  section: PromptSection;
  /** 判断当前上下文下是否激活 */
  isActive(context: DialoguePipelineContext): boolean;
  /** 构建提示词文本（异步，部分 Provider 需调用模板系统） */
  build(context: DialoguePipelineContext): Promise<string>;
}

// ===== 后处理插件 =====

/**
 * 后处理插件 — 消息后处理管线的处理单元。
 * 按 priority 顺序执行，每个插件接收上一个插件处理后的内容。
 */
export interface PostProcessPlugin {
  /** 插件名称（唯一标识） */
  name: string;
  /** 执行优先级（数值越小越先执行） */
  priority: number;
  /**
   * 检测内容中是否存在该插件需要处理的标签/模式。
   * 返回 true 时调用 process 方法。
   */
  detect(content: string, context: DialoguePipelineContext): boolean;
  /**
   * 处理内容：解析标签、剥离标签、写入 context 字段。
   * @returns 清理后的内容，传递给下一个插件
   */
  process(content: string, context: DialoguePipelineContext): string;
}

// ===== 逻辑任务 =====

/**
 * 逻辑任务 — 后处理完成后执行的副作用调度单元。
 * 按 priority 顺序执行，每个任务独立 try-catch。
 */
export interface LogicTask {
  /** 任务名称（唯一标识） */
  name: string;
  /** 执行优先级（数值越小越先执行） */
  priority: number;
  /** 判断当前上下文下是否需要执行 */
  condition(context: DialoguePipelineContext): boolean;
  /** 执行副作用逻辑 */
  execute(context: DialoguePipelineContext): Promise<void>;
  /** 任务执行失败时的错误回调（可选） */
  onError?: (error: Error, context: DialoguePipelineContext) => void;
}

// ===== 日志与指标 =====

/**
 * 日志级别。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 管线日志条目 — 记录管线执行过程中的事件。
 */
export interface PipelineLogEntry {
  /** 日志级别 */
  level: LogLevel;
  /** Pipeline Stage 名称 */
  stage: string;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 日志消息 */
  message: string;
  /** 附加数据 */
  data?: unknown;
  /** 执行耗时（毫秒，仅 trace 方法产生） */
  duration?: number;
}

/**
 * 管线性能指标 — 由 PipelineLogger 聚合日志条目计算得出。
 */
export interface PipelineMetrics {
  /** 总执行耗时（毫秒） */
  totalDuration: number;
  /** 各 Stage 执行耗时（毫秒） */
  stageDurations: Record<string, number>;
  /** 各 Stage 日志条目数 */
  stageCounts: Record<string, number>;
}

/**
 * 管线错误 — 记录 Stage 执行过程中抛出的异常。
 */
export interface PipelineError {
  /** 发生错误的 Stage 名称 */
  stage: string;
  /** 错误消息 */
  message: string;
  /** 错误堆栈（可选） */
  stack?: string;
  /** 是否为致命错误（致命错误中断管线） */
  isFatal: boolean;
}

// ===== 解析辅助类型 =====

/**
 * 正则解析模式 — 供 RobustParser 多模式匹配使用。
 */
export interface ParsePattern {
  /** 模式名称 */
  name: string;
  /** 正则表达式 */
  regex: RegExp;
  /** 从匹配结果中提取结构化数据 */
  extractor: (match: RegExpMatchArray) => { data: unknown; rawMatch: string };
}

/**
 * 解析结果 — RobustParser.match 的返回值。
 */
export interface ParseResult {
  /** 解析后的结构化数据 */
  data: unknown;
  /** 原始匹配文本 */
  rawMatch: string;
}

// ===== 渲染辅助类型 =====

/**
 * 渲染配置 — 控制渲染预处理和 Markdown 配置的行为。
 * 涵盖模板替换、Think 标签处理、引号规范化、尖括号编码，
 * 以及 Markdown 插件链开关和 HTML 安全策略。
 */
export interface RenderOptions {
  // ===== Think 标签 =====
  /** 是否显示思考过程：true=保留为折叠 details 块，false=移除 */
  showThinking?: boolean;

  // ===== 文本规范化 =====
  /** 是否规范化引号（将引号包裹为 <q> 标签） */
  normalizeQuotes?: boolean;
  /** 是否编码尖括号（将 < > 转义为 &lt; &gt;） */
  encodeAngleBrackets?: boolean;

  // ===== 模板替换 =====
  /** 角色名称 */
  charName?: string;
  /** 用户名称 */
  userName?: string;
  /** 角色占位符（如 {{char}}） */
  charPlaceholder?: string;
  /** 用户占位符（如 {{user}}） */
  userPlaceholder?: string;

  // ===== 样式 =====
  /** 主题名称 */
  theme?: 'default' | 'dark' | 'light' | string;

  // ===== Markdown 插件开关 =====
  /** 是否启用 GFM（表格、删除线等） */
  enableGFM?: boolean;
  /** 是否启用 emoji 短代码 */
  enableEmoji?: boolean;
  /** 是否启用下划线斜体 */
  enableUnderscoreItalic?: boolean;
  /** 是否启用引号规范化（rehype 层） */
  enableQuoteNormalize?: boolean;

  // ===== HTML 与代码 =====
  /** 是否启用代码高亮 */
  codeHighlight?: boolean;
  /** 是否允许原始 HTML（rehypeRaw） */
  allowRawHTML?: boolean;
  /** HTML 消毒级别 */
  sanitizeLevel?: 'strict' | 'moderate' | 'loose';
}

// ===== 预留功能类型 =====

/**
 * 图片生成请求（预留） — 未来实现 AI 对话中实时生成图片功能。
 */
export interface ImageGenRequest {
  /** 生成提示词 */
  prompt: string;
  /** 负面提示词（可选） */
  negativePrompt?: string;
  /** 图片宽度（可选） */
  width?: number;
  /** 图片高度（可选） */
  height?: number;
  /** 生成上下文类型 */
  context: 'inline' | 'scene' | 'character';
}

// ===== 去重检测 =====

/**
 * 去重检测类型。
 * - retry：重试去重（nGramJaccard 与上一条 assistant 回复比较）
 * - continue：续写去重（overlapRate 与 initialContent 比较）
 * - none：未触发去重
 */
export type DedupKind = 'retry' | 'continue' | 'none';

/**
 * 去重检测结果 — 由 DedupPlugin 写入 context.dedupInfo。
 */
export interface DedupInfo {
  /** 是否需要重试 */
  needRetry: boolean;
  /** 触发的去重类型 */
  kind: DedupKind;
  /** 计算得到的指标值（similarity 或 overlap，0-1） */
  metric: number;
  /** 是否已重试耗尽（needRetry=false 但指标超阈值） */
  exhausted: boolean;
  /** 决策原因描述（用于日志） */
  reason: string;
}

// ===== 辅助数据类型 =====

/**
 * 辅助模式推荐选项 — 由 SuggestedOptionsPlugin 解析后写入 context。
 */
export interface SuggestedOption {
  /** 选项文本 */
  text: string;
  /** 选项分类（可选，用于 UI 样式区分） */
  category?: string;
}

/**
 * 表格编辑命令 — 由 TableEditPlugin 解析后写入 context。
 * 独立于主进程的 TableEditCommand，供渲染层管线使用。
 */
export interface TableEditCommand {
  /** 命令类型 */
  type: 'insertRow' | 'updateRow' | 'deleteRow';
  /** 目标表格索引 */
  tableIndex: number;
  /** 目标行索引（updateRow/deleteRow 时必填） */
  rowIndex?: number;
  /** 行数据（insertRow/updateRow 时必填） */
  data?: Record<string, string>;
  /** 原始命令文本（用于日志） */
  rawCommand?: string;
}

/**
 * 对话历史条目 — 用于 RAG 检索的历史片段。
 */
export interface ChatHistoryItem {
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content: string;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 相关性评分（RAG 检索时填充） */
  score?: number;
}

/**
 * 记忆表格结构描述 — 用于上下文组装。
 */
export interface TableStructure {
  /** 各 Sheet 的结构信息 */
  sheets: Array<{
    /** Sheet 名称 */
    sheetName: string;
    /** 列头名称列表 */
    headers: string[];
    /** 行数 */
    rowCount: number;
  }>;
}

/**
 * NLU 推断上下文 — UserIntentRecognizer.detectImplicit 的轻量上下文。
 */
export interface DialogueContext {
  /** 聊天 ID */
  chatId: string;
  /** 当前消息数 */
  messageCount: number;
  /** 最近的聊天消息 */
  recentMessages: ChatMessage[];
  /** 角色信息 */
  characterInfo: CharacterInfo;
}

/**
 * 输入验证结果 — DataPreprocessor.validate 的返回值。
 */
export interface ValidationResult {
  /** 是否通过验证 */
  valid: boolean;
  /** 失败原因（valid=false 时填写） */
  reason?: string;
}

// ===== 管线上下文 =====

/**
 * 管线上下文 — 贯穿整个对话处理流程的中央数据对象。
 * 每个 Stage/Middleware 读取并修改此对象，最终产出渲染所需的所有数据。
 */
export interface DialoguePipelineContext {
  // ===== 输入 =====
  /** 用户输入文本 */
  userInput: string;
  /** 用户意图 */
  userIntent: UserIntent;
  /** 角色信息 */
  characterInfo: CharacterInfo;
  /** 角色会话配置 */
  sessionConfig: CharacterSessionConfig;
  /** 当前激活的 AI 引擎配置 */
  activeEngine: AIEngineConfig;
  /** 管线模式 */
  pipelineMode: PipelineMode;
  /** 当前选中的用户人设（供 PromptProvider 使用） */
  selectedPersona?: UserPersona;

  // ===== 上下文组装 =====
  /** 检索到的上下文数据 */
  retrievedContext: {
    /** 知识库检索结果 */
    knowledgeBase: VectorSearchResult[];
    /** 对话历史 RAG 片段 */
    chatHistory: ChatHistoryItem[];
    /** 记忆表格数据（文本形式） */
    memoryTableData: string;
    /** 记忆表格结构 */
    memoryTableStructure: TableStructure | null;
  };

  // ===== 提示词 =====
  /** 组装后的系统提示词 */
  systemPrompt: string;
  /** 待发送的消息列表 */
  messagesToSend: ChatMessage[];
  /** 注入参数后的引擎配置 */
  engineConfig: AIEngineConfig;
  /** 停止序列 */
  stopSequences: string[];

  // ===== AI 响应 =====
  /** AI 原始完整响应 */
  rawResponse: string;
  /** 流式累积内容 */
  streamingContent: string;
  /** 检测到的 AI 意图列表 */
  aiIntents: DetectedIntent[];

  // ===== 后处理结果 =====
  /** 后处理后的纯净内容 */
  processedContent: string;
  /** 解析到的情绪键名 */
  emotion: string | null;
  /** 辅助模式推荐选项 */
  suggestedOptions: SuggestedOption[] | null;
  /** 表格编辑命令列表 */
  tableEditCommands: TableEditCommand[] | null;
  /** 图片生成请求列表（预留） */
  imageGenRequests: ImageGenRequest[] | null;
  /** Think 标签内容 */
  thinkContent: string | null;
  /** 去重检测结果 */
  dedupInfo: DedupInfo | null;

  // ===== 元数据 =====
  /** 管线日志 */
  logs: PipelineLogEntry[];
  /** 性能指标 */
  metrics: PipelineMetrics;
  /** 错误列表 */
  errors: PipelineError[];
}

// ===== Pipeline Stage 类型 =====

/**
 * Pipeline Stage 函数类型 — 每个阶段接收上下文并异步执行。
 */
export type StageFunction = (context: DialoguePipelineContext) => Promise<void>;
