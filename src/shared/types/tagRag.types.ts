/**
 * RAG 标签库共享类型定义
 *
 * 用途：
 *  - 主进程 TagRagService 的状态管理、向量化、语义检索类型
 *  - 渲染进程 TagRagSettings 面板的 UI 状态与 IPC 载荷类型
 *  - IPC 通道 tagRag:* 的请求/响应载荷类型
 *
 * 设计约束：
 *  - 独立定义，不依赖其他类型模块（避免循环依赖）
 *  - 与 tag.types.ts 风格一致
 *  - 所有类型对齐主进程 TagRagService 的实际实现
 */

/**
 * 向量化状态枚举。
 *
 * 状态转换图：
 *  idle ──(vectorizeAll)──→ vectorizing ──(成功)──→ ready
 *    ↑                          │                     │
 *    │                          │                     │
 *    └──(cancel)────────────────┘                     │
 *    │                                                │
 *    └──(clearIndex)─────────────────────────────────┘
 *                                 │
 *                          (失败)──→ error ──(retry)──→ vectorizing
 *
 *  ready/error ──(CSV/维度/模型变更)──→ stale ──(vectorizeAll)──→ vectorizing
 */
export type TagRagStatus =
  | 'idle' // 未向量化
  | 'vectorizing' // 向量化中
  | 'ready' // 就绪可检索
  | 'error' // 上次向量化失败
  | 'stale'; // 索引过期（CSV/维度/模型变更）

/**
 * 向量化进度阶段。
 * - starting：初始化阶段（加载标签库、计算指纹）
 * - embedding：批量 embedding 调用中
 * - storing：批量写入 DB 中
 * - finalizing：写入 meta、最终化
 * - done：成功完成
 * - error：失败终止
 * - cancelled：用户取消
 */
export type TagRagProgressPhase =
  | 'starting'
  | 'embedding'
  | 'storing'
  | 'finalizing'
  | 'done'
  | 'error'
  | 'cancelled';

/**
 * 进度事件载荷（主进程 → 渲染进程单向广播）。
 *
 * 通过 IPC 通道 `tagRag:progress` 推送，渲染进程通过 `electronAPI.tagRag.onProgress` 订阅。
 */
export interface TagRagProgressEvent {
  /** 当前阶段 */
  phase: TagRagProgressPhase;
  /** 已处理条数 */
  current: number;
  /** 总条数 */
  total: number;
  /** 完成百分比（0-100） */
  percentage: number;
  /** 预计剩余秒数（仅 embedding/storing 阶段有意义） */
  eta?: number;
  /** 失败条数（embedding 或 DB 写入失败） */
  failedCount: number;
  /** 人类可读消息（如「已处理 1200/317600」） */
  message?: string;
  /** 错误信息（phase='error' 时存在） */
  error?: string;
}

/**
 * 持久化元数据（写入 userData/tag_rag_meta.json）。
 *
 * 用于索引指纹比对：csvHash + dimension + model 三元组任一变更即标记 stale。
 */
export interface TagRagMeta {
  /** CSV 文件指纹（sha256(csvPath + ':' + fileSize + ':' + mtimeMs).slice(0,16)） */
  csvHash: string;
  /** 向量化时的 embedding 维度 */
  dimension: number;
  /** 向量化时的 embedding 模型名 */
  model: string;
  /** 标签库总条数 */
  totalTags: number;
  /** 成功向量化的条数 */
  vectorizedCount: number;
  /** 失败条数 */
  failedCount: number;
  /** 上次向量化的时间戳（ms） */
  lastVectorizedAt: number;
  /** 上次向量化的总耗时（ms） */
  durationMs: number;
  /** 状态（ready/error） */
  status: 'ready' | 'error';
}

/**
 * 当前状态快照（tagRag:getStatus 返回）。
 */
export interface TagRagState {
  /** 当前状态 */
  status: TagRagStatus;
  /** 已向量化条数（vectorizing 时实时更新） */
  current: number;
  /** 总条数 */
  total: number;
  /** 失败条数 */
  failedCount: number;
  /** 向量化开始时间戳（ms） */
  startedAt?: number;
  /** 向量化完成时间戳（ms） */
  finishedAt?: number;
  /** 上次错误信息（status='error' 时存在） */
  lastError?: string;
  /** 持久化元数据（未向量化时为 null） */
  meta: TagRagMeta | null;
}

/**
 * 语义检索请求（tagRag:search 入参）。
 */
export interface TagRagSearchRequest {
  /** 查询文本（角色描述 / 自然语言指令等） */
  query: string;
  /** 返回结果数量，默认 40 */
  topK?: number;
  /** 最低相似度阈值（0-1，cosine similarity），默认 0.15 */
  minScore?: number;
  /** Danbooru 分类过滤（如 [0, 5] 仅返回 general + meta），不传则不过滤 */
  categoryFilter?: number[];
}

/**
 * 单条语义检索结果。
 */
export interface TagRagSearchResultItem {
  /** 标签名（保留原始大小写） */
  name: string;
  /** Danbooru/e621 分类编号 */
  category: number;
  /** 出现次数 */
  count: number;
  /** 别名列表 */
  aliases: string[];
  /** 相似度分数（0-1，cosine similarity，越高越相关） */
  score: number;
}

/**
 * 语义检索响应（tagRag:search 返回）。
 */
export interface TagRagSearchResponse {
  /** 是否成功 */
  success: boolean;
  /** 检索结果列表（已按 score 降序排列） */
  results: TagRagSearchResultItem[];
  /** 错误描述（success=false 时存在） */
  error?: string;
}

/**
 * 向量化结果（tagRag:startVectorization 返回）。
 *
 * 注意：向量化是异步长任务，此返回值仅表示「任务已启动」或「已完成」。
 * 实际进度通过 `tagRag:progress` 事件推送。
 */
export interface TagRagVectorizeResult {
  /** 是否成功启动或完成 */
  success: boolean;
  /** 成功向量化的条数 */
  vectorized: number;
  /** 失败条数 */
  failed: number;
  /** 总耗时（ms） */
  durationMs?: number;
  /** 错误描述（success=false 时存在） */
  error?: string;
}

/**
 * 向量化启动选项。
 */
export interface TagRagVectorizeOptions {
  /** 强制重新向量化（即使索引就绪且指纹匹配） */
  force?: boolean;
}

/**
 * 清空索引结果。
 */
export interface TagRagClearResult {
  /** 是否成功 */
  success: boolean;
  /** 错误描述（失败时存在） */
  error?: string;
}

/**
 * 取消向量化结果。
 */
export interface TagRagCancelResult {
  /** 是否成功（无进行中的任务时返回 false） */
  success: boolean;
  /** 消息说明 */
  message?: string;
}
