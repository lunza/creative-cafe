/**
 * 向量配置字段 Schema 统一常量（单一真源）
 *
 * 合并以下两处重复定义：
 * - `src/main/services/ConfigCleanupService.ts` 中的 `FORBIDDEN_VECTOR_FIELDS`
 *   与 `ALLOWED_VECTOR_CONFIG_FIELDS`（用于配置清理）
 * - `src/main/services/VectorConfigManager.ts` 中的 `FORBIDDEN_DATA_FIELDS`
 *   与 `ALLOWED_VECTOR_CONFIG_FIELDS`（用于配置管理）
 *
 * 两处 `FORBIDDEN_*` 内容完全一致；`ALLOWED_*` 取并集
 * （ConfigCleanupService 版本为超集，VectorConfigManager 版本为其子集，
 * 仅包含当前 `VectorConfig` 接口已声明的字段）。
 *
 * 设计原则：
 * - 使用 `readonly string[]` 类型，避免与 `VectorConfig` 接口强耦合
 *   （settings.json 中可能存在尚未在 `VectorConfig` 中声明的 legacy 字段，
 *   如 `remoteApiKeyTransmission`、`vectorStoreMode` 等，这些字段同样合法）
 * - 消费方迁移由后续任务处理，当前仅创建 shared 新定义
 */

/**
 * 禁止的向量数据字段 - 不应出现在 settings.json 的向量配置中
 *
 * 这些字段为向量数据（向量数组、条目列表等），应存储在独立的 vectors.db
 * 文件中。若出现在配置中会膨胀配置文件大小，需在配置清理时移除。
 *
 * 来源：ConfigCleanupService.FORBIDDEN_VECTOR_FIELDS
 *       VectorConfigManager.FORBIDDEN_DATA_FIELDS（两者内容完全一致）
 */
export const FORBIDDEN_VECTOR_FIELDS: readonly string[] = [
  'vectors',
  'vectorData',
  'embeddings',
  'items',
  'records',
  'vectorArray',
  'vectors_data',
  'data',
  'entries',
];

/**
 * 合法的向量配置字段白名单
 *
 * 这些字段为向量化的配置参数（模型、API、缓存等），允许出现在
 * settings.json 的向量配置中。配置清理时，仅保留这些字段，其余字段移除。
 *
 * 来源：ConfigCleanupService.ALLOWED_VECTOR_CONFIG_FIELDS（超集）
 *       VectorConfigManager.ALLOWED_VECTOR_CONFIG_FIELDS（子集，仅含
 *       当前 `VectorConfig` 接口已声明的字段）
 *
 * 注意：以下字段虽未在 `VectorConfig` 接口中声明，但属于 settings.json
 * 中实际存在的 legacy / 扩展字段，不应在清理时被误删：
 * - `remoteApiKeyTransmission`：API Key 传输方式（header / body）
 * - `vectorStoreMode`：向量存储模式
 * - `autoRetrieveContext`：是否自动检索上下文
 * - `contextTopK`：上下文检索 topK
 * - `contextMinScore`：上下文检索最小相似度
 */
export const ALLOWED_VECTOR_CONFIG_FIELDS: readonly string[] = [
  // 嵌入模式与模型
  'embeddingMode',
  'remoteModel',
  'localModel',
  // 远程 API 配置
  'remoteApiUrl',
  'remoteApiKey',
  'remoteApiKeyTransmission',
  // 向量存储模式
  'vectorStoreMode',
  // 缓存配置
  'cacheEnabled',
  'cacheL1Size',
  'cacheL1TTL',
  'cacheL2TTL',
  // 检索默认值
  'defaultTopK',
  'minSimilarityScore',
  'contextWindowTokens',
  // 自动向量化开关
  'autoVectorizeWorldBook',
  'autoVectorizeKnowledge',
  // 上下文自动检索（legacy / 扩展字段）
  'autoRetrieveContext',
  'contextTopK',
  'contextMinScore',
  // 向量维度
  'dimension',
];

/**
 * 配置大小阈值（10KB）
 *
 * 超过此阈值视为配置异常膨胀（很可能误存了向量数据），
 * 应触发清理流程。
 */
export const MAX_CONFIG_SIZE_BYTES = 10000;
