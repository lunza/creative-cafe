/**
 * 网络搜索组工具 —— webSearch + fetchUrl
 *
 * 来源：spec: add-agent-web-search-tool §Requirement: 网络搜索工具
 *       tasks.md Task 6（工具描述符 + 执行器）/ Task 7（agentHandlers 注册）
 * 决策：自研（spec §三无对应 openclaw 文件）。复用 Task 5 实现的 WebSearchService
 *       单例（provider 工厂 + 缓存 + 速率限制 + HtmlTextExtractor），
 *       通过 IWebSearchToolServices 接口注入，保持工具代码低耦合。
 *
 * 两个工具：
 *  1. webSearch  —— 执行网络搜索（关键词 → SearchResult[]，返回标题/摘要/URL/来源）
 *  2. fetchUrl   —— 抓取指定 URL 的网页正文（剥离 HTML 标签，返回纯文本）
 *
 * 设计约束（对标 worldbookTools.ts 模式）：
 *  - 工具描述是 prompt：description 清晰说明参数格式与返回值，模型可见
 *  - 可用性 gating：allOf[capability:supportsToolCalling, config:webSearch.enabled]
 *    （模型必须支持工具调用 + 用户必须在设置中启用网络搜索）
 *  - 闭环返回：执行结果回灌给 LLM，让模型基于搜索/抓取结果继续决策
 *  - 降级保护：工具失败不中断 agentLoop，转为 ToolExecutionResult（continueLoop: true
 *    让智能体可基于错误调整策略，如换关键词重搜或换 URL 重抓）
 */

import type { ToolDescriptor } from '../types';
import type { ToolCallContext, ToolExecutionResult } from '../../contracts';
import type { ToolExecutor } from '../toolRegistry';
import type {
  SearchResult,
  SearchOptions,
  WebSearchConfig,
} from '../../../webSearchProviders';

// ==================== 服务接口（依赖注入） ====================

/**
 * 网络搜索组工具依赖的服务接口。
 *
 * 由调用方（agentHandlers）注入实际实现，工具代码不直接 import webSearchService，
 * 保持低耦合（与 dialogueTools 的 IDialogueToolServices / worldbookTools 的
 * IWorldbookToolServices 模式一致）。
 *
 * 实现方（createWebSearchToolServices）桥接 webSearchService 单例 +
 * settingService（读取 webSearch 配置块）。
 */
export interface IWebSearchToolServices {
  /**
   * 执行网络搜索。
   * @param query 搜索关键词
   * @param config 搜索配置（决定 provider / apiKey / endpoint 等）
   * @param options 搜索选项（maxResults / allowedDomains / timeout）
   * @returns 搜索结果数组（空查询或 provider 失败时返回 []；速率限制超限抛错）
   */
  search(
    query: string,
    config: WebSearchConfig,
    options?: SearchOptions
  ): Promise<SearchResult[]>;

  /**
   * 抓取 URL 正文。
   * @param url 目标 URL
   * @param maxLength 正文最大长度（字符，默认 4000）
   * @param timeout 超时 ms（可选）
   * @returns 抓取结果（success / content / contentType）
   */
  fetchUrl(
    url: string,
    maxLength?: number,
    timeout?: number
  ): Promise<{ success: boolean; content: string; contentType?: string }>;

  /**
   * 读取 webSearch 配置（从 settingService）。
   * @returns 当前 webSearch 配置块（含 enabled / provider / apiKey / endpoint 等）
   */
  getConfig(): Promise<WebSearchConfig>;
}

// ==================== webSearch 工具 ====================

export const webSearchDescriptor: ToolDescriptor = {
  name: 'webSearch',
  title: 'Web Search',
  description: `Search the web for up-to-date information on a given query. Use this when you need current facts, recent events, technical documentation, or any information that may not be in your training data or the local worldbook.

The search returns a list of results, each with a title, a short snippet (excerpt), and a URL. Read the snippets to decide which results are relevant. If you need the full content of a result, call the fetchUrl tool with its URL.

Parameters:
- query: Search query keywords (natural language, be specific; e.g., "TypeScript 5.2 decorator metadata" rather than "typescript")
- maxResults: Optional maximum number of results to return (default 5, max 20)

Returns: JSON array of search results. Each item has { title, snippet, url, source }. Empty array if no results or search disabled. On error, returns a failure message — adjust your query and retry, or proceed without web context.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query keywords',
      },
      maxResults: {
        type: 'number',
        description: 'Max results (default 5)',
      },
    },
    required: ['query'],
  },
  owner: { kind: 'core' },
  availability: {
    allOf: [
      { kind: 'capability', name: 'supportsToolCalling' },
      { kind: 'config', path: ['webSearch', 'enabled'], check: 'available' },
    ],
  },
  annotations: { group: 'web', sortKey: '010' },
};

/**
 * 创建 webSearch 工具执行器。
 *
 * 流程：
 *  1. 参数校验：query 非空
 *  2. 读取 webSearch 配置（services.getConfig）
 *  3. 调用 services.search(query, config, { maxResults })
 *  4. 成功 → 返回 JSON.stringify(results)（让模型解析结构化结果）
 *  5. 失败 → 返回错误描述（continueLoop: true 让智能体基于错误调整策略）
 *
 * @param services 网络搜索组工具依赖的服务
 */
export function createWebSearchExecutor(
  services: IWebSearchToolServices
): ToolExecutor {
  return async (
    _args: Record<string, unknown>,
    _context?: ToolCallContext
  ): Promise<ToolExecutionResult> => {
    const query = String(_args.query || '').trim();
    const maxResultsRaw = _args.maxResults;
    const maxResults =
      typeof maxResultsRaw === 'number' && maxResultsRaw > 0
        ? Math.min(Math.max(Math.floor(maxResultsRaw), 1), 20)
        : undefined;

    // 参数校验
    if (!query) {
      return {
        success: false,
        content:
          'Parameter "query" is required and must be a non-empty string.',
        continueLoop: true,
      };
    }

    try {
      const config = await services.getConfig();
      const options: SearchOptions | undefined = maxResults
        ? { maxResults }
        : undefined;
      const results = await services.search(query, config, options);

      if (results.length === 0) {
        return {
          success: true,
          content: `No web search results found for query: "${query}". Try a different search term or proceed without web context.`,
          continueLoop: true,
        };
      }

      return {
        success: true,
        content: JSON.stringify(results),
        continueLoop: true,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        content: `webSearch failed: ${errMsg}. Adjust your query and retry, or proceed without web context.`,
        continueLoop: true,
      };
    }
  };
}

// ==================== fetchUrl 工具 ====================

export const fetchUrlDescriptor: ToolDescriptor = {
  name: 'fetchUrl',
  title: 'Fetch URL Content',
  description: `Fetch the main text content of a web page at a given URL. HTML tags are stripped, scripts/styles/navigation are removed, and the result is plain text (truncated to a maximum length). Use this to read the full content of a search result, documentation page, or any publicly accessible URL.

Content-Type handling:
- HTML / XHTML: extracted to plain text (main body content)
- JSON: returned as-is (truncated)
- text/* (plain, xml, css): returned as-is (truncated)
- Binary (image/audio/video/pdf): returns a summary with type and size, no body content

Parameters:
- url: The URL to fetch (must be a valid http/https URL)
- maxLength: Optional maximum content length in characters (default 4000)

Returns: The fetched text content. On error (network failure, non-200 HTTP status, invalid URL), returns a failure message — check the URL and retry, or proceed without the page content.`,
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch',
      },
      maxLength: {
        type: 'number',
        description: 'Max content length in chars (default 4000)',
      },
    },
    required: ['url'],
  },
  owner: { kind: 'core' },
  availability: {
    allOf: [
      { kind: 'capability', name: 'supportsToolCalling' },
      { kind: 'config', path: ['webSearch', 'enabled'], check: 'available' },
    ],
  },
  annotations: { group: 'web', sortKey: '020' },
};

/**
 * 创建 fetchUrl 工具执行器。
 *
 * 流程：
 *  1. 参数校验：url 非空（基础格式校验）
 *  2. 调用 services.fetchUrl(url, maxLength)
 *  3. 成功 → 返回 fetchedContent（纯文本）
 *  4. 失败 → 返回错误描述（continueLoop: true 让智能体基于错误调整策略）
 *
 * @param services 网络搜索组工具依赖的服务
 */
export function createFetchUrlExecutor(
  services: IWebSearchToolServices
): ToolExecutor {
  return async (
    _args: Record<string, unknown>,
    _context?: ToolCallContext
  ): Promise<ToolExecutionResult> => {
    const url = String(_args.url || '').trim();
    const maxLengthRaw = _args.maxLength;
    const maxLength =
      typeof maxLengthRaw === 'number' && maxLengthRaw > 0
        ? Math.floor(maxLengthRaw)
        : undefined;

    // 参数校验
    if (!url) {
      return {
        success: false,
        content: 'Parameter "url" is required and must be a non-empty string.',
        continueLoop: true,
      };
    }

    // 基础 URL 格式校验（http/https）
    if (!/^https?:\/\//i.test(url)) {
      return {
        success: false,
        content:
          `Parameter "url" must be a valid http(s) URL. Received: "${url}".`,
        continueLoop: true,
      };
    }

    try {
      const result = await services.fetchUrl(url, maxLength);
      if (!result.success) {
        return {
          success: false,
          content: `fetchUrl failed for ${url}: ${result.content}`,
          continueLoop: true,
        };
      }
      return {
        success: true,
        content: result.content,
        continueLoop: true,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        content: `fetchUrl failed: ${errMsg}. Check the URL and retry, or proceed without the page content.`,
        continueLoop: true,
      };
    }
  };
}

// ==================== 注册便捷函数 ====================

/**
 * 注册所有网络搜索组工具到 ToolRegistry。
 *
 * 对标 registerWorldbookTools / registerDialogueTools 模式：
 *  - 内部 try/catch 包裹每个 register 调用，避免重复注册抛错中断
 *  - 调用方（agentHandlers.getToolProvider）在调用前已通过 listTools().some
 *    做了去重检查，此处兜底防御并发场景
 *
 * @param registry 工具注册中心
 * @param services 网络搜索组工具依赖的服务
 */
export function registerWebSearchTools(
  registry: { register: (descriptor: ToolDescriptor, executor: ToolExecutor) => void },
  services: IWebSearchToolServices
): void {
  const tools = [
    { descriptor: webSearchDescriptor, executor: createWebSearchExecutor(services) },
    { descriptor: fetchUrlDescriptor, executor: createFetchUrlExecutor(services) },
  ];

  for (const { descriptor, executor } of tools) {
    try {
      registry.register(descriptor, executor);
    } catch {
      // 工具可能已被注册（并发场景），忽略
    }
  }
}
