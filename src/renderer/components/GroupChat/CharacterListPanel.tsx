import React, { useState, useMemo } from 'react';
import { SearchOutlined, UserOutlined } from '@ant-design/icons';
import { useDataStore } from '../../stores/dataStore';
import './GroupChat.css';

interface CharacterInfo {
  name: string;
  path: string;
  avatar?: string;
  size?: number;
  modified?: number;
  characterName?: string;
}

interface CharacterListPanelProps {
  selectedPaths: string[];
  onCharacterDragStart: (character: CharacterInfo, e: React.DragEvent) => void;
}

export const CharacterListPanel: React.FC<CharacterListPanelProps> = ({
  selectedPaths,
  onCharacterDragStart,
}) => {
  const [search, setSearch] = useState('');
  const { characters, fetchCharacters } = useDataStore();

  const charList: CharacterInfo[] = useMemo(() => {
    return (characters || []).map((c: any) => ({
      name: c.characterName || c.name || c.path?.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Unknown',
      path: c.path,
      avatar: c.avatar,
      size: c.size,
      modified: c.modified,
      characterName: c.characterName || c.name,
    }));
  }, [characters]);

  const filtered = useMemo(() => {
    if (!search.trim()) return charList;
    const q = search.toLowerCase();
    return charList.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.characterName || '').toLowerCase().includes(q)
    );
  }, [charList, search]);

  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  React.useEffect(() => {
    if (characters.length === 0) fetchCharacters();
  }, [characters.length, fetchCharacters]);

  return (
    <div className="gc-panel gc-panel-left">
      <div className="gc-panel-header">
        <h3 className="gc-panel-title">角色列表</h3>
        <span className="gc-panel-badge">{charList.length}</span>
      </div>

      <div className="gc-search-box">
        <SearchOutlined className="gc-search-icon" />
        <input
          className="gc-search-input"
          placeholder="搜索角色..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="gc-character-list">
        {filtered.length === 0 ? (
          <div className="gc-empty-list">
            <UserOutlined style={{ fontSize: 32, color: '#4b5563', marginBottom: 8 }} />
            <p>{search ? '无匹配结果' : '暂无角色'}</p>
          </div>
        ) : (
          filtered.map((char) => {
            const isSelected = selectedSet.has(char.path);
            return (
              <div
                key={char.path}
                className={`gc-character-card ${isSelected ? 'selected' : ''}`}
                draggable
                onDragStart={(e) => onCharacterDragStart(char, e)}
              >
                <div className="gc-character-card-avatar">
                  {char.avatar ? (
                    <img src={char.avatar} alt={char.name} />
                  ) : (
                    <span>{char.name.charAt(0)}</span>
                  )}
                  {isSelected && <div className="gc-character-card-check" />}
                </div>
                <div className="gc-character-card-info">
                  <div className="gc-character-card-name" title={char.name}>{char.name}</div>
                  <div className="gc-character-card-meta">
                    {char.size ? `${(char.size / 1024).toFixed(1)} KB` : ''}
                  </div>
                </div>
                <div className="gc-drag-hint">⋮⋮</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
