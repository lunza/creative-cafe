/**
 * 网络搜索 provider 类型契约 —— 对应 spec: add-agent-web-search-tool
 *
 * 来源：g:\AI\creative-cafe\.trae\specs\add-agent-web-search-tool\spec.md
 * 决策：spec §设计理念 1「可插拔 Provider 模式」。
 *       WebSearchProvider 接口借鉴 openclaw codex-native-web-search.ts，
 *       支持 DuckDuckGo / Tavily / SearXNG / Custom 四种 provider。
 *
 * 职责：
 *  1. 定义搜索结果条目（SearchResult）—— 标题 / 摘要 / URL / 来源
 *  2. 定义搜索选项（SearchOptions）—— 最大结果数 / 域名白名单 / 超时
 *  3. 定义 provider 接口（WebSearchProvider）—— 统一的搜索能力抽象
 *  4. 定义配置类型（WebSearchConfig）—— 对应 AppSetting.webSearch 配置块
 *
 * 设计约束：
 *  - 所有类型显式声明，禁用 any
 *  - WebSearchConfig 字段必须与 src/shared/settings.ts 中 defaultSetting.webSearch 一一对应
 *  - provider 接口要求可插拔：WebSearchService 按 config.provider 动态加载实现
 */

// ==================== 搜索结果类型 ====================

/** 搜索结果条目 */
export interface SearchResult {
  /** 结果标题 */
  title: string;
  /** 结果摘要（200 字内） */
  snippet: string;
  /** 结果 URL */
  url: string;
  /** 来源 provider 名称 */
  source: string;
}

// ==================== 搜索选项 ====================

/** 搜索选项 */
export interface SearchOptions {
  /** 最大结果数（默认 5） */
  maxResults?: number;
  /** 域名白名单（可选，仅返回这些域名的结果） */
  allowedDomains?: string[];
  /** 请求超时（ms，默认 10000） */
  timeout?: number;
}

// ==================== Provider 接口 ====================

/** 搜索 provider 接口 */
export interface WebSearchProvider {
  /** provider 唯一名（如 'duckduckgo' / 'tavily' / 'searxng' / 'custom'） */
  readonly name: string;
  /** 是否需要 API key */
  readonly requiresApiKey: boolean;
  /** 执行搜索 */
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
}

// ==================== Provider 名称联合类型 ====================

/** provider 名称联合类型 */
export type WebSearchProviderName = 'duckduckgo' | 'tavily' | 'searxng' | 'custom';

// ==================== 配置类型 ====================

/** 网络搜索配置（对应 AppSetting.webSearch） */
export interface WebSearchConfig {
  /** 全局开关 */
  enabled: boolean;
  /** provider 选择 */
  provider: WebSearchProviderName;
  /** API key（Tavily 等 provider 用） */
  apiKey: string;
  /** 端点 URL（SearXNG / Custom 用） */
  endpoint: string;
  /** 默认结果数 */
  maxResults: number;
  /** 请求超时（ms） */
  timeout: number;
  /** 域名白名单（可选） */
  allowedDomains: string[];
  /** 世界书编写智能体集成开关 */
  enableInAuthoring: boolean;
}
