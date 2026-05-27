import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Modal, message, Tooltip, Button, Popconfirm } from 'antd';
import { DownloadOutlined, CopyOutlined, FullscreenExitOutlined } from '@ant-design/icons';
import ChatHeader from './ChatHeader';
import ChatMessageBubble from './ChatMessageBubble';
import ChatInputBar from './ChatInputBar';
import ChatTypingIndicator from './ChatTypingIndicator';
import ConfigPanel from './ConfigPanel';
import CharacterSelectorPanel from './CharacterSelectorPanel';
import { useCharacterDialogueChat } from './CharacterDialogueChat.hooks';
import { useFavoritesStore } from '../../../stores/favoritesStore';
import { exportConversation } from './CharacterDialogueChat.utils';
import { CharacterInfo, AIParameterConfig } from './CharacterDialogueChat.types';

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
    retryMessage, 
    retryMessageFromVersion,
    editMessage,
    clearChat, 
    cancelRequest,
    selectedPersona,
    personas,
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
  } = useCharacterDialogueChat(characterInfo);
  
  const { toggleFavorite, isFavorite, getFavoritePaths } = useFavoritesStore();
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [personasLoading, setPersonasLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const favoritePaths = getFavoritePaths();

  useEffect(() => {
    if (stateWithVersionInfo.messages.length > 0 || stateWithVersionInfo.isStreaming) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [stateWithVersionInfo.messages, stateWithVersionInfo.isStreaming]);

  useEffect(() => {
    const timer = setTimeout(() => setPersonasLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

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

  const effectiveParams = useMemo(() => {
    return getEffectiveParams();
  }, [getEffectiveParams]);

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

  const handleExport = useCallback(() => {
    if (stateWithVersionInfo.messages.length === 0) {
      message.warning('No messages to export');
      return;
    }
    const content = exportConversation(stateWithVersionInfo.messages, characterInfo.characterCardName);
    navigator.clipboard.writeText(content).then(
      () => message.success('Conversation exported to clipboard'),
      () => message.error('Failed to export conversation')
    );
  }, [stateWithVersionInfo.messages, characterInfo.characterCardName]);

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

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(characterInfo.characterCardId);
  }, [toggleFavorite, characterInfo.characterCardId]);

  const handleCharacterSelectWithFavorite = useCallback((character: CharacterSelectorItem) => {
    onCharacterSelect?.(character);
  }, [onCharacterSelect]);

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
      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .chat-area-bg {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          z-index: 0;
          transition: background 0.3s ease;
        }
        .chat-area-bg::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse at 20% 20%, var(--chat-area-radial-1) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 60%, var(--chat-area-radial-2) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 90%, var(--chat-area-radial-3) 0%, transparent 40%),
            var(--chat-area-bg-gradient);
        }
        .chat-area-bg::after {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse at 70% 30%, var(--chat-area-radial-4) 0%, transparent 45%),
            radial-gradient(ellipse at 30% 70%, var(--chat-area-radial-5) 0%, transparent 50%);
        }
        .chat-bg-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.4;
        }
        .chat-bg-orb:nth-child(1) {
          width: 300px;
          height: 300px;
          top: -100px;
          right: -50px;
          background: radial-gradient(circle, var(--chat-area-radial-1) 0%, transparent 70%);
        }
        .chat-bg-orb:nth-child(2) {
          width: 250px;
          height: 250px;
          bottom: 10%;
          left: -80px;
          background: radial-gradient(circle, var(--chat-area-radial-5) 0%, transparent 70%);
        }
        .chat-bg-orb:nth-child(3) {
          width: 200px;
          height: 200px;
          top: 40%;
          right: 20%;
          background: radial-gradient(circle, var(--chat-area-radial-6) 0%, transparent 70%);
        }
        .chat-bg-grid {
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(circle at 1px 1px, var(--chat-bg-grid-color) 1px, transparent 0);
          background-size: 32px 32px;
          pointer-events: none;
          z-index: 0;
          transition: background-image 0.3s ease;
        }
        .chat-messages::-webkit-scrollbar {
          width: 6px;
        }
        .chat-messages::-webkit-scrollbar-track {
          background: transparent;
        }
        .chat-messages::-webkit-scrollbar-thumb {
          background: var(--chat-scrollbar-thumb);
          border-radius: 3px;
          transition: background 0.3s ease;
        }
        .chat-messages::-webkit-scrollbar-thumb:hover {
          background: var(--chat-scrollbar-thumb-hover);
        }
        .chat-messages {
          scrollbar-width: thin;
          scrollbar-color: var(--chat-scrollbar-thumb) transparent;
        }
        .chat-textarea::-webkit-scrollbar {
          width: 0;
          height: 0;
        }
        .chat-textarea {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
      `}</style>

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
          onExport={handleExport}
          avatarPath={avatarPath}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
          selectedPersona={selectedPersona}
          isFavorite={isFavorite(characterInfo.characterCardId)}
          onToggleFavorite={handleToggleFavorite}
        />

        <div
          ref={chatContainerRef}
          className="chat-messages"
          style={{
            flex: 1,
            overflowY: 'auto',
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
                color: 'var(--chat-empty-text-primary, #e2e8f0)',
              }}>
                Start chatting with {characterInfo.characterCardName}
              </h3>
              <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.6 }}>
                Send a message to begin the conversation.<br />
                The AI will respond based on the character's role settings.
              </p>
            </div>
          )}

          {stateWithVersionInfo.messages.map((msg, index) => (
            <ChatMessageBubble
              key={msg.id}
              message={msg}
              characterName={characterInfo.characterCardName}
              avatarPath={avatarPath}
              onRetry={retryMessage}
              onRetryFromVersion={retryMessageFromVersion}
              onContinue={handleContinueConversation}
              onEdit={editMessage}
              isLastMessage={index === stateWithVersionInfo.messages.length - 1}
              isStreaming={stateWithVersionInfo.isStreaming && index === stateWithVersionInfo.messages.length - 1 && msg.role === 'assistant'}
              isGenerating={stateWithVersionInfo.isLoading && index === stateWithVersionInfo.messages.length - 1 && msg.role === 'assistant' && msg.status === 'sending'}
            />
          ))}

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
            </div>
          )}

          <div ref={messagesEndRef} />

          {showScrollButton && (
            <Tooltip title="Scroll to bottom">
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
        onPersonaChange={handlePersonaChange}
        onParameterChange={handleParameterChange}
        onResetParameters={handleResetParameters}
        onBindKnowledgeBase={bindKnowledgeBase}
        onUnbindKnowledgeBase={unbindKnowledgeBase}
        onMemoryTableToggle={handleMemoryTableToggle}
        onMemoryTableAutoOrganizeToggle={handleMemoryTableAutoOrganizeToggle}
        onMemoryTableOrganizeModeChange={handleMemoryTableOrganizeModeChange}
        onMemoryTableTemplateAssociate={handleMemoryTableTemplateAssociate}
        onTokenManagementConfigChange={handleTokenManagementConfigChange}
        onSaveConfig={saveConfig}
      />
    </Modal>
  );
};

export default CharacterDialogueChat;
