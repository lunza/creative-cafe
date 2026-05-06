import React from 'react';
import { LoadingOutlined } from '@ant-design/icons';

interface ChatTypingIndicatorProps {
  characterName: string;
  avatarPath?: string;
}

const ChatTypingIndicator: React.FC<ChatTypingIndicatorProps> = ({
  characterName,
  avatarPath,
}) => {
  return (
    <div style={{
      display: 'flex',
      marginBottom: '20px',
      justifyContent: 'flex-start',
      animation: 'fadeInUp 0.3s ease-out',
    }}>
      <div style={{
        display: 'flex',
        gap: '12px',
        maxWidth: '75%',
      }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          overflow: 'hidden',
          flexShrink: 0,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          border: '2px solid var(--secondary-color, #8b5cf6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
        }}>
          {avatarPath ? (
            <img src={avatarPath} alt={characterName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ color: '#fff', fontSize: '16px', fontWeight: 'bold' }}>
              {characterName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{
            fontSize: '12px',
            color: 'var(--text-secondary, #6b7280)',
            padding: '0 4px',
          }}>
            {characterName}
          </div>

          <div style={{
            background: 'var(--bubble-bg-assistant, rgba(30, 30, 46, 0.8))',
            padding: '14px 20px',
            borderRadius: '18px 18px 18px 4px',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <LoadingOutlined style={{ fontSize: '16px', color: 'var(--secondary-color, #8b5cf6)' }} spin />
            <span style={{ color: 'var(--text-secondary, #9ca3af)', fontSize: '14px' }}>
              Typing...
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatTypingIndicator;
