import { create } from 'zustand';

interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  source: string;
  category: string[];
  tags: string[];
  relatedCharacterIds: string[];
  relatedWorldBookPaths: string[];
  vectorStoreMode: 'json' | 'vecstore';
  metadata: Record<string, any>;
  documentId?: string;
  documentName?: string;
}

interface DocumentGroup {
  documentId: string;
  documentName: string;
  fileType: string;
  fileSize: number;
  chunkCount: number;
  totalChars: number;
  processedAt: number;
  knowledgeItemCount: number;
}

interface UploadProgress {
  step: string;
  progress: number;
  message: string;
  fileName: string;
}

interface VectorTestResult {
  vector: number[];
  dimension: number;
  min: number;
  max: number;
  first20: number[];
}

interface KnowledgeBaseState {
  items: KnowledgeItem[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  searchResults: any[];
  isSearching: boolean;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  currentPageSize: number;
  uploadProgress: UploadProgress | null;
  isUploading: boolean;
  // 向量搜索状态
  vectorSearchResults: any[];
  isVectorSearching: boolean;
  vectorTestResult: VectorTestResult | null;
  isVectorTesting: boolean;

  // 文档分组状态
  documentGroups: DocumentGroup[];
  selectedDocumentId: string | null;
  documentItemsLoading: boolean;
  
  fetchItems: (filter?: Record<string, any>, page?: number, pageSize?: number) => Promise<void>;
  fetchItemsByDocument: (documentId: string) => Promise<void>;
  fetchDocumentGroups: () => Promise<void>;
  selectDocument: (documentId: string | null) => void;
  createItem: (item: KnowledgeItem) => Promise<string | null>;
  updateItem: (id: string, updates: Partial<KnowledgeItem>) => Promise<boolean>;
  deleteItem: (id: string) => Promise<boolean>;
  deleteBatchItems: (ids: string[]) => Promise<number>;
  deleteDocument: (documentId: string) => Promise<boolean>;
  searchItems: (query: string, options?: any) => Promise<void>;
  vectorizeItem: (id: string) => Promise<boolean>;
  vectorizeAll: () => Promise<number>;
  selectItem: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  uploadDocument: (filePath: string, options?: { category?: string[]; tags?: string[]; source?: string }) => Promise<{ success: boolean; documentId?: string; knowledgeItemsCreated?: number; chunkCount?: number; error?: string; isDuplicate?: boolean }>;
  selectDocumentFile: () => Promise<string | null>;
  setUploadProgress: (progress: UploadProgress | null) => void;
}

export const useKnowledgeBaseStore = create<KnowledgeBaseState>((set, get) => ({
  items: [],
  loading: false,
  error: null,
  selectedId: null,
  searchResults: [],
  isSearching: false,
  currentPage: 1,
  totalPages: 1,
  totalItems: 0,
  currentPageSize: 20,
  uploadProgress: null,
  isUploading: false,
  // 向量搜索状态
  vectorSearchResults: [],
  isVectorSearching: false,
  vectorTestResult: null,
  isVectorTesting: false,

  // 文档分组状态初始化
  documentGroups: [],
  selectedDocumentId: null,
  documentItemsLoading: false,

  fetchItems: async (filter, page = 1, pageSize = 20) => {
    set({ loading: true, error: null, currentPage: page });
    try {
      const result = await window.electronAPI.knowledge.list(filter, page, pageSize);
      if (result.success) {
        set({
          items: result.items || [],
          totalItems: result.total || 0,
          totalPages: Math.ceil((result.total || 0) / pageSize)
        });
      } else {
        set({ error: result.error || 'Failed to fetch items' });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      set({ loading: false });
    }
  },

  fetchDocumentGroups: async () => {
    set({ loading: true, error: null });
    try {
      const docs = await window.electronAPI.document.list();
      const groups: DocumentGroup[] = [];
      
      for (const doc of docs) {
        const itemsResult = await window.electronAPI.knowledge.list({ documentId: doc.documentId }, 1, 1);
        groups.push({
          documentId: doc.documentId,
          documentName: doc.metadata?.fileName || doc.documentId,
          fileType: doc.metadata?.fileType || 'unknown',
          fileSize: doc.metadata?.fileSize || 0,
          chunkCount: doc.chunkCount || 0,
          totalChars: doc.metadata?.totalChars || 0,
          processedAt: doc.metadata?.processedAt || doc.storedAt || 0,
          knowledgeItemCount: itemsResult.total || 0,
        });
      }
      
      set({ documentGroups: groups });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch document groups' });
    } finally {
      set({ loading: false });
    }
  },

  fetchItemsByDocument: async (documentId) => {
    set({ documentItemsLoading: true, error: null, selectedDocumentId: documentId });
    try {
      const result = await window.electronAPI.knowledge.list({ documentId }, 1, 1000);
      if (result.success) {
        set({
          items: result.items || [],
          totalItems: result.total || 0,
          totalPages: 1,
          currentPage: 1,
        });
      } else {
        set({ error: result.error || 'Failed to fetch items' });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      set({ documentItemsLoading: false });
    }
  },

  selectDocument: (documentId) => {
    set({ selectedDocumentId: documentId });
    if (documentId) {
      get().fetchItemsByDocument(documentId);
    } else {
      set({ items: [] });
    }
  },

  deleteDocument: async (documentId) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.document.delete(documentId);
      if (result) {
        await get().fetchDocumentGroups();
        await get().fetchItems();
        return true;
      }
      set({ error: 'Failed to delete document' });
      return false;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  createItem: async (item) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.knowledge.create(item);
      if (result.success) {
        const { fetchItems, currentPage } = get();
        await fetchItems(undefined, currentPage);
        return result.id || null;
      }
      set({ error: result.error || 'Failed to create item' });
      return null;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      return null;
    } finally {
      set({ loading: false });
    }
  },

  updateItem: async (id, updates) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.knowledge.update(id, updates);
      if (result.success) {
        const { fetchItems, currentPage } = get();
        await fetchItems(undefined, currentPage);
        return true;
      }
      set({ error: result.error || 'Failed to update item' });
      return false;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  deleteItem: async (id) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.knowledge.delete(id);
      if (result.success) {
        // 重新获取数据，如果当前页为空则返回上一页
        const state = get();
        const pageSize = state.currentPageSize || 20;
        const totalPages = Math.ceil(Math.max(0, (state.totalItems || 0) - 1) / pageSize);
        const adjustedPage = totalPages < 1 ? 1 : Math.min(state.currentPage, totalPages);
        await state.fetchItems(undefined, adjustedPage, pageSize);
        return true;
      }
      set({ error: result.error || 'Failed to delete item' });
      return false;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  deleteBatchItems: async (ids: string[]) => {
    set({ loading: true, error: null });
    try {
      let count = 0;
      for (const id of ids) {
        const result = await window.electronAPI.knowledge.delete(id);
        if (result.success) {
          count++;
        }
      }
      const { fetchItems, currentPage } = get();
      await fetchItems(undefined, currentPage);
      return count;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      return 0;
    } finally {
      set({ loading: false });
    }
  },

  searchItems: async (query, options) => {
    set({ isSearching: true, error: null });
    try {
      const result = await window.electronAPI.knowledge.search(query, options);
      if (result.success) {
        set({ searchResults: result.results || [] });
      } else {
        set({ error: result.error || 'Search failed' });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      set({ isSearching: false });
    }
  },

  vectorizeItem: async (id) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.knowledge.vectorize(id);
      if (!result.success) {
        set({ error: result.error || 'Vectorize failed' });
      }
      return result.success;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  vectorizeAll: async () => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.knowledge.vectorizeAll();
      if (result.success) {
        return result.count || 0;
      }
      set({ error: 'Vectorize all failed' });
      return 0;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      return 0;
    } finally {
      set({ loading: false });
    }
  },

  uploadDocument: async (filePath, options) => {
    set({ isUploading: true, uploadProgress: null, error: null });
    try {
      const result = await window.electronAPI.knowledge.uploadDocument(filePath, options);
      if (result.success) {
        const { fetchItems, currentPage } = get();
        await fetchItems(undefined, currentPage);
      } else {
        set({ error: result.error || 'Upload failed' });
      }
      return result;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      set({ isUploading: false, uploadProgress: null });
    }
  },

  selectDocumentFile: async () => {
    return await window.electronAPI.knowledge.selectDocumentFile();
  },

  setUploadProgress: (progress) => set({ uploadProgress: progress }),

  selectItem: (id) => set({ selectedId: id }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error })
}));
