/**
 * 角色卡视觉特征 Zustand store（Spec: add-asset-and-trait-management / Task 3）
 *
 * 职责：
 * - 持有当前角色卡的特征 tag 数组（traits），顺序代表用户优先级
 * - 封装所有 `window.electronAPI.characterTrait.*` IPC 调用，对外暴露同步/异步 actions
 * - 提供「编辑态」与「持久化态」分离：addTrait / removeTrait / updateTrait / setTraits 仅修改本地 state，
 *   调用方在合适时机（如「保存」按钮点击）调用 saveTraits 一次性持久化，支持批量编辑后统一保存
 * - setTraits 用于 AI 生成特征（Task 13）后批量替换本地 state，用户可逐条修改后点击「保存」持久化
 *
 * 设计要点：
 * - 不持久化到 localStorage：特征数据由主进程 characterTraitService 持久化到磁盘
 *   （`{userData}/data/character-assets/{sha256(characterCardId).slice(0,16)}/traits.json`），
 *   此 store 仅作为运行期缓存与 IPC 适配层，每次进入角色卡编辑界面重新拉取
 * - 所有 actions 包裹 try/catch，永不向调用方抛出异常，统一通过返回值 `{ success, error? }` 传递错误
 * - `traits` 在 set 时均通过浅拷贝构造新引用，确保 React 通过引用相等感知变更
 * - saveTraits 采用「乐观更新 + 失败回滚」策略：先 set 本地 state 再调 IPC，失败时回滚到旧 traits
 *
 * 参考：src/renderer/stores/expressionStore.ts（无 persist 的 IPC 适配 store 模式）
 *      src/main/services/characterTraitService.ts（主进程持久化实现）
 *      src/main/ipc/handlers/characterTraitHandlers.ts（IPC handler）
 */

import { create } from 'zustand';

// ==================== 类型定义 ====================

/**
 * 角色卡特征 store 状态。
 *
 * 字段说明：
 * - `currentCharacterCardId`：当前加载的角色卡 ID（用于校验缓存归属，切换角色卡时会被覆盖）
 * - `traits`：特征 tag 数组，顺序代表用户优先级（前置特征优先级更高）
 * - `loading`：加载中标志
 * - `error`：最近一次错误信息（null 表示无错误）
 *
 * Actions 说明：
 * - `loadTraits`：异步，从主进程拉取 traits 并设置 currentCharacterCardId
 * - `saveTraits`：异步，乐观更新 + 失败回滚，将指定 traits 持久化到主进程
 * - `addTrait` / `removeTrait` / `updateTrait` / `setTraits`：同步，仅修改本地 state（不调 IPC），
 *   调用方需在合适时机调用 saveTraits 持久化
 * - `setTraits`：批量替换本地 traits 数组，用于 AI 生成特征后填入编辑区（Task 13）
 * - `clear`：重置所有状态
 */
interface CharacterTraitState {
  /** 当前加载的角色卡 ID（null 表示尚未加载） */
  currentCharacterCardId: string | null;
  /** 特征 tag 数组，顺序代表用户优先级（前置优先级更高） */
  traits: string[];
  /** 角色外观描述（中文自然语言，AI 生成特征时自动提取，可手动编辑） */
  appearanceDescription: string;
  /** 加载中标志 */
  loading: boolean;
  /** 最近一次错误信息（null 表示无错误） */
  error: string | null;

  // -------- Actions --------

  /**
   * 加载指定角色卡的特征 tag 数组与外观描述。
   * - 调用 `window.electronAPI.characterTrait.list` 拉取 traits
   * - 调用 `window.electronAPI.characterTrait.loadDescription` 拉取外观描述
   * - 设置 traits + appearanceDescription + currentCharacterCardId
   * - 文件不存在或解析失败时主进程返回 [] / ''，本 store 透传空值
   */
  loadTraits: (characterCardId: string) => Promise<void>;

  /**
   * 保存特征 tag 数组与外观描述（乐观更新 + 失败回滚）。
   * - 保存旧 traits / appearanceDescription 引用
   * - 先 `set({ traits, appearanceDescription })` 更新本地 state
   * - 调用 `window.electronAPI.characterTrait.save` 持久化
   * - 失败时回滚到旧值
   * - 返回 `{ success, error? }`
   */
  saveTraits: (
    characterCardId: string,
    traits: string[],
    appearanceDescription?: string
  ) => Promise<{ success: boolean; error?: string }>;

  /**
   * 追加单个特征 tag（仅本地 state，不调 IPC）。
   * - trim 后非空且不重复（与已有 traits 比对，大小写敏感）则追加到末尾
   * - 调用方需在合适时机调用 saveTraits 持久化
   * - 返回 `{ success, error? }`，重复或空串时 success=false
   */
  addTrait: (trait: string) => { success: boolean; error?: string };

  /**
   * 移除指定 index 的特征 tag（仅本地 state，不调 IPC）。
   * - 越界 index 返回 `{ success: false, error: 'index 越界' }`
   * - 调用方需在合适时机调用 saveTraits 持久化
   */
  removeTrait: (index: number) => { success: boolean; error?: string };

  /**
   * 更新指定 index 的特征 tag（仅本地 state，不调 IPC）。
   * - 越界 index 返回 `{ success: false, error: 'index 越界' }`
   * - trim 后为空串返回 `{ success: false, error: '特征不能为空' }`
   * - 新值与已有其他 trait 重复（排除当前 index）返回 `{ success: false, error: '特征已存在' }`
   * - 调用方需在合适时机调用 saveTraits 持久化
   */
  updateTrait: (index: number, newValue: string) => { success: boolean; error?: string };

  /**
   * 批量替换本地特征 tag 数组（仅本地 state，不调 IPC）。
   * - 用于 AI 生成特征后填入编辑区，用户可逐条修改后点击 saveTraits 持久化
   * - 入参会做防御性处理：非数组转为空数组，每个元素 trim + 过滤空串 + 去重
   * - 返回 `{ success: true }`（此 action 永不失败）
   */
  setTraits: (traits: string[]) => { success: boolean; error?: string };

  /**
   * 设置角色外观描述（仅本地 state，不调 IPC）。
   * - 用于 AI 生成特征后填入描述，或用户手动编辑
   * - 调用方需在合适时机调用 saveTraits 持久化
   * - 返回 `{ success: true }`（此 action 永不失败）
   */
  setAppearanceDescription: (description: string) => { success: boolean; error?: string };

  /** 重置所有状态（离开角色卡编辑界面时调用） */
  clear: () => void;
}

// ==================== Store 实现 ====================

export const useCharacterTraitStore = create<CharacterTraitState>((set, get) => ({
  currentCharacterCardId: null,
  traits: [],
  appearanceDescription: '',
  loading: false,
  error: null,

  loadTraits: async (characterCardId: string) => {
    if (!characterCardId) {
      console.warn('[characterTraitStore] loadTraits: characterCardId 为空，跳过加载');
      return;
    }

    set({ loading: true, error: null, currentCharacterCardId: characterCardId });

    try {
      if (!window.electronAPI?.characterTrait) {
        console.warn(
          '[characterTraitStore] loadTraits: window.electronAPI.characterTrait 不可用'
        );
        set({
          loading: false,
          error: 'electronAPI.characterTrait 不可用',
          traits: [],
          appearanceDescription: '',
        });
        return;
      }

      // 并行拉取 traits 与外观描述
      const [traits, description] = await Promise.all([
        window.electronAPI.characterTrait.list(characterCardId),
        window.electronAPI.characterTrait.loadDescription(characterCardId),
      ]);

      // 防御性兜底：list 理论上必返回数组，但若 IPC 异常可能返回 null/undefined
      const safeTraits: string[] = Array.isArray(traits) ? traits : [];
      const safeDescription: string = typeof description === 'string' ? description : '';

      set({
        traits: safeTraits,
        appearanceDescription: safeDescription,
        loading: false,
        error: null,
      });
    } catch (error) {
      console.error('[characterTraitStore] loadTraits failed:', error);
      set({
        loading: false,
        error: error instanceof Error ? error.message : '加载特征失败',
      });
    }
  },

  saveTraits: async (characterCardId: string, traits: string[], appearanceDescription?: string) => {
    try {
      if (!window.electronAPI?.characterTrait) {
        return { success: false, error: 'electronAPI.characterTrait 不可用' };
      }

      // 乐观更新 + 失败回滚：先保存旧值引用，更新本地 state，调 IPC 失败时回滚
      const prevTraits = get().traits;
      const prevDescription = get().appearanceDescription;
      // 若未传入 appearanceDescription，使用当前 state 中的值
      const descToSave = appearanceDescription !== undefined ? appearanceDescription : prevDescription;
      set({ traits: [...traits], appearanceDescription: descToSave });

      const result = await window.electronAPI.characterTrait.save({
        characterCardId,
        traits,
        appearanceDescription: descToSave,
      });

      if (!result?.success) {
        // 失败回滚到旧值
        set({ traits: prevTraits, appearanceDescription: prevDescription });
        return { success: false, error: result?.error ?? '保存特征失败' };
      }

      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] saveTraits failed:', error);
      // 异常情况下也尝试回滚（prevTraits 已在 try 块外捕获不到，这里只能维持当前 state）
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存特征失败',
      };
    }
  },

  addTrait: (trait: string) => {
    try {
      const trimmed = (trait ?? '').trim();
      if (!trimmed) {
        return { success: false, error: '特征不能为空' };
      }

      const { traits } = get();
      // 大小写敏感去重
      if (traits.includes(trimmed)) {
        return { success: false, error: '特征已存在' };
      }

      // 浅拷贝构造新引用，追加到末尾
      set({ traits: [...traits, trimmed] });
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] addTrait failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '添加特征失败',
      };
    }
  },

  removeTrait: (index: number) => {
    try {
      const { traits } = get();
      if (index < 0 || index >= traits.length) {
        return { success: false, error: 'index 越界' };
      }

      // 浅拷贝构造新引用，过滤掉指定 index
      const nextTraits = traits.filter((_, i) => i !== index);
      set({ traits: nextTraits });
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] removeTrait failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '移除特征失败',
      };
    }
  },

  updateTrait: (index: number, newValue: string) => {
    try {
      const { traits } = get();
      if (index < 0 || index >= traits.length) {
        return { success: false, error: 'index 越界' };
      }

      const trimmed = (newValue ?? '').trim();
      if (!trimmed) {
        return { success: false, error: '特征不能为空' };
      }

      // 与已有其他 trait 比对（排除当前 index）
      const duplicate = traits.some((t, i) => i !== index && t === trimmed);
      if (duplicate) {
        return { success: false, error: '特征已存在' };
      }

      // 浅拷贝构造新引用，更新指定 index
      const nextTraits = traits.map((t, i) => (i === index ? trimmed : t));
      set({ traits: nextTraits });
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] updateTrait failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '更新特征失败',
      };
    }
  },

  setTraits: (traits: string[]) => {
    try {
      const safeTraits = Array.isArray(traits)
        ? Array.from(
            new Set(
              traits
                .map((t) => (typeof t === 'string' ? t.trim() : ''))
                .filter((t) => t.length > 0)
            )
          )
        : [];
      set({ traits: safeTraits });
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] setTraits failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '设置特征失败',
      };
    }
  },

  setAppearanceDescription: (description: string) => {
    try {
      const safeDescription = typeof description === 'string' ? description : '';
      set({ appearanceDescription: safeDescription });
      return { success: true };
    } catch (error) {
      console.error('[characterTraitStore] setAppearanceDescription failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '设置外观描述失败',
      };
    }
  },

  clear: () => {
    set({
      currentCharacterCardId: null,
      traits: [],
      appearanceDescription: '',
      loading: false,
      error: null,
    });
  },
}));

// ==================== 类型导出 ====================

export type { CharacterTraitState };
