export type EmbeddingMode = 'remote' | 'local';
export type VectorStoreMode = 'vecstore' | 'json';

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
}

export interface EmbeddingResult {
  success: boolean;
  vector?: number[];
  error?: string;
  dimension?: number;
  model?: string;
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
  version: number;
  history: KnowledgeVersion[];
  metadata: KnowledgeMetadata;
}

export interface KnowledgeVersion {
  version: number;
  content: string;
  timestamp: number;
  note: string;
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
}
