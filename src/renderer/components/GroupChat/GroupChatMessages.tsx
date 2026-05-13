import React, { useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CaretDownOutlined, UserOutlined, RobotOutlined, TeamOutlined } from '@ant-design/icons';
import type { GroupDialogueMessage } from '../../types/groupChat.types';
import './GroupChat.css';

interface GroupMessageProps {
  message: GroupDialogueMessage;
  isLastStreaming: boolean;
  memberNames: string[];
}

const GroupMessageBubble: React.FC<GroupMessageProps> = ({
  message,
  isLastStreaming,
  memberNames,
}) => {
  const isUser = message.role === 'user';
  const isGroup = message.role === 'group';

  return (
    <div className={`group-message-wrapper ${isUser ? 'user-message' : 'ai-message'}`}>
      <div className="group-message-inner">
        <div className={`group-message-avatar ${isUser ? 'user' : 'assistant'}`}>
          {message.avatar ? (
            <img src={message.avatar} alt={message.name} />
          ) : isUser ? (
            <UserOutlined style={{ color: '#fff', fontSize: 16 }} />
          ) : isGroup ? (
            <TeamOutlined style={{ color: '#fff', fontSize: 16 }} />
          ) : (
            <RobotOutlined style={{ color: '#fff', fontSize: 16 }} />
          )}
        </div>
        <div className="group-message-content">
          <span className="group-message-name">{message.name}</span>
          <div className="group-message-bubble">
            <div className="markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
            {isLastStreaming && (
              <span className="group-message-streaming-cursor" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface GroupTypingIndicatorProps {
  members: string[];
}

const GroupTypingIndicator: React.FC<GroupTypingIndicatorProps> = ({ members }) => {
  const firstMember = members[0] || 'AI';
  return (
    <div className="group-typing-indicator">
      <div className="group-typing-avatar">
        <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
      </div>
      <div className="group-typing-dots">
        <div className="group-typing-dot" />
        <div className="group-typing-dot" />
        <div className="group-typing-dot" />
      </div>
      <span style={{ fontSize: 12, color: '#9ca3af' }}>{firstMember} 正在输入...</span>
    </div>
  );
};

interface GroupChatMessagesProps {
  messages: GroupDialogueMessage[];
  isStreaming: boolean;
  error: string | null;
  membersCount: number;
}

export const GroupChatMessages: React.FC<GroupChatMessagesProps> = ({
  messages,
  isStreaming,
  error,
  membersCount,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const memberNames = useMemo(() => {
    return messages
      .filter((m) => m.role === 'assistant' || m.role === 'group')
      .map((m) => m.name);
  }, [messages]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, isStreaming]);

  if (messages.length === 0) {
    return (
      <div className="group-chat-empty">
        <div className="group-chat-empty-icon">
          <TeamOutlined style={{ fontSize: 36 }} />
        </div>
        <h3>群聊已就绪</h3>
        <p>
          {membersCount > 0
            ? `当前有 ${membersCount} 位成员，发送消息开始群聊吧`
            : '请先添加群组成员'}
        </p>
      </div>
    );
  }

  return (
    <div className="group-chat-messages" ref={containerRef}>
      {error && <div className="group-chat-error">{error}</div>}

      {messages.map((msg, index) => {
        const isLastMsg = index === messages.length - 1;
        const isLastStreamingMsg = isLastMsg && isStreaming && (msg.role === 'assistant' || msg.role === 'group');

        return (
          <GroupMessageBubble
            key={msg.id}
            message={msg}
            isLastStreaming={isLastStreamingMsg}
            memberNames={memberNames}
          />
        );
      })}

      {isStreaming && messages.length > 0 && (
        <GroupTypingIndicator members={memberNames} />
      )}

      <div ref={messagesEndRef} />
    </div>
  );
};
