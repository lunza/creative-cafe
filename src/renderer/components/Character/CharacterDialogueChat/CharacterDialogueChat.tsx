/**
 * 角色对话入口 —— 纯编排层（【Phase 2 / M1 - conversation-mode-optimization-report】God Component 拆分完成）。
 *
 * 拆分后本文件仅负责：核心 hook 调用 + 4 个领域 hook 组合 + ChatModal 透传。
 * 原 1464+ 行 God Component 已拆为：
 * - useImageGeneration.ts：图片生成（executeImageGeneration / 首次&重新生成 / phase 进度订阅）
 * - useChatExport.ts：导出菜单 / 落盘 / 版本恢复（M5 + M6）
 * - useChatInputActions.ts：输入框动作（AI 回复 / 润色 / 卷回 / 人称）
 * - useConfigActions.ts：配置面板参数变更回调
 * - useChatCommandPalette.ts：命令面板命令 + Ctrl+K 快捷键
 * - ChatModal.tsx：Modal 外壳 + M4 三档布局派生 + 角色选择器
 * - ChatMessageArea.tsx：消息区（头部 / 列表 / 错误恢复 / 气泡渲染）
 * - ChatActionBar.tsx：整理横幅 + 输入栏 + 快捷操作
 * - ChatConfigSidebar.tsx：配置面板（行内 / 窄屏抽屉）
 * - ChatOverlays.tsx：素材管理 / 命令面板 / 多格式导出 / 版本历史浮层
 *
 * UI 瞬态全部在 useChatUIStore（H2 范式），子组件按需内部订阅，本层不再持有。
 */
import React from 'react';
import ChatModal from './ChatModal';
import { useCharacterDialogueChat } from './CharacterDialogueChat.hooks';
import { useImageGeneration } from './useImageGeneration';
import { useChatExport } from './useChatExport';
import { useChatInputActions } from './useChatInputActions';
import { useConfigActions } from './useConfigActions';
import { useChatCommandPalette } from './useChatCommandPalette';
import { useChatUIStore } from './stores/useChatUIStore';
import { CharacterInfo, CharacterSelectorItem } from './CharacterDialogueChat.types';
import './CharacterDialogueChat.css';

interface CharacterDialogueChatProps {
  characterInfo: CharacterInfo;
  open: boolean;
  onClose: () => void;
  avatarPath?: string;
  characters?: CharacterSelectorItem[];
  onCharacterSelect?: (character: CharacterSelectorItem) => void;
}

const CharacterDialogueChat: React.FC<CharacterDialogueChatProps> = ({
  characterInfo,
  open,
  onClose,
  avatarPath,
  characters,
  onCharacterSelect,
}) => {
  // 核心对话 hook（消息状态机 / 流式 IPC / 配置持久化 / 记忆表格 / Token 管理）
  const chat = useCharacterDialogueChat(characterInfo);

  // 【Phase 2 / M1】图片生成逻辑（God Component 拆分）
  const imageGen = useImageGeneration({
    characterInfo,
    stateWithVersionInfo: chat.stateWithVersionInfo,
    characterConfig: chat.characterConfig,
    updateImageAttachment: chat.updateImageAttachment,
  });

  // 导出菜单 / 保存 / 版本恢复（M5 多格式导出 + M6 版本历史）
  const exportActions = useChatExport(chat, characterInfo);
  // 输入框动作（AI 回复 / 润色 / 卷回 / 人称）
  const inputActions = useChatInputActions(chat);
  // 配置面板参数变更回调（updateConfig 薄包装）
  const configActions = useConfigActions(chat);
  // 命令面板命令列表 + Ctrl+K 快捷键
  const commandPaletteItems = useChatCommandPalette(chat, exportActions, inputActions);

  // 全屏状态（仅用于挂载判定；M4 三档布局派生在 ChatModal 内部完成）
  const isFullscreen = useChatUIStore(s => s.isFullscreen);

  if (!open && !isFullscreen) return null;

  return (
    <ChatModal
      characterInfo={characterInfo}
      open={open}
      onClose={onClose}
      avatarPath={avatarPath}
      characters={characters}
      onCharacterSelect={onCharacterSelect}
      chat={chat}
      imageGen={imageGen}
      inputActions={inputActions}
      exportActions={exportActions}
      configActions={configActions}
      commandPaletteItems={commandPaletteItems}
    />
  );
};

export default CharacterDialogueChat;
