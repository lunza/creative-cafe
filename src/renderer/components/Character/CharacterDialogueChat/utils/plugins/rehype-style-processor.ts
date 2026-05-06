import type { Root } from 'hast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

export interface RehypeStyleProcessorOptions {
  stylePrefix?: string;
  allowStyleTag?: boolean;
}

export const rehypeStyleProcessor: Plugin<[RehypeStyleProcessorOptions?], Root> = (
  options = {}
) => {
  const { stylePrefix = '.message-renderer ', allowStyleTag = true } = options;

  return (tree: Root) => {
    if (!allowStyleTag) {
      const nodesToRemove: { parent: any; index: number }[] = [];

      visit(tree, 'element', (node, index, parent) => {
        if (node.tagName === 'style' && parent && typeof index === 'number') {
          nodesToRemove.push({ parent, index });
        }
      });

      for (let i = nodesToRemove.length - 1; i >= 0; i--) {
        const { parent, index } = nodesToRemove[i];
        parent.children.splice(index, 1);
      }

      return;
    }

    visit(tree, 'element', (node) => {
      if (node.tagName === 'style' && node.children.length > 0) {
        const textNode = node.children[0];
        if (textNode.type === 'text') {
          let cssContent = textNode.value;

          const scopedCss = cssContent.replace(
            /([^{]+)\{/g,
            (match, selector) => {
              const trimmedSelector = selector.trim();
              if (trimmedSelector.startsWith('@') || trimmedSelector.startsWith(':')) {
                return match;
              }
              return `${stylePrefix}${trimmedSelector} {`;
            }
          );

          textNode.value = scopedCss;
        }
      }

      if (node.properties?.style) {
        const styleValue = node.properties.style as string;
        if (styleValue && typeof styleValue === 'string') {
          const dangerousPatterns = [
            /expression\s*\(/gi,
            /url\s*\(\s*['"]?javascript:/gi,
            /behavior\s*:/gi,
            /-moz-binding\s*:/gi,
          ];

          const isSafe = !dangerousPatterns.some((pattern) => pattern.test(styleValue));

          if (!isSafe) {
            delete node.properties.style;
          }
        }
      }
    });
  };
};
