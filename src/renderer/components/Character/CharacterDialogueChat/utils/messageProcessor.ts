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

/**
 * 移除文本中的思考标签及其内容
 * 支持标签变体: <think>, <thinking>, <thought> (不区分大小写)
 * 处理场景: 完整标签、未关闭标签(流式场景)、自闭合标签、多个标签块
 *
 * 🐛 Bug修复（重点）：未闭合标签的正则原为 `/<(think...)\b[^>]*>[\s\S]*$/gi`，
 * 会从首次出现的 `<think` 字面量删到文本末尾。若 AI 在故事中提及"思考标签"、
 * 模仿 XML、或输出 `<thought>` 字面量，后半部分内容全部丢失。
 * 修复：要求未闭合的 `<think` 标签必须位于行首（^ 或 \n 之后），因为真实的
 * 推理标签通常出现在回复开头或新行起始处，而非句子中间。
 */
export function stripThinkingTags(text: string): string {
  if (!text) return '';

  let result = text;

  // 1. 移除自闭合标签: <think />, <thinking/>, <thought />
  const selfClosingPattern = /<(think|thinking|thought)\b[^>]*\/\s*>/gi;
  result = result.replace(selfClosingPattern, '');

  // 2. 移除完整标签对: <think>...</think>, <thinking>...</thinking>, <thought>...</thought>
  const completePattern = /<(think|thinking|thought)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  result = result.replace(completePattern, '');

  // 3. 移除未关闭标签(流式场景): 仅匹配位于行首的 <think>...到文本末尾
  //    要求标签前为文本起始(^)或换行(\n)，避免匹配句子中间的字面量 <think>
  const unclosedPattern = /(?:^|\n)[ \t]*<(think|thinking|thought)\b[^>]*>[\s\S]*$/gi;
  result = result.replace(unclosedPattern, (match, _tag) => {
    // 保留匹配到的起始换行符（如果是 \n 开头），避免合并前后行
    return match.startsWith('\n') ? '\n' : '';
  });

  // 4. 清理多余的连续空行 (将3个或更多连续换行符替换为2个)
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
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

  // 在模板替换之后、引号规范化之前移除思考标签
  result = stripThinkingTags(result);

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

  // 在模板替换之后、引号规范化之前移除思考标签
  result = stripThinkingTags(result);

  if (opts.normalizeQuotes) {
    result = normalizeQuotes(result);
  }

  const { text: protectedText, blocks } = protectCodeBlocks(result);

  return { text: protectedText, codeBlocks: blocks };
}
