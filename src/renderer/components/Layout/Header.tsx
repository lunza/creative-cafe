import React, { useState } from 'react';
import { Layout, Button, Space, Tooltip } from 'antd';
import { MoonOutlined, SunOutlined, DesktopOutlined, ReloadOutlined, EditOutlined, EyeOutlined, BulbOutlined, ToolOutlined, RobotOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { useUIStore } from '../../stores/uiStore';
import { useSettingStore } from '../../stores/settingStore';
import { useAgentMode } from '../../hooks/useAgentMode';
import HelpViewer from '../Help/HelpViewer';
import './Header.css';

const { Header: AntHeader } = Layout;

const AppLogo: React.FC = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="coffeeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8B5E3C" />
        <stop offset="50%" stopColor="#D4A574" />
        <stop offset="100%" stopColor="#8B5E3C" />
      </linearGradient>
      <linearGradient id="cupGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#F5E6D3" />
        <stop offset="100%" stopColor="#E8D5C0" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="28" height="28" rx="6" fill="url(#coffeeGrad)" />
    <path d="M10 10 L10 20 C10 21.5 11.5 22 13 22 L19 22 C20.5 22 22 21.5 22 20 L22 10 Z" fill="url(#cupGrad)" />
    <ellipse cx="16" cy="10" rx="6" ry="2" fill="#F5E6D3" />
    <path d="M22 13 C23.5 13 25 14 25 16 C25 18 23.5 19 22 19" stroke="#F5E6D3" strokeWidth="1.5" fill="none" />
    <path d="M13 7 C13 5 14 4 15 4" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
    <path d="M16 7 C16 5 17 3 18 3" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
    <path d="M19 7 C19 5 20 4 21 4" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
    <circle cx="14" cy="15" r="1" fill="#8B5E3C" opacity="0.3" />
    <circle cx="17" cy="17" r="0.8" fill="#8B5E3C" opacity="0.3" />
    <circle cx="15" cy="19" r="0.6" fill="#8B5E3C" opacity="0.3" />
  </svg>
);

const Header: React.FC = () => {
  const theme = useUIStore(s => s.theme);
  const setTheme = useUIStore(s => s.setTheme);
  const setting = useSettingStore(s => s.setting);
  const { isActive, status } = useAgentMode();
  const [helpOpen, setHelpOpen] = useState(false);
  const activeEngine = setting?.aiEngines?.find((e) => e.id === setting?.activeEngineId);
  const capabilities = activeEngine?.capabilities;
  const supportsVision = capabilities?.supportsVision === true;
  const supportsThinking = capabilities?.supportsThinking === true;
  const supportsToolCalling = capabilities?.supportsToolCalling === true;
  const hasCapabilityData = capabilities !== undefined;

  // Agent 模式原因文案映射
  const reasonText: Record<string, string> = {
    'tool-calling-supported': '模型支持工具调用',
    'force-on': '用户强制开启',
    'force-off': '用户强制关闭',
    'tool-calling-unsupported': '当前模型不支持工具调用',
  };

  // Agent 模式 Tooltip 详情：模式名称 + 原因
  const agentModeTooltip = isActive
    ? `智能体模式（${reasonText[status?.reason ?? 'tool-calling-supported'] ?? ''}）`
    : `普通模式（${reasonText[status?.reason ?? 'tool-calling-unsupported'] ?? ''}）`;

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'auto' : 'light';
    setTheme(next);
  };

  return (
    <AntHeader className="app-header">
      <div className="header-left">
        <div className="logo-container">
          <AppLogo />
          <div className="title-container">
            <h1 className="app-title">创想咖啡厅</h1>
            <span className="app-subtitle">Creative Café</span>
          </div>
          {/*
            模型能力 + Agent 模式标识图标组
            ============================================================
            Agent 模式图标（RobotOutlined）：
              - 激活：绿色 #52c41a，Tooltip "智能体模式（原因）"
              - 未激活：灰色 var(--text-secondary)，Tooltip "普通模式（原因）"
            能力图标：
              - EditOutlined  (铅笔)：文本生成，常驻
              - EyeOutlined   (眼睛)：视觉/图片识别
              - BulbOutlined  (灯泡)：思维链/推理
              - ToolOutlined  (工具)：工具调用
            所有图标统一 14px，风格一致。
          */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
            <Tooltip title={agentModeTooltip}>
              <RobotOutlined style={{ fontSize: 14, color: isActive ? '#52c41a' : 'var(--text-secondary, #94a3b8)' }} />
            </Tooltip>
            <Tooltip title={hasCapabilityData ? '文本生成' : '请先测试连通性以检测模型能力'}>
              <EditOutlined style={{ fontSize: 14, color: 'var(--text-secondary, #94a3b8)' }} />
            </Tooltip>
            {supportsVision && (
              <Tooltip title="视觉/图片识别">
                <EyeOutlined style={{ fontSize: 14, color: '#52c41a' }} />
              </Tooltip>
            )}
            {supportsThinking && (
              <Tooltip title="思维链/推理">
                <BulbOutlined style={{ fontSize: 14, color: '#722ed1' }} />
              </Tooltip>
            )}
            {supportsToolCalling && (
              <Tooltip title="工具调用">
                <ToolOutlined style={{ fontSize: 14, color: '#fa8c16' }} />
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      <div className="header-right">
        <Space>
          <Button
            type="text"
            icon={<QuestionCircleOutlined />}
            onClick={() => setHelpOpen(true)}
          >
            帮助
          </Button>
          <Button
            type="text"
            icon={<ReloadOutlined />}
            onClick={() => window.location.reload()}
          >
            刷新
          </Button>
          <Button
            type="text"
            icon={theme === 'light' ? <MoonOutlined /> : theme === 'dark' ? <DesktopOutlined /> : <SunOutlined />}
            onClick={toggleTheme}
          >
            {theme === 'light' ? '暗色' : theme === 'dark' ? '跟随系统' : '亮色'}
          </Button>
        </Space>
      </div>
      <HelpViewer open={helpOpen} onClose={() => setHelpOpen(false)} />
    </AntHeader>
  );
};

export default Header;
