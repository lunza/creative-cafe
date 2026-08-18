/**
 * 角色卡编辑智能助手类型定义（Spec: add-ai-assistant-for-character-card-editor / Task 1）
 *
 * 单一真源（SSOT）：本文件是助手模块所有类型的唯一定义处，
 * renderer 侧 hook 与组件均从此处导入，避免散落的重复类型。
 */

/**
 * 建议类型枚举。
 * 对应角色卡 V3 标准字段的六大可建议维度。
 */
export type SuggestionType =
  | 'description' // 角色描述优化
  | 'dialogue' // 对话样例内容
  | 'system_prompt' // 系统提示词补充
  | 'personality' // 角色性格一致性
  | 'scenario' // 场景设定
  | 'first_message'; // 初始消息优化

/**
 * 单条结构化建议。
 * AI 返回内容解析后拆分为独立建议卡片展示。
 */
export interface Suggestion {
  /** 建议类型（决定图标与高亮色） */
  type: SuggestionType;
  /** 建议标题（概括建议目的） */
  title: string;
  /** 建议详细说明 */
  description: string;
  /** 可直接粘贴的编辑建议内容（代码块展示） */
  editContent: string;
  /** 用户如何在编辑器中执行此建议 */
  actionTip: string;
}

/**
 * 助手对话消息。
 * role='user' 为用户提问；role='assistant' 为 AI 回复（可能携带多条结构化建议）。
 */
export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 消息生成时间戳 */
  timestamp: number;
  /** assistant 消息携带的结构化建议列表（解析失败时为空数组，回退展示原始文本） */
  suggestions?: Suggestion[];
  /** 是否命中缓存（命中时展示"基于之前的建议"标签与"重新生成"按钮） */
  fromCache?: boolean;
}

/**
 * 助手面板整体状态。
 */
export interface AssistantState {
  /** 面板是否展开 */
  isOpen: boolean;
  /** 对话消息列表 */
  messages: AssistantMessage[];
  /** 是否正在请求 AI */
  isLoading: boolean;
  /** 错误信息（请求失败时非 null） */
  error: string | null;
}