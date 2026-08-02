/**
 * Web Search Providers 单元测试 —— Task 12 SubTask 12.1
 *
 * 来源：spec: add-agent-web-search-tool §Requirement: 可插拔搜索 Provider
 *
 * 覆盖 4 个 provider（≥16 用例）：
 *  - DuckDuckGo（5）：正常 / 空结果 / 网络错误 / 429 / maxResults 截断
 *  - Tavily（4）：正常 / 缺 API key / 401 / maxResults 传递
 *  - SearXNG（3）：正常 / 缺 endpoint / 网络错误
 *  - Custom（3）：正常 / URL 模板替换 / 缺 endpoint
 *  - providerUtils（4）：filterByAllowedDomains / truncateResults / decodeHtmlEntities / stripHtmlTags
 *
 * Mock 策略：
 *  - 全部测试 mock globalThis.fetch（vi.fn），不发真实 HTTP 请求
 *  - 保存原始 fetch，afterEach 恢复，保证测试隔离
 *  - 响应对象仿造 fetch Response（ok / status / statusText / json / text / headers）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DuckDuckGoProvider,
  createDuckDuckGoProvider,
} from '../duckDuckGoProvider';
import { TavilyProvider, createTavilyProvider } from '../tavilyProvider';
import { SearXngProvider, createSearXngProvider } from '../searxngProvider';
import { CustomProvider, createCustomProvider } from '../customProvider';
import {
  filterByAllowedDomains,
  truncateResults,
  decodeHtmlEntities,
  stripHtmlTags,
  postProcessResults,
} from '../providerUtils';
import type { SearchResult } from '../types';

// ==================== Mock 工具 ====================

const originalFetch = globalThis.fetch;

/** 构造 mock Response 对象（仿 fetch Response 接口） */
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

/** 构造一个标准 SearchResult */
function mkResult(title: string, url: string, snippet = ''): SearchResult {
  return { title, url, snippet, source: 'test' };
}

beforeEach(() => {
  // 每个测试默认 fetch 返回 200 空响应（被各 it 覆盖）
  globalThis.fetch = vi.fn(async () => mockResponse({ body: '' })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ==================== DuckDuckGo Provider ====================

describe('DuckDuckGoProvider', () => {
  it('正常搜索：从 DDG HTML 提取标题/摘要/URL，剥离 <b> 高亮标签', async () => {
    // 构造 DDG HTML 结果页（含 1 条结果，uddg 已 URL-encode 真实 URL）
    // 真实 URL = https://example.com/page1
    const ddgHtml = `
      <div class="result">
        <h2 class="result__title">
          <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1&amp;rut=abc" rel="nofollow">Example <b>Page</b></a>
        </h2>
        <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1">This is the <b>snippet</b> text</a>
      </div>
    `;
    globalThis.fetch = vi.fn(async () =>
      mockResponse({ body: ddgHtml, headers: { 'content-type': 'text/html' } })
    ) as unknown as typeof fetch;

    const provider = new DuckDuckGoProvider();
    const results = await provider.search('hello world', { maxResults: 5 });

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Example Page'); // 剥离 <b> 标签
    expect(results[0].snippet).toBe('This is the snippet text'); // 剥离 <b> 高亮
    expect(results[0].url).toBe('https://example.com/page1'); // 解析 uddg 真实 URL
    expect(results[0].source).toBe('duckduckgo');
    expect(results[0].url).not.toContain('duckduckgo.com');
  });

  it('空结果：DDG 返回无 result__title 的 HTML，返回空数组', async () => {
    const ddgHtml = `
      <html><body>
        <div class="no-results">No results found</div>
      </body></html>
    `;
    globalThis.fetch = vi.fn(async () =>
      mockResponse({ body: ddgHtml, headers: { 'content-type': 'text/html' } })
    ) as unknown as typeof fetch;

    const provider = new DuckDuckGoProvider();
    const results = await provider.search('rarequery12345', { maxResults: 5 });

    expect(results).toEqual([]);
  });

  it('网络错误：fetch reject 抛出含 provider 名 "DuckDuckGo" 的错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const provider = new DuckDuckGoProvider();
    await expect(
      provider.search('hello', { maxResults: 5 })
    ).rejects.toThrow(/DuckDuckGo/);
  });

  it('429 速率限制：fetch 返回 429，抛出含 "rate limited" 的明确错误', async () => {
    globalThis.fetch = vi.fn(async () =>
      mockResponse({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        body: 'rate limited',
      })
    ) as unknown as typeof fetch;

    const provider = new DuckDuckGoProvider();
    await expect(
      provider.search('hello', { maxResults: 5 })
    ).rejects.toThrow(/rate limited.*429|429.*rate limited/i);
  });

  it('maxResults 截断：DDG 返回 10 条，maxResults=3 → 返回 3 条', async () => {
    // 构造 10 条 DDG 结果
    const items: string[] = [];
    for (let i = 0; i < 10; i++) {
      const url = `https://example.com/page${i}`;
      items.push(`
        <div class="result">
          <h2 class="result__title">
            <a href="//duckduckgo.com/l/?uddg=${encodeURIComponent(url)}">Title ${i}</a>
          </h2>
          <a class="result__snippet">Snippet ${i}</a>
        </div>
      `);
    }
    globalThis.fetch = vi.fn(async () =>
      mockResponse({ body: items.join(''), headers: { 'content-type': 'text/html' } })
    ) as unknown as typeof fetch;

    const provider = new DuckDuckGoProvider();
    const results = await provider.search('hello', { maxResults: 3 });

    expect(results).toHaveLength(3);
    expect(results[0].title).toBe('Title 0');
    expect(results[2].title).toBe('Title 2');
  });

  it('空 query 返回空数组，不调用 fetch', async () => {
    const fetchMock = vi.fn(async () => mockResponse({ body: '' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new DuckDuckGoProvider();
    const r1 = await provider.search('', { maxResults: 5 });
    const r2 = await provider.search('   ', { maxResults: 5 });

    expect(r1).toEqual([]);
    expect(r2).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('createDuckDuckGoProvider 工厂创建独立实例', () => {
    const p1 = createDuckDuckGoProvider();
    const p2 = createDuckDuckGoProvider();
    expect(p1).toBeInstanceOf(DuckDuckGoProvider);
    expect(p2).toBeInstanceOf(DuckDuckGoProvider);
    expect(p1).not.toBe(p2);
    expect(p1.name).toBe('duckduckgo');
    expect(p1.requiresApiKey).toBe(false);
  });
});

// ==================== Tavily Provider ====================

describe('TavilyProvider', () => {
  it('正常搜索：从 Tavily JSON 映射 content→snippet', async () => {
    const tavilyJson = {
      results: [
        { title: 'Result 1', content: 'Content for 1', url: 'https://r1.com' },
        { title: 'Result 2', content: 'Content for 2', url: 'https://r2.com' },
      ],
    };
    globalThis.fetch = vi.fn(async () =>
      mockResponse({ body: tavilyJson, headers: { 'content-type': 'application/json' } })
    ) as unknown as typeof fetch;

    const provider = new TavilyProvider('tvly-test-key');
    const results = await provider.search('test query', { maxResults: 5 });

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Result 1');
    expect(results[0].snippet).toBe('Content for 1'); // content → snippet
    expect(results[0].url).toBe('https://r1.com');
    expect(results[0].source).toBe('tavily');
  });

  it('缺 API key：apiKey 为空字符串时抛出含 "API key" 的明确错误', async () => {
    const provider = new TavilyProvider('');
    await expect(
      provider.search('test', { maxResults: 5 })
    ).rejects.toThrow(/Tavily API key is required/);
  });

  it('API 错误：fetch 返回 401，抛出含状态码与正文的错误', async () => {
    globalThis.fetch = vi.fn(async () =>
      mockResponse({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        body: 'Invalid API key',
      })
    ) as unknown as typeof fetch;

    const provider = new TavilyProvider('bad-key');
    await expect(
      provider.search('test', { maxResults: 5 })
    ).rejects.toThrow(/401.*Invalid API key/s);
  });

  it('maxResults 传递：请求 body 中 max_results 字段为传入值', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      mockResponse({
        body: { results: [] },
        headers: { 'content-type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new TavilyProvider('tvly-test-key');
    await provider.search('test', { maxResults: 8 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0];
    const init = callArgs[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.max_results).toBe(8);
    expect(body.query).toBe('test');
    expect(body.api_key).toBe('tvly-test-key');
    expect(body.search_depth).toBe('advanced');
    expect(body.include_answer).toBe(false);
  });

  it('网络错误：fetch reject 抛出含 "Tavily" 的错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const provider = new TavilyProvider('tvly-test-key');
    await expect(
      provider.search('test', { maxResults: 5 })
    ).rejects.toThrow(/Tavily.*ECONNREFUSED/s);
  });

  it('URL 缺失的结果被过滤（url 字段为空）', async () => {
    const tavilyJson = {
      results: [
        { title: 'Has URL', content: 'c1', url: 'https://r1.com' },
        { title: 'No URL', content: 'c2', url: '' },
        { title: 'Undefined URL', content: 'c3' },
      ],
    };
    globalThis.fetch = vi.fn(async () =>
      mockResponse({ body: tavilyJson, headers: { 'content-type': 'application/json' } })
    ) as unknown as typeof fetch;

    const provider = new TavilyProvider('tvly-test-key');
    const results = await provider.search('test', { maxResults: 5 });

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Has URL');
  });
});

// ==================== SearXNG Provider ====================

describe('SearXngProvider', () => {
  it('正常搜索：从 SearXNG JSON 解析结果（content→snippet）', async () => {
    const searxngJson = {
      results: [
        { title: 'SearXNG Result', content: 'SearXNG snippet', url: 'https://sx.com/r1' },
      ],
    };
    globalThis.fetch = vi.fn(async () =>
      mockResponse({ body: searxngJson, headers: { 'content-type': 'application/json' } })
    ) as unknown as typeof fetch;

    const provider = new SearXngProvider('http://localhost:8080');
    const results = await provider.search('test', { maxResults: 5 });

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('SearXNG Result');
    expect(results[0].snippet).toBe('SearXNG snippet');
    expect(results[0].url).toBe('https://sx.com/r1');
    expect(results[0].source).toBe('searxng');
  });

  it('缺 endpoint：endpoint 为空时抛出 "SearXNG endpoint URL is required"', async () => {
    const provider = new SearXngProvider('');
    await expect(
      provider.search('test', { maxResults: 5 })
    ).rejects.toThrow(/SearXNG endpoint URL is required/);
  });

  it('网络错误：fetch reject 抛出含 "SearXNG" 的错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;

    const provider = new SearXngProvider('http://localhost:8080');
    await expect(
      provider.search('test', { maxResults: 5 })
    ).rejects.toThrow(/SearXNG.*connection refused/s);
  });

  it('endpoint 尾部斜杠被去除：URL 拼接为 {endpoint}/search?...', async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      mockResponse({
        body: { results: [] },
        headers: { 'content-type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new SearXngProvider('http://localhost:8080///');
    await provider.search('test', { maxResults: 5 });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe('http://localhost:8080/search?q=test&format=json');
    expect(calledUrl).not.toContain('///');
  });
});

// ==================== Custom Provider ====================

describe('CustomProvider', () => {
  it('正常搜索：从 { results: [...] } 结构解析，snippet 优先于 content', async () => {
    const customJson = {
      results: [
        { title: 'Custom 1', snippet: 'snippet-1', content: 'content-1', url: 'https://c1.com' },
        { title: 'Custom 2', content: 'content-only', url: 'https://c2.com' },
      ],
    };
    globalThis.fetch = vi.fn(async () =>
      mockResponse({ body: customJson, headers: { 'content-type': 'application/json' } })
    ) as unknown as typeof fetch;

    const provider = new CustomProvider('https://my-api.com/search?q={query}&limit={maxResults}');
    const results = await provider.search('hello', { maxResults: 5 });

    expect(results).toHaveLength(2);
    expect(results[0].snippet).toBe('snippet-1'); // snippet 优先
    expect(results[1].snippet).toBe('content-only'); // 缺 snippet 回退 content
    expect(results[0].source).toBe('custom');
  });

  it('URL 模板替换：{query} URL-encoded，{maxResults} 替换为数字字符串', async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      mockResponse({
        body: { results: [] },
        headers: { 'content-type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new CustomProvider('https://api.example.com/search?q={query}&limit={maxResults}');
    await provider.search('hello world & more', { maxResults: 7 });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    // {query} 应被 URL-encoded（空格→%20，&→%26）
    expect(calledUrl).toContain('q=hello%20world%20%26%20more');
    // {maxResults} 应被替换为 "7"
    expect(calledUrl).toContain('limit=7');
    // 不应残留占位符
    expect(calledUrl).not.toContain('{query}');
    expect(calledUrl).not.toContain('{maxResults}');
  });

  it('缺 endpoint：endpoint 为空时抛出 "Custom search endpoint URL is required"', async () => {
    const provider = new CustomProvider('');
    await expect(
      provider.search('test', { maxResults: 5 })
    ).rejects.toThrow(/Custom search endpoint URL is required/);
  });

  it('网络错误：fetch reject 抛出含 "Custom" 的错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('timeout');
    }) as unknown as typeof fetch;

    const provider = new CustomProvider('https://api.example.com/search?q={query}');
    await expect(
      provider.search('test', { maxResults: 5 })
    ).rejects.toThrow(/Custom.*timeout/s);
  });

  it('HTTP 错误：非 200 响应抛出含状态码与正文的错误', async () => {
    globalThis.fetch = vi.fn(async () =>
      mockResponse({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        body: 'server crashed',
      })
    ) as unknown as typeof fetch;

    const provider = new CustomProvider('https://api.example.com/search?q={query}');
    await expect(
      provider.search('test', { maxResults: 5 })
    ).rejects.toThrow(/500.*server crashed/s);
  });
});

// ==================== Provider 工厂函数 ====================

describe('Provider 工厂函数', () => {
  it('createTavilyProvider 创建实例并携带 apiKey', () => {
    const p = createTavilyProvider('my-key');
    expect(p).toBeInstanceOf(TavilyProvider);
    expect(p.name).toBe('tavily');
    expect(p.requiresApiKey).toBe(true);
  });

  it('createSearXngProvider 创建实例并携带 endpoint', () => {
    const p = createSearXngProvider('http://localhost:8080');
    expect(p).toBeInstanceOf(SearXngProvider);
    expect(p.name).toBe('searxng');
    expect(p.requiresApiKey).toBe(false);
  });

  it('createCustomProvider 创建实例', () => {
    const p = createCustomProvider('https://api.example.com');
    expect(p).toBeInstanceOf(CustomProvider);
    expect(p.name).toBe('custom');
  });
});

// ==================== providerUtils 工具函数 ====================

describe('providerUtils 工具函数', () => {
  describe('filterByAllowedDomains', () => {
    it('空 allowedDomains 返回原数组（不过滤）', () => {
      const results = [mkResult('a', 'https://a.com'), mkResult('b', 'https://b.com')];
      expect(filterByAllowedDomains(results)).toBe(results); // 同一引用
      expect(filterByAllowedDomains(results, [])).toEqual(results);
    });

    it('匹配域名与子域名，过滤其他', () => {
      const results = [
        mkResult('1', 'https://github.com/repo'),
        mkResult('2', 'https://api.github.com/endpoint'), // 子域名应通过
        mkResult('3', 'https://example.com/'), // 不在白名单
      ];
      const filtered = filterByAllowedDomains(results, ['github.com']);
      expect(filtered).toHaveLength(2);
      expect(filtered[0].url).toBe('https://github.com/repo');
      expect(filtered[1].url).toBe('https://api.github.com/endpoint');
    });

    it('白名单归一化：去前导点、转小写、trim', () => {
      const results = [
        mkResult('1', 'https://GitHub.COM/x'),
        mkResult('2', 'https://other.com/y'),
      ];
      const filtered = filterByAllowedDomains(results, ['  .GitHub.com  ']);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].url).toBe('https://GitHub.COM/x');
    });
  });

  describe('truncateResults', () => {
    it('maxResults 为正数时截断到指定长度', () => {
      const results = [1, 2, 3, 4, 5].map((i) => mkResult(`t${i}`, `https://r${i}.com`));
      const truncated = truncateResults(results, 3);
      expect(truncated).toHaveLength(3);
      expect(truncated[0].title).toBe('t1');
      expect(truncated[2].title).toBe('t3');
    });

    it('maxResults 为 undefined / 0 / 负数时返回原数组', () => {
      const results = [mkResult('a', 'https://a.com')];
      expect(truncateResults(results)).toBe(results);
      expect(truncateResults(results, 0)).toBe(results);
      expect(truncateResults(results, -1)).toBe(results);
    });
  });

  describe('decodeHtmlEntities', () => {
    it('解码命名实体 &amp; &lt; &gt; &quot; &apos; &nbsp;', () => {
      expect(decodeHtmlEntities('&amp;')).toBe('&');
      expect(decodeHtmlEntities('&lt;')).toBe('<');
      expect(decodeHtmlEntities('&gt;')).toBe('>');
      expect(decodeHtmlEntities('&quot;')).toBe('"');
      expect(decodeHtmlEntities('&apos;')).toBe("'");
      expect(decodeHtmlEntities('&nbsp;')).toBe('\u00A0');
    });

    it('解码数字实体 &#39; &#x27; 并忽略非法码点', () => {
      expect(decodeHtmlEntities('&#39;')).toBe("'");
      expect(decodeHtmlEntities('&#x27;')).toBe("'");
      // 非法码点（代理区）返回空串，不抛错
      expect(decodeHtmlEntities('&#xD800;')).toBe('');
    });

    it('未知名实体原样保留', () => {
      expect(decodeHtmlEntities('&unknownentity;')).toBe('&unknownentity;');
    });

    it('空字符串输入返回空', () => {
      expect(decodeHtmlEntities('')).toBe('');
    });
  });

  describe('stripHtmlTags', () => {
    it('剥离 HTML 标签，保留标签内文本', () => {
      expect(stripHtmlTags('<b>hello</b>')).toBe('hello');
      expect(stripHtmlTags('<a href="x">click</a>')).toBe('click');
      expect(stripHtmlTags('text <br/> more')).toBe('text  more');
    });

    it('无标签字符串原样返回', () => {
      expect(stripHtmlTags('plain text')).toBe('plain text');
    });
  });

  describe('postProcessResults', () => {
    it('先过滤再截断：保证白名单内结果不被截掉', () => {
      const results = [
        mkResult('1', 'https://allowed.com/1'),
        mkResult('2', 'https://other.com/2'),
        mkResult('3', 'https://allowed.com/3'),
        mkResult('4', 'https://allowed.com/4'),
      ];
      const out = postProcessResults(results, {
        maxResults: 2,
        allowedDomains: ['allowed.com'],
      });
      expect(out).toHaveLength(2);
      expect(out[0].url).toBe('https://allowed.com/1');
      expect(out[1].url).toBe('https://allowed.com/3');
    });
  });
});
