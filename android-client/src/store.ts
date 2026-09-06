/**
 * 全局状态（zustand）：连接信息 + 简单三屏导航
 * 客户端仅在本地持久化"最近一次成功连接的服务器地址"（R3），无任何功能配置。
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CharacterSummary } from './types';
import type { ThemeMode } from './theme';

const ADDRESS_KEY = '@creative_cafe/server_address';
const THEME_KEY = '@creative_cafe/theme_mode';

export type Screen = 'connect' | 'list' | 'chat' | 'edit';

interface AppState {
  /** 形如 192.168.1.100:8787（不含协议） */
  baseUrl: string | null;
  screen: Screen;
  activeCharacter: CharacterSummary | null;
  /** 编辑模型：null = 新建模式，string = 已有角色卡 id */
  editingCharacterId: string | null;
  /** 启动自动重连中 */
  autoConnecting: boolean;
  /** 界面主题模式（纯外观偏好，本地持久化；默认亮色） */
  themeMode: ThemeMode;

  setConnected: (baseUrl: string) => Promise<void>;
  disconnect: () => void;
  openChat: (c: CharacterSummary) => void;
  backToList: () => void;
  openCardEditor: (characterId: string | null) => void;
  setAutoConnecting: (v: boolean) => void;
  loadSavedAddress: () => Promise<string | null>;
  /** 启动时恢复上次主题 */
  initTheme: () => Promise<void>;
  /** 亮暗切换（立即生效并持久化） */
  toggleTheme: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  baseUrl: null,
  screen: 'connect',
  activeCharacter: null,
  editingCharacterId: null,
  autoConnecting: false,
  themeMode: 'light',

  setConnected: async (baseUrl: string) => {
    await AsyncStorage.setItem(ADDRESS_KEY, baseUrl);
    set({ baseUrl, screen: 'list', activeCharacter: null });
  },

  disconnect: () => set({ baseUrl: null, screen: 'connect', activeCharacter: null }),

  openChat: (c: CharacterSummary) => set({ activeCharacter: c, screen: 'chat' }),

  backToList: () => set({ activeCharacter: null, screen: 'list' }),

  openCardEditor: (characterId: string | null) =>
    set({ editingCharacterId: characterId, screen: 'edit' }),

  setAutoConnecting: (v: boolean) => set({ autoConnecting: v }),

  loadSavedAddress: async () => {
    try {
      return await AsyncStorage.getItem(ADDRESS_KEY);
    } catch {
      return null;
    }
  },

  initTheme: async () => {
    try {
      const saved = await AsyncStorage.getItem(THEME_KEY);
      if (saved === 'dark' || saved === 'light') set({ themeMode: saved });
    } catch {
      /* 忽略：保持默认亮色 */
    }
  },

  toggleTheme: () => {
    const next: ThemeMode = get().themeMode === 'dark' ? 'light' : 'dark';
    set({ themeMode: next });
    AsyncStorage.setItem(THEME_KEY, next).catch(() => { /* 持久化失败不影响本次会话 */ });
  },
}));
