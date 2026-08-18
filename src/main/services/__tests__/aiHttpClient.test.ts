import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  callAIAPIWithFetch,
  buildAuthHeaders,
  buildRequestBody,
  extractResponseContent,
  isRetryableError,
  type AIAPIConfig,
} from '../ai/aiHttpClient';

const baseConfig: AIAPIConfig = {
  apiKey: 'test-key',
  apiUrl: 'https://api.example.com/v1/chat/completions',
  modelName: 'test-model',
  apiKeyTransmission: 'header',
  apiMode: 'chat_completion',
};

describe('buildAuthHeaders', () => {
  it('header 模式下无 Bearer 前缀时自动添加', () => {
    const headers = buildAuthHeaders('my-key', 'header');
    expect(headers).toEqual({ Authorization: 'Bearer my-key' });
  });

  it('header 模式已含 Bearer 前缀时直接使用', () => {
    const headers = buildAuthHeaders('Bearer my-key', 'header');
    expect(headers).toEqual({ Authorization: 'Bearer my-key' });
  });

  it('header 模式下保留原始大小写（trim 后）', () => {
    const headers = buildAuthHeaders('  my-key  ', 'header');
    expect(headers).toEqual({ Authorization: 'Bearer my-key' });
  });

  it('body 模式返回空 headers（鉴权由请求体承载）', () => {
    const headers = buildAuthHeaders('my-key', 'body');
    expect(headers).toEqual({});
  });

  it('header 模式但 apiKey 为空时返回空对象', () => {
    const headers = buildAuthHeaders('', 'header');
    expect(headers).toEqual({});
  });
});

describe('buildRequestBody', () => {
  it('chat_completion 模式构造 system/user 消息数组', () => {
    const body = buildRequestBody('请整理表格', baseConfig);
    expect(body.messages).toEqual([
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '请整理表格' },
    ]);
    expect(body.model).toBe('test-model');
  });

  it('chat_completion 模式使用自定义 systemPrompt', () => {
    const body = buildRequestBody('请整理表格', baseConfig, { systemPrompt: '自定义系统提示' });
    expect(body.messages).toEqual([
      { role: 'system', content: '自定义系统提示' },
      { role: 'user', content: '请整理表格' },
    ]);
  });

  it('text_completion 模式使用 prompt 字段', () => {
    const textConfig: AIAPIConfig = { ...baseConfig, apiMode: 'text_completion' };
    const body = buildRequestBody('请整理表格', textConfig);
    expect(body.prompt).toBe('请整理表格');
    expect(body.messages).toBeUndefined();
  });

  it('仅包含提供的可选参数', () => {
    const body = buildRequestBody('p', baseConfig, { temperature: 0.7, max_tokens: 4096 });
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(4096);
    expect(body.top_p).toBeUndefined();
  });

  it('body 鉴权方式将 apiKey 放入请求体 api_key 字段', () => {
    const bodyConfig: AIAPIConfig = { ...baseConfig, apiKeyTransmission: 'body' };
    const body = buildRequestBody('p', bodyConfig);
    expect(body.api_key).toBe('test-key');
  });

  it('header 鉴权方式请求体不含 api_key', () => {
    const body = buildRequestBody('p', baseConfig);
    expect(body.api_key).toBeUndefined();
  });
});

describe('extractResponseContent', () => {
  it('chat_completion 模式提取 choices[0].message.content', () => {
    const data = { choices: [{ message: { content: '  整理结果  ' } }] };
    expect(extractResponseContent(data, true)).toBe('整理结果');
  });

  it('text_completion 模式提取 choices[0].text', () => {
    const data = { choices: [{ text: '整理结果' }] };
    expect(extractResponseContent(data, false)).toBe('整理结果');
  });

  it('choices 为空时抛出错误', () => {
    expect(() => extractResponseContent({ choices: [] }, true)).toThrow('没有返回 choices');
    expect(() => extractResponseContent({}, true)).toThrow('没有返回 choices');
  });

  it('content 为空时抛出错误', () => {
    expect(() => extractResponseContent({ choices: [{ message: { content: '' } }] }, true)).toThrow('AI 响应内容为空或格式错误');
    expect(() => extractResponseContent({ choices: [{ message: {} }, {}] }, true)).toThrow('AI 响应内容为空或格式错误');
  });
});

describe('isRetryableError', () => {
  it('TypeError（网络错误）可重试', () => {
    expect(isRetryableError(new TypeError('fetch failed'))).toBe(true);
  });

  it('5xx 状态可重试', () => {
    expect(isRetryableError({ status: 500 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
  });

  it('4xx 状态不可重试', () => {
    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError({ status: 401 })).toBe(false);
  });

  it('非对象错误不可重试', () => {
    expect(isRetryableError('string error')).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});

describe('callAIAPIWithFetch', () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    vi.restoreAllMocks();
  });

  function mockFetchResponse(ok: boolean, status: number, body: unknown, statusText = '') {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, statusText }));
  }

  beforeEach(() => {
    // 测试环境使用 setTimeout 本身（vitest fake timers 未启用）
    globalThis.setTimeout = originalSetTimeout;
  });

  it('成功调用返回提取的文本内容', async () => {
    mockFetchResponse(true, 200, { choices: [{ message: { content: '整理结果' } }] });
    const result = await callAIAPIWithFetch('prompt', baseConfig, { temperature: 0.7 });
    expect(result).toBe('整理结果');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('4xx 错误不重试并抛出', async () => {
    mockFetchResponse(false, 400, { error: 'bad request' }, 'Bad Request');
    await expect(callAIAPIWithFetch('p', baseConfig)).rejects.toThrow('API 调用失败: 400');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('5xx 错误重试 3 次后仍失败则抛出', { timeout: 20000 }, async () => {
    // 前三次返回 500，最终成功返回 200；重试延迟 1s+2s+4s，需放宽默认 5s 超时
    // 前三次返回 500，最终成功返回 200
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'server' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'server' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'server' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
    const result = await callAIAPIWithFetch('p', baseConfig);
    expect(result).toBe('ok');
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  it('网络错误（TypeError）触发重试后成功', async () => {
    globalThis.fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
    const result = await callAIAPIWithFetch('p', baseConfig);
    expect(result).toBe('ok');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('响应缺失 choices 时抛出明确错误', async () => {
    mockFetchResponse(true, 200, {});
    await expect(callAIAPIWithFetch('p', baseConfig)).rejects.toThrow('没有返回 choices');
  });
});