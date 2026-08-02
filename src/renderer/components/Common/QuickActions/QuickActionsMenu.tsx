import React, { useMemo } from 'react';
import { Dropdown, Button, Tooltip } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';

export interface QuickActionItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}

export interface QuickActionsMenuProps {
  /** 对话操作组 */
  dialogueActions?: QuickActionItem[];
  /** 内容操作组 */
  contentActions?: QuickActionItem[];
  /** 设置操作组 */
  settingActions?: QuickActionItem[];
  /** 是否禁用 */
  disabled?: boolean;
}

/**
 * 将 QuickActionItem 转换为 antd Menu 菜单项
 */
function buildMenuItem(action: QuickActionItem): NonNullable<MenuProps['items']>[number] {
  return {
    key: action.key,
    label: (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minWidth: '160px' }}>
        <span>{action.label}</span>
        {action.shortcut && (
          <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '12px' }}>{action.shortcut}</span>
        )}
      </div>
    ),
    icon: action.icon,
    disabled: action.disabled,
    onClick: () => action.onClick(),
  };
}

const QuickActionsMenu: React.FC<QuickActionsMenuProps> = ({
  dialogueActions = [],
  contentActions = [],
  settingActions = [],
  disabled = false,
}) => {
  const menuItems = useMemo<NonNullable<MenuProps['items']>>(() => {
    const items: NonNullable<MenuProps['items']> = [];

    if (dialogueActions.length > 0) {
      items.push(...dialogueActions.map(buildMenuItem));
    }

    if (contentActions.length > 0) {
      if (items.length > 0) items.push({ type: 'divider' });
      items.push(...contentActions.map(buildMenuItem));
    }

    if (settingActions.length > 0) {
      if (items.length > 0) items.push({ type: 'divider' });
      items.push(...settingActions.map(buildMenuItem));
    }

    return items;
  }, [dialogueActions, contentActions, settingActions]);

  const hasItems = menuItems.length > 0;

  return (
    <Dropdown
      menu={{ items: menuItems }}
      trigger={['click']}
      disabled={disabled || !hasItems}
      overlayStyle={{ minWidth: '200px' }}
    >
      <Tooltip title="快捷操作">
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          disabled={disabled || !hasItems}
          size="large"
          style={{
            borderRadius: '50%',
            width: '44px',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
            border: 'none',
            boxShadow: '0 4px 12px rgba(245, 158, 11, 0.4)',
            opacity: disabled || !hasItems ? 0.5 : 1,
            transition: 'all 0.2s ease',
          }}
        />
      </Tooltip>
    </Dropdown>
  );
};

export default QuickActionsMenu;
