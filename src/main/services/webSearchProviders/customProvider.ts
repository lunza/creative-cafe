/**
 * Custom 搜索 Provider —— 用户自定义 HTTP 端点
 *
 * 来源：spec: add-agent-web-search-tool §Requirement: 可插拔搜索 Provider
 *       Scenario: 自定义 provider
 * 决策：按用户配置的 endpoint URL 模板发 GET 请求，对接任意兼容搜索 API。
 *
 * 实现要点：
 *  1. endpoint 为完整 URL 模板，含 {query} 与 {maxResults} 占位符
 *     （如 `https://my-search-api.com/search?q={query}&limit={maxResults}`）
 *  2. GET 请求：{query} → URL-encoded query；{maxResults} → 数字字符串
 *  3. 响应期望: `{ results: [{ title, snippet, url }] }` 结构；
 *     兼容 content 字段（snippet 优先，缺省回退 content）
 *  4. endpoint 缺失 → 抛出 `Custom search endpoint URL is required`
 *  5. 超时控制（AbortController，默认 10s）
 *  6. 错误处理：网络错误 / 非 200（含错误正文）→ 抛出明确错误
 *  7. 后处理：allowedDomains 过滤 + maxResults 截断
 *
 * 设计说明：requiresApiKey = false（API key 由用户在 endpoint URL 中自行处理，
 *           如 `https://api.example.com/search?key=MYKEY&q={query}`）。
 */

import type { WebSearchProvider, SearchResult, SearchOptions } from './types';
import {
  fetchWithTimeout,
  postProcessResults,
  safeReadErrorBody,
  DEFAULT_USER_AGENT,
  DEFAULT_TIMEOUT_MS,
} from './providerUtils';

/** Custom provider 响应结构（同时兼容 snippet / content 字段） */
interface CustomResponse {
  results?: Array<{
    title?: string;
    snippet?: string;
    content?: string;
    url?: string;
  }>;
}

/**
 * Custom 搜索 provider（自定义端点）。
 *
 * 用法：
 *   const provider = new CustomProvider('https://api.example.com/search?q={query}&limit={maxResults}');
 *   const results = await provider.search('hello world', { maxResults: 5 });
 */
export class CustomProvider implements WebSearchProvider {
  readonly name = 'custom';
  readonly requiresApiKey = false;

  constructor(private readonly endpoint: string = '') {}

  async search(
    query: string,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const trimmedQuery = query?.trim();
    if (!trimmedQuery) {
      return [];
    }
    const trimmedEndpoint = (this.endpoint ?? '').trim();
    if (!trimmedEndpoint) {
      throw new Error('Custom search endpoint URL is required');
    }

    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const maxResults = options.maxResults ?? 5;
    // 替换占位符：{query} → URL-encoded query；{maxResults} → 数字
    const url = trimmedEndpoint
      .replace(/\{query\}/g, encodeURIComponent(trimmedQuery))
      .replace(/\{maxResults\}/g, String(maxResults));

    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': DEFAULT_USER_AGENT,
          },
        },
        timeoutMs
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Custom search failed (network error): ${reason}`);
    }

    if (!response.ok) {
      const errBody = await safeReadErrorBody(response);
      throw new Error(
        `Custom search failed: HTTP ${response.status} ${response.statusText}` +
          (errBody ? ` — ${errBody}` : '')
      );
    }

    let data: CustomResponse;
    try {
      data = (await response.json()) as CustomResponse;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Custom search failed: invalid JSON response (${reason})`
      );
    }

    const rawResults: SearchResult[] = (data.results ?? [])
      .map((r) => ({
        title: (r.title ?? '').trim(),
        snippet: (r.snippet ?? r.content ?? '').trim(),
        url: (r.url ?? '').trim(),
        source: 'custom',
      }))
      .filter((r) => r.url.length > 0);

    return postProcessResults(rawResults, options);
  }
}

/**
 * 工厂函数：创建 Custom provider 实例。
 * @param endpoint 完整 URL 模板（含 {query} / {maxResults} 占位符）
 */
export function createCustomProvider(
  endpoint: string = ''
): CustomProvider {
  return new CustomProvider(endpoint);
}
