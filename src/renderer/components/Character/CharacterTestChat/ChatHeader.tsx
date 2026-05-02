import React from 'react';
import { Button, Space, Tooltip } from 'antd';
import { ClearOutlined, ExportOutlined, CloseOutlined, RobotOutlined, FullscreenOutlined, FullscreenExitOutlined } from '@ant-design/icons';

interface ChatHeaderProps {
  characterName: string;
  characterCardContent?: string;
  messageCount: number;
  onClear: () => void;
  onClose: () => void;
  onExport?: () => void;
  avatarPath?: string;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  characterName,
  characterCardContent,
  messageCount,
  onClear,
  onClose,
  onExport,
  avatarPath,
  isFullscreen = false,
  onToggleFullscreen,
}) => {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: isFullscreen ? '20px 32px' : '16px 20px',
      background: 'var(--header-bg, rgba(30, 30, 46, 0.8))',
      backdropFilter: 'blur(10px)',
      borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: isFullscreen ? '48px' : '40px',
          height: isFullscreen ? '48px' : '40px',
          borderRadius: '50%',
          overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          border: '2px solid var(--secondary-color, #8b5cf6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
        }}>
          {avatarPath ? (
            <img src={avatarPath} alt={characterName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <RobotOutlined style={{ fontSize: isFullscreen ? '24px' : '20px', color: '#fff' }} />
          )}
        </div>
        <div>
          <h3 style={{
            margin: 0,
            fontSize: isFullscreen ? '18px' : '16px',
            fontWeight: 600,
            color: 'var(--text-primary, #e2e8f0)',
          }}>
            {characterName || 'Test Character'}
          </h3>
          <p style={{
            margin: 0,
            fontSize: '12px',
            color: 'var(--text-secondary, #6b7280)',
          }}>
            {messageCount} messages {characterCardContent ? '• Roleplay mode' : ''}
          </p>
        </div>
      </div>

      <Space size="small">
        {onExport && (
          <Tooltip title="Export conversation">
            <Button
              type="text"
              icon={<ExportOutlined />}
              onClick={onExport}
              size="small"
              style={{ color: 'var(--text-secondary, #9ca3af)' }}
            />
          </Tooltip>
        )}
        {messageCount > 0 && (
          <Tooltip title="Clear conversation">
            <Button
              type="text"
              danger
              icon={<ClearOutlined />}
              onClick={onClear}
              size="small"
            />
          </Tooltip>
        )}
        {onToggleFullscreen && (
          <Tooltip title={isFullscreen ? 'Restore window' : 'Fullscreen'}>
            <Button
              type="text"
              icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={onToggleFullscreen}
              size="small"
              style={{ color: isFullscreen ? 'var(--primary-color, #6366f1)' : 'var(--text-secondary, #9ca3af)' }}
            />
          </Tooltip>
        )}
        <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Close'}>
          <Button
            type="text"
            icon={isFullscreen ? <FullscreenExitOutlined /> : <CloseOutlined />}
            onClick={onClose}
            size="small"
            style={{ color: 'var(--text-secondary, #9ca3af)' }}
          />
        </Tooltip>
      </Space>
    </div>
  );
};

export default ChatHeader;
