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
      },

      removeFavorite: (path: string) => {
        set((state) => ({
          favorites: state.favorites.filter((f) => f.path !== path),
        }));
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
    }
  )
);
