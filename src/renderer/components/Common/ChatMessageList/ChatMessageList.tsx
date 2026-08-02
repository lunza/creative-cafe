/**
 * 可复用对话消息列表组件
 *
 * 来源：Spec: optimize-agent-interaction-from-openclaw / M5-Task17
 * 决策：从 CharacterDialogueChat 抽取消息列表逻辑为独立组件，
 *       支持 character/agent 两种模式，统一消息气泡样式
 *
 * 职责：
 *  1. 渲染消息列表（支持虚拟化/非虚拟化）
 *  2. 自动滚动到底部
 *  3. 空状态展示
 *  4. 通过 mode prop 控制功能差异
 */

import React, { useEffect, useRef, type ReactNode } from 'react';
import { VirtualizedMessageList, shouldVirtualize } from '../../Character/CharacterDialogueChat/VirtualizedMessageList';

/** 消息数据（兼容 ChatMessage 和 DialogueMessage） */
export interface ChatMessageListMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
  toolCalls?: Array<{ toolName: string; status: string; args?: any; result?: string; error?: string }>;
}

export interface ChatMessageListProps {
  /** 消息列表 */
  messages: ChatMessageListMessage[];
  /** 模式：character（完整）/ agent（精简） */
  mode?: 'character' | 'agent';
  /** 空状态内容 */
  emptyState?: ReactNode;
  /** 自定义消息渲染函数（覆盖默认渲染） */
  renderMessage?: (message: ChatMessageListMessage, index: number) => ReactNode;
  /** 容器高度（默认 400px） */
  height?: number | string;
  /** 容器样式 */
  style?: React.CSSProperties;
  /** 是否启用虚拟化（默认 false）。启用后需传入 scrollElementRef 复用父级滚动容器 */
  enableVirtualization?: boolean;
  /** 虚拟化启用的消息数阈值（默认 100，同时受 shouldVirtualize 最低阈值 50 约束） */
  virtualizationThreshold?: number;
  /** 外部滚动容器引用（虚拟化模式下使用，复用父级滚动容器而非创建嵌套容器） */
  scrollElementRef?: React.RefObject<HTMLDivElement>;
}

export const ChatMessageList: React.FC<ChatMessageListProps> = ({
  messages,
  mode = 'agent',
  emptyState,
  renderMessage,
  height = 400,
  style,
  enableVirtualization = false,
  virtualizationThreshold = 100,
  scrollElementRef,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 虚拟化模式：使用外部滚动容器，不创建嵌套滚动容器
  const useExternalScroll = enableVirtualization && !!scrollElementRef;

  // 消息变化时自动滚动到底部（仅在使用内部滚动容器时生效，外部滚动由父组件管理）
  useEffect(() => {
    if (!useExternalScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages, useExternalScroll]);

  // 渲染单条消息的通用逻辑
  const renderSingleMessage = (msg: ChatMessageListMessage, idx: number) =>
    renderMessage ? renderMessage(msg, idx) : <DefaultMessageBubble key={msg.id || idx} message={msg} mode={mode} />;

  // ==================== 虚拟化模式（使用外部滚动容器） ====================
  if (useExternalScroll) {
    // 空状态由父组件处理
    if (messages.length === 0) return null;

    // 超过阈值时启用虚拟化列表（shouldVirtualize 提供最低阈值保障，virtualizationThreshold 允许自定义）
    if (shouldVirtualize(messages.length) && messages.length >= virtualizationThreshold) {
      return (
        <VirtualizedMessageList
          items={messages}
          scrollElementRef={scrollElementRef!}
          renderItem={renderSingleMessage}
        />
      );
    }

    // 未超过阈值，直接渲染（由父级滚动容器管理滚动）
    return <>{messages.map((msg, idx) => renderSingleMessage(msg, idx))}</>;
  }

  // ==================== 非虚拟化模式（使用内部滚动容器，原有逻辑） ====================
  if (messages.length === 0 && emptyState) {
    return (
      <div
        style={{
          height,
          overflow: 'auto',
          padding: '12px',
          background: 'var(--bg-container, #fff)',
          ...style,
        }}
      >
        {emptyState}
      </div>
    );
  }

  return (
    <div
      style={{
        height,
        overflow: 'auto',
        padding: '12px',
        background: 'var(--bg-container, #fff)',
        ...style,
      }}
    >
      {messages.map((msg, idx) => renderSingleMessage(msg, idx))}
      <div ref={messagesEndRef} />
    </div>
  );
};

// ==================== 默认消息气泡 ====================

/**
 * 默认消息气泡渲染（agent 模式用）。
 *
 * 统一使用 CSS 变量，与 CharacterDialogueChat 的 ChatMessageBubble 样式一致。
 */
const DefaultMessageBubble: React.FC<{
  message: ChatMessageListMessage;
  mode: 'character' | 'agent';
}> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          padding: '8px 12px',
          borderRadius: 'var(--radius-base, 8px)',
          background: isUser
            ? 'var(--chat-bubble-user-bg)'
            : 'var(--chat-bubble-assistant-bg)',
          color: isUser
            ? 'var(--chat-bubble-user-color)'
            : 'var(--chat-bubble-assistant-color)',
          border: !isUser
            ? '1px solid var(--chat-bubble-assistant-border, transparent)'
            : 'none',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {message.content}
        {/* 流式接收中：在助手消息末尾显示闪烁光标 */}
        {message.role === 'assistant' && message.streaming && (
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '14px',
              marginLeft: '2px',
              background: 'var(--text-secondary, #999)',
              verticalAlign: 'text-bottom',
              animation: 'chatMessageListBlink 1s infinite',
            }}
          />
        )}
      </div>
      <style>{`
        @keyframes chatMessageListBlink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default ChatMessageList;
