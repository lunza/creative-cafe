/**
 * V2 项目 store（持久化投影）
 *
 * Spec: refactor-writing-mode-v2 / 架构规则 1（单一真相源）：
 * 项目实体（DB）是唯一真相源，本 store 只是其内存投影。
 * 任何写操作 = 更新投影 + 防抖落盘（AUTO_SAVE_DELAY），
 * 不在内存中保存第二份 outline/chapters 持久副本。
 */
import { create } from 'zustand';
import type { WritingProject, WritingConfig } from '../../../../../shared/types/writing-v2.types';
import { getWritingV2API } from '../../../../services/writingV2Service';
import { AUTO_SAVE_DELAY } from '../../../../../shared/constants/writing.constants';

// 防抖定时器放在模块级（非 state），避免定时器变化触发无意义重渲染
let saveTimer: ReturnType<typeof setTimeout> | null = null;

interface V2ProjectState {
  projects: WritingProject[];
  currentProjectId: string | null;
  isLoading: boolean;
  isSaving: boolean;
  /** 最近一次创建项目失败的错误详情（UI 展示用） */
  lastCreateError: string | null;

  loadProjects: () => Promise<void>;
  createProject: (config: WritingConfig) => Promise<string | null>;
  deleteProject: (id: string) => Promise<boolean>;
  selectProject: (id: string | null) => void;
  getCurrentProject: () => WritingProject | null;
  /** 更新指定项目字段（投影 + 防抖落盘） */
  patchProject: (id: string, patch: Partial<WritingProject>) => void;
}

function flushSave(project: WritingProject): void {
  const api = getWritingV2API();
  if (!api) return;
  api.saveProject(project)
    .then((res) => {
      if (!res.success) {
        console.error('[V2ProjectStore] 落盘失败:', res.error);
      }
    })
    .catch((err) => console.error('[V2ProjectStore] 落盘异常:', err));
}

export const useV2ProjectStore = create<V2ProjectState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  isLoading: false,
  isSaving: false,
  lastCreateError: null,

  loadProjects: async () => {
    const api = getWritingV2API();
    if (!api) return;
    set({ isLoading: true });
    try {
      const result = await api.loadProjects();
      if (result.success) {
        // 按更新时间倒序，最近项目在前
        const sorted = [...result.projects].sort((a, b) => b.updatedAt - a.updatedAt);
        set({ projects: sorted, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch (err) {
      console.error('[V2ProjectStore] loadProjects 失败:', err);
      set({ isLoading: false });
    }
  },

  createProject: async (config) => {
    const api = getWritingV2API();
    if (!api) {
      set({ lastCreateError: '写作 2.0 API 不可用（preload writingV2 命名空间缺失）' });
      return null;
    }
    try {
      const result = await api.createProject(config);
      if (result.success && result.projectId) {
        set({ lastCreateError: null });
        await get().loadProjects();
        set({ currentProjectId: result.projectId });
        return result.projectId;
      }
      // 不再吞错：记录真实错误供 UI 展示
      set({ lastCreateError: result.error || '主进程返回失败（无错误详情）' });
      return null;
    } catch (err) {
      console.error('[V2ProjectStore] createProject 失败:', err);
      set({ lastCreateError: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  deleteProject: async (id) => {
    const api = getWritingV2API();
    if (!api) return false;
    try {
      const result = await api.deleteProject(id);
      if (result.success) {
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          currentProjectId: state.currentProjectId === id ? null : state.currentProjectId,
        }));
        return true;
      }
      return false;
    } catch (err) {
      console.error('[V2ProjectStore] deleteProject 失败:', err);
      return false;
    }
  },

  selectProject: (id) => set({ currentProjectId: id }),

  getCurrentProject: () => {
    const { projects, currentProjectId } = get();
    if (!currentProjectId) return null;
    return projects.find((p) => p.id === currentProjectId) || null;
  },

  patchProject: (id, patch) => {
    let updated: WritingProject | undefined;
    set((state) => ({
      isSaving: true,
      projects: state.projects.map((p) => {
        if (p.id !== id) return p;
        updated = { ...p, ...patch, updatedAt: Date.now(), lastSavedAt: Date.now() };
        return updated;
      }),
    }));
    if (!updated) return;
    const toSave: WritingProject = updated;
    // 防抖落盘（单一真相源 = 项目实体）
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      set({ isSaving: false });
      flushSave(toSave);
    }, AUTO_SAVE_DELAY);
  },
}));
