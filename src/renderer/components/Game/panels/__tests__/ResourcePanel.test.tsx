/**
 * ResourcePanel 组件测试（Task 13 / SubTask 13.6）
 *
 * 测试覆盖：
 * 1. 无数据时显示 Empty（暂无资源数据）
 * 2. 有数据时渲染 Statistic 列表
 * 3. 自定义 sheetName 与字段映射
 * 4. 数量正确显示
 * 5. 变化字段正确显示（正负号、颜色）
 * 6. 字符串数字容错（如 "100" 转为 number 100）
 * 7. change_per_turn 缺省时不显示变化指示
 *
 * 测试环境说明：
 * - vitest environment: 'node'，未安装 jsdom/happy-dom/@testing-library/react
 * - 渲染使用 react-dom/server 的 renderToStaticMarkup（同步渲染，不触发 useEffect）
 * - 通过 mock gameStore 返回不同 tableData 状态验证组件输出
 *
 * 参考：
 * - src/renderer/components/Game/__tests__/GameModeEntry.test.tsx（mock store 模式）
 * - src/renderer/components/Game/__tests__/AnsiTileMap.test.tsx（renderToStaticMarkup 模式）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import type { GameTableData } from '../../../../../shared/types/game.types';

// ==================== Mock 设置（必须在 import ResourcePanel 之前生效） ====================

/**
 * mockTableData：可变 mock 状态，测试用例可修改后重新渲染
 *
 * 默认为 null（无数据状态）
 */
const { mockTableData } = vi.hoisted(() => ({
  mockTableData: { value: null as GameTableData | null }
}));

// ----- Mock gameStore：仅暴露 useGameStore 的 selector 调用 -----
//
// 注意：vi.mock 的路径是相对于测试文件解析的。
// 测试文件位于 src/renderer/components/Game/panels/__tests__/，
// 因此需要 ../../../../stores/gameStore 才能到达 src/renderer/stores/gameStore
vi.mock('../../../../stores/gameStore', () => ({
  useGameStore: vi.fn((selector: (s: { tableData: GameTableData | null }) => unknown) =>
    selector({ tableData: mockTableData.value })
  )
}));

// ==================== 在 mock 之后导入被测组件 ====================

import { ResourcePanel } from '../ResourcePanel';

// ==================== 测试辅助函数 ====================

/** 渲染组件并返回 HTML 字符串 */
function renderPanel(props?: React.ComponentProps<typeof ResourcePanel>): string {
  return renderToStaticMarkup(React.createElement(ResourcePanel, props));
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

describe('ResourcePanel', () => {
  beforeEach(() => {
    mockTableData.value = null;
  });

  // ---------------- 测试 1：无数据时显示 Empty ----------------
  it('无数据（tableData 为 null）时显示 Empty "暂无资源数据"', () => {
    mockTableData.value = null;
    const html = renderPanel();

    expect(html).toContain('暂无资源数据');
    // 不应渲染任何 Statistic
    expect(html).not.toContain('ant-statistic');
  });

  it('sheet 不存在时显示 Empty', () => {
    mockTableData.value = makeTableData('other_sheet', ['name'], []);
    const html = renderPanel({ sheetName: 'resources' });

    expect(html).toContain('暂无资源数据');
  });

  it('sheet 存在但行数为 0 时显示 Empty', () => {
    mockTableData.value = makeTableData('resources', ['name', 'amount'], []);
    const html = renderPanel();

    expect(html).toContain('暂无资源数据');
  });

  // ---------------- 测试 2：有数据时渲染 Statistic 列表 ----------------
  it('有数据时渲染 Statistic 列表', () => {
    mockTableData.value = makeTableData('resources', ['name', 'amount', 'change_per_turn'], [
      { name: '金币', amount: 500, change_per_turn: 50 },
      { name: '食物', amount: 30, change_per_turn: -10 }
    ]);
    const html = renderPanel();

    // 应包含两个资源名称
    expect(html).toContain('金币');
    expect(html).toContain('食物');
    // 应包含 antd Statistic 相关 class
    expect(html).toContain('ant-statistic');
    // 应显示 Card 标题"资源"
    expect(html).toContain('资源');
  });

  // ---------------- 测试 3：自定义 sheetName 与字段映射 ----------------
  it('自定义 sheetName 与字段映射可正确解析', () => {
    mockTableData.value = makeTableData(
      'custom_resources',
      ['display_name', 'qty', 'delta'],
      [
        { display_name: '木材', qty: 100, delta: 5 },
        { display_name: '石头', qty: 50, delta: 0 }
      ]
    );
    const html = renderPanel({
      sheetName: 'custom_resources',
      nameField: 'display_name',
      amountField: 'qty',
      changeField: 'delta'
    });

    expect(html).toContain('木材');
    expect(html).toContain('石头');
    // 木材的数量 100 应出现
    expect(html).toContain('100');
  });

  // ---------------- 测试 4：数量正确显示 ----------------
  it('数量字段正确显示为数字', () => {
    mockTableData.value = makeTableData('resources', ['name', 'amount'], [
      { name: '金币', amount: 1234 },
      { name: '木材', amount: 0 }
    ]);
    const html = renderPanel();

    // antd Statistic 默认按千位分隔，1234 渲染为 "1,234"
    expect(html).toContain('1,234');
    // 0 应作为木材数量显示
    expect(html).toContain('木材');
  });

  it('字符串数字容错（"100" 转为 number 100）', () => {
    mockTableData.value = makeTableData('resources', ['name', 'amount'], [
      { name: '金币', amount: '100' }
    ]);
    const html = renderPanel();

    expect(html).toContain('100');
  });

  it('amount 缺省时回退到 0', () => {
    mockTableData.value = makeTableData('resources', ['name', 'amount'], [
      { name: '未知资源' }
    ]);
    const html = renderPanel();

    expect(html).toContain('未知资源');
    // 数量 0 应出现
    expect(html).toContain('0');
  });

  // ---------------- 测试 5：变化字段正确显示（正负号、颜色） ----------------
  it('正数变化显示带 + 号且使用 positive 颜色类', () => {
    mockTableData.value = makeTableData(
      'resources',
      ['name', 'amount', 'change_per_turn'],
      [{ name: '金币', amount: 500, change_per_turn: 50 }]
    );
    const html = renderPanel();

    // 正数应显示 +50/回合
    expect(html).toContain('+50');
    // 应使用 positive 颜色 class
    expect(html).toContain('game-panel__change--positive');
  });

  it('负数变化显示带 - 号且使用 negative 颜色类', () => {
    mockTableData.value = makeTableData(
      'resources',
      ['name', 'amount', 'change_per_turn'],
      [{ name: '食物', amount: 30, change_per_turn: -10 }]
    );
    const html = renderPanel();

    // 负数应显示 -10/回合
    expect(html).toContain('-10');
    // 应使用 negative 颜色 class
    expect(html).toContain('game-panel__change--negative');
  });

  it('变化为 0 时使用 neutral 颜色类', () => {
    mockTableData.value = makeTableData(
      'resources',
      ['name', 'amount', 'change_per_turn'],
      [{ name: '石头', amount: 100, change_per_turn: 0 }]
    );
    const html = renderPanel();

    // 0 应显示 +0/回合（formatChangeValue 对 0 输出 +0）
    expect(html).toContain('+0');
    // 应使用 neutral 颜色 class
    expect(html).toContain('game-panel__change--neutral');
  });

  it('change_per_turn 缺省时不显示变化指示', () => {
    mockTableData.value = makeTableData('resources', ['name', 'amount'], [
      { name: '金币', amount: 500 }
    ]);
    const html = renderPanel();

    // 不应出现"回合"字样
    expect(html).not.toContain('/回合');
    // 也不应出现任何颜色 class
    expect(html).not.toContain('game-panel__change--positive');
    expect(html).not.toContain('game-panel__change--negative');
    expect(html).not.toContain('game-panel__change--neutral');
  });

  it('change_per_turn 为空字符串时不显示变化指示', () => {
    mockTableData.value = makeTableData(
      'resources',
      ['name', 'amount', 'change_per_turn'],
      [{ name: '金币', amount: 500, change_per_turn: '' }]
    );
    const html = renderPanel();

    expect(html).not.toContain('/回合');
  });

  // ---------------- 补充：自定义标题 ----------------
  it('支持自定义 Card 标题', () => {
    mockTableData.value = makeTableData('resources', ['name', 'amount'], [
      { name: '金币', amount: 100 }
    ]);
    const html = renderPanel({ title: '经济状况' });

    expect(html).toContain('经济状况');
    // 默认标题"资源"不应出现（除非作为数据本身）
    expect(html).not.toContain('>资源<');
  });

  // ---------------- 补充：多个资源项的 key 唯一性 ----------------
  it('多个资源项均被渲染', () => {
    mockTableData.value = makeTableData(
      'resources',
      ['name', 'amount', 'change_per_turn'],
      [
        { name: '金币', amount: 500, change_per_turn: 50 },
        { name: '食物', amount: 30, change_per_turn: -10 },
        { name: '木材', amount: 100, change_per_turn: 0 },
        { name: '石头', amount: 20, change_per_turn: 5 }
      ]
    );
    const html = renderPanel();

    expect(html).toContain('金币');
    expect(html).toContain('食物');
    expect(html).toContain('木材');
    expect(html).toContain('石头');
  });
});
