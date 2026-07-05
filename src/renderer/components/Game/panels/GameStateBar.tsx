/**
 * 游戏主页面顶部状态栏组件（Task 11 / SubTask 11.3）
 *
 * 职责：
 * - 左侧：游戏标题 + 当前剧情节点（从 currentSave.meta.nodeTitle 读取，缺省"未开始"）
 * - 中间：当前回合（currentSave.meta.currentTurn，仅回合制游戏显示）+ 生成状态指示器
 * - 右侧：存档按钮 / 设置按钮 / 退出按钮
 *
 * 设计要点：
 * - 仅消费 gameStore / gameUIStore，不持有本地状态（受控组件）
 * - 退出按钮通过 Modal.confirm 二次确认，避免误触丢失进度（实际已自动存档）
 * - 设置按钮通过 gameUIStore.setShowOptionsDialog(true) 控制 GameOptionsDialog 显隐
 *   （GameOptionsDialog 由 Task 10 实现，本组件只触发状态变更）
 * - 使用 antd Space 紧凑排列，遵循项目既有暗色主题风格
 *
 * 参考：src/renderer/components/Game/GameMainPage.tsx
 */

import React from 'react';
import { Button, Space, Spin, Tag, Typography, Modal } from 'antd';
import {
  SaveOutlined,
  SettingOutlined,
  LogoutOutlined
} from '@ant-design/icons';
import { useGameStore } from '../../../stores/gameStore';
import { useGameUIStore } from '../../../stores/gameUIStore';

const { Text } = Typography;

export interface GameStateBarProps {
  /**
   * 退出回调（点击"退出"按钮 + Modal.confirm 确认后触发）
   *
   * 默认实现：取消生成 + 切换到 detail 视图
   * 由 GameMainPage 注入以便统一管理退出流程；若未提供则使用内置默认行为
   */
  onExit?: () => void;
}

/**
 * 顶部状态栏
 *
 * 不直接渲染 Modal（避免在静态渲染测试中触发 Modal.confirm 副作用），
 * 点击"退出"按钮时调用 onExit 或内置默认行为。
 */
export const GameStateBar: React.FC<GameStateBarProps> = ({ onExit }) => {
  const currentGame = useGameStore((s) => s.currentGame);
  const currentSave = useGameStore((s) => s.currentSave);
  const isGenerating = useGameStore((s) => s.isGenerating);
  const saveGame = useGameStore((s) => s.saveGame);
  const cancelGeneration = useGameStore((s) => s.cancelGeneration);
  const setShowOptionsDialog = useGameUIStore((s) => s.setShowOptionsDialog);
  const setCurrentView = useGameUIStore((s) => s.setCurrentView);

  const nodeTitle = currentSave?.meta?.nodeTitle ?? '未开始';
  const currentTurn = currentSave?.meta?.currentTurn ?? null;
  const turnCount = currentSave?.meta?.turnCount ?? 0;

  // ----- 存档按钮：调用 store.saveGame（异步，不阻塞 UI） -----
  const handleSave = () => {
    void saveGame();
  };

  // ----- 设置按钮：通过 gameUIStore 控制 GameOptionsDialog 显隐 -----
  const handleOpenOptions = () => {
    setShowOptionsDialog(true);
  };

  // ----- 退出按钮：弹 Modal.confirm，确认后取消生成并返回 detail 视图 -----
  const handleExit = () => {
    // Modal.confirm 在 node 环境（vitest）下无副作用，但在浏览器环境下正常弹出
    Modal.confirm({
      title: '确认退出游戏？',
      content: '未保存的进度将丢失（实际已自动存档，仅为提示）',
      okText: '退出',
      cancelText: '取消',
      onOk: () => {
        // 1. 取消任何进行中的生成
        if (isGenerating) {
          void cancelGeneration();
        }
        // 2. 调用注入的 onExit 或默认切换到 detail 视图
        if (onExit) {
          onExit();
        } else {
          setCurrentView('detail');
        }
      }
    });
  };

  return (
    <div className="game-state-bar" role="toolbar" aria-label="游戏状态栏">
      {/* 左侧：游戏标题 + 当前节点 */}
      <Space size="middle" align="center">
        <Text strong style={{ fontSize: 16 }}>
          {currentGame?.title ?? '未知游戏'}
        </Text>
        <Tag color="blue" data-testid="game-state-bar-node">
          {nodeTitle}
        </Tag>
      </Space>

      {/* 中间：当前回合 + 生成状态指示器 */}
      <Space size="middle" align="center">
        {currentTurn !== null && (
          <Text type="secondary" data-testid="game-state-bar-turn">
            回合 {currentTurn} / {turnCount}
          </Text>
        )}
        {isGenerating && (
          <Space size="small" align="center" data-testid="game-state-bar-spin">
            <Spin size="small" />
            <Text type="secondary">生成中...</Text>
          </Space>
        )}
      </Space>

      {/* 右侧：操作按钮 */}
      <Space size="small" align="center">
        <Button
          icon={<SaveOutlined />}
          onClick={handleSave}
          data-testid="game-state-bar-save"
        >
          存档
        </Button>
        <Button
          icon={<SettingOutlined />}
          onClick={handleOpenOptions}
          data-testid="game-state-bar-settings"
        >
          设置
        </Button>
        <Button
          icon={<LogoutOutlined />}
          onClick={handleExit}
          danger
          data-testid="game-state-bar-exit"
        >
          退出
        </Button>
      </Space>
    </div>
  );
};

export default GameStateBar;
