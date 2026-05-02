export interface Config {
  model_name: string;
  api_url: string;
  api_key: string;
  streaming: boolean;
  max_tokens: number;
  temperature: number;
}

export interface WorldBook {
  name: string;
  path: string;
  size: number;
  modified: Date;
  entries: WorldBookEntry[];
  metadata: WorldBookMetadata;
}

export interface WorldBookEntry {
  key: string;
  content: string;
  enabled: boolean;
  priority: number;
}

export interface WorldBookMetadata {
  version: string;
  created: Date;
  modified: Date;
}

export interface Character {
  name: string;
  path: string;
  size: number;
  modified: Date;
  description: string;
  personality: string;
  scenario: string;
  mes_example: string;
}

export interface OptimizerResult {
  success: boolean;
  optimized?: any;
  error?: string;
  score?: number;
}
