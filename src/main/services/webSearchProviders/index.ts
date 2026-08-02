/**
 * webSearchProviders barrel 导出
 *
 * 汇总 4 个 provider + 共用工具 + 类型，供 WebSearchService（Task 5）与
 * 其他模块按 config.provider 动态加载。
 *
 * 来源：spec: add-agent-web-search-tool §新增模块
 */

// 类型契约
export type {
  WebSearchProvider,
  SearchResult,
  SearchOptions,
  WebSearchConfig,
  WebSearchProviderName,
} from './types';

// 共用工具
export {
  fetchWithTimeout,
  filterByAllowedDomains,
  truncateResults,
  postProcessResults,
  safeReadErrorBody,
  stripHtmlTags,
  decodeHtmlEntities,
  extractHostname,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
} from './providerUtils';

// DuckDuckGo（零配置，默认）
export {
  DuckDuckGoProvider,
  createDuckDuckGoProvider,
  duckDuckGoProvider,
} from './duckDuckGoProvider';

// Tavily（需 API key）
export { TavilyProvider, createTavilyProvider } from './tavilyProvider';

// SearXNG（需实例 URL）
export { SearXngProvider, createSearXngProvider } from './searxngProvider';

// Custom（自定义端点）
export { CustomProvider, createCustomProvider } from './customProvider';
