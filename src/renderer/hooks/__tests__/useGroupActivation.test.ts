import { describe, it, expect } from 'vitest';
import {
  activateNaturalOrder,
  activateListOrder,
  activatePooledOrder,
  selectNextSpeaker,
  ActivationCandidate,
} from '../../hooks/useGroupActivation';
import { ActivationStrategy } from '../../types/groupChat.types';

describe('useGroupActivation', () => {
  const createCandidate = (name: string, talkativeness = 1): ActivationCandidate => ({
    name,
    lastSpeakerOrder: 0,
    talkativeness,
  });

  describe('activateNaturalOrder', () => {
    it('should return mentioned character when input contains name', () => {
      const members = [createCandidate('Alice'), createCandidate('Bob'), createCandidate('Charlie')];
      const result = activateNaturalOrder('Hello @Alice, how are you?', members, null, false);
      expect(result).toBe('Alice');
    });

    it('should return mentioned character when input contains name without @', () => {
      const members = [createCandidate('Alice'), createCandidate('Bob')];
      const result = activateNaturalOrder('What does Bob think?', members, null, false);
      expect(result).toBe('Bob');
    });

    it('should fallback to random when no mention and talkativeness disabled', () => {
      const members = [createCandidate('Alice'), createCandidate('Bob')];
      const result = activateNaturalOrder('Hello everyone', members, null, false);
      expect(members.some((m) => m.name === result)).toBe(true);
    });

    it('should avoid repeating last speaker', () => {
      const members = [createCandidate('Alice'), createCandidate('Bob')];
      const results = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const result = activateNaturalOrder('Hi', members, 'Alice', false);
        if (result) results.add(result);
      }
      expect(results.has('Alice')).toBe(false);
    });

    it('should return null for empty members', () => {
      const result = activateNaturalOrder('Hello', [], null, false);
      expect(result).toBeNull();
    });
  });

  describe('activateListOrder', () => {
    it('should return next member in sequence', () => {
      const members = [createCandidate('Alice'), createCandidate('Bob'), createCandidate('Charlie')];
      const { name, nextIndex } = activateListOrder(members, 0);
      expect(name).toBe('Bob');
      expect(nextIndex).toBe(1);
    });

    it('should wrap around to beginning', () => {
      const members = [createCandidate('Alice'), createCandidate('Bob')];
      const { name, nextIndex } = activateListOrder(members, 1);
      expect(name).toBe('Alice');
      expect(nextIndex).toBe(0);
    });

    it('should handle empty members', () => {
      const { name, nextIndex } = activateListOrder([], 0);
      expect(name).toBeNull();
      expect(nextIndex).toBe(0);
    });

    it('should handle single member', () => {
      const members = [createCandidate('Alice')];
      const { name, nextIndex } = activateListOrder(members, 0);
      expect(name).toBe('Alice');
      expect(nextIndex).toBe(0);
    });
  });

  describe('activatePooledOrder', () => {
    it('should select from unspoken members first', () => {
      const members = [createCandidate('Alice'), createCandidate('Bob'), createCandidate('Charlie')];
      const spoken = new Set(['Alice']);
      const result = activatePooledOrder(members, null, spoken);
      expect(result).not.toBe('Alice');
      expect(['Bob', 'Charlie']).toContain(result);
    });

    it('should fallback to available members when all spoken', () => {
      const members = [createCandidate('Alice'), createCandidate('Bob')];
      const spoken = new Set(['Alice', 'Bob']);
      const result = activatePooledOrder(members, 'Alice', spoken);
      expect(result).toBe('Bob');
    });

    it('should avoid last speaker', () => {
      const members = [createCandidate('Alice'), createCandidate('Bob')];
      const spoken = new Set<string>();
      const results = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const result = activatePooledOrder(members, 'Alice', spoken);
        if (result) results.add(result);
      }
      expect(results.has('Alice')).toBe(false);
    });

    it('should return null for empty members', () => {
      const result = activatePooledOrder([], null, new Set());
      expect(result).toBeNull();
    });
  });

  describe('selectNextSpeaker', () => {
    it('should route to NATURAL strategy', () => {
      const members = [createCandidate('Alice'), createCandidate('Bob')];
      const { name, nextListIndex } = selectNextSpeaker(
        ActivationStrategy.NATURAL,
        'Hello @Alice',
        members,
        null,
        0,
        new Set(),
        false
      );
      expect(name).toBe('Alice');
      expect(nextListIndex).toBe(0);
    });

    it('should route to LIST strategy', () => {
      const members = [createCandidate('Alice'), createCandidate('Bob')];
      const { name, nextListIndex } = selectNextSpeaker(
        ActivationStrategy.LIST,
        'Hello',
        members,
        null,
        0,
        new Set(),
        false
      );
      expect(name).toBe('Bob');
      expect(nextListIndex).toBe(1);
    });

    it('should route to POOLED strategy', () => {
      const members = [createCandidate('Alice'), createCandidate('Bob'), createCandidate('Charlie')];
      const { name, nextListIndex } = selectNextSpeaker(
        ActivationStrategy.POOLED,
        'Hello',
        members,
        null,
        0,
        new Set(['Alice']),
        false
      );
      expect(['Bob', 'Charlie']).toContain(name);
      expect(nextListIndex).toBe(0);
    });

    it('should default to NATURAL for unknown strategy', () => {
      const members = [createCandidate('Alice'), createCandidate('Bob')];
      const { name } = selectNextSpeaker(
        999 as ActivationStrategy,
        'Hello @Bob',
        members,
        null,
        0,
        new Set(),
        false
      );
      expect(name).toBe('Bob');
    });
  });
});
