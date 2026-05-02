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
  version: number;
  metadata: Record<string, any>;
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

  fetchItems: (filter?: Record<string, any>, page?: number, pageSize?: number) => Promise<void>;
  createItem: (item: KnowledgeItem) => Promise<string | null>;
  updateItem: (id: string, updates: Partial<KnowledgeItem>) => Promise<boolean>;
  deleteItem: (id: string) => Promise<boolean>;
  searchItems: (query: string, options?: any) => Promise<void>;
  vectorizeItem: (id: string) => Promise<boolean>;
  vectorizeAll: () => Promise<number>;
  selectItem: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
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
        const { fetchItems, currentPage } = get();
        await fetchItems(undefined, currentPage);
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
        return result.processed || 0;
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

  selectItem: (id) => set({ selectedId: id }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error })
}));
