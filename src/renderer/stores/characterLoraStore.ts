/**
 * 角色卡 LoRA 模型 Zustand store（2026-07-29 bug 修复）
 *
 * 【重点标记 - 按角色独立存储 LoRA】
 *
 * 职责：
 * - 持有当前角色卡的 LoRA 模型列表（loras），每项含 name 和 weight
 * - 封装所有 `window.electronAPI.characterLora.*` IPC 调用
 * - 提供「乐观更新 + 失败回滚」的 saveLoras action
 *
 * 设计要点：
 * - 不持久化到 localStorage：LoRA 数据由主进程 characterLoraService 持久化到磁盘
 *   （`{userData}/data/character-loras/{sha256(characterCardId).slice(0,16)}/loras.json`）
 * - 所有 actions 包裹 try/catch，永不向调用方抛出异常
 * - `loras` 在 set 时均通过浅拷贝构造新引用，确保 React 通过引用相等感知变更
 *
 * 参考：src/renderer/stores/characterTraitStore.ts（无 persist 的 IPC 适配 store 模式）
 *      src/main/services/characterLoraService.ts（主进程持久化实现）
 */

import { create } from 'zustand';

/** LoRA 模型项 */
export interface LoraItem {
  name: string;
  weight: number;
}

interface CharacterLoraState {
  /** 当前加载的角色卡 ID（null 表示尚未加载） */
  currentCharacterCardId: string | null;
  /** LoRA 模型列表 */
  loras: LoraItem[];
  /** 加载中标志 */
  loading: boolean;
  /** 最近一次错误信息（null 表示无错误） */
  error: string | null;

  // -------- Actions --------

  /**
   * 加载指定角色卡的 LoRA 模型清单。
   * - 调用 `window.electronAPI.characterLora.list` 拉取 loras
   * - 文件不存在或解析失败时主进程返回 []，本 store 透传空值
   */
  loadLoras: (characterCardId: string) => Promise<void>;

  /**
   * 保存 LoRA 模型清单（乐观更新 + 失败回滚）。
   * - 先 set 本地 state，再调 IPC 持久化
   * - 失败时回滚到旧值
   * - 返回 `{ success, error? }`
   */
  saveLoras: (
    characterCardId: string,
    loras: LoraItem[]
  ) => Promise<{ success: boolean; error?: string }>;

  /** 批量替换本地 LoRA 列表（仅本地 state，不调 IPC） */
  setLoras: (loras: LoraItem[]) => void;

  /** 重置所有状态 */
  clear: () => void;
}

export const useCharacterLoraStore = create<CharacterLoraState>((set, get) => ({
  currentCharacterCardId: null,
  loras: [],
  loading: false,
  error: null,

  loadLoras: async (characterCardId: string) => {
    if (!characterCardId) {
      console.warn('[characterLoraStore] loadLoras: characterCardId 为空，跳过加载');
      return;
    }

    set({ loading: true, error: null, currentCharacterCardId: characterCardId });

    try {
      if (!window.electronAPI?.characterLora) {
        console.warn(
          '[characterLoraStore] loadLoras: window.electronAPI.characterLora 不可用'
        );
        set({
          loading: false,
          error: 'electronAPI.characterLora 不可用',
          loras: [],
        });
        return;
      }

      const loras = await window.electronAPI.characterLora.list(characterCardId);

      const safeLoras: LoraItem[] = Array.isArray(loras) ? loras : [];

      set({
        loras: safeLoras,
        loading: false,
        error: null,
      });
    } catch (error) {
      console.error('[characterLoraStore] loadLoras failed:', error);
      set({
        loading: false,
        error: error instanceof Error ? error.message : '加载 LoRA 失败',
      });
    }
  },

  saveLoras: async (characterCardId: string, loras: LoraItem[]) => {
    try {
      if (!window.electronAPI?.characterLora) {
        return { success: false, error: 'electronAPI.characterLora 不可用' };
      }

      // 乐观更新 + 失败回滚
      const prevLoras = get().loras;
      set({ loras: [...loras] });

      const result = await window.electronAPI.characterLora.save({
        characterCardId,
        loras,
      });

      if (!result?.success) {
        // 失败回滚到旧值
        set({ loras: prevLoras });
        return { success: false, error: result?.error ?? '保存 LoRA 失败' };
      }

      return { success: true };
    } catch (error) {
      console.error('[characterLoraStore] saveLoras failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存 LoRA 失败',
      };
    }
  },

  setLoras: (loras: LoraItem[]) => {
    set({ loras: Array.isArray(loras) ? [...loras] : [] });
  },

  clear: () => {
    set({
      currentCharacterCardId: null,
      loras: [],
      loading: false,
      error: null,
    });
  },
}));
