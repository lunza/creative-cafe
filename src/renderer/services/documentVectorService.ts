import type { DocumentInfo, DocumentProcessingResult, ProcessingProgress } from '../types/documentVector';

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
