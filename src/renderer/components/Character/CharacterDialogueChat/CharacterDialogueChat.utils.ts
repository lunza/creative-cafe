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

export function replaceTemplates(text: string, charName: string, userName: string = 'User'): string {
  if (!text) return '';
  return text
    .replace(/\{\{char\}\}/g, charName)
    .replace(/\{\{Char\}\}/g, charName)
    .replace(/\{\{CHAR\}\}/g, charName)
    .replace(/\{\{user\}\}/g, userName)
    .replace(/\{\{User\}\}/g, userName)
    .replace(/\{\{USER\}\}/g, userName);
}

export function parseMesExample(mesExample: string): Array<{ user: string; char: string }> {
  if (!mesExample) return [];
  
  // Handle non-string values (array, object, etc.)
  let mesString: string;
  if (typeof mesExample === 'string') {
    mesString = mesExample;
  } else if (Array.isArray(mesExample)) {
    mesString = mesExample.join('\n');
  } else {
    mesString = String(mesExample);
  }
  
  if (!mesString.trim()) return [];
  
  const examples: Array<{ user: string; char: string }> = [];
  const parts = mesString.split(/<START>/i);

  parts.forEach(part => {
    const trimmed = part.trim();
    if (!trimmed) return;

    const lines = trimmed.split('\n').filter(line => line.trim());
    const parsed: Array<{ user: string; char: string }> = [];
    let currentUser = '';
    let currentChar = '';

    lines.forEach(line => {
      if (line.startsWith('You:') || line.startsWith('{{user}}:')) {
        if (currentChar) {
          parsed.push({ user: currentUser, char: currentChar });
          currentUser = '';
          currentChar = '';
        }
        currentUser += line.replace(/^(You|{{user}}):\s*/, '') + '\n';
      } else if (line.includes(':')) {
        currentChar += line.replace(/^[^:]+:\s*/, '') + '\n';
      } else {
        currentChar += line + '\n';
      }
    });

    if (currentChar) {
      parsed.push({ user: currentUser.trim(), char: currentChar.trim() });
    }

    examples.push(...parsed);
  });

  return examples;
}

export function buildCharacterContext(characterInfo: {
  name?: string;
  personality?: string;
  description?: string;
  scenario?: string;
  mes_example?: string;
  system_prompt?: string;
  creator_notes?: string;
}, userName: string = 'User'): string {
  const { name, personality, description, scenario, mes_example, system_prompt, creator_notes } = characterInfo;
  const charName = name || 'Character';
  let context = '';

  context += `角色名称：${charName}\n`;

  if (personality) {
    context += `角色个性：${personality}\n`;
  }

  if (description) {
    context += `角色描述：${description}\n`;
  }

  if (scenario) {
    context += `场景背景：${scenario}\n`;
  }

  if (creator_notes) {
    context += `创作者备注：${creator_notes}\n`;
  }

  if (system_prompt) {
    context += `系统提示：${system_prompt}\n`;
  }

  if (mes_example) {
    const examples = parseMesExample(mes_example);
    if (examples.length > 0) {
      context += `示例对话：\n`;
      examples.forEach((ex, i) => {
        if (i > 0) context += `<START>\n`;
        if (ex.user) context += `${userName}: ${ex.user}\n`;
        if (ex.char) context += `${charName}: ${ex.char}\n`;
      });
    }
  }

  return context.trim();
}

// ==================== 新增：人设相关工具函数 ====================

export function buildPersonaSection(persona?: UserPersona): string {
  if (!persona || !persona.name) return '';
  
  return `
## 用户人设

你正在与用户 **${persona.name}** 进行对话。

${persona.description ? `### 用户信息\n${persona.description}` : ''}

请根据上述用户人设信息调整你的对话风格和回应方式。
`;
}

