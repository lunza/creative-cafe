import { create } from 'zustand';
import { WritingProject, WritingConfig, ExportFormat, ChapterOutline } from '../../shared/types/writing.types';
import { MAX_UNDO_HISTORY, AUTO_SAVE_DELAY } from '../../shared/constants/writing.constants';

interface OutlineHistoryEntry {
  chapters: ChapterOutline[];
  description: string;
  timestamp: number;
}

interface WritingProjectState {
  projects: WritingProject[];
  currentProjectId: string | null;
  isLoading: boolean;
  outlineHistory: OutlineHistoryEntry[];
  outlineHistoryIndex: number;
  isSaving: boolean;
  autoSaveTimer: NodeJS.Timeout | null;

  loadProjects: () => Promise<void>;
  createProject: (config: WritingConfig) => Promise<string>;
  updateProject: (id: string, updates: Partial<WritingProject>) => Promise<void>;
  deleteProject: (id: string) => Promise<boolean>;
  setCurrentProject: (id: string | null) => void;
  saveProject: () => Promise<void>;
  exportProject: (id: string, format: ExportFormat) => Promise<void>;
  getCurrentProject: () => WritingProject | null;
  getProjectById: (id: string) => WritingProject | null;
  pushOutlineHistory: (chapters: ChapterOutline[], description: string) => void;
  undoOutline: () => ChapterOutline[] | null;
  redoOutline: () => ChapterOutline[] | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  updateOutline: (chapters: ChapterOutline[]) => void;
  triggerAutoSave: () => void;
}

export const useWritingProjectStore = create<WritingProjectState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  isLoading: false,
  outlineHistory: [],
  outlineHistoryIndex: -1,
  isSaving: false,
  autoSaveTimer: null,

  loadProjects: async () => {
    set({ isLoading: true });
    try {
      if (window.electronAPI && window.electronAPI.writing) {
        const result = await window.electronAPI.writing.loadProjects();
        if (result.success) {
          const seenIds = new Set<string>();
          const uniqueProjects = result.projects.filter((p) => {
            if (seenIds.has(p.id)) {
              return false;
            }
            seenIds.add(p.id);
            return true;
          });
          set({ projects: uniqueProjects, isLoading: false });
        } else {
          set({ isLoading: false });
        }
      } else {
        set({ projects: [], isLoading: false });
      }
    } catch (error) {
      console.error('Failed to load writing projects:', error);
      set({ projects: [], isLoading: false });
    }
  },

  createProject: async (config) => {
    if (window.electronAPI && window.electronAPI.writing) {
      const result = await window.electronAPI.writing.createProject(config);
      if (result.success) {
        set({ currentProjectId: result.projectId });
        await get().loadProjects();
        return result.projectId;
      }
    }
    return '';
  },

  updateProject: async (id, updates) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
      )
    }));
    await get().saveProject();
  },

  deleteProject: async (id) => {
    if (window.electronAPI && window.electronAPI.writing) {
      const result = await window.electronAPI.writing.deleteProject(id);
      if (result.success) {
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          currentProjectId: state.currentProjectId === id ? null : state.currentProjectId
        }));
        return true;
      }
    }
    return false;
  },

  setCurrentProject: (id) => {
    set({ currentProjectId: id });
  },

  saveProject: async () => {
    const { projects, currentProjectId } = get();
    if (!currentProjectId) return;
    const project = projects.find((p) => p.id === currentProjectId);
    if (!project) return;

    if (window.electronAPI && window.electronAPI.writing) {
      await window.electronAPI.writing.saveProject(project);
    }
  },

  exportProject: async (id, format) => {
    if (window.electronAPI && window.electronAPI.writing) {
      await window.electronAPI.writing.exportProject(id, format);
    }
  },

  getCurrentProject: () => {
    const { projects, currentProjectId } = get();
    if (!currentProjectId) return null;
    return projects.find((p) => p.id === currentProjectId) || null;
  },

  getProjectById: (id) => {
    const { projects } = get();
    return projects.find((p) => p.id === id) || null;
  },

  pushOutlineHistory: (chapters, description) => {
    const { outlineHistory, outlineHistoryIndex } = get();
    const newHistory = outlineHistory.slice(0, outlineHistoryIndex + 1);
    newHistory.push({
      chapters: chapters.map(c => ({ ...c })),
      description,
      timestamp: Date.now()
    });
    const trimmedHistory = newHistory.length > MAX_UNDO_HISTORY
      ? newHistory.slice(-MAX_UNDO_HISTORY)
      : newHistory;
    set({
      outlineHistory: trimmedHistory,
      outlineHistoryIndex: trimmedHistory.length - 1
    });
  },

  undoOutline: () => {
    const { outlineHistory, outlineHistoryIndex } = get();
    if (outlineHistoryIndex <= 0) return null;
    const newIndex = outlineHistoryIndex - 1;
    set({ outlineHistoryIndex: newIndex });
    return outlineHistory[newIndex].chapters.map(c => ({ ...c }));
  },

  redoOutline: () => {
    const { outlineHistory, outlineHistoryIndex } = get();
    if (outlineHistoryIndex >= outlineHistory.length - 1) return null;
    const newIndex = outlineHistoryIndex + 1;
    set({ outlineHistoryIndex: newIndex });
    return outlineHistory[newIndex].chapters.map(c => ({ ...c }));
  },

  canUndo: () => {
    return get().outlineHistoryIndex > 0;
  },

  canRedo: () => {
    const { outlineHistory, outlineHistoryIndex } = get();
    return outlineHistoryIndex < outlineHistory.length - 1;
  },

  updateOutline: (chapters) => {
    get().pushOutlineHistory(chapters, '更新大纲');
    get().triggerAutoSave();
  },

  triggerAutoSave: () => {
    const { autoSaveTimer } = get();
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }
    set({ isSaving: true });
    const timer = setTimeout(async () => {
      await get().saveProject();
      set({ isSaving: false, autoSaveTimer: null });
    }, AUTO_SAVE_DELAY);
    set({ autoSaveTimer: timer });
  }
}));
