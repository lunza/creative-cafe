/**
 * 与服务端 LAN API（creative-cafe lanApiServer）约定的数据类型
 */

export interface CharacterSummary {
  /** 角色卡文件名（作为唯一 id，如 AmazingAA.png） */
  id: string;
  name: string;
  fileName: string;
  description: string;
  tags: string[];
  creator: string;
  version: string;
  cardVersion: string;
  /** 相对路径（/api/characters/:id/avatar），需拼接 baseUrl */
  avatarUrl: string;
  modified: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  emotion?: string;
  /** 对话图片附件（服务端持久化，含生成历史） */
  imageAttachment?: ImageAttachment;
  /** 客户端本地状态：流式生成中 */
  streaming?: boolean;
  /** 客户端本地状态：发送失败（可重试） */
  failed?: boolean;
  /** 客户端本地状态：流式期间的思考过程增量（think_tag_mode=fold；完成态折叠渲染） */
  reasoning?: string;
  /** 辅助模式推荐选项（SSE options 事件 / 历史加载时由 options 字段映射；点击填入输入框） */
  suggestedOptions?: string[];
}

export interface ExpressionEntry {
  key: string;
  type: string;
  label: string;
  /** 相对路径（/api/characters/:id/expressions/:emotion） */
  url: string;
}

/**
 * 情绪预置映射（对齐 PC 端 PromptBuilder.ts EMOTION_PRESETS；
 * Spec: fix-android-chat-interaction-parity / Task 5 —— 名字行情绪标签中文显示）
 */
export const EMOTION_PRESETS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'default', label: '默认' },
  { key: 'admiration', label: '钦佩' },
  { key: 'amusement', label: '愉悦' },
  { key: 'anger', label: '愤怒' },
  { key: 'annoyance', label: '恼怒' },
  { key: 'approval', label: '赞同' },
  { key: 'caring', label: '关切' },
  { key: 'confusion', label: '困惑' },
  { key: 'curiosity', label: '好奇' },
  { key: 'desire', label: '渴望' },
  { key: 'disappointment', label: '失望' },
  { key: 'disapproval', label: '不赞同' },
  { key: 'disgust', label: '厌恶' },
  { key: 'embarrassment', label: '尴尬' },
  { key: 'excitement', label: '兴奋' },
  { key: 'fear', label: '恐惧' },
  { key: 'gratitude', label: '感激' },
  { key: 'grief', label: '悲痛' },
  { key: 'joy', label: '喜悦' },
  { key: 'love', label: '喜爱' },
  { key: 'nervousness', label: '紧张' },
  { key: 'neutral', label: '中性' },
  { key: 'optimism', label: '乐观' },
  { key: 'pride', label: '自豪' },
  { key: 'realization', label: '顿悟' },
  { key: 'relief', label: '宽慰' },
  { key: 'remorse', label: '懊悔' },
  { key: 'sadness', label: '悲伤' },
  { key: 'surprise', label: '惊讶' },
  { key: 'cheerfulness', label: '快乐' },
  { key: 'in_heat', label: '发情' },
];

/** 情绪 key → 中文标签（未知 key 原样返回） */
export function emotionLabel(key: string): string {
  return EMOTION_PRESETS.find(e => e.key === key)?.label || key;
}

// ==================== 会话配置（Spec: fix-android-chat-feature-parity / Task 6） ====================

/** LAN 会话参数子集（与服务端 LanCustomParameters 对齐；未设置字段沿用引擎级配置） */
export interface SessionCustomParameters {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  min_response_chars?: number;
  language?: 'zh' | 'en' | 'ja';
  /** 表情显示开关（false 时不注入表情提示、不解析情绪） */
  expression_display?: boolean;
  /** 对话图片生成开关 */
  image_gen_enabled?: boolean;
  image_gen_width?: number;
  image_gen_height?: number;
  /** 互动元素标签权重提升（1.0-2.0） */
  interaction_weight?: number;
  /** 思考内容处理三态（strip=彻底剥离 / strip_render=存储保留渲染剥离 / fold=折叠展示） */
  think_tag_mode?: 'strip' | 'strip_render' | 'fold';
  /** 辅助模式开关（开启后 AI 在回复末尾附加 3 个推荐选项） */
  assist_mode?: boolean;
  /** 频率惩罚 / 存在惩罚 / DRY 乘数（防重复三档预设写入的参数） */
  frequency_penalty?: number;
  presence_penalty?: number;
  dry_multiplier?: number;
}

/** 防重复强度预设三档（与服务端/桌面端 ANTI_REPEAT_PRESETS 对齐） */
export const ANTI_REPEAT_PRESETS: Array<{
  key: 'loose' | 'standard' | 'strict';
  label: string;
  values: { frequency_penalty: number; presence_penalty: number; dry_multiplier: number };
}> = [
  { key: 'loose', label: '宽松', values: { frequency_penalty: 0, presence_penalty: 0, dry_multiplier: 0 } },
  { key: 'standard', label: '标准', values: { frequency_penalty: 0.1, presence_penalty: 0.1, dry_multiplier: 0.4 } },
  { key: 'strict', label: '严格', values: { frequency_penalty: 0.3, presence_penalty: 0.3, dry_multiplier: 0.8 } },
];

/** 每角色会话配置（全部存服务端，客户端不保存任何功能配置） */
export interface SessionConfig {
  selectedPersonaId: string | null;
  customParameters: SessionCustomParameters;
  boundKnowledgeBaseIds: string[];
  memoryTableEnabled: boolean;
  customStopSequencesEnabled: boolean;
  customStopSequences: string[];
  lastUpdated?: number;
}

export interface PersonaSummary {
  id: string;
  name: string;
  description: string;
  isGeneric: boolean;
  isSystem: boolean;
  /** 相对路径（/api/personas/:id/avatar），null = 未设置头像 */
  avatarUrl: string | null;
}

/** 已向量化的知识库作用域（供会话配置绑定选择） */
export interface KnowledgeScope {
  id: string;
  label: string;
  sourceType: string;
  sourceName: string;
  vectorCount: number;
}

// ==================== 对话图片（Spec: fix-android-chat-feature-parity / Task 6） ====================

export interface ImageHistoryItem {
  /** 磁盘素材 ID（conv_<ts>）或 data: URL（落盘失败回退） */
  assetId: string;
  createdAt: number;
  usedTags?: Array<{ text: string; weight?: number }>;
  usedPrompt?: string;
  usedNegativePrompt?: string;
  usedLoras?: Array<{ name: string; weight: number }>;
}

export interface ImageAttachment {
  currentAssetId: string;
  emotion: string;
  createdAt: number;
  history: ImageHistoryItem[];
  currentIndex: number;
  status?: 'generating' | 'idle' | 'error';
  phase?: string;
  errorMessage?: string;
}

/** 图片生成响应（失败时含 error + 错误态 imageAttachment） */
export interface ImageGenResponse {
  imageAttachment: ImageAttachment;
  warnings?: string[];
}

// ==================== 记忆表格（Spec: fix-android-chat-feature-parity / Task 6） ====================

export interface MemoryTableData {
  enabled: boolean;
  sheets: string[];
  headers: Record<string, string[]>;
  data: Record<string, Array<Record<string, unknown>>>;
  sheetDescriptions?: Record<string, string>;
}

// ==================== 角色卡编辑（Spec: add-mobile-character-card-editor / Task 2.1） ====================

/** 角色-世界书关联（与服务端/PC 端 CharacterWorldBookRelation 结构一致） */
export interface CharacterWorldBookRelation {
  worldBookPath: string;
  worldBookName?: string;
  enabled: boolean;
  priority: number;
  filterTags?: string[];
}

/** 可编辑角色卡字段（与服务端 CARD_STRING_FIELDS/CARD_LIST_FIELDS 白名单对齐） */
export interface CharacterCardEditData {
  name: string;
  nickname: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  creator: string;
  character_version: string;
  source: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  group_only_greetings: string[];
  tags: string[];
}

/** 角色卡详情接口返回（含 id 与原卡扩展字段如 worldBooks） */
export interface CharacterDetail {
  id: string;
  spec?: string;
  spec_version?: string;
  data: CharacterCardEditData & { worldBooks?: CharacterWorldBookRelation[] };
}

/** 世界书清单项（供关系绑定选择） */
export interface WorldBookSummary {
  name: string;
  path: string;
  size: number;
  modified: number;
}
