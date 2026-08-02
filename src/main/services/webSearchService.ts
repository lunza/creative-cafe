/**
 * WebSearchService — 网络搜索服务（provider 工厂 + 缓存 + 速率限制 + fetchUrl）
 *
 * 来源：spec: add-agent-web-search-tool
 *       §Requirement: HTML 正文提取
 *       §Requirement: 搜索结果缓存与速率限制
 * 决策：作为独立服务模块（不依赖 agent 模块），被 webSearch/fetchUrl 工具（Task 6）
 *       与世界书编写智能体（Task 10）复用。provider 工厂按 config 动态创建实例，
 *       避免在调用方硬编码 provider 选择逻辑。
 *
 * 职责：
 *  1. HtmlTextExtractor：HTML → 纯文本（剥离 script/style/nav 等，解码实体，截断）
 *  2. WebSearchService：
 *     - provider 工厂（按 config 动态创建 DuckDuckGo / Tavily / SearXNG / Custom）
 *     - LRU 缓存（query+provider 维度，TTL 5 分钟，容量 100）
 *     - 速率限制（min 3s 间隔，单次运行上限 20 次）
 *     - fetchUrl（按 Content-Type 分流：HTML 提取 / JSON 直返 / 二进制摘要）
 *
 * 设计约束：
 *  - 不引入新依赖（内置 fetch + 正则，不引入 readability/cheerio/jsdom）
 *  - 复用 providerUtils 的 fetchWithTimeout / decodeHtmlEntities / stripHtmlTags / DEFAULT_USER_AGENT
 *  - 禁用 any，所有方法签名明确（tsconfig strict + noUnusedLocals + noUnusedParameters）
 *  - 错误不中断：fetchUrl 捕获所有错误返回 { success: false }；
 *    search 对速率限制 / 配置错误抛出明确错误（调用方 try/catch），
 *    provider 网络错误捕获后 console.warn 并返回 []（降级，不阻断）
 */

import type {
  WebSearchProvider,
  SearchResult,
  SearchOptions,
  WebSearchConfig,
} from './webSearchProviders';

import {
  fetchWithTimeout,
  decodeHtmlEntities,
  stripHtmlTags,
  DEFAULT_USER_AGENT,
  DEFAULT_TIMEOUT_MS,
  DuckDuckGoProvider,
  TavilyProvider,
  SearXngProvider,
  CustomProvider,
} from './webSearchProviders';

// ==================== 常量 ====================

/** 默认正文提取最大长度（字符） */
const DEFAULT_MAX_LENGTH = 4000;

/** 缓存 TTL（5 分钟 = 300000ms） */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** 缓存容量上限（LRU 超出时删最旧） */
const CACHE_CAPACITY = 100;

/** 速率限制：最小搜索间隔（ms） */
const MIN_SEARCH_INTERVAL_MS = 3000;

/** 速率限制：单次运行最大搜索次数 */
const MAX_SEARCHES_PER_RUN = 20;

// ==================== 辅助类型 ====================

/** 缓存条目（含结果与写入时间戳） */
interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
}

/** fetchUrl 返回结果 */
export interface FetchUrlResult {
  /** 是否成功（HTTP 200 且成功读取/提取正文） */
  success: boolean;
  /** 正文文本或错误描述 */
  content: string;
  /** 响应 Content-Type（小写，含 charset） */
  contentType?: string;
}

// ==================== 辅助函数 ====================

/** Promise 延时（速率限制等待用） */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 截断文本到 maxLength，超出则末尾追加 \n...[truncated] */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '\n...[truncated]';
}

// ==================== HtmlTextExtractor ====================

/**
 * HTML 正文提取器。
 *
 * 将 HTML 转换为纯文本，处理流程：
 *  1. 移除 HTML 注释 `<!-- ... -->`
 *  2. 剥离 script / style / nav / header / footer / noscript / svg 标签及其内容
 *  3. 在块级元素闭合标签（</p> / </div> / <br> 等）位置插入换行（保留段落结构）
 *  4. 剥离所有剩余 HTML 标签（复用 stripHtmlTags）
 *  5. 解码 HTML 实体（复用 decodeHtmlEntities）
 *  6. 压缩连续水平空白为单个空格，逐行 trim，3+ 换行合并为 2
 *  7. 截断到 maxLength，超出追加 \n...[truncated]
 *
 * 限制：基于正则，无法处理嵌套同名标签（如 <div><div></div></div>），
 *       但对 script/style/nav 等无需处理嵌套，实际效果足够。
 */
export class HtmlTextExtractor {
  /** HTML 注释（非贪婪匹配到 -->） */
  private static readonly COMMENT_REGEX = /<!--[\s\S]*?-->/g;

  /**
   * 需要整段移除的标签（含内容）。
   * 反向引用 \1 确保开闭标签同名；i 标志大小写不敏感。
   * 非贪婪 [\s\S]*? 避免跨多个同名标签误匹配。
   */
  private static readonly STRIP_TAGS_REGEX =
    /<(script|style|nav|header|footer|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

  /** 自闭合块级标签（<br> / <hr>，含 <br/> / <hr />）→ 替换为换行 */
  private static readonly SELF_CLOSING_BLOCK_REGEX = /<(?:br|hr)\b[^>]*>/gi;

  /** 块级元素闭合标签（</p> / </div> / </li> / </h1-6> 等）→ 替换为换行 */
  private static readonly CLOSING_BLOCK_REGEX =
    /<\/(?:p|div|li|h[1-6]|tr|ul|ol|table|section|article|blockquote|pre|figure|figcaption|dl|dt|dd)\s*>/gi;

  /** 连续水平空白（含不间断空格 \u00A0）→ 单个空格 */
  private static readonly MULTI_SPACE_REGEX = /[ \t\u00A0]+/g;

  /** 3+ 连续换行 → 2 个换行（段落间距） */
  private static readonly MULTI_NEWLINE_REGEX = /\n{3,}/g;

  /**
   * 从 HTML 提取纯文本。
   *
   * @param html HTML 字符串
   * @param maxLength 最大长度（默认 4000），超出追加 \n...[truncated]
   * @returns 纯文本字符串；非字符串/空输入返回空串
   */
  extract(html: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
    // 边界：非字符串或空串 → 返回空
    if (typeof html !== 'string' || html.length === 0) {
      return '';
    }

    let text = html;

    // 1. 移除 HTML 注释（须在标签剥离前，避免注释内 > 干扰标签正则）
    text = text.replace(HtmlTextExtractor.COMMENT_REGEX, '');

    // 2. 移除 script / style / nav / header / footer / noscript / svg 标签及其内容
    text = text.replace(HtmlTextExtractor.STRIP_TAGS_REGEX, '');

    // 3. 在块级元素位置插入换行（保留段落结构，须在通用标签剥离前）
    text = text.replace(HtmlTextExtractor.SELF_CLOSING_BLOCK_REGEX, '\n');
    text = text.replace(HtmlTextExtractor.CLOSING_BLOCK_REGEX, '\n');

    // 4. 剥离所有剩余 HTML 标签（复用 providerUtils.stripHtmlTags）
    text = stripHtmlTags(text);

    // 5. 解码 HTML 实体（复用 providerUtils.decodeHtmlEntities）
    text = decodeHtmlEntities(text);

    // 6. 压缩空白：水平空白合并为单空格，逐行 trim，多余换行合并为段落
    text = text
      .replace(HtmlTextExtractor.MULTI_SPACE_REGEX, ' ')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace(HtmlTextExtractor.MULTI_NEWLINE_REGEX, '\n\n')
      .trim();

    // 7. 截断到 maxLength
    return truncateText(text, maxLength);
  }
}

/**
 * 便捷函数：从 HTML 提取纯文本。
 * 等价于 `new HtmlTextExtractor().extract(html, maxLength)`。
 */
export function extractTextFromHtml(
  html: string,
  maxLength?: number
): string {
  return new HtmlTextExtractor().extract(html, maxLength);
}

// ==================== WebSearchService ====================

/**
 * 网络搜索服务。
 *
 * 职责：
 *  - 按 config 动态创建 provider（工厂模式，调用方无需关心 provider 选择）
 *  - 搜索结果 LRU 缓存（TTL 5 分钟，容量 100，query+provider+maxResults 维度）
 *  - 速率限制（min 3s 间隔，单次运行上限 20 次，resetRateLimit 重置）
 *  - fetchUrl 抓取网页正文（按 Content-Type 分流处理）
 *
 * 用法：
 *   const results = await webSearchService.search('hello', config, { maxResults: 5 });
 *   const page = await webSearchService.fetchUrl('https://example.com');
 */
export class WebSearchService {
  /** LRU 缓存（Map 保持插入顺序，首项为最旧，末项为最新） */
  private readonly cache = new Map<string, CacheEntry>();

  /** 上次搜索时间戳（用于间隔速率限制，0 表示尚未搜索） */
  private lastSearchTime = 0;

  /** 当前运行搜索次数计数器（resetRateLimit 重置） */
  private searchCount = 0;

  /** 上次配置指纹（provider+apiKey+endpoint，变化时清空缓存） */
  private lastConfigFingerprint = '';

  /** HTML 提取器实例（无状态，复用） */
  private readonly htmlExtractor = new HtmlTextExtractor();

  // -------------------- Provider 工厂 --------------------

  /**
   * 按 config.provider 动态创建 provider 实例。
   *
   * @param config 搜索配置（取 provider / apiKey / endpoint 字段）
   * @returns 对应 provider 实例
   * @throws 未知 provider 名称时抛出错误（配置错误，调用方应捕获）
   */
  private createProvider(config: WebSearchConfig): WebSearchProvider {
    switch (config.provider) {
      case 'duckduckgo':
        return new DuckDuckGoProvider();
      case 'tavily':
        return new TavilyProvider(config.apiKey);
      case 'searxng':
        return new SearXngProvider(config.endpoint);
      case 'custom':
        return new CustomProvider(config.endpoint);
      default:
        // 穷尽性检查：若未来新增 provider 未处理，此处会在编译期报错
        throw new Error(`Unknown web search provider: ${String(config.provider)}`);
    }
  }

  /**
   * 计算 config 指纹（provider + apiKey + endpoint）。
   * 任意字段变化 → 指纹变化 → 触发缓存清空。
   */
  private configFingerprint(config: WebSearchConfig): string {
    return `${config.provider}::${config.apiKey}::${config.endpoint}`;
  }

  // -------------------- 搜索（带缓存 + 速率限制） --------------------

  /**
   * 执行搜索（带缓存与速率限制）。
   *
   * 流程：
   *  1. 配置指纹变更 → 清空缓存
   *  2. 缓存命中 → 直接返回（不调用 provider，不计入速率限制）
   *  3. 速率限制检查：次数超限 → 抛错；间隔不足 → 等待
   *  4. 调用 provider.search
   *  5. provider 失败 → console.warn + 返回 []（降级，不抛错）
   *  6. 成功 → 缓存结果并返回
   *
   * @param query 搜索关键词
   * @param config 搜索配置（决定 provider / apiKey / endpoint）
   * @param options 搜索选项（覆盖 config 默认值；undefined 时用 config 默认）
   * @returns 搜索结果数组（空查询或 provider 失败时返回 []）
   * @throws 速率限制超限 / 未知 provider 时抛出明确错误
   *
   * 注意：调用方应对速率限制错误 try/catch 降级处理
   *      （spec: 搜索失败不阻断编写流程）。provider 网络错误已在本方法内
   *       降级为返回 []，不会抛出。
   */
  async search(
    query: string,
    config: WebSearchConfig,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    const trimmedQuery = query?.trim();
    if (!trimmedQuery) {
      return [];
    }

    // 配置变更 → 清空缓存（apiKey/endpoint 变化后旧缓存无效）
    const fp = this.configFingerprint(config);
    if (fp !== this.lastConfigFingerprint) {
      this.clearCache();
      this.lastConfigFingerprint = fp;
    }

    // 合并选项（options 覆盖 config 默认值）
    const mergedOptions: SearchOptions = {
      maxResults: options?.maxResults ?? config.maxResults,
      allowedDomains: options?.allowedDomains ?? config.allowedDomains,
      timeout: options?.timeout ?? config.timeout,
    };

    // 缓存命中 → 直接返回（不计入速率限制，不更新 lastSearchTime）
    const cacheKey = this.buildCacheKey(trimmedQuery, config, mergedOptions);
    const cached = this.cacheGet(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // 速率限制：单次运行次数上限
    if (this.searchCount >= MAX_SEARCHES_PER_RUN) {
      throw new Error(
        `Rate limit exceeded: max ${MAX_SEARCHES_PER_RUN} searches per run`
      );
    }

    // 速率限制：最小搜索间隔（距上次搜索 < 3s 则等待）
    if (this.lastSearchTime > 0) {
      const elapsed = Date.now() - this.lastSearchTime;
      if (elapsed < MIN_SEARCH_INTERVAL_MS) {
        await sleep(MIN_SEARCH_INTERVAL_MS - elapsed);
      }
    }

    // 计数 + 记录时间戳（在调用 provider 前更新，防止并发绕过限制；
    // 即使 provider 失败也计数，避免失败重试刷量）
    this.searchCount++;
    this.lastSearchTime = Date.now();

    // 调用 provider
    let results: SearchResult[];
    try {
      const provider = this.createProvider(config);
      results = await provider.search(trimmedQuery, mergedOptions);
    } catch (error) {
      // provider 错误：记录警告并返回空结果（降级，不抛错，不缓存）
      // 调用方见空结果可继续无搜索上下文生成（spec: 搜索失败不阻断编写流程）
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `WebSearchService.search failed (provider=${config.provider}, query="${trimmedQuery}"): ${reason}`
      );
      return [];
    }

    // 缓存成功结果（空结果也缓存，避免相同查询反复请求）
    this.cacheSet(cacheKey, results);

    return results;
  }

  /**
   * 构建缓存 key。
   *
   * 格式：`{query}::{provider}::{maxResults}`
   * - query + provider：spec 要求的隔离维度
   * - maxResults：不同结果数需隔离（provider 内部已按 maxResults 截断，
   *   缓存的结果无法再扩展到更大 maxResults）
   *
   * allowedDomains 不计入 key：通常由 config 配置，config 变更已通过指纹清空缓存；
   * options 中临时传入的 allowedDomains 罕见，且影响有限。
   */
  private buildCacheKey(
    query: string,
    config: WebSearchConfig,
    options: SearchOptions
  ): string {
    const maxResults = options.maxResults ?? config.maxResults;
    return `${query}::${config.provider}::${maxResults}`;
  }

  /**
   * 缓存读取（含 TTL 过期检查 + LRU 移至末尾）。
   * @returns 命中返回结果数组，未命中/过期返回 undefined
   */
  private cacheGet(key: string): SearchResult[] | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // TTL 过期 → 删除并返回 miss
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }

    // LRU：删除再插入，移至末尾（最近使用）
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.results;
  }

  /**
   * 缓存写入（超容量时删除最旧条目）。
   * 已存在的 key 更新时直接覆盖（Map.set 行为），不算新增。
   */
  private cacheSet(key: string, results: SearchResult[]): void {
    // 容量上限 → 删除最旧（Map 首项）；仅当 key 不存在时才需驱逐
    if (this.cache.size >= CACHE_CAPACITY && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, { results, timestamp: Date.now() });
  }

  // -------------------- fetchUrl --------------------

  /**
   * 抓取 URL 正文。
   *
   * 按 Content-Type 分流处理：
   *  - text/html / application/xhtml+xml → HtmlTextExtractor 提取正文
   *  - application/json → 直接返回（截断到 maxLength）
   *  - text/* → 直接返回（截断到 maxLength）
   *  - 空 Content-Type → 假定为 HTML，提取正文（网页抓取场景最常见）
   *  - application/xml / rss+xml / atom+xml → 当作文本直接返回
   *  - 其他（image/* / audio/* / video/* / application/pdf / octet-stream 等）
   *    → 返回二进制摘要，不尝试解析
   *
   * 请求头：User-Agent: DEFAULT_USER_AGENT
   * 错误处理：网络错误 / 非 200 → 返回 { success: false, content: 错误描述 }
   *
   * @param url 目标 URL
   * @param maxLength 正文最大长度（默认 4000）
   * @param timeout 超时 ms（默认 10000）
   */
  async fetchUrl(
    url: string,
    maxLength: number = DEFAULT_MAX_LENGTH,
    timeout?: number
  ): Promise<FetchUrlResult> {
    const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;

    // 抓取 URL
    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: {
            'User-Agent': DEFAULT_USER_AGENT,
            Accept: '*/*',
          },
        },
        timeoutMs
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`WebSearchService.fetchUrl failed (${url}): ${reason}`);
      return { success: false, content: `Fetch failed: ${reason}` };
    }

    // 非 200 状态码
    if (!response.ok) {
      return {
        success: false,
        content: `HTTP ${response.status} ${response.statusText}`,
        contentType: response.headers.get('content-type') ?? undefined,
      };
    }

    const contentType = (
      response.headers.get('content-type') ?? ''
    ).toLowerCase();
    const ctMain = contentType.split(';')[0].trim();

    // HTML / XHTML → 提取正文
    if (ctMain === 'text/html' || ctMain === 'application/xhtml+xml') {
      try {
        const html = await response.text();
        const text = this.htmlExtractor.extract(html, maxLength);
        return { success: true, content: text, contentType };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          content: `HTML extraction failed: ${reason}`,
        };
      }
    }

    // JSON → 直接返回（截断）
    if (ctMain === 'application/json') {
      try {
        const text = await response.text();
        return {
          success: true,
          content: truncateText(text, maxLength),
          contentType,
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { success: false, content: `Read failed: ${reason}` };
      }
    }

    // text/* （text/plain / text/xml / text/css 等）→ 直接返回（截断）
    if (ctMain.startsWith('text/')) {
      try {
        const text = await response.text();
        return {
          success: true,
          content: truncateText(text, maxLength),
          contentType,
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { success: false, content: `Read failed: ${reason}` };
      }
    }

    // 空 Content-Type → 假定为 HTML（网页抓取场景最常见）
    if (!ctMain) {
      try {
        const html = await response.text();
        const text = this.htmlExtractor.extract(html, maxLength);
        return {
          success: true,
          content: text,
          contentType: contentType || undefined,
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          content: `HTML extraction failed: ${reason}`,
        };
      }
    }

    // XML 类（application/xml / rss+xml / atom+xml）→ 当作文本
    if (ctMain.includes('xml')) {
      try {
        const text = await response.text();
        return {
          success: true,
          content: truncateText(text, maxLength),
          contentType,
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { success: false, content: `Read failed: ${reason}` };
      }
    }

    // 二进制内容（image/* / audio/* / video/* / application/pdf / octet-stream 等）
    const contentLength = response.headers.get('content-length');
    const size = contentLength ? parseInt(contentLength, 10) || 0 : 0;
    return {
      success: true,
      content: `Binary content, type: ${ctMain}, size: ${size} bytes`,
      contentType,
    };
  }

  // -------------------- 缓存 / 速率限制管理 --------------------

  /** 清空搜索结果缓存（配置变更 / 测试时调用） */
  clearCache(): void {
    this.cache.clear();
  }

  /** 重置速率限制计数器与时间戳（新 agent 运行开始时调用） */
  resetRateLimit(): void {
    this.searchCount = 0;
    this.lastSearchTime = 0;
  }
}

// ==================== 单例导出 ====================

/** WebSearchService 单例（主进程共享，工具执行器与编写智能体复用） */
export const webSearchService = new WebSearchService();