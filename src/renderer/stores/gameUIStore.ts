/**
 * 游戏模式 UI store（SubTask 6.2）
 *
 * 职责：
 * - 管理当前视图（lobby / detail / main / options / gallery / saves）
 * - 管理面板折叠状态（按 panelKey 持久化，运行期不写盘）
 * - 管理 ANSI 主题选择、左侧叙事面板滚动位置
 * - 管理各种对话框显隐（存档 / 选项 / 画廊）
 *
 * 设计要点：
 * - 不持久化到 localStorage（与 writingModeUIStore 不同），
 *   因为游戏模式的 UI 偏好应跟随当前会话，下次进入从默认值开始
 * - currentView 与 previousView 仅维护单层历史栈，用于"关闭返回"语义
 * - GameView 类型为本文件局部定义，与 game.types.ts 中的 GameView 枚举
 *   （仅含 LOBBY/DETAIL/MAIN）不同：本类型额外包含 'options' / 'gallery' / 'saves'
 *   三个对话框视图，便于 GameModeEntry 在路由层统一处理
 *
 * 参考：src/renderer/stores/writingModeUIStore.ts（UI store 模式）
 */

import { create } from 'zustand';

// ==================== 类型定义 ====================

/**
 * 游戏模式视图类型
 *
 * 注意：与 `src/shared/types/game.types.ts` 中的 `GameView` 枚举不同。
 * 此处包含 options / gallery / saves 三个对话框视图，
 * 用于 GameModeEntry 的路由层。
 */
export type GameView = 'lobby' | 'detail' | 'main' | 'options' | 'gallery' | 'saves';

/**
 * ANSI 主题
 */
export type AnsiTheme = 'default' | 'dark' | 'light';

export interface GameUIStoreState {
  /** 当前视图 */
  currentView: GameView;
  /** 上一级视图（用于"关闭"返回，单层历史栈） */
  previousView: GameView | null;
  /** 折叠面板状态（key 为 panelKey） */
  collapsedPanels: Record<string, boolean>;
  /** ANSI 主题 */
  ansiTheme: AnsiTheme;
  /** 左侧叙事面板滚动位置 */
  narrativeScrollPosition: number;
  /** 详情页当前查看的 game ID */
  detailGameId: string | null;
  /** 存档对话框显隐 */
  showSaveDialog: boolean;
  /** 选项对话框显隐 */
  showOptionsDialog: boolean;
  /** 画廊对话框显隐 */
  showGalleryDialog: boolean;

  // ----- Actions -----
  /** 切换视图，并将当前视图推入 previousView */
  setCurrentView: (view: GameView) => void;
  /** 返回上一级视图；若无 previousView 则返回 lobby */
  goBack: () => void;
  /** 设置详情页当前 game ID */
  setDetailGameId: (gameId: string) => void;
  /** 切换面板折叠状态 */
  togglePanel: (panelKey: string) => void;
  /** 设置面板折叠状态 */
  setPanelCollapsed: (panelKey: string, collapsed: boolean) => void;
  /** 设置 ANSI 主题 */
  setAnsiTheme: (theme: AnsiTheme) => void;
  /** 设置叙事面板滚动位置 */
  setNarrativeScrollPosition: (position: number) => void;
  /** 设置存档对话框显隐 */
  setShowSaveDialog: (show: boolean) => void;
  /** 设置选项对话框显隐 */
  setShowOptionsDialog: (show: boolean) => void;
  /** 设置画廊对话框显隐 */
  setShowGalleryDialog: (show: boolean) => void;
  /** 重置 UI 到初始状态 */
  resetUI: () => void;
}

// ==================== 初始状态 ====================

const INITIAL_UI_STATE = {
  currentView: 'lobby' as GameView,
  previousView: null as GameView | null,
  collapsedPanels: {} as Record<string, boolean>,
  ansiTheme: 'default' as AnsiTheme,
  narrativeScrollPosition: 0,
  detailGameId: null as string | null,
  showSaveDialog: false,
  showOptionsDialog: false,
  showGalleryDialog: false
};

// ==================== Store 实现 ====================

export const useGameUIStore = create<GameUIStoreState>((set, get) => ({
  ...INITIAL_UI_STATE,

  // ---------------- setCurrentView ----------------
  setCurrentView: (view) =>
    set((state) => ({
      currentView: view,
      previousView: state.currentView
    })),

  // ---------------- goBack ----------------
  goBack: () => {
    const { previousView } = get();
    set({
      currentView: previousView ?? 'lobby',
      previousView: null
    });
  },

  // ---------------- setDetailGameId ----------------
  setDetailGameId: (detailGameId) => set({ detailGameId }),

  // ---------------- togglePanel ----------------
  togglePanel: (panelKey) =>
    set((state) => ({
      collapsedPanels: {
        ...state.collapsedPanels,
        [panelKey]: !state.collapsedPanels[panelKey]
      }
    })),

  // ---------------- setPanelCollapsed ----------------
  setPanelCollapsed: (panelKey, collapsed) =>
    set((state) => ({
      collapsedPanels: {
        ...state.collapsedPanels,
        [panelKey]: collapsed
      }
    })),

  // ---------------- setAnsiTheme ----------------
  setAnsiTheme: (ansiTheme) => set({ ansiTheme }),

  // ---------------- setNarrativeScrollPosition ----------------
  setNarrativeScrollPosition: (narrativeScrollPosition) =>
    set({ narrativeScrollPosition }),

  // ---------------- setShowSaveDialog ----------------
  setShowSaveDialog: (showSaveDialog) => set({ showSaveDialog }),

  // ---------------- setShowOptionsDialog ----------------
  setShowOptionsDialog: (showOptionsDialog) => set({ showOptionsDialog }),

  // ---------------- setShowGalleryDialog ----------------
  setShowGalleryDialog: (showGalleryDialog) => set({ showGalleryDialog }),

  // ---------------- resetUI ----------------
  resetUI: () => set({ ...INITIAL_UI_STATE })
}));
