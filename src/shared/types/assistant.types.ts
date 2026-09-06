/**
 * 角色卡编辑智能助手类型定义（Spec: add-ai-assistant-for-character-card-editor / Task 1）
 *
 * 助手采用自然对话式回复（无结构化建议解析），用户自行选择复制需要的内容。
 */

/**
 * 助手对话消息。
 * role='user' 为用户提问；role='assistant' 为 AI 回复（自然文本）。
 */
export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 消息生成时间戳 */
  timestamp: number;
  /** 是否命中缓存（命中时展示"来自之前的回复"标签与"重新生成"按钮） */
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