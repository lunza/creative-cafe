import React, { useState, useCallback } from 'react';
import {
  MessageOutlined,
  TeamOutlined,
  EditOutlined,
  TrophyOutlined
} from '@ant-design/icons';
import { ChatMode } from './ChatMode';
import { GroupChatMode } from './GroupChatMode';
import { CreativeMode } from './CreativeMode';
import { GameMode } from './GameMode';
import './ChatModule.css';

type ChatPanelType = 'chat' | 'group' | 'creative' | 'game';

const panelConfig: Record<ChatPanelType, { label: string; icon: React.ReactNode; color: string; activeColor: string }> = {
  chat: {
    label: '聊天模式',
    icon: <MessageOutlined />,
    color: '#6366f1',
    activeColor: '#818cf8',
  },
  group: {
    label: '群聊模式',
    icon: <TeamOutlined />,
    color: '#ec4899',
    activeColor: '#f472b6',
  },
  creative: {
    label: '创作模式',
    icon: <EditOutlined />,
    color: '#f59e0b',
    activeColor: '#fbbf24',
  },
  game: {
    label: '游戏模式',
    icon: <TrophyOutlined />,
    color: '#10b981',
    activeColor: '#34d399',
  },
};

export const ChatModule: React.FC = () => {
  const [activePanel, setActivePanel] = useState<ChatPanelType>('chat');
  const [showChatDialog, setShowChatDialog] = useState(false);
  const [flashingPanel, setFlashingPanel] = useState<ChatPanelType | null>(null);

  const handlePanelClick = useCallback((panel: ChatPanelType) => {
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

          return (
            <div
              key={panel}
              className={`chat-panel ${isActive ? 'active' : ''} ${isFlashing ? 'flashing' : ''}`}
              onClick={() => handlePanelClick(panel)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handlePanelClick(panel);
                }
              }}
            >
              <div className="chat-panel-content">
                <div className="chat-panel-icon" style={{ color: isActive ? config.activeColor : config.color }}>
                  {config.icon}
                </div>
                <div className="chat-panel-label" style={{ color: isActive ? config.activeColor : config.color }}>
                  {config.label}
                </div>
              </div>
              {isActive && <div className="chat-panel-border" style={{ borderColor: config.activeColor }} />}
            </div>
          );
        })}
      </div>

      <ChatMode
        isDialogMode={showChatDialog}
        onCloseDialog={handleCloseChat}
      />
    </div>
  );
};

export default ChatModule;
