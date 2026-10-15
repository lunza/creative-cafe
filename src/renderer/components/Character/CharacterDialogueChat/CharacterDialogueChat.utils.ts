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

// 【Phase 3 / L2 - conversation-mode-optimization-report】时间格式化与导出构建器已迁移到
// shared/utils（timeFormat / exportContent），此处保留重导出兼容原有引用点。
export { formatTimestamp } from '@shared/utils/timeFormat';

import { buildExportContent } from './exportContent';

export function exportConversation(messages: ChatMessage[], characterName: string): string {
  return buildExportContent(messages, characterName, 'markdown');
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

