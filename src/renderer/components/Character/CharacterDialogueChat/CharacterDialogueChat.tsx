import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Modal, message, Tooltip, Button, Popconfirm } from 'antd';
import { DownloadOutlined, CopyOutlined, FullscreenExitOutlined } from '@ant-design/icons';
import ChatHeader from './ChatHeader';
import ChatMessageBubble from './ChatMessageBubble';
import ChatInputBar from './ChatInputBar';
import ChatTypingIndicator from './ChatTypingIndicator';
import { VirtualizedMessageList, shouldVirtualize } from './VirtualizedMessageList';
import ConfigPanel from './ConfigPanel';
import CharacterSelectorPanel from './CharacterSelectorPanel';
import AssetManagerModal from './AssetManagerModal';
import { useCharacterDialogueChat } from './CharacterDialogueChat.hooks';
import { useFavoritesStore } from '../../../stores/favoritesStore';
import { useExpressionStore } from '../../../stores/expressionStore';
import { exportConversation } from './CharacterDialogueChat.utils';
import { CharacterInfo, AIParameterConfig } from './CharacterDialogueChat.types';
import { getDefaultEngineCapabilities } from '../../Common/ChatEngine/ChatEngine.types';
import './CharacterDialogueChat.css';

interface CharacterSelectorItem {
  name: string;
  path: string;
  size: number;
  modified: Date;
  characterName?: string;
  version?: string;
  creator?: string;
  tags?: string[];
  cardVersion?: 'v1' | 'v2' | 'v3';
}

interface CharacterDialogueChatProps {
  characterInfo: CharacterInfo;
  open: boolean;
  onClose: () => void;
  avatarPath?: string;
  characters?: CharacterSelectorItem[];
  onCharacterSelect?: (character: CharacterSelectorItem) => void;
}

const EXPORT_MENU_ITEMS = [
  { key: 'copy', label: '复制到剪贴板' },
  { key: 'save', label: '保存为文件' },
];

const CharacterDialogueChat: React.FC<CharacterDialogueChatProps> = ({
  characterInfo,
  open,
  onClose,
  avatarPath,
  characters,
  onCharacterSelect,
}) => {
  const {
    state,
    stateWithVersionInfo,
    sendMessage,
    continueConversation,
    generateUserReply,
    isGeneratingUserReply,
    polishInput,
    isPolishingInput,
    retryMessage,
    retryMessageFromVersion,
    editMessage,
    rollbackToMessage,
    clearChat,
    clearError,
    cancelRequest,
    selectedPersona,
    personas,
    personasLoading,
    characterConfig,
    updateConfig,
    saveConfig,
    resetParameters,
    getEffectiveParams,
    bindKnowledgeBase,
    unbindKnowledgeBase,
    memoryTableEnabled,
    memoryTableAutoOrganize,
    memoryTableOrganizeMode,
    memoryTableTemplateId,
    memoryTableTemplateName,
    isOrganizing,
    fetchMemoryTableData,
    handleMemoryTableToggle,
    handleMemoryTableAutoOrganizeToggle,
    handleMemoryTableOrganizeModeChange,
    handleMemoryTableTemplateAssociate,
    tokenManagementConfig,
    handleTokenManagementConfigChange,
    handleStopOrganizing,
    getActiveEngineConfig,
  } = useCharacterDialogueChat(characterInfo);
  
  const { toggleFavorite, isFavorite, getFavoritePaths } = useFavoritesStore();
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [generatedReplyText, setGeneratedReplyText] = useState('');
  const [polishFlashKey, setPolishFlashKey] = useState(0);
  const [expressionManagerOpen, setExpressionManagerOpen] = useState(false);
  const favoritePaths = getFavoritePaths();

  // 表情系统订阅（Spec: add-character-expression-system / Task 10.3 + 12.1）
  // resolveExpressionImage：emotionKey → 表情图像路径解析器（store 内通过 get() 读取 imageCache）
  // imageCache：作为订阅依赖，缓存变化时触发消息列表重渲染，确保加载完成后表情图像立即生效
  // loadExpressions：进入对话时预加载该角色卡所有已上传表情
  const resolveExpressionImage = useExpressionStore((s) => s.resolveExpressionImage);
  const imageCache = useExpressionStore((s) => s.imageCache);
  const loadExpressions = useExpressionStore((s) => s.loadExpressions);

  // 表情显示开关（Spec: Task 11.4 + 12.1）
  const expressionDisplay = characterConfig?.customParameters?.expression_display === true;

  useEffect(() => {
    if (stateWithVersionInfo.messages.length > 0 || stateWithVersionInfo.isStreaming) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [stateWithVersionInfo.messages, stateWithVersionInfo.isStreaming]);

  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isFullscreen]);

  // 预加载当前角色卡的表情包（Spec: add-character-expression-system / Task 12.1）
  // 触发条件：开启表情显示 + characterCardId 变化（含首次加载）
  // 加载完成后 imageCache 引用变化，触发下方 no-op effect 与消息列表重渲染
  useEffect(() => {
    if (expressionDisplay && characterInfo.characterCardId) {
      loadExpressions(characterInfo.characterCardId);
    }
  }, [expressionDisplay, characterInfo.characterCardId, loadExpressions]);

  // 订阅 imageCache 引用变化以触发消息列表重渲染（Spec: Task 10.3）
  // resolveExpressionImage 通过 zustand get() 读取最新缓存，但需要订阅引用变化
  // 确保表情加载/更新完成后气泡头像立即切换
  useEffect(() => {
    // no-op: 仅订阅 imageCache 引用变化
  }, [imageCache]);

  const effectiveParams = useMemo(() => {
    return getEffectiveParams();
  }, [getEffectiveParams]);

  // 后端能力探测（Spec: optimize-chat-ai-intelligence / Task 6.1 / 6.4）
  // 优先使用引擎显式 capabilities 配置，缺省时按 api_mode 推断默认值。
  // 透传给 ParameterPanel 决定 repetition_penalty 滑块与 DRY 采样折叠区的显隐。
  const engineCapabilities = useMemo(() => {
    const activeEngine = getActiveEngineConfig();
    if (!activeEngine) return undefined;
    return activeEngine.capabilities || getDefaultEngineCapabilities(activeEngine.api_mode);
  }, [getActiveEngineConfig]);

  const handleScroll = useCallback(() => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight > 200;
      setShowScrollButton(isNearBottom);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleSaveExport = useCallback(async (content: string) => {
    try {
      const dir = await window.electronAPI.file.selectDirectory();
      if (!dir) return;
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const fileName = `${characterInfo.characterCardName}_对话_${stamp}.md`;
      const sep = dir.endsWith('/') || dir.endsWith('\\') ? '' : (dir.includes('\\') ? '\\' : '/');
      const fullPath = `${dir}${sep}${fileName}`;
      const result = await window.electronAPI.file.write(fullPath, content);
      if (result.success) {
        message.success('对话已保存');
      } else {
        message.error(result.error || '保存失败');
      }
    } catch {
      message.error('保存失败');
    }
  }, [characterInfo.characterCardName]);

  const handleExportMenuClick = useCallback((key: string) => {
    if (stateWithVersionInfo.messages.length === 0) {
      message.warning('暂无消息可导出');
      return;
    }
    const content = exportConversation(stateWithVersionInfo.messages, characterInfo.characterCardName);
    if (key === 'copy') {
      navigator.clipboard.writeText(content).then(
        () => message.success('已复制到剪贴板'),
        () => message.error('复制失败')
      );
    } else if (key === 'save') {
      handleSaveExport(content);
    }
  }, [stateWithVersionInfo.messages, characterInfo.characterCardName, handleSaveExport]);

  const handleClearChat = useCallback(() => {
    clearChat();
  }, [clearChat]);

  const handleContinueConversation = useCallback(() => {
    continueConversation();
  }, [continueConversation]);

  const handlePersonaChange = useCallback((personaId: string) => {
    updateConfig({ selectedPersonaId: personaId });
  }, [updateConfig]);

  const handleParameterChange = useCallback((params: Partial<AIParameterConfig>) => {
    updateConfig((prev: any) => {
      const mergedCustomParams = { ...(prev?.customParameters || {}), ...params };
      return { customParameters: mergedCustomParams };
    });
  }, [updateConfig]);

  const handleResetParameters = useCallback(() => {
    resetParameters();
  }, [resetParameters]);

  // 自定义停止序列处理（Spec: optimize-chat-ai-intelligence / Task 3.4）
  // 持久化到 character-session-<cardId> localStorage 的 customStopSequencesEnabled / customStopSequences 字段
  const handleCustomStopSequencesToggle = useCallback((enabled: boolean) => {
    updateConfig({ customStopSequencesEnabled: enabled });
  }, [updateConfig]);

  const handleCustomStopSequencesChange = useCallback((stops: string[]) => {
    updateConfig({ customStopSequences: stops });
  }, [updateConfig]);

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(characterInfo.characterCardId);
  }, [toggleFavorite, characterInfo.characterCardId]);

  const handleCharacterSelectWithFavorite = useCallback((character: CharacterSelectorItem) => {
    onCharacterSelect?.(character);
  }, [onCharacterSelect]);

  const handleQuickSwitchCharacter = useCallback((path: string) => {
    const target = characters?.find(c => c.path === path);
    if (target) {
      onCharacterSelect?.(target);
    }
  }, [characters, onCharacterSelect]);

  // AI 用户回复生成回调（Spec: add-ai-user-reply-button / Task 4.3）
  // 调用 hook 的 generateUserReply，成功后暂存文本到 generatedReplyText，由 ChatInputBar 通过 prop 消费
  // currentInput: 输入框中的内容，作为用户指令引导 AI 生成回复（可选，为空时保持原有行为）
  const handleGenerateUserReply = useCallback(async (currentInput?: string) => {
    try {
      const text = await generateUserReply(currentInput);
      if (text && text.length > 0) {
        setGeneratedReplyText(text);
      }
    } catch (error) {
      // 错误已在 hook 内通过 message.error 处理，此处无需重复
      console.error('[CharacterDialogueChat] handleGenerateUserReply error:', error);
    }
  }, [generateUserReply]);

  // ChatInputBar 消费完 generatedReplyText 后回调清空暂存（Spec: add-ai-user-reply-button / Task 4.4）
  const handleGeneratedReplyTextConsumed = useCallback(() => {
    setGeneratedReplyText('');
  }, []);

  // 辅助模式：点击推荐选项，填入输入框（Spec: add-assist-mode-options）
  const handleSelectOption = useCallback((optionText: string) => {
    setGeneratedReplyText(optionText);
  }, []);

  // 润色输入回调（Spec: refine-user-input-text / Task 4.3）
  // 调用 hook 的 polishInput 函数，成功时复用 generatedReplyText 机制填充输入框，
  // 并触发 polishFlashKey 变化以播放 textarea 边框高亮动画
  const handlePolishInput = useCallback(async (text: string) => {
    try {
      const polishedText = await polishInput(text);
      if (polishedText) {
        // 复用 generatedReplyText 机制填充输入框（与 AI回复 按钮共享）
        setGeneratedReplyText(polishedText);
        // 触发 textarea 边框青色高亮动画
        setPolishFlashKey(k => k + 1);
        message.success('已润色');
      }
    } catch {
      // hook 内 message.error 已处理错误提示，此处无需重复
    }
  }, [polishInput]);

  // 用户消息卷回回调（Spec: rollback-user-message / Task 3.2）
  // 调用 hook 的 rollbackToMessage，成功后通过 generatedReplyText 机制填入输入框
  const handleRollback = useCallback((messageId: string) => {
    const content = rollbackToMessage(messageId);
    if (content) {
      setGeneratedReplyText(content);
      message.success('已卷回到输入框');
    } else {
      message.warning('卷回失败：未找到目标消息');
    }
  }, [rollbackToMessage]);

  // 人称选择器切换回调（Spec: add-person-attribute-to-ai-reply / Task 4.1）
  // 持久化到 character-session-<cardId> localStorage 的 userReplyPerson 字段
  const handleUserReplyPersonChange = useCallback((person: 'first' | 'second' | 'third') => {
    updateConfig({ userReplyPerson: person });
  }, [updateConfig]);

  if (!open && !isFullscreen) return null;

  const fullscreenStyles = isFullscreen ? {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100vw',
    height: '100vh',
    zIndex: 9999,
    margin: 0,
    borderRadius: 0,
  } : {};

  const showSelectorPanel = characters && characters.length > 0 && onCharacterSelect;

  return (
    <Modal
      open={open && !isFullscreen}
      onCancel={onClose}
      footer={null}
      width={isFullscreen ? '100vw' : (showSelectorPanel ? 1800 : 1600)}
      centered={!isFullscreen}
      closable={false}
      styles={{
        body: {
          padding: 0,
          height: isFullscreen ? '100vh' : '85vh',
          minHeight: '600px',
          display: 'flex',
          flexDirection: 'row',
          borderRadius: isFullscreen ? 0 : '16px',
          overflow: 'hidden',
          background: 'var(--chat-dialog-bg-gradient, linear-gradient(135deg, #1e1e2e 0%, #2d2b42 50%, #1e1e2e 100%))',
          transition: 'background 0.3s ease',
          ...fullscreenStyles,
        },
        mask: {
          backdropFilter: 'blur(8px)',
          background: 'rgba(0, 0, 0, 0.6)',
        },
        header: {
          padding: 0,
        },
        wrapper: isFullscreen ? { padding: 0, maxWidth: '100%' } : {},
      }}
    >

      {showSelectorPanel && (
        <CharacterSelectorPanel
          characters={characters}
          selectedCharacterPath={characterInfo.characterCardId}
          onSelect={handleCharacterSelectWithFavorite}
          favoritePaths={favoritePaths}
          onToggleFavorite={toggleFavorite}
        />
      )}

      <div className="chat-area" style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        maxWidth: isFullscreen ? (showSelectorPanel ? '65%' : '70%') : undefined,
        position: 'relative',
        overflow: 'hidden',
      }}>
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
          onClear={handleClearChat}
          onClose={isFullscreen ? handleToggleFullscreen : onClose}
          exportMenu={EXPORT_MENU_ITEMS}
          onExportMenuClick={handleExportMenuClick}
          characters={characters}
          onQuickSwitchCharacter={handleQuickSwitchCharacter}
          avatarPath={avatarPath}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
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

          {(() => {
            // Task 19 P6: 消息数超过阈值时启用虚拟化，否则走原 .map() 路径
            const renderMessageBubble = (msg: any, index: number) => {
              // 计算 AI 回复序号：在当前消息之前所有 role=assistant 的消息数量 + 1
              const aiSequenceNumber = msg.role === 'assistant'
                ? stateWithVersionInfo.messages.slice(0, index).filter(m => m.role === 'assistant').length + 1
                : 0;
              return (
                <ChatMessageBubble
                  key={msg.id}
                  message={msg}
                  characterName={characterInfo.characterCardName}
                  avatarPath={avatarPath}
                  expressionImage={
                    msg.role === 'assistant' && msg.emotion &&
                    !(stateWithVersionInfo.isStreaming && index === stateWithVersionInfo.messages.length - 1)
                      ? resolveExpressionImage(msg.emotion) ?? undefined
                      : undefined
                  }
                  onRetry={retryMessage}
                  onRetryFromVersion={retryMessageFromVersion}
                  onContinue={handleContinueConversation}
                  onEdit={editMessage}
                  onRollback={handleRollback}
                  isLastMessage={index === stateWithVersionInfo.messages.length - 1}
                  isStreaming={stateWithVersionInfo.isStreaming && index === stateWithVersionInfo.messages.length - 1 && msg.role === 'assistant'}
                  isGenerating={stateWithVersionInfo.isLoading && index === stateWithVersionInfo.messages.length - 1 && msg.role === 'assistant' && msg.status === 'sending'}
                  onSelectOption={handleSelectOption}
                  aiSequenceNumber={aiSequenceNumber}
                />
              );
            };

            if (shouldVirtualize(stateWithVersionInfo.messages.length)) {
              return (
                <VirtualizedMessageList
                  items={stateWithVersionInfo.messages}
                  scrollElementRef={chatContainerRef}
                  renderItem={renderMessageBubble}
                />
              );
            }
            return stateWithVersionInfo.messages.map((msg, index) => renderMessageBubble(msg, index));
          })()}

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
                          clearError();
                          retryMessage(lastAssistantMsg.id);
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
                          clearError();
                          sendMessage(lastUserMsg.content);
                        }}
                      >
                        重试
                      </Button>
                    );
                  }
                  return null;
                })()}
                {/* Task 21: 错误恢复 UI —— 关闭错误提示 */}
                <Button size="small" onClick={clearError}>关闭</Button>
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

        {isOrganizing && (
          <div style={{
            padding: '8px 16px',
            background: 'var(--chat-organizing-bg, linear-gradient(135deg, rgba(251, 191, 36, 0.1) 0%, rgba(245, 158, 11, 0.1) 100%))',
            borderBottom: '1px solid var(--chat-organizing-border, rgba(251, 191, 36, 0.3))',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            color: 'var(--chat-organizing-color, #fbbf24)',
          }}>
            <span style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--chat-organizing-dot, #fbbf24)',
              animation: 'pulse 1.5s infinite',
            }} />
            <span>正在整理记忆表格，请稍候...</span>
          </div>
        )}

        <ChatInputBar
          onSend={sendMessage}
          onCancel={cancelRequest}
          onStopOrganizing={handleStopOrganizing}
          disabled={isOrganizing}
          isStreaming={state.isStreaming}
          isOrganizing={isOrganizing}
          placeholder={isOrganizing ? '表格整理中，请稍后...' : `Message ${characterInfo.characterCardName}...`}
          onGenerateUserReply={handleGenerateUserReply}
          isGeneratingUserReply={isGeneratingUserReply}
          generatedReplyText={generatedReplyText}
          onGeneratedReplyTextConsumed={handleGeneratedReplyTextConsumed}
          userReplyPerson={characterConfig?.userReplyPerson}
          onUserReplyPersonChange={handleUserReplyPersonChange}
          onPolishInput={handlePolishInput}
          isPolishingInput={isPolishingInput}
          polishFlashKey={polishFlashKey}
        />
      </div>

      <ConfigPanel
        characterCardId={characterInfo.characterCardId}
        characterCardName={characterInfo.characterCardName}
        selectedPersonaId={characterConfig?.selectedPersonaId}
        effectiveParams={effectiveParams}
        customParameters={characterConfig?.customParameters}
        personas={personas}
        personasLoading={personasLoading}
        boundKnowledgeBaseIds={characterConfig?.boundKnowledgeBaseIds || []}
        memoryTableEnabled={memoryTableEnabled}
        memoryTableAutoOrganize={memoryTableAutoOrganize}
        memoryTableOrganizeMode={memoryTableOrganizeMode}
        memoryTableTemplateId={memoryTableTemplateId}
        memoryTableTemplateName={memoryTableTemplateName}
        tokenManagementConfig={tokenManagementConfig}
        customStopSequencesEnabled={characterConfig?.customStopSequencesEnabled ?? false}
        customStopSequences={characterConfig?.customStopSequences}
        expressionDisplay={expressionDisplay}
        onExpressionDisplayToggle={(enabled) => handleParameterChange({ expression_display: enabled })}
        stripThinkTags={characterConfig?.customParameters?.strip_think_tags !== false}
        onStripThinkTagsToggle={(enabled) => handleParameterChange({ strip_think_tags: enabled })}
        assistMode={characterConfig?.customParameters?.assist_mode === true}
        onAssistModeToggle={(enabled) => handleParameterChange({ assist_mode: enabled })}
        language={characterConfig?.customParameters?.language ?? 'zh'}
        onLanguageChange={(lang) => handleParameterChange({ language: lang })}
        engineCapabilities={engineCapabilities}
        onPersonaChange={handlePersonaChange}
        onParameterChange={handleParameterChange}
        onResetParameters={handleResetParameters}
        onCustomStopSequencesToggle={handleCustomStopSequencesToggle}
        onCustomStopSequencesChange={handleCustomStopSequencesChange}
        onBindKnowledgeBase={bindKnowledgeBase}
        onUnbindKnowledgeBase={unbindKnowledgeBase}
        onMemoryTableToggle={handleMemoryTableToggle}
        onMemoryTableAutoOrganizeToggle={handleMemoryTableAutoOrganizeToggle}
        onMemoryTableOrganizeModeChange={handleMemoryTableOrganizeModeChange}
        onMemoryTableTemplateAssociate={handleMemoryTableTemplateAssociate}
        onTokenManagementConfigChange={handleTokenManagementConfigChange}
        onSaveConfig={saveConfig}
      />

      {/* 素材管理弹窗（Spec: add-asset-and-trait-management / Task 11） */}
      {/* 【重点标记 - BREAKING UI 变更】原 ExpressionManagerModal 替换为 AssetManagerModal，
          支持表情/立绘/一般图像/三视图/角色特征多 Tab 管理。
          characterDescription 传 characterCardContent（即角色卡 description 字段）。 */}
      <AssetManagerModal
        open={expressionManagerOpen}
        characterCardId={characterInfo.characterCardId}
        characterName={characterInfo.characterCardName}
        characterDescription={characterInfo.characterCardContent || ''}
        characterPersonality={characterInfo.personality}
        characterScenario={characterInfo.scenario}
        avatarPath={avatarPath}
        onClose={() => setExpressionManagerOpen(false)}
      />
    </Modal>
  );
};

export default CharacterDialogueChat;
