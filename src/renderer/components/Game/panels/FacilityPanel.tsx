/**
 * 设施面板组件（Task 13 / SubTask 13.2）
 *
 * 职责：
 * - 从 gameStore.tableData 读取指定 sheet（默认 "facilities"），
 *   按行解析为设施列表
 * - 内部分两块：已建设施列表（带等级）+ 可建设施列表（带建造按钮）
 * - 点击建造按钮触发 gameStore.generateNarrative({ userAction: 'build:<facility_id>' })
 * - 通过 props.builtIds 自定义"已建/可建"判定，缺省时按行内 level 字段判定
 *
 * 设计要点：
 * - 纯展示 + 回调：仅消费 gameStore.tableData 与 generateNarrative action，
 *   不修改 store 状态（generateNarrative 触发的状态变更由事件回调推送）
 * - "已建/可建"判定：
 *   - 若 props.builtIds 提供，则按 props 判定（外部状态优先）
 *   - 否则按行 level 字段：level >= 1 视为已建，level <= 0 视为可建
 *   - 同时支持通过 props.builtPredicate 自定义判定函数
 * - 建造按钮显示资源消耗（如 facilities sheet 有 cost 字段，按字符串原样展示）
 *
 * 用法示例：
 * ```tsx
 * <FacilityPanel />
 * <FacilityPanel
 *   sheetName="custom_facilities"
 *   builtIds={['farm', 'mine']}
 *   onBuild={(facilityId) => console.log('build', facilityId)}
 * />
 * ```
 *
 * 参考：src/renderer/components/Game/panels/ResourcePanel.tsx（派生模式）
 */

import React, { useMemo, useCallback } from 'react';
import { Card, List, Button, Tag, Empty, Space, Tooltip } from 'antd';
import { BuildOutlined } from '@ant-design/icons';
import { useGameStore } from '../../../stores/gameStore';
import type { GameTableData } from '../../../../shared/types/game.types';
import './panels.css';

// ==================== 类型定义 ====================

/** 单个设施派生后的结构 */
export interface FacilityItem {
  key: string;
  id: string;
  name: string;
  level: number;
  cost: string | null;
  /** 原始行数据，便于扩展自定义渲染 */
  raw: Record<string, any>;
}

export interface FacilityPanelProps {
  /** 设施数据所在 sheet 名称，默认 'facilities' */
  sheetName?: string;
  /** 设施 ID 字段名，默认 'id' */
  idField?: string;
  /** 设施名称字段名，默认 'name' */
  nameField?: string;
  /** 设施等级字段名，默认 'level' */
  levelField?: string;
  /** 设施建造成本字段名，默认 'cost' */
  costField?: string;
  /** Card 标题，默认 '设施' */
  title?: string;
  /** 已建设施 ID 列表（外部传入时优先使用） */
  builtIds?: string[];
  /** 自定义已建判定函数（优先级高于 builtIds 与 level 判定） */
  builtPredicate?: (item: FacilityItem) => boolean;
  /**
   * 建造按钮回调
   * 若不传，则默认调用 gameStore.generateNarrative({ userAction: 'build:<facility_id>' })
   * 传入时使用传入的回调，便于上层（如 ManagementGameMain）接管流程
   */
  onBuild?: (facilityId: string) => void;
}

// ==================== 工具函数 ====================

/**
 * 解析设施列表
 *
 * 从 GameTableData 中按 sheetName 取出 rows，并按字段映射提取需要的字段。
 */
function deriveFacilityList(
  tableData: GameTableData | null,
  sheetName: string,
  idField: string,
  nameField: string,
  levelField: string,
  costField: string
): FacilityItem[] {
  if (!tableData) {
    return [];
  }
  const rows = tableData.data?.[sheetName];
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }
  return rows.map((row, idx) => {
    const rawId = row?.[idField];
    const rawName = row?.[nameField];
    const rawLevel = row?.[levelField];
    const rawCost = row?.[costField];

    const level =
      typeof rawLevel === 'number'
        ? rawLevel
        : parseInt(String(rawLevel ?? '0'), 10) || 0;

    const id = String(rawId ?? `facility_${idx}`);
    const name = String(rawName ?? `设施${idx + 1}`);
    const cost =
      rawCost === undefined || rawCost === null || rawCost === ''
        ? null
        : String(rawCost);

    return {
      key: `${sheetName}-${idx}-${id}`,
      id,
      name,
      level,
      cost,
      raw: row ?? {}
    };
  });
}

// ==================== 组件实现 ====================

const FacilityPanel: React.FC<FacilityPanelProps> = ({
  sheetName = 'facilities',
  idField = 'id',
  nameField = 'name',
  levelField = 'level',
  costField = 'cost',
  title = '设施',
  builtIds,
  builtPredicate,
  onBuild
}) => {
  const tableData = useGameStore((s) => s.tableData);
  const generateNarrative = useGameStore((s) => s.generateNarrative);
  const isGenerating = useGameStore((s) => s.isGenerating);
  const currentSaveId = useGameStore((s) => s.currentSaveId);

  const facilities = useMemo(
    () =>
      deriveFacilityList(
        tableData,
        sheetName,
        idField,
        nameField,
        levelField,
        costField
      ),
    [tableData, sheetName, idField, nameField, levelField, costField]
  );

  // 已建/可建 判定
  const { builtList, buildableList } = useMemo(() => {
    const builtSet = new Set(builtIds ?? []);
    const built: FacilityItem[] = [];
    const buildable: FacilityItem[] = [];
    for (const item of facilities) {
      let isBuilt: boolean;
      if (builtPredicate) {
        isBuilt = builtPredicate(item);
      } else if (builtIds) {
        isBuilt = builtSet.has(item.id);
      } else {
        isBuilt = item.level >= 1;
      }
      if (isBuilt) {
        built.push(item);
      } else {
        buildable.push(item);
      }
    }
    return { builtList: built, buildableList: buildable };
  }, [facilities, builtIds, builtPredicate]);

  // 默认建造回调：触发 generateNarrative
  const handleBuild = useCallback(
    (facilityId: string) => {
      if (onBuild) {
        onBuild(facilityId);
        return;
      }
      // 默认行为：通过 gameStore.generateNarrative 触发叙事生成
      // 实际 saveId 由 store 内部从 currentSaveId 取，此处无需传入
      void generateNarrative({
        userAction: `build:${facilityId}`
      });
    },
    [onBuild, generateNarrative]
  );

  // 空状态：tableData 为 null 或 sheet 无数据
  if (facilities.length === 0) {
    return (
      <Card className="game-panel" title={title} size="small">
        <div className="game-panel__empty">
          <Empty description="暂无设施，请建造" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      </Card>
    );
  }

  return (
    <Card className="game-panel" title={title} size="small">
      {/* ---------- 已建设施 ---------- */}
      {builtList.length > 0 && (
        <>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>已建设施</div>
          <List
            size="small"
            dataSource={builtList}
            renderItem={(item) => (
              <List.Item>
                <div className="game-panel__facility-item">
                  <Space>
                    <span>{item.name}</span>
                    <Tag color="green">Lv.{item.level}</Tag>
                  </Space>
                </div>
              </List.Item>
            )}
          />
        </>
      )}

      {/* ---------- 可建设施 ---------- */}
      {buildableList.length > 0 ? (
        <div style={{ marginTop: builtList.length > 0 ? 16 : 0 }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>可建造</div>
          <List
            size="small"
            dataSource={buildableList}
            renderItem={(item) => (
              <List.Item>
                <div className="game-panel__facility-item">
                  <Space>
                    <span>{item.name}</span>
                    {item.cost && (
                      <span className="game-panel__facility-cost">
                        消耗：{item.cost}
                      </span>
                    )}
                  </Space>
                  <Tooltip
                    title={
                      isGenerating
                        ? '叙事生成中，请稍候'
                        : !currentSaveId
                          ? '未加载存档，无法建造'
                          : ''
                    }
                  >
                    <Button
                      type="primary"
                      size="small"
                      icon={<BuildOutlined />}
                      className="game-panel__build-button"
                      disabled={isGenerating || !currentSaveId}
                      onClick={() => handleBuild(item.id)}
                    >
                      建造
                    </Button>
                  </Tooltip>
                </div>
              </List.Item>
            )}
          />
        </div>
      ) : (
        // 有设施但全部已建
        builtList.length > 0 && (
          <Empty
            description="所有设施均已建造"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ marginTop: 12 }}
          />
        )
      )}
    </Card>
  );
};

export default FacilityPanel;
export { FacilityPanel };
