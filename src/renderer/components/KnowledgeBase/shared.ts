/**
 * 知识库管理子组件共享类型与工具函数。
 *
 * 仅在 KnowledgeBase/ 目录下复用，避免对外暴露。
 */
import type { KnowledgeItem } from '../../types/knowledgeBase';

export const SUPPORTED_FORMATS = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.txt', '.md'];

export interface TreeKnowledgeItem extends KnowledgeItem {
  key: string;
  isLeaf: boolean;
  children?: TreeKnowledgeItem[];
}

export interface ProcessedDocument {
  documentId: string;
  fileName: string;
  fileSize: number;
  chunkCount: number;
  totalChars: number;
  processedAt: number;
  fileType: string;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: {
    text: string;
    source: string;
    title?: string;
    category?: string[];
    tags?: string[];
  };
}

export interface VectorTestResult {
  vector: number[];
  dimension: number;
  min: number;
  max: number;
  first20: number[];
}

export const getFileTypeIcon = (type: string) => {
  switch (type) {
    case 'pdf': return '📄';
    case 'docx': case 'doc': return '📝';
    case 'xlsx': case 'xls': return '📊';
    case 'txt': return '📃';
    case 'md': return '🔖';
    default: return '📎';
  }
};

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const formatTime = (ts: number): string => {
  return new Date(ts).toLocaleString('zh-CN');
};
