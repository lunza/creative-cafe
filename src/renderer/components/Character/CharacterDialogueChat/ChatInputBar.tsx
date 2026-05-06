import React, { useState, useRef, useEffect } from 'react';
import { Button, Tooltip } from 'antd';
import { SendOutlined, StopOutlined } from '@ant-design/icons';

interface ChatInputBarProps {
  onSend: (message: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  placeholder?: string;
}

const ChatInputBar: React.FC<ChatInputBarProps> = ({
  onSend,
  onCancel,
  disabled = false,
  isStreaming = false,
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
      background: 'var(--input-bg, rgba(30, 30, 46, 0.6))',
      backdropFilter: 'blur(10px)',
      borderTop: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
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
          background: 'var(--textarea-bg, rgba(15, 15, 26, 0.8))',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
          borderRadius: '24px',
          padding: '12px 20px',
          color: 'var(--text-primary, #e2e8f0)',
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
          e.target.style.borderColor = 'var(--primary-color, #6366f1)';
          e.target.style.boxShadow = '0 0 0 2px rgba(99, 102, 241, 0.2)';
        }}
        onBlur={(e) => {
          e.target.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.1))';
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
                ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                : 'var(--btn-disabled-bg, #4b5563)',
              border: 'none',
              boxShadow: input.trim() && !disabled
                ? '0 4px 12px rgba(99, 102, 241, 0.4)'
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
