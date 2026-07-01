/**
 * 向量相关统一类型定义（单一真源）
 *
 * 本文件合并了原 `src/shared/types/vector.ts` 与 `src/main/types/vectorConfig.ts`
 * 中重复定义的向量数据类型，取字段并集作为统一契约。后续消费方迁移后，
 * 旧定义将被移除；当前为兼容期，旧定义暂不删除。
 *
 * 设计原则：
 * - 仅包含"向量数据"相关类型（VectorItem / SearchResult / 上下文 / 检索选项）
 * - 不包含 `VectorConfig`（配置参数）、`EmbeddingResult`（嵌入结果）等
 *   非"向量数据"概念，这些仍由 `src/main/types/vectorConfig.ts` 维护
 * - 字段语义对齐 `vector_registry.json` 与 `vecstore.json` 的存储结构
 */

/** 嵌入模式：远程调用模型 or 本地推理 */
export type EmbeddingMode = 'remote' | 'local';

/** 向量存储后端模式（当前仅 vecstore） */
export type VectorStoreMode = 'vecstore';

/**
 * 向量项 - vecstore.json 中的单条向量记录
 *
 * @property id        向量唯一标识（通常为 `${sourceType}:${sourceId}:${entryUid}` 形式）
 * @property vector    嵌入向量数组（维度由 EmbeddingService.dimension 决定）
 * @property metadata  向量元数据（含原文、来源、时间戳等）
 */
export interface VectorItem {
  id: string;
  vector: number[];
  metadata: VectorMetadata;
}

/**
 * 向量元数据 - 描述向量的来源与上下文
 *
 * 索引签名 `[key: string]: any` 用于容纳不同 sourceType 的扩展字段
 * （如世界书路径、角色卡 ID 等），避免每次扩展都修改接口。
 *
 * @property text          原始文本内容（向量化时所用文本）
 * @property source        来源标识（如 worldbook / knowledge / character_chat）
 * @property sourceId      来源实体 ID（如世界书文件名、知识条目 ID）
 * @property entryUid      条目级 UID（同一来源内的子条目唯一标识，可选）
 * @property characterId   角色卡 ID（character_chat 类型专用，可选）
 * @property worldBookPath 世界书文件相对路径（worldbook 类型专用，可选）
 * @property tags          用户标签列表（可选，用于过滤）
 * @property createdAt     创建时间戳（ms）
 * @property updatedAt     更新时间戳（ms）
 */
export interface VectorMetadata {
  text: string;
  source: string;
  sourceId: string;
  entryUid?: string;
  characterId?: string;
  worldBookPath?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  [key: string]: any;
}

/**
 * 向量检索结果
 *
 * @property id        命中的 VectorItem.id
 * @property score     相似度分数（0~1，越大越相似）
 * @property metadata  命中向量的元数据（透传 VectorMetadata，但类型上放宽为 Record 以兼容多种后端）
 */
export interface SearchResult {
  id: string;
  score: number;
  metadata: Record<string, any>;
}

/**
 * 检索选项 - 用于 retrieve / search 接口
 *
 * @property topK     返回结果数上限
 * @property sources  限定来源标识列表（如 ['worldbook', 'knowledge']）
 * @property minScore 最小相似度分数阈值
 * @property filter   通用过滤条件（透传至后端实现）
 * @property scopeIds 限定范围 ID 列表（如限定特定 sourceId 集合内检索）
 */
export interface RetrieveOptions {
  topK: number;
  sources: string[];
  minScore: number;
  filter?: Record<string, any>;
  scopeIds?: string[];
}

/**
 * 上下文项 - 注入到 AI Prompt 的单条上下文
 *
 * 与 SearchResult 区别：ContextItem 已扁平化为 `content` 字符串，
 * 不携带 vector 与 score 等检索细节，直接供 Prompt 拼接使用。
 */
export interface ContextItem {
  id: string;
  source: string;
  content: string;
  score: number;
  metadata: Record<string, any>;
}

/**
 * 知识库条目 - knowledge.json 中的单条知识
 *
 * @property id                     知识条目 ID
 * @property title                  标题
 * @property content               正文内容
 * @property source                 来源（manual / document / ...）
 * @property category               分类路径
 * @property tags                   标签
 * @property relatedCharacterIds    关联角色卡 ID 列表
 * @property relatedWorldBookPaths  关联世界书路径列表
 * @property vector                 可选的预计算向量
 * @property metadata               嵌入元数据
 */
export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  source: string;
  category: string[];
  tags: string[];
  relatedCharacterIds: string[];
  relatedWorldBookPaths: string[];
  vector?: number[];
  metadata: KnowledgeMetadata;
}

/**
 * 知识库嵌入元数据
 *
 * @property createdAt       创建时间戳（ms）
 * @property updatedAt       更新时间戳（ms）
 * @property createdBy       创建者标识
 * @property embeddingMode   嵌入模式（remote / local）
 * @property embeddingModel  嵌入模型名称
 * @property tokenCount       token 数量
 */
export interface KnowledgeMetadata {
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  embeddingMode: EmbeddingMode;
  embeddingModel: string;
  tokenCount: number;
}

/**
 * 角色-世界书关联关系
 *
 * @property characterId   角色卡 ID
 * @property worldBookPath 世界书相对路径
 * @property enabled       是否启用
 * @property priority      优先级（数字越大越优先）
 * @property filterTags    过滤标签（可选，仅匹配含这些标签的条目）
 */
export interface CharacterWorldBookRelation {
  characterId: string;
  worldBookPath: string;
  enabled: boolean;
  priority: number;
  filterTags?: string[];
}

/**
 * 搜索选项 - 用于 KnowledgeBaseService.search 等高层接口
 *
 * 与 RetrieveOptions 区别：SearchOptions 是面向"业务层"的语义化过滤
 * （categories / tags / characterId / sourceType），RetrieveOptions 是
 * 面向"向量后端"的底层过滤（sources / filter / scopeIds）。
 *
 * @property topK           返回结果数上限
 * @property minScore       最小相似度分数阈值
 * @property categories     限定分类列表（可选）
 * @property tags           限定标签列表（可选）
 * @property sources        限定来源标识列表（可选）
 * @property characterId    限定角色卡 ID（可选）
 * @property sourceType     限定向量源类型（可选，对应 VectorSourceType 枚举值）
 * @property aggregate      是否聚合所有源的搜索结果（可选，默认 false）
 */
export interface SearchOptions {
  topK: number;
  minScore: number;
  categories?: string[];
  tags?: string[];
  sources?: string[];
  characterId?: string;
  sourceType?: string;
  aggregate?: boolean;
}

/**
 * 删除选项 - 用于批量删除向量时限定范围
 *
 * @property sourceType 限定删除的向量源类型（可选，对应 VectorSourceType 枚举值）
 */
export interface DeleteOptions {
  sourceType?: string;
}
