import { create } from 'zustand';
import { useLogStore } from './logStore';
import { AUTO_SAVE_DELAY } from '../../shared/constants/writing.constants';

// ========== log helper ==========
const addLog = (message: string, type: 'error' | 'warn' | 'info' | 'debug' = 'info', options?: {
  details?: string;
  error?: Error;
  context?: any;
  category?: 'system' | 'ai' | 'setting' | 'network' | 'user' | 'other';
}) => {
  try {
    useLogStore.getState().addLog(message, type, options);
  } catch (e) {
    console.log(`[${type.toUpperCase()}] ${message}`);
    if (options?.context) {
      console.log('Context:', options.context);
    }
  }
};

// ========== types ==========
interface Version {
  id: string;
  content: string;
  timestamp: number;
  description?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface CharacterCard {
  id: string;
  name: string;
  content: string;
  versions: Version[];
  chatHistory: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  image?: string;
}

interface WorldBook {
  id: string;
  name: string;
  content: string;
  versions: Version[];
  chatHistory: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface Creative {
  id: string;
  title: string;
  description: string;
  content: string;
  tags: string[];
  characterCard: CharacterCard | null;
  worldBook: WorldBook | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Common shape shared by CharacterCard and WorldBook. Used by the artifact slice
 * factory so a single implementation can drive both kinds. Both concrete types
 * are assignable to this base; the factory casts when writing back to the
 * Creative field (CharacterCard carries an optional `image` field that the
 * shared CRUD operations never touch).
 */
interface BaseArtifact {
  id: string;
  name: string;
  content: string;
  versions: Version[];
  chatHistory: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface CreativeStore {
  creatives: Creative[];
  currentCreativeId: string | null;
  currentEditorTarget: 'character' | 'worldbook' | null;
  isLoading: boolean;

  // 创意操作
  addCreative: (title: string, description: string, tags?: string[]) => string;
  updateCreative: (id: string, updates: Partial<Creative>) => boolean;
  deleteCreative: (id: string) => boolean;
  setCurrentCreativeId: (id: string | null) => void;
  setCurrentEditorTarget: (target: 'character' | 'worldbook' | null) => void;

  // 角色卡操作
  setCharacterCard: (creativeId: string, name: string, content?: string) => string;
  updateCharacterCard: (creativeId: string, updates: Partial<CharacterCard>) => boolean;
  removeCharacterCard: (creativeId: string) => boolean;
  addCharacterCardVersion: (creativeId: string, content: string, description?: string) => void;
  addCharacterCardChatMessage: (creativeId: string, message: ChatMessage) => void;
  clearCharacterCardChatHistory: (creativeId: string) => void;

  // 世界书操作
  setWorldBook: (creativeId: string, name: string, content?: string) => string;
  updateWorldBook: (creativeId: string, updates: Partial<WorldBook>) => boolean;
  removeWorldBook: (creativeId: string) => boolean;
  addWorldBookVersion: (creativeId: string, content: string, description?: string) => void;
  addWorldBookChatMessage: (creativeId: string, message: ChatMessage) => void;
  clearWorldBookChatHistory: (creativeId: string) => void;

  // 数据操作
  loadCreatives: () => Promise<void>;
  saveCreatives: () => Promise<void>;
  clearCreatives: () => void;
  exportData: () => Promise<string | null>;
  importData: (data: string) => Promise<void>;

  // 获取函数
  getCurrentCreative: () => Creative | null;
  getCreativeById: (id: string) => Creative | null;
  getCurrentEditorContent: () => string;
}

// ========== debounced save ==========
// 模块级 timer，避免每次 render 重建；参考 writingProjectStore 的 AUTO_SAVE_DELAY 策略。
// `saveCreatives` 现在只负责调度，真正的 IPC 写入由 performSave 在静默期结束后执行一次。
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function performSave(get: () => CreativeStore): Promise<void> {
  try {
    if (window.electronAPI && window.electronAPI.creative) {
      const { creatives, currentCreativeId, currentEditorTarget } = get();
      await window.electronAPI.creative.save({ creatives, currentCreativeId, currentEditorTarget });
    }
  } catch (error) {
    addLog('保存创意数据失败', 'error', {
      category: 'system',
      error: error instanceof Error ? error : undefined,
      context: {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorLocation: 'creativeStore.ts:saveCreatives',
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      },
      details: '保存创意数据时发生错误，请检查文件系统权限。'
    });
  }
}

function scheduleDebouncedSave(get: () => CreativeStore): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void performSave(get);
  }, AUTO_SAVE_DELAY);
}

// ========== artifact slice factory ==========
type ArtifactFieldName = 'characterCard' | 'worldBook';

interface ArtifactSliceConfig {
  /** Creative 上对应字段名 */
  fieldName: ArtifactFieldName;
  /** 新建 artifact 的 ID 前缀 */
  idPrefix: string;
  /** 选中该 artifact 时写入的 currentEditorTarget 值 */
  editorTarget: 'character' | 'worldbook';
}

interface ArtifactSliceMethods {
  setArtifact: (creativeId: string, name: string, content?: string) => string;
  updateArtifact: (creativeId: string, updates: Partial<BaseArtifact>) => boolean;
  removeArtifact: (creativeId: string) => boolean;
  addArtifactVersion: (creativeId: string, content: string, description?: string) => void;
  addArtifactChatMessage: (creativeId: string, message: ChatMessage) => void;
  clearArtifactChatHistory: (creativeId: string) => void;
}

type CreativeSet = (
  partial: Partial<CreativeStore> | ((state: CreativeStore) => Partial<CreativeStore>)
) => void;
type CreativeGet = () => CreativeStore;

/**
 * 工厂函数：为 character / worldbook 两种 artifact 生成同一份 CRUD 实现。
 * 通过 fieldName 动态访问 Creative 上的字段，避免 12 个方法的复制粘贴。
 * 所有状态写入均走 `set((state) => ...)` 回调形式，避免在 set 之外读取
 * 整数组后整体替换（替代原本的 `[...creatives]` spread 模式）。
 */
function createArtifactSlice(
  set: CreativeSet,
  get: CreativeGet,
  config: ArtifactSliceConfig
): ArtifactSliceMethods {
  const { fieldName, idPrefix, editorTarget } = config;

  /** 用更新后的 artifact 替换指定 creative 的对应字段，返回新的 creatives 数组 */
  const patchCreativeArtifact = (
    creatives: Creative[],
    creativeId: string,
    next: BaseArtifact | null
  ): Creative[] => {
    const now = Date.now();
    return creatives.map((c) =>
      c.id === creativeId
        ? ({ ...c, [fieldName]: next, updatedAt: now } as Creative)
        : c
    );
  };

  const setArtifact: ArtifactSliceMethods['setArtifact'] = (creativeId, name, content) => {
    const now = Date.now();
    let newId = '';

    set((state) => {
      const creative = state.creatives.find((c) => c.id === creativeId);
      if (!creative) return {};

      const existing = creative[fieldName] as BaseArtifact | null;
      const id = existing?.id || `${idPrefix}_${now}_${Math.random().toString(36).substr(2, 9)}`;
      newId = id;

      // 与原实现保持一致：首次有 content -> "初始版本"；存在 existing -> "更新版本"；否则空数组。
      const versions: Version[] =
        content && !existing
          ? [{ id: `version_${now}`, content, timestamp: now, description: '初始版本' }]
          : existing
            ? [
                { id: `version_${now}`, content: content as string, timestamp: now, description: '更新版本' },
                ...existing.versions.slice(0, 19)
              ]
            : [];

      const newArtifact: BaseArtifact = {
        id,
        name,
        content: content || '',
        versions,
        chatHistory: existing?.chatHistory || [],
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };

      return {
        creatives: patchCreativeArtifact(state.creatives, creativeId, newArtifact),
        currentEditorTarget: editorTarget
      };
    });

    get().saveCreatives();
    return newId;
  };

  const updateArtifact: ArtifactSliceMethods['updateArtifact'] = (creativeId, updates) => {
    let success = false;

    set((state) => {
      const creative = state.creatives.find((c) => c.id === creativeId);
      const existing = (creative?.[fieldName] as BaseArtifact | null) ?? null;
      if (!creative || !existing) return {};

      const now = Date.now();
      const updatedArtifact: BaseArtifact = {
        ...existing,
        ...updates,
        updatedAt: now
      };
      success = true;
      return { creatives: patchCreativeArtifact(state.creatives, creativeId, updatedArtifact) };
    });

    if (success) get().saveCreatives();
    return success;
  };

  const removeArtifact: ArtifactSliceMethods['removeArtifact'] = (creativeId) => {
    let success = false;

    set((state) => {
      const creative = state.creatives.find((c) => c.id === creativeId);
      if (!creative) return {};
      success = true;
      const nextEditorTarget =
        state.currentEditorTarget === editorTarget ? null : state.currentEditorTarget;
      return {
        creatives: patchCreativeArtifact(state.creatives, creativeId, null),
        currentEditorTarget: nextEditorTarget
      };
    });

    if (success) get().saveCreatives();
    return success;
  };

  const addArtifactVersion: ArtifactSliceMethods['addArtifactVersion'] = (creativeId, content, description) => {
    set((state) => {
      const creative = state.creatives.find((c) => c.id === creativeId);
      const existing = (creative?.[fieldName] as BaseArtifact | null) ?? null;
      if (!creative || !existing) return {};

      const now = Date.now();
      const newVersion: Version = {
        id: `version_${now}`,
        content,
        timestamp: now,
        description
      };
      const updatedArtifact: BaseArtifact = {
        ...existing,
        content,
        versions: [newVersion, ...existing.versions.slice(0, 19)],
        updatedAt: now
      };
      return { creatives: patchCreativeArtifact(state.creatives, creativeId, updatedArtifact) };
    });

    get().saveCreatives();
  };

  const addArtifactChatMessage: ArtifactSliceMethods['addArtifactChatMessage'] = (creativeId, message) => {
    set((state) => {
      const creative = state.creatives.find((c) => c.id === creativeId);
      const existing = (creative?.[fieldName] as BaseArtifact | null) ?? null;
      if (!creative || !existing) return {};

      const now = Date.now();
      const updatedArtifact: BaseArtifact = {
        ...existing,
        chatHistory: [...existing.chatHistory, message],
        updatedAt: now
      };
      return { creatives: patchCreativeArtifact(state.creatives, creativeId, updatedArtifact) };
    });

    get().saveCreatives();
  };

  const clearArtifactChatHistory: ArtifactSliceMethods['clearArtifactChatHistory'] = (creativeId) => {
    set((state) => {
      const creative = state.creatives.find((c) => c.id === creativeId);
      const existing = (creative?.[fieldName] as BaseArtifact | null) ?? null;
      if (!creative || !existing) return {};

      const now = Date.now();
      const updatedArtifact: BaseArtifact = {
        ...existing,
        chatHistory: [],
        updatedAt: now
      };
      return { creatives: patchCreativeArtifact(state.creatives, creativeId, updatedArtifact) };
    });

    get().saveCreatives();
  };

  return {
    setArtifact,
    updateArtifact,
    removeArtifact,
    addArtifactVersion,
    addArtifactChatMessage,
    clearArtifactChatHistory
  };
}

// ========== store ==========
const useCreativeStore = create<CreativeStore>((set, get) => {
  // 通过工厂生成两个 artifact slice，再把方法别名映射到 CreativeStore 接口名上。
  // 这样外部调用方完全无感知（setCharacterCard / setWorldBook 等签名保持不变）。
  const characterSlice = createArtifactSlice(set, get, {
    fieldName: 'characterCard',
    idPrefix: 'character',
    editorTarget: 'character'
  });
  const worldbookSlice = createArtifactSlice(set, get, {
    fieldName: 'worldBook',
    idPrefix: 'worldbook',
    editorTarget: 'worldbook'
  });

  return {
    creatives: [],
    currentCreativeId: null,
    currentEditorTarget: null,
    isLoading: true,

    // ========== 创意操作 ==========
    addCreative: (title, description, tags, content = '') => {
      const now = Date.now();
      const newCreative: Creative = {
        id: `creative_${now}_${Math.random().toString(36).substr(2, 9)}`,
        title,
        description,
        content,
        tags: tags || [],
        characterCard: null,
        worldBook: null,
        createdAt: now,
        updatedAt: now
      };

      set((state) => ({
        creatives: [newCreative, ...state.creatives],
        currentCreativeId: newCreative.id
      }));

      get().saveCreatives();
      return newCreative.id;
    },

    updateCreative: (id, updates) => {
      let success = false;
      set((state) => {
        const idx = state.creatives.findIndex((c) => c.id === id);
        if (idx === -1) return {};
        success = true;
        const now = Date.now();
        const updatedCreatives = state.creatives.map((c, i) =>
          i === idx ? { ...c, ...updates, updatedAt: now } : c
        );
        return { creatives: updatedCreatives };
      });
      if (success) get().saveCreatives();
      return success;
    },

    deleteCreative: (id) => {
      set((state) => {
        const updatedCreatives = state.creatives.filter((c) => c.id !== id);
        const newCurrentId =
          state.currentCreativeId === id
            ? updatedCreatives.length > 0
              ? updatedCreatives[0].id
              : null
            : state.currentCreativeId;
        return {
          creatives: updatedCreatives,
          currentCreativeId: newCurrentId,
          currentEditorTarget: null
        };
      });
      get().saveCreatives();
      return true;
    },

    setCurrentCreativeId: (id) => {
      set({ currentCreativeId: id, currentEditorTarget: null });
      get().saveCreatives();
    },

    setCurrentEditorTarget: (target) => {
      set({ currentEditorTarget: target });
    },

    // ========== 角色卡操作（由 createArtifactSlice 生成） ==========
    setCharacterCard: characterSlice.setArtifact,
    updateCharacterCard: characterSlice.updateArtifact,
    removeCharacterCard: characterSlice.removeArtifact,
    addCharacterCardVersion: characterSlice.addArtifactVersion,
    addCharacterCardChatMessage: characterSlice.addArtifactChatMessage,
    clearCharacterCardChatHistory: characterSlice.clearArtifactChatHistory,

    // ========== 世界书操作（由 createArtifactSlice 生成） ==========
    setWorldBook: worldbookSlice.setArtifact,
    updateWorldBook: worldbookSlice.updateArtifact,
    removeWorldBook: worldbookSlice.removeArtifact,
    addWorldBookVersion: worldbookSlice.addArtifactVersion,
    addWorldBookChatMessage: worldbookSlice.addArtifactChatMessage,
    clearWorldBookChatHistory: worldbookSlice.clearArtifactChatHistory,

    // ========== 数据操作 ==========
    loadCreatives: async () => {
      set({ isLoading: true });
      try {
        if (window.electronAPI && window.electronAPI.creative) {
          const data = await window.electronAPI.creative.load();
          set({
            creatives: data?.creatives || [],
            currentCreativeId: data?.currentCreativeId || null,
            currentEditorTarget: data?.currentEditorTarget || null,
            isLoading: false
          });
        } else {
          console.log('Electron API not available, using mock data for testing');
          set({
            creatives: [],
            currentCreativeId: null,
            currentEditorTarget: null,
            isLoading: false
          });
        }
      } catch (error) {
        addLog('加载创意数据失败', 'error', {
          category: 'system',
          error: error instanceof Error ? error : undefined,
          context: {
            errorType: error instanceof Error ? error.name : 'UnknownError',
            errorLocation: 'creativeStore.ts:loadCreatives',
            errorMessage: error instanceof Error ? error.message : 'Unknown error'
          },
          details: '加载创意数据时发生错误，请检查文件系统权限和数据文件是否存在。'
        });
        set({ creatives: [], currentCreativeId: null, currentEditorTarget: null, isLoading: false });
      }
    },

    /**
     * 防抖保存：高频 mutation（如 chat 输入）只会在静默 AUTO_SAVE_DELAY 后触发一次 IPC 写入。
     * 没有外部调用方 await 此方法（全仓库仅 creativeStore.ts 内部 fire-and-forget 调用），
     * 因此将其改为调度式不会影响外部行为。
     */
    saveCreatives: async () => {
      scheduleDebouncedSave(get);
    },

    clearCreatives: () => {
      set({ creatives: [], currentCreativeId: null, currentEditorTarget: null });
      get().saveCreatives();
    },

    exportData: async () => {
      try {
        if (window.electronAPI && window.electronAPI.creative) {
          return await window.electronAPI.creative.export();
        } else {
          console.error('Electron API not available');
          return null;
        }
      } catch (error) {
        addLog('导出创意数据失败', 'error', {
          category: 'system',
          error: error instanceof Error ? error : undefined,
          context: {
            errorType: error instanceof Error ? error.name : 'UnknownError',
            errorLocation: 'creativeStore.ts:exportData',
            errorMessage: error instanceof Error ? error.message : 'Unknown error'
          },
          details: '导出创意数据时发生错误，请检查文件系统权限。'
        });
        return null;
      }
    },

    importData: async (data) => {
      try {
        if (window.electronAPI && window.electronAPI.creative) {
          const result = await window.electronAPI.creative.import(data);
          if (result.success) {
            await get().loadCreatives();
          }
        } else {
          console.error('Electron API not available');
        }
      } catch (error) {
        addLog('导入创意数据失败', 'error', {
          category: 'system',
          error: error instanceof Error ? error : undefined,
          context: {
            errorType: error instanceof Error ? error.name : 'UnknownError',
            errorLocation: 'creativeStore.ts:importData',
            errorMessage: error instanceof Error ? error.message : 'Unknown error'
          },
          details: '导入创意数据时发生错误，请检查数据格式是否正确。'
        });
      }
    },

    // ========== 获取函数 ==========
    getCurrentCreative: () => {
      const { creatives, currentCreativeId } = get();
      if (!currentCreativeId) return null;
      return creatives.find((c) => c.id === currentCreativeId) || null;
    },

    getCreativeById: (id) => {
      const { creatives } = get();
      return creatives.find((c) => c.id === id) || null;
    },

    getCurrentEditorContent: () => {
      const { creatives, currentCreativeId, currentEditorTarget } = get();
      if (!currentCreativeId || !currentEditorTarget) return '';

      const creative = creatives.find((c) => c.id === currentCreativeId);
      if (!creative) return '';

      if (currentEditorTarget === 'character') {
        return creative.characterCard?.content || '';
      } else {
        return creative.worldBook?.content || '';
      }
    }
  };
});

export { useCreativeStore };
export type { Creative, CharacterCard, WorldBook, Version, ChatMessage };
