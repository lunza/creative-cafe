/**
 * SearXNG 搜索 Provider —— 自托管元搜索引擎（需实例 URL）
 *
 * 来源：spec: add-agent-web-search-tool §Requirement: 可插拔搜索 Provider
 *       Scenario: SearXNG 自托管搜索
 * 决策：调用 {endpoint}/search?q=QUERY&format=json GET 端点，解析 JSON 结果。
 *       SearXNG 聚合多个搜索引擎，需用户自建或使用公共实例。
 *
 * 实现要点：
 *  1. GET {endpoint}/search?q=QUERY&format=json（URL encode query）
 *  2. 响应: { results: [{ title, content, url }] }，content → snippet
 *  3. endpoint 缺失 → 抛出 `SearXNG endpoint URL is required`
 *  4. 超时控制（AbortController，默认 10s）
 *  5. 错误处理：网络错误 / 非 200（含错误正文）→ 抛出明确错误
 *  6. 后处理：allowedDomains 过滤 + maxResults 截断
 *
 * endpoint 形如 `http://localhost:8080`，尾部斜杠会被自动去除。
 */

import type { WebSearchProvider, SearchResult, SearchOptions } from './types';
import {
  fetchWithTimeout,
  postProcessResults,
  safeReadErrorBody,
  DEFAULT_USER_AGENT,
  DEFAULT_TIMEOUT_MS,
} from './providerUtils';

/** SearXNG JSON 响应结构（仅声明用到的字段） */
interface SearXngResponse {
  results?: Array<{
    title?: string;
    content?: string;
    url?: string;
  }>;
}

/**
 * SearXNG 搜索 provider（需实例 URL）。
 *
 * 用法：
 *   const provider = new SearXngProvider('http://localhost:8080');
 *   const results = await provider.search('hello world', { maxResults: 5 });
 */
export class SearXngProvider implements WebSearchProvider {
  readonly name = 'searxng';
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
    const trimmedEndpoint = (this.endpoint ?? '').trim().replace(/\/+$/, '');
    if (!trimmedEndpoint) {
      throw new Error('SearXNG endpoint URL is required');
    }

    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const url = `${trimmedEndpoint}/search?q=${encodeURIComponent(
      trimmedQuery
    )}&format=json`;

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
      throw new Error(`SearXNG search failed (network error): ${reason}`);
    }

    if (!response.ok) {
      const errBody = await safeReadErrorBody(response);
      throw new Error(
        `SearXNG search failed: HTTP ${response.status} ${response.statusText}` +
          (errBody ? ` — ${errBody}` : '')
      );
    }

    let data: SearXngResponse;
    try {
      data = (await response.json()) as SearXngResponse;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `SearXNG search failed: invalid JSON response (${reason})`
      );
    }

    const rawResults: SearchResult[] = (data.results ?? [])
      .map((r) => ({
        title: (r.title ?? '').trim(),
        snippet: (r.content ?? '').trim(),
        url: (r.url ?? '').trim(),
        source: 'searxng',
      }))
      .filter((r) => r.url.length > 0);

    return postProcessResults(rawResults, options);
  }
}

/**
 * 工厂函数：创建 SearXNG provider 实例。
 * @param endpoint SearXNG 实例 URL（如 `http://localhost:8080`）
 */
export function createSearXngProvider(
  endpoint: string = ''
): SearXngProvider {
  return new SearXngProvider(endpoint);
}
