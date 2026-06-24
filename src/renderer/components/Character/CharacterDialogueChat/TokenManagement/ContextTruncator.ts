import { ChatMessage } from '../CharacterDialogueChat.types';
import { TokenCounter } from './TokenCounter';
import { TruncationConfig } from './types';

export class ContextTruncator {
  static truncateMessages(
    messages: ChatMessage[],
    systemPromptTokens: number,
    config: TruncationConfig
  ): ChatMessage[] {
    if (!messages || messages.length === 0) {
      return [];
    }

    const availableBudget = config.maxContextTokens 
      - systemPromptTokens 
      - config.reservedForResponse;

    // 预算过低警告
    if (availableBudget < 2000) {
      console.warn(
        `[ContextTruncator] ⚠️ Token预算过低！可用预算: ${availableBudget} tokens ` +
        `(maxContextTokens: ${config.maxContextTokens}, systemPromptTokens: ${systemPromptTokens}, reservedForResponse: ${config.reservedForResponse})。` +
        `建议：增大maxContextTokens或减小reservedForResponse，推荐maxContextTokens >= 32000, reservedForResponse >= 4096`
      );
    }

    if (availableBudget <= 0) {
      console.warn(
        `[ContextTruncator] ⚠️ Token预算为负或零！可用预算: ${availableBudget} tokens。` +
        `系统提示词(${systemPromptTokens} tokens) + 响应预留(${config.reservedForResponse} tokens) 已超过总预算(${config.maxContextTokens} tokens)。` +
        `将仅保留最近${config.minMessagesToKeep * 2}条消息，AI可能无法生成详细回复。`
      );
      return this.getRecentMessages(messages, config.minMessagesToKeep * 2);
    }

    const result: ChatMessage[] = [];
    let currentTokens = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = TokenCounter.countMessageTokens(messages[i]);
      
      if (currentTokens + msgTokens > availableBudget) {
        if (result.length === 0) {
          result.unshift(messages[i]);
        }
        break;
      }

      result.unshift(messages[i]);
      currentTokens += msgTokens;

      if (result.length >= config.maxMessagesToKeep) {
        break;
      }
    }

    if (result.length < config.minMessagesToKeep * 2) {
      return this.getRecentMessages(messages, config.minMessagesToKeep * 2);
    }

    return this.ensureMessagePairs(result);
  }

  private static getRecentMessages(
    messages: ChatMessage[],
    maxMessages: number
  ): ChatMessage[] {
    const start = Math.max(0, messages.length - maxMessages);
    return messages.slice(start);
  }

  static ensureMessagePairs(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length === 0) return messages;

    let startIndex = 0;
    if (messages[0].role === 'assistant') {
      startIndex = 1;
    }

    const pairs: ChatMessage[] = [];
    for (let i = startIndex; i < messages.length; i += 2) {
      if (i + 1 < messages.length) {
        if (messages[i].role === 'user' && messages[i + 1].role === 'assistant') {
          pairs.push(messages[i], messages[i + 1]);
        } else {
          pairs.push(messages[i]);
        }
      } else {
        pairs.push(messages[i]);
      }
    }

    return pairs;
  }

  static analyzeTruncation(
    originalMessages: ChatMessage[],
    truncatedMessages: ChatMessage[],
    systemPromptTokens: number,
    config: TruncationConfig
  ): {
    originalCount: number;
    truncatedCount: number;
    removedCount: number;
    originalTokens: number;
    truncatedTokens: number;
    wasTruncated: boolean;
  } {
    const originalTokens = TokenCounter.countMessagesTokens(originalMessages);
    const truncatedTokens = TokenCounter.countMessagesTokens(truncatedMessages);

    return {
      originalCount: originalMessages.length,
      truncatedCount: truncatedMessages.length,
      removedCount: originalMessages.length - truncatedMessages.length,
      originalTokens,
      truncatedTokens,
      wasTruncated: truncatedMessages.length < originalMessages.length,
    };
  }
}
