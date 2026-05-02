import { create } from 'zustand';
import { useLogStore } from './logStore';

// 直接从 logStore 获取 addLog 方法
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
  characterCard: CharacterCard | null;  // 改为单个对象
  worldBook: WorldBook | null;          // 改为单个对象
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

const useCreativeStore = create<CreativeStore>((set, get) => ({
  creatives: [],
  currentCreativeId: null,
  currentEditorTarget: null,
  isLoading: true,

  // ========== 创意操作 ==========
  addCreative: (title, description, tags, content = '') => {
    const newCreative: Creative = {
      id: `creative_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title,
      description,
      content,
      tags: tags || [],
      characterCard: null,
      worldBook: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    const updatedCreatives = [newCreative, ...get().creatives];
    set({ creatives: updatedCreatives, currentCreativeId: newCreative.id });
    
    get().saveCreatives();
    return newCreative.id;
  },

  updateCreative: (id, updates) => {
    const { creatives } = get();
    const creativeIndex = creatives.findIndex(c => c.id === id);
    if (creativeIndex === -1) return false;
    
    const updatedCreative = {
      ...creatives[creativeIndex],
      ...updates,
      updatedAt: Date.now()
    };
    
    const updatedCreatives = [...creatives];
    updatedCreatives[creativeIndex] = updatedCreative;
    set({ creatives: updatedCreatives });
    
    get().saveCreatives();
    return true;
  },

  deleteCreative: (id) => {
    const { creatives, currentCreativeId } = get();
    const updatedCreatives = creatives.filter(c => c.id !== id);
    
    const newCurrentId = currentCreativeId === id ? (updatedCreatives.length > 0 ? updatedCreatives[0].id : null) : currentCreativeId;
    
    set({ creatives: updatedCreatives, currentCreativeId: newCurrentId, currentEditorTarget: null });
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

  // ========== 角色卡操作 ==========
  setCharacterCard: (creativeId, name, content) => {
    const { creatives } = get();
    const creativeIndex = creatives.findIndex(c => c.id === creativeId);
    if (creativeIndex === -1) return '';
    
    const existingCard = creatives[creativeIndex].characterCard;
    const now = Date.now();
    
    const newCharacterCard: CharacterCard = {
      id: existingCard?.id || `character_${now}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      content: content || '',
      versions: content && !existingCard ? [{
        id: `version_${now}`,
        content,
        timestamp: now,
        description: '初始版本'
      }] : existingCard ? [{
        id: `version_${now}`,
        content,
        timestamp: now,
        description: '更新版本'
      }, ...existingCard.versions.slice(0, 19)] : [],
      chatHistory: existingCard?.chatHistory || [],
      createdAt: existingCard?.createdAt || now,
      updatedAt: now
    };
    
    const updatedCreative = {
      ...creatives[creativeIndex],
      characterCard: newCharacterCard,
      updatedAt: now
    };
    
    const updatedCreatives = [...creatives];
    updatedCreatives[creativeIndex] = updatedCreative;
    set({ creatives: updatedCreatives, currentEditorTarget: 'character' });
    
    get().saveCreatives();
    return newCharacterCard.id;
  },

  updateCharacterCard: (creativeId, updates) => {
    const { creatives } = get();
    const creativeIndex = creatives.findIndex(c => c.id === creativeId);
    if (creativeIndex === -1 || !creatives[creativeIndex].characterCard) return false;
    
    const creative = creatives[creativeIndex];
    const existingCard = creative.characterCard!;
    
    const updatedCharacterCard = {
      ...existingCard,
      ...updates,
      updatedAt: Date.now()
    };
    
    const updatedCreative = {
      ...creative,
      characterCard: updatedCharacterCard,
      updatedAt: Date.now()
    };
    
    const updatedCreatives = [...creatives];
    updatedCreatives[creativeIndex] = updatedCreative;
    set({ creatives: updatedCreatives });
    
    get().saveCreatives();
    return true;
  },

  removeCharacterCard: (creativeId) => {
    const { creatives, currentEditorTarget } = get();
    const creativeIndex = creatives.findIndex(c => c.id === creativeId);
    if (creativeIndex === -1) return false;
    
    const updatedCreative = {
      ...creatives[creativeIndex],
      characterCard: null,
      updatedAt: Date.now()
    };
    
    const updatedCreatives = [...creatives];
    updatedCreatives[creativeIndex] = updatedCreative;
    
    let newEditorTarget = currentEditorTarget;
    if (currentEditorTarget === 'character') {
      newEditorTarget = null;
    }
    
    set({ creatives: updatedCreatives, currentEditorTarget: newEditorTarget });
    get().saveCreatives();
    return true;
  },

  addCharacterCardVersion: (creativeId, content, description) => {
    const { creatives } = get();
    const creativeIndex = creatives.findIndex(c => c.id === creativeId);
    if (creativeIndex === -1 || !creatives[creativeIndex].characterCard) return;
    
    const creative = creatives[creativeIndex];
    const existingCard = creative.characterCard!;
    
    const newVersion: Version = {
      id: `version_${Date.now()}`,
      content,
      timestamp: Date.now(),
      description
    };
    
    const updatedVersions = [newVersion, ...existingCard.versions.slice(0, 19)];
    
    const updatedCharacterCard = {
      ...existingCard,
      content,
      versions: updatedVersions,
      updatedAt: Date.now()
    };
    
    const updatedCreative = {
      ...creative,
      characterCard: updatedCharacterCard,
      updatedAt: Date.now()
    };
    
    const updatedCreatives = [...creatives];
    updatedCreatives[creativeIndex] = updatedCreative;
    set({ creatives: updatedCreatives });
    
    get().saveCreatives();
  },

  addCharacterCardChatMessage: (creativeId, message) => {
    const { creatives } = get();
    const creativeIndex = creatives.findIndex(c => c.id === creativeId);
    if (creativeIndex === -1 || !creatives[creativeIndex].characterCard) return;
    
    const creative = creatives[creativeIndex];
    const existingCard = creative.characterCard!;
    
    const updatedChatHistory = [...existingCard.chatHistory, message];
    
    const updatedCharacterCard = {
      ...existingCard,
      chatHistory: updatedChatHistory,
      updatedAt: Date.now()
    };
    
    const updatedCreative = {
      ...creative,
      characterCard: updatedCharacterCard,
      updatedAt: Date.now()
    };
    
    const updatedCreatives = [...creatives];
    updatedCreatives[creativeIndex] = updatedCreative;
    set({ creatives: updatedCreatives });
    
    get().saveCreatives();
  },

  clearCharacterCardChatHistory: (creativeId) => {
    const { creatives } = get();
    const creativeIndex = creatives.findIndex(c => c.id === creativeId);
    if (creativeIndex === -1 || !creatives[creativeIndex].characterCard) return;
    
    const creative = creatives[creativeIndex];
    const existingCard = creative.characterCard!;
    
    const updatedCharacterCard = {
      ...existingCard,
      chatHistory: [],
      updatedAt: Date.now()
    };
    
    const updatedCreative = {
      ...creative,
      characterCard: updatedCharacterCard,
      updatedAt: Date.now()
    };
    
    const updatedCreatives = [...creatives];
    updatedCreatives[creativeIndex] = updatedCreative;
    set({ creatives: updatedCreatives });
    
    get().saveCreatives();
  },

  // ========== 世界书操作 ==========
  setWorldBook: (creativeId, name, content) => {
    const { creatives } = get();
    const creativeIndex = creatives.findIndex(c => c.id === creativeId);
    if (creativeIndex === -1) return '';
    
    const existingBook = creatives[creativeIndex].worldBook;
    const now = Date.now();
    
    const newWorldBook: WorldBook = {
      id: existingBook?.id || `worldbook_${now}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      content: content || '',
      versions: content && !existingBook ? [{
        id: `version_${now}`,
        content,
        timestamp: now,
        description: '初始版本'
      }] : existingBook ? [{
        id: `version_${now}`,
        content,
        timestamp: now,
        description: '更新版本'
      }, ...existingBook.versions.slice(0, 19)] : [],
      chatHistory: existingBook?.chatHistory || [],
      createdAt: existingBook?.createdAt || now,
      updatedAt: now
    };
    
    const updatedCreative = {
      ...creatives[creativeIndex],
      worldBook: newWorldBook,
      updatedAt: now
    };
    
    const updatedCreatives = [...creatives];
    updatedCreatives[creativeIndex] = updatedCreative;
    set({ creatives: updatedCreatives, currentEditorTarget: 'worldbook' });
    
    get().saveCreatives();
    return newWorldBook.id;
  },

  updateWorldBook: (creativeId, updates) => {
    const { creatives } = get();
    const creativeIndex = creatives.findIndex(c => c.id === creativeId);
    if (creativeIndex === -1 || !creatives[creativeIndex].worldBook) return false;
    
    const creative = creatives[creativeIndex];
    const existingBook = creative.worldBook!;
    
    const updatedWorldBook = {
      ...existingBook,
      ...updates,
      updatedAt: Date.now()
    };
    
    const updatedCreative = {
      ...creative,
      worldBook: updatedWorldBook,
      updatedAt: Date.now()
    };
    
    const updatedCreatives = [...creatives];
    updatedCreatives[creativeIndex] = updatedCreative;
    set({ creatives: updatedCreatives });
    
    get().saveCreatives();
    return true;
  },

  removeWorldBook: (creativeId) => {
    const { creatives, currentEditorTarget } = get();
    const creativeIndex = creatives.findIndex(c => c.id === creativeId);
    if (creativeIndex === -1) return false;
    
    const updatedCreative = {
      ...creatives[creativeIndex],
      worldBook: null,
      updatedAt: Date.now()
    };
    
    const updatedCreatives = [...creatives];
    updatedCreatives[creativeIndex] = updatedCreative;
    
    let newEditorTarget = currentEditorTarget;
    if (currentEditorTarget === 'worldbook') {
      newEditorTarget = null;
    }
    
    set({ creatives: updatedCreatives, currentEditorTarget: newEditorTarget });
    get().saveCreatives();
    return true;
  },

  addWorldBookVersion: (creativeId, content, description) => {
    const { creatives } = get();
    const creativeIndex = creatives.findIndex(c => c.id === creativeId);
    if (creativeIndex === -1 || !creatives[creativeIndex].worldBook) return;
    
    const creative = creatives[creativeIndex];
    const existingBook = creative.worldBook!;
    
    const newVersion: Version = {
      id: `version_${Date.now()}`,
      content,
      timestamp: Date.now(),
      description
    };
    
    const updatedVersions = [newVersion, ...existingBook.versions.slice(0, 19)];
    
    const updatedWorldBook = {
      ...existingBook,
      content,
      versions: updatedVersions,
      updatedAt: Date.now()
    };
    
    const updatedCreative = {
      ...creative,
      worldBook: updatedWorldBook,
      updatedAt: Date.now()
    };
    
    const updatedCreatives = [...creatives];
    updatedCreatives[creativeIndex] = updatedCreative;
    set({ creatives: updatedCreatives });
    
    get().saveCreatives();
  },

  addWorldBookChatMessage: (creativeId, message) => {
    const { creatives } = get();
    const creativeIndex = creatives.findIndex(c => c.id === creativeId);
    if (creativeIndex === -1 || !creatives[creativeIndex].worldBook) return;
    
    const creative = creatives[creativeIndex];
    const existingBook = creative.worldBook!;
    
    const updatedChatHistory = [...existingBook.chatHistory, message];
    
    const updatedWorldBook = {
      ...existingBook,
      chatHistory: updatedChatHistory,
      updatedAt: Date.now()
    };
    
    const updatedCreative = {
      ...creative,
      worldBook: updatedWorldBook,
      updatedAt: Date.now()
    };
    
    const updatedCreatives = [...creatives];
    updatedCreatives[creativeIndex] = updatedCreative;
    set({ creatives: updatedCreatives });
    
    get().saveCreatives();
  },

  clearWorldBookChatHistory: (creativeId) => {
    const { creatives } = get();
    const creativeIndex = creatives.findIndex(c => c.id === creativeId);
    if (creativeIndex === -1 || !creatives[creativeIndex].worldBook) return;
    
    const creative = creatives[creativeIndex];
    const existingBook = creative.worldBook!;
    
    const updatedWorldBook = {
      ...existingBook,
      chatHistory: [],
      updatedAt: Date.now()
    };
    
    const updatedCreative = {
      ...creative,
      worldBook: updatedWorldBook,
      updatedAt: Date.now()
    };
    
    const updatedCreatives = [...creatives];
    updatedCreatives[creativeIndex] = updatedCreative;
    set({ creatives: updatedCreatives });
    
    get().saveCreatives();
  },

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

  saveCreatives: async () => {
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
    return creatives.find(c => c.id === currentCreativeId) || null;
  },

  getCreativeById: (id) => {
    const { creatives } = get();
    return creatives.find(c => c.id === id) || null;
  },

  getCurrentEditorContent: () => {
    const { creatives, currentCreativeId, currentEditorTarget } = get();
    if (!currentCreativeId || !currentEditorTarget) return '';
    
    const creative = creatives.find(c => c.id === currentCreativeId);
    if (!creative) return '';
    
    if (currentEditorTarget === 'character') {
      return creative.characterCard?.content || '';
    } else {
      return creative.worldBook?.content || '';
    }
  }
}));

export { useCreativeStore };
export type { Creative, CharacterCard, WorldBook, Version, ChatMessage };
