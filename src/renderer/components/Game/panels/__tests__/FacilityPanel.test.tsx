/**
 * FacilityPanel 组件测试（Task 19 / SubTask 19.2）
 *
 * 测试覆盖：
 * 1. 无数据时显示 Empty（暂无设施，请建造）
 * 2. sheet 不存在时显示 Empty
 * 3. 渲染已建设施列表（level >= 1 的行进入"已建设施"区）
 * 4. 渲染可建设施列表（level <= 0 的行进入"可建造"区，附带"建造"按钮）
 * 5. 点击建造按钮触发 onBuild 回调
 * 6. 不传 onBuild 时点击建造按钮触发 gameStore.generateNarrative({ userAction: 'build:<id>' })
 * 7. builtIds 显式传入时按 builtIds 判定已建/可建
 * 8. isGenerating=true 时建造按钮被禁用
 * 9. currentSaveId 为 null 时建造按钮被禁用（提示"未加载存档"）
 * 10. cost 字段显示在可建设施项右侧
 *
 * 测试环境说明：
 * - vitest environment: 'node'，未安装 jsdom/happy-dom/@testing-library/react
 * - 渲染使用 react-dom/server 的 renderToStaticMarkup（同步渲染，不触发 useEffect）
 * - 通过 mock antd Button 捕获 onClick 回调（按 className 索引），测试用例手动调用
 *
 * 注意：
 * - FacilityPanel 的建造 Button 没有显式 data-testid，因此 mock Button 通过 className
 *   捕获建造按钮的 onClick 与 disabled，按渲染顺序入队 capturedBuildButtons
 * - 每个 List item 的 Button onClick 是独立闭包，绑定了对应 item.id
 *
 * 参考：
 * - src/renderer/components/Game/panels/__tests__/ResourcePanel.test.tsx（mock store 模式）
 * - src/renderer/components/Game/__tests__/GameDetailPage.test.tsx（mock antd Button 模式）
 *
 * vi.mock 路径深度：
 * - 测试文件位于 src/renderer/components/Game/panels/__tests__/
 * - 到 src/renderer/stores/gameStore 需要 ../../../../stores/gameStore（4 个 ../）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import type { GameTableData } from '../../../../../shared/types/game.types';

// ==================== Mock 设置（必须在 import FacilityPanel 之前生效） ====================

/**
 * vi.hoisted 提供可变 mock 状态：
 * - mockStoreState：组件读取的 store 数据（tableData / isGenerating / currentSaveId）
 * - mockActions：generateNarrative 等 action mock
 * - onBuildMock：上层传入的 onBuild 回调 mock
 * - capturedBuildButtons：捕获的 antd Button props（按渲染顺序入队）
 *   仅捕获 className 包含 "game-panel__build-button" 的按钮
 */
const { mockStoreState, mockActions, onBuildMock, capturedBuildButtons } =
  vi.hoisted(() => ({
    mockStoreState: {
      tableData: null as GameTableData | null,
      isGenerating: false,
      currentSaveId: 'save-1' as string | null
    },
    mockActions: {
      generateNarrative: vi.fn()
    },
    onBuildMock: vi.fn(),
    capturedBuildButtons: {
      current: [] as Array<{
        onClick?: () => void;
        disabled?: boolean;
      }>
    }
  }));

// ----- Mock antd：替换 Button 为捕获器，其他组件保留原样 -----
//
// 必要性：renderToStaticMarkup 不执行 onClick，因此无法通过 DOM 触发点击。
// 通过 mock Button 捕获 className 包含 "game-panel__build-button" 的按钮的
// onClick 与 disabled 属性，按渲染顺序入队 capturedBuildButtons.current。
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    Button: (props: any) => {
      // 仅捕获建造按钮（className 包含 game-panel__build-button）
      if (
        typeof props.className === 'string' &&
        props.className.includes('game-panel__build-button')
      ) {
        capturedBuildButtons.current.push({
          onClick: props.onClick,
          disabled: props.disabled
        });
      }
      // 用 React.createElement 渲染真实 Button（处理 forwardRef）
      return React.createElement(actual.Button, props);
    }
  };
});

// ----- Mock gameStore：返回 mockStoreState 中的状态 + mockActions 中的 action -----
//
// 注意：vi.mock 的路径是相对于测试文件解析的。
// 测试文件位于 src/renderer/components/Game/panels/__tests__/，
// 因此需要 ../../../../stores/gameStore 才能到达 src/renderer/stores/gameStore
vi.mock('../../../../stores/gameStore', () => ({
  useGameStore: vi.fn((selector: (s: any) => any) =>
    selector({
      tableData: mockStoreState.tableData,
      isGenerating: mockStoreState.isGenerating,
      currentSaveId: mockStoreState.currentSaveId,
      generateNarrative: mockActions.generateNarrative
    })
  )
}));

// ==================== 在 mock 之后导入被测组件 ====================

import { FacilityPanel } from '../FacilityPanel';

// ==================== 测试辅助函数 ====================

/** 渲染组件并返回 HTML 字符串 */
function renderPanel(props?: React.ComponentProps<typeof FacilityPanel>): string {
  return renderToStaticMarkup(React.createElement(FacilityPanel, props));
}

/** 构造一个 GameTableData 单 sheet 数据 */
function makeTableData(
  sheetName: string,
  headers: string[],
  rows: Record<string, any>[]
): GameTableData {
  return {
    sheets: [sheetName],
    headers: { [sheetName]: headers },
    data: { [sheetName]: rows },
    sheetDescriptions: { [sheetName]: `${sheetName} sheet` }
  };
}

// ==================== Tests ====================

describe('FacilityPanel', () => {
  beforeEach(() => {
    mockStoreState.tableData = null;
    mockStoreState.isGenerating = false;
    mockStoreState.currentSaveId = 'save-1';
    mockActions.generateNarrative.mockClear();
    onBuildMock.mockClear();
    capturedBuildButtons.current = [];
  });

  // ---------------- 测试 1：无数据时显示 Empty ----------------
  it('无数据（tableData 为 null）时显示 Empty "暂无设施，请建造"', () => {
    mockStoreState.tableData = null;
    const html = renderPanel();

    expect(html).toContain('暂无设施，请建造');
    // 不应渲染建造按钮
    expect(capturedBuildButtons.current).toHaveLength(0);
  });

  it('sheet 不存在时显示 Empty', () => {
    mockStoreState.tableData = makeTableData('other_sheet', ['id', 'name'], []);
    const html = renderPanel({ sheetName: 'facilities' });

    expect(html).toContain('暂无设施，请建造');
  });

  it('sheet 存在但行数为 0 时显示 Empty', () => {
    mockStoreState.tableData = makeTableData(
      'facilities',
      ['id', 'name', 'level'],
      []
    );
    const html = renderPanel();

    expect(html).toContain('暂无设施，请建造');
  });

  // ---------------- 测试 2：渲染已建设施列表 ----------------
  it('level >= 1 的设施进入"已建设施"区，显示名称与等级 Tag', () => {
    mockStoreState.tableData = makeTableData(
      'facilities',
      ['id', 'name', 'level'],
      [
        { id: 'farm', name: '农场', level: 2 },
        { id: 'mine', name: '矿场', level: 1 }
      ]
    );
    const html = renderPanel();

    // 显示"已建设施"标题
    expect(html).toContain('已建设施');
    // 显示设施名称
    expect(html).toContain('农场');
    expect(html).toContain('矿场');
    // 显示等级 Tag（Lv.2 / Lv.1）
    expect(html).toContain('Lv.2');
    expect(html).toContain('Lv.1');
    // 不应显示"可建造"区
    expect(html).not.toContain('可建造');
    // 不应捕获任何建造按钮
    expect(capturedBuildButtons.current).toHaveLength(0);
  });

  // ---------------- 测试 3：渲染可建设施列表 ----------------
  it('level <= 0 的设施进入"可建造"区，附带"建造"按钮', () => {
    mockStoreState.tableData = makeTableData(
      'facilities',
      ['id', 'name', 'level'],
      [
        { id: 'farm', name: '农场', level: 0 },
        { id: 'mine', name: '矿场', level: 0 }
      ]
    );
    const html = renderPanel();

    // 显示"可建造"标题
    expect(html).toContain('可建造');
    // 显示设施名称
    expect(html).toContain('农场');
    expect(html).toContain('矿场');
    // 应捕获 2 个建造按钮
    expect(capturedBuildButtons.current).toHaveLength(2);
  });

  // ---------------- 测试 4：点击建造按钮触发 onBuild 回调 ----------------
  it('点击建造按钮触发 onBuild(facilityId)', () => {
    mockStoreState.tableData = makeTableData(
      'facilities',
      ['id', 'name', 'level'],
      [{ id: 'farm', name: '农场', level: 0 }]
    );

    renderPanel({ onBuild: onBuildMock });

    // 应捕获到 1 个建造按钮（farm）
    expect(capturedBuildButtons.current).toHaveLength(1);
    const handler = capturedBuildButtons.current[0].onClick;
    expect(handler).toBeDefined();

    handler!();

    expect(onBuildMock).toHaveBeenCalledWith('farm');
  });

  // ---------------- 测试 5：不传 onBuild 时点击建造按钮触发 generateNarrative ----------------
  it('不传 onBuild 时点击建造按钮触发 gameStore.generateNarrative({ userAction: "build:<id>" })', () => {
    mockStoreState.tableData = makeTableData(
      'facilities',
      ['id', 'name', 'level'],
      [{ id: 'market', name: '市场', level: 0 }]
    );

    renderPanel(); // 不传 onBuild

    expect(capturedBuildButtons.current).toHaveLength(1);
    const handler = capturedBuildButtons.current[0].onClick;
    expect(handler).toBeDefined();

    handler!();

    expect(mockActions.generateNarrative).toHaveBeenCalledWith({
      userAction: 'build:market'
    });
  });

  // ---------------- 测试 6：多个可建设施时点击各自按钮触发对应 id ----------------
  it('多个可建设施时，点击各自按钮触发对应 facilityId 的 onBuild', () => {
    mockStoreState.tableData = makeTableData(
      'facilities',
      ['id', 'name', 'level'],
      [
        { id: 'farm', name: '农场', level: 0 },
        { id: 'mine', name: '矿场', level: 0 }
      ]
    );

    renderPanel({ onBuild: onBuildMock });

    expect(capturedBuildButtons.current).toHaveLength(2);

    // 第一个按钮对应 farm
    capturedBuildButtons.current[0].onClick!();
    expect(onBuildMock).toHaveBeenCalledWith('farm');

    // 第二个按钮对应 mine
    capturedBuildButtons.current[1].onClick!();
    expect(onBuildMock).toHaveBeenCalledWith('mine');

    // 总共调用 2 次
    expect(onBuildMock).toHaveBeenCalledTimes(2);
  });

  // ---------------- 测试 7：builtIds 显式传入时按 builtIds 判定 ----------------
  it('builtIds 显式传入时，按 builtIds 判定已建/可建（外部状态优先于 level 字段）', () => {
    mockStoreState.tableData = makeTableData(
      'facilities',
      ['id', 'name', 'level'],
      [
        { id: 'farm', name: '农场', level: 0 }, // level=0 但 builtIds 包含 farm → 已建
        { id: 'mine', name: '矿场', level: 1 } // level=1 但 builtIds 不包含 mine → 可建
      ]
    );

    const html = renderPanel({ builtIds: ['farm'] });

    // farm 进入已建设施区（即使 level=0）
    expect(html).toContain('已建设施');
    expect(html).toContain('农场');
    expect(html).toContain('Lv.0'); // 等级仍按 level 字段显示
    // mine 进入可建造区（即使 level=1）
    expect(html).toContain('可建造');
    expect(html).toContain('矿场');
    // 应有 1 个建造按钮（mine）
    expect(capturedBuildButtons.current).toHaveLength(1);
  });

  // ---------------- 测试 8：builtPredicate 自定义判定 ----------------
  it('builtPredicate 优先级最高，覆盖 builtIds 与 level 判定', () => {
    mockStoreState.tableData = makeTableData(
      'facilities',
      ['id', 'name', 'level'],
      [
        { id: 'farm', name: '农场', level: 5 },
        { id: 'mine', name: '矿场', level: 0 }
      ]
    );

    // 自定义判定：仅当 level > 10 才视为已建（farm 不满足，mine 不满足 → 都进入可建造）
    const html = renderPanel({
      builtPredicate: (item) => item.level > 10
    });

    expect(html).toContain('可建造');
    expect(html).toContain('农场');
    expect(html).toContain('矿场');
    // 不应有"已建设施"区
    expect(html).not.toContain('已建设施');
    // 应捕获 2 个建造按钮
    expect(capturedBuildButtons.current).toHaveLength(2);
  });

  // ---------------- 测试 9：isGenerating=true 时建造按钮被禁用 ----------------
  //
  // 注意：antd Tooltip 在 SSR（renderToStaticMarkup）下不会渲染 title 文本到 HTML，
  // 因为 Tooltip 需要 hover 才显示。因此本测试仅验证 disabled=true，不验证 title 文本。
  it('isGenerating=true 时建造按钮 disabled', () => {
    mockStoreState.tableData = makeTableData(
      'facilities',
      ['id', 'name', 'level'],
      [{ id: 'farm', name: '农场', level: 0 }]
    );
    mockStoreState.isGenerating = true;

    renderPanel();

    // 应捕获到 1 个 disabled 按钮
    expect(capturedBuildButtons.current).toHaveLength(1);
    expect(capturedBuildButtons.current[0].disabled).toBe(true);
  });

  // ---------------- 测试 10：currentSaveId 为 null 时建造按钮被禁用 ----------------
  it('currentSaveId 为 null 时建造按钮 disabled', () => {
    mockStoreState.tableData = makeTableData(
      'facilities',
      ['id', 'name', 'level'],
      [{ id: 'farm', name: '农场', level: 0 }]
    );
    mockStoreState.currentSaveId = null;

    renderPanel();

    expect(capturedBuildButtons.current).toHaveLength(1);
    expect(capturedBuildButtons.current[0].disabled).toBe(true);
  });

  // ---------------- 测试 11：cost 字段显示在可建设施项右侧 ----------------
  it('cost 字段非空时显示"消耗：<cost>"在可建设施项右侧', () => {
    mockStoreState.tableData = makeTableData(
      'facilities',
      ['id', 'name', 'level', 'cost'],
      [{ id: 'farm', name: '农场', level: 0, cost: '50 木头' }]
    );

    const html = renderPanel();

    expect(html).toContain('消耗：50 木头');
  });

  it('cost 字段为空时不显示"消耗："文案', () => {
    mockStoreState.tableData = makeTableData(
      'facilities',
      ['id', 'name', 'level', 'cost'],
      [{ id: 'farm', name: '农场', level: 0, cost: '' }]
    );

    const html = renderPanel();

    expect(html).not.toContain('消耗：');
  });

  // ---------------- 测试 12：所有设施均已建时显示"所有设施均已建造" ----------------
  it('所有设施均已建（buildableList 为空）时显示"所有设施均已建造"', () => {
    mockStoreState.tableData = makeTableData(
      'facilities',
      ['id', 'name', 'level'],
      [{ id: 'farm', name: '农场', level: 3 }]
    );

    const html = renderPanel();

    expect(html).toContain('所有设施均已建造');
    // 不应显示可建造区
    expect(html).not.toContain('可建造');
    // 不应捕获任何建造按钮
    expect(capturedBuildButtons.current).toHaveLength(0);
  });

  // ---------------- 测试 13：自定义 sheetName 与字段映射 ----------------
  it('自定义 sheetName / idField / nameField / levelField / costField 可正确解析', () => {
    mockStoreState.tableData = makeTableData(
      'custom_facilities',
      ['fid', 'fname', 'flevel', 'fcost'],
      [{ fid: 'farm', fname: '农场', flevel: 0, fcost: '30 食物' }]
    );

    const html = renderPanel({
      sheetName: 'custom_facilities',
      idField: 'fid',
      nameField: 'fname',
      levelField: 'flevel',
      costField: 'fcost'
    });

    expect(html).toContain('农场');
    expect(html).toContain('消耗：30 食物');
    // 应捕获到 1 个建造按钮（id 来自 fid，为 'farm'）
    expect(capturedBuildButtons.current).toHaveLength(1);
    capturedBuildButtons.current[0].onClick!();
    expect(onBuildMock).not.toHaveBeenCalled(); // 未传 onBuild
    expect(mockActions.generateNarrative).toHaveBeenCalledWith({
      userAction: 'build:farm'
    });
  });

  // ---------------- 测试 14：自定义 Card 标题 ----------------
  it('支持自定义 Card 标题', () => {
    mockStoreState.tableData = makeTableData(
      'facilities',
      ['id', 'name', 'level'],
      [{ id: 'farm', name: '农场', level: 1 }]
    );

    const html = renderPanel({ title: '建筑列表' });

    expect(html).toContain('建筑列表');
  });

  // ---------------- 测试 15：等级字段为字符串数字时容错 ----------------
  it('level 为字符串数字 "2" 时容错解析为 number 2，进入已建设施区', () => {
    mockStoreState.tableData = makeTableData(
      'facilities',
      ['id', 'name', 'level'],
      [{ id: 'farm', name: '农场', level: '2' }]
    );

    const html = renderPanel();

    // 字符串 "2" 应被解析为 number 2，进入已建设施区
    expect(html).toContain('已建设施');
    expect(html).toContain('Lv.2');
    // 不应有建造按钮
    expect(capturedBuildButtons.current).toHaveLength(0);
  });
});
