import React, { useState, useCallback, useRef } from 'react';
import {
  MessageOutlined,
  TeamOutlined,
  EditOutlined,
  TrophyOutlined
} from '@ant-design/icons';
import { SingleChatDialog } from './SingleChatDialog';
import { GroupChatMode } from './GroupChatMode';
import { CreativeMode } from './CreativeMode';
import { GameMode } from './GameMode';
import './CreationCenter.css';

type ChatPanelType = 'chat' | 'group' | 'creative' | 'game';

interface PanelConfig {
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  activeColor: string;
  comingSoon?: boolean;
}

const panelConfig: Record<ChatPanelType, PanelConfig> = {
  chat: {
    label: '聊天模式',
    description: '与AI角色进行一对一深度对话，体验沉浸式交互',
    icon: <MessageOutlined />,
    color: '#6366f1',
    activeColor: '#818cf8',
  },
  group: {
    label: '群聊模式',
    description: '多个AI角色同时参与对话，体验多角色互动场景',
    icon: <TeamOutlined />,
    color: '#ec4899',
    activeColor: '#f472b6',
    comingSoon: true,
  },
  creative: {
    label: '写作模式',
    description: 'AI辅助创作，生成故事、小说和各类文本内容',
    icon: <EditOutlined />,
    color: '#f59e0b',
    activeColor: '#fbbf24',
    comingSoon: true,
  },
  game: {
    label: '游戏模式',
    description: '互动式文字冒险游戏，由AI驱动剧情发展',
    icon: <TrophyOutlined />,
    color: '#10b981',
    activeColor: '#34d399',
    comingSoon: true,
  },
};

const colorMap: Record<ChatPanelType, string> = {
  chat: '#6366f1',
  group: '#ec4899',
  creative: '#f59e0b',
  game: '#10b981',
};

interface Ripple {
  x: number;
  y: number;
  id: number;
}

export const CreationCenter: React.FC = () => {
  const [activePanel, setActivePanel] = useState<ChatPanelType>('chat');
  const [showChatDialog, setShowChatDialog] = useState(false);
  const [flashingPanel, setFlashingPanel] = useState<ChatPanelType | null>(null);
  const [ripples, setRipples] = useState<Record<ChatPanelType, Ripple[]>>({
    chat: [],
    group: [],
    creative: [],
    game: [],
  });
  const rippleCounter = useRef(0);

  const handlePanelClick = useCallback((panel: ChatPanelType, e: React.MouseEvent<HTMLDivElement>) => {
    const config = panelConfig[panel];
    if (config.comingSoon) {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rippleId = ++rippleCounter.current;

    setRipples((prev) => ({
      ...prev,
      [panel]: [...(prev[panel] || []), { x, y, id: rippleId }],
    }));

    setTimeout(() => {
      setRipples((prev) => ({
        ...prev,
        [panel]: prev[panel].filter((r) => r.id !== rippleId),
      }));
    }, 600);

    setActivePanel(panel);
    setFlashingPanel(panel);
    setTimeout(() => setFlashingPanel(null), 300);

    if (panel === 'chat') {
      setShowChatDialog(true);
    }
  }, []);

  const handleCloseChat = useCallback(() => {
    setShowChatDialog(false);
  }, []);

  return (
    <div className="chat-module">
      <div className="chat-panels-container">
        {(Object.keys(panelConfig) as ChatPanelType[]).map((panel) => {
          const config = panelConfig[panel];
          const isActive = activePanel === panel;
          const isFlashing = flashingPanel === panel;
          const isDisabled = !!config.comingSoon;

          return (
            <div
              key={panel}
              data-panel={panel}
              className={`chat-panel ${isActive ? 'active' : ''} ${isFlashing ? 'flashing' : ''} ${isDisabled ? 'disabled' : ''}`}
              onClick={(e) => handlePanelClick(panel, e)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handlePanelClick(panel, e as unknown as React.MouseEvent<HTMLDivElement>);
                }
              }}
            >
              <div className="hover-overlay" />
              {(ripples[panel] || []).map((ripple) => (
                <span
                  key={ripple.id}
                  className="ripple"
                  style={{
                    left: ripple.x - 25,
                    top: ripple.y - 25,
                    width: 50,
                    height: 50,
                    backgroundColor: colorMap[panel],
                    opacity: 0.3,
                  }}
                />
              ))}
              <div className="chat-panel-content">
                <div className="chat-panel-icon" style={{ color: isActive ? config.activeColor : config.color }}>
                  {config.icon}
                </div>
                <div className="chat-panel-label" style={{ color: isActive ? config.activeColor : config.color }}>
                  {config.label}
                </div>
                <div className="chat-panel-description">{config.description}</div>
                {config.comingSoon && (
                  <div className="chat-panel-badge">
                    <span className="badge-text">敬请期待</span>
                  </div>
                )}
              </div>
              {isActive && !isDisabled && <div className="chat-panel-border" style={{ borderColor: config.activeColor }} />}
            </div>
          );
        })}
      </div>

      <SingleChatDialog
        isDialogMode={showChatDialog}
        onCloseDialog={handleCloseChat}
      />
    </div>
  );
};

export default CreationCenter;
