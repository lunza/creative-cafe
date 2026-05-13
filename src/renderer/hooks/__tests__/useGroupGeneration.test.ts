import { describe, it, expect } from 'vitest';
import {
  applyJoinTemplate,
  buildSystemPrompt,
  buildSwapSystemPrompt,
  buildAppendSystemPrompt,
  formatCharacterDisplay,
} from '../../hooks/useGroupGeneration';
import { GenerationMode } from '../../types/groupChat.types';

describe('useGroupGeneration', () => {
  const mockCard = {
    description: 'A brave warrior',
    personality: 'Bold and courageous',
    scenario: 'In a fantasy world',
    mesExample: 'User: Hello\nChar: Greetings!',
    systemPrompt: '',
    talkativeness: 0.8,
    creatorComment: '',
    postHistoryInstructions: '',
    characterBook: {
      recursive: false,
      extensions: [],
      defaultMetadata: { position: 'before_char_def', disable: false },
    },
  };

  describe('formatCharacterDisplay', () => {
    it('should display character name correctly', () => {
      const result = formatCharacterDisplay('Alice');
      expect(result).toContain('Alice');
    });
  });

  describe('applyJoinTemplate', () => {
    it('should replace {{char}} placeholder', () => {
      const result = applyJoinTemplate('Hello {{char}}!', 'Alice', 'Description');
      expect(result).toBe('Hello Alice!');
    });

    it('should replace {{Char}} placeholder with uppercase first letter', () => {
      const result = applyJoinTemplate('Hello {{Char}}!', 'alice', 'Description');
      expect(result).toBe('Hello Alice!');
    });

    it('should replace <FIELDNAME> placeholder', () => {
      const result = applyJoinTemplate('<FIELDNAME> section', 'Alice', 'Personality');
      expect(result).toBe('Personality section');
    });

    it('should handle multiple placeholders', () => {
      const result = applyJoinTemplate('{{char}} - <FIELDNAME>', 'Bob', 'Description');
      expect(result).toBe('Bob - Description');
    });

    it('should handle empty template', () => {
      const result = applyJoinTemplate('', 'Alice', 'Description');
      expect(result).toBe('');
    });
  });

  describe('buildSwapSystemPrompt', () => {
    it('should build prompt for single character', () => {
      const result = buildSwapSystemPrompt('Alice', mockCard);
      expect(result).toContain('Alice');
      expect(result).toContain('A brave warrior');
      expect(result).toContain('Bold and courageous');
    });

    it('should handle empty card fields', () => {
      const emptyCard = {
        ...mockCard,
        description: '',
        personality: '',
        scenario: '',
      };
      const result = buildSwapSystemPrompt('Alice', emptyCard);
      expect(result).toContain('Alice');
    });
  });

  describe('buildAppendSystemPrompt', () => {
    it('should merge multiple character cards', () => {
      const members = [
        { name: 'Alice', card: mockCard },
        { name: 'Bob', card: { ...mockCard, description: 'A wise wizard' } },
      ];
      const result = buildAppendSystemPrompt(members);
      expect(result).toContain('Alice');
      expect(result).toContain('Bob');
      expect(result).toContain('A brave warrior');
      expect(result).toContain('A wise wizard');
    });

    it('should use default join template when not provided', () => {
      const members = [{ name: 'Alice', card: mockCard }];
      const result = buildAppendSystemPrompt(members);
      expect(result).toContain('=== Description ===');
    });

    it('should use custom join template when provided', () => {
      const members = [{ name: 'Alice', card: mockCard }];
      const result = buildAppendSystemPrompt(members, '[{{char}}]', '[end]');
      expect(result).toContain('[Alice]');
    });

    it('should handle empty members', () => {
      const result = buildAppendSystemPrompt([]);
      expect(result).toBe('');
    });

    it('should filter out disabled members', () => {
      const members = [
        { name: 'Alice', card: mockCard, disabled: true },
        { name: 'Bob', card: mockCard, disabled: false },
      ];
      const result = buildAppendSystemPrompt(members);
      expect(result).not.toContain('Alice');
      expect(result).toContain('Bob');
    });
  });

  describe('buildSystemPrompt', () => {
    it('should route to SWAP mode correctly', () => {
      const result = buildSystemPrompt(GenerationMode.SWAP, 'Alice', mockCard, [], new Set());
      expect(result).toContain('Alice');
    });

    it('should route to APPEND mode correctly', () => {
      const members = [{ name: 'Alice', card: mockCard, disabled: false }];
      const result = buildSystemPrompt(GenerationMode.APPEND, 'Alice', mockCard, members, new Set());
      expect(result).toContain('Alice');
    });

    it('should route to APPEND_DISABLED mode correctly', () => {
      const members = [{ name: 'Alice', card: mockCard, disabled: false }];
      const result = buildSystemPrompt(
        GenerationMode.APPEND_DISABLED,
        'Alice',
        mockCard,
        members,
        new Set()
      );
      expect(result).toContain('Group Chat');
    });
  });
});
