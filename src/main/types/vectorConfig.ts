export type EmbeddingMode = 'remote' | 'local';
export type VectorStoreMode = 'vecstore' | 'json';

/**
 * 向量源类型枚举 — 严格对应 vector_registry.json 的 sourceType 字段
 * 可扩展设计：新增类型时只需在此处添加枚举值
 */
export enum VectorSourceType {
  /** 世界书向量化 */
  WORLDBOOK = 'worldbook',
  /** 知识库-文档上传（PDF/Word/Excel/TXT/MD） */
  KNOWLEDGE = 'knowledge',
  /** 知识库-手动新增知识条目（存储于 default 目录） */
  MANUAL_KNOWLEDGE = 'manual_knowledge',
  /** 角色卡聊天记录（预留接口） */
  CHARACTER_CHAT = 'character_chat',
}

/** 源类型中文标签字典 */
export const VectorSourceTypeLabel: Record<VectorSourceType, string> = {
  [VectorSourceType.WORLDBOOK]: '世界书',
  [VectorSourceType.KNOWLEDGE]: '知识库文档',
  [VectorSourceType.MANUAL_KNOWLEDGE]: '手动知识',
  [VectorSourceType.CHARACTER_CHAT]: '角色聊天记录',
};

/** 源类型描述字典 */
export const VectorSourceTypeDescription: Record<VectorSourceType, string> = {
  [VectorSourceType.WORLDBOOK]: '世界书文件向量化生成的向量数据',
  [VectorSourceType.KNOWLEDGE]: '通过文档上传功能处理的 PDF/Word/Excel/TXT/MD 文件向量化数据',
  [VectorSourceType.MANUAL_KNOWLEDGE]: '用户手动创建的知识条目向量化数据，存储于 default 目录',
  [VectorSourceType.CHARACTER_CHAT]: '角色卡聊天记录向量化数据（功能开发中）',
};

/**
 * 验证 sourceType 是否合法
 * @param type 待验证的类型字符串
 * @returns 是否为合法的 VectorSourceType
 */
export function isValidVectorSourceType(type: string): type is VectorSourceType {
  return Object.values(VectorSourceType).includes(type as VectorSourceType);
}

/**
 * 获取所有可用的向量源类型（排除预留但未实现的类型）
 * @param includeUnimplemented 是否包含尚未实现的类型（默认 false）
 */
export function getAvailableVectorSourceTypes(includeUnimplemented = false): VectorSourceType[] {
  if (includeUnimplemented) {
    return Object.values(VectorSourceType);
  }
  // 当前未实现的类型
  const unimplemented = [VectorSourceType.CHARACTER_CHAT];
  return Object.values(VectorSourceType).filter(t => !unimplemented.includes(t));
}

/** 获取源类型的默认存储路径配置 */
export interface SourceTypeStorageConfig {
  /** 存储目录名（相对于 vectors/ 目录） */
  storageDir: string;
  /** 是否为每个条目创建独立子目录 */
  perEntrySubdir: boolean;
  /** 默认文件名前缀 */
  filePrefix: string;
}

export const VectorSourceTypeStorageConfig: Record<VectorSourceType, SourceTypeStorageConfig> = {
  [VectorSourceType.WORLDBOOK]: {
    storageDir: 'worldbook',
    perEntrySubdir: true,
    filePrefix: 'wb',
  },
  [VectorSourceType.KNOWLEDGE]: {
    storageDir: 'knowledge',
    perEntrySubdir: true,
    filePrefix: 'kb',
  },
  [VectorSourceType.DOCUMENT]: {
    storageDir: 'knowledge',
    perEntrySubdir: true,
    filePrefix: 'kb_doc',
  },
  [VectorSourceType.MANUAL_KNOWLEDGE]: {
    storageDir: 'default',
    perEntrySubdir: true,
    filePrefix: 'manual',
  },
  [VectorSourceType.CHARACTER_CHAT]: {
    storageDir: 'characters',
    perEntrySubdir: true,
    filePrefix: 'chat',
  },
};

export interface VectorConfig {
  embeddingMode: EmbeddingMode;
  remoteModel: string;
  remoteApiUrl: string;
  remoteApiKey: string;
  localModel: string;
  vectorStoreMode: VectorStoreMode;
  cacheEnabled: boolean;
  cacheL1Size: number;
  cacheL1TTL: number;
  cacheL2TTL: number;
  defaultTopK: number;
  minSimilarityScore: number;
  contextWindowTokens: number;
  autoVectorizeWorldBook: boolean;
  autoVectorizeKnowledge: boolean;
  dimension?: number;
}

export interface EmbeddingResult {
  success: boolean;
  vector?: number[];
  error?: string;
  dimension?: number;
  model?: string;
  mode?: string;
}

export interface BatchEmbeddingResult {
  success: boolean;
  vectors?: number[][];
  error?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  mode: string;
  dimension: number;
  error?: string;
  details?: string;
  model?: string;
}

export interface ModeInfo {
  success: boolean;
  mode: string;
  dimension: number;
}

export interface ModeSetResult {
  success: boolean;
  mode?: string;
  error?: string;
}

export interface VectorItem {
  id: string;
  vector: number[];
  metadata: VectorMetadata;
}

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

export interface SearchResult {
  id: string;
  score: number;
  metadata: Record<string, any>;
}

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
  vectorStoreMode: VectorStoreMode;
  metadata: KnowledgeMetadata;
}

export interface KnowledgeMetadata {
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  embeddingMode: EmbeddingMode;
  embeddingModel: string;
  tokenCount: number;
}

export interface CharacterWorldBookRelation {
  characterId: string;
  worldBookPath: string;
  enabled: boolean;
  priority: number;
  filterTags?: string[];
}

export interface RetrieveOptions {
  topK: number;
  sources: string[];
  minScore: number;
  filter?: Record<string, any>;
  scopeIds?: string[];
}

export interface ContextItem {
  id: string;
  source: string;
  content: string;
  score: number;
  metadata: Record<string, any>;
}

export interface SearchOptions {
  topK: number;
  minScore: number;
  categories?: string[];
  tags?: string[];
  sources?: string[];
  characterId?: string;
  sourceType?: string;  // 指定搜索的源类型
  aggregate?: boolean;  // 是否聚合所有源的搜索结果
}

export interface DeleteOptions {
  sourceType?: string;  // 指定删除的源类型
}
