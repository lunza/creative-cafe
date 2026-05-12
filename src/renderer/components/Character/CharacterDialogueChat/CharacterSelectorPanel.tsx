import React, { useRef, useEffect, useState, useCallback } from 'react';
import { UserOutlined, HeartFilled } from '@ant-design/icons';
import './CharacterSelectorPanel.css';

interface Character {
  name: string;
  path: string;
  size: number;
  modified: Date;
  characterName?: string;
  version?: string;
  creator?: string;
  tags?: string[];
  cardVersion?: 'v1' | 'v2' | 'v3';
}

interface CharacterSelectorPanelProps {
  characters: Character[];
  selectedCharacterPath?: string;
  onSelect: (character: Character) => void;
  favoritePaths?: string[];
  onToggleFavorite?: (path: string) => void;
}

const ITEM_HEIGHT = 100;

const CharacterSelectorPanel: React.FC<CharacterSelectorPanelProps> = ({
  characters,
  selectedCharacterPath,
  onSelect,
  favoritePaths = [],
  onToggleFavorite,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [avatarCache, setAvatarCache] = useState<Record<string, string>>({});
  const [avatarLoading, setAvatarLoading] = useState<Record<string, boolean>>({});
  const [avatarError, setAvatarError] = useState<Record<string, boolean>>({});

  const sortedCharacters = React.useMemo(() => {
    if (favoritePaths.length === 0) {
      return characters;
    }
    const favoriteSet = new Set(favoritePaths);
    const favorites = characters.filter((c) => favoriteSet.has(c.path));
    const nonFavorites = characters.filter((c) => !favoriteSet.has(c.path));
    return [...favorites, ...nonFavorites];
  }, [characters, favoritePaths]);

  const loadAvatar = useCallback(async (character: Character) => {
    if (avatarCache[character.path] || avatarError[character.path] || avatarLoading[character.path]) {
      return;
    }

    setAvatarLoading(prev => ({ ...prev, [character.path]: true }));

    try {
      const isImageFile = character.path.endsWith('.png') || character.path.endsWith('.jpg') || character.path.endsWith('.jpeg') || character.path.endsWith('.webp');
      
      if (isImageFile) {
        const result = await window.electronAPI.file.readAsBase64(character.path);
        if (result?.success && result.data) {
          setAvatarCache(prev => ({ ...prev, [character.path]: result.data }));
        } else {
          setAvatarError(prev => ({ ...prev, [character.path]: true }));
        }
      } else {
        const content = await window.electronAPI.character.read(character.path);
        if (content?.avatar) {
          setAvatarCache(prev => ({ ...prev, [character.path]: content.avatar }));
        } else {
          setAvatarError(prev => ({ ...prev, [character.path]: true }));
        }
      }
    } catch {
      setAvatarError(prev => ({ ...prev, [character.path]: true }));
    } finally {
      setAvatarLoading(prev => ({ ...prev, [character.path]: false }));
    }
  }, [avatarCache, avatarError, avatarLoading]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const container = listRef.current;
    if (!container) return;

    const scrollAmount = e.deltaY > 0 ? ITEM_HEIGHT : -ITEM_HEIGHT;
    container.scrollBy({ top: scrollAmount, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (selectedCharacterPath && listRef.current) {
      const selectedIndex = characters.findIndex(c => c.path === selectedCharacterPath);
      if (selectedIndex >= 0) {
        const container = listRef.current;
        const targetScroll = selectedIndex * ITEM_HEIGHT;
        container.scrollTo({ top: targetScroll, behavior: 'smooth' });
      }
    }
  }, [selectedCharacterPath, characters]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (!isNaN(index) && characters[index]) {
              loadAvatar(characters[index]);
            }
          }
        });
      },
      { root: listRef.current, rootMargin: '50px' }
    );

    const items = listRef.current?.querySelectorAll('.character-selector-item');
    items?.forEach(item => observer.observe(item));

    return () => observer.disconnect();
  }, [characters, loadAvatar]);

  if (characters.length === 0) {
    return (
      <div className="character-selector-panel">
        <div className="character-selector-title">角色卡</div>
        <div className="character-selector-empty">
          <div className="character-selector-empty-icon">
            <UserOutlined />
          </div>
          <div>暂无角色卡</div>
        </div>
      </div>
    );
  }

  return (
    <div className="character-selector-panel">
      <div className="character-selector-title">角色卡</div>
      <div
        ref={listRef}
        className="character-selector-list"
        onWheel={handleWheel}
      >
        {sortedCharacters.map((character, index) => {
          const isSelected = character.path === selectedCharacterPath;
          const displayName = character.characterName || character.name;
          const firstChar = displayName.charAt(0).toUpperCase();
          const isFavorite = favoritePaths.includes(character.path);

          return (
            <div
              key={character.path}
              data-index={index}
              className={`character-selector-item ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelect(character)}
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <div className="character-selector-avatar">
                {isFavorite && (
                  <div className="favorite-heart-badge" onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite?.(character.path);
                  }}>
                    <HeartFilled />
                  </div>
                )}
                {avatarLoading[character.path] && (
                  <div className="avatar-loading" />
                )}
                {avatarCache[character.path] ? (
                  <img src={avatarCache[character.path]} alt={displayName} />
                ) : (
                  <span className="avatar-fallback">{firstChar}</span>
                )}
              </div>
              <div className="character-selector-name" title={displayName}>
                {displayName}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default React.memo(CharacterSelectorPanel);
