/**
 * 【Phase 2 / M1 - conversation-mode-optimization-report】消息区组件（God Component 拆分 U1-1）。
 *
 * 收纳原 CharacterDialogueChat.tsx 中的消息展示区：
 * - 背景装饰层（chat-bg-orb / chat-bg-grid）
 * - ChatHeader（含收藏、表情管理、导出菜单、版本历史入口、角色快切）
 * - 消息滚动容器（空状态 / ChatMessageList / typing 指示 / 错误恢复 / 滚动按钮）
 * - 消息气泡渲染函数（renderMessageBubble，含表情解析与图片生成接线）
 * - M4 配置面板开关 Tab（中屏折叠/窄屏抽屉）
 *
 * 表情系统订阅（resolveExpressionImage / imageCache / loadExpressions）随气泡渲染一并迁入本组件。
 */
import React, { useRef, useEffect, useCallback } from 'react';
import { Tooltip, Button } from 'antd';
import { SettingOutlined, CloseOutlined } from '@ant-design/icons';
import ChatHeader from './ChatHeader';
import ChatMessageBubble from './ChatMessageBubble';
import ChatTypingIndicator from './ChatTypingIndicator';
import ChatActionBar from './ChatActionBar';
import { ChatMessageList } from '../../Common/ChatMessageList/ChatMessageList';
import { useChatUIStore } from './stores/useChatUIStore';
import { useFavoritesStore } from '../../../stores/favoritesStore';
import { useExpressionStore } from '../../../stores/expressionStore';
import { deriveThinkTagMode } from './CharacterDialogueChat.types';
import { EXPORT_MENU_ITEMS } from './useChatExport';
import type { ChatHook } from './CharacterDialogueChat.hooks';
import type { ChatInputActions } from './useChatInputActions';
import type { ChatExportActions } from './useChatExport';
import type { CharacterSelectorItem } from './CharacterDialogueChat.types';
import type { CharacterInfo } from './CharacterDialogueChat.types';

interface ChatMessageAreaProps {
  chat: ChatHook;
  characterInfo: CharacterInfo;
  onClose: () => void;
  avatarPath?: string;
  characters?: CharacterSelectorItem[];
  onCharacterSelect?: (character: CharacterSelectorItem) => void;
  isFullscreen: boolean;
  /** 【Phase 2 / M4】布局档位（调用方派生后传入） */
  activeLayoutMode: 'wide' | 'medium' | 'narrow';
  /** 【Phase 2 / M1】图片生成 hook 返回值（tsx 调用 useImageGeneration 后透传） */
  imageGen: { isGeneratingImage: boolean; handleGenerateImage: (messageId: string) => Promise<void>; handleRegenerateImage: (messageId: string) => Promise<void> };
  inputActions: ChatInputActions;
  exportActions: ChatExportActions;
}

const ChatMessageArea: React.FC<ChatMessageAreaProps> = ({
  chat, characterInfo, onClose, avatarPath, characters, onCharacterSelect,
  isFullscreen, activeLayoutMode, imageGen, inputActions, exportActions,
}) => {
  const { state, stateWithVersionInfo, selectedPersona, characterConfig } = chat;

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const showScrollButton = useChatUIStore(s => s.showScrollButton);
  const setShowScrollButton = useChatUIStore(s => s.setShowScrollButton);
  const toggleFullscreen = useChatUIStore(s => s.toggleFullscreen);
  const setExpressionManagerOpen = useChatUIStore(s => s.setExpressionManagerOpen);
  const setVersionHistoryVisible = useChatUIStore(s => s.setVersionHistoryVisible);
  const configPanelCollapsed = useChatUIStore(s => s.configPanelCollapsed);
  const setConfigPanelCollapsed = useChatUIStore(s => s.setConfigPanelCollapsed);

  const toggleFavorite = useFavoritesStore(s => s.toggleFavorite);
  const isFavorite = useFavoritesStore(s => s.isFavorite);

  // 表情系统订阅（Spec: add-character-expression-system / Task 10.3 + 12.1）
  // resolveExpressionImage：emotionKey → 表情图像路径解析器（store 内通过 get() 读取 imageCache）
  // imageCache：作为订阅依赖，缓存变化时触发消息列表重渲染，确保加载完成后表情图像立即生效
  // loadExpressions：进入对话时预加载该角色卡所有已上传表情
  const resolveExpressionImage = useExpressionStore((s) => s.resolveExpressionImage);
  const imageCache = useExpressionStore((s) => s.imageCache);
  const loadExpressions = useExpressionStore((s) => s.loadExpressions);

  // 预加载当前角色卡的表情包（Spec: add-character-expression-system / Task 12.1）
  // 表情系统默认永久开启，characterCardId 变化时自动加载
  useEffect(() => {
    if (characterInfo.characterCardId) {
      loadExpressions(characterInfo.characterCardId);
    }
  }, [characterInfo.characterCardId, loadExpressions]);

  // 新消息/流式更新时自动滚动到底部
  useEffect(() => {
    if (stateWithVersionInfo.messages.length > 0 || stateWithVersionInfo.isStreaming) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [stateWithVersionInfo.messages, stateWithVersionInfo.isStreaming]);

  // 订阅 imageCache 引用变化以触发消息列表重渲染（Spec: Task 10.3）
  // resolveExpressionImage 通过 zustand get() 读取最新缓存，但需要订阅引用变化
  // 确保表情加载/更新完成后气泡头像立即切换
  useEffect(() => {
    // no-op: 仅订阅 imageCache 引用变化
  }, [imageCache]);

  const handleScroll = useCallback(() => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight > 200;
      setShowScrollButton(isNearBottom);
    }
  }, [setShowScrollButton]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(characterInfo.characterCardId);
  }, [toggleFavorite, characterInfo.characterCardId]);

  const handleQuickSwitchCharacter = useCallback((path: string) => {
    const target = characters?.find(c => c.path === path);
    if (target) {
      onCharacterSelect?.(target);
    }
  }, [characters, onCharacterSelect]);

  const imageGenEnabled = characterConfig?.customParameters?.image_gen_enabled === true;

  // 【Phase 2 / M4】消息区宽度：行内配置区（30%/20%）与选择器面板（15%）挤压下的剩余空间
  const showSelectorPanel = !!characters && characters.length > 0 && !!onCharacterSelect;
  const chatAreaMaxWidth = isFullscreen
    ? showSelectorPanel
      ? '65%'
      : activeLayoutMode === 'medium'
        ? (configPanelCollapsed ? '100%' : '80%')
        : activeLayoutMode === 'narrow'
          ? '100%'
          : '70%'
    : undefined;

  // 消息气泡渲染函数（复用 ChatMessageList 的 renderMessage 回调）
  const renderMessageBubble = (msg: any, index: number) => {
    // 计算 AI 回复序号：在当前消息之前所有 role=assistant 且非图片消息的数量 + 1
    const aiSequenceNumber = msg.role === 'assistant' && !msg.isImageMessage
      ? stateWithVersionInfo.messages.slice(0, index).filter(m => m.role === 'assistant' && !m.isImageMessage).length + 1
      : 0;
    return (
      <ChatMessageBubble
        key={msg.id}
        message={msg}
        characterName={characterInfo.characterCardName}
        userName={selectedPersona?.name || 'User'}
        avatarPath={avatarPath}
        expressionImage={
          msg.role === 'assistant' &&
          !(stateWithVersionInfo.isStreaming && index === stateWithVersionInfo.messages.length - 1)
            ? resolveExpressionImage(msg.emotion || 'default') ?? undefined
            : undefined
        }
        onRetry={chat.retryMessage}
        onRetryFromVersion={chat.retryMessageFromVersion}
        onContinue={() => chat.continueConversation()}
        onEdit={chat.editMessage}
        onRollback={inputActions.handleRollback}
        isLastMessage={index === stateWithVersionInfo.messages.length - 1}
        isStreaming={stateWithVersionInfo.isStreaming && index === stateWithVersionInfo.messages.length - 1 && msg.role === 'assistant'}
        isGenerating={stateWithVersionInfo.isLoading && index === stateWithVersionInfo.messages.length - 1 && msg.role === 'assistant' && msg.status === 'sending'}
        onSelectOption={inputActions.handleSelectOption}
        aiSequenceNumber={aiSequenceNumber}
        showThinking={deriveThinkTagMode(characterConfig?.customParameters) === 'fold'}
        imageGenEnabled={imageGenEnabled}
        isGeneratingImage={imageGen.isGeneratingImage}
        onGenerateImage={imageGen.handleGenerateImage}
        characterCardId={characterInfo.characterCardId}
        // 图片附件管理回调（Spec: enhance-conversation-image-bubble / Task 11.2 接线）
        // - onRegenerateImage：图片区域「重新生成」按钮（Task 9.1 handleRegenerateImage）
        // - onDeleteImage：图片区域「删除」按钮（Task 10.3 deleteImageAttachment）
        // - onNavigateImage：历史导航「上一张/下一张」（Task 10.4 navigateImageHistory）
        // - resolveExpressionImage：按 emotion 解析立绘（Task 11.2 接线）
        //   包装原因：store 签名 (string|null|undefined)=>string|null 与 prop 签名 (string)=>string|undefined 不兼容，
        //   故用 (emotion) => resolveExpressionImage(emotion) ?? undefined 将 null 转为 undefined。
        //   【重点标记 - 反复修复】原实现仅在 message.imageAttachment 存在时传递（条件传递），
        //   导致无图片附件的纯文本 AI 消息无法通过 resolveExpressionImage prop 解析 emotion。
        //   虽有 expressionImage prop 兜底，但始终传递 resolveExpressionImage 更可靠，
        //   确保 ChatMessageBubble 内 effectiveExpressionImage useMemo 可直接调用 store 解析器。
        //   详见 docs/FIX_RECORDS.md §7.26
        onRegenerateImage={imageGen.handleRegenerateImage}
        onDeleteImage={chat.deleteImageAttachment}
        onNavigateImage={chat.navigateImageHistory}
        resolveExpressionImage={(emotion: string) => resolveExpressionImage(emotion) ?? undefined}
      />
    );
  };

  return (
    <div
      className="chat-area"
      data-layout={isFullscreen ? activeLayoutMode : 'wide'}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        maxWidth: chatAreaMaxWidth,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 【Phase 2 / M4】配置面板开关（中屏折叠/窄屏抽屉，仅全屏模式显示） */}
      {isFullscreen && activeLayoutMode !== 'wide' && (
        <button
          className="chat-config-toggle-tab"
          title={configPanelCollapsed ? '展开配置面板' : '收起配置面板'}
          onClick={() => setConfigPanelCollapsed(!configPanelCollapsed)}
        >
          {configPanelCollapsed ? <SettingOutlined /> : <CloseOutlined />}
        </button>
      )}
      <div className="chat-area-bg">
        <div className="chat-bg-orb" />
        <div className="chat-bg-orb" />
        <div className="chat-bg-orb" />
      </div>
      <div className="chat-bg-grid" />
      <ChatHeader
        characterName={characterInfo.characterCardName}
        characterCardContent={characterInfo.characterCardContent}
        messageCount={stateWithVersionInfo.messages.length}
        onClear={() => chat.clearChat()}
        onClose={isFullscreen ? toggleFullscreen : onClose}
        exportMenu={EXPORT_MENU_ITEMS}
        onExportMenuClick={exportActions.handleExportMenuClick}
        onOpenVersionHistory={() => setVersionHistoryVisible(true)}
        characters={characters}
        onQuickSwitchCharacter={handleQuickSwitchCharacter}
        avatarPath={avatarPath}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        selectedPersona={selectedPersona}
        isFavorite={isFavorite(characterInfo.characterCardId)}
        onToggleFavorite={handleToggleFavorite}
        onOpenExpressionManager={() => setExpressionManagerOpen(true)}
      />

      <div
        ref={chatContainerRef}
        className="chat-messages"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: isFullscreen ? '32px 40px' : '20px',
          position: 'relative',
        }}
        onScroll={handleScroll}
      >
        {stateWithVersionInfo.messages.length === 0 && !stateWithVersionInfo.isStreaming && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--chat-empty-text-secondary, #9ca3af)',
            textAlign: 'center',
          }}>
            <div style={{
              width: isFullscreen ? '120px' : '80px',
              height: isFullscreen ? '120px' : '80px',
              borderRadius: '50%',
              background: 'var(--chat-empty-icon-bg, linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '24px',
              boxShadow: 'var(--chat-empty-shadow, 0 8px 32px rgba(139, 92, 246, 0.4))',
            }}>
              <span style={{ fontSize: isFullscreen ? '48px' : '36px', color: '#fff', fontWeight: 'bold' }}>
                {characterInfo.characterCardName.charAt(0).toUpperCase()}
              </span>
            </div>
            <h3 style={{
              margin: '0 0 12px 0',
              fontSize: isFullscreen ? '24px' : '20px',
              fontWeight: 600,
              color: 'var(--chat-empty-text-primary, #1a1a2e)',
            }}>
              开始与 {characterInfo.characterCardName} 对话
            </h3>
            <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.6 }}>
              发送消息开始对话，<br />
              AI 将根据角色设定进行回复。
            </p>
          </div>
        )}

        <ChatMessageList
          mode="character"
          enableVirtualization={true}
          messages={stateWithVersionInfo.messages}
          scrollElementRef={chatContainerRef}
          renderMessage={renderMessageBubble}
        />

        {stateWithVersionInfo.isStreaming && stateWithVersionInfo.messages[stateWithVersionInfo.messages.length - 1]?.role === 'user' && (
          <ChatTypingIndicator
            characterName={characterInfo.characterCardName}
            avatarPath={avatarPath}
          />
        )}

        {state.error && (
          <div style={{
            textAlign: 'center',
            padding: '12px',
            marginBottom: '16px',
            background: 'var(--chat-error-bg, rgba(239, 68, 68, 0.1))',
            border: '1px solid var(--chat-error-border, rgba(239, 68, 68, 0.3))',
            borderRadius: '8px',
            color: 'var(--chat-error-color, #ef4444)',
            fontSize: '13px',
          }}>
            {state.error}
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center', gap: 8 }}>
              {/* Task 21: 错误恢复 UI —— 重试上一条用户消息 */}
              {(() => {
                const lastUserMsg = [...stateWithVersionInfo.messages].reverse().find(m => m.role === 'user');
                const lastAssistantMsg = [...stateWithVersionInfo.messages].reverse().find(m => m.role === 'assistant');
                if (lastAssistantMsg) {
                  return (
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      onClick={() => {
                        chat.clearError();
                        chat.retryMessage(lastAssistantMsg.id);
                      }}
                    >
                      重试
                    </Button>
                  );
                }
                if (lastUserMsg) {
                  return (
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      onClick={() => {
                        chat.clearError();
                        chat.sendMessage(lastUserMsg.content);
                      }}
                    >
                      重试
                    </Button>
                  );
                }
                return null;
              })()}
              {/* Task 21: 错误恢复 UI —— 关闭错误提示 */}
              <Button size="small" onClick={chat.clearError}>关闭</Button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />

        {showScrollButton && (
          <Tooltip title="滚动到底部">
            <Button
              type="primary"
              size="small"
              shape="circle"
              icon={<span style={{ fontSize: '12px' }}>↓</span>}
              onClick={scrollToBottom}
              style={{
                position: 'absolute',
                bottom: '16px',
                right: '16px',
                background: 'var(--chat-bubble-user-bg, linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%))',
                border: 'none',
                boxShadow: 'var(--chat-bubble-user-shadow, 0 4px 12px rgba(99, 102, 241, 0.4))',
                animation: 'pulse 2s infinite',
              }}
            />
          </Tooltip>
        )}
      </div>

      {/* 操作栏（整理横幅 + 输入框 + 快捷操作），必须在 chat-area flex 列内 */}
      <ChatActionBar chat={chat} characterInfo={characterInfo} inputActions={inputActions} exportActions={exportActions} />
    </div>
  );
};

export default ChatMessageArea;
