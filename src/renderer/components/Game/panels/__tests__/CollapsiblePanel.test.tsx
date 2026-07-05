/**
 * CollapsiblePanel 组件测试（Task 19 / SubTask 19.2）
 *
 * 测试覆盖：
 * 1. 默认展开（defaultOpen=true，store 无记录）→ 渲染 children
 * 2. 默认折叠（defaultOpen=false，store 无记录）→ 不渲染 children
 * 3. store 已记录折叠状态时优先于 defaultOpen
 * 4. onChange 触发 setPanelCollapsed(panelKey, true/false)
 * 5. 自定义 panelKey 与 store 持久化交互
 * 6. 自定义 className 追加到 game-panel__collapse 后
 * 7. 自定义 title 显示在 Collapse header
 * 8. children 正确渲染
 *
 * 测试环境说明：
 * - vitest environment: 'node'，未安装 jsdom/happy-dom/@testing-library/react
 * - 渲染使用 react-dom/server 的 renderToStaticMarkup（同步渲染，不触发 useEffect）
 * - 通过 mock antd Collapse 捕获 onChange 回调，测试用例手动调用
 *
 * 注意：
 * - CollapsiblePanel 通过 useGameUIStore 读取 collapsedPanels[panelKey]
 *   折叠状态完全由 store 决定（受控模式）
 * - defaultOpen 仅在 store 中尚未记录该 panelKey 状态时生效
 *
 * 参考：
 * - src/renderer/components/Game/panels/__tests__/ResourcePanel.test.tsx（mock store 模式）
 * - src/renderer/components/Game/__tests__/GameDetailPage.test.tsx（mock antd 模式）
 *
 * vi.mock 路径深度：
 * - 测试文件位于 src/renderer/components/Game/panels/__tests__/
 * - 到 src/renderer/stores/gameUIStore 需要 ../../../../stores/gameUIStore（4 个 ../）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';

// ==================== Mock 设置（必须在 import CollapsiblePanel 之前生效） ====================

/**
 * vi.hoisted 提供可变 mock 状态：
 * - mockStoreState：组件读取的 store 数据（collapsedPanels + setPanelCollapsed）
 * - capturedOnChange：捕获的 antd Collapse onChange 回调
 */
const { mockStoreState, capturedOnChange } = vi.hoisted(() => ({
  mockStoreState: {
    collapsedPanels: {} as Record<string, boolean>,
    setPanelCollapsed: vi.fn()
  },
  capturedOnChange: {
    current: null as ((keys: string[]) => void) | null
  }
}));

// ----- Mock antd：替换 Collapse 为捕获器，其他组件保留原样 -----
//
// 必要性：renderToStaticMarkup 不执行 onChange，因此无法通过 DOM 触发折叠/展开。
// 通过 mock Collapse 捕获 onChange 回调到 capturedOnChange，测试用例手动调用。
//
// 渲染策略：保留 antd Collapse 的 SSR 渲染（让 React.createElement(actual.Collapse, props)
// 处理 forwardRef），但拦截 props.onChange 捕获。
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    Collapse: (props: any) => {
      // 捕获 onChange 回调（每次渲染覆盖）
      if (typeof props.onChange === 'function') {
        capturedOnChange.current = props.onChange;
      }
      // 用 React.createElement 渲染真实 Collapse（处理 forwardRef）
      return React.createElement(actual.Collapse, props);
    }
  };
});

// ----- Mock gameUIStore：返回 mockStoreState 中的状态 -----
//
// 注意：vi.mock 的路径是相对于测试文件解析的。
// 测试文件位于 src/renderer/components/Game/panels/__tests__/，
// 因此需要 ../../../../stores/gameUIStore 才能到达 src/renderer/stores/gameUIStore
vi.mock('../../../../stores/gameUIStore', () => ({
  useGameUIStore: vi.fn((selector: (s: any) => any) =>
    selector({
      collapsedPanels: mockStoreState.collapsedPanels,
      setPanelCollapsed: mockStoreState.setPanelCollapsed
    })
  )
}));

// ==================== 在 mock 之后导入被测组件 ====================

import { CollapsiblePanel } from '../CollapsiblePanel';

// ==================== 测试辅助函数 ====================

/** 渲染组件并返回 HTML 字符串 */
function renderPanel(
  props: React.ComponentProps<typeof CollapsiblePanel>
): string {
  return renderToStaticMarkup(React.createElement(CollapsiblePanel, props));
}

// ==================== Tests ====================

describe('CollapsiblePanel', () => {
  beforeEach(() => {
    // 重置 mock 状态
    mockStoreState.collapsedPanels = {};
    mockStoreState.setPanelCollapsed.mockClear();
    capturedOnChange.current = null;
  });

  // ---------------- 测试 1：默认展开（defaultOpen=true，store 无记录） ----------------
  it('defaultOpen=true 且 store 无记录时，默认展开（渲染 children）', () => {
    // store 中未记录 panelKey 状态
    mockStoreState.collapsedPanels = {};

    const html = renderPanel({
      title: '资源面板',
      panelKey: 'resource-panel',
      defaultOpen: true,
      children: React.createElement('div', { 'data-testid': 'child-content' }, '子内容')
    });

    // 应渲染 children（Collapse 展开时 children 出现在 HTML 中）
    expect(html).toContain('child-content');
    expect(html).toContain('子内容');
    // 应渲染 title
    expect(html).toContain('资源面板');
    // 应渲染容器
    expect(html).toContain('game-panel');
  });

  // ---------------- 测试 2：默认折叠（defaultOpen=false，store 无记录） ----------------
  it('defaultOpen=false 且 store 无记录时，默认折叠（不渲染 children）', () => {
    mockStoreState.collapsedPanels = {};

    const html = renderPanel({
      title: '设施面板',
      panelKey: 'facility-panel',
      defaultOpen: false,
      children: React.createElement('div', { 'data-testid': 'child-content' }, '隐藏的内容')
    });

    // 折叠时 antd Collapse 不会渲染 children（SSR 行为）
    // activeKey=[] 表示折叠
    // 检查 antd Collapse 的 activeKey prop 传入为 []
    // 由于 children 在折叠状态下不渲染，HTML 中不应出现
    expect(html).not.toContain('隐藏的内容');
    // 应渲染 title
    expect(html).toContain('设施面板');
  });

  // ---------------- 测试 3：store 已记录折叠状态时优先于 defaultOpen ----------------
  it('store 中记录 collapsedPanels[panelKey]=true 时优先于 defaultOpen=true（折叠）', () => {
    mockStoreState.collapsedPanels = { 'resource-panel': true };

    const html = renderPanel({
      title: '资源面板',
      panelKey: 'resource-panel',
      defaultOpen: true, // store 已记录折叠，defaultOpen 不生效
      children: React.createElement('div', null, '被折叠的内容')
    });

    expect(html).not.toContain('被折叠的内容');
  });

  it('store 中记录 collapsedPanels[panelKey]=false 时优先于 defaultOpen=false（展开）', () => {
    mockStoreState.collapsedPanels = { 'resource-panel': false };

    const html = renderPanel({
      title: '资源面板',
      panelKey: 'resource-panel',
      defaultOpen: false, // store 已记录展开，defaultOpen 不生效
      children: React.createElement('div', null, '展开的内容')
    });

    expect(html).toContain('展开的内容');
  });

  // ---------------- 测试 4：onChange 触发 setPanelCollapsed(panelKey, true/false) ----------------
  it('onChange 接收 [panelKey] 时调用 setPanelCollapsed(panelKey, false)（展开）', () => {
    mockStoreState.collapsedPanels = {};

    renderPanel({
      title: '资源面板',
      panelKey: 'resource-panel',
      defaultOpen: false,
      children: React.createElement('div', null, '内容')
    });

    // 应捕获到 onChange
    expect(capturedOnChange.current).not.toBeNull();

    // 模拟用户展开：onChange 接收 ['resource-panel']
    capturedOnChange.current!(['resource-panel']);

    // 应调用 setPanelCollapsed('resource-panel', false)
    expect(mockStoreState.setPanelCollapsed).toHaveBeenCalledWith(
      'resource-panel',
      false
    );
  });

  it('onChange 接收 [] 时调用 setPanelCollapsed(panelKey, true)（折叠）', () => {
    mockStoreState.collapsedPanels = {};

    renderPanel({
      title: '资源面板',
      panelKey: 'resource-panel',
      defaultOpen: true,
      children: React.createElement('div', null, '内容')
    });

    expect(capturedOnChange.current).not.toBeNull();

    // 模拟用户折叠：onChange 接收 []
    capturedOnChange.current!([]);

    // 应调用 setPanelCollapsed('resource-panel', true)
    expect(mockStoreState.setPanelCollapsed).toHaveBeenCalledWith(
      'resource-panel',
      true
    );
  });

  it('onChange 接收 [panelKey, otherKey] 时 panelKey 视为展开', () => {
    mockStoreState.collapsedPanels = {};

    renderPanel({
      title: '资源面板',
      panelKey: 'resource-panel',
      defaultOpen: false,
      children: React.createElement('div', null, '内容')
    });

    // 模拟 onChange 接收多个 keys（panelKey 仍包含其中）
    capturedOnChange.current!(['resource-panel', 'other-panel']);

    expect(mockStoreState.setPanelCollapsed).toHaveBeenCalledWith(
      'resource-panel',
      false
    );
  });

  // ---------------- 测试 5：自定义 panelKey 与 store 持久化交互 ----------------
  it('不同 panelKey 互不干扰（每个 key 对应独立折叠状态）', () => {
    mockStoreState.collapsedPanels = {
      'panel-a': true, // 折叠
      'panel-b': false // 展开
    };

    const htmlA = renderPanel({
      title: '面板 A',
      panelKey: 'panel-a',
      defaultOpen: true,
      children: React.createElement('div', null, '面板A内容')
    });

    const htmlB = renderPanel({
      title: '面板 B',
      panelKey: 'panel-b',
      defaultOpen: false,
      children: React.createElement('div', null, '面板B内容')
    });

    // panel-a 折叠（store 优先于 defaultOpen=true）
    expect(htmlA).not.toContain('面板A内容');
    // panel-b 展开（store 优先于 defaultOpen=false）
    expect(htmlB).toContain('面板B内容');
  });

  // ---------------- 测试 6：自定义 className 追加到 game-panel__collapse 后 ----------------
  it('自定义 className 追加到 game-panel__collapse 后', () => {
    mockStoreState.collapsedPanels = {};

    const html = renderPanel({
      title: '面板',
      panelKey: 'test-panel',
      defaultOpen: true,
      className: 'custom-panel-class',
      children: React.createElement('div', null, '内容')
    });

    // antd Collapse 应同时包含 game-panel__collapse 与 custom-panel-class
    expect(html).toContain('game-panel__collapse');
    expect(html).toContain('custom-panel-class');
  });

  it('不传 className 时仅显示 game-panel__collapse', () => {
    mockStoreState.collapsedPanels = {};

    const html = renderPanel({
      title: '面板',
      panelKey: 'test-panel',
      defaultOpen: true,
      children: React.createElement('div', null, '内容')
    });

    expect(html).toContain('game-panel__collapse');
  });

  // ---------------- 测试 7：自定义 title 显示在 Collapse header ----------------
  it('自定义 title 显示在 Collapse header', () => {
    mockStoreState.collapsedPanels = {};

    const html = renderPanel({
      title: '自定义标题',
      panelKey: 'test-panel',
      defaultOpen: true,
      children: React.createElement('div', null, '内容')
    });

    expect(html).toContain('自定义标题');
  });

  // ---------------- 测试 8：children 正确渲染 ----------------
  it('children 在展开状态下被渲染', () => {
    mockStoreState.collapsedPanels = {};

    const childElement = React.createElement(
      'div',
      { 'data-testid': 'custom-child' },
      '自定义子内容'
    );

    const html = renderPanel({
      title: '父面板',
      panelKey: 'parent-panel',
      defaultOpen: true,
      children: childElement
    });

    expect(html).toContain('custom-child');
    expect(html).toContain('自定义子内容');
  });

  // ---------------- 测试 9：defaultOpen 缺省时默认为 true（展开） ----------------
  it('defaultOpen 缺省时默认为 true（展开）', () => {
    mockStoreState.collapsedPanels = {};

    const html = renderPanel({
      title: '面板',
      panelKey: 'default-open-panel',
      // 不传 defaultOpen
      children: React.createElement('div', null, '默认展开内容')
    });

    // 默认 defaultOpen=true → 展开
    expect(html).toContain('默认展开内容');
  });

  // ---------------- 测试 10：onChange 调用后 setPanelCollapsed 调用次数 ----------------
  it('每次 onChange 调用对应一次 setPanelCollapsed 调用', () => {
    mockStoreState.collapsedPanels = {};

    renderPanel({
      title: '面板',
      panelKey: 'count-panel',
      defaultOpen: true,
      children: React.createElement('div', null, '内容')
    });

    expect(capturedOnChange.current).not.toBeNull();

    // 第一次调用：展开
    capturedOnChange.current!(['count-panel']);
    expect(mockStoreState.setPanelCollapsed).toHaveBeenCalledTimes(1);

    // 第二次调用：折叠
    capturedOnChange.current!([]);
    expect(mockStoreState.setPanelCollapsed).toHaveBeenCalledTimes(2);

    // 第三次调用：再次展开
    capturedOnChange.current!(['count-panel']);
    expect(mockStoreState.setPanelCollapsed).toHaveBeenCalledTimes(3);
  });

  // ---------------- 测试 11：容器结构与 className ----------------
  it('外层容器包含 game-panel className', () => {
    mockStoreState.collapsedPanels = {};

    const html = renderPanel({
      title: '面板',
      panelKey: 'structure-panel',
      defaultOpen: true,
      children: React.createElement('div', null, '内容')
    });

    // 外层 div 应包含 game-panel 类
    expect(html).toContain('class="game-panel');
    // 内层 Collapse 应包含 game-panel__collapse 类
    expect(html).toContain('game-panel__collapse');
  });
});
