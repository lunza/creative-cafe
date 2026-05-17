import React, { useState, useEffect, useRef } from 'react';
import { Tooltip } from 'antd';
import { CopyOutlined, CheckOutlined, ReloadOutlined, DoubleRightOutlined, RetweetOutlined, LoadingOutlined, EditOutlined, TableOutlined, WarningOutlined } from '@ant-design/icons';
import { MessageRenderer } from './MessageRenderer';
import { ChatMessage, ChatMessageVersionInfo } from './CharacterDialogueChat.types';

interface ChatMessageBubbleProps {
  message: ChatMessage;
  characterName: string;
  avatarPath?: string;
  onRetry?: (messageId: string) => void;
  onContinue?: () => void;
  onEdit?: (messageId: string, newContent: string) => void;
  onRetryFromVersion?: (versionFilePath: string) => void;
  isLastMessage?: boolean;
  isStreaming?: boolean;
  isGenerating?: boolean;
}

const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  message,
  characterName,
  avatarPath,
  onRetry,
  onContinue,
  onEdit,
  onRetryFromVersion,
  isLastMessage = false,
  isStreaming = false,
  isGenerating = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isUser = message.role === 'user';
  const versionInfo = message.versionInfo;

  const hasVersionInfo = !!versionInfo && versionInfo.allVersions && versionInfo.allVersions.length > 0;
  const isLatestVersion = versionInfo?.isLatestVersion ?? false;

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
    }
  };

  const handleEditStart = () => {
    setEditContent(String(message.content));
    setIsEditing(true);
  };

  const handleEditCancel = () => {
    setEditContent('');
    setIsEditing(false);
  };

  const handleEditSave = () => {
    if (onEdit && editContent.trim() && editContent !== message.content) {
      onEdit(message.id, editContent.trim());
    }
    setIsEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleEditCancel();
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleEditSave();
    }
  };

  const handleBubbleMouseEnter = () => {
    setIsHovered(true);
    setShowActions(true);
  };

  const handleBubbleMouseLeave = () => {
    setIsHovered(false);
    if (!isLastMessage || isUser || message.status === 'sending' || isStreaming) {
      setShowActions(false);
    }
  };

  const handleRetry = () => {
    if (onRetry && !isUser && message.status !== 'sending') {
      onRetry(message.id);
    }
  };

  const handleRetryFromVersion = () => {
    if (onRetryFromVersion && versionInfo?.versionFilePath) {
      onRetryFromVersion(versionInfo.versionFilePath);
    }
  };

  const handleContinue = () => {
    if (onContinue && !isUser && !isStreaming && !isGenerating) {
      onContinue();
    }
  };

  useEffect(() => {
    if (isLastMessage && !isUser && message.status !== 'sending' && !isStreaming) {
      const timer = setTimeout(() => {
        setShowActions(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isLastMessage, isUser, message.status, isStreaming]);

  const isActionVisible = showActions || isHovered;

  const shouldHideAllButtons = !hasVersionInfo && !isLastMessage && !isUser && message.status === 'sent';

  const showRegenerateOnly = !isUser && hasVersionInfo && !isLatestVersion && message.status === 'sent';

  const showFullActions = !isUser && (isLatestVersion || !hasVersionInfo) && message.status === 'sent';

  const actionButtons = !isUser && !shouldHideAllButtons && (
    <div style={{
      display: 'flex',
      gap: '4px',
      padding: '4px 8px',
      borderRadius: '12px',
      background: 'var(--action-bg, rgba(255, 255, 255, 0.05))',
      border: '1px solid var(--action-border, rgba(255, 255, 255, 0.08))',
      opacity: isActionVisible && !isStreaming && !isGenerating ? 1 : 0,
      transform: isActionVisible && !isStreaming && !isGenerating ? 'translateY(0)' : 'translateY(4px)',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    }}>
      <Tooltip title="复制">
        <button
          onClick={handleCopy}
          style={{
            background: 'none',
            border: 'none',
            color: copied ? 'var(--success-color, #22c55e)' : 'var(--text-secondary, #9ca3af)',
            cursor: 'pointer',
            padding: '6px 8px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            borderRadius: '6px',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            e.currentTarget.style.color = 'var(--text-primary, #e2e8f0)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none';
            e.currentTarget.style.color = copied ? 'var(--success-color, #22c55e)' : 'var(--text-secondary, #9ca3af)';
          }}
        >
          {copied ? <CheckOutlined /> : <CopyOutlined />}
        </button>
      </Tooltip>

      {showFullActions && (
        <>
          <Tooltip title={isEditing ? '保存编辑' : '编辑内容'}>
            <button
              onClick={() => {
                if (isEditing) {
                  handleEditSave();
                } else {
                  handleEditStart();
                }
              }}
              style={{
                background: 'none',
                border: 'none',
                color: isEditing ? 'var(--primary-color, #6366f1)' : 'var(--text-secondary, #9ca3af)',
                cursor: 'pointer',
                padding: '6px 8px',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                borderRadius: '6px',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.color = 'var(--primary-color, #6366f1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'none';
                e.currentTarget.style.color = isEditing ? 'var(--primary-color, #6366f1)' : 'var(--text-secondary, #9ca3af)';
              }}
            >
              <EditOutlined />
            </button>
          </Tooltip>
        </>
      )}

      <Tooltip title={showRegenerateOnly ? '从此版本重新生成' : '重新生成'}>
        <button
          onClick={showRegenerateOnly ? handleRetryFromVersion : handleRetry}
          disabled={isGenerating || isStreaming || message.status === 'error'}
          style={{
            background: 'none',
            border: 'none',
            color: message.status === 'error' ? 'var(--error-color, #ef4444)' : 'var(--text-secondary, #9ca3af)',
            cursor: isGenerating || isStreaming ? 'not-allowed' : 'pointer',
            padding: '6px 8px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            borderRadius: '6px',
            transition: 'all 0.2s ease',
            opacity: isGenerating || isStreaming ? 0.5 : 1,
          }}
          onMouseEnter={(e) => {
            if (!isGenerating && !isStreaming) {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.color = 'var(--text-primary, #e2e8f0)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isGenerating && !isStreaming) {
              e.currentTarget.style.background = 'none';
              e.currentTarget.style.color = message.status === 'error' ? 'var(--error-color, #ef4444)' : 'var(--text-secondary, #9ca3af)';
            }
          }}
        >
          {isGenerating && isLastMessage ? (
            <LoadingOutlined style={{ fontSize: '12px' }} spin />
          ) : (
            <ReloadOutlined />
          )}
        </button>
      </Tooltip>

      {showFullActions && (
        <Tooltip title="继续对话">
          <button
            onClick={handleContinue}
            disabled={isGenerating || isStreaming || message.status !== 'sent'}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary, #9ca3af)',
              cursor: isGenerating || isStreaming || message.status !== 'sent' ? 'not-allowed' : 'pointer',
              padding: '6px 8px',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              borderRadius: '6px',
              transition: 'all 0.2s ease',
              opacity: isGenerating || isStreaming || message.status !== 'sent' ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isGenerating && !isStreaming && message.status === 'sent') {
                e.currentTarget.style.background = 'rgba(99, 102, 241, 0.2)';
                e.currentTarget.style.color = 'var(--primary-color, #6366f1)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isGenerating && !isStreaming && message.status === 'sent') {
                e.currentTarget.style.background = 'none';
                e.currentTarget.style.color = 'var(--text-secondary, #9ca3af)';
              }
            }}
          >
            <DoubleRightOutlined />
          </button>
        </Tooltip>
      )}
    </div>
  );

  const userEditButton = isUser && message.status !== 'sending' && (
    <div style={{
      display: 'flex',
      gap: '4px',
      padding: '4px 8px',
      borderRadius: '12px',
      background: 'var(--action-bg, rgba(255, 255, 255, 0.05))',
      border: '1px solid var(--action-border, rgba(255, 255, 255, 0.08))',
      opacity: isActionVisible ? 1 : 0,
      transform: isActionVisible ? 'translateY(0)' : 'translateY(4px)',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      justifyContent: 'flex-end',
    }}>
      <Tooltip title={isEditing ? '保存编辑' : '编辑内容'}>
        <button
          onClick={() => {
            if (isEditing) {
              handleEditSave();
            } else {
              handleEditStart();
            }
          }}
          style={{
            background: 'none',
            border: 'none',
            color: isEditing ? 'var(--primary-color, #6366f1)' : 'var(--text-secondary, #9ca3af)',
            cursor: 'pointer',
            padding: '6px 8px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            borderRadius: '6px',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            e.currentTarget.style.color = 'var(--primary-color, #6366f1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none';
            e.currentTarget.style.color = isEditing ? 'var(--primary-color, #6366f1)' : 'var(--text-secondary, #9ca3af)';
          }}
        >
          <EditOutlined />
        </button>
      </Tooltip>
    </div>
  );

  return (
    <div className="chat-message-bubble-wrapper" style={{
      display: 'flex',
      marginBottom: '20px',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      animation: 'fadeInUp 0.3s ease-out',
    }}>
      <div
        className="chat-message-bubble-inner"
        style={{
          display: 'flex',
          gap: '12px',
          maxWidth: '75%',
          flexDirection: isUser ? 'row-reverse' : 'row',
        }}
        onMouseEnter={handleBubbleMouseEnter}
        onMouseLeave={handleBubbleMouseLeave}
      >
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          overflow: 'hidden',
          flexShrink: 0,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          border: '2px solid ' + (isUser ? 'var(--primary-color, #6366f1)' : 'var(--secondary-color, #8b5cf6)'),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isUser
            ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
            : 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
        }}>
          {avatarPath && !isUser ? (
            <img src={avatarPath} alt={characterName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ color: '#fff', fontSize: '16px', fontWeight: 'bold' }}>
              {isUser ? 'U' : characterName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{
            fontSize: '12px',
            color: 'var(--text-secondary, #6b7280)',
            padding: isUser ? '0 12px' : '0 4px',
          }}>
            {isUser ? 'You' : characterName}
          </div>

          <div style={{
            background: isUser
              ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
              : 'var(--bubble-bg-assistant, rgba(30, 30, 46, 0.8))',
            color: isUser ? '#fff' : 'var(--text-primary, #e2e8f0)',
            padding: '12px 16px',
            borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
            wordBreak: 'break-word',
            backdropFilter: 'blur(10px)',
            boxShadow: isUser
              ? '0 4px 12px rgba(99, 102, 241, 0.3)'
              : '0 4px 12px rgba(0,0,0,0.2)',
            position: 'relative',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}>
            {isEditing && (
              <div style={{
                opacity: 0,
                pointerEvents: 'none',
                userSelect: 'none',
              }}>
                <MessageRenderer
                  content={String(message.content)}
                  charName={characterName}
                  userName="You"
                  config={{
                    style: {
                      theme: 'dark',
                      codeHighlight: true,
                    },
                  }}
                />
              </div>
            )}

            {isEditing ? (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                animation: 'fadeInUp 0.2s ease-out',
                position: 'absolute',
                inset: 0,
                zIndex: 2,
                padding: '12px 16px',
                borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              }}>
                <textarea
                  ref={textareaRef}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  placeholder="输入内容..."
                  style={{
                    width: '100%',
                    flex: 1,
                    boxSizing: 'border-box',
                    minHeight: '80px',
                    maxHeight: '100%',
                    padding: '12px 14px',
                    fontSize: '13px',
                    lineHeight: '1.7',
                    fontFamily: 'inherit',
                    color: 'var(--text-primary, #e2e8f0)',
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '10px',
                    resize: 'none',
                    outline: 'none',
                    overflow: 'auto',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--primary-color, #6366f1)';
                    e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99, 102, 241, 0.15)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
              </div>
            ) : (
              <>
                <MessageRenderer
                  content={String(message.content)}
                  charName={characterName}
                  userName="You"
                  config={{
                    style: {
                      theme: 'dark',
                      codeHighlight: true,
                    },
                  }}
                />
                {isStreaming && isLastMessage && !isUser && (
                  <span style={{
                    display: 'inline-block',
                    width: '2px',
                    height: '1em',
                    backgroundColor: 'var(--text-primary, #e2e8f0)',
                    marginLeft: '2px',
                    animation: 'blink 1s step-end infinite',
                    verticalAlign: 'text-bottom',
                  }} />
                )}
              </>
            )}
          </div>

          {actionButtons}

          {userEditButton}

          {!isUser && versionInfo && (
            <div style={{
              display: 'flex',
              gap: '6px',
              padding: '2px 8px 0',
              alignItems: 'center',
              justifyContent: 'flex-end',
              opacity: isActionVisible ? 1 : 0,
              transition: 'opacity 0.3s ease',
            }}>
              {versionInfo.tableSnapshotExists && (
                <Tooltip title="包含表格快照">
                  <TableOutlined style={{ fontSize: '11px', color: 'var(--primary-color, #6366f1)' }} />
                </Tooltip>
              )}
              {versionInfo.consistencyStatus === 'mismatched' && (
                <Tooltip title="版本不一致">
                  <WarningOutlined style={{ fontSize: '11px', color: 'var(--error-color, #ef4444)' }} />
                </Tooltip>
              )}
              {versionInfo.consistencyStatus === 'partial' && (
                <Tooltip title="版本部分匹配">
                  <WarningOutlined style={{ fontSize: '11px', color: 'var(--warning-color, #f59e0b)' }} />
                </Tooltip>
              )}
              {!isLatestVersion && hasVersionInfo && (
                <span style={{
                  fontSize: '10px',
                  color: 'var(--text-tertiary, #6b7280)',
                  fontStyle: 'italic',
                }}>
                  历史版本 #{versionInfo.versionSequenceNumber}
                </span>
              )}
            </div>
          )}

          {!showActions && isGenerating && isLastMessage && (
            <div style={{
              display: 'flex',
              gap: '8px',
              padding: '0 4px',
            }}>
              <span style={{
                fontSize: '11px',
                color: 'var(--text-secondary, #6b7280)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}>
                <LoadingOutlined style={{ fontSize: '10px' }} spin />
                Generating...
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatMessageBubble;
