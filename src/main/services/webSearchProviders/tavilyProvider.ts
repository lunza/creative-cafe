/**
 * Tavily 搜索 Provider —— AI 优化的搜索 API（需 API key）
 *
 * 来源：spec: add-agent-web-search-tool §Requirement: 可插拔搜索 Provider
 *       Scenario: Tavily API 搜索
 * 决策：调用 https://api.tavily.com/search POST 端点，返回 AI 优化的搜索结果
 *       （content 字段比普通搜索引擎摘要更丰富）。
 *
 * 实现要点：
 *  1. POST https://api.tavily.com/search
 *  2. body: { query, api_key, max_results, search_depth: 'advanced',
 *            include_answer: false }
 *  3. 响应: { results: [{ title, content, url }] }，content → snippet
 *  4. API key 缺失 → 抛出 `Tavily API key is required. Configure it in
 *     Settings → Web Search.`
 *  5. 超时控制（AbortController，默认 10s）
 *  6. 错误处理：网络错误 / 非 200（含错误正文）→ 抛出明确错误
 *  7. 后处理：allowedDomains 过滤 + maxResults 截断
 */

import type { WebSearchProvider, SearchResult, SearchOptions } from './types';
import {
  fetchWithTimeout,
  postProcessResults,
  safeReadErrorBody,
  DEFAULT_USER_AGENT,
  DEFAULT_TIMEOUT_MS,
} from './providerUtils';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

/** Tavily API 响应结构（仅声明用到的字段） */
interface TavilyResponse {
  results?: Array<{
    title?: string;
    content?: string;
    url?: string;
  }>;
}

/**
 * Tavily 搜索 provider（需 API key）。
 *
 * 用法：
 *   const provider = new TavilyProvider('tvly-xxxx');
 *   const results = await provider.search('hello world', { maxResults: 5 });
 */
export class TavilyProvider implements WebSearchProvider {
  readonly name = 'tavily';
  readonly requiresApiKey = true;

  constructor(private readonly apiKey: string = '') {}

  async search(
    query: string,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const trimmedQuery = query?.trim();
    if (!trimmedQuery) {
      return [];
    }
    if (!this.apiKey || !this.apiKey.trim()) {
      throw new Error(
        'Tavily API key is required. Configure it in Settings → Web Search.'
      );
    }

    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const maxResults = options.maxResults ?? 5;
    const body = {
      query: trimmedQuery,
      api_key: this.apiKey,
      max_results: maxResults,
      search_depth: 'advanced' as const,
      include_answer: false,
    };

    let response: Response;
    try {
      response = await fetchWithTimeout(
        TAVILY_ENDPOINT,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': DEFAULT_USER_AGENT,
          },
          body: JSON.stringify(body),
        },
        timeoutMs
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Tavily search failed (network error): ${reason}`);
    }

    if (!response.ok) {
      const errBody = await safeReadErrorBody(response);
      throw new Error(
        `Tavily search failed: HTTP ${response.status} ${response.statusText}` +
          (errBody ? ` — ${errBody}` : '')
      );
    }

    let data: TavilyResponse;
    try {
      data = (await response.json()) as TavilyResponse;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Tavily search failed: invalid JSON response (${reason})`
      );
    }

    const rawResults: SearchResult[] = (data.results ?? [])
      .map((r) => ({
        title: (r.title ?? '').trim(),
        snippet: (r.content ?? '').trim(),
        url: (r.url ?? '').trim(),
        source: 'tavily',
      }))
      .filter((r) => r.url.length > 0);

    return postProcessResults(rawResults, options);
  }
}

/**
 * 工厂函数：创建 Tavily provider 实例。
 * @param apiKey Tavily API key（缺省时 search() 会抛出明确错误）
 */
export function createTavilyProvider(apiKey: string = ''): TavilyProvider {
  return new TavilyProvider(apiKey);
}
