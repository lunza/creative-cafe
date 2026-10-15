/**
 * 【Phase 2 / M1 - conversation-mode-optimization-report】模态框容器组件（God Component 拆分 U1-4）。
 *
 * 收纳原 CharacterDialogueChat.tsx 中的 Modal 外壳与组合层：
 * - Modal 配置（窗口 1600/1800px、全屏 100vw/100vh、背景模糊遮罩）
 * - 全屏 body overflow 控制
 * - M4 三档布局派生（resize 监听 + layoutMode + activeLayoutMode + 窄屏默认收起）
 * - CharacterSelectorPanel（角色选择器，M7 懒加载）
 * - 组合 ChatMessageArea / ChatConfigSidebar / ChatOverlays
 */
import React, { Suspense, lazy, useEffect } from 'react';
import { Modal } from 'antd';
import ChatMessageArea from './ChatMessageArea';
import ChatConfigSidebar from './ChatConfigSidebar';
import ChatOverlays from './ChatOverlays';
import { useChatUIStore } from './stores/useChatUIStore';
import { useFavoritesStore } from '../../../stores/favoritesStore';
import { useBodyScrollLock } from '../../Common/useBodyScrollLock';
import type { ChatHook } from './CharacterDialogueChat.hooks';
import type { ChatInputActions } from './useChatInputActions';
import type { ChatExportActions } from './useChatExport';
import type { ChatConfigActions } from './useConfigActions';
import type { CharacterInfo, CharacterSelectorItem } from './CharacterDialogueChat.types';
import type { CommandPaletteItem } from '../../Common/CommandPalette';

// 【Phase 2 / M7】角色选择面板懒加载
const LazyCharacterSelectorPanel = lazy(() => import('./CharacterSelectorPanel').then(m => ({ default: m.default })));
const LazyFallback = <div style={{ padding: 24, color: '#888', fontSize: 12 }}>加载中...</div>;

interface ChatModalProps {
  characterInfo: CharacterInfo;
  open: boolean;
  onClose: () => void;
  avatarPath?: string;
  characters?: CharacterSelectorItem[];
  onCharacterSelect?: (character: CharacterSelectorItem) => void;
  chat: ChatHook;
  imageGen: { isGeneratingImage: boolean; handleGenerateImage: (messageId: string) => Promise<void>; handleRegenerateImage: (messageId: string) => Promise<void> };
  inputActions: ChatInputActions;
  exportActions: ChatExportActions;
  configActions: ChatConfigActions;
  commandPaletteItems: CommandPaletteItem[];
}

const ChatModal: React.FC<ChatModalProps> = ({
  characterInfo, open, onClose, avatarPath, characters, onCharacterSelect,
  chat, imageGen, inputActions, exportActions, configActions, commandPaletteItems,
}) => {
  const isFullscreen = useChatUIStore(s => s.isFullscreen);
  const windowWidth = useChatUIStore(s => s.windowWidth);
  const setWindowWidth = useChatUIStore(s => s.setWindowWidth);
  const setConfigPanelCollapsed = useChatUIStore(s => s.setConfigPanelCollapsed);
  const toggleFavorite = useFavoritesStore(s => s.toggleFavorite);
  const getFavoritePaths = useFavoritesStore(s => s.getFavoritePaths);
  const favoritePaths = getFavoritePaths();

  // 全屏时锁定页面滚动
  // 【Phase 3 / L3 - conversation-mode-optimization-report】提取为共享 Hook（R4）
  useBodyScrollLock(isFullscreen);

  // 【Phase 2 / M4】窗口宽度监听（标准订阅清理模式，H4 范式）+ 三档布局派生
  useEffect(() => {
    setWindowWidth(window.innerWidth);
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setWindowWidth]);

  // 布局档位：宽屏（≥1600，当前布局 70/30）/ 中屏（1200-1600，80/20 可折叠）/ 窄屏（<1200，100% + 抽屉）
  const layoutMode: 'wide' | 'medium' | 'narrow' = windowWidth >= 1600 ? 'wide' : windowWidth >= 1200 ? 'medium' : 'narrow';

  // 窄屏默认收起配置面板（报告 U4：窄屏下配置面板默认收起，通过图标展开）
  useEffect(() => {
    if (layoutMode === 'narrow') {
      setConfigPanelCollapsed(true);
    }
  }, [layoutMode, setConfigPanelCollapsed]);

  const fullscreenStyles = isFullscreen ? {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100vw',
    height: '100vh',
    zIndex: 9999,
    margin: 0,
    borderRadius: 0,
  } : {};

  const showSelectorPanel = characters && characters.length > 0 && onCharacterSelect;

  // 【Phase 2 / M4】三档布局（U4/C2）：窗口模式（Modal 固定 1600px）恒为宽屏布局；
  // 全屏模式按 windowWidth 分档——宽屏 70/30、中屏 80/20（可折叠）、窄屏 100% + 配置抽屉
  const activeLayoutMode: 'wide' | 'medium' | 'narrow' = isFullscreen ? layoutMode : 'wide';

  const handleCharacterSelectWithFavorite = (character: CharacterSelectorItem) => {
    onCharacterSelect?.(character);
  };

  return (
    <Modal
      open={open && !isFullscreen}
      onCancel={onClose}
      footer={null}
      width={isFullscreen ? '100vw' : (showSelectorPanel ? 1800 : 1600)}
      centered={!isFullscreen}
      closable={false}
      styles={{
        body: {
          padding: 0,
          height: isFullscreen ? '100vh' : '85vh',
          minHeight: '600px',
          display: 'flex',
          flexDirection: 'row',
          borderRadius: isFullscreen ? 0 : '16px',
          overflow: 'hidden',
          background: 'var(--chat-dialog-bg-gradient, linear-gradient(135deg, #1e1e2e 0%, #2d2b42 50%, #1e1e2e 100%))',
          transition: 'background 0.3s ease',
          ...fullscreenStyles,
        },
        mask: {
          backdropFilter: 'blur(8px)',
          background: 'rgba(0, 0, 0, 0.6)',
        },
        header: {
          padding: 0,
        },
        wrapper: isFullscreen ? { padding: 0, maxWidth: '100%' } : {},
      }}
    >
      {showSelectorPanel && (
        <Suspense fallback={LazyFallback}>
          <LazyCharacterSelectorPanel
            characters={characters}
            selectedCharacterPath={characterInfo.characterCardId}
            onSelect={handleCharacterSelectWithFavorite}
            favoritePaths={favoritePaths}
            onToggleFavorite={toggleFavorite}
          />
        </Suspense>
      )}

      {/* 消息区（含头部、消息列表、错误恢复、操作栏） */}
      <ChatMessageArea
        chat={chat}
        characterInfo={characterInfo}
        onClose={onClose}
        avatarPath={avatarPath}
        characters={characters}
        onCharacterSelect={onCharacterSelect}
        isFullscreen={isFullscreen}
        activeLayoutMode={activeLayoutMode}
        imageGen={imageGen}
        inputActions={inputActions}
        exportActions={exportActions}
      />

      {/* 配置侧栏（行内 30%/20% 或窄屏抽屉） */}
      <ChatConfigSidebar
        chat={chat}
        characterInfo={characterInfo}
        configActions={configActions}
        isFullscreen={isFullscreen}
        activeLayoutMode={activeLayoutMode}
      />

      {/* 浮层（素材管理 / 命令面板 / 多格式导出 / 版本历史） */}
      <ChatOverlays
        chat={chat}
        characterInfo={characterInfo}
        avatarPath={avatarPath}
        exportActions={exportActions}
        commandPaletteItems={commandPaletteItems}
      />
    </Modal>
  );
};

export default ChatModal;
