/**
 * 游戏模式入口容器组件（Task 8）
 *
 * 职责：
 * - 顶层容器：根据 gameUIStore.currentView 渲染对应的子页面
 *   （GameLobby / GameDetailPage / GameMainPage）
 * - 挂载时通过 gameStore.loadGames() 拉取游戏列表
 * - 使用 React.lazy + Suspense 懒加载子页面，fallback 显示 antd Spin
 * - 通过 key={baseView} 触发视图切换时的 fade+slide 过渡动画
 *
 * 视图切换策略：
 * - currentView 取值：'lobby' | 'detail' | 'main' | 'options' | 'gallery' | 'saves'
 *   （详见 src/renderer/stores/gameUIStore.ts 中的 GameView 类型）
 * - 'lobby' / 'detail' / 'main' 是基础视图，直接渲染对应子页面
 * - 'options' / 'gallery' / 'saves' 是对话框视图：
 *   这些视图的实际显隐由 gameUIStore 中的 showOptionsDialog /
 *   showGalleryDialog / showSaveDialog 标志位控制（由详情页或主页面内部管理）。
 *   GameModeEntry 在这些视图下回退到 previousView 作为基础渲染层，
 *   对话框组件叠加在 base view 之上。
 *
 * 参考：
 * - src/renderer/components/Creative/WritingMode/WritingModeEntry.tsx（写作模式容器结构）
 * - src/renderer/components/Game/templates/PlaceholderGameMain.tsx（占位组件风格）
 */

import { useEffect, lazy, Suspense } from 'react';
import { Spin } from 'antd';
import { useGameStore } from '../../stores/gameStore';
import { useGameUIStore, type GameView } from '../../stores/gameUIStore';
import './GameModeEntry.css';

// ==================== 子页面懒加载 ====================
//
// Task 9 / 10 / 11 将实现完整版本；当前为占位组件（仅显示开发中提示）。
// 懒加载拆分 chunk，避免主 bundle 包含未实现的子页面逻辑。

const GameLobby = lazy(() =>
  import('./GameLobby').then((m) => ({ default: m.GameLobby }))
);
const GameDetailPage = lazy(() =>
  import('./GameDetailPage').then((m) => ({ default: m.GameDetailPage }))
);
const GameMainPage = lazy(() =>
  import('./GameMainPage').then((m) => ({ default: m.GameMainPage }))
);

// ==================== 视图解析工具 ====================

/** 基础视图类型（仅包含非对话框视图） */
export type BaseView = 'lobby' | 'detail' | 'main';

/**
 * 根据 currentView 解析需要渲染的基础视图
 *
 * 设计说明：
 * - 'options' / 'gallery' / 'saves' 是对话框视图，对应 gameUIStore 中的
 *   showOptionsDialog / showGalleryDialog / showSaveDialog 标志位
 * - 这些对话框视图在 GameModeEntry 中需要回退到 previousView 作为基础渲染层
 *   （对话框由详情页或主页面内部管理，叠加在 base view 之上）
 * - 若 previousView 也是对话框视图或为 null（极端边界场景），继续回退到 'detail'
 *
 * @param currentView   当前视图（含对话框视图）
 * @param previousView  上一级视图（可为 null）
 * @returns             基础视图（'lobby' | 'detail' | 'main'）
 */
export function resolveBaseView(
  currentView: GameView,
  previousView: GameView | null
): BaseView {
  if (
    currentView === 'lobby' ||
    currentView === 'detail' ||
    currentView === 'main'
  ) {
    return currentView;
  }
  // 对话框视图：回退到 previousView（若也是对话框视图或 null，则继续回退到 detail）
  if (
    previousView === 'lobby' ||
    previousView === 'detail' ||
    previousView === 'main'
  ) {
    return previousView;
  }
  return 'detail';
}

// ==================== 容器组件 ====================

const GameModeEntry: React.FC = () => {
  const currentView = useGameUIStore((s) => s.currentView);
  const previousView = useGameUIStore((s) => s.previousView);

  // 挂载时加载游戏列表
  // 直接通过 getState() 调用 action，避免订阅整个 store 导致冗余渲染
  useEffect(() => {
    void useGameStore.getState().loadGames();
  }, []);

  const baseView = resolveBaseView(currentView, previousView);

  return (
    <div
      className="game-mode-entry"
      data-current-view={currentView}
      data-base-view={baseView}
    >
      <Suspense
        fallback={
          <div className="game-mode-entry__fallback">
            <Spin size="large" tip="加载中..." />
          </div>
        }
      >
        {/* key={baseView}：基础视图变化时强制重新挂载，触发 CSS 过渡动画 */}
        <div key={baseView} className="game-mode-entry__view">
          {baseView === 'lobby' && <GameLobby />}
          {baseView === 'detail' && <GameDetailPage />}
          {baseView === 'main' && <GameMainPage />}
        </div>
      </Suspense>
    </div>
  );
};

export default GameModeEntry;
export { GameModeEntry };
