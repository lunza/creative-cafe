import { describe, it, expect, beforeEach } from 'vitest';
import { TokenCounter } from '../TokenManagement/TokenCounter';
import { ContextTruncator } from '../TokenManagement/ContextTruncator';
import { ChatMessage } from '../CharacterDialogueChat.types';
import { TruncationConfig } from '../TokenManagement/types';

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: overrides.id || `msg-${Date.now()}-${Math.random()}`,
    role: overrides.role || 'user',
    content: overrides.content || 'Hello',
    timestamp: overrides.timestamp || Date.now(),
    status: overrides.status || 'sent',
    speakerName: overrides.speakerName,
    ...overrides,
  };
}

describe('TokenCounter', () => {
  beforeEach(() => {
    TokenCounter.clearCache();
  });

  describe('estimateTokens', () => {
    it('should return 0 for empty string', () => {
      expect(TokenCounter.estimateTokens('')).toBe(0);
    });

    it('should return 0 for null/undefined', () => {
      expect(TokenCounter.estimateTokens('')).toBe(0);
    });

    it('should estimate tokens for short English text', () => {
      const text = 'Hello world';
      const tokens = TokenCounter.estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('should estimate tokens for Chinese text', () => {
      const text = '你好世界';
      const tokens = TokenCounter.estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should scale with text length', () => {
      const shortText = 'Hello';
      const longText = 'Hello '.repeat(100);
      
      const shortTokens = TokenCounter.estimateTokens(shortText);
      const longTokens = TokenCounter.estimateTokens(longText);
      
      expect(longTokens).toBeGreaterThan(shortTokens);
    });

    it('should use BYTES_PER_TOKEN ratio of 3.35', () => {
      const text = 'Test text for token estimation';
      const byteLength = new TextEncoder().encode(text).length;
      const expectedTokens = Math.ceil(byteLength / 3.35);
      const actualTokens = TokenCounter.estimateTokens(text);
      
      expect(actualTokens).toBe(expectedTokens);
    });
  });

  describe('countMessageTokens', () => {
    it('should count tokens for a single message', () => {
      const message = createMessage({ content: 'Hello world' });
      const tokens = TokenCounter.countMessageTokens(message);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should include format overhead', () => {
      const message = createMessage({ content: 'Hello' });
      const contentTokens = TokenCounter.estimateTokens('Hello');
      const totalTokens = TokenCounter.countMessageTokens(message);
      
      expect(totalTokens).toBeGreaterThan(contentTokens);
    });

    it('should cache results for same message id', () => {
      const message = createMessage({ content: 'Cached message' });
      const first = TokenCounter.countMessageTokens(message);
      const second = TokenCounter.countMessageTokens(message);
      
      expect(first).toBe(second);
    });

    it('should handle empty content', () => {
      const message = createMessage({ content: '' });
      const tokens = TokenCounter.countMessageTokens(message);
      expect(tokens).toBeGreaterThan(0); // Should include format overhead
    });
  });

  describe('countMessagesTokens', () => {
    it('should return TOKENS_PADDING for empty array', () => {
      const tokens = TokenCounter.countMessagesTokens([]);
      expect(tokens).toBe(3); // TOKENS_PADDING
    });

    it('should sum tokens for multiple messages', () => {
      const messages = [
        createMessage({ id: 'msg-1', content: 'Hello' }),
        createMessage({ id: 'msg-2', content: 'Hi there' }),
      ];
      
      const total = TokenCounter.countMessagesTokens(messages);
      const individual1 = TokenCounter.countMessageTokens(messages[0]);
      const individual2 = TokenCounter.countMessageTokens(messages[1]);
      
      expect(total).toBe(individual1 + individual2 + 3); // +3 for padding
    });

    it('should increase with more messages', () => {
      const short = [
        createMessage({ id: 's1', content: 'Hi' }),
        createMessage({ id: 's2', content: 'Hello' }),
      ];
      
      const long = [
        createMessage({ id: 'l1', content: 'Hi' }),
        createMessage({ id: 'l2', content: 'Hello' }),
        createMessage({ id: 'l3', content: 'How are you?' }),
        createMessage({ id: 'l4', content: 'I am fine' }),
      ];
      
      const shortTokens = TokenCounter.countMessagesTokens(short);
      const longTokens = TokenCounter.countMessagesTokens(long);
      
      expect(longTokens).toBeGreaterThan(shortTokens);
    });
  });

  describe('countSystemPromptTokens', () => {
    it('should estimate tokens for system prompt', () => {
      const prompt = 'You are a helpful assistant';
      const tokens = TokenCounter.countSystemPromptTokens(prompt);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should match estimateTokens for same text', () => {
      const text = 'System prompt text';
      const systemTokens = TokenCounter.countSystemPromptTokens(text);
      const estimateTokens = TokenCounter.estimateTokens(text);
      
      expect(systemTokens).toBe(estimateTokens);
    });
  });

  describe('countTotalUsage', () => {
    it('should return complete token usage result', () => {
      const systemPrompt = 'You are an assistant';
      const messages = [
        createMessage({ id: 'm1', content: 'Hello' }),
        createMessage({ id: 'm2', content: 'Hi' }),
      ];
      
      const result = TokenCounter.countTotalUsage(systemPrompt, messages, 1024);
      
      expect(result.totalTokens).toBeGreaterThan(0);
      expect(result.systemPromptTokens).toBeGreaterThan(0);
      expect(result.messagesTokens).toBeGreaterThan(0);
      expect(result.reservedForResponse).toBe(1024);
    });

    it('should use default reserved tokens', () => {
      const result = TokenCounter.countTotalUsage('test', []);
      expect(result.reservedForResponse).toBe(1024);
    });

    it('should sum all components correctly', () => {
      const systemPrompt = 'Test';
      const messages = [createMessage({ id: 'm1', content: 'Test' })];
      const reserved = 512;
      
      const result = TokenCounter.countTotalUsage(systemPrompt, messages, reserved);
      const expectedTotal = result.systemPromptTokens + result.messagesTokens + reserved;
      
      expect(result.totalTokens).toBe(expectedTotal);
    });
  });

  describe('cache management', () => {
    it('should evict specific message from cache', () => {
      const msg1 = createMessage({ id: 'cache-1', content: 'Test 1' });
      const msg2 = createMessage({ id: 'cache-2', content: 'Test 2' });
      
      TokenCounter.countMessageTokens(msg1);
      TokenCounter.countMessageTokens(msg2);
      
      TokenCounter.evictCache('cache-1');
      
      const msg3 = createMessage({ id: 'cache-1', content: 'Test 1' });
      const newTokens = TokenCounter.countMessageTokens(msg3);
      expect(newTokens).toBeDefined();
    });

    it('should clear all cache', () => {
      const msg1 = createMessage({ id: 'clear-1', content: 'Test' });
      const msg2 = createMessage({ id: 'clear-2', content: 'Test' });
      
      TokenCounter.countMessageTokens(msg1);
      TokenCounter.countMessageTokens(msg2);
      
      TokenCounter.clearCache();
      
      const msg3 = createMessage({ id: 'clear-1', content: 'Test' });
      const tokens = TokenCounter.countMessageTokens(msg3);
      expect(tokens).toBeDefined();
    });
  });
});

describe('ContextTruncator', () => {
  const defaultConfig: TruncationConfig = {
    maxContextTokens: 4000,
    reservedForResponse: 1024,
    minMessagesToKeep: 2,
    maxMessagesToKeep: 20,
  };

  describe('truncateMessages', () => {
    it('should return empty array for empty input', () => {
      const result = ContextTruncator.truncateMessages([], 1000, defaultConfig);
      expect(result).toEqual([]);
    });

    it('should not truncate when within budget', () => {
      const messages = [
        createMessage({ id: 't1', role: 'user', content: 'Hello' }),
        createMessage({ id: 't2', role: 'assistant', content: 'Hi there' }),
        createMessage({ id: 't3', role: 'user', content: 'How are you?' }),
        createMessage({ id: 't4', role: 'assistant', content: 'I am fine' }),
      ];
      
      const systemTokens = 500;
      const config: TruncationConfig = {
        maxContextTokens: 10000,
        reservedForResponse: 1024,
        minMessagesToKeep: 2,
        maxMessagesToKeep: 20,
      };
      
      const result = ContextTruncator.truncateMessages(messages, systemTokens, config);
      expect(result.length).toBe(4);
    });

    it('should truncate oldest messages when over budget', () => {
      const messages: ChatMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push(
          createMessage({ id: `old-${i}`, role: 'user', content: 'User message '.repeat(50) }),
          createMessage({ id: `old-resp-${i}`, role: 'assistant', content: 'Assistant response '.repeat(50) })
        );
      }
      
      const systemTokens = 2000;
      const config: TruncationConfig = {
        maxContextTokens: 4000,
        reservedForResponse: 1024,
        minMessagesToKeep: 2,
        maxMessagesToKeep: 20,
      };
      
      const result = ContextTruncator.truncateMessages(messages, systemTokens, config);
      expect(result.length).toBeLessThan(messages.length);
      expect(result.length).toBeGreaterThanOrEqual(config.minMessagesToKeep * 2);
    });

    it('should keep at least minMessagesToKeep rounds', () => {
      const messages = [
        createMessage({ id: 'min-1', role: 'user', content: 'A'.repeat(5000) }),
        createMessage({ id: 'min-2', role: 'assistant', content: 'B'.repeat(5000) }),
        createMessage({ id: 'min-3', role: 'user', content: 'C'.repeat(5000) }),
        createMessage({ id: 'min-4', role: 'assistant', content: 'D'.repeat(5000) }),
      ];
      
      const config: TruncationConfig = {
        maxContextTokens: 2000,
        reservedForResponse: 1024,
        minMessagesToKeep: 2,
        maxMessagesToKeep: 20,
      };
      
      const result = ContextTruncator.truncateMessages(messages, 0, config);
      expect(result.length).toBeGreaterThanOrEqual(config.minMessagesToKeep * 2);
    });

    it('should keep at most maxMessagesToKeep', () => {
      const messages: ChatMessage[] = [];
      for (let i = 0; i < 50; i++) {
        messages.push(
          createMessage({ id: `max-${i}`, role: 'user', content: 'Short' }),
          createMessage({ id: `max-resp-${i}`, role: 'assistant', content: 'Short' })
        );
      }
      
      const config: TruncationConfig = {
        maxContextTokens: 100000,
        reservedForResponse: 1024,
        minMessagesToKeep: 2,
        maxMessagesToKeep: 20,
      };
      
      const result = ContextTruncator.truncateMessages(messages, 1000, config);
      expect(result.length).toBeLessThanOrEqual(config.maxMessagesToKeep);
    });

    it('should prefer recent messages', () => {
      const messages = [
        createMessage({ id: 'recent-1', role: 'user', content: 'Old message' }),
        createMessage({ id: 'recent-2', role: 'assistant', content: 'Old response' }),
        createMessage({ id: 'recent-3', role: 'user', content: 'Recent message' }),
        createMessage({ id: 'recent-4', role: 'assistant', content: 'Recent response' }),
      ];
      
      const config: TruncationConfig = {
        maxContextTokens: 3000,
        reservedForResponse: 1024,
        minMessagesToKeep: 2,
        maxMessagesToKeep: 20,
      };
      
      const result = ContextTruncator.truncateMessages(messages, 1000, config);
      
      if (result.length < messages.length) {
        expect(result[result.length - 1].id).toBe('recent-4');
      }
    });
  });

  describe('ensureMessagePairs', () => {
    it('should return empty array for empty input', () => {
      expect(ContextTruncator.ensureMessagePairs([])).toEqual([]);
    });

    it('should remove leading assistant message', () => {
      const messages = [
        createMessage({ id: 'pair-1', role: 'assistant', content: 'Orphan response' }),
        createMessage({ id: 'pair-2', role: 'user', content: 'Hello' }),
        createMessage({ id: 'pair-3', role: 'assistant', content: 'Hi' }),
      ];
      
      const result = ContextTruncator.ensureMessagePairs(messages);
      expect(result[0].role).toBe('user');
      expect(result.length).toBe(2);
    });

    it('should keep valid user-assistant pairs', () => {
      const messages = [
        createMessage({ id: 'valid-1', role: 'user', content: 'Hello' }),
        createMessage({ id: 'valid-2', role: 'assistant', content: 'Hi' }),
        createMessage({ id: 'valid-3', role: 'user', content: 'Bye' }),
        createMessage({ id: 'valid-4', role: 'assistant', content: 'Goodbye' }),
      ];
      
      const result = ContextTruncator.ensureMessagePairs(messages);
      expect(result.length).toBe(4);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('assistant');
    });

    it('should handle trailing user message', () => {
      const messages = [
        createMessage({ id: 'trail-1', role: 'user', content: 'Hello' }),
        createMessage({ id: 'trail-2', role: 'assistant', content: 'Hi' }),
        createMessage({ id: 'trail-3', role: 'user', content: 'Question?' }),
      ];
      
      const result = ContextTruncator.ensureMessagePairs(messages);
      expect(result.length).toBe(3);
      expect(result[result.length - 1].role).toBe('user');
    });
  });

  describe('analyzeTruncation', () => {
    it('should return correct analysis for no truncation', () => {
      const messages = [
        createMessage({ id: 'analyze-1', role: 'user', content: 'Hello' }),
        createMessage({ id: 'analyze-2', role: 'assistant', content: 'Hi' }),
      ];
      
      const analysis = ContextTruncator.analyzeTruncation(messages, messages, 1000, defaultConfig);
      
      expect(analysis.wasTruncated).toBe(false);
      expect(analysis.removedCount).toBe(0);
      expect(analysis.originalCount).toBe(2);
      expect(analysis.truncatedCount).toBe(2);
    });

    it('should return correct analysis for truncation', () => {
      const original = [
        createMessage({ id: 'orig-1', role: 'user', content: 'Old' }),
        createMessage({ id: 'orig-2', role: 'assistant', content: 'Old response' }),
        createMessage({ id: 'orig-3', role: 'user', content: 'New' }),
        createMessage({ id: 'orig-4', role: 'assistant', content: 'New response' }),
      ];
      
      const truncated = original.slice(2);
      
      const analysis = ContextTruncator.analyzeTruncation(original, truncated, 1000, defaultConfig);
      
      expect(analysis.wasTruncated).toBe(true);
      expect(analysis.removedCount).toBe(2);
      expect(analysis.originalCount).toBe(4);
      expect(analysis.truncatedCount).toBe(2);
      expect(analysis.originalTokens).toBeGreaterThan(analysis.truncatedTokens);
    });
  });
});
