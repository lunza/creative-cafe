/**
 * ChatHistory 记忆适配器 —— 桥接 chatSessionRepository 到 IMemoryAdapter
 *
 * 来源：spec §二 Task 8.3（adapters/chatHistoryAdapter）
 * 决策：适配（spec §三）。现有 chatSessionRepository 管理对话历史，
 *       本适配器将历史消息转换为 MemoryEntry 格式，供 MemoryStore 检索。
 *
 * 职责：
 *  1. 桥接 chatSessionRepository.getChatMessages → MemoryEntry[]（对话历史检索）
 *  2. 支持按 characterId / sessionId 过滤
 *  3. 关键词匹配检索相关历史消息
 *
 * 设计约束（spec §5.1 双轨并行）：
 *  - 不修改 chatSessionRepository 源码
 *  - 适配器失败不中断 MemoryStore.search
 */

import type { MemoryEntry, MemoryQuery, MemoryType } from '../../contracts';
import type { IMemoryAdapter } from '../memoryStore';

// ==================== ChatHistory 适配器 ====================

/**
 * Chat 会话仓库接口（chatSessionRepository 的子集，用于解耦）。
 */
export interface IChatSessionRepository {
  /** 获取对话消息（分页） */
  getChatMessages(
    sessionId: string,
    options?: { page?: number; pageSize?: number }
  ): Promise<{
    messages: Array<{
      id?: string;
      role: string;
      content: string;
      timestamp?: number;
      [key: string]: unknown;
    }>;
    total?: number;
  }>;
  /** 搜索对话消息 */
  searchChatMessages(
    sessionId: string,
    query: string,
    options?: { limit?: number }
  ): Promise<Array<{
    id?: string;
    role: string;
    content: string;
    timestamp?: number;
    score?: number;
  }>>;
}

/**
 * ChatHistory 记忆适配器。
 *
 * 将对话历史转换为 MemoryEntry 格式。
 * type='dialogue'（对话历史）。
 */
export class ChatHistoryAdapter implements IMemoryAdapter {
  readonly type: MemoryType = 'dialogue';

  constructor(private readonly chatRepository: IChatSessionRepository) {}

  async search(query: MemoryQuery): Promise<MemoryEntry[]> {
    if (!query.sessionId) {
      // 无 sessionId 时无法检索对话历史
      return [];
    }

    try {
      const limit = query.limit ?? 10;

      // 若有查询关键词，使用 searchChatMessages
      if (query.query) {
        const messages = await this.chatRepository.searchChatMessages(
          query.sessionId,
          query.query,
          { limit }
        );
        return messages.map(msg => this.toMemoryEntry(msg, query.sessionId!));
      }

      // 无关键词时返回最近的消息
      const result = await this.chatRepository.getChatMessages(query.sessionId, {
        page: 1,
        pageSize: limit,
      });
      return result.messages.map(msg => this.toMemoryEntry(msg, query.sessionId!));
    } catch (err) {
      console.warn('[ChatHistoryAdapter] search failed:', err);
      return [];
    }
  }

  async read(source: string): Promise<MemoryEntry | null> {
    // source 格式：chatHistory:<sessionId>:<messageId>
    // 当前简化实现：不按 messageId 单条读取，返回 null
    // 未来可扩展 chatRepository.getMessageById
    void source;
    return null;
  }

  /**
   * 将聊天消息转换为 MemoryEntry。
   */
  private toMemoryEntry(
    msg: {
      id?: string;
      role: string;
      content: string;
      timestamp?: number;
      score?: number;
    },
    sessionId: string
  ): MemoryEntry {
    const msgId = msg.id ?? `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return {
      id: `dialogue_${msgId}`,
      type: 'dialogue',
      content: `${msg.role}: ${msg.content}`,
      source: `chatHistory:${sessionId}:${msgId}`,
      score: msg.score,
      sessionId,
      timestamp: msg.timestamp ?? Date.now(),
    };
  }
}
