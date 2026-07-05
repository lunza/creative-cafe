/**
 * GameModeEntry 容器组件测试（Task 8 / SubTask 8.5）
 *
 * 注意：此测试需通过 `npx vitest run <path>` 显式运行，
 * vitest.config.ts 当前 include 仅匹配 .test.ts 文件，不拾取 .tsx 文件
 *
 * 测试覆盖：
 * 1. 挂载时调用 loadGames
 * 2. currentView 为 'lobby' 时渲染 GameLobby
 * 3. currentView 为 'detail' 时渲染 GameDetailPage
 * 4. currentView 为 'main' 时渲染 GameMainPage
 * 5. 视图切换时触发过渡动画（key 变化，通过 data-base-view 属性变化验证）
 *
 * 测试环境限制：
 * - vitest environment: 'node'，未安装 jsdom / happy-dom / @testing-library/react
 * - 渲染使用 react-dom/server 的 renderToStaticMarkup
 * - renderToStaticMarkup 不会触发 useEffect，因此通过 mock React.useEffect
 *   捕获回调并手动调用以验证 effect 行为
 * - React.lazy + Suspense 在 server 端默认显示 fallback；
 *   测试通过"先渲染触发 lazy → await Promise 解析 → 再渲染"的模式验证实际内容
 *
 * 参考：
 * - src/renderer/components/Game/__tests__/AnsiTileMap.test.tsx（renderToStaticMarkup 模式）
 * - src/renderer/stores/__tests__/gameStore.test.ts（vi.hoisted 模式）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';

// ==================== Mock 设置（必须在 import GameModeEntry 之前生效） ====================

/**
 * vi.hoisted 的回调会在所有 import 之前执行，因此可在此设置可变 mock 状态。
 *
 * - mockState：组件读取的 currentView / previousView，测试用例可修改
 * - loadGamesMock：gameStore.loadGames 的 mock 实现
 * - capturedEffects：useEffect 被调用时捕获的回调与 deps
 */
const { mockState, loadGamesMock, capturedEffects } = vi.hoisted(() => ({
  mockState: {
    currentView: 'lobby' as
      | 'lobby'
      | 'detail'
      | 'main'
      | 'options'
      | 'gallery'
      | 'saves',
    previousView: null as
      | 'lobby'
      | 'detail'
      | 'main'
      | 'options'
      | 'gallery'
      | 'saves'
      | null
  },
  loadGamesMock: vi.fn(),
  capturedEffects: [] as Array<{
    cb: () => void;
    deps: unknown[];
  }>
}));

// ----- Mock React：替换 useEffect 为捕获器（其他 hook 保持原样）-----
//
// 必要性：renderToStaticMarkup 不运行 useEffect，因此无法直接验证"挂载时调用 loadGames"。
// 替换 useEffect 为捕获器，测试可手动调用捕获的回调以模拟 mount effect。
// 注意：保持 lazy / Suspense / useState 等其他 React export 不变，避免破坏 lazy 加载。
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: (cb: () => void, deps?: unknown[]) => {
      capturedEffects.push({ cb, deps: deps ?? [] });
      // 不立即调用 cb：renderToStaticMarkup 不会运行 effect，由测试用例手动触发
    }
  };
});

// ----- Mock gameStore：仅暴露 useGameStore.getState().loadGames -----
//
// 注意：vi.mock 的路径是相对于测试文件解析的。
// 测试文件位于 src/renderer/components/Game/__tests__/，
// 因此需要 ../../../ 才能到达 src/renderer/stores/gameStore
vi.mock('../../../stores/gameStore', () => ({
  useGameStore: Object.assign(
    vi.fn(() => ({})), // for component reads (component 未直接订阅 store 数据)
    {
      getState: () => ({ loadGames: loadGamesMock })
    }
  )
}));

// ----- Mock gameUIStore：返回 mockState 中的 currentView / previousView -----
vi.mock('../../../stores/gameUIStore', () => ({
  useGameUIStore: vi.fn(
    (selector: (s: { currentView: unknown; previousView: unknown }) => unknown) =>
      selector({
        currentView: mockState.currentView,
        previousView: mockState.previousView
      })
  )
}));

// ----- Mock 子页面：替换为简单的 div（避免 antd 依赖 + 解决 lazy 同步问题）-----
//
// 用 vi.mock 替换后，React.lazy 的 factory 仍返回 Promise（异步），
// 但 mock 模块本身是同步的。测试用例通过"先渲染触发 lazy → flush → 再渲染"验证。
vi.mock('../GameLobby', () => ({
  GameLobby: () =>
    React.createElement('div', { 'data-testid': 'lobby' }, 'GameLobby')
}));
vi.mock('../GameDetailPage', () => ({
  GameDetailPage: () =>
    React.createElement('div', { 'data-testid': 'detail' }, 'GameDetailPage')
}));
vi.mock('../GameMainPage', () => ({
  GameMainPage: () =>
    React.createElement('div', { 'data-testid': 'main' }, 'GameMainPage')
}));

// ==================== 在 mock 之后导入被测组件 ====================

import { GameModeEntry, resolveBaseView } from '../GameModeEntry';

// ==================== 测试辅助函数 ====================

/**
 * 等待所有 lazy Promise 解析（让 React.lazy 完成 import）
 *
 * renderToStaticMarkup 是同步的，无法 await lazy Promise。
 * 但 lazy 在被渲染时会触发 import（即使被 Suspense fallback 捕获）。
 * 通过先渲染一次触发 lazy import，await flushLazy 等待 Promise 解析，
 * 再次渲染时 lazy 组件已初始化，可同步渲染。
 */
async function flushLazy(): Promise<void> {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

/** 渲染组件并返回 HTML 字符串 */
function renderEntry(): string {
  return renderToStaticMarkup(React.createElement(GameModeEntry));
}

// ==================== Tests: resolveBaseView 纯函数 ====================

describe('resolveBaseView', () => {
  it('lobby 视图直接返回 lobby', () => {
    expect(resolveBaseView('lobby', null)).toBe('lobby');
  });

  it('detail 视图直接返回 detail', () => {
    expect(resolveBaseView('detail', null)).toBe('detail');
  });

  it('main 视图直接返回 main', () => {
    expect(resolveBaseView('main', null)).toBe('main');
  });

  it('options 视图回退到 previousView=detail', () => {
    expect(resolveBaseView('options', 'detail')).toBe('detail');
  });

  it('gallery 视图回退到 previousView=main', () => {
    expect(resolveBaseView('gallery', 'main')).toBe('main');
  });

  it('saves 视图回退到 previousView=lobby', () => {
    expect(resolveBaseView('saves', 'lobby')).toBe('lobby');
  });

  it('对话框视图 previousView=null 时回退到 detail（默认值）', () => {
    expect(resolveBaseView('options', null)).toBe('detail');
    expect(resolveBaseView('gallery', null)).toBe('detail');
    expect(resolveBaseView('saves', null)).toBe('detail');
  });

  it('对话框视图 previousView 也是对话框视图时回退到 detail', () => {
    // 边界场景：previousView 也是 options（极端情况）
    expect(resolveBaseView('options', 'gallery')).toBe('detail');
    expect(resolveBaseView('saves', 'options')).toBe('detail');
  });
});

// ==================== Tests: GameModeEntry 组件 ====================

describe('GameModeEntry', () => {
  beforeEach(() => {
    loadGamesMock.mockClear();
    capturedEffects.length = 0;
    mockState.currentView = 'lobby';
    mockState.previousView = null;
  });

  // ---------------- 测试 1：挂载时调用 loadGames ----------------
  it('挂载时调用 loadGames', () => {
    renderEntry();

    // renderToStaticMarkup 不运行 useEffect，但 mock 已捕获 effect 回调
    expect(capturedEffects.length).toBeGreaterThan(0);

    // 找到 mount-only effect（空依赖数组）并调用
    // 注意：capturedEffects 中可能包含 antd Spin 等子组件的 useEffect，
    // 因此需要通过 deps=[] 筛选出 GameModeEntry 的 mount effect
    const mountEffects = capturedEffects.filter((e) => e.deps.length === 0);
    expect(mountEffects.length).toBeGreaterThanOrEqual(1);

    // 调用所有 mount effect（GameModeEntry 的 effect 会调用 loadGames）
    for (const { cb } of mountEffects) {
      cb();
    }

    // loadGames 应被调用至少一次（具体次数取决于 mount effect 数量，
    // 但 GameModeEntry 只声明了一个 mount effect，应为 1 次）
    expect(loadGamesMock).toHaveBeenCalled();
  });

  // ---------------- 测试 2：currentView 为 lobby 时渲染 GameLobby ----------------
  it('currentView 为 lobby 时渲染 GameLobby', async () => {
    mockState.currentView = 'lobby';
    mockState.previousView = null;

    // 第一次渲染触发 lazy 加载（会显示 Suspense fallback）
    renderEntry();
    // 等待 lazy Promise 解析
    await flushLazy();
    // 第二次渲染应显示实际子组件
    const html = renderEntry();

    expect(html).toContain('GameLobby');
    // 验证 data-base-view 属性正确反映当前视图
    expect(html).toContain('data-base-view="lobby"');
  });

  // ---------------- 测试 3：currentView 为 detail 时渲染 GameDetailPage ----------------
  it('currentView 为 detail 时渲染 GameDetailPage', async () => {
    mockState.currentView = 'detail';
    mockState.previousView = 'lobby';

    renderEntry();
    await flushLazy();
    const html = renderEntry();

    expect(html).toContain('GameDetailPage');
    expect(html).toContain('data-base-view="detail"');
  });

  // ---------------- 测试 4：currentView 为 main 时渲染 GameMainPage ----------------
  it('currentView 为 main 时渲染 GameMainPage', async () => {
    mockState.currentView = 'main';
    mockState.previousView = 'detail';

    renderEntry();
    await flushLazy();
    const html = renderEntry();

    expect(html).toContain('GameMainPage');
    expect(html).toContain('data-base-view="main"');
  });

  // ---------------- 测试 5：视图切换时触发过渡动画（key 变化） ----------------
  it('视图切换时 data-base-view 属性变化（key 变化触发重新挂载与过渡动画）', async () => {
    // 切换到 lobby
    mockState.currentView = 'lobby';
    mockState.previousView = null;
    renderEntry();
    await flushLazy();
    const htmlLobby = renderEntry();
    expect(htmlLobby).toContain('data-base-view="lobby"');

    // 切换到 detail
    mockState.currentView = 'detail';
    mockState.previousView = 'lobby';
    renderEntry();
    await flushLazy();
    const htmlDetail = renderEntry();
    expect(htmlDetail).toContain('data-base-view="detail"');

    // 切换到 main
    mockState.currentView = 'main';
    mockState.previousView = 'detail';
    renderEntry();
    await flushLazy();
    const htmlMain = renderEntry();
    expect(htmlMain).toContain('data-base-view="main"');

    // 验证三次渲染的 base-view 属性确实不同（说明 key 变化、过渡动画会被触发）
    expect(htmlLobby).not.toBe(htmlDetail);
    expect(htmlDetail).not.toBe(htmlMain);
  });

  // ---------------- 补充：对话框视图回退渲染 ----------------
  it('currentView 为 options 时回退渲染 previousView', async () => {
    mockState.currentView = 'options';
    mockState.previousView = 'detail';

    renderEntry();
    await flushLazy();
    const html = renderEntry();

    // data-current-view 显示原始 options（路由层状态）
    expect(html).toContain('data-current-view="options"');
    // data-base-view 显示 detail（回退渲染的基础视图）
    expect(html).toContain('data-base-view="detail"');
    // 应渲染 GameDetailPage（回退到 detail）
    expect(html).toContain('GameDetailPage');
  });

  it('currentView 为 gallery 时回退渲染 previousView=main', async () => {
    mockState.currentView = 'gallery';
    mockState.previousView = 'main';

    renderEntry();
    await flushLazy();
    const html = renderEntry();

    expect(html).toContain('data-current-view="gallery"');
    expect(html).toContain('data-base-view="main"');
    expect(html).toContain('GameMainPage');
  });

  it('currentView 为 saves 时回退渲染 previousView=lobby', async () => {
    mockState.currentView = 'saves';
    mockState.previousView = 'lobby';

    renderEntry();
    await flushLazy();
    const html = renderEntry();

    expect(html).toContain('data-current-view="saves"');
    expect(html).toContain('data-base-view="lobby"');
    expect(html).toContain('GameLobby');
  });

  // ---------------- 补充：Suspense fallback 容器存在性 ----------------
  it('组件渲染时包含 game-mode-entry 容器与 view 容器', async () => {
    // 渲染前先 flush，确保 lazy 已解析（避免与上一个测试的 lazy 状态冲突）
    renderEntry();
    await flushLazy();
    const html = renderEntry();

    // 容器结构完整
    expect(html).toContain('game-mode-entry');
    expect(html).toContain('game-mode-entry__view');
    // data 属性存在
    expect(html).toMatch(/data-current-view="[^"]+"/);
    expect(html).toMatch(/data-base-view="[^"]+"/);
  });

  // ---------------- 补充：容器 data-current-view 属性 ----------------
  it('容器 data-current-view 属性反映原始 currentView（含对话框视图）', async () => {
    mockState.currentView = 'saves';
    mockState.previousView = 'detail';
    renderEntry();
    await flushLazy();
    const html = renderEntry();

    // data-current-view 显示 saves（原始路由视图）
    expect(html).toContain('data-current-view="saves"');
  });
});
