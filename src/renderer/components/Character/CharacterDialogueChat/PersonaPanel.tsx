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
        {personas.map(persona => (
          <Tooltip key={persona.id} title={persona.name} placement="top">
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
            </div>
          </Tooltip>
        ))}
      </div>
    </div>
  );
};

export default PersonaPanel;
