import { describe, it, expect, vi, beforeEach } from 'vitest';

// ==================== isSavingRef Guard Tests ====================

describe('saveTestChat concurrent save protection', () => {
  describe('isSavingRef guard mechanism', () => {
    it('should allow save when isSavingRef is false', () => {
      const isSavingRef = { current: false };
      let saveCallCount = 0;

      const saveTestChat = async () => {
        if (isSavingRef.current) {
          return { skipped: true };
        }
        try {
          isSavingRef.current = true;
          saveCallCount++;
          return { success: true };
        } finally {
          isSavingRef.current = false;
        }
      };

      const result = saveTestChat();
      expect(result).resolves.toEqual({ success: true });
      expect(saveCallCount).toBe(1);
    });

    it('should block concurrent saves when isSavingRef is true', async () => {
      const isSavingRef = { current: false };
      let saveCallCount = 0;

      const saveTestChat = async () => {
        if (isSavingRef.current) {
          return { skipped: true };
        }
        try {
          isSavingRef.current = true;
          saveCallCount++;
          await new Promise(resolve => setTimeout(resolve, 100));
          return { success: true };
        } finally {
          isSavingRef.current = false;
        }
      };

      const firstSave = saveTestChat();
      const secondSave = saveTestChat();

      const results = await Promise.all([firstSave, secondSave]);

      const successfulSaves = results.filter(r => r && !r.skipped);
      const skippedSaves = results.filter(r => r && r.skipped);

      expect(saveCallCount).toBe(1);
      expect(successfulSaves.length).toBe(1);
      expect(skippedSaves.length).toBe(1);
    });

    it('should reset isSavingRef to false after save completes', async () => {
      const isSavingRef = { current: false };

      const saveTestChat = async () => {
        if (isSavingRef.current) {
          return { skipped: true };
        }
        try {
          isSavingRef.current = true;
          await new Promise(resolve => setTimeout(resolve, 50));
          return { success: true };
        } finally {
          isSavingRef.current = false;
        }
      };

      await saveTestChat();
      expect(isSavingRef.current).toBe(false);

      const secondResult = await saveTestChat();
      expect(secondResult).toEqual({ success: true });
    });

    it('should reset isSavingRef to false even if save throws an error', async () => {
      const isSavingRef = { current: false };

      const saveTestChat = async () => {
        if (isSavingRef.current) {
          return { skipped: true };
        }
        try {
          isSavingRef.current = true;
          throw new Error('Save failed');
        } finally {
          isSavingRef.current = false;
        }
      };

      await expect(saveTestChat()).rejects.toThrow('Save failed');
      expect(isSavingRef.current).toBe(false);
    });

    it('should allow sequential saves after previous save completes', async () => {
      const isSavingRef = { current: false };
      let saveCallCount = 0;

      const saveTestChat = async () => {
        if (isSavingRef.current) {
          return { skipped: true };
        }
        try {
          isSavingRef.current = true;
          saveCallCount++;
          await new Promise(resolve => setTimeout(resolve, 50));
          return { success: true, callNumber: saveCallCount };
        } finally {
          isSavingRef.current = false;
        }
      };

      const result1 = await saveTestChat();
      const result2 = await saveTestChat();
      const result3 = await saveTestChat();

      expect(saveCallCount).toBe(3);
      expect(result1).toEqual({ success: true, callNumber: 1 });
      expect(result2).toEqual({ success: true, callNumber: 2 });
      expect(result3).toEqual({ success: true, callNumber: 3 });
    });
  });
});

// ==================== IPC Message Serialization Tests ====================

describe('IPC message serialization safety', () => {
  describe('clean messages without circular references', () => {
    function cleanMessage(msg: any) {
      const cleanMsg = {
        id: String(msg.id || ''),
        role: String(msg.role || ''),
        content: String(msg.content || ''),
        timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
        status: String(msg.status || 'sent'),
        speakerName: msg.speakerName ? String(msg.speakerName) : undefined,
        speakerAvatar: msg.speakerAvatar ? String(msg.speakerAvatar) : undefined,
      };

      try {
        JSON.stringify(cleanMsg);
      } catch (error) {
        return {
          id: cleanMsg.id,
          role: cleanMsg.role,
          content: cleanMsg.content,
          timestamp: cleanMsg.timestamp,
          status: cleanMsg.status,
        };
      }

      return cleanMsg;
    }

    it('should clean a normal message without circular references', () => {
      const msg = {
        id: '123',
        role: 'user',
        content: 'Hello world',
        timestamp: 1000000,
        status: 'sent',
        speakerName: 'Alice',
        speakerAvatar: '/path/to/avatar.png',
      };

      const cleaned = cleanMessage(msg);

      expect(cleaned.id).toBe('123');
      expect(cleaned.role).toBe('user');
      expect(cleaned.content).toBe('Hello world');
      expect(cleaned.timestamp).toBe(1000000);
      expect(cleaned.status).toBe('sent');
      expect(cleaned.speakerName).toBe('Alice');
      expect(cleaned.speakerAvatar).toBe('/path/to/avatar.png');

      expect(() => JSON.stringify(cleaned)).not.toThrow();
    });

    it('should handle messages with missing optional fields', () => {
      const msg = {
        id: '456',
        role: 'assistant',
        content: 'Response',
        timestamp: 2000000,
      };

      const cleaned = cleanMessage(msg);

      expect(cleaned.id).toBe('456');
      expect(cleaned.role).toBe('assistant');
      expect(cleaned.content).toBe('Response');
      expect(cleaned.timestamp).toBe(2000000);
      expect(cleaned.status).toBe('sent');
      expect(cleaned.speakerName).toBeUndefined();
      expect(cleaned.speakerAvatar).toBeUndefined();
    });

    it('should detect and handle circular references', () => {
      const circularObj: any = { id: '789', role: 'user', content: 'test' };
      circularObj.self = circularObj;

      const cleaned = cleanMessage(circularObj);

      expect(cleaned.id).toBe('789');
      expect(cleaned.role).toBe('user');
      expect(cleaned.content).toBe('test');

      expect(() => JSON.stringify(cleaned)).not.toThrow();
      expect(cleaned).not.toHaveProperty('self');
    });

    it('should handle deeply nested circular references', () => {
      const a: any = { id: 'a' };
      const b: any = { id: 'b', parent: a };
      a.child = b;

      const msg = {
        id: 'test',
        role: 'assistant',
        content: 'deep circular',
        timestamp: 3000000,
        metadata: a,
      };

      const cleaned = cleanMessage(msg);

      expect(cleaned.id).toBe('test');
      expect(cleaned.role).toBe('assistant');
      expect(cleaned.content).toBe('deep circular');
      expect(cleaned.timestamp).toBe(3000000);
      expect(cleaned).not.toHaveProperty('metadata');

      expect(() => JSON.stringify(cleaned)).not.toThrow();
    });

    it('should convert non-string fields to strings', () => {
      const msg = {
        id: 123,
        role: null,
        content: undefined,
        timestamp: 'not-a-number',
        status: true,
      };

      const cleaned = cleanMessage(msg);

      expect(cleaned.id).toBe('123');
      expect(cleaned.role).toBe('');
      expect(cleaned.content).toBe('');
      expect(typeof cleaned.timestamp).toBe('number');
      expect(cleaned.status).toBe('true');
    });

    it('should handle messages with React-like object properties', () => {
      const mockReactElement: any = {
        id: 'react-1',
        role: 'user',
        content: 'Hello',
        timestamp: 4000000,
        $$typeof: Symbol('react.element'),
        _owner: { current: null },
        _store: {},
      };
      mockReactElement._owner.current = mockReactElement;

      const cleaned = cleanMessage(mockReactElement);

      expect(cleaned.id).toBe('react-1');
      expect(cleaned.role).toBe('user');
      expect(cleaned.content).toBe('Hello');
      expect(cleaned.timestamp).toBe(4000000);

      expect(() => JSON.stringify(cleaned)).not.toThrow();
      expect(cleaned).not.toHaveProperty('$$typeof');
      expect(cleaned).not.toHaveProperty('_owner');
    });

    it('should handle array of messages for batch serialization', () => {
      const circular: any = { id: 'c', role: 'assistant', content: 'circular' };
      circular.ref = circular;

      const messages = [
        { id: '1', role: 'user', content: 'Hello', timestamp: 1000 },
        { id: '2', role: 'assistant', content: 'Hi there', timestamp: 2000 },
        circular,
      ];

      const cleanedMessages = messages.map(msg => cleanMessage(msg));

      cleanedMessages.forEach(cleaned => {
        expect(() => JSON.stringify(cleaned)).not.toThrow();
      });

      expect(cleanedMessages.length).toBe(3);
      expect(cleanedMessages[2].id).toBe('c');
      expect(cleanedMessages[2]).not.toHaveProperty('ref');
    });

    it('should preserve undefined optional fields in cleaned message', () => {
      const msg = {
        id: 'test',
        role: 'user',
        content: 'test content',
        timestamp: 5000000,
      };

      const cleaned = cleanMessage(msg);

      expect(cleaned.speakerName).toBeUndefined();
      expect(cleaned.speakerAvatar).toBeUndefined();

      const serialized = JSON.stringify(cleaned);
      expect(serialized).not.toContain('speakerName');
      expect(serialized).not.toContain('speakerAvatar');
    });

    it('should handle empty string content', () => {
      const msg = {
        id: 'empty',
        role: 'assistant',
        content: '',
        timestamp: 6000000,
      };

      const cleaned = cleanMessage(msg);

      expect(cleaned.content).toBe('');
      expect(() => JSON.stringify(cleaned)).not.toThrow();
    });

    it('should handle null and undefined message fields gracefully', () => {
      const msg = {
        id: null,
        role: undefined,
        content: null,
        timestamp: null,
        status: undefined,
      };

      const cleaned = cleanMessage(msg);

      expect(cleaned.id).toBe('');
      expect(cleaned.role).toBe('');
      expect(cleaned.content).toBe('');
      expect(typeof cleaned.timestamp).toBe('number');
      expect(cleaned.status).toBe('sent');
      expect(() => JSON.stringify(cleaned)).not.toThrow();
    });
  });
});
