/**
 * 统计面板组件（Task 13 / SubTask 13.3）
 *
 * 职责：
 * - 从 gameStore.tableData 读取指定 sheet（默认 "stats"），
 *   按行解析为 key-value 统计项
 * - 用 antd Card + Row + Col 网格 + Statistic 展示
 * - 首期用 antd Statistic，图表渲染留接口（TODO 注释）
 *
 * 设计要点：
 * - 纯展示组件：仅消费 gameStore.tableData，不修改 store
 * - 表格行结构：每行包含一个 key/value 对（key 字段名 / value 字段名可配置）
 * - 自动支持"当前回合 / 总收入 / 总支出 / 净利润"等典型统计项
 * - 空状态：tableData 为 null / sheet 不存在 / 行数为 0 时显示 antd Empty
 *
 * 用法示例：
 * ```tsx
 * <StatisticsPanel />
 * <StatisticsPanel sheetName="custom_stats" keyField="name" valueField="val" />
 * ```
 *
 * TODO: 后续支持图表（如收入支出折线图），可在 props 增加一个
 *       `chartConfig?: { type: 'line' | 'bar'; dataField: string }` 字段
 */

import React, { useMemo } from 'react';
import { Card, Row, Col, Statistic, Empty } from 'antd';
import { useGameStore } from '../../../stores/gameStore';
import type { GameTableData } from '../../../../shared/types/game.types';
import './panels.css';

// ==================== 类型定义 ====================

export interface StatisticsPanelProps {
  /** 统计数据所在 sheet 名称，默认 'stats' */
  sheetName?: string;
  /** 统计项 key 字段名，默认 'key' */
  keyField?: string;
  /** 统计项 value 字段名，默认 'value' */
  valueField?: string;
  /** Card 标题，默认 '统计' */
  title?: string;
}

/** 派生后的统计项 */
export interface StatItem {
  key: string;
  label: string;
  value: number;
  /** 解析失败时为 true，仍以 0 显示但便于调试 */
  parseFailed: boolean;
}

// ==================== 工具函数 ====================

/**
 * 解析统计项列表
 *
 * 从 GameTableData 中按 sheetName 取出 rows，并按字段映射提取 key/value。
 */
function deriveStatList(
  tableData: GameTableData | null,
  sheetName: string,
  keyField: string,
  valueField: string
): StatItem[] {
  if (!tableData) {
    return [];
  }
  const rows = tableData.data?.[sheetName];
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }
  return rows.map((row, idx) => {
    const rawKey = row?.[keyField];
    const rawValue = row?.[valueField];

    const value =
      typeof rawValue === 'number'
        ? rawValue
        : parseFloat(String(rawValue ?? '0')) || 0;

    const parseFailed =
      rawValue !== undefined &&
      rawValue !== null &&
      rawValue !== '' &&
      typeof rawValue !== 'number' &&
      Number.isNaN(parseFloat(String(rawValue)));

    return {
      key: `${sheetName}-${idx}-${String(rawKey ?? idx)}`,
      label: String(rawKey ?? `统计项${idx + 1}`),
      value,
      parseFailed
    };
  });
}

// ==================== 组件实现 ====================

const StatisticsPanel: React.FC<StatisticsPanelProps> = ({
  sheetName = 'stats',
  keyField = 'key',
  valueField = 'value',
  title = '统计'
}) => {
  const tableData = useGameStore((s) => s.tableData);

  const stats = useMemo(
    () => deriveStatList(tableData, sheetName, keyField, valueField),
    [tableData, sheetName, keyField, valueField]
  );

  if (stats.length === 0) {
    return (
      <Card className="game-panel" title={title} size="small">
        <div className="game-panel__empty">
          <Empty description="暂无统计数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      </Card>
    );
  }

  return (
    <Card className="game-panel" title={title} size="small">
      {/* TODO: 后续支持图表，可在此处插入 antd Tabs，将 Statistic 与 Chart 分两个 Tab */}
      <Row className="game-panel__stats" gutter={[12, 12]}>
        {stats.map((stat) => (
          <Col key={stat.key} xs={24} sm={12} md={8} lg={6} xl={6}>
            <Statistic
              title={stat.label}
              value={stat.value}
              precision={Number.isInteger(stat.value) ? 0 : 2}
            />
          </Col>
        ))}
      </Row>
    </Card>
  );
};

export default StatisticsPanel;
export { StatisticsPanel };
