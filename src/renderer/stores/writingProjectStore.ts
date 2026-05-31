import { create } from 'zustand';
import { WritingProject, WritingConfig, ExportFormat, ChapterOutline } from '../../shared/types/writing.types';
import { AUTO_SAVE_DELAY } from '../../shared/constants/writing.constants';

interface WritingProjectState {
  projects: WritingProject[];
  currentProjectId: string | null;
  isLoading: boolean;
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
  updateOutline: (chapters: ChapterOutline[]) => void;
  triggerAutoSave: () => void;
}

export const useWritingProjectStore = create<WritingProjectState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  isLoading: false,
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
    if (!currentProjectId) {
      console.warn('[writingProjectStore] saveProject: no currentProjectId');
      return;
    }
    const project = projects.find((p) => p.id === currentProjectId);
    if (!project) {
      console.warn('[writingProjectStore] saveProject: project not found for id:', currentProjectId);
      return;
    }

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

  updateOutline: (chapters) => {
    const { currentProjectId, projects } = get();
    if (!currentProjectId) {
      return;
    }

    const updatedProjects = projects.map(project => {
      if (project.id === currentProjectId) {
        const updatedProject = { ...project };
        if (!project.outline) {
          updatedProject.outline = { chapters, version: 1 };
        } else {
          updatedProject.outline = {
            ...project.outline,
            chapters,
            version: (project.outline.version || 1) + 1
          };
        }
        
        return updatedProject;
      }
      return project;
    });

    set({
      projects: updatedProjects
    });

    get().triggerAutoSave();
  },

  triggerAutoSave: () => {
    const { autoSaveTimer } = get();
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }
    set({ isSaving: true });
    const timer = setTimeout(async () => {
      try {
        await get().saveProject();
      } catch (error) {
        console.error('[writingProjectStore] triggerAutoSave: save error:', error);
      }
      set({ isSaving: false, autoSaveTimer: null });
    }, AUTO_SAVE_DELAY);
    set({ autoSaveTimer: timer });
  }
}));
