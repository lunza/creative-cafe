import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AIService, useAIService, defaultAIServiceConfig } from './AIService';
import type { AIServiceConfig, AIRequestOptions, AIStreamOptions } from './AIService.types';

// Mock fetch globally
beforeEach(() => {
  // Mock fetch
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('AIService', () => {
  describe('constructor', () => {
    it('should create an instance with valid config', () => {
      const service = new AIService(defaultAIServiceConfig);
      expect(service).toBeDefined();
    });

    it('should auto-repair invalid temperature and use default', () => {
      const invalidConfig = {
        ...defaultAIServiceConfig,
        defaultTemperature: 3,
      };
      const service = new AIService(invalidConfig as any);
      const config = service.getConfig();
      expect(config.defaultTemperature).toBe(0.7);
    });

    it('should auto-repair invalid maxTokens and use default', () => {
      const invalidConfig = {
        ...defaultAIServiceConfig,
        defaultMaxTokens: -100,
      };
      const service = new AIService(invalidConfig as any);
      const config = service.getConfig();
      expect(config.defaultMaxTokens).toBe(1000);
    });

    it('should auto-repair zero maxTokens and use default', () => {
      const invalidConfig = {
        ...defaultAIServiceConfig,
        defaultMaxTokens: 0,
      };
      const service = new AIService(invalidConfig as any);
      const config = service.getConfig();
      expect(config.defaultMaxTokens).toBe(1000);
    });

    it('should auto-repair NaN values and use defaults', () => {
      const invalidConfig = {
        ...defaultAIServiceConfig,
        defaultMaxTokens: NaN,
        defaultTemperature: Infinity,
      };
      const service = new AIService(invalidConfig as any);
      const config = service.getConfig();
      expect(config.defaultMaxTokens).toBe(1000);
      expect(config.defaultTemperature).toBe(0.7);
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      const service = new AIService(defaultAIServiceConfig);
      const config = service.getConfig();
      expect(config).toEqual(defaultAIServiceConfig);
      expect(config).not.toBe(defaultAIServiceConfig);
    });
  });

  describe('updateConfig', () => {
    it('should update config with valid partial config', () => {
      const service = new AIService(defaultAIServiceConfig);
      service.updateConfig({ defaultModel: 'gpt-4' });
      const config = service.getConfig();
      expect(config.defaultModel).toBe('gpt-4');
    });

    it('should throw error with invalid config', () => {
      const service = new AIService(defaultAIServiceConfig);
      expect(() => service.updateConfig({ defaultTemperature: 3 })).toThrow();
    });
  });

  describe('sendChatRequest', () => {
    it('should handle valid request', async () => {
      // Mock fetch response
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{
          message: { content: 'Hello, World!' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        id: 'test-id',
      }),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

      const service = new AIService(defaultAIServiceConfig);
      const options: AIRequestOptions = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = await service.sendChatRequest(options);

      expect(result.status).toBe('success');
      expect(result.response?.content).toBe('Hello, World!');
    });

    it('should handle validation errors', async () => {
      const service = new AIService(defaultAIServiceConfig);
      const invalidOptions: any = {
        messages: [{ role: 'user', content: 'Hello' }],
      };
      const result = await service.sendChatRequest(invalidOptions);
      expect(result.status).toBe('error');
      expect(result.error?.type).toBe('validation');
    });

    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));
      const service = new AIService(defaultAIServiceConfig);
      const options: AIRequestOptions = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
      };
      const result = await service.sendChatRequest(options);
      expect(result.status).toBe('error');
    });
  });

  describe('sendStreamChatRequest', () => {
    it('should handle streaming responses', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"H"}}]}\n'));
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"e"}}]}\n'));
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"l"}}]}\n'));
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"l"}}]}\n'));
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"o"}}]}\n'));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
          controller.close();
        },
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        body: mockStream,
      });

      const service = new AIService(defaultAIServiceConfig);
      const options: AIRequestOptions = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      let receivedContent = '';
      let isComplete = false;

      const streamOptions: AIStreamOptions = {
        onStream: (content, done) => {
          receivedContent += content;
          if (done) isComplete = true;
        },
      };

      await service.sendStreamChatRequest(options, streamOptions);
      expect(receivedContent).toBe('Hello');
      expect(isComplete).toBe(true);
    });

    it('should handle streaming errors', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));
      const service = new AIService(defaultAIServiceConfig);
      const options: AIRequestOptions = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      let errorReceived = null;
      const streamOptions: AIStreamOptions = {
        onStream: vi.fn(),
        onError: (err) => { errorReceived = err; },
      };

      await service.sendStreamChatRequest(options, streamOptions);
      expect(errorReceived).not.toBeNull();
    });
  });
});

describe('useAIService Hook', () => {
  it('should initialize with correct state', () => {
    const { result } = renderHook(() => useAIService(defaultAIServiceConfig));
    expect(result.current.status).toBe('idle');
    expect(result.current.response).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.aiService).toBeDefined();
  });

  it('should reset state correctly', async () => {
    const { result } = renderHook(() => useAIService(defaultAIServiceConfig));
    
    await act(async () => {
      result.current.reset();
    });
    
    expect(result.current.status).toBe('idle');
    expect(result.current.response).toBeNull();
  });

  it('should handle sendChatRequest updates', async () => {
    // Mock fetch for this test
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Test response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        id: 'test-id',
      }),
    });

    const { result } = renderHook(() => useAIService(defaultAIServiceConfig));
    const options: AIRequestOptions = {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    let resultData;
    await act(async () => {
      resultData = await result.current.sendChatRequest(options);
    });

    expect(resultData.status).toBe('success');
    expect(result.current.status).toBe('success');
    expect(result.current.response?.content).toBe('Test response');
  });

  it('should handle sendStreamChatRequest updates', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"T"}}'));
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"e"}}'));
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"s"}}'));
        controller.enqueue(new TextEncoder().encode('data: [DONE]'));
        controller.close();
      },
    });

    (global.fetch as any).mockResolvedValue({
      ok: true,
      body: mockStream,
    });

    const { result } = renderHook(() => useAIService(defaultAIServiceConfig));
    const options: AIRequestOptions = {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    let fullContent = '';
    const streamOptions: AIStreamOptions = {
      onStream: (content, done) => {
        fullContent += content;
      },
    };

    await act(async () => {
      await result.current.sendStreamChatRequest(options, streamOptions);
    });

    expect(result.current.status).toBe('success');
  });
});

describe('Vercel AI SDK Integration (Mocked)', () => {
  // We can mock the SDK functions for basic testing
  it('should expose new methods', () => {
    const service = new AIService(defaultAIServiceConfig);
    expect(typeof service.sendChatRequestVercel).toBe('function');
    expect(typeof service.sendStreamChatRequestVercel).toBe('function');
  });

  it('should have new methods in useAIService Hook', () => {
    const { result } = renderHook(() => useAIService(defaultAIServiceConfig));
    expect(typeof result.current.sendChatRequestVercel).toBe('function');
    expect(typeof result.current.sendStreamChatRequestVercel).toBe('function');
  });
});
