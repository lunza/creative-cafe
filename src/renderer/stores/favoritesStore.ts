import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface FavoriteCharacter {
  path: string;
  addedAt: number;
}

interface CharacterBase {
  path: string;
  name: string;
  characterName?: string;
}

interface FavoritesState {
  favorites: FavoriteCharacter[];
  addFavorite: (path: string) => void;
  removeFavorite: (path: string) => void;
  toggleFavorite: (path: string) => void;
  isFavorite: (path: string) => boolean;
  getSortedCharacters: <T extends CharacterBase>(characters: T[]) => T[];
  getFavoritePaths: () => string[];
  getFavoritesCount: () => number;
}

/**
 * 与主进程收藏文件（userData/character-favorites.json）同步——移动端 LAN API
 * 读写同一份文件，保证两端收藏互通、角色列表"收藏置顶"排序一致。
 * - 主进程有数据 → 以主进程为准覆盖本地（多端一致性）
 * - 主进程无数据且本地 localStorage 有（老用户）→ 上传一次性迁移
 * - IPC 不可用（异常环境）→ 静默降级为纯 localStorage 模式
 */
async function syncWithMainProcess(): Promise<void> {
  try {
    const has = await window.electronAPI.favorites.hasStored();
    if (has) {
      const stored = await window.electronAPI.favorites.read();
      const favorites = stored.map(f => ({ path: f.path, addedAt: f.addedAt }));
      // 与本地一致时跳过 setState，避免无谓渲染
      const local = useFavoritesStore.getState().favorites;
      const same =
        local.length === favorites.length &&
        local.every((f, i) => f.path === favorites[i].path);
      if (!same) useFavoritesStore.setState({ favorites });
    } else {
      const local = useFavoritesStore.getState().favorites;
      if (local.length > 0) {
        await window.electronAPI.favorites.write(local);
      }
    }
  } catch { /* 主进程不可用时静默降级 */ }
}

/** 变更后把副本推送到主进程（失败静默：localStorage 仍为本地缓存） */
function pushToMainProcess(): void {
  try {
    void window.electronAPI.favorites.write(useFavoritesStore.getState().favorites);
  } catch { /* ignore */ }
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favorites: [],

      addFavorite: (path: string) => {
        set((state) => {
          const exists = state.favorites.some((f) => f.path === path);
          if (exists) {
            return state;
          }
          return {
            favorites: [...state.favorites, { path, addedAt: Date.now() }],
          };
        });
        pushToMainProcess();
      },

      removeFavorite: (path: string) => {
        set((state) => ({
          favorites: state.favorites.filter((f) => f.path !== path),
        }));
        pushToMainProcess();
      },

      toggleFavorite: (path: string) => {
        const { isFavorite, addFavorite, removeFavorite } = get();
        if (isFavorite(path)) {
          removeFavorite(path);
        } else {
          addFavorite(path);
        }
      },

      isFavorite: (path: string) => {
        return get().favorites.some((f) => f.path === path);
      },

      getSortedCharacters: <T extends CharacterBase>(characters: T[]): T[] => {
        const { favorites } = get();
        const favoritePaths = new Set(favorites.map((f) => f.path));

        const favoriteCharacters = characters
          .filter((c) => favoritePaths.has(c.path))
          .sort((a, b) => {
            const aTime = favorites.find((f) => f.path === a.path)?.addedAt || 0;
            const bTime = favorites.find((f) => f.path === b.path)?.addedAt || 0;
            return aTime - bTime;
          });

        const nonFavoriteCharacters = characters.filter(
          (c) => !favoritePaths.has(c.path)
        );

        return [...favoriteCharacters, ...nonFavoriteCharacters];
      },

      getFavoritePaths: () => {
        return get().favorites.map((f) => f.path);
      },

      getFavoritesCount: () => {
        return get().favorites.length;
      },
    }),
    {
      name: 'creative-cafe-character-favorites',
      onRehydrateStorage: () => {
        // localStorage 同步 rehydrate 完成后，异步与主进程收藏文件对齐
        // （此时 useFavoritesStore 已完成赋值，可安全引用）
        return () => {
          void syncWithMainProcess();
        };
      },
    }
  )
);
