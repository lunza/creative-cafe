import type { Root, Element } from 'hast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import { u } from 'unist-builder';

const QUOTE_PATTERN = /"([^"]*?)"/g;

export interface RehypeQuoteHighlightOptions {
  highlightClass?: string;
  preserveQuotes?: boolean;
}

export const rehypeQuoteHighlight: Plugin<[RehypeQuoteHighlightOptions?], Root> = (
  options = {}
) => {
  const { highlightClass = 'message-renderer-quote-highlight', preserveQuotes = true } = options;

  return (tree: Root) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!parent || typeof index !== 'number' || !('children' in parent)) return;

      const value: string = node.value || '';
      if (!QUOTE_PATTERN.test(value)) return;

      QUOTE_PATTERN.lastIndex = 0;

      const parts: any[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = QUOTE_PATTERN.exec(value)) !== null) {
        if (match.index > lastIndex) {
          const before = value.slice(lastIndex, match.index);
          if (before) {
            parts.push(u('text', before));
          }
        }

        const quotedContent = match[1];
        if (preserveQuotes) {
          parts.push(
            u('element', {
              tagName: 'span',
              properties: { className: [highlightClass] },
            }, [
              u('text', '"'),
              u('element', {
                tagName: 'mark',
                properties: {},
              }, [u('text', quotedContent)]),
              u('text', '"'),
            ])
          );
        } else {
          parts.push(
            u('element', {
              tagName: 'mark',
              properties: { className: [highlightClass] },
            }, [u('text', quotedContent)])
          );
        }

        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < value.length) {
        const remaining = value.slice(lastIndex);
        if (remaining) {
          parts.push(u('text', remaining));
        }
      }

      if (parts.length > 1) {
        (parent.children as any[]).splice(index, 1, ...parts);
      }
    });
  };
};
