/**
 * WebSearchService + HtmlTextExtractor 单元测试 —— Task 12 SubTask 12.1
 *
 * 来源：spec: add-agent-web-search-tool §Requirement: HTML 正文提取
 *       §Requirement: 搜索结果缓存与速率限制
 *
 * 覆盖（≥10 用例）：
 *  - HtmlTextExtractor（6）：剥离 script/style/nav、解码实体、压缩空白、
 *    截断追加 ...[truncated]、空输入、保留段落结构
 *  - WebSearchService（10）：缓存命中、速率限制等待、次数上限抛错、
 *    resetRateLimit、配置变更清缓存、fetchUrl HTML 提取、fetchUrl JSON 直返、
 *    fetchUrl 非 200 错误、fetchUrl 网络错误、fetchUrl 二进制摘要
 *
 * Mock 策略：
 *  - 全部 mock globalThis.fetch（vi.fn）
 *  - 使用 vi.useFakeTimers 控制速率限制间隔
 *  - 保存原始 fetch，afterEach 恢复
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WebSearchService,
  HtmlTextExtractor,
  extractTextFromHtml,
} from '../webSearchService';
import type { WebSearchConfig } from '../webSearchProviders';

// ==================== Mock 工具 ====================

const originalFetch = globalThis.fetch;

/** 构造 mock Response */
function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Response {
  const ok = opts.ok ?? (opts.status ? opts.status >= 200 && opts.status < 300 : true);
  const status = opts.status ?? 200;
  const statusText = opts.statusText ?? '';
  const bodyStr =
    typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? '');
  return {
    ok,
    status,
    statusText,
    headers: new Headers(opts.headers ?? {}),
    json: async () => (typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body),
    text: async () => bodyStr,
  } as Response;
}

/** 默认配置（duckduckgo provider，无需 API key） */
function defaultConfig(overrides: Partial<WebSearchConfig> = {}): WebSearchConfig {
  return {
    enabled: true,
    provider: 'duckduckgo',
    apiKey: '',
    endpoint: '',
    maxResults: 5,
    timeout: 10000,
    allowedDomains: [],
    enableInAuthoring: false,
    ...overrides,
  };
}

beforeEach(() => {
  // 默认 fetch 返回 200 空响应
  globalThis.fetch = vi.fn(async () => mockResponse({ body: '' })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ==================== HtmlTextExtractor ====================

describe('HtmlTextExtractor', () => {
  const extractor = new HtmlTextExtractor();

  it('剥离 script/style/nav/header/footer 标签及其内容', () => {
    const html = `
      <html>
      <body>
        <header>Header nav text</header>
        <nav><ul><li>nav item</li></ul></nav>
        <main>
          <script>alert('xss');</script>
          <style>.x { color: red; }</style>
          <p>Main content here</p>
        </main>
        <footer>Footer text</footer>
      </body>
      </html>
    `;
    const text = extractor.extract(html, 4000);
    expect(text).toContain('Main content here');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color: red');
    expect(text).not.toContain('Header nav text');
    expect(text).not.toContain('Footer text');
    expect(text).not.toContain('nav item');
  });

  it('解码 HTML 实体（&amp; / &lt; / &nbsp; / &#39;）', () => {
    const html = '<p>Tom &amp; Jerry &lt;3 &#39;quotes&apos; &nbsp;space</p>';
    const text = extractor.extract(html, 4000);
    expect(text).toContain("Tom & Jerry <3 'quotes'");
    // &nbsp; 先被解码为 \u00A0，再被 MULTI_SPACE_REGEX 规范化为普通空格
    expect(text).toContain('space');
    expect(text).not.toContain('&nbsp;');
    expect(text).not.toContain('&amp;');
    expect(text).not.toContain('&#39;');
  });

  it('压缩连续空白为单个空格，3+ 换行合并为 2', () => {
    const html = '<p>word1     word2</p><div><br/><br/><br/><br/>word3</div>';
    const text = extractor.extract(html, 4000);
    // 水平空白压缩
    expect(text).toContain('word1 word2');
    // 多个 <br> → 多个换行，最终被合并为段落（≤2 个换行）
    expect(text).not.toMatch(/\n{3,}/);
  });

  it('截断到 maxLength + 追加 \\n...[truncated]', () => {
    const longText = 'A'.repeat(500);
    const html = `<p>${longText}</p>`;
    const text = extractor.extract(html, 100);
    expect(text.length).toBeLessThanOrEqual(100 + '\n...[truncated]'.length);
    expect(text).toContain('...[truncated]');
    expect(text.startsWith('A'.repeat(100))).toBe(true);
  });

  it('空字符串 / 非字符串输入返回空串', () => {
    expect(extractor.extract('')).toBe('');
    // @ts-expect-error 测试非字符串输入（null 不在签名内）
    expect(extractor.extract(null)).toBe('');
    // @ts-expect-error 测试非字符串输入（undefined 不在签名内）
    expect(extractor.extract(undefined)).toBe('');
    expect(extractor.extract('<p></p>', 100)).toBe('');
  });

  it('保留段落结构（块级元素闭合标签 → 换行）', () => {
    const html = '<p>Para 1</p><p>Para 2</p><div>Div content</div>';
    const text = extractor.extract(html, 4000);
    expect(text).toContain('Para 1');
    expect(text).toContain('Para 2');
    expect(text).toContain('Div content');
    // 段落间应有换行（不应在同一行）
    expect(text).toMatch(/Para 1\n+Para 2/);
  });

  it('HTML 注释被移除', () => {
    const html = '<!-- this is a comment --><p>visible</p>';
    const text = extractor.extract(html, 4000);
    expect(text).toBe('visible');
    expect(text).not.toContain('comment');
  });

  it('extractTextFromHtml 便捷函数等价于 new HtmlTextExtractor().extract()', () => {
    const html = '<p>test &amp; more</p>';
    const a = extractTextFromHtml(html, 100);
    const b = new HtmlTextExtractor().extract(html, 100);
    expect(a).toBe(b);
    expect(a).toContain('test & more');
  });
});

// ==================== WebSearchService — 缓存与速率限制 ====================

describe('WebSearchService — 缓存', () => {
  it('缓存命中：5 分钟内同 query 第二次 search 不调用 provider（fetch 0 次）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const fetchMock = vi.fn(async () =>
      mockResponse({
        body: '<div></div>',
        headers: { 'content-type': 'text/html' },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const service = new WebSearchService();
    const config = defaultConfig();

    // 第一次搜索：触发 fetch
    await service.search('cache-test', config, { maxResults: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 第二次搜索：缓存命中，不应再 fetch
    const r2 = await service.search('cache-test', config, { maxResults: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // 仍为 1
    expect(Array.isArray(r2)).toBe(true);
  });

  it('缓存 TTL 过期：5 分钟后同 query 重新 fetch', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const fetchMock = vi.fn(async () =>
      mockResponse({
        body: '<div></div>',
        headers: { 'content-type': 'text/html' },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const service = new WebSearchService();
    const config = defaultConfig();

    await service.search('ttl-test', config, { maxResults: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 推进 6 分钟（超过 TTL 5 分钟）
    vi.advanceTimersByTime(6 * 60 * 1000 + 100);

    await service.search('ttl-test', config, { maxResults: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('配置变更（provider / apiKey / endpoint 任一变化）清空缓存', async () => {
    const fetchMock = vi.fn(async () =>
      mockResponse({
        body: '<div></div>',
        headers: { 'content-type': 'text/html' },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const service = new WebSearchService();

    // 第一次：duckduckgo provider
    await service.search('cfg-test', defaultConfig({ provider: 'duckduckgo' }), {
      maxResults: 5,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 第二次：apiKey 变化（指纹变更）→ 清缓存 → 重新 fetch
    // 注意：duckduckgo 不用 apiKey，但指纹仍计算 apiKey 字段
    await service.search(
      'cfg-test',
      defaultConfig({ provider: 'duckduckgo', apiKey: 'new-key' }),
      { maxResults: 5 }
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('WebSearchService — 速率限制', () => {
  it('间隔 < 3s 时等待：第二次 search 在 fetch 前等待至少 3s 间隔', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const fetchMock = vi.fn(async () =>
      mockResponse({
        body: '<div></div>',
        headers: { 'content-type': 'text/html' },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const service = new WebSearchService();
    const config = defaultConfig();

    // 第一次：立即完成
    await service.search('rate-1', config, { maxResults: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 第二次：query 不同（避免缓存命中），需等待 3s 间隔
    const secondPromise = service.search('rate-2', config, { maxResults: 5 });
    // 推进 3.5s（满足 3s 间隔）
    await vi.advanceTimersByTimeAsync(3500);
    await secondPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('次数上限：第 21 次搜索抛出 Rate limit exceeded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const fetchMock = vi.fn(async () =>
      mockResponse({
        body: '<div></div>',
        headers: { 'content-type': 'text/html' },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const service = new WebSearchService();
    const config = defaultConfig();

    // 执行 20 次搜索（每次 query 不同避免缓存，每次推进 3.5s 满足间隔）
    for (let i = 0; i < 20; i++) {
      const p = service.search(`q-${i}`, config, { maxResults: 5 });
      await vi.advanceTimersByTimeAsync(3500);
      await p;
    }
    expect(fetchMock).toHaveBeenCalledTimes(20);

    // 第 21 次应抛出 Rate limit exceeded
    await expect(
      service.search('q-21', config, { maxResults: 5 })
    ).rejects.toThrow(/Rate limit exceeded/);
  });

  it('resetRateLimit：重置后计数器归零，可继续搜索', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const fetchMock = vi.fn(async () =>
      mockResponse({
        body: '<div></div>',
        headers: { 'content-type': 'text/html' },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const service = new WebSearchService();
    const config = defaultConfig();

    // 执行 20 次搜索达上限
    for (let i = 0; i < 20; i++) {
      const p = service.search(`q-${i}`, config, { maxResults: 5 });
      await vi.advanceTimersByTimeAsync(3500);
      await p;
    }

    // 重置
    service.resetRateLimit();

    // 重置后第 21 次搜索应成功
    const p = service.search('q-after-reset', config, { maxResults: 5 });
    await vi.advanceTimersByTimeAsync(3500);
    await p;
    expect(fetchMock).toHaveBeenCalledTimes(21);
  });

  it('空 query 返回空数组，不计入速率限制也不调用 fetch', async () => {
    const fetchMock = vi.fn(async () => mockResponse({ body: '' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const service = new WebSearchService();
    const config = defaultConfig();

    const r1 = await service.search('', config);
    const r2 = await service.search('   ', config);

    expect(r1).toEqual([]);
    expect(r2).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ==================== WebSearchService — fetchUrl ====================

describe('WebSearchService — fetchUrl', () => {
  it('HTML 内容：提取正文（剥离标签、解码实体）', async () => {
    globalThis.fetch = vi.fn(async () =>
      mockResponse({
        body: '<html><body><script>x</script><p>Hello &amp; world</p></body></html>',
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    ) as unknown as typeof fetch;

    const service = new WebSearchService();
    const result = await service.fetchUrl('https://example.com/page');

    expect(result.success).toBe(true);
    expect(result.content).toContain('Hello & world');
    expect(result.content).not.toContain('<script>');
    expect(result.contentType).toContain('text/html');
  });

  it('JSON 内容：直接返回（截断到 maxLength）', async () => {
    const jsonData = { key: 'value', nested: { a: 1 } };
    globalThis.fetch = vi.fn(async () =>
      mockResponse({
        body: jsonData,
        headers: { 'content-type': 'application/json' },
      })
    ) as unknown as typeof fetch;

    const service = new WebSearchService();
    const result = await service.fetchUrl('https://api.example.com/data');

    expect(result.success).toBe(true);
    expect(result.content).toContain('"key":"value"');
    expect(result.contentType).toContain('application/json');
  });

  it('text/plain 内容：直接返回（截断）', async () => {
    globalThis.fetch = vi.fn(async () =>
      mockResponse({
        body: 'plain text content line1\nline2',
        headers: { 'content-type': 'text/plain' },
      })
    ) as unknown as typeof fetch;

    const service = new WebSearchService();
    const result = await service.fetchUrl('https://example.com/file.txt');

    expect(result.success).toBe(true);
    expect(result.content).toContain('plain text content');
  });

  it('非 200 状态：返回 success=false + HTTP 状态信息', async () => {
    globalThis.fetch = vi.fn(async () =>
      mockResponse({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        body: 'not found',
        headers: { 'content-type': 'text/html' },
      })
    ) as unknown as typeof fetch;

    const service = new WebSearchService();
    const result = await service.fetchUrl('https://example.com/missing');

    expect(result.success).toBe(false);
    expect(result.content).toContain('404');
    expect(result.content).toContain('Not Found');
  });

  it('网络错误：fetch reject 返回 success=false + 错误描述', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const service = new WebSearchService();
    const result = await service.fetchUrl('https://unreachable.example.com');

    expect(result.success).toBe(false);
    expect(result.content).toContain('ECONNREFUSED');
  });

  it('二进制内容：返回摘要（type + size），不解析正文', async () => {
    globalThis.fetch = vi.fn(async () =>
      mockResponse({
        body: 'BINARYDATA',
        headers: {
          'content-type': 'image/png',
          'content-length': '1024',
        },
      })
    ) as unknown as typeof fetch;

    const service = new WebSearchService();
    const result = await service.fetchUrl('https://example.com/img.png');

    expect(result.success).toBe(true);
    expect(result.content).toContain('image/png');
    expect(result.content).toContain('1024');
    expect(result.content).not.toContain('BINARYDATA'); // 不返回正文
  });

  it('超时：fetch 抛 AbortError 转为可读的超时错误信息', async () => {
    globalThis.fetch = vi.fn(async () => {
      const err = new Error('The user aborted a request.');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;

    const service = new WebSearchService();
    const result = await service.fetchUrl('https://slow.example.com', 4000, 5000);

    expect(result.success).toBe(false);
    expect(result.content).toContain('Fetch failed');
    expect(result.content).toContain('timed out');
  });
});

// ==================== WebSearchService — provider 错误降级 ====================

describe('WebSearchService — provider 错误降级', () => {
  it('provider 抛错时降级返回空数组，不向上抛出', async () => {
    // 模拟 TavilyProvider 缺 API key 抛错
    const service = new WebSearchService();
    const config = defaultConfig({
      provider: 'tavily',
      apiKey: '', // 缺 key → TavilyProvider 抛错
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const results = await service.search('test', config, { maxResults: 5 });

    expect(Array.isArray(results)).toBe(true);
    expect(results).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('未知 provider 名称抛出明确错误', async () => {
    const service = new WebSearchService();
    // @ts-expect-error 故意传入未知 provider
    const config = defaultConfig({ provider: 'unknown-provider' });

    // 未知 provider 会抛错被 catch 降级为空数组
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const results = await service.search('test', config, { maxResults: 5 });
    expect(results).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
