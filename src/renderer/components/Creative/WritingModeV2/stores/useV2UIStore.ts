/**
 * V2 UI store（阶段/面板/弹窗状态）
 *
 * Spec: refactor-writing-mode-v2 / 状态层拆分。
 * 仅保存 UI 瞬态，不保存任何持久化业务数据。
 */
import { create } from 'zustand';

export type V2Stage = 'projects' | 'outline' | 'writing' | 'export' | 'assets';

interface V2UIState {
  /** 当前 4 阶段之一 */
  stage: V2Stage;
  setStage: (stage: V2Stage) => void;
  /** 新建项目向导 */
  showWizard: boolean;
  setShowWizard: (visible: boolean) => void;
  /** 导出对话框 */
  showExportDialog: boolean;
  setShowExportDialog: (visible: boolean) => void;
  /** 内容创作阶段选中的章节索引 */
  selectedChapterIndex: number | null;
  setSelectedChapterIndex: (index: number | null) => void;
  /** 章节结构版本号（拆/并导致章节集合变化时自增，工作台据此重新载入正文） */
  chapterStructureVersion: number;
  bumpChapterStructure: () => void;
}

export const useV2UIStore = create<V2UIState>((set) => ({
  stage: 'projects',
  setStage: (stage) => set({ stage }),
  showWizard: false,
  setShowWizard: (showWizard) => set({ showWizard }),
  showExportDialog: false,
  setShowExportDialog: (showExportDialog) => set({ showExportDialog }),
  selectedChapterIndex: null,
  setSelectedChapterIndex: (selectedChapterIndex) => set({ selectedChapterIndex }),
  chapterStructureVersion: 0,
  bumpChapterStructure: () => set((s) => ({ chapterStructureVersion: s.chapterStructureVersion + 1 })),
}));
