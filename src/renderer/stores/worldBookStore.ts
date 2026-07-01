import { create } from 'zustand';
import type {
  WorldBookMeta,
  WorldBookData,
  WorldBookEntry,
  WorldBookTag,
  WorldBookTagAssociation,
  WorldBookTagData,
} from '../types/worldBook';

interface WorldBookState {
  worldBooks: WorldBookMeta[];
  loading: boolean;
  error: string | null;
  worldBookDir: string;
  currentWorldBook: WorldBookData | null;
  currentWorldBookPath: string | null;
  tags: WorldBookTag[];
  associations: WorldBookTagAssociation[];
  fetchWorldBooks: () => Promise<void>;
  readWorldBook: (path: string) => Promise<WorldBookData | null>;
  writeWorldBook: (path: string, data: WorldBookData) => Promise<boolean>;
  deleteWorldBook: (path: string) => Promise<boolean>;
  optimizeWorldBook: (path: string) => Promise<boolean>;
  setDirectory: (dir: string) => Promise<boolean>;
  getDirectory: () => Promise<string>;
  readTags: (worldBookPath: string) => Promise<WorldBookTagData | null>;
  writeTags: (worldBookPath: string, data: WorldBookTagData) => Promise<boolean>;
  addEntry: (path: string, entry: WorldBookEntry) => Promise<boolean>;
  updateEntry: (path: string, uid: string | number, updates: Partial<WorldBookEntry>) => Promise<boolean>;
  deleteEntry: (path: string, uid: string | number) => Promise<boolean>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setCurrentWorldBook: (data: WorldBookData | null, path: string | null) => void;
  setTags: (tags: WorldBookTag[], associations: WorldBookTagAssociation[]) => void;
  // Task 15.3: 同步设置世界书目录路径（替代 useWorldBookFormState 中的本地 useState 副本）。
  // 与 setDirectory 不同，本方法不调用 IPC，仅更新 store 状态。
  setWorldBookDir: (dir: string) => void;
  clearCurrentWorldBook: () => void;
}

export const useWorldBookStore = create<WorldBookState>((set, get) => ({
  worldBooks: [],
  loading: false,
  error: null,
  worldBookDir: '',
  currentWorldBook: null,
  currentWorldBookPath: null,
  tags: [],
  associations: [],

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  setCurrentWorldBook: (data, path) => set({ currentWorldBook: data, currentWorldBookPath: path }),
  setTags: (tags, associations) => set({ tags, associations }),
  // Task 15.3: 同步设置 worldBookDir，仅更新 store 状态，不调用 IPC。
  setWorldBookDir: (dir) => set({ worldBookDir: dir }),

  clearCurrentWorldBook: () => set({
    currentWorldBook: null,
    currentWorldBookPath: null,
    tags: [],
    associations: [],
  }),

  fetchWorldBooks: async () => {
    set({ loading: true, error: null });
    try {
      const worldBooks = await window.electronAPI.worldBook.list();
      set({ worldBooks: worldBooks || [], loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch world books';
      set({ error: msg, loading: false, worldBooks: [] });
    }
  },

  readWorldBook: async (path: string) => {
    try {
      const data = await window.electronAPI.worldBook.read(path);
      if (data) {
        set({ currentWorldBook: data, currentWorldBookPath: path });
      }
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to read world book';
      set({ error: msg });
      return null;
    }
  },

  writeWorldBook: async (path: string, data: WorldBookData) => {
    try {
      const result = await window.electronAPI.worldBook.write(path, data);
      if (result && result.success) {
        return true;
      }
      return false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to write world book';
      set({ error: msg });
      return false;
    }
  },

  deleteWorldBook: async (path: string) => {
    try {
      const result = await window.electronAPI.worldBook.delete(path);
      return !!(result && result.success);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete world book';
      set({ error: msg });
      return false;
    }
  },

  optimizeWorldBook: async (path: string) => {
    try {
      const result = await window.electronAPI.worldBook.optimize(path);
      if (result && result.success) {
        return true;
      }
      return false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to optimize world book';
      set({ error: msg });
      return false;
    }
  },

  setDirectory: async (dir: string) => {
    try {
      const result = await window.electronAPI.worldBook.setDirectory(dir);
      if (result && result.success) {
        set({ worldBookDir: result.worldBookDir || dir });
        return true;
      }
      return false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to set world book directory';
      set({ error: msg });
      return false;
    }
  },

  getDirectory: async () => {
    try {
      const dir = await window.electronAPI.worldBook.getDirectory();
      set({ worldBookDir: dir || '' });
      return dir || '';
    } catch {
      return '';
    }
  },

  readTags: async (worldBookPath: string) => {
    try {
      const data = await window.electronAPI.worldBook.readTags(worldBookPath);
      if (data) {
        set({
          tags: data.tags || [],
          associations: data.associations || [],
        });
      }
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to read tags';
      set({ error: msg });
      return null;
    }
  },

  writeTags: async (worldBookPath: string, data: WorldBookTagData) => {
    try {
      const result = await window.electronAPI.worldBook.writeTags(worldBookPath, data);
      if (result && result.success) {
        set({ tags: data.tags, associations: data.associations });
        return true;
      }
      return false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to write tags';
      set({ error: msg });
      return false;
    }
  },

  addEntry: async (path: string, entry: WorldBookEntry) => {
    try {
      const current = get().currentWorldBook;
      if (!current) return false;
      const updated = {
        ...current,
        entries: { ...current.entries, [entry.uid]: entry },
      };
      return await get().writeWorldBook(path, updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add entry';
      set({ error: msg });
      return false;
    }
  },

  updateEntry: async (path: string, uid: string | number, updates: Partial<WorldBookEntry>) => {
    try {
      const current = get().currentWorldBook;
      if (!current || !current.entries[uid]) return false;
      const updatedEntry = { ...current.entries[uid], ...updates };
      const updated = {
        ...current,
        entries: { ...current.entries, [uid]: updatedEntry },
      };
      return await get().writeWorldBook(path, updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update entry';
      set({ error: msg });
      return false;
    }
  },

  deleteEntry: async (path: string, uid: string | number) => {
    try {
      const current = get().currentWorldBook;
      if (!current) return false;
      const { [uid as keyof typeof current.entries]: _, ...remainingEntries } = current.entries;
      const updated = { ...current, entries: remainingEntries };
      return await get().writeWorldBook(path, updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete entry';
      set({ error: msg });
      return false;
    }
  },
}));
