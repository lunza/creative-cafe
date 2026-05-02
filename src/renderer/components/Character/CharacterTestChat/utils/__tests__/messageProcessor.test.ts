import { describe, it, expect } from 'vitest';
import { processMessage, replaceTemplates, normalizeQuotes, protectCodeBlocks, restoreCodeBlocks, encodeAngleBrackets, preprocessForMarkdown } from '../messageProcessor';

describe('messageProcessor', () => {
  describe('replaceTemplates', () => {
    it('should replace {{char}} with character name', () => {
      const result = replaceTemplates('Hello from {{char}}!', {
        charName: 'Alice',
        userName: 'User',
      });
      expect(result).toBe('Hello from Alice!');
    });

    it('should replace {{user}} with user name', () => {
      const result = replaceTemplates('Hello {{user}}!', {
        charName: 'Alice',
        userName: 'Bob',
      });
      expect(result).toBe('Hello Bob!');
    });

    it('should handle multiple placeholders', () => {
      const result = replaceTemplates('{{char}} says hi to {{user}}', {
        charName: 'Alice',
        userName: 'Bob',
      });
      expect(result).toBe('Alice says hi to Bob');
    });

    it('should handle {{Char}} variant', () => {
      const result = replaceTemplates('Hello {{Char}}!', {
        charName: 'Alice',
        userName: 'User',
      });
      expect(result).toBe('Hello Alice!');
    });

    it('should return empty string for empty input', () => {
      expect(replaceTemplates('', { charName: 'A', userName: 'U' })).toBe('');
    });
  });

  describe('normalizeQuotes', () => {
    it('should wrap English double quotes in <q> tags', () => {
      const result = normalizeQuotes('She said "hello"');
      expect(result).toContain('<q>');
    });

    it('should wrap corner brackets in <q> tags', () => {
      const result = normalizeQuotes('「hello」');
      expect(result).toContain('<q>');
    });

    it('should preserve code blocks', () => {
      const result = normalizeQuotes('Code: `"test"` and "outside"');
      expect(result).toContain('`"test"`');
    });
  });

  describe('protectCodeBlocks', () => {
    it('should extract fenced code blocks', () => {
      const { text, blocks } = protectCodeBlocks('Hello\n```js\nconsole.log("hi");\n```\nWorld');
      expect(text).not.toContain('```');
      expect(blocks.length).toBe(1);
      expect(blocks[0]).toContain('console.log');
    });

    it('should extract inline code', () => {
      const { text, blocks } = protectCodeBlocks('Use `console.log()` here');
      expect(text).not.toContain('`console.log()`');
      expect(blocks.length).toBe(1);
    });
  });

  describe('restoreCodeBlocks', () => {
    it('should restore code blocks from placeholders', () => {
      const { text, blocks } = protectCodeBlocks('```js\nhi\n```');
      const restored = restoreCodeBlocks(text, blocks);
      expect(restored).toContain('<pre>');
      expect(restored).toContain('<code');
    });
  });

  describe('encodeAngleBrackets', () => {
    it('should encode < and >', () => {
      const result = encodeAngleBrackets('<script>alert(1)</script>');
      expect(result).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  describe('processMessage', () => {
    it('should apply template replacement and quote normalization', () => {
      const result = processMessage('{{char}} said "hello"', {
        charName: 'Alice',
        userName: 'User',
      });
      expect(result).toContain('Alice');
      expect(result).toContain('<q>');
    });

    it('should handle empty input', () => {
      expect(processMessage('')).toBe('');
    });
  });

  describe('preprocessForMarkdown', () => {
    it('should return protected text and code blocks', () => {
      const result = preprocessForMarkdown('Code: `test` and {{char}} said "hi"', {
        charName: 'Alice',
      });
      expect(result.text).toContain('%%INLINECODE');
      expect(result.codeBlocks.length).toBe(1);
    });
  });
});
