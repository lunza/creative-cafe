import React, { useMemo } from 'react';
import { Button, Space, Tooltip, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { ClearOutlined, ExportOutlined, CloseOutlined, RobotOutlined, FullscreenOutlined, FullscreenExitOutlined, UserOutlined, HeartOutlined, HeartFilled, QuestionCircleOutlined, DownOutlined } from '@ant-design/icons';

interface ChatHeaderProps {
  characterName: string;
  characterCardContent?: string;
  messageCount: number;
  onClear: () => void;
  onClose: () => void;
  exportMenu?: MenuProps['items'];
  onExportMenuClick?: (key: string) => void;
  characters?: Array<{ name: string; path: string; characterName?: string }>;
  onQuickSwitchCharacter?: (path: string) => void;
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
  exportMenu,
  onExportMenuClick,
  characters,
  onQuickSwitchCharacter,
  avatarPath,
  isFullscreen = false,
  onToggleFullscreen,
  selectedPersona,
  isFavorite = false,
  onToggleFavorite,
}) => {
  const hasCharacterList = !!characters && characters.length > 0;

  const characterMenuItems = useMemo<MenuProps['items']>(() => {
    if (!hasCharacterList) return [];
    const items: { key: string; label: string; disabled?: boolean }[] = characters!.slice(0, 50).map((c) => ({
      key: c.path,
      label: c.characterName || c.name,
    }));
    if (characters!.length > 50) {
      items.push({ key: '__more__', label: '更多角色请在侧栏切换', disabled: true });
    }
    return items;
  }, [characters, hasCharacterList]);

  const handleCharacterMenuClick = ({ key }: { key: string }) => {
    if (key !== '__more__') {
      onQuickSwitchCharacter?.(key);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: isFullscreen ? '20px 32px' : '16px 20px',
      background: 'var(--chat-header-bg, rgba(30, 30, 46, 0.8))',
      backdropFilter: 'blur(10px)',
      borderBottom: '1px solid var(--chat-header-border, rgba(255, 255, 255, 0.1))',
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
          <Dropdown
            menu={{ items: characterMenuItems, onClick: handleCharacterMenuClick }}
            trigger={['click']}
            disabled={!hasCharacterList}
          >
            <div style={{ cursor: hasCharacterList ? 'pointer' : 'default' }}>
              <h3 style={{
                margin: 0,
                fontSize: isFullscreen ? '18px' : '16px',
                fontWeight: 600,
                color: 'var(--chat-header-text-primary, #e2e8f0)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}>
                {characterName || 'Test Character'}
                {hasCharacterList && (
                  <DownOutlined style={{ fontSize: '12px', color: 'var(--chat-header-text-secondary, #8c8c8c)' }} />
                )}
              </h3>
              <p style={{
                margin: 0,
                fontSize: '12px',
                color: 'var(--chat-header-text-secondary, #8c8c8c)',
              }}>
                {messageCount} 条消息{characterCardContent ? ' • 角色扮演模式' : ''}
              </p>
            </div>
          </Dropdown>
      </div>

      <Space size="small">
        {selectedPersona && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 12px',
            background: 'var(--chat-header-persona-bg, rgba(99, 102, 241, 0.1))',
            borderRadius: '16px',
            border: '1px solid var(--chat-header-persona-border, rgba(99, 102, 241, 0.3))',
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
            <span style={{ fontSize: '13px', color: 'var(--chat-header-persona-text, #e2e8f0)' }}>
              {selectedPersona.name}
            </span>
          </div>
        )}
        {exportMenu && (
          <Dropdown menu={{ items: exportMenu, onClick: (e) => onExportMenuClick?.(e.key) }} trigger={['click']}>
            <Tooltip title="导出对话">
              <Button
                type="text"
                icon={<ExportOutlined />}
                size="small"
                style={{ color: 'var(--chat-header-btn-color, #8c8c8c)' }}
              />
            </Tooltip>
          </Dropdown>
        )}
        <Tooltip title="Enter 发送 · Shift+Enter 换行 · Esc 取消生成">
          <Button
            type="text"
            icon={<QuestionCircleOutlined />}
            size="small"
            style={{ color: 'var(--chat-header-btn-color, #8c8c8c)' }}
          />
        </Tooltip>
        {messageCount > 0 && (
          <Tooltip title="清空对话">
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
          <Tooltip title={isFullscreen ? '退出全屏' : '全屏'}>
            <Button
              type="text"
              icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={onToggleFullscreen}
              size="small"
              style={{ color: isFullscreen ? 'var(--primary-color, #6366f1)' : 'var(--text-secondary, #8c8c8c)' }}
            />
          </Tooltip>
        )}
        <Tooltip title={isFullscreen ? '退出全屏' : '关闭'}>
          <Button
            type="text"
            icon={isFullscreen ? <FullscreenExitOutlined /> : <CloseOutlined />}
            onClick={onClose}
            size="small"
            style={{ color: 'var(--text-secondary, #8c8c8c)' }}
          />
        </Tooltip>
      </Space>
    </div>
  );
};

export default ChatHeader;
