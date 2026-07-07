import React, { useEffect, useState } from 'react';
import { Tooltip } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { UserPersona } from './CharacterDialogueChat.types';
import './ConfigPanel.css';

interface PersonaPanelProps {
  personas: UserPersona[];
  selectedPersonaId: string | undefined;
  loading: boolean;
  onPersonaChange: (personaId: string) => void;
}

const PersonaPanel: React.FC<PersonaPanelProps> = ({
  personas,
  selectedPersonaId,
  loading,
  onPersonaChange,
}) => {
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const loadAvatars = async () => {
      const urls: Record<string, string> = {};
      for (const persona of personas) {
        if (persona.avatarPath) {
          try {
            const normalizedPath = persona.avatarPath.replace(/\//g, '\\');
            const result = await window.electronAPI.file.readAsBase64(normalizedPath);
            if (result.success && result.data) {
              urls[persona.id] = result.data;
            }
          } catch {
            // ignore
          }
        }
      }
      setAvatarUrls(urls);
    };
    loadAvatars();
  }, [personas]);

  if (loading) {
    return (
      <div className="persona-panel">
        <div className="persona-panel-title">用户人设</div>
        <div className="persona-loading">加载中...</div>
      </div>
    );
  }

  if (personas.length === 0) {
    return (
      <div className="persona-panel">
        <div className="persona-panel-title">用户人设</div>
        <div className="persona-empty">
          <UserOutlined className="persona-empty-icon" />
          <p>暂无人设</p>
          <span>请在人设管理中创建</span>
        </div>
      </div>
    );
  }

  return (
    <div className="persona-panel">
      <div className="persona-panel-title">用户人设</div>
      <div className="persona-list">
        {[...personas]
          .sort((a, b) => {
            // 通用人设排在第一位
            if (a.isGeneric && !b.isGeneric) return -1;
            if (!a.isGeneric && b.isGeneric) return 1;
            return 0;
          })
          .map(persona => (
          <Tooltip
            key={persona.id}
            title={persona.isGeneric ? '通用人设：根据角色卡中 {{user}} 的设定动态确定身份' : persona.name}
            placement="top"
          >
            <div
              className={`persona-card ${selectedPersonaId === persona.id ? 'selected' : ''}`}
              onClick={() => onPersonaChange(persona.id)}
            >
              <div className="persona-avatar">
                {avatarUrls[persona.id] ? (
                  <img src={avatarUrls[persona.id]} alt={persona.name} />
                ) : (
                  <UserOutlined />
                )}
              </div>
              <div className="persona-name">{persona.name}</div>
              {persona.isGeneric && (
                <span style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  fontSize: 9,
                  padding: '0 4px',
                  borderRadius: 8,
                  background: 'var(--primary-color, #1890ff)',
                  color: '#fff',
                  lineHeight: '16px'
                }}>通用</span>
              )}
            </div>
          </Tooltip>
        ))}
      </div>
    </div>
  );
};

export default PersonaPanel;
