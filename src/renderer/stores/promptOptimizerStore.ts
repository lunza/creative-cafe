import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  PromptGenerationRequest,
  PromptGenerationResponse,
  PromptOptimizationRequest,
  PromptOptimizationResponse,
  PromptHistory,
  PromptTemplate,
  PreviewRequest,
  PreviewResponse,
  PaginationRequest,
  PaginationResponse,
  TemplateCategory,
  OptimizationGoal
} from '../types/promptOptimizer';
import { promptOptimizerService } from '../services/promptOptimizerService';

interface PromptOptimizerState {
  // 生成状态
  isGenerating: boolean;
  generationResult: PromptGenerationResponse | null;
  
  // 优化状态
  isOptimizing: boolean;
  optimizationResult: PromptOptimizationResponse | null;
  
  // 预览状态
  isPreviewing: boolean;
  previewResult: PreviewResponse | null;
  
  // 历史记录
  history: PromptHistory[];
  historyPagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  
  // 模板
  templates: PromptTemplate[];
  selectedCategory: TemplateCategory | null;
  
  // 当前编辑的提示词
  currentPrompt: string;
  
  // Actions
  generatePrompt: (request: PromptGenerationRequest) => Promise<void>;
  optimizePrompt: (request: PromptOptimizationRequest) => Promise<void>;
  previewPrompt: (request: PreviewRequest) => Promise<void>;
  
  // 历史记录管理
  loadHistory: (pagination?: PaginationRequest) => void;
  deleteHistory: (id: string) => void;
  updateHistoryTags: (id: string, tags: string[]) => void;
  searchHistory: (query: string) => PromptHistory[];
  
  // 模板管理
  loadTemplates: (category?: TemplateCategory) => void;
  createTemplate: (template: Omit<PromptTemplate, 'id' | 'usageCount' | 'isBuiltin' | 'createdAt' | 'updatedAt'>) => void;
  updateTemplate: (id: string, updates: Partial<PromptTemplate>) => void;
  deleteTemplate: (id: string) => void;
  toggleFavoriteTemplate: (id: string) => void;
  applyTemplate: (templateId: string, variables: Record<string, string>) => string;
  
  // 工具方法
  setCurrentPrompt: (prompt: string) => void;
  clearGenerationResult: () => void;
  clearOptimizationResult: () => void;
  clearPreviewResult: () => void;
  exportData: () => string;
  importData: (jsonData: string) => boolean;
}

export const usePromptOptimizerStore = create<PromptOptimizerState>()(
  persist(
    (set, get) => ({
      // 初始状态
      isGenerating: false,
      generationResult: null,
      isOptimizing: false,
      optimizationResult: null,
      isPreviewing: false,
      previewResult: null,
      history: [],
      historyPagination: {
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 0
      },
      templates: [],
      selectedCategory: null,
      currentPrompt: '',

      // 生成提示词
      generatePrompt: async (request) => {
        set({ isGenerating: true });
        try {
          const response = await promptOptimizerService.generatePrompt(request);
          if (response.success && response.data) {
            set({ 
              generationResult: response.data,
              currentPrompt: response.data.systemPrompt
            });
            // 刷新历史记录
            get().loadHistory();
          }
        } catch (error) {
          console.error('Failed to generate prompt:', error);
        } finally {
          set({ isGenerating: false });
        }
      },

      // 优化提示词
      optimizePrompt: async (request) => {
        set({ isOptimizing: true });
        try {
          const response = await promptOptimizerService.optimizePrompt(request);
          if (response.success && response.data) {
            set({ 
              optimizationResult: response.data,
              currentPrompt: response.data.optimizedPrompt
            });
            // 刷新历史记录
            get().loadHistory();
          }
        } catch (error) {
          console.error('Failed to optimize prompt:', error);
        } finally {
          set({ isOptimizing: false });
        }
      },

      // 预览提示词
      previewPrompt: async (request) => {
        set({ isPreviewing: true });
        try {
          const response = await promptOptimizerService.previewPrompt(request);
          if (response.success && response.data) {
            set({ previewResult: response.data });
          }
        } catch (error) {
          console.error('Failed to preview prompt:', error);
        } finally {
          set({ isPreviewing: false });
        }
      },

      // 加载历史记录
      loadHistory: (pagination = { page: 1, pageSize: 10 }) => {
        const response = promptOptimizerService.getHistory(pagination);
        if (response.success && response.data) {
          set({
            history: response.data.items,
            historyPagination: {
              page: response.data.page,
              pageSize: response.data.pageSize,
              total: response.data.total,
              totalPages: response.data.totalPages
            }
          });
        }
      },

      // 删除历史记录
      deleteHistory: (id) => {
        const response = promptOptimizerService.deleteHistory(id);
        if (response.success) {
          get().loadHistory();
        }
      },

      // 更新历史记录标签
      updateHistoryTags: (id, tags) => {
        const response = promptOptimizerService.updateHistoryTags(id, tags);
        if (response.success) {
          get().loadHistory();
        }
      },

      // 搜索历史记录
      searchHistory: (query) => {
        const response = promptOptimizerService.searchHistory(query);
        return response.data || [];
      },

      // 加载模板
      loadTemplates: (category) => {
        const response = promptOptimizerService.getTemplates(category);
        if (response.success) {
          set({ 
            templates: response.data || [],
            selectedCategory: category || null
          });
        }
      },

      // 创建模板
      createTemplate: (template) => {
        const response = promptOptimizerService.createTemplate(template);
        if (response.success) {
          get().loadTemplates(get().selectedCategory || undefined);
        }
      },

      // 更新模板
      updateTemplate: (id, updates) => {
        const response = promptOptimizerService.updateTemplate(id, updates);
        if (response.success) {
          get().loadTemplates(get().selectedCategory || undefined);
        }
      },

      // 删除模板
      deleteTemplate: (id) => {
        const response = promptOptimizerService.deleteTemplate(id);
        if (response.success) {
          get().loadTemplates(get().selectedCategory || undefined);
        }
      },

      // 切换收藏状态
      toggleFavoriteTemplate: (id) => {
        const response = promptOptimizerService.toggleFavoriteTemplate(id);
        if (response.success) {
          get().loadTemplates(get().selectedCategory || undefined);
        }
      },

      // 应用模板
      applyTemplate: (templateId, variables) => {
        const response = promptOptimizerService.applyTemplate(templateId, variables);
        if (response.success && response.data) {
          set({ currentPrompt: response.data });
          return response.data;
        }
        return '';
      },

      // 设置当前提示词
      setCurrentPrompt: (prompt) => {
        set({ currentPrompt: prompt });
      },

      // 清除生成结果
      clearGenerationResult: () => {
        set({ generationResult: null });
      },

      // 清除优化结果
      clearOptimizationResult: () => {
        set({ optimizationResult: null });
      },

      // 清除预览结果
      clearPreviewResult: () => {
        set({ previewResult: null });
      },

      // 导出数据
      exportData: () => {
        const response = promptOptimizerService.exportHistory();
        return response.data || '';
      },

      // 导入数据
      importData: (jsonData) => {
        const response = promptOptimizerService.importHistory(jsonData);
        if (response.success) {
          get().loadHistory();
          get().loadTemplates();
          return true;
        }
        return false;
      }
    }),
    {
      name: 'prompt-optimizer-storage',
      partialize: (state) => ({
        currentPrompt: state.currentPrompt
      })
    }
  )
);
