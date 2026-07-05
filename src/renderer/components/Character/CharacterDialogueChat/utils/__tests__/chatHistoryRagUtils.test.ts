/**
 * 对话历史 RAG 触发条件工具函数单元测试
 *
 * 验证目标（spec Task 7.7）：
 *   1. 对话历史 > 20 轮时 shouldTriggerRagRetrieval 返回 true（步骤 A2 触发检索）
 *   2. 对话历史 ≤ 20 轮时返回 false（跳过）
 *   3. 增量向量化在 messages.length % 10 === 0 时 shouldTriggerIncrementalVectorize 返回 true
 *   4. 非边界轮次返回 false
 *   5. extractRecentMessagesForVectorize 返回正确结构
 *
 * Spec: optimize-chat-ai-intelligence / Task 7.5 + 7.6 + 7.7
 */

import { describe, it, expect } from 'vitest';
import {
  shouldTriggerRagRetrieval,
  shouldTriggerIncrementalVectorize,
  extractRecentMessagesForVectorize,
  RAG_TRIGGER_MESSAGE_THRESHOLD,
  INCREMENTAL_VECTORIZE_PERIOD,
} from '../chatHistoryRagUtils';

describe('shouldTriggerRagRetrieval (Task 7.5 - Step A2 trigger condition)', () => {
  it('should return false when messages ≤ 40 (≤ 20 rounds, short conversation)', () => {
    // spec: "对话历史 ≤ 20 轮 → 跳过对话历史 RAG 检索（原始消息已在上下文中）"
    expect(shouldTriggerRagRetrieval(0)).toBe(false);
    expect(shouldTriggerRagRetrieval(2)).toBe(false); // 1 轮
    expect(shouldTriggerRagRetrieval(20)).toBe(false); // 10 轮
    expect(shouldTriggerRagRetrieval(40)).toBe(false); // 20 轮（边界，不严格大于）
  });

  it('should return true when messages > 40 (> 20 rounds, long conversation)', () => {
    // spec: "对话历史超过 20 轮 → 检索本会话历史 topK=3 相关片段"
    expect(shouldTriggerRagRetrieval(41)).toBe(true); // 第 21 轮 user 消息
    expect(shouldTriggerRagRetrieval(50)).toBe(true); // 25 轮
    expect(shouldTriggerRagRetrieval(100)).toBe(true); // 50 轮
    expect(shouldTriggerRagRetrieval(200)).toBe(true); // 100 轮
  });

  it('should respect RAG_TRIGGER_MESSAGE_THRESHOLD constant (= 40)', () => {
    expect(RAG_TRIGGER_MESSAGE_THRESHOLD).toBe(40);
  });

  it('spec scenario: 第 21 轮用户消息应触发对话历史 RAG 检索', () => {
    // spec SubTask 7.7: "构造 25 轮对话场景，第 21 轮用户消息应触发对话历史 RAG 检索"
    // 第 21 轮 user 消息对应 contextMessages.length = 40 (前 20 轮 = 40 条) + 1 (本轮 user) = 41
    expect(shouldTriggerRagRetrieval(41)).toBe(true);
  });
});

describe('shouldTriggerIncrementalVectorize (Task 7.6 - incremental vectorize trigger)', () => {
  it('should return true at every 5-round boundary (10 messages)', () => {
    // spec: "每 5 轮（即 10 条消息）触发一次"
    // (contextMessages.length + 1) % 10 === 0
    //   第 5 轮结束 → contextMessages.length = 9 (前 4 轮 8 条 + 本轮 user 1 条) → 9+1=10 → true
    //   第 10 轮结束 → contextMessages.length = 19 → 19+1=20 → true
    //   第 15 轮结束 → contextMessages.length = 29 → 29+1=30 → true
    expect(shouldTriggerIncrementalVectorize(9)).toBe(true);   // 第 5 轮
    expect(shouldTriggerIncrementalVectorize(19)).toBe(true);  // 第 10 轮
    expect(shouldTriggerIncrementalVectorize(29)).toBe(true);  // 第 15 轮
    expect(shouldTriggerIncrementalVectorize(39)).toBe(true);  // 第 20 轮
    expect(shouldTriggerIncrementalVectorize(49)).toBe(true);  // 第 25 轮
    expect(shouldTriggerIncrementalVectorize(99)).toBe(true);  // 第 50 轮
  });

  it('should return false at non-boundary rounds', () => {
    expect(shouldTriggerIncrementalVectorize(0)).toBe(false);   // 初始（无消息）
    expect(shouldTriggerIncrementalVectorize(1)).toBe(false);   // 第 1 轮 user 消息（仅 1 条，AI 未响应）
    expect(shouldTriggerIncrementalVectorize(2)).toBe(false);   // 第 1 轮结束（2 条）
    expect(shouldTriggerIncrementalVectorize(10)).toBe(false);  // 第 5 轮 user 消息（10 条，AI 未响应）
    expect(shouldTriggerIncrementalVectorize(15)).toBe(false);  // 第 8 轮 user 消息
    expect(shouldTriggerIncrementalVectorize(20)).toBe(false);  // 第 10 轮 user 消息（AI 未响应）
    expect(shouldTriggerIncrementalVectorize(25)).toBe(false);  // 第 13 轮 user 消息
  });

  it('should respect INCREMENTAL_VECTORIZE_PERIOD constant (= 10)', () => {
    expect(INCREMENTAL_VECTORIZE_PERIOD).toBe(10);
  });

  it('spec scenario: 第 5/10/15 轮应触发增量向量化', () => {
    // spec SubTask 7.7: "第 5/10/15... 轮应触发增量向量化"
    expect(shouldTriggerIncrementalVectorize(9)).toBe(true);   // 第 5 轮结束
    expect(shouldTriggerIncrementalVectorize(19)).toBe(true);  // 第 10 轮结束
    expect(shouldTriggerIncrementalVectorize(29)).toBe(true);  // 第 15 轮结束
  });
});

describe('extractRecentMessagesForVectorize (Task 7.6 - message extraction)', () => {
  interface TestMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: number;
    speakerName?: string;
  }

  it('should return last N messages including AI response (default count=10)', () => {
    // 构造 15 条消息（不含本轮 AI 响应）
    const contextMessages: TestMessage[] = Array.from({ length: 15 }, (_, i) => ({
      id: `msg-${i}`,
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `消息内容 ${i}`,
      timestamp: 1000 + i,
      speakerName: i % 2 === 0 ? 'User' : 'Character',
    }));

    const result = extractRecentMessagesForVectorize(contextMessages, 'AI 响应', 'ai-msg-id');

    // 默认 count=10，应返回 10 条（contextMessages 末尾 9 条 + AI 响应 1 条）
    expect(result).toHaveLength(10);
    // 最后一条是 AI 响应
    expect(result[9]).toEqual({
      id: 'ai-msg-id',
      role: 'assistant',
      content: 'AI 响应',
      timestamp: expect.any(Number),
    });
    // 第 1 条应是 contextMessages[6]（15-9=6，从索引 6 开始取 9 条）
    expect(result[0].id).toBe('msg-6');
    expect(result[0].content).toBe('消息内容 6');
  });

  it('should handle fewer messages than count (return all + AI response)', () => {
    const contextMessages: TestMessage[] = [
      { id: 'msg-0', role: 'user', content: '你好', timestamp: 1000, speakerName: 'User' },
      { id: 'msg-1', role: 'assistant', content: '你好！', timestamp: 2000, speakerName: 'Character' },
    ];

    const result = extractRecentMessagesForVectorize(contextMessages, 'AI 响应', 'ai-msg-id', 10);

    // 只有 2 条 contextMessages + 1 条 AI 响应 = 3 条
    expect(result).toHaveLength(3);
    expect(result[2].id).toBe('ai-msg-id');
  });

  it('should handle empty contextMessages (return only AI response)', () => {
    const result = extractRecentMessagesForVectorize([], 'AI 响应', 'ai-msg-id', 10);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'ai-msg-id',
      role: 'assistant',
      content: 'AI 响应',
      timestamp: expect.any(Number),
    });
  });

  it('should preserve speakerName as name field', () => {
    const contextMessages: TestMessage[] = [
      { id: 'msg-0', role: 'user', content: '你好', timestamp: 1000, speakerName: 'User' },
    ];

    const result = extractRecentMessagesForVectorize(contextMessages, 'AI 响应', 'ai-msg-id', 5);

    expect(result[0].name).toBe('User');
    // AI 响应的 name 字段应为 undefined（未设置）
    expect(result[1].name).toBeUndefined();
  });

  it('should fallback to Date.now() when message.timestamp is missing', () => {
    const before = Date.now();
    const contextMessages: TestMessage[] = [
      { id: 'msg-0', role: 'user', content: '你好' /* timestamp 缺失 */ },
    ];
    const after = Date.now();

    const result = extractRecentMessagesForVectorize(contextMessages, 'AI 响应', 'ai-msg-id', 5);

    expect(result[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(result[0].timestamp).toBeLessThanOrEqual(after);
  });

  it('should respect custom count parameter', () => {
    const contextMessages: TestMessage[] = Array.from({ length: 20 }, (_, i) => ({
      id: `msg-${i}`,
      role: 'user' as const,
      content: `内容 ${i}`,
      timestamp: 1000 + i,
    }));

    const result = extractRecentMessagesForVectorize(contextMessages, 'AI 响应', 'ai-msg-id', 5);

    // count=5 → contextMessages 末尾 4 条 + AI 响应 1 条
    expect(result).toHaveLength(5);
    expect(result[0].id).toBe('msg-16'); // 20-4=16
    expect(result[4].id).toBe('ai-msg-id');
  });
});
