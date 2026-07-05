import React, { useState, useCallback, useRef, useEffect, lazy, Suspense } from 'react';
import {
  MessageOutlined,
  EditOutlined,
  TrophyOutlined,
  HeartFilled,
  CloseOutlined
} from '@ant-design/icons';
import { Tooltip, message } from 'antd';
import { SingleChatDialog } from './SingleChatDialog';
import { useDataStore } from '../../stores/dataStore';
import { useFavoritesStore } from '../../stores/favoritesStore';
import './CreationCenter.css';

// Lazy mount WritingModeEntry：仅当用户打开写作模式对话框时才加载其模块
// （包含 OutlineEditor / ContentWorkspace / WritingConfigModal 等重依赖）
const WritingModeEntry = lazy(
  () => import('../Creative/WritingMode').then(m => ({ default: m.WritingModeEntry }))
);

// Lazy mount GameModeEntry：仅当用户打开游戏模式对话框时才加载其模块
const GameModeEntry = lazy(
  () => import('../Game').then(m => ({ default: m.GameModeEntry }))
);

type ChatPanelType = 'chat' | 'creative' | 'game';

interface PanelConfig {
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  activeColor: string;
  comingSoon?: boolean;
  devBadge?: boolean;
}

const panelConfig: Record<ChatPanelType, PanelConfig> = {
  chat: {
    label: '聊天模式',
    description: '与AI角色进行一对一深度对话，体验沉浸式交互',
    icon: <MessageOutlined />,
    color: '#6366f1',
    activeColor: '#818cf8',
  },
  creative: {
    label: '写作模式',
    description: 'AI辅助创作，生成故事、小说和各类文本内容',
    icon: <EditOutlined />,
    color: '#f59e0b',
    activeColor: '#fbbf24',
    devBadge: true,
  },
  game: {
    label: '游戏模式',
    description: '互动式文字冒险游戏，由AI驱动剧情发展',
    icon: <TrophyOutlined />,
    color: '#10b981',
    activeColor: '#34d399',
  },
};

const colorMap: Record<ChatPanelType, string> = {
  chat: '#6366f1',
  creative: '#f59e0b',
  game: '#10b981',
};

interface Ripple {
  x: number;
  y: number;
  id: number;
}

interface FavoriteCharacterData {
  name: string;
  path: string;
  size: number;
  modified: Date;
  characterName?: string;
  avatarUrl?: string;
}

export const CreationCenter: React.FC = () => {
  const [activePanel, setActivePanel] = useState<ChatPanelType>('chat');
  const [showChatDialog, setShowChatDialog] = useState(false);
  const [showWritingDialog, setShowWritingDialog] = useState(false);
  const [showGameDialog, setShowGameDialog] = useState(false);
  const [flashingPanel, setFlashingPanel] = useState<ChatPanelType | null>(null);
  const [ripples, setRipples] = useState<Record<ChatPanelType, Ripple[]>>({
    chat: [],
    creative: [],
    game: [],
  });
  const rippleCounter = useRef(0);
  const { characters, fetchCharacters, loading: charactersLoading } = useDataStore();
  const { getFavoritePaths, toggleFavorite } = useFavoritesStore();
  const [favoriteData, setFavoriteData] = useState<FavoriteCharacterData[]>([]);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (!hasFetchedRef.current && !charactersLoading && characters.length === 0) {
      hasFetchedRef.current = true;
      fetchCharacters();
    }
  }, [characters.length, charactersLoading, fetchCharacters]);

  const favoritePaths = getFavoritePaths();

  useEffect(() => {
    if (characters.length === 0) {
      setFavoriteData([]);
      return;
    }
    const favSet = new Set(favoritePaths);
    const favCharacters = characters
      .filter((c) => favSet.has(c.path))
      .map((c) => ({
        name: c.name,
        path: c.path,
        size: c.size,
        modified: c.modified,
        characterName: c.characterName,
      }));
    
    setFavoriteData((prev) => {
      if (prev.length === favCharacters.length && 
          prev.every((p, i) => p.path === favCharacters[i].path && p.avatarUrl !== undefined)) {
        return prev;
      }
      return favCharacters.map((fc, i) => {
        const existing = prev.find((p) => p.path === fc.path);
        return existing ? { ...fc, avatarUrl: existing.avatarUrl } : fc;
      });
    });
  }, [characters, favoritePaths]);

  const loadAvatar = useCallback(async (path: string) => {
    try {
      const isImageFile =
        path.endsWith('.png') ||
        path.endsWith('.jpg') ||
        path.endsWith('.jpeg') ||
        path.endsWith('.webp');

      if (isImageFile) {
        const result = await window.electronAPI.file.readAsBase64(path);
        if (result?.success && result.data) {
          loadedAvatarPathsRef.current.add(path);
          loadingAvatarPathsRef.current.delete(path);
          setFavoriteData((prev) =>
            prev.map((item) =>
              item.path === path ? { ...item, avatarUrl: result.data } : item
            )
          );
        }
      } else {
        const content = await window.electronAPI.character.read(path);
        if (content?.avatar) {
          let avatarUrl = content.avatar;
          // 处理 avatar 可能是文件路径的情况
          if (avatarUrl && !avatarUrl.startsWith('data:')) {
            // 如果 avatar 是文件路径（以 / 开头或包含 /）
            if (avatarUrl.startsWith('/') || avatarUrl.includes('/')) {
              const result = await window.electronAPI.file.readAsBase64(avatarUrl);
              if (result?.success && result.data) {
                avatarUrl = result.data;
              }
            }
            // 如果是纯 base64 字符串（没有 data: 前缀）
            else if (avatarUrl.length > 100) {
              let imgType = 'png';
              if (avatarUrl.includes('R0lG')) imgType = 'gif';
              else if (avatarUrl.includes('JFIF') || avatarUrl.includes('/9j/')) imgType = 'jpeg';
              else if (avatarUrl.includes('UklGR')) imgType = 'webp';
              avatarUrl = `data:image/${imgType};base64,${avatarUrl}`;
            }
          }
          loadedAvatarPathsRef.current.add(path);
          loadingAvatarPathsRef.current.delete(path);
          setFavoriteData((prev) =>
            prev.map((item) =>
              item.path === path ? { ...item, avatarUrl } : item
            )
          );
        }
      }
    } catch (err) {
      console.error('[CreationCenter] Avatar load failed for:', path, err);
      loadedAvatarPathsRef.current.add(path);
      loadingAvatarPathsRef.current.delete(path);
    }
  }, []);

  const loadedAvatarPathsRef = useRef<Set<string>>(new Set());
  const loadingAvatarPathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    favoriteData.forEach((item) => {
      if (!item.avatarUrl && 
          !loadedAvatarPathsRef.current.has(item.path) && 
          !loadingAvatarPathsRef.current.has(item.path)) {
        loadingAvatarPathsRef.current.add(item.path);
        loadAvatar(item.path);
      }
    });
  }, [favoriteData, loadAvatar]);

  const hasFavorites = favoriteData.length > 0;
  const isChatActive = activePanel === 'chat' && !panelConfig.chat.comingSoon;

  const handleCharacterClick = useCallback(
    (character: FavoriteCharacterData) => {
      const charData = characters.find((c) => c.path === character.path);
      if (charData) {
        setShowChatDialog(true);
      }
    },
    [characters]
  );

  const handlePanelClick = useCallback(async (panel: ChatPanelType, e: React.MouseEvent<HTMLDivElement>) => {
    const config = panelConfig[panel];
    if (config.comingSoon) {
      return;
    }

    // Only do ripple/flash if clicking directly on panel (not avatar)
    const target = e.target as HTMLElement;
    const isAvatarClick = target.closest('.chat-panel-favorite-item');

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rippleId = ++rippleCounter.current;

    setRipples((prev) => ({
      ...prev,
      [panel]: [...(prev[panel] || []), { x, y, id: rippleId }],
    }));

    setTimeout(() => {
      setRipples((prev) => ({
        ...prev,
        [panel]: prev[panel].filter((r) => r.id !== rippleId),
      }));
    }, 600);

    setActivePanel(panel);
    setFlashingPanel(panel);
    setTimeout(() => setFlashingPanel(null), 300);

    if (panel === 'chat') {
      setShowChatDialog(true);
    } else if (panel === 'creative') {
      setShowWritingDialog(true);
    } else if (panel === 'game') {
      setShowGameDialog(true);
    }
  }, []);

  const handleCloseChat = useCallback(() => {
    setShowChatDialog(false);
  }, []);

  const handleCloseWriting = useCallback(() => {
    setShowWritingDialog(false);
  }, []);

  const handleCloseGame = useCallback(() => {
    setShowGameDialog(false);
  }, []);

  return (
    <div className="chat-module">
      <div className="chat-panels-container">
        {(Object.keys(panelConfig) as ChatPanelType[]).map((panel) => {
          const config = panelConfig[panel];
          const isActive = activePanel === panel;
          const isFlashing = flashingPanel === panel;
          const isDisabled = !!config.comingSoon;

          return (
            <div
              key={panel}
              data-panel={panel}
              className={`chat-panel ${isActive ? 'active' : ''} ${isFlashing ? 'flashing' : ''} ${isDisabled ? 'disabled' : ''}`}
              onClick={(e) => handlePanelClick(panel, e)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handlePanelClick(panel, e as unknown as React.MouseEvent<HTMLDivElement>);
                }
              }}
            >
              <div className="hover-overlay" />
              {(ripples[panel] || []).map((ripple) => (
                <span
                  key={ripple.id}
                  className="ripple"
                  style={{
                    left: ripple.x - 25,
                    top: ripple.y - 25,
                    width: 50,
                    height: 50,
                    backgroundColor: colorMap[panel],
                    opacity: 0.3,
                  }}
                />
              ))}
              <div className="chat-panel-content">
                <div className="chat-panel-icon" style={{ color: isActive ? config.activeColor : config.color }}>
                  {config.icon}
                </div>
                <div className="chat-panel-label" style={{ color: isActive ? config.activeColor : config.color }}>
                  {config.label}
                </div>
                <div className="chat-panel-description">{config.description}</div>
                {config.comingSoon && (
                  <div className="chat-panel-badge">
                    <span className="badge-text">敬请期待</span>
                  </div>
                )}
                {config.devBadge && (
                  <div className="chat-panel-badge chat-panel-badge-dev">
                    <span className="badge-text">DEV</span>
                  </div>
                )}

                {panel === 'chat' && !isDisabled && hasFavorites && (
                  <div className="chat-panel-favorites-section">
                    <div className="chat-panel-favorites-divider">
                      <HeartFilled className="favorites-divider-icon" />
                      <span className="favorites-divider-text">喜爱 ({favoriteData.length})</span>
                    </div>
                    <div className="chat-panel-favorites-grid">
                      {favoriteData.map((character) => {
                        const displayName = character.characterName || character.name;
                        const firstChar = displayName.charAt(0).toUpperCase();
                        return (
                          <Tooltip key={character.path} title={displayName} placement="top">
                            <div
                              className="chat-panel-favorite-item"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCharacterClick(character);
                              }}
                            >
                              <div className="chat-panel-favorite-avatar">
                                {character.avatarUrl ? (
                                  <img src={character.avatarUrl} alt={displayName} />
                                ) : (
                                  <span className="chat-panel-favorite-fallback">{firstChar}</span>
                                )}
                                <div
                                  className="chat-panel-favorite-remove"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleFavorite(character.path);
                                  }}
                                  title="取消喜爱"
                                >
                                  <HeartFilled />
                                </div>
                              </div>
                              <div className="chat-panel-favorite-name">{displayName}</div>
                            </div>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {isActive && !isDisabled && <div className="chat-panel-border" style={{ borderColor: config.activeColor }} />}
            </div>
          );
        })}
      </div>

      <SingleChatDialog
        isDialogMode={showChatDialog}
        onCloseDialog={handleCloseChat}
      />

      <WritingModeDialog
        visible={showWritingDialog}
        onClose={handleCloseWriting}
      />

      <GameModeDialog
        visible={showGameDialog}
        onClose={handleCloseGame}
      />
    </div>
  );
};

interface WritingModeDialogProps {
  visible: boolean;
  onClose: () => void;
}

const WritingModeDialog: React.FC<WritingModeDialogProps> = ({ visible, onClose }) => {
  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: '#1a1a2e'
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div style={{
          padding: '12px 20px',
          background: 'linear-gradient(135deg, #1e1e2e 0%, #2d2b42 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}>
          <h3 style={{ margin: 0, color: '#fff', fontSize: 16, fontWeight: 600 }}>写作模式</h3>
          <button
            onClick={onClose}
            onMouseEnter={(e) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.background = '#ff7875';
              btn.style.transform = 'rotate(90deg) scale(1.1)';
            }}
            onMouseLeave={(e) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.background = '#ff4d4f';
              btn.style.transform = 'rotate(0deg) scale(1)';
            }}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: '#ff4d4f',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              transition: 'all 0.3s ease',
              boxShadow: '0 2px 8px rgba(255, 77, 79, 0.3)'
            }}
          >
            <CloseOutlined style={{ fontSize: 16, color: '#fff' }} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <Suspense
            fallback={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
                加载写作模式...
              </div>
            }
          >
            <WritingModeEntry />
          </Suspense>
        </div>
      </div>
    </div>
  );
};

interface GameModeDialogProps {
  visible: boolean;
  onClose: () => void;
}

const GameModeDialog: React.FC<GameModeDialogProps> = ({ visible, onClose }) => {
  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: '#1a1a2e'
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <div style={{
          padding: '12px 20px',
          background: 'linear-gradient(135deg, #1e1e2e 0%, #2d2b42 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}>
          <h3 style={{ margin: 0, color: '#fff', fontSize: 16, fontWeight: 600 }}>游戏模式</h3>
          <button
            onClick={onClose}
            onMouseEnter={(e) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.background = '#ff7875';
              btn.style.transform = 'rotate(90deg) scale(1.1)';
            }}
            onMouseLeave={(e) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.background = '#ff4d4f';
              btn.style.transform = 'rotate(0deg) scale(1)';
            }}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: '#ff4d4f',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              transition: 'all 0.3s ease',
              boxShadow: '0 2px 8px rgba(255, 77, 79, 0.3)'
            }}
          >
            <CloseOutlined style={{ fontSize: 16, color: '#fff' }} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <Suspense
            fallback={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
                加载游戏模式...
              </div>
            }
          >
            <GameModeEntry />
          </Suspense>
        </div>
      </div>
    </div>
  );
};

export default CreationCenter;
