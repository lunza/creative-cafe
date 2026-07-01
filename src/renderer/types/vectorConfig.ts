export type EmbeddingMode = 'remote' | 'local';

export interface VectorDefaults {
  remoteModel?: string;
  remoteApiUrl?: string;
  remoteApiKey?: string;
  remoteApiKeyTransmission?: 'header' | 'body';
  localModel?: string;
  dimension?: 1024 | 4096;
  vectorStoreMode: 'vecstore';
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

export interface VectorConfigGroup {
  common: {
    title: string;
    fields: string[];
  };
  remote: {
    title: string;
    icon: React.ReactNode;
    fields: string[];
  };
  local: {
    title: string;
    icon: React.ReactNode;
    fields: string[];
  };
  retrieval: {
    title: string;
    fields: string[];
  };
  automation: {
    title: string;
    fields: string[];
  };
}
