/**
 * 上下文压缩工具 —— 适配 openclaw compaction.ts
 *
 * 职责：
 *  1. 判断是否需要压缩（token > maxContextTokens * 0.7）
 *  2. 将消息分割为"需摘要的旧消息"和"保留的近期消息"
 *  3. 构建摘要 prompt
 *  4. 将摘要结果包装为 system 消息
 *
 * 注意：本模块为纯工具模块，不包含 AI 调用逻辑。
 * AI 调用由 hooks.ts 中的 compressContext 函数负责。
 *
 * Spec: optimize-agent-interaction-from-openclaw / M3-Task9
 */

import type { ChatMessage } from './CharacterDialogueChat.types';

// ==================== 常量 ====================

/** 压缩触发阈值（token 占用超过总量的 70%） */
export const COMPACTION_THRESHOLD = 0.7;

/** 保留的近期消息轮数（每轮 = 1 user + 1 assistant = 2 条消息） */
export const KEEP_RECENT_ROUNDS = 10;

/** 每组摘要的消息数（10 轮 = 20 条消息） */
export const MESSAGES_PER_SUMMARY_GROUP = 20;

/** 单条消息摘要时的最大字符数（超过则截断） */
const MAX_MESSAGE_CHARS_FOR_SUMMARY = 2000;

// ==================== 类型定义 ====================

/**
 * 压缩结果。
 *
 * compactContext 函数（在 hooks.ts 中实现）调用辅助函数完成压缩后，
 * 返回此结构供调用方更新状态。
 */
export interface CompactionResult {
  /** 压缩后的消息列表（摘要 system 消息 + 近期原文消息） */
  messages: ChatMessage[];
  /** 是否实际执行了压缩 */
  wasCompacted: boolean;
  /** 原始消息数 */
  originalCount: number;
  /** 压缩后消息数 */
  compactedCount: number;
  /** 摘要文本（如果有） */
  summary?: string;
  /** 保留的近期消息轮数 */
  keptRounds: number;
  /** 降级原因（压缩失败时填充） */
  fallbackReason?: string;
}

/**
 * compactContext 接口签名（SubTask 9.1）。
 *
 * 实际实现在 hooks.ts 的 compressContext 函数中，
 * 因为需要访问 ChatEngine 进行 AI 调用。
 */
export type CompactContextFn = (
  messages: ChatMessage[],
  maxTokens: number
) => Promise<CompactionResult>;

// ==================== 辅助函数 ====================

/**
 * 判断是否需要压缩。
 *
 * 当对话历史 token 占用超过 maxTokens 的 70% 时返回 true。
 *
 * @param totalTokens 当前对话历史的 token 总量
 * @param maxTokens 上下文窗口的最大 token 数
 * @returns 是否需要压缩
 */
export function shouldCompact(totalTokens: number, maxTokens: number): boolean {
  return totalTokens > maxTokens * COMPACTION_THRESHOLD;
}

/**
 * 将消息分割为"需摘要的旧消息"和"保留的近期消息"。
 *
 * 策略：
 *  - system 消息不参与压缩，始终保留在 toKeep 中
 *  - 非系统消息保留最后 keepRounds * 2 条（keepRounds 轮对话）
 *  - 剩余的非系统消息作为 toSummarize
 *
 * @param messages 完整的消息列表
 * @param keepRounds 保留的近期消息轮数（每轮 = 2 条消息）
 * @returns 分割结果：toSummarize（需摘要）+ toKeep（保留原文）
 */
export function splitMessages(
  messages: ChatMessage[],
  keepRounds: number
): { toSummarize: ChatMessage[]; toKeep: ChatMessage[] } {
  // 分离 system 消息和非系统消息
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  const keepCount = keepRounds * 2;

  // 非系统消息不足保留数量时，全部保留，无需摘要
  if (nonSystemMessages.length <= keepCount) {
    return {
      toSummarize: [],
      toKeep: [...systemMessages, ...nonSystemMessages],
    };
  }

  // 保留最后 keepCount 条非系统消息
  const toKeepNonSystem = nonSystemMessages.slice(-keepCount);
  // 较早的非系统消息需要摘要
  const toSummarize = nonSystemMessages.slice(0, -keepCount);

  return {
    toSummarize,
    toKeep: [...systemMessages, ...toKeepNonSystem],
  };
}

/**
 * 将消息列表格式化为摘要用的文本。
 *
 * 格式：`{role}: {content}` 逐行排列。
 * 单条消息超过 2000 字符时截取前 2000 字符 + "...[截断]"。
 *
 * @param messages 待格式化的消息列表
 * @returns 格式化后的文本
 */
export function formatMessagesForSummary(messages: ChatMessage[]): string {
  return messages
    .map((msg) => {
      const content = msg.content || '';
      const truncated =
        content.length > MAX_MESSAGE_CHARS_FOR_SUMMARY
          ? content.substring(0, MAX_MESSAGE_CHARS_FOR_SUMMARY) + '...[截断]'
          : content;
      return `${msg.role}: ${truncated}`;
    })
    .join('\n');
}

/**
 * 构建摘要 prompt。
 *
 * 指导 AI 总结对话的关键信息，包括角色设定、重要事件、承诺、未解决话题，
 * 并保留所有专有名词。
 *
 * @param messages 待摘要的消息列表
 * @returns 构建好的摘要 prompt 文本
 */
export function buildSummaryPrompt(messages: ChatMessage[]): string {
  const formattedContent = formatMessagesForSummary(messages);

  return `请总结以下对话的关键信息，包括：
- 角色设定与性格特征
- 重要事件与剧情进展
- 角色间的承诺与约定
- 未解决的话题与悬念
- 所有专有名词（人名/地名/物品名等）

请用简洁的叙述体输出，保留所有关键细节：

---对话内容---
${formattedContent}`;
}

/**
 * 创建标记为 [对话摘要] 的 system 消息。
 *
 * 压缩结果作为 system 消息注入上下文，替换原始的旧消息。
 *
 * @param summary AI 生成的摘要文本
 * @returns 标记为 [对话摘要] 的 ChatMessage
 */
export function createSummaryMessage(summary: string): ChatMessage {
  return {
    id: `compaction-summary-${Date.now()}`,
    role: 'system',
    content: `[对话摘要]\n${summary}`,
    timestamp: Date.now(),
    status: 'sent',
  };
}

/**
 * 构建压缩失败时的降级结果。
 *
 * 压缩失败时不修改消息列表，返回原始消息，wasCompacted=false。
 * ContextTruncator 会在下次请求时自动裁剪。
 *
 * @param messages 原始消息列表
 * @param reason 失败原因
 * @returns 降级结果
 */
export function buildFallbackResult(
  messages: ChatMessage[],
  reason: string
): CompactionResult {
  return {
    messages,
    wasCompacted: false,
    originalCount: messages.length,
    compactedCount: messages.length,
    keptRounds: 0,
    summary: undefined,
    fallbackReason: reason,
  };
}
