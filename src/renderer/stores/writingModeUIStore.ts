import { create } from 'zustand';

export enum LayoutMode {
  WIDE = 'wide',
  MEDIUM = 'medium',
  NARROW = 'narrow'
}

export enum ActivePanel {
  PROJECTS = 'projects',
  OUTLINE = 'outline',
  CONTENT = 'content',
  EXPORT = 'export'
}

export enum RightPanelTab {
  MATERIALS = 'materials',
  PLOT_CHECK = 'plot_check',
  TABLE_ORGANIZE = 'table_organize'
}

interface WritingModeUIState {
  layoutMode: LayoutMode;
  sidebarCollapsed: boolean;
  rightPanelVisible: boolean;
  rightPanelTab: RightPanelTab;
  activePanel: ActivePanel;
  selectedProjectId: string | null;
  windowWidth: number;
  rightPanelWidth: number;
  
  setLayoutMode: (mode: LayoutMode) => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setActivePanel: (panel: ActivePanel) => void;
  setSelectedProject: (id: string | null) => void;
  updateWindowWidth: (width: number) => void;
  detectLayoutMode: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  reset: () => void;
}

const getLayoutMode = (width: number): LayoutMode => {
  if (width >= 1200) return LayoutMode.WIDE;
  if (width >= 800) return LayoutMode.MEDIUM;
  return LayoutMode.NARROW;
};

const DEFAULT_PANEL_WIDTH = 300;
const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH = 600;

const getSavedPanelWidth = (): number => {
  try {
    const saved = localStorage.getItem('writingMode_rightPanelWidth');
    if (saved) {
      const width = parseInt(saved, 10);
      if (width >= MIN_PANEL_WIDTH && width <= MAX_PANEL_WIDTH) {
        return width;
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_PANEL_WIDTH;
};

export const useWritingModeUIStore = create<WritingModeUIState>((set, get) => ({
  layoutMode: getLayoutMode(window.innerWidth),
  sidebarCollapsed: false,
  rightPanelVisible: true,
  rightPanelTab: RightPanelTab.MATERIALS,
  activePanel: ActivePanel.PROJECTS,
  selectedProjectId: null,
  windowWidth: window.innerWidth,
  rightPanelWidth: getSavedPanelWidth(),

  setLayoutMode: (layoutMode) => set({ layoutMode }),
  
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  
  toggleRightPanel: () => set((state) => ({ rightPanelVisible: !state.rightPanelVisible })),
  
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  
  setActivePanel: (activePanel) => set({ activePanel }),
  
  setSelectedProject: (selectedProjectId) => set({ selectedProjectId }),
  
  updateWindowWidth: (windowWidth) => {
    const layoutMode = getLayoutMode(windowWidth);
    set({ windowWidth, layoutMode });
  },
  
  detectLayoutMode: (width) => {
    const layoutMode = getLayoutMode(width);
    const prevMode = get().layoutMode;
    if (layoutMode !== prevMode) {
      set({ 
        layoutMode, 
        rightPanelVisible: layoutMode === LayoutMode.WIDE,
        sidebarCollapsed: layoutMode === LayoutMode.NARROW
      });
    }
  },

  setRightPanelWidth: (rightPanelWidth) => {
    const clampedWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, rightPanelWidth));
    try {
      localStorage.setItem('writingMode_rightPanelWidth', String(clampedWidth));
    } catch {
      // ignore
    }
    set({ rightPanelWidth: clampedWidth });
  },

  reset: () => set({
    layoutMode: getLayoutMode(window.innerWidth),
    sidebarCollapsed: false,
    rightPanelVisible: true,
    rightPanelTab: RightPanelTab.MATERIALS,
    activePanel: ActivePanel.PROJECTS,
    selectedProjectId: null,
    rightPanelWidth: getSavedPanelWidth(),
  }),
}));
