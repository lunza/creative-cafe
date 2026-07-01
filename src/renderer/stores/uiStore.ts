import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type TabType = 'dashboard' | 'chat' | 'creative' | 'worldbook' | 'avatar' | 'character' | 'plugin' | 'memory' | 'knowledge' | 'settings' | 'prompt-management' | 'test' | 'test-vector' | 'test-markdown' | 'document-vector';
type ThemeType = 'light' | 'dark';
export type CreativeTabType = 'creative' | 'character' | 'worldbook';
export type CreativeViewType = 'list' | 'edit';

interface UIState {
  activeTab: TabType;
  theme: ThemeType;
  sidebarCollapsed: boolean;
  animationEnabled: boolean;
  compactMode: boolean;
  creativeTab: CreativeTabType;
  creativeView: CreativeViewType;
  setActiveTab: (tab: TabType) => void;
  setTheme: (theme: ThemeType) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setAnimationEnabled: (enabled: boolean) => void;
  setCompactMode: (enabled: boolean) => void;
  setCreativeTab: (tab: CreativeTabType) => void;
  setCreativeView: (view: CreativeViewType) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      activeTab: 'dashboard',
      theme: 'light',
      sidebarCollapsed: false,
      animationEnabled: true,
      compactMode: false,
      creativeTab: 'creative',
      creativeView: 'list',
      setActiveTab: (tab) => { set({ activeTab: tab, creativeView: 'list' }); },
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setAnimationEnabled: (enabled) => set({ animationEnabled: enabled }),
      setCompactMode: (enabled) => set({ compactMode: enabled }),
      setCreativeTab: (tab) => set({ creativeTab: tab, creativeView: 'list' }),
      setCreativeView: (view) => set({ creativeView: view })
    }),
    {
      name: 'ui-storage'
    }
  )
);
