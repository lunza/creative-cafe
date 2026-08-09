interface MessageProcessorOptions {
  charName?: string;
  userName?: string;
  charPlaceholder?: string;
  userPlaceholder?: string;
  encodeAngleBrackets?: boolean;
  normalizeQuotes?: boolean;
  /** 显示思考过程：true=保留为折叠 details 块，false=移除（默认） */
  showThinking?: boolean;
}

const DEFAULT_OPTIONS: Required<MessageProcessorOptions> = {
  charName: '',
  userName: 'User',
  charPlaceholder: '{{char}}',
  userPlaceholder: '{{user}}',
  encodeAngleBrackets: false,
  normalizeQuotes: true,
  showThinking: false,
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

  // 清理多余的连续空行 (将3个或更多连续换行符替换为2个)
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

/**
 * 将思考标签内容转为折叠 details 块（保留思考过程供用户查看）
 * 支持标签变体: mindmap, <thinking>, <thought> (不区分大小写)
 */
export function convertThinkingTags(text: string): string {
  if (!text) return '';

  let result = text;

  const wrapInDetails = (content: string): string => {
    const trimmed = content.trim();
    if (!trimmed) return '';
    return `<details class="message-renderer-thought-block"><summary>💭 AI 思考过程</summary>${trimmed}</details>`;
  };

  // 1. 完整标签对:  ...  , <thinking>...</thinking>, <thought>...</thought>
  const completePattern = /<(think|thinking|thought)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  result = result.replace(completePattern, (_match, _tag, content: string) => wrapInDetails(content));

  // 2. 未关闭标签(流式场景): 仅匹配位于行首的  ... 到文本末尾
  const unclosedPattern = /(?:^|\n)([ \t]*)<(think|thinking|thought)\b[^>]*>([\s\S]*)$/gi;
  result = result.replace(unclosedPattern, (match, leadingWhitespace: string, _tag, content: string) => {
    const detailsBlock = wrapInDetails(content);
    return match.startsWith('\n') ? '\n' + detailsBlock : detailsBlock;
  });

  // 3. 移除自闭合标签: <think />, <thinking/>, <thought />
  const selfClosingPattern = /<(think|thinking|thought)\b[^>]*\/\s*>/gi;
  result = result.replace(selfClosingPattern, '');

  // 4. 清理多余空行
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

/**
 * ⚠️【重点标记】剥离系统控制标签
 *
 * 修复 Bug：<<<EXPRESSION>>>key<<<END_EXPRESSION>>> 等系统标签如果残留在内容中，
 * 会被 rehypeRaw 当作 HTML 标签解析，rehypeSanitize 删除未知标签后留下碎片
 * （如 <<>>annoyance<<<END_EXPR>>>），同时可能破坏 hast 树导致 *text* 的 <em>
 * 元素也被影响。
 *
 * 此函数在渲染前始终剥离所有系统控制标签，确保它们不进入 HTML 解析管线。
 * 即使 hooks 层的 parseExpressionFromContent 已剥离，此处作为防御性兜底，
 * 也处理旧消息或解析失败的情况。
 */
export function stripSystemTags(text: string): string {
  if (!text) return '';

  let result = text;

  // 1. 剥离表情标签：<<<EXPRESSION>>>key<<<END_EXPRESSION>>> 及所有残缺变体
  //    主格式
  result = result.replace(/<<<EXPRESSION>>>\s*[a-z_][a-z0-9_]*\s*<<<END_EXPRESSION>>>/gi, '');
  //    残缺变体：任意 < > _ 组合 + EXPRESSION 字样 + key + 任意 < > _ 组合 + END EXPRESSION 字样
  result = result.replace(/[<>_]+EXPRESSION[<>_]+\s*[a-z_][a-z0-9_]*\s*[<>_]+(?:END[_]*EXPRESSION|EXPRESSION)[<>_]+/gi, '');
  //    残缺变体：仅有开始标记到末尾
  result = result.replace(/[<>_]+EXPRESSION[<>_]+\s*[a-z_][a-z0-9_]*\s*$/gi, '');
  //    终极兜底：key + EXPRESSION 字样到末尾
  result = result.replace(/\b[a-z_][a-z0-9_]*\s*[<>_]+(?:END[_]*EXPRESSION|EXPRESSION)[<>_]+\s*$/gi, '');
  //    清理残留的孤立尖括号碎片（如 <<>>）
  result = result.replace(/[<>_]{2,}\s*$/, '').trimEnd();

  // 2. 剥离建议选项标签：<<<SUGGESTED_OPTIONS>>>...<<<END_OPTIONS>>>
  result = result.replace(/<<<SUGGESTED_OPTIONS>>>[\s\S]*?<<<END_OPTIONS>>>/gi, '');
  result = result.replace(/<<<SUGGESTED_OPTIONS>>>[\s\S]*$/gi, '');

  // 3. 清理多余空行
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
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

  // 在模板替换之后、引号规范化之前处理思考标签
  result = opts.showThinking ? convertThinkingTags(result) : stripThinkingTags(result);

  // ⚠️ 始终剥离系统控制标签（expression/options），防止 rehypeRaw 解析损坏
  result = stripSystemTags(result);

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
