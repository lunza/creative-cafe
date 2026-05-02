import { describe, it, expect } from 'vitest';
import { createSanitizeSchema, sanitizeConfig } from '../sanitizeConfig';

describe('sanitizeConfig', () => {
  describe('predefined schemas', () => {
    it('should have strict schema', () => {
      expect(sanitizeConfig.strict).toBeDefined();
      expect(sanitizeConfig.strict.tagNames).toBeDefined();
    });

    it('should have moderate schema', () => {
      expect(sanitizeConfig.moderate).toBeDefined();
      expect(sanitizeConfig.moderate.tagNames).toContain('details');
    });

    it('should have loose schema', () => {
      expect(sanitizeConfig.loose).toBeDefined();
      expect(sanitizeConfig.loose.tagNames).toContain('video');
    });
  });

  describe('createSanitizeSchema', () => {
    it('should create schema with default moderate level', () => {
      const schema = createSanitizeSchema();
      expect(schema.tagNames).toContain('details');
    });

    it('should create strict schema', () => {
      const schema = createSanitizeSchema({ level: 'strict' });
      expect(schema.tagNames).not.toContain('details');
    });

    it('should create loose schema', () => {
      const schema = createSanitizeSchema({ level: 'loose' });
      expect(schema.tagNames).toContain('video');
      expect(schema.tagNames).toContain('audio');
    });

    it('should add custom tags', () => {
      const schema = createSanitizeSchema({
        customTags: ['custom-element'],
      });
      expect(schema.tagNames).toContain('custom-element');
    });

    it('should add custom attributes', () => {
      const schema = createSanitizeSchema({
        customAttributes: {
          'div': ['data-custom'],
        },
      });
      expect(schema.attributes).toBeDefined();
    });

    it('should add custom protocols', () => {
      const schema = createSanitizeSchema({
        customProtocols: ['ftp'],
      });
      expect(schema.protocols).toBeDefined();
    });
  });
});
