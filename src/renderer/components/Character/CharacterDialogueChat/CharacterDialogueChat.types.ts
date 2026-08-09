// 角色测试聊天类型定义

// 聊天消息接口
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'error';
  speakerName?: string;
  /** AI 推荐选项（辅助模式开启时，AI 回复中解析出的 3 个推荐选项） */
  suggestedOptions?: string[];
  /** AI 回复情绪键名（Spec: add-character-expression-system），用于驱动表情图像渲染 */
  emotion?: string;
  versionInfo?: ChatMessageVersionInfo;
}

export interface ChatMessageVersionInfo {
  versionFilePath: string;
  isLatestVersion: boolean;
  versionSequenceNumber: number;
  allVersions: ChatVersionSummary[];
  versionLinkId?: string;
  tableSnapshotExists?: boolean;
  consistencyStatus?: 'matched' | 'mismatched' | 'partial';
}

export interface ChatVersionSummary {
  fileName: string;
  filePath: string;
  sequenceNumber: number;
  timestamp: number;
  messageCount: number;
  versionLinkId?: string;
  tableSnapshotExists?: boolean;
}

// 聊天状态接口
export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
}

// 角色信息接口
export interface CharacterInfo {
  creativeId: string;
  characterCardId: string;
  characterCardName: string;
  characterCardContent?: string;
  avatarPath?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  system_prompt?: string;
  creator_notes?: string;
  alternate_greetings?: string[];
  tags?: string[];
  character_version?: string;
  creator?: string;
}

// 聊天操作接口
export interface ChatActions {
  sendMessage: (content: string) => Promise<void>;
  continueConversation: () => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  clearChat: () => Promise<void>;
  cancelRequest: () => void;
}

// 聊天配置接口
export interface ChatConfig {
  maxTokens?: number;
  temperature?: number;
  streaming?: boolean;
  timeout?: number;
}

// ==================== 新增类型：人设与AI参数配置 ====================

// 用户人设接口
export interface UserPersona {
  id: string;
  name: string;
  description: string;
  avatarPath: string;
  createdAt: number;
  updatedAt: number;
  // 标记是否为通用人设（内置预设，采用角色卡中 {{user}} 的设定）
  isGeneric?: boolean;
  // 标记是否为系统内置预设（不可删除）
  isSystem?: boolean;
}

/**
 * Think 标签处理三态模式。
 * - 'strip'：存储前剥离（默认，彻底移除）
 * - 'strip_render'：存储时保留，渲染时剥离
 * - 'fold'：折叠展示
 */
export type ThinkTagMode = 'strip' | 'strip_render' | 'fold';

/**
 * 从 AIParameterConfig 推导 ThinkTagMode（向后兼容旧字段）。
 * 优先读 think_tag_mode；未设置时从 strip_think_tags / show_thinking 推导。
 */
export function deriveThinkTagMode(params: AIParameterConfig | undefined): ThinkTagMode {
  if (params?.think_tag_mode) return params.think_tag_mode;
  if (params?.show_thinking === true) return 'fold';
  if (params?.strip_think_tags === false) return 'strip_render';
  return 'strip';
}

// AI参数配置
export interface AIParameterConfig {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  /**
   * Repetition penalty（仅对 supportsRepPen=true 后端生效）。
   *
   * Spec: optimize-chat-ai-intelligence / Task 6.1
   * 借鉴 SillyTavern textgen/Default.json (rep_pen=1.1~1.2) 调整默认值为 1.1。
   * 范围 0.8-1.5，步长 0.05；为不支持的后端（OpenAI/Anthropic 等）省略此字段。
   */
  repetition_penalty?: number;
  /**
   * DRY 采样参数组（仅对 supportsDrySampler=true 后端生效）。
   *
   * Spec: optimize-chat-ai-intelligence / Task 6.4
   * 借鉴 SillyTavern textgen-settings.js:143 作为防重复采样层第二道防线
   * （与应用层 n-gram Jaccard 去重形成双重防护）。
   * - dry_multiplier：0-2，默认 0.8，步长 0.1
   * - dry_base：1-3，默认 1.75，步长 0.05
   * - dry_allowed_length：1-10，默认 2，步长 1
   * - no_repeat_ngram_size：0-10，默认 0（关闭，避免影响中文流畅性），步长 1
   */
  dry_multiplier?: number;
  dry_base?: number;
  dry_allowed_length?: number;
  no_repeat_ngram_size?: number;
  /**
   * Top-K 采样参数（仅对支持的后端生效）。
   *
   * 限制模型从概率最高的 K 个 token 中采样。值越小输出越确定，值越大越多样。
   * 默认 40，范围 0-100。0 或 -1 表示禁用（使用后端默认）。
   */
  top_k?: number;
  /**
   * Min-P 采样参数（仅对支持的后端生效）。
   *
   * 动态最低概率阈值，仅保留概率 >= top_p * min_p 的 token。
   * 默认 0，范围 0-1。0 表示禁用。
   */
  min_p?: number;
  /**
   * 最小回复字数（中文字符数）下限。
   *
   * Spec: fix-ai-response-length-degradation / Task 3.1
   * 用于在系统提示末尾注入字数下限约束，防止 AI 在持续对话中
   * 通过上下文学习复制逐渐缩短的回复模式（LLM 固有特性）。
   * 默认 300，范围 100-2000，由 ParameterPanel 暴露给用户配置。
   * 当连续 3 轮回复均低于此阈值时，自动强化约束（Task 4）。
   */
  min_response_chars?: number;
  /**
   * Emoji 增强模式开关。
   *
   * @deprecated 已被 `expression_display` 代替，不再生效。保留字段以避免旧配置读取报错。
   * 原行为：开启后在系统提示末尾注入约束，要求 AI 在回复中适度使用 emoji 表达情感。
   */
  emoji_enhanced?: boolean;
  /**
   * 表情显示开关（Spec: add-character-expression-system）。
   *
   * 开启后注入 buildExpressionPrompt，要求 AI 在回复末尾输出情绪标记
   * （<<<EXPRESSION>>>key<<<END_EXPRESSION>>>）；解析后写入 ChatMessage.emotion
   * 并驱动表情图像渲染（自定义 > 预置 > 默认头像三级回退）。
   *
   * 代替原 emoji_enhanced 开关。默认关闭（undefined 视为关闭）。
   */
  expression_display?: boolean;
  /**
   * Think 标签处理模式（合并原 strip_think_tags + show_thinking 两开关）。
   *
   * - 'strip'（默认）：存储前剥离 think 标签，彻底移除思考内容
   * - 'strip_render'：存储时保留，渲染时剥离（不在写入前清理，但用户不可见）
   * - 'fold'：保留并以折叠 details 块展示，用户可点击展开查看 AI 思考过程
   *
   * 向后兼容：未设置时由 deriveThinkTagMode() 从旧字段 strip_think_tags / show_thinking 推导。
   */
  think_tag_mode?: ThinkTagMode;
  /** @deprecated 已由 think_tag_mode 替代，保留用于向后兼容旧角色卡数据 */
  strip_think_tags?: boolean;
  /** @deprecated 已由 think_tag_mode 替代，保留用于向后兼容旧角色卡数据 */
  show_thinking?: boolean;
  /**
   * 辅助模式开关。
   *
   * 开启后，AI 在常规回复之外额外生成 3 个推荐选项，
   * 用户可点击选项快速填入输入框进行润色或直接发送。
   * 选项采用 Galgame 风格的对话分支设计，引导对话推进。
   * 默认关闭（undefined 视为关闭）。
   */
  assist_mode?: boolean;
  /**
   * AI 回复语言。
   *
   * 控制 AI 生成回复时使用的语言。默认中文（undefined 视为中文）。
   * 可选值：'zh' | 'en' | 'ja'。
   */
  language?: 'zh' | 'en' | 'ja';
}

// 知识库绑定信息
export interface KnowledgeBaseBinding {
  documentId: string;
  documentName: string;
  enabled: boolean;
  priority: number;
}

// 角色会话配置（存储每个角色的自定义参数）
export interface CharacterSessionConfig {
  characterCardId: string;
  selectedPersonaId?: string;
  customParameters?: AIParameterConfig;
  boundKnowledgeBaseIds?: string[];
  knowledgeBaseBindings?: KnowledgeBaseBinding[];
  memoryTableEnabled?: boolean;
  memoryTableAutoOrganize?: boolean;
  memoryTableOrganizeMode?: 'sync' | 'async';
  memoryTableTemplateId?: string;
  memoryTableTemplateName?: string;
  tokenManagementEnabled?: boolean;
  maxContextTokens?: number;
  reservedForResponse?: number;
  minMessagesToKeep?: number;
  maxMessagesToKeep?: number;
  /**
   * 自定义停止序列开关（Spec: optimize-chat-ai-intelligence / Task 3.4）。
   * 开启后 customStopSequences 数组与默认用户名变体停止序列合并注入请求体 stop 字段。
   */
  customStopSequencesEnabled?: boolean;
  /**
   * 自定义停止序列数组（每行一个停止串，持久化到 character-session-<cardId> localStorage）。
   */
  customStopSequences?: string[];
  /**
   * AI 回复人称属性（Spec: add-person-attribute-to-ai-reply）。
   * 控制"AI回复"按钮生成用户回复时的叙事视角：
   * - 'first'：第一人称（"我"），默认值
   * - 'second'：第二人称（"你"），互动小说风格
   * - 'third'：第三人称（"他/她"），小说叙事风格
   * 持久化到 character-session-<cardId> localStorage。
   * 默认 undefined 等同于 'first'（向后兼容）。
   */
  userReplyPerson?: 'first' | 'second' | 'third';
  lastUpdated: number;
}

// 记忆表格配置
export interface MemoryTableConfig {
  enabled: boolean;
  autoOrganize: boolean;
  organizeMode: 'sync' | 'async'; // 新增：整理模式
}

// 记忆表格数据结构
export interface MemoryTableSheet {
  sheetName: string;
  headers: string[];
  rows: Record<string, any>[];
}

// 记忆表格数据（完整结构）
export interface MemoryTableData {
  chatId: string;
  sheets: MemoryTableSheet[];
}

// 完整AI参数（合并后的最终参数）
export interface EffectiveAIParams extends AIParameterConfig {
  source: 'global' | 'persona' | 'custom';
}
