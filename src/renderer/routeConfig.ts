/**
 * 统一路由配置 - 单一数据源 (Single Source of Truth)
 *
 * Sidebar 菜单与 App.tsx 的渲染块均从此处消费配置，
 * 新增 tab 只需在此处添加一项即可。
 *
 * L-6/S-7 测试菜单收敛（debugMode 门控保留，devOnly 测试页逐一评估）：
 *  - TestPage（MarkdownEditor 组件演示页，无诊断价值）已删除，test-markdown 子项随之移除。
 *  - test-vector 子项原无 component（点击落 default 渲染 Dashboard，体验陷阱）已删除。
 *  - DocumentVectorPage 是向量化管线真实诊断工具（上传/分块/检索/统计，
 *    documentVectorService 同时被 KnowledgeBaseService 消费）保留，「测试」菜单项
 *    直接指向它并在 label 标注「测试」。
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
  MessageOutlined,
  RobotOutlined
} from '@ant-design/icons';

// 路由级代码分割：所有路由组件使用 React.lazy 懒加载，降低首屏 bundle 体积
const Dashboard = React.lazy(() => import('./components/Dashboard/Dashboard'));
const WorldBookManager = React.lazy(() => import('./components/WorldBook/WorldBookManager'));
const AvatarManager = React.lazy(() => import('./components/Avatar/AvatarManager'));
const CharacterManager = React.lazy(() => import('./components/Character/CharacterManager'));
const Settings = React.lazy(() => import('./components/Settings/Settings'));
const MemoryChatManager = React.lazy(() => import('./components/MemoryChat/MemoryChatManager'));
const CreativeManager = React.lazy(() => import('./components/Creative/CreativeManager'));
const DocumentVectorPage = React.lazy(() => import('./components/Test/DocumentVectorPage'));
// 命名导出需要通过 .then(m => ({ default: m.X })) 适配 React.lazy 的 default 导入约定
const KnowledgeBaseManager = React.lazy(() =>
  import('./components/KnowledgeBase/KnowledgeBaseManager').then(m => ({ default: m.KnowledgeBaseManager }))
);
const CreationCenter = React.lazy(() =>
  import('./components/Chat/CreationCenter').then(m => ({ default: m.CreationCenter }))
);
const PromptManagement = React.lazy(() => import('./components/PromptManagement/PromptManagement'));
const AgentCenter = React.lazy(() => import('./components/AgentCenter/AgentCenter'));

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
  /** 隐藏菜单项（不显示在侧边栏，但路由仍可用） */
  hidden?: boolean;
  /** 固定在菜单列表最下方（如设置） */
  pinnedBottom?: boolean;
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
    component: CreativeManager,
    hidden: true
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
    key: 'agent-center',
    label: '智能体中心',
    icon: RobotOutlined,
    component: AgentCenter
  },
  {
    key: 'prompt-management',
    label: '提示词管理',
    icon: FileTextOutlined,
    component: PromptManagement
  },
  {
    // L-6/S-7：收敛为单一诊断入口（向量化管线诊断工具），label 标注「测试」
    key: 'test',
    label: '测试 · 向量化诊断',
    icon: ToolOutlined,
    component: DocumentVectorPage,
    devOnly: true
  },
  {
    key: 'settings',
    label: '设置',
    icon: SettingOutlined,
    component: Settings,
    pinnedBottom: true
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
  return routeConfigs.filter((route) => (!route.devOnly || debugMode) && !route.hidden);
}
