import { create } from 'zustand';
import { WritingProject, WritingConfig, ExportFormat } from '../../shared/types/writing.types';

interface WritingProjectState {
  projects: WritingProject[];
  currentProjectId: string | null;
  isLoading: boolean;

  loadProjects: () => Promise<void>;
  createProject: (config: WritingConfig) => Promise<string>;
  updateProject: (id: string, updates: Partial<WritingProject>) => void;
  deleteProject: (id: string) => Promise<boolean>;
  setCurrentProject: (id: string | null) => void;
  saveProject: () => Promise<void>;
  exportProject: (id: string, format: ExportFormat) => Promise<void>;
  getCurrentProject: () => WritingProject | null;
  getProjectById: (id: string) => WritingProject | null;
}

export const useWritingProjectStore = create<WritingProjectState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  isLoading: false,

  loadProjects: async () => {
    set({ isLoading: true });
    try {
      if (window.electronAPI && window.electronAPI.writing) {
        const result = await window.electronAPI.writing.loadProjects();
        if (result.success) {
          set({ projects: result.projects, isLoading: false });
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

  updateProject: (id, updates) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
      )
    }));
    get().saveProject();
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
  }
}));
