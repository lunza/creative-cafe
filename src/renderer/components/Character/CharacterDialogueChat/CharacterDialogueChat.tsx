import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Modal, message, Tooltip, Button, Popconfirm } from 'antd';
import { DownloadOutlined, CopyOutlined, FullscreenExitOutlined } from '@ant-design/icons';
import ChatHeader from './ChatHeader';
import ChatMessageBubble from './ChatMessageBubble';
import ChatInputBar from './ChatInputBar';
import ChatTypingIndicator from './ChatTypingIndicator';
import ConfigPanel from './ConfigPanel';
import { useCharacterDialogueChat } from './CharacterDialogueChat.hooks';
import { exportConversation } from './CharacterDialogueChat.utils';
import { CharacterInfo, AIParameterConfig } from './CharacterDialogueChat.types';

interface CharacterDialogueChatProps {
  characterInfo: CharacterInfo;
  open: boolean;
  onClose: () => void;
  avatarPath?: string;
}

const CharacterDialogueChat: React.FC<CharacterDialogueChatProps> = ({
  characterInfo,
  open,
  onClose,
  avatarPath,
}) => {
  const { 
    state, 
    sendMessage, 
    continueConversation, 
    retryMessage, 
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
  } = useCharacterDialogueChat(characterInfo);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [personasLoading, setPersonasLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (state.messages.length > 0 || state.isStreaming) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [state.messages, state.isStreaming]);

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
    if (state.messages.length === 0) {
      message.warning('No messages to export');
      return;
    }
    const content = exportConversation(state.messages, characterInfo.characterCardName);
    navigator.clipboard.writeText(content).then(
      () => message.success('Conversation exported to clipboard'),
      () => message.error('Failed to export conversation')
    );
  }, [state.messages, characterInfo.characterCardName]);

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

  return (
    <Modal
      open={open && !isFullscreen}
      onCancel={onClose}
      footer={null}
      width={isFullscreen ? '100vw' : 1600}
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
          background: 'linear-gradient(135deg, #1e1e2e 0%, #2d2b42 50%, #1e1e2e 100%)',
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
        }
        .chat-area-bg::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse at 20% 20%, rgba(255, 107, 53, 0.08) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 60%, rgba(74, 144, 217, 0.06) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 90%, rgba(255, 107, 107, 0.05) 0%, transparent 40%),
            linear-gradient(180deg, #0f0f1a 0%, #161625 40%, #1a1a2e 100%);
        }
        .chat-area-bg::after {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse at 70% 30%, rgba(99, 102, 241, 0.06) 0%, transparent 45%),
            radial-gradient(ellipse at 30% 70%, rgba(236, 72, 153, 0.05) 0%, transparent 50%);
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
          background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%);
        }
        .chat-bg-orb:nth-child(2) {
          width: 250px;
          height: 250px;
          bottom: 10%;
          left: -80px;
          background: radial-gradient(circle, rgba(236, 72, 153, 0.1) 0%, transparent 70%);
        }
        .chat-bg-orb:nth-child(3) {
          width: 200px;
          height: 200px;
          top: 40%;
          right: 20%;
          background: radial-gradient(circle, rgba(255, 107, 53, 0.08) 0%, transparent 70%);
        }
        .chat-bg-grid {
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.03) 1px, transparent 0);
          background-size: 32px 32px;
          pointer-events: none;
          z-index: 0;
        }
        .chat-messages::-webkit-scrollbar {
          width: 6px;
        }
        .chat-messages::-webkit-scrollbar-track {
          background: transparent;
        }
        .chat-messages::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }
        .chat-messages::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
        .chat-messages {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
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

      <div className="chat-area" style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        maxWidth: isFullscreen ? '70%' : undefined,
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
          messageCount={state.messages.length}
          onClear={handleClearChat}
          onClose={isFullscreen ? handleToggleFullscreen : onClose}
          onExport={handleExport}
          avatarPath={avatarPath}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
          selectedPersona={selectedPersona}
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
          {state.messages.length === 0 && !state.isStreaming && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--text-secondary, #9ca3af)',
              textAlign: 'center',
            }}>
              <div style={{
                width: isFullscreen ? '120px' : '80px',
                height: isFullscreen ? '120px' : '80px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '24px',
                boxShadow: '0 8px 32px rgba(139, 92, 246, 0.4)',
              }}>
                <span style={{ fontSize: isFullscreen ? '48px' : '36px', color: '#fff', fontWeight: 'bold' }}>
                  {characterInfo.characterCardName.charAt(0).toUpperCase()}
                </span>
              </div>
              <h3 style={{
                margin: '0 0 12px 0',
                fontSize: isFullscreen ? '24px' : '20px',
                fontWeight: 600,
                color: 'var(--text-primary, #e2e8f0)',
              }}>
                Start chatting with {characterInfo.characterCardName}
              </h3>
              <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.6 }}>
                Send a message to begin the conversation.<br />
                The AI will respond based on the character's role settings.
              </p>
            </div>
          )}

          {state.messages.map((msg, index) => (
            <ChatMessageBubble
              key={msg.id}
              message={msg}
              characterName={characterInfo.characterCardName}
              avatarPath={avatarPath}
              onRetry={retryMessage}
              onContinue={handleContinueConversation}
              onEdit={editMessage}
              isLastMessage={index === state.messages.length - 1}
              isStreaming={state.isStreaming && index === state.messages.length - 1 && msg.role === 'assistant'}
              isGenerating={state.isLoading && index === state.messages.length - 1 && msg.role === 'assistant' && msg.status === 'sending'}
            />
          ))}

          {state.isStreaming && state.messages[state.messages.length - 1]?.role === 'user' && (
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
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: '#ef4444',
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
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  border: 'none',
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.4)',
                  animation: 'pulse 2s infinite',
                }}
              />
            </Tooltip>
          )}
        </div>

        <ChatInputBar
          onSend={sendMessage}
          onCancel={cancelRequest}
          disabled={false}
          isStreaming={state.isStreaming}
          placeholder={`Message ${characterInfo.characterCardName}...`}
        />
      </div>

      <ConfigPanel
        characterCardId={characterInfo.characterCardId}
        selectedPersonaId={characterConfig?.selectedPersonaId}
        effectiveParams={effectiveParams}
        customParameters={characterConfig?.customParameters}
        personas={personas}
        personasLoading={personasLoading}
        boundKnowledgeBaseIds={characterConfig?.boundKnowledgeBaseIds || []}
        onPersonaChange={handlePersonaChange}
        onParameterChange={handleParameterChange}
        onResetParameters={handleResetParameters}
        onBindKnowledgeBase={bindKnowledgeBase}
        onUnbindKnowledgeBase={unbindKnowledgeBase}
        onSaveConfig={saveConfig}
      />
    </Modal>
  );
};

export default CharacterDialogueChat;
