import type { Root, Element } from 'hast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import { fromHtml } from 'hast-util-from-html';

const INLINE_HTML_PATTERN = /<(span|div|a|b|strong|i|em|u|s|strike|del|ins|mark|sub|sup|img|code|pre|q|cite|font)\b[^>]*>[\s\S]*?<\/\1>|<(br|img|hr)\b[^>]*\/?>/gi;

export const rehypeInlineHtmlParse: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'text', (node: any, index: number | null, parent: any) => {
      if (!parent || typeof index !== 'number') return;

      const value: string = node.value || '';
      if (!INLINE_HTML_PATTERN.test(value)) return;

      INLINE_HTML_PATTERN.lastIndex = 0;

      const parts: any[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = INLINE_HTML_PATTERN.exec(value)) !== null) {
        if (match.index > lastIndex) {
          const before = value.slice(lastIndex, match.index);
          if (before) {
            parts.push({ type: 'text', value: before });
          }
        }

        const htmlString = match[0];
        try {
          const parsed = fromHtml(htmlString, { fragment: true });
          if (parsed.children && parsed.children.length > 0) {
            parts.push(...parsed.children);
          } else {
            parts.push({ type: 'text', value: htmlString });
          }
        } catch {
          parts.push({ type: 'text', value: htmlString });
        }

        lastIndex = match.index + htmlString.length;
      }

      if (lastIndex < value.length) {
        const remaining = value.slice(lastIndex);
        if (remaining) {
          parts.push({ type: 'text', value: remaining });
        }
      }

      if (parts.length > 1 || (parts.length === 1 && parts[0].type !== 'text')) {
        parent.children.splice(index, 1, ...parts);
      }
    });
  };
};
