import { create } from 'zustand';
import { rendererEmbeddingService } from '../services/rendererEmbeddingService';

interface TestResult {
  success: boolean;
  mode: string;
  dimension?: number;
  vectorCount?: number;
  error?: string;
  details?: string;
}

interface VectorState {
  mode: 'remote' | 'local';
  dimension: number;
  isConnected: boolean;
  totalVectors: number;
  loading: boolean;
  error: string | null;
  lastTestResult: TestResult | null;

  setMode: (mode: 'remote' | 'local') => Promise<void>;
  testConnection: () => Promise<TestResult>;
  testStorage: () => Promise<TestResult>;
  embed: (text: string) => Promise<number[]>;
  search: (query: number[], topK: number, filter?: Record<string, any>) => Promise<any[]>;
  addVector: (id: string, vector: number[], metadata: Record<string, any>) => Promise<void>;
  deleteVector: (id: string) => Promise<void>;
  rebuildIndex: () => Promise<void>;
  getCount: () => Promise<number>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearTestResult: () => void;
}

export const useVectorStore = create<VectorState>((set, get) => ({
  mode: 'remote',
  dimension: 0,
  isConnected: false,
  totalVectors: 0,
  loading: false,
  error: null,
  lastTestResult: null,

  setMode: async (mode) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.embedding.setMode(mode);
      if (result.success) {
        set({ mode });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      set({ loading: false });
    }
  },

  testConnection: async (config?: any) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.embedding.testConnection(config);
      const testResult: TestResult = {
        success: result.success,
        mode: result.mode,
        dimension: result.dimension,
        error: result.error,
        details: result.details,
      };

      if (result.success) {
        set({ isConnected: true, dimension: result.dimension || 0, lastTestResult: testResult });
      } else {
        set({ isConnected: false, error: result.error || 'Connection failed', lastTestResult: testResult });
      }
      return testResult;
    } catch (error) {
      const testResult: TestResult = {
        success: false,
        mode: 'unknown',
        dimension: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      set({ isConnected: false, error: testResult.error, lastTestResult: testResult });
      return testResult;
    } finally {
      set({ loading: false });
    }
  },

  testStorage: async () => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.vector.testStorage();
      const testResult: TestResult = {
        success: result.success,
        mode: result.mode,
        vectorCount: result.vectorCount,
        error: result.error,
        details: result.details,
      };

      if (result.success) {
        set({ totalVectors: result.vectorCount, lastTestResult: testResult });
      } else {
        set({ error: result.error || 'Storage test failed', lastTestResult: testResult });
      }
      return testResult;
    } catch (error) {
      const testResult: TestResult = {
        success: false,
        mode: 'unknown',
        vectorCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      set({ error: testResult.error, lastTestResult: testResult });
      return testResult;
    } finally {
      set({ loading: false });
    }
  },

  embed: async (text: string) => {
    set({ loading: true, error: null });
    try {
      const currentState = get();
      const currentMode = currentState.mode;
      
      let result;
      if (currentMode === 'local') {
        result = await rendererEmbeddingService.generateLocalEmbedding(text);
      } else {
        result = await window.electronAPI.embedding.generate(text);
      }
      
      if (result.success && result.vector) {
        return result.vector;
      }
      throw new Error(result.error || 'Embedding failed');
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  search: async (query, topK, filter) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.vector.search(query, topK, filter);
      if (result.success && result.results) {
        return result.results;
      }
      throw new Error(result.error || 'Search failed');
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  addVector: async (id, vector, metadata) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.vector.add(id, vector, metadata);
      if (!result.success) {
        throw new Error(result.error || 'Add vector failed');
      }
      const count = await get().getCount();
      set({ totalVectors: count });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  deleteVector: async (id) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.vector.delete(id);
      if (!result.success) {
        throw new Error(result.error || 'Delete vector failed');
      }
      const count = await get().getCount();
      set({ totalVectors: count });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  rebuildIndex: async () => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.vector.rebuildIndex();
      if (!result.success) {
        throw new Error(result.error || 'Rebuild index failed');
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  getCount: async () => {
    try {
      const result = await window.electronAPI.vector.count();
      if (result.success) {
        set({ totalVectors: result.count });
        return result.count;
      }
      return 0;
    } catch (error) {
      return 0;
    }
  },

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  clearTestResult: () => set({ lastTestResult: null, error: null, isConnected: false })
}));
