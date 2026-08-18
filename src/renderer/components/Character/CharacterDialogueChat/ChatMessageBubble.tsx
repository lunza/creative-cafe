import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Tooltip, Modal, Tag } from 'antd';
import { CopyOutlined, CheckOutlined, ReloadOutlined, DoubleRightOutlined, RetweetOutlined, LoadingOutlined, EditOutlined, TableOutlined, WarningOutlined, RollbackOutlined, PictureOutlined, DeleteOutlined, LeftOutlined, RightOutlined, DownOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { MessageRenderer } from './MessageRenderer';
import { ChatMessage, ChatMessageVersionInfo } from './CharacterDialogueChat.types';
import { EMOTION_PRESETS } from './PromptBuilder';
import './ChatMessageBubble.css';
import { formatTimestamp } from './CharacterDialogueChat.utils';

interface ChatMessageBubbleProps {
  message: ChatMessage;
  characterName: string;
  /** 用户人设名称（用于 {{user}} 模板替换，缺省 'User'） */
  userName?: string;
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
  /** 图片生成功能是否开启（Spec: add-conversation-image-generation） */
  imageGenEnabled?: boolean;
  /** 是否正在生成图片（Spec: add-conversation-image-generation） */
  isGeneratingImage?: boolean;
  /** 点击生成图片按钮回调（Spec: add-conversation-image-generation） */
  onGenerateImage?: (messageId: string) => void;
  /** 角色卡 ID（Spec: fix-conversation-image-generation-bugs），用于从 assetId 异步加载图片 */
  characterCardId?: string;
  /** 删除图片附件回调（Spec: enhance-conversation-image-bubble） */
  onDeleteImage?: (messageId: string) => void;
  /** 重新生成图片回调（Spec: enhance-conversation-image-bubble） */
  onRegenerateImage?: (messageId: string) => void;
  /** 历史图片导航回调（Spec: enhance-conversation-image-bubble） */
  onNavigateImage?: (messageId: string, direction: 'prev' | 'next') => void;
  /** 按情绪解析表情图（Spec: enhance-conversation-image-bubble），用于按 attachment.emotion 解析立绘 */
  resolveExpressionImage?: (emotion: string) => string | undefined;
}

const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  message,
  characterName,
  userName = 'User',
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
  imageGenEnabled,
  isGeneratingImage = false,
  onGenerateImage,
  characterCardId,
  onDeleteImage,
  onRegenerateImage,
  onNavigateImage,
  resolveExpressionImage,
}) => {
  const [copied, setCopied] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  // 【Spec: enhance-conversation-image-auditability / Task 5.3】标签面板展开状态
  const [tagsPanelExpanded, setTagsPanelExpanded] = useState(false);
  const [promptPanelExpanded, setPromptPanelExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isUser = message.role === 'user';

  // 【Bug 4 修复】从 assetId 异步加载图片（Spec: fix-conversation-image-generation-bugs）
  // 【Spec: enhance-conversation-image-bubble / SubTask 4.4】优先使用 imageAttachment.currentAssetId（新格式），
  // 回退到 message.generatedImage（旧格式兜底，迁移后不应出现但保留）
  const [loadedImageUrl, setLoadedImageUrl] = useState<string | null>(null);

  // 当前激活的 assetId（新格式优先）
  const activeAssetId = message.imageAttachment?.currentAssetId || message.generatedImage;
  // 是否为图片消息（新格式优先，旧格式兜底）
  const isImageMessage = !!message.imageAttachment || (!!message.isImageMessage && !!message.generatedImage);

  useEffect(() => {
    // 如果是 data URL 直接使用
    if (activeAssetId?.startsWith('data:')) {
      setLoadedImageUrl(activeAssetId);
      return;
    }
    // 如果是 assetId，异步从磁盘加载
    if (activeAssetId && isImageMessage) {
      let cancelled = false;
      setLoadedImageUrl(null);
      (async () => {
        try {
          const pathResult = await window.electronAPI.asset.getImagePath({
            characterCardId: characterCardId || '',
            assetType: 'general',
            assetId: activeAssetId,
          });
          if (cancelled) return;
          if (pathResult?.success && pathResult.imagePath) {
            const readResult = await window.electronAPI.file.readAsBase64(pathResult.imagePath);
            if (cancelled) return;
            // file:readAsBase64 返回 { success, data }，data 已是完整的 data URL
            if (readResult?.success && readResult.data) {
              setLoadedImageUrl(readResult.data);
            }
          }
        } catch (e) {
          console.warn('[ChatMessageBubble] Failed to load image from assetId:', e);
        }
      })();
      return () => { cancelled = true; };
    }
    setLoadedImageUrl(null);
  }, [activeAssetId, isImageMessage, characterCardId]);

  const versionInfo = message.versionInfo;

  const hasVersionInfo = !!versionInfo && versionInfo.allVersions && versionInfo.allVersions.length > 0;
  const isLatestVersion = versionInfo?.isLatestVersion ?? false;

  // ============ 图片附件相关派生状态（Spec: enhance-conversation-image-bubble） ============
  const imageAttachment = message.imageAttachment;
  const isImageGenerating = imageAttachment?.status === 'generating';
  const isImageError = imageAttachment?.status === 'error';
  const history = imageAttachment?.history || [];
  const currentIndex = imageAttachment?.currentIndex ?? 0;
  const hasHistory = history.length > 1;
  // 【Spec: enhance-conversation-image-auditability / Task 5.2】当前历史项（用于展示 usedTags / usedPrompt 等快照）
  const currentHistoryItem = imageAttachment?.history?.[imageAttachment.currentIndex];

  // 【Spec: enhance-conversation-image-auditability / Task 5.4】历史导航切换时自动折叠标签面板与 Prompt 面板
  useEffect(() => {
    setTagsPanelExpanded(false);
    setPromptPanelExpanded(false);
  }, [imageAttachment?.currentIndex]);

  // 阶段状态文案映射（SubTask 5.1）
  const phaseText = useMemo(() => {
    switch (imageAttachment?.phase) {
      case 'tag-generating':
        return '标签生成中…';
      case 'tag-auditing':
        return '标签审核中…';
      case 'image-generating':
        return '图片生成中…';
      default:
        return '处理中…';
    }
  }, [imageAttachment?.phase]);

  // 父气泡左侧立绘解析（SubTask 11.2 / Spec: enhance-conversation-image-bubble）
  // 优先使用 imageAttachment.emotion 通过 resolveExpressionImage 解析；
  // 回退到父消息 message.emotion；再回退到外层 expressionImage prop（由 CharacterDialogueChat 透传）
  const effectiveExpressionImage = useMemo(() => {
    if (!isUser && resolveExpressionImage) {
      const emotion = imageAttachment?.emotion || message.emotion;
      if (emotion) {
        const resolved = resolveExpressionImage(emotion);
        if (resolved) return resolved;
      }
    }
    return expressionImage;
  }, [isUser, resolveExpressionImage, imageAttachment?.emotion, message.emotion, expressionImage]);

  // 删除按钮点击处理（SubTask 6.1, 6.2, 6.3）
  const handleDeleteClick = () => {
    Modal.confirm({
      title: '删除图片',
      content: '确定删除此图片？将同时删除磁盘文件和生成历史，不可恢复。',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => onDeleteImage?.(message.id),
    });
  };

  // 重新生成处理（SubTask 8.2）
  const handleRegenerate = () => {
    onRegenerateImage?.(message.id);
  };

  // 错误状态重试（SubTask 5.2）— 复用重新生成回调
  const handleRetryImage = () => {
    onRegenerateImage?.(message.id);
  };

  // 历史导航处理（SubTask 7.3）
  const handleNavigate = (direction: 'prev' | 'next') => {
    onNavigateImage?.(message.id, direction);
  };

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

  const isImageMsg = !!message.isImageMessage;

  const showFullActions = !isUser && (isLatestVersion || !hasVersionInfo) && message.status === 'sent' && !isImageMsg;

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

      {!isImageMsg && (
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
      )}

      {/* 图片生成按钮：仅当无 imageAttachment 时显示（Spec: enhance-conversation-image-bubble / SubTask 8.4），
          有图片时由图片区域的「重新生成」按钮接管 */}
      {!message.imageAttachment && (
        <Tooltip title={imageGenEnabled === false ? '图片生成功能未开启' : '生成图片'}>
          <button
            onClick={() => onGenerateImage?.(message.id)}
            disabled={imageGenEnabled === false || isGeneratingImage || isStreaming || isGenerating || message.status === 'error'}
            className="chat-action-btn"
          >
            {isGeneratingImage ? (
              <LoadingOutlined style={{ fontSize: '12px' }} spin />
            ) : (
              <PictureOutlined />
            )}
          </button>
        </Tooltip>
      )}

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
        {effectiveExpressionImage && !isUser ? (
          <div className="chat-msg-expression">
            <img src={effectiveExpressionImage} alt={characterName} />
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
            {isUser ? userName : characterName}
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
                  userName={userName}
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
                  userName={userName}
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

                {/* ============ 图片附属区域（Spec: enhance-conversation-image-bubble / Task 4-8） ============
                    新格式：message.imageAttachment 存在时渲染嵌套图片区域（文本下方、同一气泡内）
                    支持阶段状态占位、错误状态、图片显示、历史导航、删除、重新生成
                */}
                {message.imageAttachment && (
                  <div className="chat-msg-image-attachment">
                    {isImageGenerating ? (
                      // 生成中：阶段状态占位（SubTask 5.1）
                      <div className="chat-msg-image-placeholder">
                        <LoadingOutlined spin />
                        <span className="chat-msg-image-phase-text">{phaseText}</span>
                      </div>
                    ) : isImageError ? (
                      // 错误状态：显示错误信息 + 重试按钮（SubTask 5.2）
                      <div className="chat-msg-image-placeholder chat-msg-image-error">
                        <WarningOutlined />
                        <span>{message.imageAttachment.errorMessage || '生成失败'}</span>
                        <button
                          className="chat-msg-image-retry-btn"
                          onClick={handleRetryImage}
                        >
                          重试
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* 图片显示区 + 左右导航（SubTask 7.1, 7.4） */}
                        <div className="chat-msg-image-display-row">
                          {hasHistory && (
                            <button
                              className="chat-msg-image-nav prev"
                              disabled={currentIndex === 0}
                              onClick={() => handleNavigate('prev')}
                              aria-label="上一张"
                            >
                              <LeftOutlined />
                            </button>
                          )}
                          <div className="chat-msg-image-display">
                            {loadedImageUrl ? (
                              <img src={loadedImageUrl} alt="生成图片" />
                            ) : (
                              <span className="chat-msg-image-loading-text">加载中...</span>
                            )}
                          </div>
                          {hasHistory && (
                            <button
                              className="chat-msg-image-nav next"
                              disabled={currentIndex === history.length - 1}
                              onClick={() => handleNavigate('next')}
                              aria-label="下一张"
                            >
                              <RightOutlined />
                            </button>
                          )}
                        </div>
                        {/* 计数 + 操作按钮（SubTask 7.2, 8.1, 8.3, 6.1, 6.3） */}
                        <div className="chat-msg-image-actions">
                          {hasHistory && (
                            <span className="chat-msg-image-counter">
                              {currentIndex + 1} / {history.length}
                            </span>
                          )}
                          <Tooltip title="重新生成">
                            <button
                              className="chat-msg-image-action-btn"
                              onClick={handleRegenerate}
                              disabled={isImageGenerating}
                              aria-label="重新生成"
                            >
                              {isImageGenerating ? <LoadingOutlined /> : <ReloadOutlined />}
                            </button>
                          </Tooltip>
                          <Tooltip title="删除图片">
                            <button
                              className="chat-msg-image-action-btn"
                              onClick={handleDeleteClick}
                              disabled={isImageGenerating}
                              aria-label="删除图片"
                            >
                              <DeleteOutlined />
                            </button>
                          </Tooltip>
                        </div>
                        {/* 【Spec: enhance-conversation-image-auditability / Task 5.1】图片下方标签展示面板
                            仅在 idle 状态渲染；旧数据（无 usedTags）显示「此历史版本无标签快照」提示 */}
                        {message.imageAttachment?.status === 'idle' && currentHistoryItem && (
                          currentHistoryItem.usedTags ? (
                            <div className="chat-msg-image-tags-panel">
                              <button
                                type="button"
                                className="chat-msg-image-tags-panel-header"
                                onClick={() => setTagsPanelExpanded(!tagsPanelExpanded)}
                              >
                                {tagsPanelExpanded ? <DownOutlined /> : <RightOutlined />}
                                <span>查看本次生成标签</span>
                                <Tag className="chat-msg-image-tags-count">{currentHistoryItem.usedTags.length} tags</Tag>
                                {/* 【Spec: add-ai-trait-optimization-for-image-gen / 反馈可见性修复】
                                    AI 优化徽标：面板折叠时也可见，让用户知道本次生成执行了 AI 优化。
                                    三态：success(已移除 N)/no-removal(已分析)/failed(失败)，点击展开查看详情。 */}
                                {currentHistoryItem.aiOptimization && (
                                  <Tag className={`chat-msg-image-ai-badge chat-msg-image-ai-badge-${currentHistoryItem.aiOptimization.status}`}>
                                    {currentHistoryItem.aiOptimization.status === 'success'
                                      ? currentHistoryItem.aiOptimization.addedCount > 0
                                        ? `AI 已移除 ${currentHistoryItem.aiOptimization.removedCount} / 已补充 ${currentHistoryItem.aiOptimization.addedCount}`
                                        : `AI 已移除 ${currentHistoryItem.aiOptimization.removedCount}`
                                      : currentHistoryItem.aiOptimization.status === 'no-removal'
                                        ? 'AI 已分析'
                                        : 'AI 失败'}
                                  </Tag>
                                )}
                              </button>
                              {tagsPanelExpanded && (
                                <div className="chat-msg-image-tags-panel-body">
                                  <div className="chat-msg-image-tags">
                                    {currentHistoryItem.usedTags.map((t, i) => (
                                      <Tag key={i} className="chat-msg-image-tag">
                                        {t.text}
                                        {t.weight !== undefined && t.weight !== 1.0 && (
                                          <span className="chat-msg-image-tag-weight">:{t.weight}</span>
                                        )}
                                      </Tag>
                                    ))}
                                  </div>
                                  {/* 【Spec: add-ai-trait-optimization-for-image-gen / 反馈可见性修复】
                                      AI 优化分区：只要本次生成启用了 ai_optimize_traits 就渲染（基于 aiOptimization 元数据），
                                      不再仅依赖 removedTags.length>0。三态分别给出明确反馈：
                                      - success：展示被删除标签列表（灰色+删除线+悬停原因）
                                      - no-removal：提示「AI 已分析，本次无需移除标签」
                                      - failed：提示失败原因（红色），帮助用户诊断（如 API 未配置/超时） */}
                                  {currentHistoryItem.aiOptimization && (
                                    <div className={`chat-msg-image-ai-optimization chat-msg-image-ai-optimization-${currentHistoryItem.aiOptimization.status}`}>
                                      {currentHistoryItem.aiOptimization.status === 'success' ? (
                                        <>
                                          {/* 【Spec: add-ai-tag-supplement-after-removal / Task 4】
                                              success 分支同时支持「已移除」与「已补充」两类标签：
                                              - removedTags、addedTags 各自独立条件渲染（可能只有其一，也可能两者都有）
                                              - 仅补充不删除的场景也能正确展示 */}
                                          {currentHistoryItem.removedTags && currentHistoryItem.removedTags.length > 0 && (
                                            <>
                                              <span className="chat-msg-image-removed-tags-label">
                                                AI 已移除（{currentHistoryItem.aiOptimization.removedCount} 个）：
                                              </span>
                                              <div className="chat-msg-image-removed-tags-list">
                                                {currentHistoryItem.removedTags.map((t, i) => (
                                                  <Tooltip
                                                    key={i}
                                                    title={t.reason ? `AI 删除原因：${t.reason}` : 'AI 根据对话上下文判断此标签不再适用'}
                                                  >
                                                    <Tag className="chat-msg-image-removed-tag">
                                                      {t.text}
                                                    </Tag>
                                                  </Tooltip>
                                                ))}
                                              </div>
                                            </>
                                          )}
                                          {/* 【Spec: add-ai-tag-supplement-after-removal / Task 4】AI 已补充分区（新增） */}
                                          {currentHistoryItem.addedTags && currentHistoryItem.addedTags.length > 0 && (
                                            <>
                                              <span className="chat-msg-image-added-tags-label">
                                                AI 已补充（{currentHistoryItem.aiOptimization.addedCount} 个）：
                                              </span>
                                              <div className="chat-msg-image-added-tags-list">
                                                {currentHistoryItem.addedTags.map((t, i) => (
                                                  <Tooltip
                                                    key={i}
                                                    title={t.reason ? `AI 补充原因：${t.reason}` : 'AI 根据对话上下文判断需要补充此标签'}
                                                  >
                                                    <Tag className="chat-msg-image-added-tag">
                                                      {t.text}
                                                    </Tag>
                                                  </Tooltip>
                                                ))}
                                              </div>
                                            </>
                                          )}
                                        </>
                                      ) : currentHistoryItem.aiOptimization.status === 'no-removal' ? (
                                        <span className="chat-msg-image-ai-optimization-info">
                                          <CheckCircleOutlined /> AI 已分析对话上下文，本次无需移除标签
                                        </span>
                                      ) : (
                                        <Tooltip
                                          title={currentHistoryItem.aiOptimization.error || '未知错误'}
                                        >
                                          <span className="chat-msg-image-ai-optimization-error">
                                            <WarningOutlined /> AI 标签优化失败：{currentHistoryItem.aiOptimization.error || '未知错误'}
                                          </span>
                                        </Tooltip>
                                      )}
                                    </div>
                                  )}
                                  {/* 二级折叠：完整 Prompt（SubTask 5.2） */}
                                  <button
                                    type="button"
                                    className="chat-msg-image-prompt-toggle"
                                    onClick={() => setPromptPanelExpanded(!promptPanelExpanded)}
                                  >
                                    {promptPanelExpanded ? <DownOutlined /> : <RightOutlined />}
                                    <span>查看完整 Prompt</span>
                                  </button>
                                  {promptPanelExpanded && (
                                    <div className="chat-msg-image-prompt-block">
                                      <div className="chat-msg-image-prompt-label">Prompt:</div>
                                      <pre className="chat-msg-image-prompt">{currentHistoryItem.usedPrompt || '(无)'}</pre>
                                      {currentHistoryItem.usedNegativePrompt && (
                                        <>
                                          <div className="chat-msg-image-prompt-label">Negative Prompt:</div>
                                          <pre className="chat-msg-image-prompt">{currentHistoryItem.usedNegativePrompt}</pre>
                                        </>
                                      )}
                                      {currentHistoryItem.usedLoras && currentHistoryItem.usedLoras.length > 0 && (
                                        <>
                                          <div className="chat-msg-image-prompt-label">LoRAs:</div>
                                          <div className="chat-msg-image-loras">
                                            {currentHistoryItem.usedLoras.map((l, i) => (
                                              <Tag key={i}>{l.name}:{l.weight}</Tag>
                                            ))}
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="chat-msg-image-tags-panel chat-msg-image-tags-empty">
                              <span>此历史版本无标签快照</span>
                            </div>
                          )
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* ============ 旧格式兜底（SubTask 4.3） ============
                    独立图片消息（isImageMessage + generatedImage 但无 imageAttachment），
                    迁移后不应出现，保留兜底避免白屏
                */}
                {!message.imageAttachment && message.isImageMessage && message.generatedImage && (
                  <div className="chat-msg-image-container">
                    {loadedImageUrl ? (
                      <img
                        src={loadedImageUrl}
                        alt="生成图片"
                        className="chat-msg-generated-image"
                      />
                    ) : (
                      <div style={{ padding: '20px', color: '#94a3b8', fontSize: '13px' }}>加载图片中...</div>
                    )}
                    <span className="chat-msg-image-label">生成图片</span>
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
