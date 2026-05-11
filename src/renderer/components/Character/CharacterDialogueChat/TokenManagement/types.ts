import { ChatMessage } from '../CharacterDialogueChat.types';

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
