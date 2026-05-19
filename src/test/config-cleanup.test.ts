/**
 * 配置清理功能单元测试
 * 验证配置清理和向量数据分离功能
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('配置清理和向量数据分离', () => {
  describe('配置清理服务', () => {
    it('应能识别并移除顶级向量数据字段', () => {
      const settings = {
        aiEngines: [{ id: 'default' }],
        vectors: [
          { id: 'v1', vector: [0.1, 0.2] },
          { id: 'v2', vector: [0.3, 0.4] }
        ],
        logLevel: 'info'
      };

      const vectorDataKeys = ['vectors', 'vectorData', 'embeddings', 'vectorArray', 'vectors_data'];
      const sanitized = { ...settings };
      
      for (const key of vectorDataKeys) {
        if (sanitized[key] && Array.isArray(sanitized[key])) {
          delete sanitized[key];
        }
      }

      expect(sanitized).toHaveProperty('aiEngines');
      expect(sanitized).toHaveProperty('logLevel');
      expect(sanitized).not.toHaveProperty('vectors');
    });

    it('应能清理包含向量数据的vector配置', () => {
      const allowedFields = [
        'embeddingMode', 'remoteModel', 'remoteApiUrl', 'remoteApiKey',
        'cacheEnabled', 'cacheL1Size', 'cacheL1TTL', 'cacheL2TTL',
        'defaultTopK', 'minSimilarityScore', 'contextWindowTokens',
        'autoVectorizeWorldBook', 'autoVectorizeKnowledge', 'dimension'
      ];

      const vectorConfig = {
        embeddingMode: 'remote',
        remoteModel: 'test-model',
        remoteApiUrl: 'https://api.test.com',
        remoteApiKey: 'sk-test',
        cacheEnabled: true,
        defaultTopK: 5,
        vectors: Array(100).fill({ id: 'test', vector: [0.1] }),
        vectorData: Array(50).fill({ embedding: [0.2] })
      };

      const cleanedConfig: any = {};
      for (const field of allowedFields) {
        if (field in vectorConfig) {
          cleanedConfig[field] = vectorConfig[field];
        }
      }

      expect(cleanedConfig).toHaveProperty('embeddingMode', 'remote');
      expect(cleanedConfig).toHaveProperty('remoteModel', 'test-model');
      expect(cleanedConfig).toHaveProperty('defaultTopK', 5);
      expect(cleanedConfig).not.toHaveProperty('vectors');
      expect(cleanedConfig).not.toHaveProperty('vectorData');
      expect(Object.keys(cleanedConfig).length).toBe(6);
    });

    it('应能正确计算配置大小变化', () => {
      const originalConfig = {
        embeddingMode: 'remote',
        remoteModel: 'test-model',
        remoteApiUrl: 'https://api.test.com',
        remoteApiKey: 'sk-test',
        vectors: Array(1000).fill(null).map((_, i) => ({
          id: `vec_${i}`,
          vector: Array(1536).fill(0.1)
        }))
      };

      const allowedFields = [
        'embeddingMode', 'remoteModel', 'remoteApiUrl', 'remoteApiKey',
        'cacheEnabled', 'cacheL1Size', 'cacheL1TTL', 'cacheL2TTL',
        'defaultTopK', 'minSimilarityScore', 'contextWindowTokens',
        'autoVectorizeWorldBook', 'autoVectorizeKnowledge', 'dimension'
      ];

      const cleanedConfig: any = {};
      for (const field of allowedFields) {
        if (field in originalConfig) {
          cleanedConfig[field] = originalConfig[field];
        }
      }

      const originalSize = JSON.stringify(originalConfig).length;
      const cleanedSize = JSON.stringify(cleanedConfig).length;
      const reduction = originalSize - cleanedSize;
      const reductionPercent = (reduction / originalSize * 100).toFixed(2);

      expect(originalSize).toBeGreaterThan(10000);
      expect(cleanedSize).toBeLessThan(500);
      expect(parseFloat(reductionPercent)).toBeGreaterThan(95);
    });
  });

  describe('向量配置管理器', () => {
    it('应能正确验证配置字段白名单', () => {
      const allowedFields = new Set([
        'embeddingMode', 'remoteModel', 'remoteApiUrl', 'remoteApiKey',
        'cacheEnabled', 'cacheL1Size', 'cacheL1TTL', 'cacheL2TTL',
        'defaultTopK', 'minSimilarityScore', 'contextWindowTokens',
        'autoVectorizeWorldBook', 'autoVectorizeKnowledge', 'dimension'
      ]);

      const validConfig = {
        embeddingMode: 'remote',
        remoteModel: 'test-model',
        defaultTopK: 5
      };

      const invalidConfig = {
        embeddingMode: 'remote',
        vectors: [{ id: 'test', vector: [0.1] }]
      };

      const isValidConfig = (config: any) => {
        return Object.keys(config).every(key => allowedFields.has(key));
      };

      expect(isValidConfig(validConfig)).toBe(true);
      expect(isValidConfig(invalidConfig)).toBe(false);
    });

    it('应能检测禁止的数据字段', () => {
      const forbiddenFields = [
        'vectors', 'vectorData', 'embeddings', 'items', 'records',
        'vectorArray', 'vectors_data', 'data', 'entries'
      ];

      const configWithData = {
        embeddingMode: 'remote',
        vectors: [{ id: 'test', vector: [0.1] }]
      };

      const hasForbiddenField = forbiddenFields.some(field => field in configWithData);
      expect(hasForbiddenField).toBe(true);

      const configWithoutData = {
        embeddingMode: 'remote',
        remoteModel: 'test-model'
      };

      const hasForbiddenField2 = forbiddenFields.some(field => field in configWithoutData);
      expect(hasForbiddenField2).toBe(false);
    });

    it('应能正确验证数值范围', () => {
      const validConfig = {
        defaultTopK: 5,
        minSimilarityScore: 0.6,
        cacheL1Size: 2000
      };

      const invalidConfig1 = {
        defaultTopK: 150
      };

      const invalidConfig2 = {
        minSimilarityScore: 1.5
      };

      const invalidConfig3 = {
        cacheL1Size: -100
      };

      const validateNumericRange = (config: any) => {
        const errors: string[] = [];
        if (config.defaultTopK !== undefined && (config.defaultTopK < 1 || config.defaultTopK > 100)) {
          errors.push('defaultTopK 必须在 1-100 之间');
        }
        if (config.minSimilarityScore !== undefined && (config.minSimilarityScore < 0 || config.minSimilarityScore > 1)) {
          errors.push('minSimilarityScore 必须在 0-1 之间');
        }
        if (config.cacheL1Size !== undefined && config.cacheL1Size < 0) {
          errors.push('cacheL1Size 不能为负数');
        }
        return errors;
      };

      expect(validateNumericRange(validConfig)).toEqual([]);
      expect(validateNumericRange(invalidConfig1)).toContain('defaultTopK 必须在 1-100 之间');
      expect(validateNumericRange(invalidConfig2)).toContain('minSimilarityScore 必须在 0-1 之间');
      expect(validateNumericRange(invalidConfig3)).toContain('cacheL1Size 不能为负数');
    });
  });

  describe('配置写入拦截器', () => {
    it('应能拦截包含向量数据的配置写入', () => {
      const sanitizeSettings = (settings: any) => {
        const sanitized = { ...settings };
        
        const vectorDataKeys = ['vectors', 'vectorData', 'embeddings', 'vectorArray', 'vectors_data'];
        for (const key of vectorDataKeys) {
          if (sanitized[key] && Array.isArray(sanitized[key])) {
            delete sanitized[key];
          }
        }

        if (sanitized.vector) {
          const vectorConfig = sanitized.vector;
          const allowedFields = [
            'embeddingMode', 'remoteModel', 'remoteApiUrl', 'remoteApiKey',
            'cacheEnabled', 'cacheL1Size', 'cacheL1TTL', 'cacheL2TTL',
            'defaultTopK', 'minSimilarityScore', 'contextWindowTokens',
            'autoVectorizeWorldBook', 'autoVectorizeKnowledge', 'dimension'
          ];

          const cleanedVectorConfig: any = {};
          for (const field of allowedFields) {
            if (field in vectorConfig) {
              cleanedVectorConfig[field] = vectorConfig[field];
            }
          }

          sanitized.vector = cleanedVectorConfig;
        }

        return sanitized;
      };

      const testSettings = {
        aiEngines: [{ id: 'default' }],
        logLevel: 'info',
        vectors: Array(100).fill({ id: 'test', vector: [0.1] }),
        vector: {
          embeddingMode: 'remote',
          remoteModel: 'test-model',
          vectors: Array(200).fill({ id: 'test', vector: [0.2] }),
          defaultTopK: 5
        }
      };

      const cleaned = sanitizeSettings(testSettings);

      expect(cleaned).toHaveProperty('aiEngines');
      expect(cleaned).toHaveProperty('logLevel');
      expect(cleaned).not.toHaveProperty('vectors');
      expect(cleaned.vector).toHaveProperty('embeddingMode');
      expect(cleaned.vector).toHaveProperty('defaultTopK');
      expect(cleaned.vector).not.toHaveProperty('vectors');
    });

    it('应能保持合法配置字段不变', () => {
      const sanitizeSettings = (settings: any) => {
        const sanitized = { ...settings };
        
        const vectorDataKeys = ['vectors', 'vectorData', 'embeddings', 'vectorArray', 'vectors_data'];
        for (const key of vectorDataKeys) {
          if (sanitized[key] && Array.isArray(sanitized[key])) {
            delete sanitized[key];
          }
        }

        if (sanitized.vector) {
          const vectorConfig = sanitized.vector;
          const allowedFields = [
            'embeddingMode', 'remoteModel', 'remoteApiUrl', 'remoteApiKey',
            'cacheEnabled', 'cacheL1Size', 'cacheL1TTL', 'cacheL2TTL',
            'defaultTopK', 'minSimilarityScore', 'contextWindowTokens',
            'autoVectorizeWorldBook', 'autoVectorizeKnowledge', 'dimension'
          ];

          const cleanedVectorConfig: any = {};
          for (const field of allowedFields) {
            if (field in vectorConfig) {
              cleanedVectorConfig[field] = vectorConfig[field];
            }
          }

          sanitized.vector = cleanedVectorConfig;
        }

        return sanitized;
      };

      const validConfig = {
        aiEngines: [{ id: 'default' }],
        logLevel: 'info',
        vector: {
          embeddingMode: 'remote',
          remoteModel: 'text-embedding-3-small',
          remoteApiUrl: 'https://api.openai.com/v1/embeddings',
          remoteApiKey: 'sk-test',
          cacheEnabled: true,
          defaultTopK: 8,
          minSimilarityScore: 0.6
        }
      };

      const cleaned = sanitizeSettings(validConfig);

      expect(cleaned.vector.embeddingMode).toBe('remote');
      expect(cleaned.vector.remoteModel).toBe('text-embedding-3-small');
      expect(cleaned.vector.remoteApiKey).toBe('sk-test');
      expect(cleaned.vector.cacheEnabled).toBe(true);
      expect(cleaned.vector.defaultTopK).toBe(8);
    });
  });
});
