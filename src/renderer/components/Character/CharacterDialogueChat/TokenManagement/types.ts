export interface TokenCountResult {
  totalTokens: number;
  systemPromptTokens: number;
  messagesTokens: number;
  reservedForResponse: number;
}

export interface TruncationConfig {
  enabled: boolean;
  maxContextTokens: number;
  reservedForResponse: number;
  minMessagesToKeep: number;
  maxMessagesToKeep: number;
}

export interface MessageTokenInfo {
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokenCount: number;
}

/**
 * 必填预算项。
 *
 * Spec: optimize-chat-ai-intelligence / Task 2.2
 * 必填项按顺序 reserve：[systemPrompt, roleAnchor, stopSequenceReserve, exampleMessages, responseReserve]
 * 剩余预算用于对话历史（倒序填充）。
 *
 * 由调用方（CharacterDialogueChat.hooks.ts）计算各项精确 token 数后传入；
 * 若不传入，ContextTruncator.truncateMessages 会基于 systemPromptTokens 与 config
 * 构造默认必填项（roleAnchor / exampleMessages 默认 0，Task 4 / 后续 Task 注入真实值）。
 *
 * key 取值约定（与 spec reserve 顺序一致）：
 *   - 'systemPrompt'        系统提示词
 *   - 'roleAnchor'          角色深度锚定（Task 4）
 *   - 'stopSequenceReserve' Stop sequences 预留（固定 512）
 *   - 'exampleMessages'     示例消息（mes_example）
 *   - 'responseReserve'     AI 响应预留（reservedForResponse）
 */
export interface RequiredBudgetItem {
  key: string;
  tokens: number;
}
