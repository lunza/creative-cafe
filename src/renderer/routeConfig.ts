/**
 * 统一路由配置 - 单一数据源 (Single Source of Truth)
 *
 * Sidebar 菜单与 App.tsx 的渲染块均从此处消费配置，
 * 新增 tab 只需在此处添加一项即可。
 *
 * 行为保持：
 *  - `test-vector` 在原 App.tsx 中无对应 case，落入 default 渲染 Dashboard。
 *    此处通过省略 `component` 字段保持相同行为。
 *  - `test` 父项虽在 antd Menu 中默认展开子项而非选中，原 switch 仍保留
 *    `case 'test'` 渲染 TestPage 的兼容逻辑，此处同样保留 `component: TestPage`。
 */
import React from 'react';
import {
  DashboardOutlined,
  SettingOutlined,
  BookOutlined,
  UserOutlined,
  ToolOutlined,
  RocketOutlined,
  ThunderboltOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  EditOutlined,
  MessageOutlined
} from '@ant-design/icons';

import Dashboard from './components/Dashboard/Dashboard';
import WorldBookManager from './components/WorldBook/WorldBookManager';
import AvatarManager from './components/Avatar/AvatarManager';
import CharacterManager from './components/Character/CharacterManager';
import Settings from './components/Settings/Settings';
import MemoryChatManager from './components/MemoryChat/MemoryChatManager';
import CreativeManager from './components/Creative/CreativeManager';
import TestPage from './components/Test/TestPage';
import DocumentVectorPage from './components/Test/DocumentVectorPage';
import { KnowledgeBaseManager } from './components/KnowledgeBase/KnowledgeBaseManager';
import { CreationCenter } from './components/Chat/CreationCenter';
import PromptManagement from './components/PromptManagement/PromptManagement';

export interface RouteConfig {
  /** 唯一 key，与 uiStore.activeTab 对应 */
  key: string;
  /** 菜单显示文本（不含 DEV 徽标） */
  label: string;
  /** antd 图标组件类型，由 Sidebar 渲染为 <Icon /> */
  icon: React.ComponentType<any>;
  /** 渲染组件；省略时 App.tsx 走默认 fallback（Dashboard） */
  component?: React.ComponentType<any>;
  /** 是否仅在 debugMode 下显示；DEV 徽标由 Sidebar 渲染 */
  devOnly?: boolean;
  /** 子菜单（如测试集） */
  children?: RouteConfig[];
}

export const routeConfigs: RouteConfig[] = [
  {
    key: 'dashboard',
    label: '仪表盘',
    icon: DashboardOutlined,
    component: Dashboard
  },
  {
    key: 'chat',
    label: '创作中心',
    icon: MessageOutlined,
    component: CreationCenter
  },
  {
    key: 'creative',
    label: '创意管理',
    icon: RocketOutlined,
    component: CreativeManager
  },
  {
    key: 'worldbook',
    label: '世界书',
    icon: BookOutlined,
    component: WorldBookManager
  },
  {
    key: 'avatar',
    label: '用户人设',
    icon: ThunderboltOutlined,
    component: AvatarManager
  },
  {
    key: 'character',
    label: '角色卡',
    icon: UserOutlined,
    component: CharacterManager
  },
  {
    key: 'memory',
    label: '记忆管理',
    icon: DatabaseOutlined,
    component: MemoryChatManager
  },
  {
    key: 'knowledge',
    label: '知识库',
    icon: FileTextOutlined,
    component: KnowledgeBaseManager
  },
  {
    key: 'settings',
    label: '设置',
    icon: SettingOutlined,
    component: Settings
  },
  {
    key: 'prompt-management',
    label: '提示词管理',
    icon: FileTextOutlined,
    component: PromptManagement
  },
  {
    key: 'test',
    label: '测试',
    icon: ToolOutlined,
    component: TestPage,
    devOnly: true,
    children: [
      // 注：原 App.tsx switch 无 'test-vector' case，省略 component 保持 default → Dashboard 行为
      {
        key: 'test-vector',
        label: '向量化测试',
        icon: DatabaseOutlined,
        devOnly: true
      },
      {
        key: 'document-vector',
        label: '文档向量化',
        icon: FileTextOutlined,
        component: DocumentVectorPage,
        devOnly: true
      },
      {
        key: 'test-markdown',
        label: 'Markdown 测试',
        icon: EditOutlined,
        component: TestPage,
        devOnly: true
      }
    ]
  }
];

/**
 * 根据 activeTab 查找对应的渲染组件。
 * 不存在或未配置 component 时返回 null（由调用方走 default fallback）。
 */
export function findRouteComponent(activeTab: string): React.ComponentType<any> | null {
  for (const route of routeConfigs) {
    if (route.key === activeTab) {
      return route.component ?? null;
    }
    if (route.children) {
      for (const child of route.children) {
        if (child.key === activeTab) {
          return child.component ?? null;
        }
      }
    }
  }
  return null;
}

/**
 * 根据 debugMode 过滤生成菜单项配置。
 * 包含 DEV 徽标的 JSX 由 Sidebar 端基于 devOnly 渲染，
 * 此处仅返回数据，避免在数据层耦合视图。
 */
export function getMenuRoutes(debugMode: boolean): RouteConfig[] {
  return routeConfigs.filter((route) => !route.devOnly || debugMode);
}
