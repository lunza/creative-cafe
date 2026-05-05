import type { DocumentInfo, DocumentProcessingResult, ProcessingProgress, DocumentChunk } from '../types/documentVector';

export const processDocument = async (
  filePath: string,
  onProgress?: (progress: ProcessingProgress) => void,
): Promise<DocumentProcessingResult> => {
  return window.electronAPI.document.process(filePath);
};

export const listDocuments = async (): Promise<DocumentInfo[]> => {
  return window.electronAPI.document.list();
};

export const deleteDocument = async (docId: string): Promise<boolean> => {
  return window.electronAPI.document.delete(docId);
};

export const getDocumentInfo = async (docId: string) => {
  return window.electronAPI.document.getInfo(docId);
};

export const getDocumentChunks = async (docId: string): Promise<DocumentChunk[]> => {
  return window.electronAPI.document.getChunks(docId);
};

export const searchDocumentVectors = async (
  queryText: string,
  topK: number = 5,
  docId?: string,
): Promise<{ success: boolean; results?: Array<{ id: string; score: number; metadata: Record<string, any> }>; error?: string }> => {
  return window.electronAPI.document.searchVectors(queryText, topK, docId);
};

export const getVectorStats = async () => {
  return window.electronAPI.document.getVectorStats();
};

export const generateEmbedding = async (text: string) => {
  return window.electronAPI.document.generateEmbedding(text);
};
