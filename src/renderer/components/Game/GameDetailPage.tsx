/**
 * 游戏详情页（Task 10 / SubTask 10.1 + 10.6）
 *
 * 职责：
 * - 左侧 8 栏：游戏元数据区（封面占位 / 标题 / 副标题 / 类别徽标 / 状态徽标 / 开发者 / 版本）
 * - 右侧 16 栏：详细介绍 + 玩法说明 + 操作按钮区（6 个按钮）
 * - 通过 gameUIStore 控制三个对话框（GameSaveDialog / GameOptionsDialog / GameGalleryDialog）的显隐
 * - 通过 gameStore.startNewGame / loadSave 触发游戏流程，并通过 setCurrentView('main') 切换视图
 *
 * 设计要点：
 * - currentGame 为 null 时显示 antd Empty（边界场景：用户直接进入详情页但未选择游戏）
 * - 操作按钮区使用 antd Card 包裹，按钮使用 flex wrap 布局，间距 8px
 * - "其他"按钮根据模板是否注册 onOtherAction 决定显隐（默认隐藏，因占位模板未注册）
 * - "关闭"按钮通过 setCurrentView('lobby') 返回大厅
 * - 类别徽标 / 状态徽标颜色映射与未来 GameCard 保持一致（GAME_TYPE_ICON_COLORS / GAME_STATUS_COLORS）
 *
 * 关闭返回逻辑（SubTask 10.6）：
 *   ```tsx
 *   const handleClose = () => {
 *     useGameUIStore.getState().setCurrentView('lobby');
 *   };
 *   ```
 * 实际实现使用从 hook 取出的 setCurrentView 引用，等价于上面 getState 调用模式。
 *
 * 字段说明：
 * - meta.description：详细介绍（可能为多段，按换行符分段渲染）
 * - meta.gameplay：玩法说明（如不存在则回退到 description，避免空白）
 *
 * 参考：
 * - src/renderer/components/Game/GameModeEntry.tsx（视图切换 + 懒加载模式）
 * - src/shared/constants/game.constants.ts（颜色映射）
 * - src/renderer/components/Game/templates/GameTemplateRegistry.ts（onOtherAction 查询）
 */

import { useCallback } from 'react';
import { Row, Col, Typography, Tag, Button, Card, Empty } from 'antd';
import { useGameStore } from '../../stores/gameStore';
import { useGameUIStore } from '../../stores/gameUIStore';
import { GameTemplateRegistry } from './templates/GameTemplateRegistry';
import {
  GAME_TYPE_LABELS,
  GAME_TYPE_ICON_COLORS,
  GAME_STATUS_LABELS,
  GAME_STATUS_COLORS
} from '../../../shared/constants/game.constants';
import { GameSaveDialog } from './GameSaveDialog';
import { GameOptionsDialog } from './GameOptionsDialog';
import { GameGalleryDialog } from './GameGalleryDialog';
import './GameDetailPage.css';

const { Title, Text, Paragraph } = Typography;

/**
 * 将多段文本拆分为段落数组
 *
 * @param text 原始文本（可能包含 \n 分隔的多段）
 * @returns 段落数组（已过滤空行）
 */
function splitParagraphs(text: string | undefined | null): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export const GameDetailPage: React.FC = () => {
  // ===== store 数据 =====
  const currentGame = useGameStore((s) => s.currentGame);
  const startNewGame = useGameStore((s) => s.startNewGame);

  // ===== UI store 数据 =====
  const showSaveDialog = useGameUIStore((s) => s.showSaveDialog);
  const showOptionsDialog = useGameUIStore((s) => s.showOptionsDialog);
  const showGalleryDialog = useGameUIStore((s) => s.showGalleryDialog);
  const setShowSaveDialog = useGameUIStore((s) => s.setShowSaveDialog);
  const setShowOptionsDialog = useGameUIStore((s) => s.setShowOptionsDialog);
  const setShowGalleryDialog = useGameUIStore((s) => s.setShowGalleryDialog);
  const setCurrentView = useGameUIStore((s) => s.setCurrentView);

  // ===== 边界场景：未选择游戏 =====
  if (!currentGame) {
    return (
      <div className="game-detail-page">
        <div className="game-detail-page__empty">
          <Empty description="未选择游戏，请返回大厅" />
        </div>
      </div>
    );
  }

  const meta = currentGame;
  // 查询模板是否注册了 onOtherAction，决定"其他"按钮显隐
  const template = GameTemplateRegistry.get(meta.type);
  const hasOtherAction = !!template?.onOtherAction;

  // 拆分多段文本
  const descriptionParagraphs = splitParagraphs(meta.description);
  const gameplayText = meta.gameplay || meta.description;
  const gameplayParagraphs = splitParagraphs(gameplayText);

  // ===== 事件处理 =====

  /**
   * 开始游戏
   *
   * 调用 gameStore.startNewGame 创建新存档并加载，
   * 完成后切换到 main 视图进入游戏主页面。
   *
   * 注意：startNewGame 内部已调用 loadSave，因此此处无需再调用。
   */
  const handleStart = useCallback(async () => {
    await startNewGame(meta.id);
    setCurrentView('main');
  }, [startNewGame, meta.id, setCurrentView]);

  /** 打开存档选择对话框 */
  const handleOpenSaves = useCallback(() => {
    setShowSaveDialog(true);
  }, [setShowSaveDialog]);

  /** 打开游戏选项对话框 */
  const handleOpenOptions = useCallback(() => {
    setShowOptionsDialog(true);
  }, [setShowOptionsDialog]);

  /** 打开画廊对话框 */
  const handleOpenGallery = useCallback(() => {
    setShowGalleryDialog(true);
  }, [setShowGalleryDialog]);

  /** 触发模板自定义的"其他"操作 */
  const handleOther = useCallback(() => {
    template?.onOtherAction?.();
  }, [template]);

  /**
   * 关闭返回大厅（SubTask 10.6）
   *
   * 通过 setCurrentView('lobby') 返回上一级视图。
   * setCurrentView 会自动将当前视图推入 previousView，
   * 但此处直接切到 lobby（详情页是大厅的下一级）。
   */
  const handleClose = useCallback(() => {
    setCurrentView('lobby');
  }, [setCurrentView]);

  return (
    <div className="game-detail-page">
      <Row gutter={24}>
        {/* ==================== 左侧元数据区（8 栏） ==================== */}
        <Col xs={24} md={8}>
          <div className="game-detail-page__meta">
            {/* 封面占位：使用渐变色 div，高度 200px（由 CSS 控制） */}
            <div className="game-detail-page__cover" />

            {/* 标题（Typography.Title level=3） */}
            <div className="game-detail-page__meta-title">
              <Title level={3} style={{ marginBottom: 0 }}>
                {meta.title}
              </Title>
            </div>

            {/* 副标题（Typography.Text type="secondary"） */}
            <Text type="secondary">{meta.subtitle}</Text>

            {/* 类别 + 状态徽标 */}
            <div className="game-detail-page__tags">
              <Tag color={GAME_TYPE_ICON_COLORS[meta.type]}>
                {GAME_TYPE_LABELS[meta.type]}
              </Tag>
              <Tag color={GAME_STATUS_COLORS[meta.status]}>
                {GAME_STATUS_LABELS[meta.status]}
              </Tag>
            </div>

            {/* 开发者（Typography.Paragraph） */}
            <Paragraph className="game-detail-page__meta-item" style={{ marginBottom: 0 }}>
              开发者：{meta.developer}
            </Paragraph>

            {/* 版本（Typography.Text） */}
            <Text className="game-detail-page__meta-item">
              版本：{meta.version}
            </Text>
          </div>
        </Col>

        {/* ==================== 右侧详细介绍 + 操作按钮区（16 栏） ==================== */}
        <Col xs={24} md={16}>
          {/* 详细介绍（Typography.Paragraph，可能为多段） */}
          <div className="game-detail-page__description">
            <Title level={4} className="game-detail-page__description-title">
              详细介绍
            </Title>
            {descriptionParagraphs.length > 0 ? (
              descriptionParagraphs.map((para, idx) => (
                <Paragraph key={`desc-${idx}`}>{para}</Paragraph>
              ))
            ) : (
              <Paragraph type="secondary">暂无详细介绍</Paragraph>
            )}
          </div>

          {/* 玩法说明（Typography.Paragraph，如不存在则回退到 description） */}
          <div className="game-detail-page__description">
            <Title level={4} className="game-detail-page__description-title">
              玩法说明
            </Title>
            {gameplayParagraphs.length > 0 ? (
              gameplayParagraphs.map((para, idx) => (
                <Paragraph key={`gameplay-${idx}`}>{para}</Paragraph>
              ))
            ) : (
              <Paragraph type="secondary">暂无玩法说明</Paragraph>
            )}
          </div>

          {/* 操作按钮区（Card 内） */}
          <Card title="操作" className="game-detail-page__actions">
            <div className="game-detail-page__actions-buttons">
              {/* 开始游戏（主按钮）—— 触发 startNewGame + setCurrentView('main') */}
              <Button type="primary" onClick={handleStart}>
                开始游戏
              </Button>

              {/* 读取存档 —— 打开 GameSaveDialog */}
              <Button onClick={handleOpenSaves}>读取存档</Button>

              {/* 选项 —— 打开 GameOptionsDialog */}
              <Button onClick={handleOpenOptions}>选项</Button>

              {/* 画廊 —— 打开 GameGalleryDialog */}
              <Button onClick={handleOpenGallery}>画廊</Button>

              {/* 其他 —— 如模板注册了 onOtherAction 则显示，否则隐藏 */}
              {hasOtherAction && (
                <Button onClick={handleOther}>其他</Button>
              )}

              {/* 关闭（type="text"）—— 返回上一级视图（detail → lobby） */}
              <Button
                type="text"
                onClick={handleClose}
                className="game-detail-page__actions-close"
              >
                关闭
              </Button>
            </div>
          </Card>
        </Col>
      </Row>

      {/* ==================== 三个对话框（受 gameUIStore 标志位控制） ==================== */}
      <GameSaveDialog open={showSaveDialog} onClose={() => setShowSaveDialog(false)} />
      <GameOptionsDialog open={showOptionsDialog} onClose={() => setShowOptionsDialog(false)} />
      <GameGalleryDialog open={showGalleryDialog} onClose={() => setShowGalleryDialog(false)} />
    </div>
  );
};

export default GameDetailPage;
