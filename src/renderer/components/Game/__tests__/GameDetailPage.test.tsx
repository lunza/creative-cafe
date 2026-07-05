/**
 * GameDetailPage 测试（Task 10 / SubTask 10.7）
 *
 * 测试覆盖：
 * 1. 正常渲染元数据
 * 2. 无 currentGame 时显示 Empty
 * 3. "开始游戏"按钮点击触发 startNewGame + setCurrentView('main')
 * 4. "读取存档"按钮点击打开 GameSaveDialog（通过 gameUIStore 控制 dialog 显隐）
 * 5. "选项"按钮点击打开 GameOptionsDialog
 * 6. "画廊"按钮点击打开 GameGalleryDialog
 * 7. 模板未注册 onOtherAction 时"其他"按钮隐藏
 * 8. 模板注册 onOtherAction 时"其他"按钮显示
 * 9. "关闭"按钮点击返回 lobby
 *
 * 测试环境限制：
 * - vitest environment: 'node'，未安装 jsdom / happy-dom / @testing-library/react
 * - 渲染使用 react-dom/server 的 renderToStaticMarkup
 * - 通过 mock antd Button 捕获 onClick 回调（key 为按钮文本），测试用例手动调用
 *
 * 关键 mock 策略：
 * - vi.hoisted 提供 mockState（currentGame / showXxxDialog）与 mockActions（startNewGame 等）
 * - vi.mock('antd', ...) 替换 Button 为捕获器，其他 antd 组件保留原样（SSR 兼容）
 * - vi.mock('react', ...) 替换 useEffect 为 no-op（避免 antd Spin 等副组件触发 store 订阅）
 * - vi.mock GameSaveDialog / GameOptionsDialog / GameGalleryDialog 为简单 div，显示 data-open 状态
 * - vi.mock GameTemplateRegistry，提供 mockGet 控制是否返回带 onOtherAction 的模板
 *
 * 参考：
 * - src/renderer/components/Game/__tests__/GameModeEntry.test.tsx（mock 模式）
 * - src/renderer/stores/__tests__/gameStore.test.ts（vi.hoisted 模式）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';

// ==================== Mock 设置（必须在 import GameDetailPage 之前生效） ====================

const { mockState, mockActions, buttonClickHandlers, mockGetTemplate } = vi.hoisted(() => {
  // ----- mockState：组件读取的 store 状态 -----
  const state = {
    // GameMeta 或 null
    currentGame: null as any,
    // 三个对话框显隐
    showSaveDialog: false,
    showOptionsDialog: false,
    showGalleryDialog: false
  };

  // ----- mockActions：捕获 store action 调用 -----
  const actions = {
    startNewGame: vi.fn(),
    loadSave: vi.fn(),
    setShowSaveDialog: vi.fn(),
    setShowOptionsDialog: vi.fn(),
    setShowGalleryDialog: vi.fn(),
    setCurrentView: vi.fn(),
    onOtherAction: vi.fn()
  };

  // ----- buttonClickHandlers：捕获 antd Button onClick 回调（按按钮文本索引）-----
  const handlers = new Map<string, (...args: any[]) => any>();

  // ----- mockGetTemplate：控制 GameTemplateRegistry.get 的返回值 -----
  // 默认返回 undefined（未注册模板）；测试用例可通过 mockReturnValue 注入带 onOtherAction 的模板
  const getTemplate = vi.fn<(type: string) => any>(() => undefined);

  return {
    mockState: state,
    mockActions: actions,
    buttonClickHandlers: handlers,
    mockGetTemplate: getTemplate
  };
});

// ----- Mock React：替换 useEffect 为 no-op（避免 antd 副作用）-----
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: () => {} // no-op：renderToStaticMarkup 不应触发 effect
  };
});

// ----- Mock antd：替换 Button 为捕获器，其他组件保留原样 -----
//
// 必要性：renderToStaticMarkup 不创建真实 DOM，无法通过 querySelector + click 触发事件。
// 通过 mock Button 捕获 onClick 回调到 buttonClickHandlers Map（key 为 children 文本），
// 测试用例可通过 `buttonClickHandlers.get('开始游戏')?.()` 手动触发点击。
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    Button: ({ children, onClick, type, ...rest }: any) => {
      // 仅捕获 children 为字符串的按钮（避免 antd 内部组合按钮）
      if (typeof children === 'string') {
        if (onClick) {
          buttonClickHandlers.set(children, onClick);
        }
        return React.createElement(
          'button',
          {
            'data-type': type || 'default',
            'data-testid': `btn-${children}`,
            ...rest
          },
          children
        );
      }
      // children 不是字符串（如 ReactNode 数组）时退化为 div
      return React.createElement('button', rest, children);
    }
  };
});

// ----- Mock gameStore：返回 mockState.currentGame + mockActions.startNewGame/loadSave -----
vi.mock('../../../stores/gameStore', () => ({
  useGameStore: vi.fn((selector: (s: any) => any) =>
    selector({
      currentGame: mockState.currentGame,
      startNewGame: mockActions.startNewGame,
      loadSave: mockActions.loadSave
    })
  )
}));

// ----- Mock gameUIStore：返回对话框显隐状态 + setters -----
vi.mock('../../../stores/gameUIStore', () => ({
  useGameUIStore: vi.fn((selector: (s: any) => any) =>
    selector({
      showSaveDialog: mockState.showSaveDialog,
      showOptionsDialog: mockState.showOptionsDialog,
      showGalleryDialog: mockState.showGalleryDialog,
      setShowSaveDialog: mockActions.setShowSaveDialog,
      setShowOptionsDialog: mockActions.setShowOptionsDialog,
      setShowGalleryDialog: mockActions.setShowGalleryDialog,
      setCurrentView: mockActions.setCurrentView
    })
  )
}));

// ----- Mock GameTemplateRegistry：返回 mockGetTemplate 控制的模板 -----
vi.mock('../templates/GameTemplateRegistry', () => ({
  GameTemplateRegistry: {
    get: (type: string) => mockGetTemplate(type),
    list: vi.fn(() => []),
    has: vi.fn(() => false),
    register: vi.fn(),
    clear: vi.fn()
  }
}));

// ----- Mock 三个对话框：渲染为简单 div，暴露 data-open 属性便于验证 -----
vi.mock('../GameSaveDialog', () => ({
  GameSaveDialog: ({ open }: { open: boolean }) =>
    React.createElement('div', {
      'data-testid': 'save-dialog',
      'data-open': open ? 'true' : 'false'
    })
}));
vi.mock('../GameOptionsDialog', () => ({
  GameOptionsDialog: ({ open }: { open: boolean }) =>
    React.createElement('div', {
      'data-testid': 'options-dialog',
      'data-open': open ? 'true' : 'false'
    })
}));
vi.mock('../GameGalleryDialog', () => ({
  GameGalleryDialog: ({ open }: { open: boolean }) =>
    React.createElement('div', {
      'data-testid': 'gallery-dialog',
      'data-open': open ? 'true' : 'false'
    })
}));

// ==================== 在 mock 之后导入被测组件 ====================

import { GameDetailPage } from '../GameDetailPage';

// ==================== 测试辅助函数 ====================

/** 构造一个 mock GameMeta */
function makeMockGame(overrides: Partial<any> = {}) {
  return {
    id: 'pastoral_town',
    type: 'management',
    title: '田园小镇',
    subtitle: '经营你的梦想农场',
    description: '一款文字模拟经营游戏。\n玩家将经营一个农场，建造设施、招募员工、管理资源。',
    gameplay: '通过建造设施、招募员工、结束回合推进游戏进度。',
    developer: 'Creative Cafe',
    version: '1.0.0',
    status: 'completed',
    coverPath: undefined,
    tags: ['经营', '回合制'],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides
  };
}

/** 重置所有 mock 状态与捕获器（在每个测试前调用） */
function resetMockState() {
  mockState.currentGame = null;
  mockState.showSaveDialog = false;
  mockState.showOptionsDialog = false;
  mockState.showGalleryDialog = false;

  Object.values(mockActions).forEach((fn) => fn.mockClear());
  buttonClickHandlers.clear();
  mockGetTemplate.mockReset();
  // 默认未注册模板
  mockGetTemplate.mockReturnValue(undefined);
}

/** 渲染组件并返回 HTML 字符串 */
function renderPage(): string {
  return renderToStaticMarkup(React.createElement(GameDetailPage));
}

// ==================== Tests ====================

describe('GameDetailPage', () => {
  beforeEach(() => {
    resetMockState();
  });

  // ---------------- 测试 1：正常渲染元数据 ----------------
  it('正常渲染元数据（标题 / 副标题 / 类别徽标 / 状态徽标 / 开发者 / 版本）', () => {
    mockState.currentGame = makeMockGame();

    const html = renderPage();

    // 标题与副标题
    expect(html).toContain('田园小镇');
    expect(html).toContain('经营你的梦想农场');
    // 类别标签（management → "经营"）
    expect(html).toContain('经营');
    // 状态标签（completed → "已完成"）
    expect(html).toContain('已完成');
    // 开发者与版本
    expect(html).toContain('开发者：Creative Cafe');
    expect(html).toContain('版本：1.0.0');
    // 详细介绍与玩法说明（多段渲染）
    expect(html).toContain('一款文字模拟经营游戏。');
    expect(html).toContain('玩家将经营一个农场');
    expect(html).toContain('通过建造设施');
    // 操作按钮区
    expect(html).toContain('开始游戏');
    expect(html).toContain('读取存档');
    expect(html).toContain('选项');
    expect(html).toContain('画廊');
    expect(html).toContain('关闭');
    // 封面占位
    expect(html).toContain('game-detail-page__cover');
  });

  // ---------------- 测试 2：无 currentGame 时显示 Empty ----------------
  it('无 currentGame 时显示 Empty 与提示文案', () => {
    mockState.currentGame = null;

    const html = renderPage();

    // 渲染 Empty 提示（antd Empty 在 SSR 下渲染为 class="ant-empty"）
    expect(html).toContain('未选择游戏，请返回大厅');
    // 不应渲染操作按钮
    expect(html).not.toContain('开始游戏');
    expect(html).not.toContain('读取存档');
  });

  // ---------------- 测试 3：开始游戏按钮触发 startNewGame + setCurrentView('main') ----------------
  it('"开始游戏"按钮点击触发 startNewGame(gameId) + setCurrentView("main")', async () => {
    mockState.currentGame = makeMockGame({ id: 'pastoral_town' });

    renderPage();

    // 应捕获到"开始游戏"按钮的 onClick
    const handler = buttonClickHandlers.get('开始游戏');
    expect(handler).toBeDefined();

    // 调用 onClick（async handler）
    await handler!();

    // 验证 startNewGame 被调用，参数为 game.id
    expect(mockActions.startNewGame).toHaveBeenCalledWith('pastoral_town');
    // 验证 setCurrentView 被调用，参数为 'main'
    expect(mockActions.setCurrentView).toHaveBeenCalledWith('main');
  });

  // ---------------- 测试 4：读取存档按钮触发 setShowSaveDialog(true) ----------------
  it('"读取存档"按钮点击打开 GameSaveDialog（setShowSaveDialog(true)）', () => {
    mockState.currentGame = makeMockGame();

    renderPage();

    const handler = buttonClickHandlers.get('读取存档');
    expect(handler).toBeDefined();

    handler!();

    expect(mockActions.setShowSaveDialog).toHaveBeenCalledWith(true);
  });

  // ---------------- 测试 5：选项按钮触发 setShowOptionsDialog(true) ----------------
  it('"选项"按钮点击打开 GameOptionsDialog（setShowOptionsDialog(true)）', () => {
    mockState.currentGame = makeMockGame();

    renderPage();

    const handler = buttonClickHandlers.get('选项');
    expect(handler).toBeDefined();

    handler!();

    expect(mockActions.setShowOptionsDialog).toHaveBeenCalledWith(true);
  });

  // ---------------- 测试 6：画廊按钮触发 setShowGalleryDialog(true) ----------------
  it('"画廊"按钮点击打开 GameGalleryDialog（setShowGalleryDialog(true)）', () => {
    mockState.currentGame = makeMockGame();

    renderPage();

    const handler = buttonClickHandlers.get('画廊');
    expect(handler).toBeDefined();

    handler!();

    expect(mockActions.setShowGalleryDialog).toHaveBeenCalledWith(true);
  });

  // ---------------- 测试 7：模板未注册 onOtherAction 时"其他"按钮隐藏 ----------------
  it('模板未注册 onOtherAction 时"其他"按钮隐藏', () => {
    mockState.currentGame = makeMockGame({ type: 'management' });
    // mockGetTemplate 默认返回 undefined
    mockGetTemplate.mockReturnValue(undefined);

    const html = renderPage();

    expect(html).not.toContain('其他');
    // 不应捕获到"其他"按钮的 onClick
    expect(buttonClickHandlers.has('其他')).toBe(false);
  });

  // ---------------- 测试 8：模板注册 onOtherAction 时"其他"按钮显示 ----------------
  it('模板注册 onOtherAction 时"其他"按钮显示并触发回调', () => {
    mockState.currentGame = makeMockGame({ type: 'management' });
    // 模拟已注册带 onOtherAction 的模板
    mockGetTemplate.mockReturnValue({
      type: 'management',
      onOtherAction: mockActions.onOtherAction,
      meta: {},
      panels: [],
      tableSchema: { sheets: [], headers: {}, sheetDescriptions: {} }
    });

    const html = renderPage();

    expect(html).toContain('其他');

    const handler = buttonClickHandlers.get('其他');
    expect(handler).toBeDefined();

    handler!();

    expect(mockActions.onOtherAction).toHaveBeenCalled();
  });

  // ---------------- 测试 9：关闭按钮返回 lobby ----------------
  it('"关闭"按钮点击触发 setCurrentView("lobby")', () => {
    mockState.currentGame = makeMockGame();

    renderPage();

    const handler = buttonClickHandlers.get('关闭');
    expect(handler).toBeDefined();

    handler!();

    expect(mockActions.setCurrentView).toHaveBeenCalledWith('lobby');
  });

  // ---------------- 补充测试：对话框 open 状态正确反映 gameUIStore ----------------
  it('对话框 data-open 属性正确反映 gameUIStore 的 showXxxDialog 状态', () => {
    mockState.currentGame = makeMockGame();
    mockState.showSaveDialog = true;
    mockState.showOptionsDialog = false;
    mockState.showGalleryDialog = true;

    const html = renderPage();

    // GameSaveDialog open=true
    expect(html).toMatch(/data-testid="save-dialog"[^>]*data-open="true"/);
    // GameOptionsDialog open=false
    expect(html).toMatch(/data-testid="options-dialog"[^>]*data-open="false"/);
    // GameGalleryDialog open=true
    expect(html).toMatch(/data-testid="gallery-dialog"[^>]*data-open="true"/);
  });

  // ---------------- 补充测试：详细介绍多段渲染 ----------------
  it('详细介绍多段文本按行拆分渲染为多个 Paragraph', () => {
    mockState.currentGame = makeMockGame({
      description: '第一段。\n第二段。\n\n第三段。'
    });

    const html = renderPage();

    expect(html).toContain('第一段。');
    expect(html).toContain('第二段。');
    expect(html).toContain('第三段。');
  });

  // ---------------- 补充测试：gameplay 不存在时回退到 description ----------------
  it('meta.gameplay 不存在时回退显示 description', () => {
    mockState.currentGame = makeMockGame({
      description: '描述内容',
      gameplay: ''
    });

    const html = renderPage();

    // 玩法说明区显示 description 内容（回退）
    expect(html).toContain('描述内容');
  });
});
