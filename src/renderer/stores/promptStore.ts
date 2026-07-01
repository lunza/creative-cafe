import { create } from 'zustand';
import type {
  PromptTemplate,
  PromptHistoryRecord,
  ValidationResult,
} from '../../shared/types/promptTemplate.types';

interface PromptStoreState {
  templates: PromptTemplate[];
  selectedModuleId: string | null;
  loading: boolean;
  error: string | null;

  loadTemplates: () => Promise<void>;
  selectModule: (moduleId: string) => void;
  saveTemplate: (template: PromptTemplate, changeSummary: string) => Promise<boolean>;
  resetTemplate: (moduleId: string) => Promise<boolean>;
  getHistory: (moduleId: string) => Promise<PromptHistoryRecord[]>;
  rollback: (moduleId: string, version: number) => Promise<boolean>;
  clearHistory: (moduleId: string) => Promise<boolean>;
  validateTemplate: (template: PromptTemplate) => Promise<ValidationResult | null>;
}

const MODIFIED_BY = 'user';

export const usePromptStore = create<PromptStoreState>((set, get) => ({
  templates: [],
  selectedModuleId: null,
  loading: false,
  error: null,

  loadTemplates: async () => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.prompt.getAll();
      if (result.success && result.data) {
        const templates = result.data as PromptTemplate[];
        set({ templates, loading: false });
        if (!get().selectedModuleId && templates.length > 0) {
          set({ selectedModuleId: templates[0].moduleId });
        }
      } else {
        set({ error: result.error || '加载提示词模板失败', loading: false });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '加载提示词模板时发生错误';
      set({ error: msg, loading: false });
    }
  },

  selectModule: (moduleId: string) => {
    set({ selectedModuleId: moduleId });
  },

  saveTemplate: async (template, changeSummary) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.prompt.save(template, MODIFIED_BY, changeSummary);
      if (result.success && result.data) {
        const saved = result.data as PromptTemplate;
        const templates = get().templates.map((t) => (t.moduleId === saved.moduleId ? saved : t));
        set({ templates, loading: false });
        return true;
      }
      set({ error: result.error || '保存提示词模板失败', loading: false });
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : '保存提示词模板时发生错误';
      set({ error: msg, loading: false });
      return false;
    }
  },

  resetTemplate: async (moduleId) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.prompt.reset(moduleId);
      if (result.success && result.data) {
        const reset = result.data as PromptTemplate;
        const templates = get().templates.map((t) => (t.moduleId === moduleId ? reset : t));
        set({ templates, loading: false });
        return true;
      }
      set({ error: result.error || '重置提示词模板失败', loading: false });
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : '重置提示词模板时发生错误';
      set({ error: msg, loading: false });
      return false;
    }
  },

  getHistory: async (moduleId) => {
    try {
      const result = await window.electronAPI.prompt.getHistory(moduleId);
      if (result.success && result.data) {
        return result.data as PromptHistoryRecord[];
      }
      set({ error: result.error || '获取历史记录失败' });
      return [];
    } catch (error) {
      const msg = error instanceof Error ? error.message : '获取历史记录时发生错误';
      set({ error: msg });
      return [];
    }
  },

  rollback: async (moduleId, version) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electronAPI.prompt.rollback(moduleId, version, MODIFIED_BY);
      if (result.success && result.data) {
        const rolled = result.data as PromptTemplate;
        const templates = get().templates.map((t) => (t.moduleId === moduleId ? rolled : t));
        set({ templates, loading: false });
        return true;
      }
      set({ error: result.error || '回滚提示词模板失败', loading: false });
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : '回滚提示词模板时发生错误';
      set({ error: msg, loading: false });
      return false;
    }
  },

  clearHistory: async (moduleId) => {
    set({ error: null });
    try {
      const result = await window.electronAPI.prompt.clearHistory(moduleId);
      if (result.success) {
        return true;
      }
      set({ error: result.error || '清空历史记录失败' });
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : '清空历史记录时发生错误';
      set({ error: msg });
      return false;
    }
  },

  validateTemplate: async (template) => {
    try {
      const result = await window.electronAPI.prompt.validate(template);
      if (result.success && result.data) {
        return result.data as ValidationResult;
      }
      set({ error: result.error || '验证提示词模板失败' });
      return null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : '验证提示词模板时发生错误';
      set({ error: msg });
      return null;
    }
  },
}));
