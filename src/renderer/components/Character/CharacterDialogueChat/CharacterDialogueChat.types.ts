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
  /**
   * 图片附属内容，Spec: enhance-conversation-image-bubble。
   * 作为父文本消息的嵌套字段，取代独立图片消息（isImageMessage/generatedImage）。
   * 一条文本消息可附带一个图片气泡（含重新生成历史与查看导航）。
   */
  imageAttachment?: ImageAttachment;
  /**
   * 对话中生成的图片（base64 data URL 或 assetId），Spec: add-conversation-image-generation。
   * @deprecated 已被 `imageAttachment` 取代，保留仅为支持旧数据迁移（Spec: enhance-conversation-image-bubble）。
   */
  generatedImage?: string;
  /**
   * 标记为图片消息（区分文本消息与图片消息），Spec: add-conversation-image-generation。
   * @deprecated 已被 `imageAttachment` 取代，保留仅为支持旧数据迁移（Spec: enhance-conversation-image-bubble）。
   */
  isImageMessage?: boolean;
}

/**
 * 图片生成历史记录项（Spec: enhance-conversation-image-bubble）
 * 每次重新生成图片都会追加一项到 ImageAttachment.history
 */
export interface ImageHistoryItem {
  /** 磁盘素材 ID（asset:save 时生成，如 conv_1234567890） */
  assetId: string;
  /** 该版本生成时间戳 */
  createdAt: number;
  /**
   * 该历史项生成时使用的完整标签数组（含权重）。
   * Spec: enhance-conversation-image-auditability / Task 1.1
   * 用于图片下方标签展示面板渲染（ChatMessageBubble 折叠面板）。
   * 旧数据可能缺失该字段，UI 应显示「此历史版本无标签快照」提示。
   */
  usedTags?: Array<{ text: string; weight?: number }>;
  /**
   * 该历史项生成时使用的最终 prompt 字符串。
   * Spec: enhance-conversation-image-auditability / Task 1.1
   * applyTraitsAndLora 处理后（含 LoRA + traits 替换）的完整字符串，
   * 用于「查看完整 Prompt」二级折叠展示。
   */
  usedPrompt?: string;
  /**
   * 该历史项生成时使用的负面提示词。
   * Spec: enhance-conversation-image-auditability / Task 1.1
   * 用于「查看完整 Prompt」二级折叠展示的 Negative Prompt 区块。
   */
  usedNegativePrompt?: string;
  /**
   * 该历史项生成时启用的 LoRA 列表快照。
   * Spec: enhance-conversation-image-auditability / Task 1.1
   * 用于追溯本次生成调用的 LoRA 组合，便于复现。
   */
  usedLoras?: Array<{ name: string; weight: number }>;
  /**
   * AI 标签优化删除的标签列表（Spec: add-ai-trait-optimization-for-image-gen）。
   *
   * 仅当用户开启「允许 AI 优化特征标签」（ai_optimize_traits=true）且 AI 实际删除了标签时存在。
   * 用于标签快照面板展示「AI 已移除」分区（灰色 + 删除线样式）。
   *
   * - text: 被删除的标签文本
   * - reason: AI 给出的删除原因（可选，如「对话中角色脱下了裤子」）
   */
  removedTags?: Array<{ text: string; reason?: string }>;
  /**
   * AI 标签优化补充的标签列表（Spec: add-ai-tag-supplement-after-removal）。
   *
   * 仅当用户开启「允许 AI 优化特征标签」（ai_optimize_traits=true）且 AI 实际补充了标签时存在。
   * 用于标签快照面板展示「AI 已补充」分区（绿色高亮样式）。
   *
   * - text: 被补充的标签文本
   * - reason: AI 给出的补充原因（可选，如「裤子移除后下身暴露，需要补充暴露特征标签」）
   */
  addedTags?: Array<{ text: string; reason?: string }>;
  /**
   * AI 标签优化执行状态元数据（Spec: add-ai-trait-optimization-for-image-gen / 反馈可见性修复）。
   *
   * 仅当本次生成启用了 ai_optimize_traits=true 时存在，记录 AI 优化的执行结果，
   * 用于标签快照面板展示「AI 优化」分区，无论是否删除标签都给出明确反馈。
   *
   * 解决问题：原设计仅 removedTags.length>0 时渲染分区，导致 AI 运行但未删除标签 / AI 调用失败
   * 时用户看不到任何反馈，误以为「功能无效」。
   *
   * - status:
   *   - 'success': AI 成功执行并删除了标签（removedTags 非空）
   *   - 'no-removal': AI 成功执行但本次对话上下文无需移除标签（removedTags 为空）
   *   - 'failed': AI 调用失败/超时/返回非法数据（error 字段记录原因）
   * - removedCount: 实际删除的标签数（与 removedTags.length 一致，冗余存储便于 UI 直接读取）
   * - addedCount: 实际补充的标签数（与 addedTags.length 一致，与 removedCount 对称，冗余存储便于 UI 直接读取）
   *   Spec: add-ai-tag-supplement-after-removal
   * - error: status='failed' 时的失败原因
   */
  aiOptimization?: {
    status: 'success' | 'no-removal' | 'failed';
    removedCount: number;
    addedCount: number;  // 新增：补充标签数（与 removedCount 对称）Spec: add-ai-tag-supplement-after-removal
    error?: string;
  };
}

/**
 * 图片附属内容（Spec: enhance-conversation-image-bubble）
 * 作为父文本消息的嵌套字段，存储在 ChatMessage.imageAttachment
 * 取代旧的独立图片消息（isImageMessage/generatedImage）
 */
export interface ImageAttachment {
  /** 当前显示的图片 assetId（指向 history[currentIndex].assetId） */
  currentAssetId: string;
  /** 生成时的情绪快照（取自父消息 emotion 字段），用于左侧立绘表情图加载 */
  emotion: string;
  /** 首次创建时间戳 */
  createdAt: number;
  /** 重新生成历史（含当前版本），history[0] 为首次生成 */
  history: ImageHistoryItem[];
  /** 当前查看的历史索引（0-based），默认指向最后一项（最新生成） */
  currentIndex: number;
  /** 生成状态：generating=生成中 / idle=空闲可查看 / error=生成失败 */
  status?: 'generating' | 'idle' | 'error';
  /** 生成阶段（status='generating' 时有效）：tag-generating / tag-auditing / image-generating */
  phase?: 'tag-generating' | 'tag-auditing' | 'image-generating' | 'error';
  /** 生成失败时的错误信息（status='error' 时有效） */
  errorMessage?: string;
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
/**
 * 用户人设视觉特征项（轻量化版本，参考 CharacterTraitItem 但简化）。
 * - text：SD tag 文本（如 "black hair, blue eyes"）
 * - translation：中文翻译（AI 生成时产出）
 * - enabled：是否在图片生成时启用
 */
export interface PersonaTrait {
  text: string;
  translation?: string;
  enabled: boolean;
}

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
  /** AI 生成的视觉特征 tag 列表（用于图片生成时保证人设一致性） */
  traits?: PersonaTrait[];
  /** AI 生成的外观描述（中文自然语言） */
  appearanceDescription?: string;
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
  /**
   * 对话中图片生成功能开关（Spec: add-conversation-image-generation）。
   *
   * 开启后，AI 对话气泡下方显示"生成图片"按钮，可基于对话上下文自动生成图片。
   * 默认关闭（undefined 视为关闭）。
   */
  image_gen_enabled?: boolean;
  /**
   * 对话中图片生成的输出宽度（Spec: add-conversation-image-generation）。
   * 默认 1024，范围 64-2048。
   */
  image_gen_width?: number;
  /**
   * 对话中图片生成的输出高度（Spec: add-conversation-image-generation）。
   * 默认 1024，范围 64-2048。
   */
  image_gen_height?: number;
  /**
   * 互动元素标签权重提升（Spec: enhance-conversation-interaction-prompt-recognition）。
   *
   * 互动标签（disembodied_hand / hugging_another / hand_on_breast 等）在 SD prompt 中
   * 拼接位置靠后，当角色特征标签较多时容易被图像模型忽略，导致生成的图片缺乏交互性质。
   * 通过对 `categoryId === 'interaction'` 的 trait 应用分类级权重提升来加强。
   *
   * - 默认 1.2（用户建议的 1.1-1.2 范围取上限，确保互动标签足够突出）
   * - 范围 1.0-2.0，步进 0.1
   * - 1.0 = 不提升（等价于关闭功能，互动标签使用原始 per-tag weight）
   * - 权重组合方式：最终 weight = (per-tag weight ?? 1.0) × interaction_weight
   *   （分类级提升与标签级权重相乘，用户可同时调整两者）
   *
   * 应用位置：`executeImageGeneration` 构建 `mergedTraits` 后、传给 `buildSdOptionsFromConfig` 前，
   * 在渲染进程完成权重计算。`applyTraitsAndLora`（主进程）只看到最终的 `{ text, weight }`，
   * 不感知 categoryId，保持主进程 prompt 组装逻辑不变。
   */
  interaction_weight?: number;
  /**
   * 允许 AI 优化特征标签（试验性功能）（Spec: add-ai-trait-optimization-for-image-gen）。
   *
   * 开启后，图片生成前 AI 会分析已启用角色特征标签与当前对话上下文的矛盾关系，
   * 自动删除不再适用的标签（如对话中角色「脱下了裤子」时移除 pants 标签，
   * 「站了起来」时移除 sitting 标签）。
   *
   * - 默认关闭（undefined / false 均视为关闭）
   * - ⚠️ 试验性功能：AI 可能会误删重要标签，建议谨慎使用
   * - 仅影响角色特征标签（enabledTraitTexts），不影响 AI 生成的上下文标签
   * - 被删除的标签及原因记录到 ImageHistoryItem.removedTags 供审计
   */
  ai_optimize_traits?: boolean;
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
