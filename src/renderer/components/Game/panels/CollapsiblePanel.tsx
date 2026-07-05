/**
 * 折叠容器组件（Task 13 / SubTask 13.4）
 *
 * 职责：
 * - 基于 antd Collapse 的折叠容器
 * - 折叠状态通过 gameUIStore.collapsedPanels[panelKey] 持久化
 * - 组件挂载时从 store 读取初始状态；折叠/展开时同步到 store
 *
 * 设计要点：
 * - 单层包装：被传入的 children 包裹在 Collapse.Panel 内
 * - 折叠状态读取与持久化均委托给 gameUIStore，组件本身无 localStorage 依赖
 *   （gameUIStore 设计为不持久化到 localStorage，运行期会话状态）
 * - defaultOpen 仅在 store 中尚未记录该 panelKey 的状态时生效；
 *   一旦用户折叠/展开过，store 中的状态优先
 * - 受控模式：折叠状态完全由 store 决定，避免"内部 state 与 store 不一致"问题
 *
 * 用法示例：
 * ```tsx
 * <CollapsiblePanel title="资源" panelKey="resource-panel" defaultOpen>
 *   <ResourcePanel />
 * </CollapsiblePanel>
 * ```
 *
 * 参考：src/renderer/stores/gameUIStore.ts（collapsedPanels / setPanelCollapsed）
 */

import React, { useCallback } from 'react';
import { Collapse } from 'antd';
import { useGameUIStore } from '../../../stores/gameUIStore';
import './panels.css';

// ==================== 类型定义 ====================

export interface CollapsiblePanelProps {
  /** 面板标题 */
  title: string;
  /** 面板内容 */
  children: React.ReactNode;
  /**
   * 默认是否展开
   *
   * 仅在 store 中尚未记录该 panelKey 状态时生效。
   * 一旦用户折叠/展开过，store 中的状态优先。
   */
  defaultOpen?: boolean;
  /** 用于持久化折叠状态的 key（必须全局唯一） */
  panelKey: string;
  /** 自定义类名（追加在 game-panel__collapse 之后） */
  className?: string;
}

// ==================== 组件实现 ====================

const CollapsiblePanel: React.FC<CollapsiblePanelProps> = ({
  title,
  children,
  defaultOpen = true,
  panelKey,
  className
}) => {
  // 从 store 读取折叠状态；若 store 中尚未记录，回退到 !defaultOpen
  const collapsed = useGameUIStore((s) => {
    if (Object.prototype.hasOwnProperty.call(s.collapsedPanels, panelKey)) {
      return s.collapsedPanels[panelKey];
    }
    // 默认值：defaultOpen=true → 未折叠（false）；defaultOpen=false → 已折叠（true）
    return !defaultOpen;
  });

  const setPanelCollapsed = useGameUIStore((s) => s.setPanelCollapsed);

  const handleChange = useCallback(
    (keys: string[]) => {
      // antd v6 Collapse onChange 回调签名：(key: string[]) => void
      // 判断 panelKey 是否在 activeKey 中
      const isCurrentlyActive = keys.includes(panelKey);
      // 折叠状态 = !active
      setPanelCollapsed(panelKey, !isCurrentlyActive);
    },
    [panelKey, setPanelCollapsed]
  );

  const containerClass = ['game-panel__collapse', className]
    .filter(Boolean)
    .join(' ');

  // activeKey 控制：collapsed=true → []（折叠），collapsed=false → [panelKey]（展开）
  const activeKey = collapsed ? [] : [panelKey];

  return (
    <div className="game-panel">
      <Collapse
        className={containerClass}
        activeKey={activeKey}
        onChange={handleChange}
        size="small"
        items={[
          {
            key: panelKey,
            label: title,
            children: children
          }
        ]}
      />
    </div>
  );
};

export default CollapsiblePanel;
export { CollapsiblePanel };
