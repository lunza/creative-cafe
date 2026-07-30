/**
 * AIAssistedChapterService 重试逻辑单元测试（F5 修复验证）
 *
 * 验证点：
 *  1. transient 错误（HTTP 5xx / 429 / 网络错误 / 超时 / 空响应）触发重试
 *  2. permanent 错误（HTTP 4xx 非 429 / 配置缺失）不触发重试
 *  3. 重试成功后返回正确内容
 *  4. 重试耗尽后抛出正确的 WritingError（含原 error code）
 *  5. onRetry 回调被正确触发
 *
 * 由于 callAIService 为 private 方法，本测试通过访问 (service as any) 的私有成员直接调用。
 * fetch 通过全局 mock 替换。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock chatLogService.addLog
vi.mock('../memory/chatLogService', () => ({
  addLog: vi.fn(),
}));

// Mock aiConfigProvider
vi.mock('../ai/AIConfigProvider', () => ({
  aiConfigProvider: {
    getAIConfig: vi.fn().mockReturnValue({
      baseUrl: 'http://test-server',
      apiKey: 'test-key',
      apiKeyTransmission: 'header',
      modelName: 'test-model',
      systemPrompt: '',
    }),
  },
}));

// Mock storageService.getSettings
vi.mock('../storageService', () => ({
  getStorageService: () => ({
    getSettings: () => ({
      aiEngines: [
        {
          id: 'default',
          temperature: 0.7,
          max_tokens: 2048,
        },
      ],
      activeEngineId: 'default',
    }),
  }),
}));

// Mock outlineGenerator (导入但未使用，避免原文件 TS6133 干扰)
vi.mock('../writing/OutlineGenerator', () => ({
  outlineGenerator: {},
}));

import { aiAssistedChapterService } from '../writing/AIAssistedChapterService';
import { WritingErrorCode } from '../../../shared/types/writing.types';

// 保存原始 fetch 以便 afterEach 恢复
const originalFetch = globalThis.fetch;

describe('AIAssistedChapterService.callAIService 重试逻辑 (F5 修复)', () => {
  let service: any;
  let getAIConfigMock: any;

  beforeEach(async () => {
    service = aiAssistedChapterService as any;
    // 获取 mock 引用，每个测试可独立覆盖
    const { aiConfigProvider } = await import('../ai/AIConfigProvider');
    getAIConfigMock = aiConfigProvider.getAIConfig as any;
    // 每个测试默认返回正常配置
    getAIConfigMock.mockReturnValue({
      baseUrl: 'http://test-server',
      apiKey: 'test-key',
      apiKeyTransmission: 'header',
      modelName: 'test-model',
      systemPrompt: '',
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  /**
   * 辅助：构造 fetch mock，按顺序返回给定响应序列。
   * 响应可以是 { ok, status, statusText, body } 或 Error 实例（throw）。
   */
  function mockFetchSequence(responses: Array<any>): { calls: number } {
    let calls = 0;
    const tracker = { calls: 0 };
    globalThis.fetch = vi.fn(async (url: string, init: any) => {
      tracker.calls++;
      const idx = Math.min(calls, responses.length - 1);
      const resp = responses[idx];
      calls++;
      if (resp instanceof Error) {
        throw resp;
      }
      // 处理 AbortError
      if (resp.abortError) {
        const err = new DOMException('The user aborted a request.', 'AbortError');
        throw err;
      }
      return {
        ok: resp.ok,
        status: resp.status,
        statusText: resp.statusText || '',
        json: async () => resp.body,
        text: async () => (typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body)),
      } as any;
    }) as any;
    return tracker;
  }

  it('成功响应：不重试，直接返回内容', async () => {
    mockFetchSequence([
      {
        ok: true,
        status: 200,
        body: { choices: [{ message: { content: 'AI 返回的内容' } }] },
      },
    ]);

    const result = await service.callAIService(
      [{ role: 'user', content: 'test' }],
      { model: 'test-model', temperature: 0.7, maxTokens: 2048 },
      5000
    );
    expect(result).toBe('AI 返回的内容');
  });

  it('HTTP 500（transient）：重试后成功', async () => {
    const tracker = mockFetchSequence([
      { ok: false, status: 500, statusText: 'Internal Server Error', body: 'server error' },
      { ok: false, status: 503, statusText: 'Service Unavailable', body: 'unavailable' },
      {
        ok: true,
        status: 200,
        body: { choices: [{ message: { content: '重试后成功' } }] },
      },
    ]);

    const result = await service.callAIService(
      [{ role: 'user', content: 'test' }],
      { model: 'test-model', temperature: 0.7, maxTokens: 2048 },
      5000
    );
    expect(result).toBe('重试后成功');
    expect(tracker.calls).toBe(3); // 1 次失败 + 2 次重试中的成功
  });

  it('HTTP 429（transient）：重试后成功', async () => {
    const tracker = mockFetchSequence([
      { ok: false, status: 429, statusText: 'Too Many Requests', body: 'rate limited' },
      {
        ok: true,
        status: 200,
        body: { choices: [{ message: { content: '限流后成功' } }] },
      },
    ]);

    const result = await service.callAIService(
      [{ role: 'user', content: 'test' }],
      { model: 'test-model', temperature: 0.7, maxTokens: 2048 },
      5000
    );
    expect(result).toBe('限流后成功');
    expect(tracker.calls).toBe(2);
  });

  it('HTTP 400（permanent）：不重试，直接抛出 CONTENT_GENERATION_FAILED', async () => {
    const tracker = mockFetchSequence([
      { ok: false, status: 400, statusText: 'Bad Request', body: 'bad request' },
    ]);

    await expect(
      service.callAIService(
        [{ role: 'user', content: 'test' }],
        { model: 'test-model', temperature: 0.7, maxTokens: 2048 },
        5000
      )
    ).rejects.toMatchObject({
      code: WritingErrorCode.CONTENT_GENERATION_FAILED,
    });
    expect(tracker.calls).toBe(1); // 不重试
  });

  it('HTTP 401（permanent）：不重试，抛出 CONTENT_GENERATION_FAILED', async () => {
    const tracker = mockFetchSequence([
      { ok: false, status: 401, statusText: 'Unauthorized', body: 'unauthorized' },
    ]);

    await expect(
      service.callAIService(
        [{ role: 'user', content: 'test' }],
        { model: 'test-model', temperature: 0.7, maxTokens: 2048 },
        5000
      )
    ).rejects.toMatchObject({
      code: WritingErrorCode.CONTENT_GENERATION_FAILED,
    });
    expect(tracker.calls).toBe(1);
  });

  it('网络错误（transient）：重试后成功', async () => {
    const tracker = mockFetchSequence([
      new TypeError('Failed to fetch: ECONNREFUSED'),
      {
        ok: true,
        status: 200,
        body: { choices: [{ message: { content: '网络恢复后成功' } }] },
      },
    ]);

    const result = await service.callAIService(
      [{ role: 'user', content: 'test' }],
      { model: 'test-model', temperature: 0.7, maxTokens: 2048 },
      5000
    );
    expect(result).toBe('网络恢复后成功');
    expect(tracker.calls).toBe(2);
  });

  it('空响应（transient）：重试后成功', async () => {
    const tracker = mockFetchSequence([
      { ok: true, status: 200, body: { choices: [{ message: { content: '' } }] } },
      { ok: true, status: 200, body: { choices: [{ message: { content: '内容' } }] } },
    ]);

    const result = await service.callAIService(
      [{ role: 'user', content: 'test' }],
      { model: 'test-model', temperature: 0.7, maxTokens: 2048 },
      5000
    );
    expect(result).toBe('内容');
    expect(tracker.calls).toBe(2);
  });

  it('超时 AbortError（transient）：重试后成功', async () => {
    // 注意：本测试无法真实触发 setTimeout 超时（vitest 默认不 mock timer），
    // 改为直接 throw AbortError 模拟超时
    const tracker = mockFetchSequence([
      { abortError: true },
      {
        ok: true,
        status: 200,
        body: { choices: [{ message: { content: '超时后成功' } }] },
      },
    ]);

    const result = await service.callAIService(
      [{ role: 'user', content: 'test' }],
      { model: 'test-model', temperature: 0.7, maxTokens: 2048 },
      5000
    );
    expect(result).toBe('超时后成功');
    expect(tracker.calls).toBe(2);
  });

  it('重试耗尽（3 次全失败）：抛出最后一次错误的 WritingError', async () => {
    const tracker = mockFetchSequence([
      { ok: false, status: 500, statusText: 'Server Error', body: 'error 1' },
      { ok: false, status: 503, statusText: 'Unavailable', body: 'error 2' },
      { ok: false, status: 502, statusText: 'Bad Gateway', body: 'error 3' },
    ]);

    await expect(
      service.callAIService(
        [{ role: 'user', content: 'test' }],
        { model: 'test-model', temperature: 0.7, maxTokens: 2048 },
        5000
      )
    ).rejects.toMatchObject({
      code: WritingErrorCode.CONTENT_GENERATION_FAILED,
    });
    expect(tracker.calls).toBe(3); // 3 次尝试均失败
  });

  it('超时重试耗尽：抛出 TIMEOUT 错误', async () => {
    mockFetchSequence([{ abortError: true }, { abortError: true }, { abortError: true }]);

    await expect(
      service.callAIService(
        [{ role: 'user', content: 'test' }],
        { model: 'test-model', temperature: 0.7, maxTokens: 2048 },
        5000
      )
    ).rejects.toMatchObject({
      code: WritingErrorCode.TIMEOUT,
    });
  });

  it('baseUrl 缺失：直接抛出 AI_SERVICE_UNAVAILABLE，不进入重试循环', async () => {
    // 临时覆盖 aiConfigProvider mock：baseUrl 为空
    getAIConfigMock.mockReturnValue({
      baseUrl: '',
      apiKey: 'test-key',
      apiKeyTransmission: 'header',
      modelName: 'test-model',
      systemPrompt: '',
    });

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    await expect(
      service.callAIService(
        [{ role: 'user', content: 'test' }],
        { model: 'test-model', temperature: 0.7, maxTokens: 2048 },
        5000
      )
    ).rejects.toMatchObject({
      code: WritingErrorCode.AI_SERVICE_UNAVAILABLE,
    });
    expect(fetchSpy).not.toHaveBeenCalled(); // 未进入 fetch
  });

  it('onRetry 回调触发：transient 错误时记录日志', async () => {
    const { addLog } = await import('../memory/chatLogService');

    mockFetchSequence([
      { ok: false, status: 500, statusText: 'Server Error', body: 'error' },
      {
        ok: true,
        status: 200,
        body: { choices: [{ message: { content: '成功' } }] },
      },
    ]);

    await service.callAIService(
      [{ role: 'user', content: 'test' }],
      { model: 'test-model', temperature: 0.7, maxTokens: 2048 },
      5000
    );

    // 验证 addLog 被调用且包含"重试"字样
    const calls = (addLog as any).mock.calls;
    const retryLogCall = calls.find((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('重试')
    );
    expect(retryLogCall).toBeDefined();
  });
});
