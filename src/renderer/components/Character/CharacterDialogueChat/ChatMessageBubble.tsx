import React, { useState, useEffect, useRef } from 'react';
import { Tooltip } from 'antd';
import { CopyOutlined, CheckOutlined, ReloadOutlined, DoubleRightOutlined, RetweetOutlined, LoadingOutlined, EditOutlined, TableOutlined, WarningOutlined, RollbackOutlined } from '@ant-design/icons';
import { MessageRenderer } from './MessageRenderer';
import { ChatMessage, ChatMessageVersionInfo } from './CharacterDialogueChat.types';
import './ChatMessageBubble.css';
import { formatTimestamp } from './CharacterDialogueChat.utils';

interface ChatMessageBubbleProps {
  message: ChatMessage;
  characterName: string;
  avatarPath?: string;
  onRetry?: (messageId: string) => void;
  onContinue?: () => void;
  onEdit?: (messageId: string, newContent: string) => void;
  onRetryFromVersion?: (versionFilePath: string) => void;
  onRollback?: (messageId: string) => void;
  isLastMessage?: boolean;
  isStreaming?: boolean;
  isGenerating?: boolean;
  onSelectOption?: (optionText: string) => void;
}

const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  message,
  characterName,
  avatarPath,
  onRetry,
  onContinue,
  onEdit,
  onRollback,
  onRetryFromVersion,
  isLastMessage = false,
  isStreaming = false,
  isGenerating = false,
  onSelectOption,
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
      background: 'var(--chat-action-bg, rgba(255, 255, 255, 0.05))',
      border: '1px solid var(--chat-action-border, rgba(255, 255, 255, 0.08))',
      opacity: isActionVisible && !isStreaming && !isGenerating ? 1 : 0,
      transform: isActionVisible && !isStreaming && !isGenerating ? 'translateY(0)' : 'translateY(4px)',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    }}>
      <Tooltip title="复制">
        <button
          onClick={handleCopy}
          className="chat-action-btn"
          style={copied ? { color: 'var(--success-color, #22c55e)' } : undefined}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--chat-action-hover, rgba(255, 255, 255, 0.1))';
            e.currentTarget.style.color = 'var(--text-primary, #e2e8f0)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none';
            e.currentTarget.style.color = copied ? 'var(--success-color, #22c55e)' : 'var(--chat-action-text, #9ca3af)';
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
              className="chat-action-btn"
              style={isEditing ? { color: 'var(--primary-color, #6366f1)' } : undefined}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--chat-action-hover, rgba(255, 255, 255, 0.1))';
                e.currentTarget.style.color = 'var(--primary-color, #6366f1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'none';
                e.currentTarget.style.color = isEditing ? 'var(--primary-color, #6366f1)' : 'var(--chat-action-text, #9ca3af)';
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
          className="chat-action-btn"
          style={{
            color: message.status === 'error' ? 'var(--error-color, #ef4444)' : undefined,
            cursor: isGenerating || isStreaming ? 'not-allowed' : undefined,
            opacity: isGenerating || isStreaming ? 0.5 : undefined,
          }}
          onMouseEnter={(e) => {
            if (!isGenerating && !isStreaming) {
              e.currentTarget.style.background = 'var(--chat-action-hover, rgba(255, 255, 255, 0.1))';
              e.currentTarget.style.color = 'var(--text-primary, #e2e8f0)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isGenerating && !isStreaming) {
              e.currentTarget.style.background = 'none';
              e.currentTarget.style.color = message.status === 'error' ? 'var(--error-color, #ef4444)' : 'var(--chat-action-text, #9ca3af)';
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
            className="chat-action-btn"
            style={{
              cursor: isGenerating || isStreaming || message.status !== 'sent' ? 'not-allowed' : undefined,
              opacity: isGenerating || isStreaming || message.status !== 'sent' ? 0.5 : undefined,
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
                e.currentTarget.style.color = 'var(--chat-action-text, #9ca3af)';
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
      background: 'var(--chat-action-bg, rgba(255, 255, 255, 0.05))',
      border: '1px solid var(--chat-action-border, rgba(255, 255, 255, 0.08))',
      opacity: isActionVisible ? 1 : 0,
      transform: isActionVisible ? 'translateY(0)' : 'translateY(4px)',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      justifyContent: 'flex-end',
    }}>
      <Tooltip title="卷回到输入框">
        <button
          onClick={() => onRollback?.(message.id)}
          disabled={isStreaming && !isLastMessage}
          className="chat-action-btn"
          style={{
            cursor: isStreaming && !isLastMessage ? 'not-allowed' : undefined,
            opacity: isStreaming && !isLastMessage ? 0.5 : undefined,
          }}
          onMouseEnter={(e) => {
            if (!(isStreaming && !isLastMessage)) {
              e.currentTarget.style.background = 'var(--chat-action-hover, rgba(255, 255, 255, 0.1))';
              e.currentTarget.style.color = 'var(--primary-color, #6366f1)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none';
            e.currentTarget.style.color = 'var(--chat-action-text, #9ca3af)';
          }}
        >
          <RollbackOutlined />
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
          minWidth: 0,
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: '12px',
            color: 'var(--text-secondary, #6b7280)',
            padding: isUser ? '0 12px' : '0 4px',
          }}>
            {isUser ? 'You' : characterName}
          </div>

          <div style={{
            background: isUser
              ? 'var(--chat-bubble-user-bg, linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%))'
              : 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.8))',
            color: isUser
              ? 'var(--chat-bubble-user-color, #fff)'
              : 'var(--chat-bubble-assistant-color, #e2e8f0)',
            padding: '12px 16px',
            borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            overflow: 'hidden',
            backdropFilter: 'blur(10px)',
            boxShadow: isUser
              ? 'var(--chat-bubble-user-shadow, 0 4px 12px rgba(99, 102, 241, 0.3))'
              : 'var(--chat-bubble-assistant-shadow, 0 4px 12px rgba(0,0,0,0.2))',
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
                    color: 'var(--chat-edit-color, #e2e8f0)',
                    background: 'var(--chat-edit-bg, rgba(0, 0, 0, 0.25))',
                    border: '1px solid var(--chat-edit-border, rgba(255, 255, 255, 0.15))',
                    borderRadius: '10px',
                    resize: 'none',
                    outline: 'none',
                    overflow: 'auto',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--chat-edit-border-focus, var(--primary-color, #6366f1))';
                    e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99, 102, 241, 0.15)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--chat-edit-border, rgba(255, 255, 255, 0.15))';
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
                    backgroundColor: 'var(--chat-cursor-color, #e2e8f0)',
                    marginLeft: '2px',
                    animation: 'blink 1s step-end infinite',
                    verticalAlign: 'text-bottom',
                  }} />
                )}
                {/* 辅助模式：推荐选项渲染（Spec: add-assist-mode-options） */}
                {!isUser && !isStreaming && message.suggestedOptions && message.suggestedOptions.length > 0 && (
                  <div className="suggested-options-container">
                    {message.suggestedOptions.map((option, idx) => (
                      <div
                        key={idx}
                        className="suggested-option-item"
                        onClick={() => onSelectOption?.(option)}
                      >
                        <span className="suggested-option-number">{idx + 1}</span>
                        <span className="suggested-option-text">{option}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {!isEditing && (
              <span style={{
                position: 'absolute',
                bottom: '4px',
                right: '10px',
                fontSize: '11px',
                color: 'var(--chat-action-text, #8c8c8c)',
                opacity: isHovered ? 1 : 0,
                transition: 'opacity 0.2s ease',
                pointerEvents: 'none',
                userSelect: 'none',
              }}>
                {formatTimestamp(message.timestamp)}
              </span>
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
                  color: 'var(--chat-action-text, #6b7280)',
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
                color: 'var(--chat-action-text, #6b7280)',
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
