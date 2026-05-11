import React from 'react';
import { Layout, Menu, Button, Tooltip } from 'antd';
import {
  DashboardOutlined,
  SettingOutlined,
  BookOutlined,
  UserOutlined,
  ToolOutlined,
  RocketOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  AppstoreOutlined,
  ThunderboltOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  EditOutlined,
  MessageOutlined
} from '@ant-design/icons';
import { useUIStore } from '../../stores/uiStore';
import { useSettingStore } from '../../stores/settingStore';
import { AppSetting } from '../../settings';
import './Sidebar.css';

const { Sider } = Layout;

const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab, sidebarCollapsed, toggleSidebar, theme } = useUIStore();
  const { setting } = useSettingStore();
  const debugMode = setting?.debugMode || false;

  const stableMenuItems = [
    {
      key: 'dashboard',
      icon: <DashboardOutlined />,
      label: '仪表盘'
    },
    {
      key: 'chat',
      icon: <MessageOutlined />,
      label: '创作中心'
    },
    {
      key: 'creative',
      icon: <RocketOutlined />,
      label: '创意管理'
    },
    {
      key: 'worldbook',
      icon: <BookOutlined />,
      label: '世界书'
    },
    {
      key: 'avatar',
      icon: <ThunderboltOutlined />,
      label: '用户人设'
    },
    {
      key: 'character',
      icon: <UserOutlined />,
      label: '角色卡'
    },
    {
      key: 'memory',
      icon: <DatabaseOutlined />,
      label: '记忆管理'
    },
    {
      key: 'knowledge',
      icon: <FileTextOutlined />,
      label: '知识库'
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '设置'
    }
  ];

  const devMenuItems = [
    {
      key: 'prompt-optimizer',
      icon: <RocketOutlined />,
      label: (
        <span>
          提示词优化
          <span className="dev-menu-badge" style={{ marginLeft: 4, fontSize: 10, padding: '1px 4px', background: '#faad14', color: '#fff', borderRadius: 2 }}>
            DEV
          </span>
        </span>
      )
    },
    {
      key: 'plugin',
      icon: <AppstoreOutlined />,
      label: (
        <span>
          插件管理
          <span className="dev-menu-badge" style={{ marginLeft: 4, fontSize: 10, padding: '1px 4px', background: '#faad14', color: '#fff', borderRadius: 2 }}>
            DEV
          </span>
        </span>
      )
    },
    {
      key: 'test',
      icon: <ToolOutlined />,
      label: (
        <span>
          测试
          <span className="dev-menu-badge" style={{ marginLeft: 4, fontSize: 10, padding: '1px 4px', background: '#faad14', color: '#fff', borderRadius: 2 }}>
            DEV
          </span>
        </span>
      ),
      children: [
        {
          key: 'test-vector',
          icon: <DatabaseOutlined />,
          label: (
            <span>
              向量化测试
              <span className="dev-menu-badge" style={{ marginLeft: 4, fontSize: 9, padding: '0px 3px', background: '#faad14', color: '#fff', borderRadius: 2 }}>
                DEV
              </span>
            </span>
          )
        },
        {
          key: 'document-vector',
          icon: <FileTextOutlined />,
          label: (
            <span>
              文档向量化
              <span className="dev-menu-badge" style={{ marginLeft: 4, fontSize: 9, padding: '0px 3px', background: '#faad14', color: '#fff', borderRadius: 2 }}>
                DEV
              </span>
            </span>
          )
        },
        {
          key: 'test-markdown',
          icon: <EditOutlined />,
          label: (
            <span>
              Markdown 测试
              <span className="dev-menu-badge" style={{ marginLeft: 4, fontSize: 9, padding: '0px 3px', background: '#faad14', color: '#fff', borderRadius: 2 }}>
                DEV
              </span>
            </span>
          )
        }
      ]
    }
  ];

  const menuItems = [...stableMenuItems, ...(debugMode ? devMenuItems : [])];

  // 根据主题设置背景色
  const isDark = theme === 'dark';
  const bgColor = isDark ? '#141414' : '#ffffff';
  const textColor = isDark ? '#ffffff' : '#000000';

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
