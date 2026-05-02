interface MessageProcessorOptions {
  charName?: string;
  userName?: string;
  charPlaceholder?: string;
  userPlaceholder?: string;
  encodeAngleBrackets?: boolean;
  normalizeQuotes?: boolean;
}

const DEFAULT_OPTIONS: Required<MessageProcessorOptions> = {
  charName: '',
  userName: 'User',
  charPlaceholder: '{{char}}',
  userPlaceholder: '{{user}}',
  encodeAngleBrackets: false,
  normalizeQuotes: true,
};

export function replaceTemplates(
  text: string,
  options: Pick<MessageProcessorOptions, 'charName' | 'userName' | 'charPlaceholder' | 'userPlaceholder'>
): string {
  const {
    charName = '',
    userName = 'User',
    charPlaceholder = '{{char}}',
    userPlaceholder = '{{user}}',
  } = options;

  if (!text) return '';

  const baseChar = charPlaceholder.replace(/[{}]/g, '').toLowerCase();
  const baseUser = userPlaceholder.replace(/[{}]/g, '').toLowerCase();

  const variants = [
    charPlaceholder,
    `{{${baseChar}}}`,
    `{{${baseChar.charAt(0).toUpperCase()}${baseChar.slice(1)}}}`,
    `{{${baseChar.toUpperCase()}}}`,
    userPlaceholder,
    `{{${baseUser}}}`,
    `{{${baseUser.charAt(0).toUpperCase()}${baseUser.slice(1)}}}`,
    `{{${baseUser.toUpperCase()}}}`,
  ];

  const replacements = [
    charName,
    charName,
    charName.charAt(0).toUpperCase() + charName.slice(1).toLowerCase(),
    charName.toUpperCase(),
    userName,
    userName,
    userName.charAt(0).toUpperCase() + userName.slice(1).toLowerCase(),
    userName.toUpperCase(),
  ];

  let result = text;
  for (let i = 0; i < variants.length; i++) {
    result = result.replace(new RegExp(escapeRegex(variants[i]), 'gi'), replacements[i]);
  }
  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function encodeAngleBrackets(text: string): string {
  if (!text) return '';
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function normalizeQuotes(text: string): string {
  if (!text) return '';

  const placeholders: string[] = [];
  let placeholderIndex = 0;

  function addPlaceholder(match: string): string {
    const key = `%%HTMLTAG${placeholderIndex++}%%`;
    placeholders.push(match);
    return key;
  }

  const protectedText = text
    .replace(/```[\s\S]*?```/g, addPlaceholder)
    .replace(/~~~[\s\S]*?~~~/g, addPlaceholder)
    .replace(/``[\s\S]*?``/g, addPlaceholder)
    .replace(/`[^`]+`/g, addPlaceholder)
    .replace(/<[^>]+>/g, addPlaceholder);

  const normalized = protectedText
    .replace(/"([^"]*)"/g, (_, content) => `<q>"${content}"</q>`)
    .replace(/"([^"]*)"/g, (_, content) => `<q>"${content}"</q>`)
    .replace(/"([^"]*)"/g, (_, content) => `<q>"${content}"</q>`)
    .replace(/「([^」]*)」/g, (_, content) => `<q>「${content}」</q>`)
    .replace(/『([^』]*)』/g, (_, content) => `<q>『${content}』</q>`)
    .replace(/〝([^〞]*)〞/g, (_, content) => `<q>〝${content}〞</q>`);

  return normalized.replace(/%%HTMLTAG(\d+)%%/g, (_, index) => placeholders[parseInt(index, 10)] || '');
}

export function protectCodeBlocks(text: string): { text: string; blocks: string[] } {
  const blocks: string[] = [];
  const protectedText = text.replace(
    /```(\w*)\n?([\s\S]*?)```|~~~(\w*)\n?([\s\S]*?)~~~/g,
    (_, lang1, content1, lang2, content2) => {
      const lang = lang1 || lang2 || '';
      const content = content1 || content2 || '';
      blocks.push(`<pre><code class="language-${lang}">${content}</code></pre>`);
      return `%%CODEBLOCK${blocks.length - 1}%%`;
    }
  );

  const inlineProtected = protectedText.replace(
    /`([^`]+)`/g,
    (_, content) => {
      blocks.push(`<code>${content}</code>`);
      return `%%INLINECODE${blocks.length - 1}%%`;
    }
  );

  return { text: inlineProtected, blocks };
}

export function restoreCodeBlocks(text: string, blocks: string[]): string {
  return text
    .replace(/%%CODEBLOCK(\d+)%%/g, (_, index) => blocks[parseInt(index, 10)] || '')
    .replace(/%%INLINECODE(\d+)%%/g, (_, index) => blocks[parseInt(index, 10)] || '');
}

export function processMessage(
  text: string,
  options: MessageProcessorOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let result = text;

  result = replaceTemplates(result, {
    charName: opts.charName,
    userName: opts.userName,
    charPlaceholder: opts.charPlaceholder,
    userPlaceholder: opts.userPlaceholder,
  });

  if (opts.normalizeQuotes) {
    result = normalizeQuotes(result);
  }

  if (opts.encodeAngleBrackets) {
    result = encodeAngleBrackets(result);
  }

  return result;
}

export interface PreprocessResult {
  text: string;
  codeBlocks: string[];
}

export function preprocessForMarkdown(
  text: string,
  options: MessageProcessorOptions = {}
): PreprocessResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let result = text;

  result = replaceTemplates(result, {
    charName: opts.charName,
    userName: opts.userName,
    charPlaceholder: opts.charPlaceholder,
    userPlaceholder: opts.userPlaceholder,
  });

  if (opts.normalizeQuotes) {
    result = normalizeQuotes(result);
  }

  const { text: protectedText, blocks } = protectCodeBlocks(result);

  return { text: protectedText, codeBlocks: blocks };
}
