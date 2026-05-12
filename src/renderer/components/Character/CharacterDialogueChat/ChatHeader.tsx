import React from 'react';
import { Button, Space, Tooltip } from 'antd';
import { ClearOutlined, ExportOutlined, CloseOutlined, RobotOutlined, FullscreenOutlined, FullscreenExitOutlined, UserOutlined, HeartOutlined, HeartFilled } from '@ant-design/icons';

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
  selectedPersona?: { name: string; avatarPath?: string } | null;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
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
  selectedPersona,
  isFavorite = false,
  onToggleFavorite,
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
          {onToggleFavorite && (
            <Tooltip title={isFavorite ? '取消喜爱' : '喜爱'}>
              <Button
                type="text"
                icon={isFavorite ? <HeartFilled /> : <HeartOutlined />}
                onClick={onToggleFavorite}
                size="small"
                style={{
                  color: isFavorite ? '#ec4899' : 'var(--text-secondary, #9ca3af)',
                  fontSize: isFullscreen ? '18px' : '16px',
                  padding: '4px',
                  transition: 'all 0.2s ease',
                  transform: isFavorite ? 'scale(1.1)' : 'scale(1)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = isFavorite ? 'scale(1.1)' : 'scale(1)';
                }}
              />
            </Tooltip>
          )}
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
        {selectedPersona && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 12px',
            background: 'rgba(99, 102, 241, 0.1)',
            borderRadius: '16px',
            border: '1px solid rgba(99, 102, 241, 0.3)',
          }}>
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              overflow: 'hidden',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {selectedPersona.avatarPath ? (
                <img src={selectedPersona.avatarPath} alt={selectedPersona.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <UserOutlined style={{ fontSize: '12px', color: '#fff' }} />
              )}
            </div>
            <span style={{ fontSize: '13px', color: 'var(--text-primary, #e2e8f0)' }}>
              {selectedPersona.name}
            </span>
          </div>
        )}
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
