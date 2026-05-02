import type { Root, Element } from 'hast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import { u } from 'unist-builder';

const CODE_TAGS = ['code', 'pre'];

// Regex matching quote pairs using character classes for all common quote types:
// ASCII: "  Curly: " "  CJK fullwidth: ＂  Japanese: 「」 『』  etc.
// We use a single pattern that matches opening quotes + content + closing quotes
const OPEN_QUOTES = '""«‹"';
const CLOSE_QUOTES = '"»›"';

function isInCodeContext(node: any): boolean {
  let current = node;
  while (current) {
    if (current.type === 'element' && CODE_TAGS.includes((current as Element).tagName || '')) {
      return true;
    }
    current = current.parent || current.__parent__;
  }
  return false;
}

// Process a single text node, replacing all matched quotes with highlighted spans
function processTextNode(value: string): any[] {
  const children: any[] = [];
  let lastIndex = 0;

  // Build a regex that matches any opening quote char, content, then its matching closing quote
  // We do this by trying each quote pair individually
  const patterns: Array<{ open: string; close: string; regex: RegExp }> = [
    { open: '"', close: '"', regex: /"([^"]*?)"/g },
    { open: '\u201C', close: '\u201D', regex: /\u201C([^\u201D]*?)\u201D/g },
    { open: '\uFF02', close: '\uFF02', regex: /\uFF02([^\uFF02]*?)\uFF02/g },
    { open: '\u300C', close: '\u300D', regex: /\u300C([^\u300D]*?)\u300D/g },
    { open: '\u300E', close: '\u300F', regex: /\u300E([^\u300F]*?)\u300F/g },
    { open: '\u201E', close: '\u201C', regex: /\u201E([^\u201C]*?)\u201C/g },
    { open: '\u201F', close: '\u201D', regex: /\u201F([^\u201D]*?)\u201D/g },
  ];

  // Collect all matches from all patterns, then sort by position
  interface MatchInfo {
    start: number;
    end: number;
    content: string;
    open: string;
    close: string;
  }

  const allMatches: MatchInfo[] = [];

  for (const { open, close, regex } of patterns) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(value)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[1],
        open,
        close,
      });
    }
  }

  // Sort by start position and remove overlapping matches
  allMatches.sort((a, b) => a.start - b.start);
  const filtered: MatchInfo[] = [];
  let lastEnd = -1;
  for (const m of allMatches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  // Build result array
  for (const match of filtered) {
    if (match.start > lastIndex) {
      const before = value.slice(lastIndex, match.start);
      if (before) children.push(u('text', before));
    }

    children.push(
      u('element', {
        tagName: 'span',
        properties: { className: ['message-renderer-quote-highlight'] },
        children: [
          u('text', match.open),
          u('element', {
            tagName: 'mark',
            properties: {},
            children: [u('text', match.content)],
          }),
          u('text', match.close),
        ],
      })
    );

    lastIndex = match.end;
  }

  if (lastIndex < value.length) {
    const remaining = value.slice(lastIndex);
    if (remaining) children.push(u('text', remaining));
  }

  return children;
}

export const rehypeQuoteNormalize: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'text', (node: any, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      if (isInCodeContext(node)) return;

      const value = node.value || '';
      if (value.length === 0) return;

      const result = processTextNode(value);
      if (result.length > 1 || (result.length === 1 && result[0].type !== 'text')) {
        parent.children.splice(index, 1, ...result);
      }
    });
  };
};
