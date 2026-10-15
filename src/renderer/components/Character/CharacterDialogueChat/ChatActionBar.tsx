/**
 * 【Phase 2 / M1 - conversation-mode-optimization-report】操作栏组件（God Component 拆分 U1-2）。
 *
 * 收纳原 CharacterDialogueChat.tsx 中的输入区：
 * - 记忆表格整理横幅（isOrganizing）
 * - ChatInputBar 及其 quickActionItems（对话/内容/设置三组快捷操作）
 */
import React from 'react';
import ChatInputBar from './ChatInputBar';
import { useChatUIStore } from './stores/useChatUIStore';
import type { ChatHook } from './CharacterDialogueChat.hooks';
import type { ChatInputActions } from './useChatInputActions';
import type { ChatExportActions } from './useChatExport';
import type { CharacterInfo } from './CharacterDialogueChat.types';

interface ChatActionBarProps {
  chat: ChatHook;
  characterInfo: CharacterInfo;
  inputActions: ChatInputActions;
  exportActions: ChatExportActions;
}

const ChatActionBar: React.FC<ChatActionBarProps> = ({ chat, characterInfo, inputActions, exportActions }) => {
  const isFullscreen = useChatUIStore(s => s.isFullscreen);
  const toggleFullscreen = useChatUIStore(s => s.toggleFullscreen);
  const generatedReplyText = useChatUIStore(s => s.generatedReplyText);
  const polishFlashKey = useChatUIStore(s => s.polishFlashKey);

  const { isOrganizing } = chat;
  const retryLastAssistant = () => {
    const lastAssistant = [...chat.stateWithVersionInfo.messages].reverse().find(m => m.role === 'assistant');
    if (lastAssistant) chat.retryMessage(lastAssistant.id);
  };

  return (
    <>
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
        onSend={chat.sendMessage}
        onCancel={chat.cancelRequest}
        onStopOrganizing={chat.handleStopOrganizing}
        disabled={isOrganizing}
        isStreaming={chat.state.isStreaming}
        isOrganizing={isOrganizing}
        placeholder={isOrganizing ? '表格整理中，请稍后...' : `Message ${characterInfo.characterCardName}...`}
        onGenerateUserReply={inputActions.handleGenerateUserReply}
        isGeneratingUserReply={chat.isGeneratingUserReply}
        generatedReplyText={generatedReplyText}
        onGeneratedReplyTextConsumed={inputActions.handleGeneratedReplyTextConsumed}
        userReplyPerson={chat.characterConfig?.userReplyPerson}
        onUserReplyPersonChange={inputActions.handleUserReplyPersonChange}
        onPolishInput={inputActions.handlePolishInput}
        isPolishingInput={chat.isPolishingInput}
        polishFlashKey={polishFlashKey}
        onRetry={retryLastAssistant}
        onContinue={chat.continueConversation}
        onClear={chat.clearChat}
        onReset={chat.clearChat}
        quickActionItems={{
          dialogueActions: [
            {
              key: 'qa-retry',
              label: '重新生成',
              shortcut: '',
              disabled: chat.isGeneratingUserReply || chat.isPolishingInput,
              onClick: retryLastAssistant,
            },
            {
              key: 'qa-continue',
              label: '继续生成',
              shortcut: '',
              disabled: chat.isGeneratingUserReply || chat.isPolishingInput,
              onClick: chat.continueConversation,
            },
            {
              key: 'qa-ai-reply',
              label: 'AI 回复',
              shortcut: '',
              disabled: chat.isGeneratingUserReply || chat.isPolishingInput,
              onClick: () => inputActions.handleGenerateUserReply(),
            },
          ],
          contentActions: [
            {
              key: 'qa-polish',
              label: '润色输入',
              shortcut: '',
              disabled: chat.isGeneratingUserReply || chat.isPolishingInput,
              onClick: () => inputActions.handlePolishInput(''),
            },
            {
              key: 'qa-compress',
              label: '上下文压缩',
              shortcut: '',
              disabled: chat.isCompressing,
              onClick: chat.compressContext,
            },
            {
              key: 'qa-export',
              label: '导出对话',
              shortcut: '',
              onClick: () => exportActions.handleExportMenuClick('copy'),
            },
            // 【Phase 4 / L4】对话质量检查与人设一致性检查（N2）
            {
              key: 'qa-quality-check',
              label: '质量检查',
              shortcut: '',
              onClick: () => useChatUIStore.getState().setQualityCheckVisible(true),
            },
          ],
          settingActions: [
            {
              key: 'qa-fullscreen',
              label: isFullscreen ? '退出全屏' : '全屏',
              shortcut: '',
              onClick: toggleFullscreen,
            },
            {
              key: 'qa-clear',
              label: '清空对话',
              shortcut: '',
              onClick: chat.clearChat,
            },
          ],
        }}
        tokenUsage={chat.tokenUsage}
        onCompressContext={chat.compressContext}
        isCompressing={chat.isCompressing}
      />
    </>
  );
};

export default ChatActionBar;
