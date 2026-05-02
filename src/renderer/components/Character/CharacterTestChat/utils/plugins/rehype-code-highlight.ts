import type { Root } from 'hast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

const LANGUAGE_CLASS_PREFIX = 'language-';

export interface RehypeCodeHighlightOptions {
  prefix?: string;
  ignoreMissing?: boolean;
}

export const rehypeCodeHighlight: Plugin<[RehypeCodeHighlightOptions?], Root> = (
  options = {}
) => {
  const { prefix = LANGUAGE_CLASS_PREFIX, ignoreMissing = true } = options;

  return (tree: Root) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'code') return;

      const className = Array.isArray(node.properties?.className)
        ? node.properties.className
        : typeof node.properties?.className === 'string'
        ? [node.properties.className]
        : [];

      const hasLanguageClass = className.some((c: string) =>
        typeof c === 'string' && c.startsWith(prefix)
      );

      if (!hasLanguageClass) {
        return;
      }

      if (!className.includes('message-renderer-code')) {
        node.properties = {
          ...node.properties,
          className: [...className, 'message-renderer-code'],
        };
      }
    });
  };
};
