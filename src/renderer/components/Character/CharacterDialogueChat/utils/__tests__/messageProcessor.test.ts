import { describe, it, expect } from 'vitest';
import { processMessage, replaceTemplates, normalizeQuotes, protectCodeBlocks, restoreCodeBlocks, encodeAngleBrackets, preprocessForMarkdown, stripThinkingTags } from '../messageProcessor';

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

  describe('stripThinkingTags', () => {
    it('should remove standard <think>...</think> tags', () => {
      const result = stripThinkingTags('Hello <think>this is hidden</think> world');
      expect(result).toBe('Hello  world');
    });

    it('should remove <thinking>...</thinking> variant', () => {
      const result = stripThinkingTags('Before <thinking>hidden content</thinking> after');
      expect(result).toBe('Before  after');
    });

    it('should remove <thought>...</thought> variant', () => {
      const result = stripThinkingTags('Start <thought>thinking here</thought> end');
      expect(result).toBe('Start  end');
    });

    it('should handle case-insensitive matching: <Think>', () => {
      const result = stripThinkingTags('Text <Think>hidden</Think> more');
      expect(result).toBe('Text  more');
    });

    it('should handle case-insensitive matching: <THINK>', () => {
      const result = stripThinkingTags('Text <THINK>hidden</THINK> more');
      expect(result).toBe('Text  more');
    });

    it('should handle case-insensitive matching: <ThInKiNg>', () => {
      const result = stripThinkingTags('Text <ThInKiNg>hidden</ThInKiNg> more');
      expect(result).toBe('Text  more');
    });

    it('should remove multiple thinking tags in same text', () => {
      const result = stripThinkingTags('A<think>one</think>B<thinking>two</thinking>C<think>three</think>D');
      expect(result).toBe('ABCD');
    });

    it('should handle unclosed tag (streaming scenario)', () => {
      const result = stripThinkingTags('Visible text<think>still streaming content');
      expect(result).toBe('Visible text');
    });

    it('should handle unclosed <thinking> tag', () => {
      const result = stripThinkingTags('Hello <thinking>unclosed stream');
      expect(result).toBe('Hello ');
    });

    it('should handle self-closing <think /> tag', () => {
      const result = stripThinkingTags('Before <think /> after');
      expect(result).toBe('Before  after');
    });

    it('should handle self-closing <thinking/> tag', () => {
      const result = stripThinkingTags('Before <thinking/> after');
      expect(result).toBe('Before  after');
    });

    it('should handle self-closing <thought /> tag', () => {
      const result = stripThinkingTags('Before <thought /> after');
      expect(result).toBe('Before  after');
    });

    it('should handle nested HTML/Markdown inside thinking tags', () => {
      const result = stripThinkingTags('Text<think>**bold** and *italic* and [link](url)</think> more');
      expect(result).toBe('Text more');
    });

    it('should handle empty thinking tags', () => {
      const result = stripThinkingTags('Before<think></think> after');
      expect(result).toBe('Before after');
    });

    it('should handle thinking tags with only whitespace', () => {
      const result = stripThinkingTags('Before<think>   \n\t </think> after');
      expect(result).toBe('Before after');
    });

    it('should leave text without thinking tags unchanged', () => {
      const input = 'Just normal text with **bold** and *italic*';
      const result = stripThinkingTags(input);
      expect(result).toBe(input);
    });

    it('should handle mixed content: thinking tags before, after, and around normal content', () => {
      const result = stripThinkingTags('<think>first</think>Hello<think>second</think>World<think>third</think>');
      expect(result).toBe('HelloWorld');
    });

    it('should handle empty input string', () => {
      expect(stripThinkingTags('')).toBe('');
    });

    it('should clean up excessive newlines after removal', () => {
      const result = stripThinkingTags('Line1\n\n<think>hidden</think>\n\n\nLine2');
      expect(result).toBe('Line1\n\nLine2');
    });

    it('should handle self-closing tag with attributes', () => {
      const result = stripThinkingTags('Text <think class="test" /> more');
      expect(result).toBe('Text  more');
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

    it('should strip thinking tags automatically', () => {
      const result = processMessage('Hello<think>hidden content</think> world', {
        charName: 'Alice',
        userName: 'User',
      });
      expect(result).not.toContain('<think>');
      expect(result).not.toContain('hidden content');
      expect(result).toContain('Hello');
      expect(result).toContain('world');
    });

    it('should strip thinking tags before quote normalization', () => {
      const result = processMessage('<think>hidden "quoted" text</think>Visible "text"', {
        charName: 'Alice',
        userName: 'User',
      });
      expect(result).not.toContain('hidden');
      expect(result).toContain('<q>');
      expect(result).toContain('Visible');
    });

    it('should apply template replacement with thinking tags present', () => {
      const result = processMessage('{{char}}<think>thinking about {{user}}</think> said "hi"', {
        charName: 'Alice',
        userName: 'Bob',
      });
      expect(result).not.toContain('<think>');
      expect(result).not.toContain('{{char}}');
      expect(result).toContain('Alice');
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
