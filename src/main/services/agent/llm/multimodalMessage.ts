/**
 * 多模态消息格式 —— 统一文本/图像消息表示
 *
 * 来源：spec §二 Task 6.2（multimodalMessage.ts）
 * 决策：适配。openclaw 的 llm/types.ts 消息抽象理念照搬，对接项目 OpenAI 兼容格式。
 *
 * 职责：
 *  1. 统一消息格式（text + image_url），屏蔽 OpenAI/Anthropic 差异
 *  2. 构建工具调用消息（tool_calls / role='tool' 回填）
 *  3. 消息序列化/反序列化（用于持久化和 IPC 传输）
 */

// ==================== 统一消息格式 ====================

/**
 * 多模态消息内容（文本或图像）。
 */
export type MessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
    >;

/**
 * 统一多模态消息格式。
 *
 * 兼容 OpenAI chat completions 的 message 格式，同时支持 tool_calls 回填。
 */
export interface MultimodalMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent;
  /** tool_calls（仅 assistant 消息，模型决定调用工具时存在） */
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  /** tool_call_id（仅 role='tool' 消息，回填工具执行结果时匹配） */
  tool_call_id?: string;
  /** 名称（role='tool' 时的工具名） */
  name?: string;
}

// ==================== 消息构建工具 ====================

/**
 * 构建纯文本用户消息。
 */
export function textUserMessage(content: string): MultimodalMessage {
  return { role: 'user', content };
}

/**
 * 构建纯文本助手消息。
 */
export function textAssistantMessage(content: string): MultimodalMessage {
  return { role: 'assistant', content };
}

/**
 * 构建系统消息。
 */
export function systemMessage(content: string): MultimodalMessage {
  return { role: 'system', content };
}

/**
 * 构建多模态用户消息（文本 + 图像）。
 *
 * @param text 文本内容
 * @param imageUrls 图像 URL 数组（data:image/...;base64,... 或 http(s)://...）
 * @param detail 图像细节级别（low=省 token / high=精细 / auto=自动）
 */
export function multimodalUserMessage(
  text: string,
  imageUrls: string[],
  detail: 'low' | 'high' | 'auto' = 'auto'
): MultimodalMessage {
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
  > = [{ type: 'text', text }];

  for (const url of imageUrls) {
    content.push({ type: 'image_url', image_url: { url, detail } });
  }

  return { role: 'user', content };
}

/**
 * 构建工具调用结果消息（role='tool'）。
 *
 * agentLoop 执行工具后，用此函数构建回填消息，将工具结果送回 LLM 继续决策。
 *
 * @param toolCallId 对应的 tool_call.id（OpenAI 协议要求匹配）
 * @param toolName 工具名
 * @param result 工具执行结果（字符串）
 */
export function toolResultMessage(
  toolCallId: string,
  toolName: string,
  result: string
): MultimodalMessage {
  return {
    role: 'tool',
    content: result,
    tool_call_id: toolCallId,
    name: toolName,
  };
}

/**
 * 构建带 tool_calls 的助手消息。
 *
 * 当 LLM 返回 tool_calls 时，agentLoop 需将其作为 assistant 消息加入历史，
 * 随后追加 role='tool' 的结果消息，再次请求 LLM。
 */
export function assistantWithToolCalls(
  content: string,
  toolCalls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>
): MultimodalMessage {
  return {
    role: 'assistant',
    content: content || '',
    tool_calls: toolCalls,
  };
}

// ==================== 消息转换 ====================

/**
 * 将 contracts.ts 的精简消息格式转换为 MultimodalMessage。
 */
export function fromContractMessages(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt?: string
): MultimodalMessage[] {
  const result: MultimodalMessage[] = [];
  if (systemPrompt) {
    result.push(systemMessage(systemPrompt));
  }
  for (const msg of messages) {
    result.push(
      msg.role === 'user' ? textUserMessage(msg.content) : textAssistantMessage(msg.content)
    );
  }
  return result;
}
