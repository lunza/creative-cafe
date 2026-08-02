import React, { useMemo, useState } from 'react';
import { Button, Space, Tooltip, Dropdown, Modal, Input } from 'antd';
import type { MenuProps } from 'antd';
import { ClearOutlined, ExportOutlined, CloseOutlined, RobotOutlined, FullscreenOutlined, FullscreenExitOutlined, UserOutlined, HeartOutlined, HeartFilled, QuestionCircleOutlined, DownOutlined, SmileOutlined, PlusOutlined } from '@ant-design/icons';

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
  /** 打开表情管理弹窗（Spec: add-character-expression-system / Task 8.1） */
  onOpenExpressionManager?: () => void;
  /** 会话列表（Spec: optimize-agent-interaction-from-openclaw / M2-Task7） */
  sessions?: Array<{ sessionId: string; title: string; lastActiveAt: number; messageCount: number }>;
  /** 当前会话 ID */
  currentSessionId?: string | null;
  /** 新建会话回调 */
  onCreateSession?: () => void;
  /** 切换会话回调 */
  onSwitchSession?: (sessionId: string) => void;
  /** 重命名会话回调 */
  onRenameSession?: (sessionId: string, newTitle: string) => void;
  /** 删除会话回调 */
  onDeleteSession?: (sessionId: string) => void;
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
  onOpenExpressionManager,
  sessions,
  currentSessionId,
  onCreateSession,
  onSwitchSession,
  onRenameSession,
  onDeleteSession,
}) => {
  const hasCharacterList = !!characters && characters.length > 0;

  // 会话重命名 Modal 状态（Spec: optimize-agent-interaction-from-openclaw / M2-Task7）
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  // 会话切换菜单项（Spec: optimize-agent-interaction-from-openclaw / M2-Task7）
  const sessionMenuItems = useMemo<MenuProps['items']>(() => {
    if (!sessions || sessions.length === 0) return [];
    const items: MenuProps['items'] = sessions.map(s => ({
      key: `session-${s.sessionId}`,
      label: (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', minWidth: '200px' }}>
          <span style={{
            fontWeight: s.sessionId === currentSessionId ? 600 : 400,
            color: s.sessionId === currentSessionId ? '#6366f1' : 'inherit',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '160px',
          }}>
            {s.title}
          </span>
          <span style={{ fontSize: '11px', color: '#8c8c8c', flexShrink: 0 }}>
            {s.messageCount} 条
          </span>
        </div>
      ),
    }));
    // 添加分隔线和管理选项
    if (currentSessionId) {
      items.push({ type: 'divider' });
      items.push({ key: 'rename-current', label: '重命名当前会话' });
      items.push({ key: 'delete-current', label: '删除当前会话', danger: true });
    }
    return items;
  }, [sessions, currentSessionId]);

  const handleSessionMenuClick = ({ key }: { key: string }) => {
    if (key === 'rename-current') {
      const currentSession = sessions?.find(s => s.sessionId === currentSessionId);
      if (currentSession) {
        setRenameValue(currentSession.title);
        setRenameModalOpen(true);
      }
    } else if (key === 'delete-current') {
      if (currentSessionId) {
        onDeleteSession?.(currentSessionId);
      }
    } else if (key.startsWith('session-')) {
      const sessionId = key.replace('session-', '');
      onSwitchSession?.(sessionId);
    }
  };

  const currentSessionTitle = sessions?.find(s => s.sessionId === currentSessionId)?.title;

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
          {/* 会话切换（Spec: optimize-agent-interaction-from-openclaw / M2-Task7） */}
          {sessions && sessions.length > 0 && (
            <Dropdown
              menu={{ items: sessionMenuItems, onClick: handleSessionMenuClick }}
              trigger={['click']}
            >
              <div style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span style={{
                  fontSize: '11px',
                  color: 'var(--chat-header-text-secondary, #8c8c8c)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '120px',
                }}>
                  {currentSessionTitle || '新对话'}
                </span>
                <DownOutlined style={{ fontSize: '10px', color: 'var(--chat-header-text-secondary, #8c8c8c)' }} />
              </div>
            </Dropdown>
          )}
      </div>

      <Space size="small">
        {onCreateSession && (
          <Tooltip title="新建会话">
            <Button
              type="text"
              icon={<PlusOutlined />}
              size="small"
              onClick={onCreateSession}
              style={{ color: 'var(--chat-header-btn-color, #8c8c8c)' }}
            />
          </Tooltip>
        )}
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
        {onOpenExpressionManager && (
          <Tooltip title="素材管理">
            <Button
              type="text"
              icon={<SmileOutlined />}
              onClick={() => onOpenExpressionManager?.()}
              size="small"
              style={{ color: 'var(--chat-header-btn-color, #8c8c8c)' }}
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
      {/* 会话重命名 Modal（Spec: optimize-agent-interaction-from-openclaw / M2-Task7） */}
      <Modal
        title="重命名会话"
        open={renameModalOpen}
        onOk={() => {
          if (currentSessionId && renameValue.trim()) {
            onRenameSession?.(currentSessionId, renameValue.trim());
          }
          setRenameModalOpen(false);
        }}
        onCancel={() => setRenameModalOpen(false)}
        okText="确定"
        cancelText="取消"
      >
        <Input
          value={renameValue}
          onChange={e => setRenameValue(e.target.value)}
          placeholder="请输入新的会话标题"
          onPressEnter={() => {
            if (currentSessionId && renameValue.trim()) {
              onRenameSession?.(currentSessionId, renameValue.trim());
            }
            setRenameModalOpen(false);
          }}
        />
      </Modal>
    </div>
  );
};

export default ChatHeader;
