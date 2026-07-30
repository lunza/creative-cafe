import { create } from 'zustand';
import {
  fetchCharacters as fetchCharactersService,
  fetchAvatars as fetchAvatarsService,
  optimizeCharacter as optimizeCharacterService,
} from '../services/dataService';

/**
 * DataStore —— 角色卡 / 头像纯数据状态（D1 分层修复产物）
 *
 * 来源：spec §1.2 D1（原 store 直接操作 ElectronAPI，违反分层）
 * 决策：store 仅持有数据状态 + loading/error 标志，所有 IPC 调用委托 `services/dataService`。
 *
 * 分层边界：
 *  - 本 store：characters / avatars / loading / error 状态 + setter + async action（编排）
 *  - dataService：IPC 通信 + 结果归一化（防腐层）
 *  - ElectronAPI：主进程 IPC 通道
 *
 * async action 职责：调用 service → 成功写入数据状态 / 失败写入 error 状态。
 * 不直接访问 `window.electronAPI`，便于单元测试 mock service。
 */
interface DataState {
  characters: any[];
  avatars: any[];
  loading: boolean;
  error: string | null;
  setCharacters: (characters: any[]) => void;
  setAvatars: (avatars: any[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  fetchCharacters: () => Promise<void>;
  fetchAvatars: () => Promise<void>;
  optimizeCharacter: (path: string) => Promise<void>;
}

export const useDataStore = create<DataState>((set) => ({
  characters: [],
  avatars: [],
  loading: false,
  error: null,
  setCharacters: (characters) => set({ characters }),
  setAvatars: (avatars) => set({ avatars }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  fetchCharacters: async () => {
    set({ loading: true, error: null });
    try {
      const characters = await fetchCharactersService();
      set({ characters, loading: false });
    } catch (error) {
      set({ error: 'Failed to fetch characters', loading: false });
    }
  },
  fetchAvatars: async () => {
    set({ loading: true, error: null });
    try {
      const avatars = await fetchAvatarsService();
      set({ avatars, loading: false });
    } catch (error) {
      set({ error: 'Failed to fetch avatars', loading: false });
    }
  },
  optimizeCharacter: async (path) => {
    set({ loading: true, error: null });
    try {
      const result = await optimizeCharacterService(path);
      if (result.success) {
        set({ loading: false });
      } else {
        set({ error: `优化失败: ${result.message ?? '未知原因'}`, loading: false });
      }
    } catch (error) {
      set({ error: `优化异常: ${error instanceof Error ? error.message : '未知错误'}`, loading: false });
    }
  }
}));
