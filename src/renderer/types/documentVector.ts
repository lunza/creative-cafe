export type DocumentFileType = 'pdf' | 'docx' | 'doc' | 'xlsx' | 'xls' | 'txt' | 'md';

export interface DocumentMetadata {
  id: string;
  fileName: string;
  fileType: DocumentFileType;
  fileSize: number;
  uploadedAt: number;
  processedAt: number;
  chunkCount: number;
  totalChars: number;
}

export interface DocumentInfo {
  documentId: string;
  metadata: DocumentMetadata;
  chunkCount: number;
  storedAt: number;
}

export interface DocumentChunk {
  index: number;
  text: string;
}

export interface DocumentProcessingResult {
  success: boolean;
  documentId: string;
  metadata: DocumentMetadata;
  chunkCount: number;
  error?: string;
}

export interface ProcessingProgress {
  step: string;
  progress: number;
  message: string;
}
