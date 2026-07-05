/**
 * 游戏大厅页（Task 9 / SubTask 9.1 / 9.4 / 9.5）
 *
 * 职责：
 * - 顶部筛选区：类别 Select / 搜索 Input.Search / 排序 Select（紧凑排列）
 * - 卡片网格：antd Row + Col，响应式 xs=24 / sm=12 / md=8 / lg=6
 * - 加载态：isLoadingGames=true 时显示 antd Spin
 * - 空状态：games 为空或筛选后无匹配时显示 antd Empty（文案"暂无匹配游戏"）
 * - 卡片点击：通知 gameStore.selectGame + gameUIStore.setCurrentView('detail')
 *
 * 设计要点：
 * - **筛选逻辑位置**：在组件内使用 useMemo 派生 filteredGames，避免污染 store
 *   （符合 Task 8 的"store 仅承载全局状态，UI 派生态在组件内"原则）。
 *   同时将派生逻辑抽出为纯函数 `filterAndSortGames`，便于单元测试覆盖
 * - **加载态判断**：使用 `gameStore.isLoadingGames`（**注意非 `isLoading`**），
 *   这是 store 实际暴露的字段名（详见 src/renderer/stores/gameStore.ts:60）
 * - **数据源**：`gameStore.games: GameIndexEntry[]`（**注意非 `GameMeta[]`**），
 *   store 仅提供摘要字段（id / type / title / subtitle / status / coverPath / tags /
 *   createdAt / updatedAt），完整 meta.json 由详情页（Task 10）通过 selectGame 拉取
 * - **卡片点击**：通过 `useGameStore.getState().selectGame(gameId)` 通知 store
 *   选中游戏（store 会异步拉取完整 meta），再通过 `useGameUIStore.getState()
 *   .setCurrentView('detail')` 切换视图。两个 store 都通过 getState() 调用，
 *   避免订阅整个 store 导致冗余渲染
 *
 * 参考：
 * - src/renderer/components/Creative/WritingMode/WritingProjectList.tsx（列表 + 筛选模式）
 * - src/renderer/components/Game/GameModeEntry.tsx（容器结构与 store 读取模式）
 */

import { useMemo, useState } from 'react';
import { Row, Col, Select, Input, Spin, Empty, Space } from 'antd';
import { useGameStore } from '../../stores/gameStore';
import { useGameUIStore } from '../../stores/gameUIStore';
import { GameCard } from './GameCard';
import {
  GAME_TYPE_OPTIONS,
  GAME_SORT_OPTIONS
} from '../../../shared/constants/game.constants';
import type { GameSortField } from '../../../shared/constants/game.constants';
import {
  GameType,
  type GameIndexEntry
} from '../../../shared/types/game.types';
import './GameLobby.css';

// ==================== 常量 ====================

/**
 * 类别筛选选项（在 GAME_TYPE_OPTIONS 前置"全部"选项）
 *
 * value='all' 作为"不筛选"的标记
 */
const TYPE_FILTER_OPTIONS = [
  { value: 'all', label: '全部' },
  ...GAME_TYPE_OPTIONS
];

/** 类别筛选值类型 */
type TypeFilterValue = 'all' | GameType;

// ==================== 派生函数（导出便于测试） ====================

/**
 * 过滤并排序游戏列表（纯函数）
 *
 * 抽出为独立函数便于在测试中直接调用，避免依赖组件渲染与 antd 事件系统。
 *
 * 筛选逻辑：
 * 1. 类别：typeFilter === 'all' 时不过滤；否则要求 g.type === typeFilter
 * 2. 搜索：title 或 subtitle 中包含关键词（不区分大小写）；空关键词时不过滤
 *
 * 排序逻辑：
 * - 'updatedAt'：按 updatedAt 倒序（最新的在前）
 * - 'createdAt'：按 createdAt 倒序（最新创建的在前）
 * - 'title'：按 title 字母序（localeCompare zh）
 *
 * @param games       原始游戏列表
 * @param typeFilter  类别筛选值
 * @param search      搜索关键词
 * @param sortBy      排序字段
 * @returns           过滤并排序后的新数组（不修改原数组）
 */
export function filterAndSortGames(
  games: GameIndexEntry[],
  typeFilter: TypeFilterValue,
  search: string,
  sortBy: GameSortField
): GameIndexEntry[] {
  const lowerSearch = search.trim().toLowerCase();

  // 1. 过滤
  const filtered = games.filter((g) => {
    // 类别筛选
    if (typeFilter !== 'all' && g.type !== typeFilter) {
      return false;
    }
    // 搜索筛选（标题或副标题包含关键词，不区分大小写）
    if (lowerSearch.length > 0) {
      const titleMatch = g.title.toLowerCase().includes(lowerSearch);
      const subtitleMatch = (g.subtitle ?? '').toLowerCase().includes(lowerSearch);
      if (!titleMatch && !subtitleMatch) {
        return false;
      }
    }
    return true;
  });

  // 2. 排序（复制一份避免修改原数组）
  return [...filtered].sort((a, b) => {
    if (sortBy === 'updatedAt') {
      return b.updatedAt - a.updatedAt;
    }
    if (sortBy === 'createdAt') {
      return b.createdAt - a.createdAt;
    }
    if (sortBy === 'title') {
      return a.title.localeCompare(b.title, 'zh');
    }
    return 0;
  });
}

// ==================== 组件 ====================

export const GameLobby: React.FC = () => {
  // ----- 订阅 store 数据（仅订阅必要字段，避免冗余渲染）-----
  const games = useGameStore((s) => s.games);
  const isLoadingGames = useGameStore((s) => s.isLoadingGames);

  // ----- 本地 UI 状态（筛选/搜索/排序不污染 store）-----
  const [typeFilter, setTypeFilter] = useState<TypeFilterValue>('all');
  const [search, setSearch] = useState<string>('');
  const [sortBy, setSortBy] = useState<GameSortField>('updatedAt');

  // ----- 派生数据（useMemo 避免每次渲染都重算）-----
  const filteredGames = useMemo(
    () => filterAndSortGames(games, typeFilter, search, sortBy),
    [games, typeFilter, search, sortBy]
  );

  // ----- 卡片点击：通知 store + 切换视图 -----
  const handleCardClick = (gameId: string) => {
    // 1. 通知 store 选中该游戏（store 内部异步拉取完整 meta）
    void useGameStore.getState().selectGame(gameId);
    // 2. 切换到详情视图（previousView 由 store 内部记录为 'lobby'）
    useGameUIStore.getState().setCurrentView('detail');
  };

  // ----- 渲染 -----
  return (
    <div className="game-lobby">
      {/* 顶部筛选区 */}
      <div className="game-lobby__filter-bar">
        <Space wrap>
          <Select
            value={typeFilter}
            onChange={(v: TypeFilterValue) => setTypeFilter(v)}
            options={TYPE_FILTER_OPTIONS}
            style={{ width: 140 }}
            placeholder="类别"
            aria-label="按类别筛选"
          />
          <Input.Search
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(v) => setSearch(v)}
            placeholder="搜索游戏标题或副标题..."
            allowClear
            style={{ width: 260 }}
          />
          <Select
            value={sortBy}
            onChange={(v: GameSortField) => setSortBy(v)}
            options={GAME_SORT_OPTIONS}
            style={{ width: 140 }}
            placeholder="排序"
            aria-label="按字段排序"
          />
        </Space>
      </div>

      {/* 主体内容：加载态 / 空状态 / 卡片网格 */}
      {isLoadingGames ? (
        <div className="game-lobby__loading">
          {/* antd v6：Spin 的 `tip` prop 已弃用，改用 `description` */}
          <Spin size="large" description="加载中..." />
        </div>
      ) : filteredGames.length === 0 ? (
        <div className="game-lobby__empty">
          <Empty description="暂无匹配游戏" />
        </div>
      ) : (
        <Row gutter={[16, 16]} className="game-lobby__grid">
          {filteredGames.map((game) => (
            <Col key={game.id} xs={24} sm={12} md={8} lg={6}>
              <GameCard meta={game} onClick={handleCardClick} />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
};

export default GameLobby;
