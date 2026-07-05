/**
 * 资源面板组件（Task 13 / SubTask 13.1）
 *
 * 职责：
 * - 从 gameStore.tableData 读取指定 sheet（默认 "resources"），
 *   按行解析为资源列表
 * - 用 antd Card + Row + Col 网格 + Statistic 展示资源名称 / 数量 / 每回合变化
 * - 支持自定义 sheetName 与字段映射，兼容非标准 schema
 *
 * 设计要点：
 * - 纯展示组件：仅消费 gameStore.tableData，不修改 store
 * - 派生逻辑通过 useMemo 缓存，避免 tableData 引用未变时重复解析
 * - 变化字段（change_per_turn）按正负号着色（+绿/-红/0灰）
 * - 空状态：tableData 为 null / sheet 不存在 / 行数为 0 时显示 antd Empty
 *
 * 用法示例：
 * ```tsx
 * <ResourcePanel />
 * <ResourcePanel sheetName="custom_resources" amountField="qty" />
 * ```
 *
 * 参考：src/renderer/components/Dashboard/Dashboard.tsx（antd Statistic 用法）
 */

import React, { useMemo } from 'react';
import { Card, Row, Col, Statistic, Empty } from 'antd';
import { useGameStore } from '../../../stores/gameStore';
import type { GameTableData } from '../../../../shared/types/game.types';
import './panels.css';

// ==================== 类型定义 ====================

export interface ResourcePanelProps {
  /** 资源数据所在 sheet 名称，默认 'resources' */
  sheetName?: string;
  /** 资源名称字段名，默认 'name' */
  nameField?: string;
  /** 资源数量字段名，默认 'amount' */
  amountField?: string;
  /** 每回合变化字段名，默认 'change_per_turn' */
  changeField?: string;
  /** Card 标题，默认 '资源' */
  title?: string;
}

// ==================== 工具函数 ====================

/**
 * 解析资源列表
 *
 * 从 GameTableData 中按 sheetName 取出 rows，并按字段映射提取需要的字段。
 * 若 sheet 不存在或 rows 为空，返回空数组。
 *
 * 注意：行数据是 Record<string, any>（GameTableData.data[sheetName] 的元素类型），
 * 字段值可能为字符串或数字，组件内做容错转换。
 */
function deriveResourceList(
  tableData: GameTableData | null,
  sheetName: string,
  nameField: string,
  amountField: string,
  changeField: string
): Array<{
  key: string;
  name: string;
  amount: number;
  change: number | null;
}> {
  if (!tableData) {
    return [];
  }
  const rows = tableData.data?.[sheetName];
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }
  return rows.map((row, idx) => {
    const rawName = row?.[nameField];
    const rawAmount = row?.[amountField];
    const rawChange = row?.[changeField];

    // 数量容错：字符串数字 / null / undefined 统一转 number
    const amount =
      typeof rawAmount === 'number'
        ? rawAmount
        : parseFloat(String(rawAmount ?? '0')) || 0;

    // 变化容错：未提供时为 null（不显示变化指示）
    let change: number | null = null;
    if (rawChange !== undefined && rawChange !== null && rawChange !== '') {
      const parsed = parseFloat(String(rawChange));
      change = Number.isNaN(parsed) ? null : parsed;
    }

    return {
      key: `${sheetName}-${idx}-${String(rawName ?? idx)}`,
      name: String(rawName ?? `资源${idx + 1}`),
      amount,
      change
    };
  });
}

/**
 * 根据变化值获取 CSS 类名
 */
function getChangeClassName(change: number | null): string {
  if (change === null || change === 0) {
    return 'game-panel__change--neutral';
  }
  return change > 0
    ? 'game-panel__change--positive'
    : 'game-panel__change--negative';
}

/**
 * 格式化变化值为带符号字符串
 *
 * - 正数：显式加 +（如 "+50"）
 * - 负数：自带 -（如 "-10"）
 * - 零：返回 "+0"（与正数一致，避免显示"0"被误判为缺失数据）
 */
function formatChangeValue(change: number | null): string {
  if (change === null) {
    return '';
  }
  if (change > 0) return `+${change}`;
  if (change < 0) return `${change}`;
  return '+0';
}

// ==================== 组件实现 ====================

const ResourcePanel: React.FC<ResourcePanelProps> = ({
  sheetName = 'resources',
  nameField = 'name',
  amountField = 'amount',
  changeField = 'change_per_turn',
  title = '资源'
}) => {
  const tableData = useGameStore((s) => s.tableData);

  const resources = useMemo(
    () =>
      deriveResourceList(
        tableData,
        sheetName,
        nameField,
        amountField,
        changeField
      ),
    [tableData, sheetName, nameField, amountField, changeField]
  );

  // 渲染空状态
  if (resources.length === 0) {
    return (
      <Card className="game-panel" title={title} size="small">
        <div className="game-panel__empty">
          <Empty description="暂无资源数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      </Card>
    );
  }

  return (
    <Card className="game-panel" title={title} size="small">
      <Row className="game-panel__stats" gutter={[12, 12]}>
        {resources.map((res) => {
          const changeText = formatChangeValue(res.change);
          return (
            <Col key={res.key} xs={24} sm={12} md={8} lg={8} xl={6}>
              <Statistic
                title={res.name}
                value={res.amount}
                precision={Number.isInteger(res.amount) ? 0 : 1}
                suffix={
                  changeText ? (
                    <span className={getChangeClassName(res.change)}>
                      {' '}
                      {changeText}/回合
                    </span>
                  ) : null
                }
              />
            </Col>
          );
        })}
      </Row>
    </Card>
  );
};

export default ResourcePanel;
export { ResourcePanel };
