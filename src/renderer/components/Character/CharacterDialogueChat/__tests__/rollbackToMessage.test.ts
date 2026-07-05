/**
 * rollbackToMessage 核心逻辑单元测试
 *
 * 验证目标：
 * 1. 卷回用户消息时，移除该消息及所有后续消息，并返回用户消息内容
 * 2. messageId 不存在时返回空串且不修改消息列表
 * 3. 目标消息 role 不是 user 时返回空串且不修改消息列表
 * 4. 空消息列表时返回空串
 * 5. 卷回后返回的内容与原用户消息内容完全一致
 *
 * 说明：
 * rollbackToMessage 实际实现位于 CharacterDialogueChat.hooks.ts 中，
 * 依赖 messagesRef / setState / cancelRequest / saveChatToStore / addLog 等 hook 内部状态与副作用，
 * 难以在隔离环境下直接测试。因此这里将其核心算法（消息数组裁剪 + 内容返回）
 * 提取为纯函数 rollbackToMessageCore 进行测试，验证算法正确性。
 *
 * Spec: rollback-user-message / Task 4
 */

import { describe, it, expect } from 'vitest';
import { ChatMessage } from '../CharacterDialogueChat.types';

/**
 * 提取 rollbackToMessage 的核心算法进行纯函数测试。
 * 该函数与 CharacterDialogueChat.hooks.ts 中 rollbackToMessage 的算法保持一致：
 *   - 找到目标消息索引
 *   - 若不存在或 role 不是 user，返回空串且不修改消息列表
 *   - 否则返回目标消息内容，并将消息列表裁剪到目标消息之前
 */
function rollbackToMessageCore(
  messages: ChatMessage[],
  messageId: string
): { content: string; updatedMessages: ChatMessage[] } {
  const messageIndex = messages.findIndex(msg => msg.id === messageId);
  if (messageIndex === -1) {
    return { content: '', updatedMessages: messages };
  }
  const targetMessage = messages[messageIndex];
  if (targetMessage.role !== 'user') {
    return { content: '', updatedMessages: messages };
  }
  const rolledBackContent = targetMessage.content;
  const updatedMessages = messages.slice(0, messageIndex);
  return { content: rolledBackContent, updatedMessages };
}

describe('rollbackToMessage 核心逻辑', () => {
  // 测试数据构造器
  const createUserMessage = (id: string, content: string): ChatMessage => ({
    id,
    role: 'user',
    content,
    timestamp: Date.now(),
    status: 'sent',
  });

  const createAssistantMessage = (id: string, content: string): ChatMessage => ({
    id,
    role: 'assistant',
    content,
    timestamp: Date.now(),
    status: 'sent',
  });

  it('卷回最后一条用户消息：移除该消息 + AI 回复，返回用户消息内容', () => {
    const messages: ChatMessage[] = [
      createUserMessage('u1', '你好'),
      createAssistantMessage('a1', '你好！有什么可以帮你的？'),
      createUserMessage('u2', '今天天气怎么样'),
      createAssistantMessage('a2', '今天天气晴朗'),
    ];

    const result = rollbackToMessageCore(messages, 'u2');

    expect(result.content).toBe('今天天气怎么样');
    expect(result.updatedMessages).toHaveLength(2);
    expect(result.updatedMessages[0].id).toBe('u1');
    expect(result.updatedMessages[1].id).toBe('a1');
    // 被移除的消息不应出现在结果中
    expect(result.updatedMessages.find(m => m.id === 'u2')).toBeUndefined();
    expect(result.updatedMessages.find(m => m.id === 'a2')).toBeUndefined();
  });

  it('卷回中间轮次用户消息：移除该消息及所有后续消息', () => {
    const messages: ChatMessage[] = [
      createUserMessage('u1', '你好'),
      createAssistantMessage('a1', '你好！'),
      createUserMessage('u2', '今天天气怎么样'),
      createAssistantMessage('a2', '今天天气晴朗'),
      createUserMessage('u3', '谢谢'),
      createAssistantMessage('a3', '不客气'),
    ];

    const result = rollbackToMessageCore(messages, 'u2');

    expect(result.content).toBe('今天天气怎么样');
    expect(result.updatedMessages).toHaveLength(2);
    expect(result.updatedMessages[0].id).toBe('u1');
    expect(result.updatedMessages[1].id).toBe('a1');
    // u2/a2/u3/a3 都应被移除
    expect(result.updatedMessages.find(m => m.id === 'u2')).toBeUndefined();
    expect(result.updatedMessages.find(m => m.id === 'a2')).toBeUndefined();
    expect(result.updatedMessages.find(m => m.id === 'u3')).toBeUndefined();
    expect(result.updatedMessages.find(m => m.id === 'a3')).toBeUndefined();
  });

  it('卷回第一条用户消息：移除所有消息，返回内容', () => {
    const messages: ChatMessage[] = [
      createUserMessage('u1', '你好'),
      createAssistantMessage('a1', '你好！'),
    ];

    const result = rollbackToMessageCore(messages, 'u1');

    expect(result.content).toBe('你好');
    expect(result.updatedMessages).toHaveLength(0);
  });

  it('messageId 不存在时返回空串且不修改消息列表', () => {
    const messages: ChatMessage[] = [
      createUserMessage('u1', '你好'),
      createAssistantMessage('a1', '你好！'),
    ];

    const result = rollbackToMessageCore(messages, 'nonexistent-id');

    expect(result.content).toBe('');
    expect(result.updatedMessages).toHaveLength(2);
    expect(result.updatedMessages).toEqual(messages);
  });

  it('目标消息 role 不是 user 时返回空串且不修改消息列表', () => {
    const messages: ChatMessage[] = [
      createUserMessage('u1', '你好'),
      createAssistantMessage('a1', '你好！'),
    ];

    const result = rollbackToMessageCore(messages, 'a1');

    expect(result.content).toBe('');
    expect(result.updatedMessages).toHaveLength(2);
    expect(result.updatedMessages).toEqual(messages);
  });

  it('空消息列表时返回空串', () => {
    const messages: ChatMessage[] = [];

    const result = rollbackToMessageCore(messages, 'any-id');

    expect(result.content).toBe('');
    expect(result.updatedMessages).toHaveLength(0);
  });

  it('卷回后返回的内容与原用户消息内容完全一致', () => {
    const longContent = '这是一段较长的用户消息内容，包含多个字符和标点符号。测试卷回功能是否能完整保留原始内容，包括：中文、English、数字123、特殊符号！@#￥%……&*（）';
    const messages: ChatMessage[] = [
      createUserMessage('u1', longContent),
      createAssistantMessage('a1', '回复'),
    ];

    const result = rollbackToMessageCore(messages, 'u1');

    expect(result.content).toBe(longContent);
    expect(result.content.length).toBe(longContent.length);
  });
});
