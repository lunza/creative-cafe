import type { Root, Parent, Content, Text, Link } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

const OPEN_TAG_REGEX = /<(span|div|a|b|strong|i|em|u|s|strike|del|ins|mark|sub|sup|img|code|pre|q|cite|br)\b([^>]*)>/gi;

export const remarkTableCellRawHtml: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'text', (node: Content, index, parent) => {
      if (!parent || typeof index !== 'number' || !('children' in parent)) return;

      const textNode = node as Text;
      const value = textNode.value;

      const hasHtml = /<(?:span|div|a|b|strong|i|em|u|s|strike|del|ins|mark|sub|sup|br|img|code|pre|q|cite)\b/i.test(value);
      if (!hasHtml) return;

      const newNodes: Content[] = [];
      let lastIndex = 0;

      OPEN_TAG_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = OPEN_TAG_REGEX.exec(value)) !== null) {
        if (match.index > lastIndex) {
          const before = value.slice(lastIndex, match.index);
          if (before.trim()) {
            newNodes.push({ type: 'text', value: before } as Text);
          }
        }

        const tagName = match[1];
        const attrs = match[2] || '';
        const fullMatch = match[0];

        const closingTag = `</${tagName}>`;
        const closingIndex = value.indexOf(closingTag, match.index + fullMatch.length);

        let innerContent = '';
        let fullHtml = fullMatch;

        if (tagName !== 'br' && tagName !== 'img' && closingIndex !== -1) {
          innerContent = value.slice(match.index + fullMatch.length, closingIndex);
          fullHtml = value.slice(match.index, closingIndex + closingTag.length);
          lastIndex = closingIndex + closingTag.length;
        } else {
          lastIndex = match.index + fullMatch.length;
        }

        const children: Content[] = [];
        if (innerContent) {
          children.push({ type: 'text', value: innerContent } as Text);
        }

        if (tagName === 'br') {
          newNodes.push({ type: 'break' } as any);
        } else if (tagName === 'img') {
          const srcMatch = /src\s*=\s*"([^"]*)"/i.exec(attrs);
          const altMatch = /alt\s*=\s*"([^"]*)"/i.exec(attrs);
          newNodes.push({
            type: 'image',
            url: srcMatch ? srcMatch[1] : '',
            alt: altMatch ? altMatch[1] : '',
            title: '',
          } as any);
        } else if (tagName === 'a') {
          const hrefMatch = /href\s*=\s*"([^"]*)"/i.exec(attrs);
          newNodes.push({
            type: 'link',
            url: hrefMatch ? hrefMatch[1] : '',
            title: '',
            children,
          } as Link);
        } else if (tagName === 'b' || tagName === 'strong') {
          newNodes.push({ type: 'strong', children } as any);
        } else if (tagName === 'i' || tagName === 'em') {
          newNodes.push({ type: 'emphasis', children } as any);
        } else if (tagName === 's' || tagName === 'strike' || tagName === 'del') {
          newNodes.push({ type: 'delete', children } as any);
        } else {
          const htmlNode: any = {
            type: 'html',
            value: fullHtml,
          };
          newNodes.push(htmlNode);
        }
      }

      if (lastIndex < value.length) {
        const remaining = value.slice(lastIndex);
        if (remaining.trim()) {
          newNodes.push({ type: 'text', value: remaining } as Text);
        }
      }

      if (newNodes.length > 1 || (newNodes.length === 1 && newNodes[0].type !== 'text')) {
        (parent as Parent).children.splice(index, 1, ...newNodes);
      }
    });
  };
};
