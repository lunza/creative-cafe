/**
 * 标签自动推荐共享类型定义（Spec: implement-local-tag-autocomplete / Task 1）
 *
 * 用途：
 *  - 主进程 TagAutocompleteService 的内存索引项与查询响应类型
 *  - 渲染进程 TagAutocomplete 组件的 props 类型
 *  - IPC 通道 tag:* 的请求/响应载荷类型
 *
 * 设计约束：
 *  - 独立定义，不依赖其他类型模块
 *  - matchType 简化为三种：prefix（name 以 query 开头）/ includes（name 包含 query 但非开头）
 *    / alias（name 不匹配，仅别名匹配）；spec 中的 "startsWith" 归入 prefix
 */

/** 单条标签信息（CSV 一行解析结果） */
export interface TagInfo {
  /** 标签名（保留原始大小写，如 "long_hair"） */
  name: string;
  /** Danbooru/e621 分类编号（0=general / 1=artist / 3=copyright / 4=character / 5=meta / 7=e621） */
  category: number;
  /** 出现次数（用于 count 与 relevance 排序权重） */
  count: number;
  /** 别名列表（CSV 第 4 列引号内按逗号分割；无则空数组） */
  aliases: string[];
}

/** 匹配类型（用于 relevance 排序优先级判定） */
export type TagMatchType = 'prefix' | 'includes' | 'alias';

/** 查询结果（TagInfo + 匹配类型） */
export interface TagSearchResult extends TagInfo {
  /** 本次查询中该 tag 的匹配类型 */
  matchType: TagMatchType;
}

/** 排序规则 */
export type TagSortBy = 'relevance' | 'count' | 'alphabetical';

/** 搜索请求 */
export interface TagSearchRequest {
  /** 搜索关键词（大小写不敏感子串匹配，最小 1 字符） */
  query: string;
  /** 排序规则，默认 'relevance' */
  sortBy?: TagSortBy;
  /** 返回结果上限，默认 50，最大 50 */
  limit?: number;
}

/** 搜索响应 */
export interface TagSearchResponse {
  /** 是否成功（加载失败或查询异常时为 false） */
  success: boolean;
  /** 匹配结果列表（已排序 + 截断到 limit） */
  results: TagSearchResult[];
  /** 匹配总数（截断前的数量，便于前端展示"共 N 条"） */
  total: number;
  /** 错误描述（success=false 时存在） */
  error?: string;
  /** 是否正在加载标签库（加载期间查询时为 true，调用方可据此提示"标签库加载中..."） */
  loading?: boolean;
}

/** 加载状态快照（tag:getLoadStatus 返回） */
export interface TagLoadStatus {
  /** 是否已加载完成（成功） */
  loaded: boolean;
  /** 是否正在加载中 */
  loading: boolean;
  /** 已加载标签总数 */
  totalCount: number;
  /** 当前 CSV 文件路径 */
  csvPath: string;
  /** 加载错误（加载失败时存在） */
  error?: string;
}

/** 重新加载结果（tag:reload 返回） */
export interface TagReloadResult {
  /** 是否成功 */
  success: boolean;
  /** 加载后的标签总数 */
  totalCount: number;
  /** 错误描述（失败时存在） */
  error?: string;
}
