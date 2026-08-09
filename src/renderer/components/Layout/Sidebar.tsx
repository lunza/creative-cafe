import React from 'react';
import { Layout, Menu, Button, Tooltip } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined
} from '@ant-design/icons';
import { useUIStore } from '../../stores/uiStore';
import { useSettingStore } from '../../stores/settingStore';
import { AppSetting } from '../../settings';
import { getMenuRoutes, RouteConfig } from '../../routeConfig';
import { useAgentMode } from '../../hooks/useAgentMode';
import './Sidebar.css';

const { Sider } = Layout;

/**
 * 根据 RouteConfig 构建 antd Menu item。
 * devOnly 项追加 DEV 徽标；子项的徽标样式略小，保持原视觉行为。
 */
function buildMenuItem(route: RouteConfig, isChild = false): any {
  const Icon = route.icon;
  const iconEl = <Icon />;

  let label: React.ReactNode = route.label;
  if (route.devOnly) {
    const badgeStyle: React.CSSProperties = isChild
      ? { marginLeft: 4, fontSize: 9, padding: '0px 3px', background: '#faad14', color: '#fff', borderRadius: 2 }
      : { marginLeft: 4, fontSize: 10, padding: '1px 4px', background: '#faad14', color: '#fff', borderRadius: 2 };
    label = (
      <span>
        {route.label}
        <span className="dev-menu-badge" style={badgeStyle}>
          DEV
        </span>
      </span>
    );
  }

  return {
    key: route.key,
    icon: iconEl,
    label,
    children: route.children?.map((child) => buildMenuItem(child, true))
  };
}

const Sidebar: React.FC = () => {
  const activeTab = useUIStore(s => s.activeTab);
  const setActiveTab = useUIStore(s => s.setActiveTab);
  const sidebarCollapsed = useUIStore(s => s.sidebarCollapsed);
  const toggleSidebar = useUIStore(s => s.toggleSidebar);
  const theme = useUIStore(s => s.theme);
  const setting = useSettingStore(s => s.setting);
  const debugMode = setting?.debugMode || false;
  const { isActive: isAgentModeActive } = useAgentMode();

  const menuRoutes = getMenuRoutes(debugMode);
  // Agent 模式关闭时隐藏智能体中心菜单
  const visibleRoutes = menuRoutes.filter(route => route.key !== 'agent-center' || isAgentModeActive);
  // 将固定在底部的菜单项（如设置）分离出来，中间插入分割线
  const normalRoutes = visibleRoutes.filter(route => !route.pinnedBottom);
  const pinnedRoutes = visibleRoutes.filter(route => route.pinnedBottom);
  const menuItems = [
    ...normalRoutes.map((route) => buildMenuItem(route, false)),
    ...(pinnedRoutes.length > 0
      ? [{ type: 'divider' as const }, ...pinnedRoutes.map((route) => buildMenuItem(route, false))]
      : [])
  ];

  // 根据主题设置背景色
  const isDark = theme === 'dark';
  const bgColor = isDark ? '#141414' : '#ffffff';

  return (
    <Sider
      trigger={null}
      collapsible
      collapsed={sidebarCollapsed}
      className="sidebar"
      theme={isDark ? 'dark' : 'light'}
      width={240}
      style={{
        background: bgColor,
        boxShadow: isDark ? '2px 0 8px rgba(0,0,0,0.3)' : '2px 0 8px rgba(0,0,0,0.05)'
      }}
    >
      <div className="sidebar-header" style={{ background: bgColor }}>
        <Tooltip
          title={
            <div>
              <p>Creative-Cafe: v{AppSetting.version}</p>
            </div>
          }
          placement="right"
        >
          <div className="sidebar-logo" style={{ cursor: 'pointer' }}>
            {!sidebarCollapsed && (
              <>
                <h2 style={{ color: isDark ? '#40a9ff' : '#1890ff', marginBottom: 0 }}>Creative-Cafe</h2>
                <span style={{ fontSize: 11, color: isDark ? '#888' : '#999', fontWeight: 400, marginLeft: 4 }}>v{AppSetting.version}</span>
              </>
            )}
          </div>
        </Tooltip>
        <Tooltip title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} placement="right">
          <Button
            type="text"
            icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={toggleSidebar}
            className="sidebar-toggle-btn"
            style={{ color: isDark ? '#aaa' : '#666' }}
          />
        </Tooltip>
      </div>
      <Menu
        mode="inline"
        selectedKeys={[activeTab]}
        items={menuItems}
        onClick={({ key }) => setActiveTab(key as any)}
        className="sidebar-menu"
        theme={isDark ? 'dark' : 'light'}
        style={{ background: bgColor, borderRight: 'none' }}
      />
    </Sider>
  );
};

export default Sidebar;
