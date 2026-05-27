import React, { useState, useRef, useEffect } from 'react';
import { Button, Tooltip } from 'antd';
import { SendOutlined, StopOutlined, ClearOutlined } from '@ant-design/icons';

interface ChatInputBarProps {
  onSend: (message: string) => void;
  onCancel?: () => void;
  onStopOrganizing?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  isOrganizing?: boolean;
  placeholder?: string;
}

const ChatInputBar: React.FC<ChatInputBarProps> = ({
  onSend,
  onCancel,
  onStopOrganizing,
  disabled = false,
  isStreaming = false,
  isOrganizing = false,
  placeholder = 'Type a message...',
}) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSend = () => {
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      padding: '16px 20px',
      background: 'var(--chat-input-bg, rgba(30, 30, 46, 0.6))',
      backdropFilter: 'blur(10px)',
      borderTop: '1px solid var(--chat-input-border, rgba(255, 255, 255, 0.1))',
    }}>
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled && !isStreaming}
        rows={1}
        style={{
          flex: 1,
          background: 'var(--chat-input-bg, rgba(15, 15, 26, 0.8))',
          border: '1px solid var(--chat-input-border, rgba(255, 255, 255, 0.1))',
          borderRadius: '24px',
          padding: '12px 20px',
          color: 'var(--chat-input-color, #e2e8f0)',
          fontSize: '14px',
          resize: 'none',
          outline: 'none',
          fontFamily: 'inherit',
          lineHeight: '1.5',
          minHeight: '44px',
          maxHeight: '150px',
          overflow: 'hidden',
          overflowY: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        }}
        onFocus={(e) => {
          e.target.style.borderColor = 'var(--chat-input-border-focus, var(--primary-color, #6366f1))';
          e.target.style.boxShadow = '0 0 0 2px rgba(99, 102, 241, 0.2)';
        }}
        onBlur={(e) => {
          e.target.style.borderColor = 'var(--chat-input-border, rgba(255, 255, 255, 0.1))';
          e.target.style.boxShadow = 'none';
        }}
        className="chat-textarea"
      />

      {isStreaming ? (
        <Tooltip title="Stop generating">
          <Button
            type="primary"
            danger
            icon={<StopOutlined />}
            onClick={onCancel}
            size="large"
            style={{
              borderRadius: '50%',
              width: '44px',
              height: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
              border: 'none',
              boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)',
            }}
          />
        </Tooltip>
      ) : isOrganizing ? (
        <Tooltip title="停止整理">
          <Button
            type="primary"
            danger
            icon={<ClearOutlined />}
            onClick={onStopOrganizing}
            size="large"
            style={{
              borderRadius: '50%',
              width: '44px',
              height: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              border: 'none',
              boxShadow: '0 4px 12px rgba(245, 158, 11, 0.4)',
            }}
          />
        </Tooltip>
      ) : (
        <Tooltip title="Send message">
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            disabled={!input.trim() || disabled}
            size="large"
            style={{
              borderRadius: '50%',
              width: '44px',
              height: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: input.trim() && !disabled
                ? 'var(--chat-send-btn-bg, linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%))'
                : 'var(--chat-send-btn-disabled-bg, rgba(99, 102, 241, 0.1))',
              border: input.trim() && !disabled
                ? 'none'
                : '1px solid var(--chat-send-btn-disabled-border, rgba(99, 102, 241, 0.3))',
              boxShadow: input.trim() && !disabled
                ? 'var(--chat-send-btn-shadow, 0 4px 12px rgba(99, 102, 241, 0.4))'
                : 'none',
              transition: 'all 0.2s ease',
            }}
          />
        </Tooltip>
      )}
    </div>
  );
};

export default ChatInputBar;
