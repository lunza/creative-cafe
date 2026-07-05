/**
 * 对话历史 RAG 检索与增量向量化触发条件工具函数
 *
 * Spec: optimize-chat-ai-intelligence / Task 7.5 + 7.6
 *
 * 设计目的：
 *   将 hooks.ts::requestAIResponse 中关于"何时触发 RAG 检索"与"何时触发增量向量化"
 *   的判断逻辑抽取为纯函数，便于单元测试覆盖。
 *   hooks.ts 中直接调用这些函数，保证业务逻辑与测试一致性。
 *
 * 触发条件（spec 约定）：
 *   - RAG 检索：对话历史 > 20 轮（即 contextMessages.length > 40，含 user+assistant 配对）
 *   - 增量向量化：每 5 轮（即 10 条消息）触发一次，对应 (contextMessages.length + 1) % 10 === 0
 *     （+1 是因为 contextMessages 含本轮 user 但不含 AI 响应，AI 响应在 onComplete 时已生成）
 */

/**
 * RAG 检索触发的消息数阈值。
 *
 * spec: "对话历史超过 20 轮" → 20 轮 × 2（user + assistant）= 40 条消息。
 * 严格大于 40 时触发（即第 21 轮的用户消息开始触发检索）。
 */
export const RAG_TRIGGER_MESSAGE_THRESHOLD = 40;

/**
 * 增量向量化触发的消息数周期。
 *
 * spec: "每 5 轮（即 10 条消息）" → 周期 = 10。
 */
export const INCREMENTAL_VECTORIZE_PERIOD = 10;

/**
 * 判断是否应触发对话历史 RAG 检索。
 *
 * @param contextMessagesLength 进入 requestAIResponse 时的消息数组长度（含本轮 user，不含 AI placeholder）
 * @returns true 表示应触发检索（长对话），false 表示跳过（短对话）
 */
export function shouldTriggerRagRetrieval(contextMessagesLength: number): boolean {
  return contextMessagesLength > RAG_TRIGGER_MESSAGE_THRESHOLD;
}

/**
 * 判断是否应触发增量向量化。
 *
 * @param contextMessagesLength 进入 requestAIResponse 时的消息数组长度（含本轮 user，不含 AI 响应）
 * @returns true 表示应触发增量向量化（达到 5 轮边界），false 表示跳过
 */
export function shouldTriggerIncrementalVectorize(contextMessagesLength: number): boolean {
  // +1 代表本轮 AI 响应（onComplete 时已生成）
  // 例：第 5 轮结束 → contextMessages.length=9 → 9+1=10 → 触发
  const totalMessagesAfterTurn = contextMessagesLength + 1;
  return totalMessagesAfterTurn % INCREMENTAL_VECTORIZE_PERIOD === 0;
}

/**
 * 从 contextMessages 中提取最近 N 条消息用于增量向量化。
 *
 * @param contextMessages 进入 requestAIResponse 时的消息数组
 * @param aiResponseText 本轮 AI 响应文本（displayContent）
 * @param aiMessageId 本轮 AI 消息的 id
 * @param count 返回的消息条数，默认 10（spec: "recentMessages 取最近 10 条消息"）
 * @returns 最近 N 条消息（含本轮 AI 响应），按时间顺序排列
 */
export function extractRecentMessagesForVectorize<T extends { id: string; role: string; content: string; timestamp?: number; speakerName?: string }>(
  contextMessages: T[],
  aiResponseText: string,
  aiMessageId: string,
  count: number = 10
): Array<{ id: string; role: 'user' | 'assistant' | 'system'; content: string; name?: string; timestamp: number }> {
  // 取 contextMessages 末尾 (count - 1) 条 + 本轮 AI 响应 = 共 count 条
  const sliceCount = Math.max(count - 1, 0);
  // 显式声明数组类型，避免 .map() 推断 name 为必填（string | undefined），
  // 导致后续 push 不含 name 的对象时类型不兼容（name? 可选 vs name: string | undefined 必填）。
  type RecentMessage = { id: string; role: 'user' | 'assistant' | 'system'; content: string; name?: string; timestamp: number };
  const recent: RecentMessage[] = contextMessages.slice(-sliceCount).map(msg => ({
    id: msg.id,
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
    name: msg.speakerName,
    timestamp: msg.timestamp ?? Date.now(),
  }));

  recent.push({
    id: aiMessageId,
    role: 'assistant' as const,
    content: aiResponseText,
    timestamp: Date.now(),
  });

  return recent;
}
