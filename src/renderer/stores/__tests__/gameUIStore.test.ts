/**
 * gameUIStore 单元测试（SubTask 6.3）
 *
 * 覆盖关键场景（按 task 要求）：
 * - setCurrentView：切换视图并将当前视图推入 previousView
 * - goBack：返回上一级 / 无 previousView 时回退到 lobby
 * - togglePanel：切换面板折叠状态
 * - setAnsiTheme：设置 ANSI 主题
 * - 其他 actions：setPanelCollapsed / setDetailGameId /
 *   setNarrativeScrollPosition / setShow*Dialog / resetUI
 *
 * 测试环境：vitest environment: 'node'，store 无 window 依赖，可直接测试。
 *
 * 参考：src/renderer/components/Game/templates/__tests__/GameTemplateRegistry.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useGameUIStore, type GameView, type AnsiTheme } from '../gameUIStore';

// ==================== 测试辅助 ====================

function resetStore() {
  useGameUIStore.getState().resetUI();
}

beforeEach(() => {
  resetStore();
});

// ==================== 测试套件 ====================

describe('gameUIStore', () => {
  // ---------------- 初始状态 ----------------
  describe('initial state', () => {
    it('should start at lobby view', () => {
      expect(useGameUIStore.getState().currentView).toBe('lobby');
    });

    it('should have null previousView', () => {
      expect(useGameUIStore.getState().previousView).toBeNull();
    });

    it('should have empty collapsedPanels', () => {
      expect(useGameUIStore.getState().collapsedPanels).toEqual({});
    });

    it('should have default ansiTheme', () => {
      expect(useGameUIStore.getState().ansiTheme).toBe('default');
    });

    it('should have zero narrativeScrollPosition', () => {
      expect(useGameUIStore.getState().narrativeScrollPosition).toBe(0);
    });

    it('should have null detailGameId', () => {
      expect(useGameUIStore.getState().detailGameId).toBeNull();
    });

    it('should have all dialogs hidden', () => {
      const state = useGameUIStore.getState();
      expect(state.showSaveDialog).toBe(false);
      expect(state.showOptionsDialog).toBe(false);
      expect(state.showGalleryDialog).toBe(false);
    });
  });

  // ---------------- setCurrentView ----------------
  describe('setCurrentView', () => {
    it('should set currentView and push old view to previousView', () => {
      useGameUIStore.getState().setCurrentView('detail');
      expect(useGameUIStore.getState().currentView).toBe('detail');
      expect(useGameUIStore.getState().previousView).toBe('lobby');
    });

    it('should support all 6 view types', () => {
      const views: GameView[] = ['lobby', 'detail', 'main', 'options', 'gallery', 'saves'];
      for (const v of views) {
        useGameUIStore.getState().setCurrentView(v);
        expect(useGameUIStore.getState().currentView).toBe(v);
      }
    });

    it('should chain previousView across multiple navigations', () => {
      useGameUIStore.getState().setCurrentView('detail');
      useGameUIStore.getState().setCurrentView('main');

      expect(useGameUIStore.getState().currentView).toBe('main');
      expect(useGameUIStore.getState().previousView).toBe('detail');
    });
  });

  // ---------------- goBack ----------------
  describe('goBack', () => {
    it('should return to previousView when set', () => {
      useGameUIStore.getState().setCurrentView('detail');
      useGameUIStore.getState().setCurrentView('main');

      useGameUIStore.getState().goBack();

      expect(useGameUIStore.getState().currentView).toBe('detail');
      expect(useGameUIStore.getState().previousView).toBeNull();
    });

    it('should fall back to lobby when previousView is null', () => {
      // 初始状态：currentView=lobby, previousView=null
      useGameUIStore.getState().goBack();

      expect(useGameUIStore.getState().currentView).toBe('lobby');
      expect(useGameUIStore.getState().previousView).toBeNull();
    });

    it('should only go back one level (no deep history stack)', () => {
      useGameUIStore.getState().setCurrentView('detail');
      useGameUIStore.getState().setCurrentView('main');
      useGameUIStore.getState().setCurrentView('options');

      // options -> main
      useGameUIStore.getState().goBack();
      expect(useGameUIStore.getState().currentView).toBe('main');
      expect(useGameUIStore.getState().previousView).toBeNull();

      // 再次 goBack：previousView 已为 null，回退到 lobby
      useGameUIStore.getState().goBack();
      expect(useGameUIStore.getState().currentView).toBe('lobby');
    });
  });

  // ---------------- togglePanel ----------------
  describe('togglePanel', () => {
    it('should toggle a panel from undefined to true', () => {
      useGameUIStore.getState().togglePanel('resource');
      expect(useGameUIStore.getState().collapsedPanels.resource).toBe(true);
    });

    it('should toggle a panel from true to false', () => {
      useGameUIStore.getState().togglePanel('resource');
      useGameUIStore.getState().togglePanel('resource');
      expect(useGameUIStore.getState().collapsedPanels.resource).toBe(false);
    });

    it('should toggle multiple panels independently', () => {
      useGameUIStore.getState().togglePanel('resource');
      useGameUIStore.getState().togglePanel('facility');
      useGameUIStore.getState().togglePanel('resource');

      const panels = useGameUIStore.getState().collapsedPanels;
      expect(panels.resource).toBe(false);
      expect(panels.facility).toBe(true);
    });
  });

  // ---------------- setPanelCollapsed ----------------
  describe('setPanelCollapsed', () => {
    it('should set explicit collapsed state', () => {
      useGameUIStore.getState().setPanelCollapsed('resource', true);
      expect(useGameUIStore.getState().collapsedPanels.resource).toBe(true);

      useGameUIStore.getState().setPanelCollapsed('resource', false);
      expect(useGameUIStore.getState().collapsedPanels.resource).toBe(false);
    });

    it('should not affect other panels', () => {
      useGameUIStore.getState().setPanelCollapsed('resource', true);
      useGameUIStore.getState().setPanelCollapsed('facility', false);
      const panels = useGameUIStore.getState().collapsedPanels;
      expect(panels.resource).toBe(true);
      expect(panels.facility).toBe(false);
    });
  });

  // ---------------- setAnsiTheme ----------------
  describe('setAnsiTheme', () => {
    it('should set ansiTheme', () => {
      useGameUIStore.getState().setAnsiTheme('dark');
      expect(useGameUIStore.getState().ansiTheme).toBe('dark');
    });

    it('should support all 3 themes', () => {
      const themes: AnsiTheme[] = ['default', 'dark', 'light'];
      for (const t of themes) {
        useGameUIStore.getState().setAnsiTheme(t);
        expect(useGameUIStore.getState().ansiTheme).toBe(t);
      }
    });
  });

  // ---------------- setDetailGameId ----------------
  describe('setDetailGameId', () => {
    it('should set detailGameId', () => {
      useGameUIStore.getState().setDetailGameId('pastoral_town');
      expect(useGameUIStore.getState().detailGameId).toBe('pastoral_town');
    });
  });

  // ---------------- setNarrativeScrollPosition ----------------
  describe('setNarrativeScrollPosition', () => {
    it('should set narrativeScrollPosition', () => {
      useGameUIStore.getState().setNarrativeScrollPosition(123);
      expect(useGameUIStore.getState().narrativeScrollPosition).toBe(123);
    });

    it('should support zero', () => {
      useGameUIStore.getState().setNarrativeScrollPosition(500);
      useGameUIStore.getState().setNarrativeScrollPosition(0);
      expect(useGameUIStore.getState().narrativeScrollPosition).toBe(0);
    });
  });

  // ---------------- setShow*Dialog ----------------
  describe('setShowSaveDialog', () => {
    it('should set showSaveDialog', () => {
      useGameUIStore.getState().setShowSaveDialog(true);
      expect(useGameUIStore.getState().showSaveDialog).toBe(true);
      useGameUIStore.getState().setShowSaveDialog(false);
      expect(useGameUIStore.getState().showSaveDialog).toBe(false);
    });
  });

  describe('setShowOptionsDialog', () => {
    it('should set showOptionsDialog', () => {
      useGameUIStore.getState().setShowOptionsDialog(true);
      expect(useGameUIStore.getState().showOptionsDialog).toBe(true);
    });
  });

  describe('setShowGalleryDialog', () => {
    it('should set showGalleryDialog', () => {
      useGameUIStore.getState().setShowGalleryDialog(true);
      expect(useGameUIStore.getState().showGalleryDialog).toBe(true);
    });
  });

  // ---------------- resetUI ----------------
  describe('resetUI', () => {
    it('should reset all UI state to defaults', () => {
      // Mutate state first
      useGameUIStore.getState().setCurrentView('main');
      useGameUIStore.getState().togglePanel('resource');
      useGameUIStore.getState().setAnsiTheme('dark');
      useGameUIStore.getState().setDetailGameId('game-x');
      useGameUIStore.getState().setShowSaveDialog(true);
      useGameUIStore.getState().setNarrativeScrollPosition(999);

      // Reset
      useGameUIStore.getState().resetUI();

      const state = useGameUIStore.getState();
      expect(state.currentView).toBe('lobby');
      expect(state.previousView).toBeNull();
      expect(state.collapsedPanels).toEqual({});
      expect(state.ansiTheme).toBe('default');
      expect(state.narrativeScrollPosition).toBe(0);
      expect(state.detailGameId).toBeNull();
      expect(state.showSaveDialog).toBe(false);
      expect(state.showOptionsDialog).toBe(false);
      expect(state.showGalleryDialog).toBe(false);
    });
  });
});
