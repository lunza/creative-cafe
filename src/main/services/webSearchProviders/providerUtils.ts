/**
 * Web Search Provider 共用工具
 *
 * 来源：spec: add-agent-web-search-tool §Requirement: 可插拔搜索 Provider
 * 决策：4 个 provider（DuckDuckGo / Tavily / SearXNG / Custom）复用超时 fetch /
 *       域名过滤 / 结果截断 / HTML 文本清洗 / 错误正文读取工具，避免重复实现，
 *       统一行为。
 *
 * 设计约束：
 *  - 不引入新依赖（fetch / AbortController / URL 均为运行时内置）
 *  - 纯函数 + 显式类型，禁用 any
 *  - tsconfig strict + noUnusedLocals + noUnusedParameters 已开启
 */

import type { SearchResult, SearchOptions } from './types';

/** 默认请求超时（ms） */
export const DEFAULT_TIMEOUT_MS = 10000;

/** 伪装 User-Agent（避免被搜索引擎拦截；Chrome 120 桌面 UA） */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 带超时的 fetch 封装（基于 AbortController）。
 *
 * @param url 请求 URL
 * @param options fetch 选项（signal 会被内部 controller 覆盖）
 * @param timeoutMs 超时毫秒，默认 10000
 * @returns fetch Response
 * @throws 超时抛 `Request timed out after Nms: URL`；其他 fetch 错误原样抛出
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    // AbortError → 转为可读的超时错误；其他网络错误原样上抛由调用方包装
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从 URL 提取 hostname（小写）。解析失败返回空串。
 */
export function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * 按 allowedDomains 白名单过滤结果。
 * - allowedDomains 为空 / undefined → 原样返回（不过滤）
 * - 匹配规则：结果 URL 的 hostname 等于白名单域名，或为其子域名
 *   （如白名单含 `github.com`，则 `api.github.com` 也通过）
 *
 * 域名匹配前做归一化：去前后空白、转小写、去前导点。
 */
export function filterByAllowedDomains(
  results: SearchResult[],
  allowedDomains?: string[]
): SearchResult[] {
  if (!allowedDomains || allowedDomains.length === 0) {
    return results;
  }
  const normalized = allowedDomains
    .map((d) => d.toLowerCase().trim().replace(/^\./, ''))
    .filter((d) => d.length > 0);
  if (normalized.length === 0) {
    return results;
  }
  return results.filter((r) => {
    const host = extractHostname(r.url);
    if (!host) return false;
    return normalized.some((d) => host === d || host.endsWith('.' + d));
  });
}

/**
 * 截断结果数组到 maxResults 条。
 * maxResults 为 undefined / 非正数时返回原数组（不截断）。
 */
export function truncateResults(
  results: SearchResult[],
  maxResults?: number
): SearchResult[] {
  if (!maxResults || maxResults <= 0) {
    return results;
  }
  return results.slice(0, maxResults);
}

/**
 * 后处理：域名过滤 → 截断（4 个 provider 共用流程）。
 * 顺序：先过滤（剔除不匹配域名），再截断（保证白名单内结果不被截掉）。
 */
export function postProcessResults(
  results: SearchResult[],
  options: SearchOptions
): SearchResult[] {
  const filtered = filterByAllowedDomains(results, options.allowedDomains);
  return truncateResults(filtered, options.maxResults);
}

/**
 * 安全读取响应错误正文（用于构造可读错误信息）。
 * 最多读 300 字符（超出追加 `...`），读取失败返回空串。
 *
 * 注意：调用后 body 已被消费，仅可在错误路径（!response.ok）使用，
 * 不可在成功路径再调用 response.json()/text()。
 */
export async function safeReadErrorBody(response: Response): Promise<string> {
  try {
    const t = await response.text();
    return t.length > 300 ? t.slice(0, 300) + '...' : t;
  } catch {
    return '';
  }
}

/**
 * 剥离 HTML 标签（保留标签内文本）。
 * 用于 DuckDuckGo HTML 结果解析（标题 / 摘要可能含 <b> 高亮标签）。
 */
export function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * 解码常见 HTML 实体。
 * 覆盖：&amp; &lt; &gt; &quot; &apos; &nbsp; 以及 &#NN; / &#xNN; 数字实体。
 * 未知名实体原样保留（避免误改）。
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return text;
  const entityMap: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00A0',
  };
  return text
    .replace(/&#(\d+);/g, (_full, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_full, hex) =>
      safeFromCodePoint(parseInt(hex, 16))
    )
    .replace(/&([a-zA-Z]+);/g, (full, name) => {
      const mapped = entityMap[name];
      return mapped !== undefined ? mapped : full;
    });
}

/**
 * 将码点转为字符；非法码点（非有限 / 负 / 超平面 / 代理区）返回空串避免抛错。
 */
function safeFromCodePoint(code: number): string {
  if (
    !Number.isFinite(code) ||
    code < 0 ||
    code > 0x10ffff ||
    (code >= 0xd800 && code <= 0xdfff)
  ) {
    return '';
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}
