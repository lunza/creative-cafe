/**
 * StatisticsPanel 组件测试（Task 19 / SubTask 19.2）
 *
 * 测试覆盖：
 * 1. 无数据时显示 Empty（暂无统计数据）
 * 2. sheet 不存在时显示 Empty
 * 3. 渲染统计数据列表（key/value 对）
 * 4. 数值正确显示（整数与浮点数）
 * 5. 字符串数字容错（如 "100" 转为 number 100）
 * 6. 非数字字符串容错（parseFailed=true 时显示 0）
 * 7. 自定义 sheetName 与字段映射
 * 8. 自定义 Card 标题
 * 9. 多个统计项均被渲染
 * 10. 整数与浮点数的 precision 处理
 *
 * 测试环境说明：
 * - vitest environment: 'node'，未安装 jsdom/happy-dom/@testing-library/react
 * - 渲染使用 react-dom/server 的 renderToStaticMarkup（同步渲染，不触发 useEffect）
 * - 通过 mock gameStore 返回不同 tableData 状态验证组件输出
 *
 * 参考：
 * - src/renderer/components/Game/panels/__tests__/ResourcePanel.test.tsx（mock store 模式）
 *
 * vi.mock 路径深度：
 * - 测试文件位于 src/renderer/components/Game/panels/__tests__/
 * - 到 src/renderer/stores/gameStore 需要 ../../../../stores/gameStore（4 个 ../）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import type { GameTableData } from '../../../../../shared/types/game.types';

// ==================== Mock 设置（必须在 import StatisticsPanel 之前生效） ====================

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

import { StatisticsPanel } from '../StatisticsPanel';

// ==================== 测试辅助函数 ====================

/** 渲染组件并返回 HTML 字符串 */
function renderPanel(props?: React.ComponentProps<typeof StatisticsPanel>): string {
  return renderToStaticMarkup(React.createElement(StatisticsPanel, props));
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

describe('StatisticsPanel', () => {
  beforeEach(() => {
    mockTableData.value = null;
  });

  // ---------------- 测试 1：无数据时显示 Empty ----------------
  it('无数据（tableData 为 null）时显示 Empty "暂无统计数据"', () => {
    mockTableData.value = null;
    const html = renderPanel();

    expect(html).toContain('暂无统计数据');
    // 不应渲染任何 Statistic
    expect(html).not.toContain('ant-statistic');
  });

  it('sheet 不存在时显示 Empty', () => {
    mockTableData.value = makeTableData('other_sheet', ['key'], []);
    const html = renderPanel({ sheetName: 'stats' });

    expect(html).toContain('暂无统计数据');
  });

  it('sheet 存在但行数为 0 时显示 Empty', () => {
    mockTableData.value = makeTableData('stats', ['key', 'value'], []);
    const html = renderPanel();

    expect(html).toContain('暂无统计数据');
  });

  // ---------------- 测试 2：渲染统计数据列表 ----------------
  it('有数据时渲染 Statistic 列表，显示 key 与 value', () => {
    mockTableData.value = makeTableData(
      'stats',
      ['key', 'value'],
      [
        { key: '当前回合', value: 5 },
        { key: '总收入', value: 1000 }
      ]
    );
    const html = renderPanel();

    // 应包含两个统计项的 key
    expect(html).toContain('当前回合');
    expect(html).toContain('总收入');
    // 应包含 antd Statistic 相关 class
    expect(html).toContain('ant-statistic');
    // 应显示 Card 标题"统计"
    expect(html).toContain('统计');
  });

  // ---------------- 测试 3：数值正确显示 ----------------
  it('整数 value 正确显示（按千位分隔）', () => {
    mockTableData.value = makeTableData('stats', ['key', 'value'], [
      { key: '总收入', value: 12345 }
    ]);
    const html = renderPanel();

    // antd Statistic 默认按千位分隔，12345 渲染为 "12,345"
    expect(html).toContain('12,345');
  });

  it('浮点数 value 显示 2 位小数（precision=2）', () => {
    mockTableData.value = makeTableData('stats', ['key', 'value'], [
      { key: '净利润', value: 12.34 }
    ]);
    const html = renderPanel();

    // antd Statistic 把整数和小数部分拆开渲染：
    //   <span class="ant-statistic-content-value-int">12</span>
    //   <span class="ant-statistic-content-value-decimal">.34</span>
    // 因此 HTML 中会同时出现 "12" 和 ".34"
    expect(html).toContain('12');
    expect(html).toContain('.34');
  });

  it('value 为 0 时正确显示', () => {
    mockTableData.value = makeTableData('stats', ['key', 'value'], [
      { key: '总支出', value: 0 }
    ]);
    const html = renderPanel();

    expect(html).toContain('总支出');
    // 0 应作为数值显示（ant-statistic-content-value-int 容器内）
    expect(html).toContain('ant-statistic-content-value-int">0<');
  });

  // ---------------- 测试 4：字符串数字容错 ----------------
  it('value 为字符串数字 "100" 时容错解析为 number 100', () => {
    mockTableData.value = makeTableData('stats', ['key', 'value'], [
      { key: '人口', value: '100' }
    ]);
    const html = renderPanel();

    // 字符串 "100" 应被解析为 number 100，按整数显示
    expect(html).toContain('100');
  });

  it('value 为浮点数字符串 "3.14" 时容错解析为 number 3.14（显示 3.14）', () => {
    mockTableData.value = makeTableData('stats', ['key', 'value'], [
      { key: '系数', value: '3.14' }
    ]);
    const html = renderPanel();

    // antd Statistic 把整数和小数部分拆开渲染：
    //   <span class="ant-statistic-content-value-int">3</span>
    //   <span class="ant-statistic-content-value-decimal">.14</span>
    expect(html).toContain('.14');
  });

  // ---------------- 测试 5：非数字字符串容错 ----------------
  it('value 为非数字字符串（如 "N/A"）时回退显示 0', () => {
    mockTableData.value = makeTableData('stats', ['key', 'value'], [
      { key: '异常项', value: 'N/A' }
    ]);
    const html = renderPanel();

    // parseFailed=true 时仍以 0 显示
    expect(html).toContain('异常项');
    // 不应渲染 "N/A" 字符串作为 value
    expect(html).not.toContain('>N/A<');
  });

  it('value 为 undefined 时回退显示 0', () => {
    mockTableData.value = makeTableData('stats', ['key', 'value'], [
      { key: '缺失项' /* 缺少 value 字段 */ }
    ]);
    const html = renderPanel();

    expect(html).toContain('缺失项');
    expect(html).toContain('0');
  });

  it('value 为 null 时回退显示 0', () => {
    mockTableData.value = makeTableData('stats', ['key', 'value'], [
      { key: '空值项', value: null }
    ]);
    const html = renderPanel();

    expect(html).toContain('空值项');
    expect(html).toContain('0');
  });

  it('value 为空字符串时回退显示 0', () => {
    mockTableData.value = makeTableData('stats', ['key', 'value'], [
      { key: '空字符串项', value: '' }
    ]);
    const html = renderPanel();

    expect(html).toContain('空字符串项');
    expect(html).toContain('0');
  });

  // ---------------- 测试 6：自定义 sheetName 与字段映射 ----------------
  it('自定义 sheetName / keyField / valueField 可正确解析', () => {
    mockTableData.value = makeTableData(
      'custom_stats',
      ['name', 'qty'],
      [
        { name: '人口', qty: 50 },
        { name: '满意度', qty: 75 }
      ]
    );
    const html = renderPanel({
      sheetName: 'custom_stats',
      keyField: 'name',
      valueField: 'qty'
    });

    expect(html).toContain('人口');
    expect(html).toContain('满意度');
    expect(html).toContain('75');
  });

  // ---------------- 测试 7：自定义 Card 标题 ----------------
  it('支持自定义 Card 标题', () => {
    mockTableData.value = makeTableData('stats', ['key', 'value'], [
      { key: '当前回合', value: 5 }
    ]);
    const html = renderPanel({ title: '游戏状态' });

    expect(html).toContain('游戏状态');
  });

  // ---------------- 测试 8：多个统计项均被渲染 ----------------
  it('多个统计项均被渲染', () => {
    mockTableData.value = makeTableData(
      'stats',
      ['key', 'value'],
      [
        { key: '当前回合', value: 5 },
        { key: '总收入', value: 1000 },
        { key: '总支出', value: 500 },
        { key: '净利润', value: 500.5 }
      ]
    );
    const html = renderPanel();

    expect(html).toContain('当前回合');
    expect(html).toContain('总收入');
    expect(html).toContain('总支出');
    expect(html).toContain('净利润');
    // 1000 应按千位分隔显示为 "1,000"
    expect(html).toContain('1,000');
  });

  // ---------------- 测试 9：key 缺省时回退显示"统计项N" ----------------
  it('key 字段缺失时回退显示"统计项N"', () => {
    mockTableData.value = makeTableData('stats', ['value'], [
      { value: 100 } // 缺少 key 字段
    ]);
    const html = renderPanel();

    expect(html).toContain('统计项1');
  });

  // ---------------- 测试 10：响应式 Col 断点 ----------------
  it('每个统计项 Col 包含响应式断点 xs=24 / sm=12 / md=8 / lg=6', () => {
    mockTableData.value = makeTableData('stats', ['key', 'value'], [
      { key: '当前回合', value: 5 }
    ]);
    const html = renderPanel();

    // antd Col 渲染为 ant-col 类，并加上断点修饰类
    expect(html).toContain('ant-col-xs-24');
    expect(html).toContain('ant-col-sm-12');
    expect(html).toContain('ant-col-md-8');
    expect(html).toContain('ant-col-lg-6');
  });

  // ---------------- 测试 11：负数 value 正确显示 ----------------
  it('value 为负数时正确显示（含 - 号）', () => {
    mockTableData.value = makeTableData('stats', ['key', 'value'], [
      { key: '净利润', value: -200 }
    ]);
    const html = renderPanel();

    // antd Statistic 对负数会显示 -200
    expect(html).toContain('-200');
  });
});
