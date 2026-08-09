import React, { useState, useEffect, useRef } from 'react';
import { Tooltip } from 'antd';
import { CopyOutlined, CheckOutlined, ReloadOutlined, DoubleRightOutlined, RetweetOutlined, LoadingOutlined, EditOutlined, TableOutlined, WarningOutlined, RollbackOutlined } from '@ant-design/icons';
import { MessageRenderer } from './MessageRenderer';
import { ChatMessage, ChatMessageVersionInfo } from './CharacterDialogueChat.types';
import { EMOTION_PRESETS } from './PromptBuilder';
import './ChatMessageBubble.css';
import { formatTimestamp } from './CharacterDialogueChat.utils';

interface ChatMessageBubbleProps {
  message: ChatMessage;
  characterName: string;
  avatarPath?: string;
  /** AI 回复表情图像路径（Spec: add-character-expression-system / Task 10.1），优先于 avatarPath */
  expressionImage?: string;
  onRetry?: (messageId: string) => void;
  onContinue?: () => void;
  onEdit?: (messageId: string, newContent: string) => void;
  onRetryFromVersion?: (versionFilePath: string) => void;
  onRollback?: (messageId: string) => void;
  isLastMessage?: boolean;
  isStreaming?: boolean;
  isGenerating?: boolean;
  onSelectOption?: (optionText: string) => void;
  /** AI 回复序号（从 1 开始，仅 assistant 消息有值，user 消息为 0） */
  aiSequenceNumber?: number;
  /** 显示思考过程（true=折叠展示，false=移除） */
  showThinking?: boolean;
}

const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  message,
  characterName,
  avatarPath,
  expressionImage,
  onRetry,
  onContinue,
  onEdit,
  onRollback,
  onRetryFromVersion,
  isLastMessage = false,
  isStreaming = false,
  isGenerating = false,
  onSelectOption,
  aiSequenceNumber = 0,
  showThinking = false,
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

  // 辅助模式：将选项文本中的 () 动作描写和 "" 对话内容解析为带样式的 React 元素
  const renderOptionContent = (text: string) => {
    const parts: React.ReactNode[] = [];
    const regex = /\(([^)]*)\)|"([^"]*)"/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;

    while ((match = regex.exec(text)) !== null) {
      // 匹配前的普通文本
      if (match.index > lastIndex) {
        parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
      }
      if (match[1] !== undefined) {
        // () 动作描写
        parts.push(<span key={key++} className="suggested-option-action">({match[1]})</span>);
      } else if (match[2] !== undefined) {
        // "" 对话内容
        parts.push(<span key={key++} className="suggested-option-dialogue">"{match[2]}"</span>);
      }
      lastIndex = regex.lastIndex;
    }
    // 末尾普通文本
    if (lastIndex < text.length) {
      parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
    }
    return parts;
  };

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
    <div className={`chat-msg-actions ${isActionVisible && !isStreaming && !isGenerating ? 'visible' : ''}`}>
      <Tooltip title="复制">
        <button
          onClick={handleCopy}
          className={`chat-action-btn${copied ? ' copied' : ''}`}
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
              className={`chat-action-btn${isEditing ? ' edit-active' : ''}`}
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
          className={`chat-action-btn${message.status === 'error' ? ' error' : ''}`}
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
          >
            <DoubleRightOutlined />
          </button>
        </Tooltip>
      )}
    </div>
  );

  const userEditButton = isUser && message.status !== 'sending' && (
    <div className={`chat-msg-actions is-user ${isActionVisible ? 'visible' : ''}`}>
      <Tooltip title="卷回到输入框">
        <button
          onClick={() => onRollback?.(message.id)}
          disabled={isStreaming && !isLastMessage}
          className="chat-action-btn"
        >
          <RollbackOutlined />
        </button>
      </Tooltip>
    </div>
  );

  return (
    <div className={`chat-msg-wrapper ${isUser ? 'is-user' : 'is-assistant'}${!isUser && aiSequenceNumber > 0 && aiSequenceNumber % 2 === 1 ? ' chat-msg-stripe' : ''}`}>
      <div
        className={`chat-msg-inner ${isUser ? 'is-user' : 'is-assistant'}`}
        onMouseEnter={handleBubbleMouseEnter}
        onMouseLeave={handleBubbleMouseLeave}
      >
        {expressionImage && !isUser ? (
          <div className="chat-msg-expression">
            <img src={expressionImage} alt={characterName} />
          </div>
        ) : (
          <div className={`chat-msg-avatar ${isUser ? 'is-user' : 'is-assistant'}`}>
            {avatarPath && !isUser ? (
              <img src={avatarPath} alt={characterName} />
            ) : (
              <span className="chat-msg-avatar-fallback">
                {isUser ? 'U' : characterName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        )}

        <div className="chat-msg-content-col">
          <div className={`chat-msg-name ${isUser ? 'is-user' : 'is-assistant'}`}>
            {isUser ? 'You' : characterName}
            {!isUser && message.emotion && (() => {
              const preset = EMOTION_PRESETS.find(e => e.key === message.emotion);
              const label = preset?.label || message.emotion;
              return <span className="chat-msg-emotion-label">({label})</span>;
            })()}
            {!isUser && aiSequenceNumber > 0 && (
              <span className="chat-msg-seq-badge">
                #{aiSequenceNumber}
              </span>
            )}
          </div>

          <div className={`chat-msg-bubble ${isUser ? 'is-user' : 'is-assistant'}`}>
            {isEditing && (
              <div className="chat-msg-edit-placeholder">
                <MessageRenderer
                  content={String(message.content)}
                  charName={characterName}
                  userName="You"
                  config={{
                    style: {
                      theme: 'dark',
                      codeHighlight: true,
                    },
                    markdown: {
                      showThinking,
                    },
                  }}
                />
              </div>
            )}

            {isEditing ? (
              <div className={`chat-msg-edit-container ${isUser ? 'is-user' : 'is-assistant'}`}>
                <textarea
                  ref={textareaRef}
                  className="chat-msg-edit-textarea"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  placeholder="输入内容..."
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
                    markdown: {
                      showThinking,
                    },
                  }}
                />
                {isStreaming && isLastMessage && !isUser && (
                  <span className="chat-msg-cursor" />
                )}
                {/* 辅助模式：推荐选项渲染（Spec: add-assist-mode-options） */}
                {!isUser && !isStreaming && message.suggestedOptions && message.suggestedOptions.length > 0 && (
                  <div className="suggested-options-container">
                    {message.suggestedOptions.map((option, idx) => {
                      const labels = ['稳妥推进', '平衡探索', '发散创新'];
                      const labelClasses = ['suggested-option-tag-stable', 'suggested-option-tag-balanced', 'suggested-option-tag-creative'];
                      return (
                        <div
                          key={idx}
                          className="suggested-option-item"
                          onClick={() => onSelectOption?.(option)}
                        >
                          <span className={`suggested-option-number ${labelClasses[idx] || ''}`}>{idx + 1}</span>
                          <div className="suggested-option-content">
                            {idx < 3 && <span className={`suggested-option-tag ${labelClasses[idx] || ''}`}>{labels[idx]}</span>}
                            <span className="suggested-option-text">{renderOptionContent(option)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
            {!isEditing && (
              <span className={`chat-msg-timestamp ${isHovered ? 'visible' : ''}`}>
                {formatTimestamp(message.timestamp)}
              </span>
            )}
          </div>

          {actionButtons}

          {userEditButton}

          {!isUser && versionInfo && (
            <div className={`chat-msg-version-info ${isActionVisible ? 'visible' : ''}`}>
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
            <div className="chat-msg-generating">
              <span className="chat-msg-generating-text">
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
