import { ChatMessage } from '../CharacterDialogueChat.types';
import { TokenCountResult, MessageTokenInfo } from './types';

const BYTES_PER_TOKEN = 3.35;
const FORMAT_OVERHEAD_PER_MESSAGE = 4;
const TOKENS_PADDING = 3;

const tokenCache = new Map<string, number>();

export class TokenCounter {
  static estimateTokens(text: string): number {
    if (!text || text.length === 0) return 0;
    const byteLength = new TextEncoder().encode(text).length;
    return Math.ceil(byteLength / BYTES_PER_TOKEN);
  }

  static countMessageTokens(message: ChatMessage): number {
    const cacheKey = message.id;
    if (tokenCache.has(cacheKey)) {
      return tokenCache.get(cacheKey)!;
    }

    const contentTokens = this.estimateTokens(message.content || '');
    const totalTokens = contentTokens + FORMAT_OVERHEAD_PER_MESSAGE;
    
    tokenCache.set(cacheKey, totalTokens);
    return totalTokens;
  }

  static countMessagesTokens(messages: ChatMessage[]): number {
    let totalTokens = 0;
    for (const msg of messages) {
      totalTokens += this.countMessageTokens(msg);
    }
    return totalTokens + TOKENS_PADDING;
  }

  static countSystemPromptTokens(systemPrompt: string): number {
    return this.estimateTokens(systemPrompt);
  }

  static getMessageTokenDetails(messages: ChatMessage[]): MessageTokenInfo[] {
    return messages.map(msg => ({
      messageId: msg.id,
      role: msg.role,
      content: msg.content || '',
      tokenCount: this.countMessageTokens(msg),
    }));
  }

  static countTotalUsage(
    systemPrompt: string,
    messages: ChatMessage[],
    reservedForResponse: number = 1024
  ): TokenCountResult {
    const systemPromptTokens = this.countSystemPromptTokens(systemPrompt);
    const messagesTokens = this.countMessagesTokens(messages);
    return {
      totalTokens: systemPromptTokens + messagesTokens + reservedForResponse,
      systemPromptTokens,
      messagesTokens,
      reservedForResponse,
    };
  }

  static clearCache(): void {
    tokenCache.clear();
  }

  static evictCache(messageId: string): void {
    tokenCache.delete(messageId);
  }
}
