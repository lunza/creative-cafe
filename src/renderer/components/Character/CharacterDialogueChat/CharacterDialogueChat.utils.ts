// 角色测试聊天工具函数

import { ChatMessage, UserPersona } from './CharacterDialogueChat.types';

export { MessageRenderer, DEFAULT_RENDER_CONFIG, mergeConfig } from './MessageRenderer';
export type { RenderConfig, MessageRendererProps } from './MessageRenderer';

export {
  processMessage,
  preprocessForMarkdown,
  protectCodeBlocks,
  restoreCodeBlocks,
  encodeAngleBrackets,
  normalizeQuotes,
  replaceTemplates as replaceTemplatesExtended,
} from './utils/messageProcessor';

export {
  createSanitizeSchema,
  sanitizeConfig,
} from './utils/sanitizeConfig';

export type {
  SanitizeLevel,
  SanitizeConfigOptions,
} from './utils/sanitizeConfig';

export function generateMessageId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function exportConversation(messages: ChatMessage[], characterName: string): string {
  let output = `# Conversation with ${characterName}\n\n`;
  output += `Exported at: ${new Date().toLocaleString()}\n\n`;
  output += `---\n\n`;

  messages.forEach(msg => {
    const role = msg.role === 'user' ? 'You' : characterName;
    output += `### ${role} (${formatTimestamp(msg.timestamp)})\n\n`;
    output += `${msg.content}\n\n`;
    output += `---\n\n`;
  });

  return output;
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      func(...args);
    }
  };
}

export function sanitizeMessageContent(content: string): string {
  if (!content) return '';
  return String(content).replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
}

export {
  replaceTemplates,
  buildCharacterContext,
  buildPersonaSection,
  parseMesExample,
} from './PromptBuilder';

