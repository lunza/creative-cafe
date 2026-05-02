import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIErrorHandler, AIUtils, AIConfigValidator } from './AIService.utils';
import type { AIServiceConfig, AIRequestOptions } from './AIService.types';

describe('AIErrorHandler', () => {
  describe('createNetworkError', () => {
    it('should create a network error with message and details', () => {
      const error = AIErrorHandler.createNetworkError('Connection failed', { status: 500 });
      expect(error.message).toBe('Connection failed');
      expect(error.type).toBe('network');
      expect(error.details).toEqual({ status: 500 });
    });
  });

  describe('createServerError', () => {
    it('should create a server error with message, code, and details', () => {
      const error = AIErrorHandler.createServerError('Server error', '500', { trace: 'error' });
      expect(error.message).toBe('Server error');
      expect(error.type).toBe('server');
      expect(error.code).toBe('500');
      expect(error.details).toEqual({ trace: 'error' });
    });
  });

  describe('createApiError', () => {
    it('should create an API error with message, code, and details', () => {
      const error = AIErrorHandler.createApiError('API error', '400', { field: 'invalid' });
      expect(error.message).toBe('API error');
      expect(error.type).toBe('api');
      expect(error.code).toBe('400');
      expect(error.details).toEqual({ field: 'invalid' });
    });
  });

  describe('createValidationError', () => {
    it('should create a validation error with message and details', () => {
      const error = AIErrorHandler.createValidationError('Invalid input', { field: 'name' });
      expect(error.message).toBe('Invalid input');
      expect(error.type).toBe('validation');
      expect(error.details).toEqual({ field: 'name' });
    });
  });

  describe('createUnknownError', () => {
    it('should create an unknown error with message and details', () => {
      const error = AIErrorHandler.createUnknownError('Unknown error', { raw: 'data' });
      expect(error.message).toBe('Unknown error');
      expect(error.type).toBe('unknown');
      expect(error.details).toEqual({ raw: 'data' });
    });
  });

  describe('fromError', () => {
    it('should convert a network error string to network error', () => {
      const error = new Error('Network connection failed');
      const aiError = AIErrorHandler.fromError(error);
      expect(aiError.type).toBe('network');
    });

    it('should convert an error with status 500 to server error', () => {
      const error = new Error('Server error');
      (error as any).status = 500;
      const aiError = AIErrorHandler.fromError(error);
      expect(aiError.type).toBe('server');
    });

    it('should convert an error with status 400 to API error', () => {
      const error = new Error('API error');
      (error as any).status = 400;
      const aiError = AIErrorHandler.fromError(error);
      expect(aiError.type).toBe('api');
    });

    it('should convert a validation error message to validation error', () => {
      const error = new Error('validation failed');
      const aiError = AIErrorHandler.fromError(error);
      expect(aiError.type).toBe('validation');
    });

    it('should convert null to default unknown error', () => {
      const aiError = AIErrorHandler.fromError(null);
      expect(aiError.type).toBe('unknown');
      expect(aiError.message).toBe('未知错误');
    });

    it('should convert non-Error object to unknown error', () => {
      const aiError = AIErrorHandler.fromError({ message: 'Some error' });
      expect(aiError.type).toBe('unknown');
    });
  });
});

describe('AIUtils', () => {
  describe('formatRequestOptions', () => {
    const mockConfig: AIServiceConfig = {
      defaultModel: 'gpt-3.5-turbo',
      defaultBaseUrl: 'https://api.openai.com/v1',
      defaultApiKey: 'test-key',
      defaultTemperature: 0.7,
      defaultMaxTokens: 1000,
      retryAttempts: 3,
      retryDelay: 1000,
    };

    it('should merge options with config defaults', () => {
      // 创建一个只包含 messages 的对象，其他字段省略
      const options: Partial<AIRequestOptions> = {
        messages: [{ role: 'user', content: 'Hello' }],
      };
      
      const formatted = AIUtils.formatRequestOptions(options as AIRequestOptions, mockConfig);
      expect(formatted.model).toBe('gpt-3.5-turbo');
      expect(formatted.baseUrl).toBe('https://api.openai.com/v1');
      expect(formatted.apiKey).toBe('test-key');
      expect(formatted.temperature).toBe(0.7);
      expect(formatted.max_tokens).toBe(1000);
    });

    it('should prioritize provided options over defaults', () => {
      const options: AIRequestOptions = {
        model: 'gpt-4',
        baseUrl: 'https://custom.api/v1',
        apiKey: 'custom-key',
        temperature: 0.5,
        maxTokens: 2000,
        messages: [{ role: 'user', content: 'Hello' }],
      };
      
      const formatted = AIUtils.formatRequestOptions(options, mockConfig);
      expect(formatted.model).toBe('gpt-4');
      expect(formatted.baseUrl).toBe('https://custom.api/v1');
      expect(formatted.apiKey).toBe('custom-key');
      expect(formatted.temperature).toBe(0.5);
      expect(formatted.max_tokens).toBe(2000);
    });

    it('should handle config with systemPrompt', () => {
      const configWithPrompt = {
        ...mockConfig,
        systemPrompt: 'You are a helpful assistant',
      };
      const options: AIRequestOptions = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
      };
      
      const formatted = AIUtils.formatRequestOptions(options, configWithPrompt);
      expect(formatted.messages.length).toBe(2);
      expect(formatted.messages[0].role).toBe('system');
    });

    it('should not add duplicate system message if already exists', () => {
      const configWithPrompt = {
        ...mockConfig,
        systemPrompt: 'You are a helpful assistant',
      };
      const options: AIRequestOptions = {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Existing system' },
          { role: 'user', content: 'Hello' },
        ],
      };
      
      const formatted = AIUtils.formatRequestOptions(options, configWithPrompt);
      expect(formatted.messages.length).toBe(2);
      expect(formatted.messages[0].content).toBe('Existing system');
    });
  });

  describe('validateRequestOptions', () => {
    it('should validate valid request options', () => {
      const options: AIRequestOptions = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
      };
      const result = AIUtils.validateRequestOptions(options);
      expect(result.valid).toBe(true);
    });

    it('should reject missing model', () => {
      const options: any = {
        messages: [{ role: 'user', content: 'Hello' }],
      };
      const result = AIUtils.validateRequestOptions(options);
      expect(result.valid).toBe(false);
      expect(result.error?.type).toBe('validation');
    });

    it('should reject missing or invalid messages', () => {
      const options: any = {
        model: 'gpt-3.5-turbo',
      };
      const result = AIUtils.validateRequestOptions(options);
      expect(result.valid).toBe(false);
    });

    it('should reject messages with invalid roles', () => {
      const options: AIRequestOptions = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'invalid' as any, content: 'Hello' }],
      };
      const result = AIUtils.validateRequestOptions(options);
      expect(result.valid).toBe(false);
    });

    it('should reject invalid temperature values', () => {
      const options: AIRequestOptions = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 3,
      };
      const result = AIUtils.validateRequestOptions(options);
      expect(result.valid).toBe(false);
    });

    it('should reject invalid maxTokens values', () => {
      const options: AIRequestOptions = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: -1,
      };
      const result = AIUtils.validateRequestOptions(options);
      expect(result.valid).toBe(false);
    });
  });

  describe('calculateResponseTime', () => {
    it('should calculate time difference in milliseconds', () => {
      const start = Date.now() - 500;
      const responseTime = AIUtils.calculateResponseTime(start);
      expect(responseTime).toBeGreaterThanOrEqual(500);
    });
  });

  describe('delay', () => {
    it('should delay for specified milliseconds', async () => {
      const start = Date.now();
      await AIUtils.delay(100);
      const end = Date.now();
      expect(end - start).toBeGreaterThanOrEqual(100);
    });
  });

  describe('retry', () => {
    it('should retry function on failure', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Failed');
        }
        return 'Success';
      };

      const result = await AIUtils.retry(fn, 3, 0);
      expect(result).toBe('Success');
      expect(attempts).toBe(3);
    });

    it('should throw error after max attempts', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new Error('Failed');
      };

      await expect(AIUtils.retry(fn, 2, 0)).rejects.toThrow('Failed');
      expect(attempts).toBe(2);
    });

    it('should succeed on first attempt if no error', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        return 'Success';
      };

      const result = await AIUtils.retry(fn, 3, 0);
      expect(result).toBe('Success');
      expect(attempts).toBe(1);
    });
  });
});

describe('AIConfigValidator', () => {
  describe('validateConfig', () => {
    it('should validate valid config', () => {
      const config: AIServiceConfig = {
        defaultModel: 'gpt-3.5-turbo',
        defaultTemperature: 0.7,
        defaultMaxTokens: 1000,
        retryAttempts: 3,
        retryDelay: 1000,
      };
      const result = AIConfigValidator.validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should reject null/undefined config', () => {
      expect(AIConfigValidator.validateConfig(null as any).valid).toBe(false);
    });

    it('should reject missing or invalid model', () => {
      const config: any = {
        defaultTemperature: 0.7,
      };
      const result = AIConfigValidator.validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('should reject invalid temperature values', () => {
      const config: AIServiceConfig = {
        defaultModel: 'gpt-3.5-turbo',
        defaultTemperature: 3,
      };
      const result = AIConfigValidator.validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('should reject invalid maxTokens values', () => {
      const config: AIServiceConfig = {
        defaultModel: 'gpt-3.5-turbo',
        defaultMaxTokens: -1,
      };
      const result = AIConfigValidator.validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('should reject negative retryAttempts', () => {
      const config: AIServiceConfig = {
        defaultModel: 'gpt-3.5-turbo',
        retryAttempts: -1,
      };
      const result = AIConfigValidator.validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('should reject negative retryDelay', () => {
      const config: AIServiceConfig = {
        defaultModel: 'gpt-3.5-turbo',
        retryDelay: -1,
      };
      const result = AIConfigValidator.validateConfig(config);
      expect(result.valid).toBe(false);
    });
  });

  describe('createDefaultConfig', () => {
    it('should create a valid default config', () => {
      const config = AIConfigValidator.createDefaultConfig();
      expect(config.defaultModel).toBe('gpt-3.5-turbo');
      expect(config.defaultTemperature).toBe(0.7);
      expect(config.defaultMaxTokens).toBe(1000);
      expect(config.retryAttempts).toBe(3);
      expect(config.retryDelay).toBe(1000);
      
      const validation = AIConfigValidator.validateConfig(config);
      expect(validation.valid).toBe(true);
    });
  });
});
