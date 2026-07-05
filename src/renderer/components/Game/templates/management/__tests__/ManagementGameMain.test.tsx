/**
 * ManagementGameMain 组件测试（Task 16 / SubTask 16.5）
 *
 * 测试覆盖：
 * 1. 渲染时显示资源 / 设施 / 招募 / 统计 四个面板（CollapsiblePanel 包裹）
 * 2. 顶部工具条显示当前回合（从 tableData.stats 派生）
 * 3. 结束回合按钮存在 + 点击触发 onAction('end_turn')
 * 4. 生成中（isGenerating=true）禁用结束回合按钮
 * 5. 招募面板渲染 3 个硬编码角色（farmer / lumberjack / merchant）
 * 6. 点击招募按钮触发 onAction('recruit:<characterId>')
 * 7. 生成中禁用招募按钮
 * 8. FacilityPanel 接收 onBuild prop（传递 handleBuild）
 * 9. 资源不足时招募按钮显示金币不足提示
 * 10. tableData 变化时 currentTurn 自动更新
 *
 * 测试环境限制：
 * - vitest environment: 'node'，未安装 jsdom / happy-dom / @testing-library/react
 * - 渲染使用 react-dom/server 的 renderToStaticMarkup
 * - renderToStaticMarkup 不触发 React 事件处理器，因此无法通过模拟 DOM click 触发 onClick；
 *   通过 mock antd Button 捕获 onClick 回调（按 data-testid 索引），
 *   测试用例手动调用捕获的 handler 验证调用契约
 *
 * 参考：
 * - src/renderer/components/Game/__tests__/GameMainPage.test.tsx（mock Button 捕获 onClick 模式）
 * - src/renderer/components/Game/panels/__tests__/ResourcePanel.test.tsx（mock gameStore 模式）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import type { GameTableData } from '../../../../../../shared/types/game.types';

// ==================== Mock 设置（必须在 import ManagementGameMain 之前生效） ====================

/**
 * vi.hoisted：在所有 import 之前执行的可变 mock 状态
 *
 * - mockTableData:    gameStore 中的 tableData（默认为初始资源状态）
 * - mockIsGenerating: gameStore 中的 isGenerating
 * - mockUIState:      gameUIStore 中的 collapsedPanels / setPanelCollapsed
 * - capturedButtonHandlers:  捕获的 antd Button onClick 回调（按 data-testid 索引）
 * - capturedFacilityOnBuild:  捕获的 FacilityPanel onBuild 回调
 */
const {
  mockTableData,
  mockIsGenerating,
  mockUIState,
  capturedButtonHandlers,
  capturedFacilityOnBuild
} = vi.hoisted(() => ({
  mockTableData: { value: null as GameTableData | null },
  mockIsGenerating: { value: false },
  mockUIState: {
    collapsedPanels: {} as Record<string, boolean>,
    setPanelCollapsed: vi.fn()
  },
  capturedButtonHandlers: {
    current: {} as Record<string, () => void>
  },
  capturedFacilityOnBuild: {
    current: null as ((facilityId: string) => void) | null
  }
}));

// ----- Mock antd：替换 Button 以捕获 onClick -----
//
// 必要性：renderToStaticMarkup 不执行 onClick，因此无法通过 DOM 点击触发事件。
// 通过 mock Button 捕获 onClick 回调（按 data-testid 索引），测试用例可手动调用
// 捕获的 handler 验证行为契约。其他 antd 组件（Card / List / Tag / Typography /
// Space 等）保持原样以验证渲染产物。
//
// 注意：antd Button 是 forwardRef 对象而非函数，不能用 actual.Button(props) 调用，
// 改用 React.createElement(actual.Button, props) 让 React 处理 forwardRef 调用。
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    Button: (props: any) => {
      const testid = props['data-testid'];
      if (testid && typeof props.onClick === 'function') {
        capturedButtonHandlers.current[testid] = props.onClick;
      }
      // 用 React.createElement 渲染真实 Button（处理 forwardRef）
      return React.createElement(actual.Button, props);
    }
  };
});

// ----- Mock gameStore：返回 mockTableData + mockIsGenerating -----
//
// 注意：vi.mock 的路径是相对于测试文件解析的。
// 测试文件位于 src/renderer/components/Game/templates/management/__tests__/，
// 因此需要 ../../../../../ 才能到达 src/renderer/stores/gameStore
vi.mock('../../../../../stores/gameStore', () => ({
  useGameStore: vi.fn((selector: (s: any) => any) =>
    selector({
      tableData: mockTableData.value,
      isGenerating: mockIsGenerating.value
    })
  )
}));

// ----- Mock gameUIStore：返回 mockUIState -----
// CollapsiblePanel 内部读取 collapsedPanels 与 setPanelCollapsed
vi.mock('../../../../../stores/gameUIStore', () => ({
  useGameUIStore: vi.fn((selector: (s: any) => any) =>
    selector(mockUIState)
  )
}));

// ----- Mock ResourcePanel / FacilityPanel / StatisticsPanel -----
//
// 简化 mock：避免引入 antd Card / List / Statistic 等子组件的渲染副作用。
// FacilityPanel mock 捕获 onBuild 回调（用于验证 handleBuild 传递契约），
// 同时调用 onBuild 触发 onAction 流程的间接测试也可由此完成。
//
// 注意路径解析：测试文件位于 src/renderer/components/Game/templates/management/__tests__/，
// 而 panels 位于 src/renderer/components/Game/panels/，
// 因此需要 ../../../panels/<Name>（3 个 .. 段：__tests__ → management → templates → Game）
vi.mock('../../../panels/ResourcePanel', () => ({
  ResourcePanel: (props: any) =>
    React.createElement(
      'div',
      {
        'data-testid': 'mock-resource-panel',
        'data-sheet': props.sheetName
      },
      `ResourcePanel sheet=${props.sheetName}`
    )
}));

vi.mock('../../../panels/FacilityPanel', () => ({
  FacilityPanel: (props: any) => {
    // 捕获 onBuild 回调，便于测试手动调用
    capturedFacilityOnBuild.current = props.onBuild;
    return React.createElement(
      'div',
      {
        'data-testid': 'mock-facility-panel',
        'data-sheet': props.sheetName,
        'data-has-onbuild': typeof props.onBuild === 'function' ? 'true' : 'false'
      },
      `FacilityPanel sheet=${props.sheetName} hasOnBuild=${typeof props.onBuild === 'function'}`
    );
  }
}));

vi.mock('../../../panels/StatisticsPanel', () => ({
  StatisticsPanel: (props: any) =>
    React.createElement(
      'div',
      {
        'data-testid': 'mock-statistics-panel',
        'data-sheet': props.sheetName
      },
      `StatisticsPanel sheet=${props.sheetName}`
    )
}));

// 注意：CollapsiblePanel 不 mock —— 它使用 antd Collapse.items API，渲染简单，
// 且组件本身的折叠状态依赖 gameUIStore（已 mock），不需要额外捕获回调。

// ==================== 在 mock 之后导入被测组件 ====================

import ManagementGameMain from '../ManagementGameMain';

// ==================== 测试辅助 ====================

/** 渲染 ManagementGameMain 并返回 HTML 字符串 */
function renderMain(props?: { onAction?: (userAction: string) => void }): string {
  const onAction = props?.onAction ?? vi.fn();
  return renderToStaticMarkup(
    React.createElement(ManagementGameMain, {
      saveId: 'test-save',
      gameId: 'test-game',
      tableData: mockTableData.value,
      onAction
    })
  );
}

/** 默认 onAction mock（在 beforeEach 中 mockClear） */
const onActionMock = vi.fn();

/** 构造初始资源 tableData（金币 500 / 食物 50 / 木材 30 / 人口 5 / 回合 1） */
function makeInitialTableData(turn: number | string = 1, gold: number | string = 500): GameTableData {
  return {
    sheets: ['characters', 'resources', 'facilities', 'events', 'stats'],
    headers: {
      characters: ['1', 'name', 'role', 'status'],
      resources: ['1', 'name', 'amount', 'change_per_turn'],
      facilities: ['1', 'name', 'level', 'cost', 'production'],
      events: ['1', 'turn', 'description', 'effect'],
      stats: ['1', 'key', 'value']
    },
    data: {
      characters: [{ name: '镇长', role: 'player', status: 'active' }],
      resources: [
        { name: '金币', amount: gold, change_per_turn: 0 },
        { name: '食物', amount: 50, change_per_turn: 0 },
        { name: '木材', amount: 30, change_per_turn: 0 },
        { name: '人口', amount: 5, change_per_turn: 0 }
      ],
      facilities: [],
      events: [],
      stats: [
        { key: 'turn', value: String(turn) },
        { key: 'randomSeed', value: '12345' }
      ]
    },
    sheetDescriptions: {
      characters: '角色',
      resources: '资源',
      facilities: '设施',
      events: '事件',
      stats: '统计'
    }
  };
}

// ==================== Tests ====================

describe('ManagementGameMain', () => {
  beforeEach(() => {
    // 重置 mock 状态
    mockTableData.value = makeInitialTableData();
    mockIsGenerating.value = false;
    mockUIState.collapsedPanels = {};
    mockUIState.setPanelCollapsed.mockClear();
    capturedButtonHandlers.current = {};
    capturedFacilityOnBuild.current = null;
    onActionMock.mockClear();
  });

  // ----- 测试 1：渲染时显示资源 / 设施 / 招募 / 统计四个面板 -----
  it('渲染时显示资源 / 设施 / 招募 / 统计四个面板（CollapsiblePanel 包裹）', () => {
    const html = renderMain({ onAction: onActionMock });

    // 4 个 mock 的子面板应被渲染
    expect(html).toContain('mock-resource-panel');
    expect(html).toContain('mock-facility-panel');
    expect(html).toContain('mock-statistics-panel');
    // 招募面板（内联组件，未被 mock）应渲染 antd Card
    expect(html).toContain('management-recruit-panel-card');

    // 4 个 CollapsiblePanel 的标题应出现
    expect(html).toContain('资源');
    expect(html).toContain('设施');
    expect(html).toContain('招募');
    expect(html).toContain('统计');
  });

  // ----- 测试 2：顶部工具条显示当前回合（从 tableData.stats 派生） -----
  it('顶部工具条显示当前回合（从 tableData.stats 派生）', () => {
    mockTableData.value = makeInitialTableData(7);
    const html = renderMain({ onAction: onActionMock });

    expect(html).toContain('management-game-turn-tag');
    expect(html).toContain('第 7 回合');
  });

  it('tableData 为 null 时回退到第 1 回合', () => {
    mockTableData.value = null;
    const html = renderMain({ onAction: onActionMock });

    expect(html).toContain('第 1 回合');
  });

  it('stats sheet 缺失 turn 行时回退到第 1 回合', () => {
    const td = makeInitialTableData();
    td.data.stats = [{ key: 'randomSeed', value: '999' }];
    mockTableData.value = td;
    const html = renderMain({ onAction: onActionMock });

    expect(html).toContain('第 1 回合');
  });

  it('turn 行的 value 非数字时回退到第 1 回合', () => {
    const td = makeInitialTableData('not-a-number');
    mockTableData.value = td;
    const html = renderMain({ onAction: onActionMock });

    expect(html).toContain('第 1 回合');
  });

  // ----- 测试 3：结束回合按钮存在 + 点击触发 onAction('end_turn') -----
  it('渲染结束回合按钮（data-testid 正确）', () => {
    const html = renderMain({ onAction: onActionMock });

    expect(html).toContain('management-game-end-turn-button');
    expect(html).toContain('结束回合');
  });

  it('点击结束回合按钮触发 onAction("end_turn")', () => {
    renderMain({ onAction: onActionMock });

    // 通过 mock Button 捕获的 onClick 应存在
    const endTurnHandler = capturedButtonHandlers.current['management-game-end-turn-button'];
    expect(endTurnHandler).toBeDefined();

    // 手动调用 onClick（模拟用户点击）
    endTurnHandler();

    expect(onActionMock).toHaveBeenCalledTimes(1);
    expect(onActionMock).toHaveBeenCalledWith('end_turn');
  });

  // ----- 测试 4：生成中禁用结束回合按钮 + 不触发 onAction -----
  it('isGenerating=true 时结束回合按钮被禁用（disabled prop 传递）', () => {
    mockIsGenerating.value = true;
    const html = renderMain({ onAction: onActionMock });

    // 渲染的按钮 HTML 应包含 disabled 属性
    expect(html).toContain('management-game-end-turn-button');
    // antd v6 Button 在 disabled=true 时渲染为 <button disabled>
    expect(html).toMatch(/disabled/);
  });

  it('isGenerating=true 时点击结束回合按钮不触发 onAction', () => {
    mockIsGenerating.value = true;
    renderMain({ onAction: onActionMock });

    const endTurnHandler = capturedButtonHandlers.current['management-game-end-turn-button'];
    expect(endTurnHandler).toBeDefined();
    // handleEndTurn 内部 if (isGenerating) return;
    endTurnHandler();

    // 由于 isGenerating=true，handleEndTurn 早返回，不应调用 onAction
    expect(onActionMock).not.toHaveBeenCalled();
  });

  // ----- 测试 5：招募面板渲染 3 个硬编码角色 -----
  it('招募面板渲染 3 个硬编码角色（farmer / lumberjack / merchant）', () => {
    const html = renderMain({ onAction: onActionMock });

    // 角色名应出现
    expect(html).toContain('农夫');
    expect(html).toContain('木匠');
    expect(html).toContain('商人');

    // 3 个招募按钮的 data-testid 应分别存在
    expect(html).toContain('management-recruit-button-farmer');
    expect(html).toContain('management-recruit-button-lumberjack');
    expect(html).toContain('management-recruit-button-merchant');
  });

  it('招募面板显示成本信息（与 ManagementNarrativeService.RECRUIT_COSTS 一致）', () => {
    const html = renderMain({ onAction: onActionMock });

    // 各角色成本应出现
    expect(html).toContain('20 金币');
    expect(html).toContain('30 金币');
    expect(html).toContain('50 金币');
    // +1 人口提示
    expect(html).toContain('+1 人口');
  });

  // ----- 测试 6：点击招募按钮触发 onAction('recruit:<characterId>') -----
  it('点击 farmer 招募按钮触发 onAction("recruit:farmer")', () => {
    renderMain({ onAction: onActionMock });

    const handler = capturedButtonHandlers.current['management-recruit-button-farmer'];
    expect(handler).toBeDefined();
    handler();

    expect(onActionMock).toHaveBeenCalledTimes(1);
    expect(onActionMock).toHaveBeenCalledWith('recruit:farmer');
  });

  it('点击 lumberjack 招募按钮触发 onAction("recruit:lumberjack")', () => {
    renderMain({ onAction: onActionMock });

    const handler = capturedButtonHandlers.current['management-recruit-button-lumberjack'];
    expect(handler).toBeDefined();
    handler();

    expect(onActionMock).toHaveBeenCalledWith('recruit:lumberjack');
  });

  it('点击 merchant 招募按钮触发 onAction("recruit:merchant")', () => {
    renderMain({ onAction: onActionMock });

    const handler = capturedButtonHandlers.current['management-recruit-button-merchant'];
    expect(handler).toBeDefined();
    handler();

    expect(onActionMock).toHaveBeenCalledWith('recruit:merchant');
  });

  // ----- 测试 7：生成中禁用招募按钮 + 不触发 onAction -----
  it('isGenerating=true 时招募按钮被禁用', () => {
    mockIsGenerating.value = true;
    const html = renderMain({ onAction: onActionMock });

    // 3 个招募按钮应渲染且 disabled
    expect(html).toContain('management-recruit-button-farmer');
    expect(html).toContain('management-recruit-button-lumberjack');
    expect(html).toContain('management-recruit-button-merchant');
    // 至少 3 个 disabled 按钮渲染（包含结束回合按钮）
    const disabledCount = (html.match(/disabled/g) || []).length;
    expect(disabledCount).toBeGreaterThanOrEqual(4); // 3 招募 + 1 结束回合
  });

  it('isGenerating=true 时点击招募按钮不触发 onAction', () => {
    mockIsGenerating.value = true;
    renderMain({ onAction: onActionMock });

    const handler = capturedButtonHandlers.current['management-recruit-button-farmer'];
    expect(handler).toBeDefined();
    // handleRecruit 内部 if (isGenerating) return;
    handler();

    expect(onActionMock).not.toHaveBeenCalled();
  });

  // ----- 测试 8：FacilityPanel 接收 onBuild prop（验证传递） -----
  it('FacilityPanel 接收 onBuild 回调（用于将 build:<facilityId> 上抛）', () => {
    renderMain({ onAction: onActionMock });

    // 渲染时应捕获到 onBuild 回调
    expect(capturedFacilityOnBuild.current).not.toBeNull();
    expect(typeof capturedFacilityOnBuild.current).toBe('function');
  });

  it('调用 FacilityPanel 的 onBuild("farm") 触发 onAction("build:farm")', () => {
    renderMain({ onAction: onActionMock });

    // 手动调用捕获的 onBuild 回调（模拟 FacilityPanel 内部点击建造按钮）
    expect(capturedFacilityOnBuild.current).not.toBeNull();
    capturedFacilityOnBuild.current!('farm');

    expect(onActionMock).toHaveBeenCalledTimes(1);
    expect(onActionMock).toHaveBeenCalledWith('build:farm');
  });

  it('isGenerating=true 时调用 onBuild 不触发 onAction', () => {
    mockIsGenerating.value = true;
    renderMain({ onAction: onActionMock });

    expect(capturedFacilityOnBuild.current).not.toBeNull();
    capturedFacilityOnBuild.current!('farm');

    // handleBuild 内部 if (isGenerating) return;
    expect(onActionMock).not.toHaveBeenCalled();
  });

  // ----- 测试 9：资源不足时招募按钮显示金币不足提示 -----
  it('金币不足时招募按钮显示金币不足提示（仍可点击）', () => {
    // 当前金币 5 < farmer costGold 20
    mockTableData.value = makeInitialTableData(1, 5);
    const html = renderMain({ onAction: onActionMock });

    // 应渲染金币不足提示
    expect(html).toContain('金币不足');
    expect(html).toContain('当前 5');
    expect(html).toContain('需要 20');
  });

  it('金币充足时不显示金币不足提示', () => {
    mockTableData.value = makeInitialTableData(1, 500);
    const html = renderMain({ onAction: onActionMock });

    expect(html).not.toContain('金币不足');
  });

  it('金币恰好等于成本时不显示金币不足提示', () => {
    // 20 == farmer costGold 20，不算不足
    mockTableData.value = makeInitialTableData(1, 20);
    const html = renderMain({ onAction: onActionMock });

    // farmer 不应显示不足提示
    // 但 lumberjack (30) / merchant (50) 应显示不足提示
    expect(html).toContain('需要 30');
    expect(html).toContain('需要 50');
  });

  // ----- 测试 10：tableData 变化时 currentTurn 自动更新 -----
  it('tableData 变化时 currentTurn 自动更新（响应式派生）', () => {
    // 第一次渲染：回合 1
    mockTableData.value = makeInitialTableData(1);
    let html = renderMain({ onAction: onActionMock });
    expect(html).toContain('第 1 回合');

    // 第二次渲染：回合 5（模拟 endTurn 后 AI 通过 tableEdit 更新了 turn 行）
    mockTableData.value = makeInitialTableData(5);
    html = renderMain({ onAction: onActionMock });
    expect(html).toContain('第 5 回合');
    expect(html).not.toContain('第 1 回合');
  });

  // ----- 补充：主容器结构 -----
  it('主容器包含 management-game-main className 与 data-testid', () => {
    const html = renderMain({ onAction: onActionMock });

    expect(html).toContain('management-game-main');
    expect(html).toContain('data-testid="management-game-main"');
  });

  it('顶部工具条包含 management-game-main__toolbar className', () => {
    const html = renderMain({ onAction: onActionMock });

    expect(html).toContain('management-game-main__toolbar');
  });

  // ----- 补充：传递给 FacilityPanel 的 sheetName 正确 -----
  it('传递给 FacilityPanel 的 sheetName 为 "facilities"', () => {
    const html = renderMain({ onAction: onActionMock });

    expect(html).toContain('data-sheet="facilities"');
  });

  it('传递给 ResourcePanel 的 sheetName 为 "resources"', () => {
    const html = renderMain({ onAction: onActionMock });

    expect(html).toContain('data-sheet="resources"');
  });

  it('传递给 StatisticsPanel 的 sheetName 为 "stats"', () => {
    const html = renderMain({ onAction: onActionMock });

    expect(html).toContain('data-sheet="stats"');
  });
});
