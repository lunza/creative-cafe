import type { Root, Content } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

export const remarkUnderscoreItalic: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'text', (node: Content, index, parent) => {
      if (!parent || typeof index !== 'number' || !('children' in parent)) return;
      const textNode = node as { type: string; value: string };
      const value = textNode.value;
      const underscoreItalicRegex = /(?<!\w)_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)/g;

      if (!underscoreItalicRegex.test(value)) return;

      underscoreItalicRegex.lastIndex = 0;

      const parts: Array<{ type: string; value?: string }> = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = underscoreItalicRegex.exec(value)) !== null) {
        if (match.index > lastIndex) {
          parts.push({ type: 'text', value: value.slice(lastIndex, match.index) });
        }
        parts.push({ type: 'emphasis', value: match[1] });
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < value.length) {
        parts.push({ type: 'text', value: value.slice(lastIndex) });
      }

      if (parts.length > 1) {
        const newNodes: Content[] = parts.map((part) => {
          if (part.type === 'emphasis' && part.value) {
            return { type: 'emphasis', children: [{ type: 'text', value: part.value }] as Content[] } as Content;
          }
          return { type: 'text', value: part.value || '' } as Content;
        });

        (parent as Root).children.splice(index, 1, ...newNodes);
      }
    });
  };
};
