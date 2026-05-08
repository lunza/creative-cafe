export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  source?: string;
  category?: string;
  tags?: string[];
  relatedCharacterIds?: string[];
  relatedWorldBookPaths?: string[];
  metadata?: Record<string, any>;
  documentId?: string;
  documentName?: string;
}
