/**
 * 漫画解析：已解析漫画记录全局持久化 store
 *
 * Spec: fix-manga-scroll-persistence-expand-context
 *
 * 应用级持久化（zustand + persist/localStorage，与 uiStore 同模式）。
 * ⚠️ 不挂在 V2 项目上：漫画解析页签无需项目即可使用（stageDisabled('assets')
 * 返回 false），项目级存储会在未选项目时静默丢失数据。
 * 记录自包含（含 mangaMeta 快照），与项目解耦。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MangaComicRecord } from '../../../../../shared/types/writing-v2.types';

interface MangaComicState {
  comics: MangaComicRecord[];
  /** 按 folderPath 去重 upsert（已存在则更新内容并置顶） */
  upsertComic: (record: MangaComicRecord) => void;
  removeComic: (id: string) => void;
  getByFolder: (folderPath: string) => MangaComicRecord | undefined;
}

export const useMangaComicStore = create<MangaComicState>()(
  persist(
    (set, get) => ({
      comics: [],
      upsertComic: (record) =>
        set((state) => {
          const others = state.comics.filter((c) => c.folderPath !== record.folderPath);
          // 置顶：按 updatedAt 倒序排列
          return { comics: [record, ...others].sort((a, b) => b.updatedAt - a.updatedAt) };
        }),
      removeComic: (id) =>
        set((state) => ({ comics: state.comics.filter((c) => c.id !== id) })),
      getByFolder: (folderPath) =>
        get().comics.find((c) => c.folderPath === folderPath),
    }),
    { name: 'creative-cafe-manga-comics-v1' }
  )
);
