/**
 * 游戏主页面通用框架（Task 11 / SubTask 11.1 + 11.5）
 *
 * 职责：
 * - 顶部状态栏（GameStateBar）：游戏标题 / 当前节点 / 当前回合 / 存档 / 设置 / 退出按钮
 * - 左侧叙事面板（NarrativePanel）：流式文本 + 选项 + 用户输入框
 * - 右侧模板面板区：根据 currentGame.type 从 GameTemplateRegistry 获取模板，
 *   渲染 template.Component（懒加载组件，需 Suspense 包裹）
 * - 模板未注册时显示 antd Empty "该游戏类型暂未实现"
 * - 退出按钮通过 Modal.confirm 二次确认
 *
 * 布局：
 * ```
 * ┌──────────────────────────────────────────────────────────┐
 * │ GameStateBar (顶部状态栏)                                  │
 * ├──────────────────────────────────┬───────────────────────┤
 * │ NarrativePanel (60%)             │ Template Component   │
 * │ - 流式文本                       │ (40%)                │
 * │ - 选项按钮                       │ - ResourcePanel      │
 * │ - 用户输入框                     │ - FacilityPanel      │
 * │                                  │ - ...                │
 * └──────────────────────────────────┴───────────────────────┘
 * ```
 *
 * 设计要点：
 * - 不修改 store / preload / 主进程，仅消费 gameStore / gameUIStore 状态
 * - 模板 Component 为 React.lazy 包裹的懒加载组件，必须用 Suspense 包裹
 * - 流式订阅由 gameStore 模块加载时已建立（setupGameEventListeners），
 *   本组件不重复订阅，仅渲染 store 中的 narrativeLog
 * - 退出流程：弹 Modal.confirm → 取消进行中的生成 → 切换到 detail 视图
 *
 * 参考：
 * - src/renderer/components/Game/GameModeEntry.tsx（视图切换 / lazy 加载）
 * - src/renderer/components/Game/templates/GameTemplateRegistry.ts（模板查询）
 * - src/renderer/stores/gameStore.ts（currentGame / currentSave / tableData）
 */

import React, { Suspense } from 'react';
import { Empty, Spin } from 'antd';
import { useGameStore } from '../../stores/gameStore';
import { useGameUIStore } from '../../stores/gameUIStore';
import { GameTemplateRegistry } from './templates/GameTemplateRegistry';
import { GameStateBar } from './panels/GameStateBar';
import { NarrativePanel } from './panels/NarrativePanel';
import './GameMainPage.css';

/**
 * 模板面板区加载态
 *
 * 模板 Component 为 React.lazy 包裹的懒加载组件，
 * 首次渲染时会触发 chunk 加载，期间显示 Spin。
 */
const TemplatePanelFallback: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      minHeight: 200
    }}
  >
    <Spin size="large" tip="加载模板面板..." />
  </div>
);

/**
 * 游戏主页面
 *
 * 当 currentGame 为 null 时显示 Empty（无游戏被选中的边界场景）
 */
export const GameMainPage: React.FC = () => {
  const currentGame = useGameStore((s) => s.currentGame);
  const currentSaveId = useGameStore((s) => s.currentSaveId);
  const gameId = currentGame?.id;
  const tableData = useGameStore((s) => s.tableData);
  const generateNarrative = useGameStore((s) => s.generateNarrative);
  const setCurrentView = useGameUIStore((s) => s.setCurrentView);

  // ----- 从注册中心获取当前游戏类型对应的模板 -----
  // 注意：GameTemplateRegistry 是单例，组件每次渲染都会调用 get()，
  // 但 Map.get 是 O(1)，性能可接受；若未来需要优化可改为 useMemo + state 订阅
  const template = currentGame ? GameTemplateRegistry.get(currentGame.type) : undefined;

  // ----- 模板面板渲染逻辑 -----
  // - 模板未注册：显示 Empty
  // - 模板已注册：渲染 template.Component（懒加载，需 Suspense）
  //               传入 GameTemplateProps：saveId / gameId / tableData / onAction
  let templatePanel: React.ReactNode;
  if (!template) {
    templatePanel = (
      <Empty
        description="该游戏类型暂未实现"
        data-testid="game-main-page-template-empty"
      />
    );
  } else {
    const TemplateComponent = template.Component;
    templatePanel = (
      <Suspense fallback={<TemplatePanelFallback />}>
        <TemplateComponent
          saveId={currentSaveId ?? ''}
          gameId={gameId ?? ''}
          tableData={tableData}
          onAction={(userAction: string) => {
            void generateNarrative({ userAction });
          }}
        />
      </Suspense>
    );
  }

  // ----- 无 currentGame 时显示 Empty（边界场景） -----
  if (!currentGame) {
    return (
      <div className="game-main-page" data-testid="game-main-page">
        <div style={{ padding: 24, flex: 1 }}>
          <Empty
            description="未选择游戏，请返回大厅重新选择"
            data-testid="game-main-page-no-game"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="game-main-page" data-testid="game-main-page">
      <GameStateBar onExit={() => setCurrentView('detail')} />
      <div className="game-main-page__body">
        <div className="game-main-page__narrative">
          <NarrativePanel />
        </div>
        <div
          className="game-main-page__panels"
          data-testid="game-main-page-panels"
        >
          {templatePanel}
        </div>
      </div>
    </div>
  );
};

export default GameMainPage;
