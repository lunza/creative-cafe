import React from 'react';
import { Layout, Button, Space, Tooltip } from 'antd';
import { MoonOutlined, SunOutlined, ReloadOutlined, EditOutlined, EyeOutlined, BulbOutlined, ToolOutlined } from '@ant-design/icons';
import { useUIStore } from '../../stores/uiStore';
import { useSettingStore } from '../../stores/settingStore';
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
  const { theme, setTheme } = useUIStore();
  const { setting } = useSettingStore();
  const activeEngine = setting?.aiEngines?.find((e) => e.id === setting?.activeEngineId);
  const capabilities = activeEngine?.capabilities;
  const supportsVision = capabilities?.supportsVision === true;
  const supportsThinking = capabilities?.supportsThinking === true;
  const supportsToolCalling = capabilities?.supportsToolCalling === true;
  const hasCapabilityData = capabilities !== undefined;

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
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
            模型能力标识 — 实时显示当前 AI 引擎的能力组合
            ============================================================
            数据来源：settingStore -> setting.activeEngineId -> setting.aiEngines.find(...) -> capabilities
            4 种图标分别代表：
              - EditOutlined  (铅笔)：文本生成能力，作为基础能力常驻显示
              - EyeOutlined   (眼睛)：视觉/图片识别能力 (supportsVision=true 时显示)
              - BulbOutlined  (灯泡)：思维链/推理能力   (supportsThinking=true 时显示)
              - ToolOutlined  (工具)：工具调用能力      (supportsToolCalling=true 时显示)
            触发条件：仅当对应能力 === true 时显示对应图标
            未检测时的行为：capabilities 为 undefined（即用户尚未测试连通性）时，
              仅显示编辑图标，鼠标悬停 Tooltip 提示「请先测试连通性以检测模型能力」。
            图标尺寸统一 14px，使用内联样式与现有 header 风格保持一致。
          */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
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
            icon={<ReloadOutlined />}
            onClick={() => window.location.reload()}
          >
            刷新
          </Button>
          <Button
            type="text"
            icon={theme === 'light' ? <MoonOutlined /> : <SunOutlined />}
            onClick={toggleTheme}
          >
            {theme === 'light' ? '暗色' : '亮色'}
          </Button>
        </Space>
      </div>
    </AntHeader>
  );
};

export default Header;
