/**
 * 游戏卡片组件（Task 9 / SubTask 9.2）
 *
 * 职责：
 * - 渲染单张游戏卡片：封面占位 / 标题 / 副标题 / 类别徽标 / 状态徽标 / 简短介绍 / 最后更新时间
 * - 点击触发 onClick(gameId)，由父组件 GameLobby 接管并跳转到详情视图
 * - hover 时通过 Tooltip 提示"点击进入详情"
 *
 * 设计要点：
 * - **数据源适配**：本组件接收 `GameIndexEntry`（来自 `games-index.json` 的摘要），
 *   而非 spec 描述的 `GameMeta`（完整元数据）。原因：`gameStore.games` 类型为
 *   `GameIndexEntry[]`，`GameIndexEntry` 是 `GameMeta` 的子集（缺 description /
 *   gameplay / developer / version / templateKey 字段）。**【重点标记 - store 实际 API
 *   与 spec 描述不符】** spec 描述 `meta: GameMeta` 与 `meta.description` 简短介绍，
 *   实际 store 仅提供 GameIndexEntry；为避免每张卡片都触发 getMeta IPC，本组件
 *   改用 `tags.join(' · ')` 作为简短介绍的替代展示，详情请见 Task 10 详情页。
 * - **类别徽标颜色**：使用 `GAME_TYPE_ICON_COLORS`（来自 constants），与 spec 描述的
 *   "WEREWOLF 红色 / MYSTERY 紫色" 实际相反——constants 中 WEREWOLF=#8b5cf6（紫色）、
 *   MYSTERY=#ef4444（红色）。**【重点标记 - constants 与 spec 颜色映射相反】**
 *   优先以 constants 文件为准，避免在多个组件中重复定义颜色映射
 * - **状态徽标颜色**：spec 提到 "COMING_SOON 灰色"，实际枚举为 `GameStatus.PLANNED`
 *   （label "计划中"，color #8c8c8c 灰色），语义一致仅命名不同
 * - **封面占位**：首期未接入真实封面图，使用渐变色 div（详见 GameLobby.css 的
 *   `.game-card__cover-placeholder`）。后续 Task 17 接入真实封面时，仅需替换 cover 节点
 * - **简短介绍**：因 GameIndexEntry 无 description 字段，使用 tags 拼接作为替代。
 *   若 tags 为空则不渲染该区块
 */

import { Card, Tag, Tooltip, Typography } from 'antd';
import type { GameIndexEntry } from '../../../shared/types/game.types';
import {
  GAME_TYPE_LABELS,
  GAME_TYPE_ICON_COLORS,
  GAME_STATUS_LABELS,
  GAME_STATUS_COLORS
} from '../../../shared/constants/game.constants';

export interface GameCardProps {
  /** 游戏元数据摘要（来自 games-index.json） */
  meta: GameIndexEntry;
  /** 点击回调，参数为 game.id */
  onClick: (gameId: string) => void;
}

/**
 * 格式化时间戳为 yyyy-mm-dd（zh-CN locale）
 *
 * 使用原生 Date API，避免引入 dayjs（项目未直接依赖 dayjs）。
 * 与项目其他位置（如 WritingProjectList、AvatarManager）保持一致。
 */
function formatTimestamp(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return '';
  // 使用 toISOString 截取前 10 位得到 yyyy-mm-dd，避免 toLocaleDateString 受运行环境影响
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

const GameCard: React.FC<GameCardProps> = ({ meta, onClick }) => {
  const typeLabel = GAME_TYPE_LABELS[meta.type] ?? meta.type;
  const typeColor = GAME_TYPE_ICON_COLORS[meta.type] ?? '#8c8c8c';
  const statusLabel = GAME_STATUS_LABELS[meta.status] ?? meta.status;
  const statusColor = GAME_STATUS_COLORS[meta.status] ?? '#8c8c8c';

  const updatedText = formatTimestamp(meta.updatedAt);

  const handleClick = () => {
    onClick(meta.id);
  };

  // 简短介绍：GameIndexEntry 无 description，使用 tags 拼接作为替代
  const intro = meta.tags && meta.tags.length > 0 ? meta.tags.join(' · ') : '';

  return (
    <Tooltip title="点击进入详情" placement="top">
      <Card
        hoverable
        className="game-card"
        onClick={handleClick}
        cover={<div className="game-card__cover-placeholder" />}
        bodyStyle={{ padding: 12 }}
      >
        <Card.Meta
          title={<span className="game-card__title">{meta.title}</span>}
          description={
            <div>
              <div className="game-card__subtitle">{meta.subtitle}</div>
              <div className="game-card__tags">
                <Tag color={typeColor}>{typeLabel}</Tag>
                <Tag color={statusColor}>{statusLabel}</Tag>
              </div>
              {intro && <div className="game-card__description">{intro}</div>}
              {updatedText && (
                <Typography.Text
                  type="secondary"
                  className="game-card__meta"
                  style={{ fontSize: 12 }}
                >
                  更新于 {updatedText}
                </Typography.Text>
              )}
            </div>
          }
        />
      </Card>
    </Tooltip>
  );
};

export default GameCard;
export { GameCard };
