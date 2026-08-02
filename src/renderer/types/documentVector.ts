export interface DocumentInfo {
  docId: string;
  documentId?: string;
  fileName: string;
  fileSize: number;
  chunkCount: number;
  storedAt?: number;
  createdAt: number;
  metadata?: Record<string, any>;
}

export interface DocumentChunk {
  index: number;
  text: string;
}

export interface ProcessingProgress {
  stage?: string;
  step: string;
  progress: number;
  message?: string;
}

export interface DocumentProcessingResult {
  success: boolean;
  docId?: string;
  documentId?: string;
  chunks?: DocumentChunk[];
  chunkCount?: number;
  metadata?: Record<string, any>;
  error?: string;
}
