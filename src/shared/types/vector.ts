export type EmbeddingMode = 'remote' | 'local';
export type VectorStoreMode = 'vecstore' | 'json';

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
