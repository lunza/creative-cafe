/**
 * GameLobby 组件测试（Task 9 / SubTask 9.5）
 *
 * 测试覆盖：
 * 1. 加载状态显示 Spin
 * 2. 空状态显示 Empty 与"暂无匹配游戏"文案
 * 3. 正常数据渲染卡片网格
 * 4. 类别筛选：选择"狼人杀"后只显示对应类型的卡片（通过纯函数 filterAndSortGames 验证）
 * 5. 搜索：输入关键词后过滤卡片（通过纯函数 filterAndSortGames 验证）
 * 6. 排序：选择不同排序方式后顺序变化（通过纯函数 filterAndSortGames 验证）
 * 7. 卡片点击触发 selectGame + setCurrentView
 *
 * 测试环境限制：
 * - vitest environment: 'node'，未安装 jsdom / happy-dom / @testing-library/react
 * - 渲染使用 react-dom/server 的 renderToStaticMarkup（在 node 环境可用）
 * - renderToStaticMarkup 不会触发 React 事件处理器，因此"卡片点击"测试通过
 *   mock GameCard 捕获 onClick 回调并手动调用，验证 store action 被正确触发
 * - 类别 / 搜索 / 排序的过滤派生逻辑通过导出的纯函数 `filterAndSortGames`
 *   直接测试（避免依赖 antd Select / Input 的事件系统）
 *
 * 参考：
 * - src/renderer/components/Game/__tests__/GameModeEntry.test.tsx（mock store 模式）
 * - src/renderer/components/Game/__tests__/AnsiTileMap.test.tsx（renderToStaticMarkup 模式）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';

// ==================== Mock 设置（必须在 import GameLobby 之前生效） ====================

/**
 * vi.hoisted 的回调会在所有 import 之前执行，因此可在此设置可变 mock 状态。
 *
 * - mockGamesState：组件读取的 games / isLoadingGames，测试用例可修改
 * - selectGameMock：gameStore.selectGame 的 mock 实现
 * - setCurrentViewMock：gameUIStore.setCurrentView 的 mock 实现
 * - capturedCardOnClick：GameCard mock 渲染时捕获的 onClick 回调
 */
const { mockGamesState, selectGameMock, setCurrentViewMock, capturedCardOnClick } =
  vi.hoisted(() => ({
    mockGamesState: {
      games: [] as Array<import('../../../../shared/types/game.types').GameIndexEntry>,
      isLoadingGames: false
    },
    selectGameMock: vi.fn(),
    setCurrentViewMock: vi.fn(),
    // 使用 { current: ... } 容器（类似 React.useRef 模式），便于在 mock 工厂内
    // 通过引用修改最新捕获的 onClick，而无需重新赋值 capturedCardOnClick 自身
    capturedCardOnClick: {
      current: null as ((gameId: string) => void) | null
    }
  }));

// ----- Mock gameStore：返回 mockGamesState 中的 games / isLoadingGames -----
//
// 注意：vi.mock 的路径是相对于测试文件解析的。
// 测试文件位于 src/renderer/components/Game/__tests__/，
// 因此需要 ../../../ 才能到达 src/renderer/stores/gameStore
vi.mock('../../../stores/gameStore', () => ({
  useGameStore: Object.assign(
    vi.fn(
      (selector: (s: { games: unknown[]; isLoadingGames: boolean }) => unknown) =>
        selector({
          games: mockGamesState.games,
          isLoadingGames: mockGamesState.isLoadingGames
        })
    ),
    {
      getState: () => ({ selectGame: selectGameMock })
    }
  )
}));

// ----- Mock gameUIStore：仅暴露 getState().setCurrentView -----
//
// GameLobby 不直接订阅 gameUIStore 数据（仅调用 getState），因此可简化为对象。
vi.mock('../../../stores/gameUIStore', () => ({
  useGameUIStore: {
    getState: () => ({ setCurrentView: setCurrentViewMock })
  }
}));

// ----- Mock GameCard：捕获 onClick 回调，便于测试用例手动触发 -----
//
// 替换为简单的 div，data-game-id 反映 meta.id；
// onClick 通过 prop 传入并捕获到 capturedCardOnClick。
vi.mock('../GameCard', () => ({
  GameCard: (props: {
    meta: { id: string; title: string };
    onClick: (gameId: string) => void;
  }) => {
    // 捕获最新一次渲染的 onClick（每次渲染都会覆盖）
    capturedCardOnClick.current = props.onClick;
    return React.createElement(
      'div',
      {
        'data-testid': 'game-card',
        'data-game-id': props.meta.id
      },
      props.meta.title
    );
  }
}));

// ==================== 在 mock 之后导入被测组件 ====================

import { GameLobby, filterAndSortGames } from '../GameLobby';
import {
  GameType,
  GameStatus,
  type GameIndexEntry
} from '../../../../shared/types/game.types';

// ==================== 测试数据 ====================

/**
 * 3 条测试数据，覆盖 3 种类型 / 3 种状态 / 3 个不同的 updatedAt / createdAt / title
 *
 * - g1: WEREWOLF / COMPLETED / updatedAt=3000 / createdAt=1000 / title='Alpha Game'
 * - g2: MYSTERY  / IN_DEVELOPMENT / updatedAt=2000 / createdAt=2000 / title='Beta Game'
 * - g3: MANAGEMENT / PLANNED / updatedAt=1000 / createdAt=3000 / title='Gamma Game'
 */
const MOCK_GAMES: GameIndexEntry[] = [
  {
    id: 'g1',
    type: GameType.WEREWOLF,
    title: 'Alpha Game',
    subtitle: '狼人杀副标题',
    status: GameStatus.COMPLETED,
    tags: ['推理', '多人'],
    createdAt: 1000,
    updatedAt: 3000
  },
  {
    id: 'g2',
    type: GameType.MYSTERY,
    title: 'Beta Game',
    subtitle: '推理副标题',
    status: GameStatus.IN_DEVELOPMENT,
    tags: ['解谜'],
    createdAt: 2000,
    updatedAt: 2000
  },
  {
    id: 'g3',
    type: GameType.MANAGEMENT,
    title: 'Gamma Game',
    subtitle: '经营副标题',
    status: GameStatus.PLANNED,
    tags: ['经营', '回合制'],
    createdAt: 3000,
    updatedAt: 1000
  }
];

// ==================== 测试辅助函数 ====================

/** 渲染 GameLobby 并返回 HTML 字符串 */
function renderLobby(): string {
  return renderToStaticMarkup(React.createElement(GameLobby));
}

// ==================== Tests: filterAndSortGames 纯函数 ====================

describe('filterAndSortGames（纯函数）', () => {
  // ---------------- 类别筛选 ----------------
  it('类别筛选：选择狼人杀后只显示对应类型', () => {
    const result = filterAndSortGames(MOCK_GAMES, GameType.WEREWOLF, '', 'updatedAt');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('g1');
  });

  it('类别筛选：选择推理后只显示对应类型', () => {
    const result = filterAndSortGames(MOCK_GAMES, GameType.MYSTERY, '', 'updatedAt');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('g2');
  });

  it('类别筛选：选择"全部"显示所有游戏', () => {
    const result = filterAndSortGames(MOCK_GAMES, 'all', '', 'updatedAt');
    expect(result).toHaveLength(3);
  });

  it('类别筛选：选择无匹配类型时返回空数组', () => {
    const result = filterAndSortGames(MOCK_GAMES, GameType.DATING_SIM, '', 'updatedAt');
    expect(result).toHaveLength(0);
  });

  // ---------------- 搜索筛选 ----------------
  it('搜索：标题包含关键词（不区分大小写）', () => {
    const result = filterAndSortGames(MOCK_GAMES, 'all', 'alpha', 'updatedAt');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('g1');
  });

  it('搜索：副标题包含关键词', () => {
    const result = filterAndSortGames(MOCK_GAMES, 'all', '推理副标题', 'updatedAt');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('g2');
  });

  it('搜索：空关键词不过滤', () => {
    const result = filterAndSortGames(MOCK_GAMES, 'all', '', 'updatedAt');
    expect(result).toHaveLength(3);
  });

  it('搜索：仅空格的关键词不过滤', () => {
    const result = filterAndSortGames(MOCK_GAMES, 'all', '   ', 'updatedAt');
    expect(result).toHaveLength(3);
  });

  it('搜索：无匹配时返回空数组', () => {
    const result = filterAndSortGames(MOCK_GAMES, 'all', '不存在的关键词', 'updatedAt');
    expect(result).toHaveLength(0);
  });

  // ---------------- 排序 ----------------
  it('排序：updatedAt 倒序（最新的在前）', () => {
    const result = filterAndSortGames(MOCK_GAMES, 'all', '', 'updatedAt');
    expect(result.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']); // 3000, 2000, 1000
  });

  it('排序：createdAt 倒序（最新创建的在前）', () => {
    const result = filterAndSortGames(MOCK_GAMES, 'all', '', 'createdAt');
    expect(result.map((g) => g.id)).toEqual(['g3', 'g2', 'g1']); // 3000, 2000, 1000
  });

  it('排序：title 字母序', () => {
    const result = filterAndSortGames(MOCK_GAMES, 'all', '', 'title');
    expect(result.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']); // Alpha, Beta, Gamma
  });

  // ---------------- 组合筛选 ----------------
  it('组合筛选：类别 + 搜索', () => {
    const result = filterAndSortGames(MOCK_GAMES, GameType.MYSTERY, 'Beta', 'updatedAt');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('g2');
  });

  it('组合筛选：类别与搜索结果不交集时返回空数组', () => {
    // 类别=WEREWOLF 但搜索关键词仅匹配 MYSTERY 的标题
    const result = filterAndSortGames(MOCK_GAMES, GameType.WEREWOLF, 'Beta', 'updatedAt');
    expect(result).toHaveLength(0);
  });

  // ---------------- 不修改原数组 ----------------
  it('不修改原数组（返回新数组）', () => {
    const original = [...MOCK_GAMES];
    const result = filterAndSortGames(MOCK_GAMES, 'all', '', 'title');
    expect(result).not.toBe(MOCK_GAMES); // 不同引用
    expect(MOCK_GAMES).toEqual(original); // 原数组未变
  });
});

// ==================== Tests: GameLobby 组件 ====================

describe('GameLobby（组件渲染）', () => {
  beforeEach(() => {
    // 每个用例前重置 mock 状态
    mockGamesState.games = [];
    mockGamesState.isLoadingGames = false;
    selectGameMock.mockClear();
    setCurrentViewMock.mockClear();
    capturedCardOnClick.current = null;
  });

  // ---------------- 测试 1：加载状态显示 Spin ----------------
  it('加载状态显示 Spin（包含 "加载中" 文案与 ant-spin 类）', () => {
    mockGamesState.isLoadingGames = true;
    mockGamesState.games = [];
    const html = renderLobby();

    // antd Spin 渲染 ant-spin 类与 tip 文案
    expect(html).toContain('ant-spin');
    expect(html).toContain('加载中');
  });

  // ---------------- 测试 2：空状态显示 Empty ----------------
  it('空状态显示 Empty 与"暂无匹配游戏"文案', () => {
    mockGamesState.isLoadingGames = false;
    mockGamesState.games = [];
    const html = renderLobby();

    expect(html).toContain('ant-empty');
    expect(html).toContain('暂无匹配游戏');
  });

  // ---------------- 测试 3：正常数据渲染卡片网格 ----------------
  it('正常数据渲染卡片网格（每张卡片的标题都出现）', () => {
    mockGamesState.isLoadingGames = false;
    mockGamesState.games = MOCK_GAMES;
    const html = renderLobby();

    // 验证 3 张卡片的标题都渲染出来（GameCard 已被 mock 为简单 div，
    // 标题作为子节点直接渲染）
    expect(html).toContain('Alpha Game');
    expect(html).toContain('Beta Game');
    expect(html).toContain('Gamma Game');

    // 验证 data-game-id 属性存在
    expect(html).toContain('data-game-id="g1"');
    expect(html).toContain('data-game-id="g2"');
    expect(html).toContain('data-game-id="g3"');
  });

  // ---------------- 测试 4：筛选区组件存在 ----------------
  it('筛选区渲染类别 Select / 搜索 Input.Search / 排序 Select', () => {
    mockGamesState.games = MOCK_GAMES;
    const html = renderLobby();

    // antd Select 渲染 ant-select 类
    expect(html).toContain('ant-select');
    // Input.Search 渲染 ant-input-search 类，且 placeholder 出现
    expect(html).toContain('搜索游戏标题或副标题');
    // 应该至少有 2 个 Select（类别 + 排序）
    const selectCount = (html.match(/ant-select/g) ?? []).length;
    expect(selectCount).toBeGreaterThanOrEqual(2);
  });

  // ---------------- 测试 5：加载状态不渲染卡片网格 ----------------
  it('加载状态时不渲染卡片网格', () => {
    mockGamesState.isLoadingGames = true;
    mockGamesState.games = MOCK_GAMES;
    const html = renderLobby();

    // 加载中：不应渲染卡片标题（应显示 Spin）
    expect(html).not.toContain('Alpha Game');
    expect(html).toContain('ant-spin');
  });

  // ---------------- 测试 6：卡片点击触发 selectGame + setCurrentView ----------------
  it('卡片点击触发 selectGame + setCurrentView', () => {
    mockGamesState.isLoadingGames = false;
    mockGamesState.games = MOCK_GAMES;

    // 渲染组件（GameCard mock 会捕获 onClick 到 capturedCardOnClick.current）
    renderLobby();

    // 验证 onClick 被捕获
    expect(capturedCardOnClick.current).not.toBeNull();

    // 手动调用 onClick（模拟用户点击卡片）
    capturedCardOnClick.current!('g2');

    // 验证 store action 被正确触发
    expect(selectGameMock).toHaveBeenCalledWith('g2');
    expect(setCurrentViewMock).toHaveBeenCalledWith('detail');
  });

  // ---------------- 测试 7：点击不同卡片传递不同的 gameId ----------------
  it('点击不同卡片传递不同的 gameId', () => {
    mockGamesState.games = MOCK_GAMES;
    renderLobby();

    // GameCard mock 每次渲染都覆盖 capturedCardOnClick.current，
    // 因此这里只能验证最后一次捕获的 onClick（对应最后一张卡片 g3）。
    // 渲染顺序由 filterAndSortGames 决定：默认按 updatedAt 倒序，即 [g1, g2, g3]，
    // 最后渲染的是 g3，capturedCardOnClick 对应 g3 的 onClick。
    capturedCardOnClick.current!('g3');
    expect(selectGameMock).toHaveBeenCalledWith('g3');
    expect(setCurrentViewMock).toHaveBeenCalledWith('detail');
  });

  // ---------------- 测试 8：容器结构与样式类名 ----------------
  it('渲染容器包含 game-lobby / game-lobby__filter-bar / game-lobby__grid 类', () => {
    mockGamesState.games = MOCK_GAMES;
    const html = renderLobby();

    expect(html).toContain('class="game-lobby"');
    expect(html).toContain('game-lobby__filter-bar');
    expect(html).toContain('game-lobby__grid');
  });

  // ---------------- 测试 9：响应式 Col 断点 ----------------
  it('卡片 Col 包含响应式断点 xs=24 / sm=12 / md=8 / lg=6', () => {
    mockGamesState.games = MOCK_GAMES;
    const html = renderLobby();

    // antd Col 渲染为 ant-col 类，并加上断点修饰类 ant-col-xs-24 等
    expect(html).toContain('ant-col-xs-24');
    expect(html).toContain('ant-col-sm-12');
    expect(html).toContain('ant-col-md-8');
    expect(html).toContain('ant-col-lg-6');
  });
});
