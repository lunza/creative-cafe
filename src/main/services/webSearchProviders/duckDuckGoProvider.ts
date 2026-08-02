/**
 * DuckDuckGo 搜索 Provider —— 零配置默认 provider
 *
 * 来源：spec: add-agent-web-search-tool §Requirement: 可插拔搜索 Provider
 *       Scenario: DuckDuckGo 零配置搜索
 * 决策：通过 DDG HTML 端点（https://html.duckduckgo.com/html/?q=QUERY）抓取，
 *       正则解析结果页（不引入 cheerio/jsdom 依赖），开箱即用，无需 API key。
 *
 * 实现要点：
 *  1. GET https://html.duckduckgo.com/html/?q=QUERY（URL encode query）
 *  2. 伪装 User-Agent（Chrome 120 桌面 UA）避免被拦截
 *  3. 正则解析：
 *     - class="result__title" 块内 <a> 标签的 href + 文本 → 标题
 *     - class="result__snippet" 块文本 → 摘要（可能含 <b> 高亮标签，剥离）
 *  4. href 是 DDG 重定向 URL（//duckduckgo.com/l/?uddg=ENCODED_URL），
 *     解析 uddg 参数获取真实 URL；DDG 内部链接无 uddg → 跳过
 *  5. 超时控制（AbortController，默认 10s）
 *  6. 错误处理：网络错误 / 429 速率限制 / 非 200 → 抛出明确错误
 *  7. 后处理：allowedDomains 过滤 + maxResults 截断
 *
 * 限制：DDG 受速率限制，适合低频使用（spec 已注明）。
 */

import type { WebSearchProvider, SearchResult, SearchOptions } from './types';
import {
  fetchWithTimeout,
  postProcessResults,
  decodeHtmlEntities,
  stripHtmlTags,
  DEFAULT_USER_AGENT,
  DEFAULT_TIMEOUT_MS,
} from './providerUtils';

const DDG_ENDPOINT = 'https://html.duckduckgo.com/html/';

/**
 * 提取 result__title 块内 <a> 标签的 href（group 1）与文本（group 2）。
 * 匹配 `<... class="result__title" ...> ... <a ... href="...">text</a>`。
 * 标题文本可能含 <b> 高亮，由 stripHtmlTags 后续清理。
 */
const TITLE_REGEX =
  /class="result__title"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

/**
 * 提取 result__snippet 块的文本内容（group 2）。
 * 用反向引用 \1 匹配开头标签的同名闭合标签，避免被内部 <b> 高亮标签的 </b> 误截。
 * group 1 = 包裹标签名（a / div / span）。
 */
const SNIPPET_REGEX =
  /<(a|div|span)\b[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/\1>/gi;

/**
 * DuckDuckGo 搜索 provider（零配置，默认）。
 *
 * 用法：
 *   const provider = new DuckDuckGoProvider();
 *   const results = await provider.search('hello world', { maxResults: 5 });
 */
export class DuckDuckGoProvider implements WebSearchProvider {
  readonly name = 'duckduckgo';
  readonly requiresApiKey = false;

  async search(
    query: string,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const trimmedQuery = query?.trim();
    if (!trimmedQuery) {
      return [];
    }

    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const url = `${DDG_ENDPOINT}?q=${encodeURIComponent(trimmedQuery)}`;

    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: {
            'User-Agent': DEFAULT_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        },
        timeoutMs
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`DuckDuckGo search failed (network error): ${reason}`);
    }

    if (response.status === 429) {
      throw new Error(
        'DuckDuckGo search failed: rate limited (429). Please retry later or switch to another provider.'
      );
    }
    if (!response.ok) {
      throw new Error(
        `DuckDuckGo search failed: HTTP ${response.status} ${response.statusText}`
      );
    }

    const html = await response.text();
    const rawResults = parseDuckDuckGoHtml(html);
    return postProcessResults(rawResults, options);
  }
}

/**
 * 解析 DuckDuckGo HTML 结果页，提取标题 / 摘要 / URL。
 *
 * 策略：分别用正则提取所有 result__title（href+文本）与 result__snippet（文本），
 * 按索引配对。若某条结果缺摘要，snippet 留空；缺真实 URL 则跳过该条。
 */
function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const titles = extractMatches(html, TITLE_REGEX, (m) => ({
    href: m[1] ?? '',
    text: m[2] ?? '',
  }));
  const snippets = extractMatches(html, SNIPPET_REGEX, (m) => m[2] ?? '');

  const results: SearchResult[] = [];
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    const realUrl = resolveDdgRedirectUrl(title.href);
    if (!realUrl) continue; // 无真实外部 URL（DDG 内部链接）→ 跳过
    const snippet = i < snippets.length ? snippets[i] : '';
    results.push({
      title: cleanHtmlText(title.text),
      snippet: cleanHtmlText(snippet),
      url: realUrl,
      source: 'duckduckgo',
    });
  }
  return results;
}

/** 通用全局正则匹配提取器（自动重置 lastIndex，防并发/复用状态污染） */
function extractMatches<T>(
  html: string,
  regex: RegExp,
  transform: (match: RegExpExecArray) => T
): T[] {
  const out: T[] = [];
  regex.lastIndex = 0; // 全局 regex 带 lastIndex，复用前必须重置
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    out.push(transform(m));
    // 防零宽匹配死循环
    if (m.index === regex.lastIndex) {
      regex.lastIndex++;
    }
  }
  return out;
}

/**
 * 解析 DDG 重定向 URL，提取真实目标 URL。
 *
 * href 形如 `//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F&amp;rut=...`：
 *  - 先 decode HTML 实体（&amp; → &）
 *  - 补全协议（// → https:）
 *  - 若 hostname 含 duckduckgo.com：取 uddg 参数（searchParams 自动 URL-decode）；
 *    无 uddg 的 DDG 内部链接 → 返回空（跳过）
 *  - 非 DDG 链接（少数直接外部 URL）→ 原样返回补全协议后的 URL
 *  - 解析失败 → 返回空
 */
function resolveDdgRedirectUrl(href: string): string {
  if (!href) return '';
  const decoded = decodeHtmlEntities(href);
  let normalized = decoded;
  if (normalized.startsWith('//')) {
    normalized = 'https:' + normalized;
  }
  // 须有协议前缀才能被 URL 解析
  if (!/^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    return '';
  }
  try {
    const u = new URL(normalized);
    if (u.hostname.includes('duckduckgo.com')) {
      const uddg = u.searchParams.get('uddg');
      return uddg ?? ''; // 无 uddg → 跳过 DDG 内部链接
    }
    return normalized; // 直接外部链接
  } catch {
    return '';
  }
}

/** 剥离 HTML 标签 + 解码实体 + 压缩空白（用于标题 / 摘要文本清理） */
function cleanHtmlText(raw: string): string {
  return decodeHtmlEntities(stripHtmlTags(raw))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 工厂函数：创建 DuckDuckGo provider 实例。
 * 零配置，无需参数。
 */
export function createDuckDuckGoProvider(): DuckDuckGoProvider {
  return new DuckDuckGoProvider();
}

/**
 * 默认单例（零配置 provider，可安全共享）。
 * WebSearchService 工厂可直接复用此实例。
 */
export const duckDuckGoProvider = new DuckDuckGoProvider();
