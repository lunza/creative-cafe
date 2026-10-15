/**
 * 【Phase 2 / M1 - conversation-mode-optimization-report】命令面板 Hook（God Component 拆分）。
 *
 * 收纳原 CharacterDialogueChat.tsx 中的 commandPaletteItems（useMemo）
 * 与 Ctrl+K 快捷键监听 effect，供 ChatOverlays 渲染 CommandPalette。
 */
import { useEffect, useMemo } from 'react';
import { message } from 'antd';
import type { CommandPaletteItem } from '../../Common/CommandPalette';
import { useChatUIStore } from './stores/useChatUIStore';
import type { ChatHook } from './CharacterDialogueChat.hooks';
import type { ChatExportActions } from './useChatExport';
import type { ChatInputActions } from './useChatInputActions';

export function useChatCommandPalette(
  chat: ChatHook,
  exportActions: ChatExportActions,
  inputActions: ChatInputActions,
) {
  const isFullscreen = useChatUIStore(s => s.isFullscreen);
  const setCommandPaletteVisible = useChatUIStore(s => s.setCommandPaletteVisible);
  const toggleFullscreen = useChatUIStore(s => s.toggleFullscreen);

  // Ctrl+K 命令面板快捷键（原 tsx effect 随命令面板逻辑一并迁入）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteVisible(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setCommandPaletteVisible]);

  // 命令面板命令列表
  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [];

    // 导航类
    items.push({
      key: 'nav-clear',
      label: '清空对话',
      description: '清除所有消息',
      category: 'navigation',
      shortcut: '',
      onExecute: () => chat.clearChat(),
    });
    items.push({
      key: 'nav-fullscreen',
      label: isFullscreen ? '退出全屏' : '进入全屏',
      category: 'navigation',
      onExecute: () => toggleFullscreen(),
    });
    items.push({
      key: 'nav-export-copy',
      label: '导出对话 - 复制到剪贴板',
      category: 'navigation',
      onExecute: () => exportActions.handleExportMenuClick('copy'),
    });
    items.push({
      key: 'nav-export-save',
      label: '导出对话 - 保存为文件',
      category: 'navigation',
      onExecute: () => exportActions.handleExportMenuClick('save'),
    });

    // 操作类
    items.push({
      key: 'action-retry',
      label: '重新生成',
      description: '重试上一条 AI 回复',
      category: 'actions',
      onExecute: () => {
        const lastAssistantMsg = [...chat.stateWithVersionInfo.messages].reverse().find(m => m.role === 'assistant');
        if (lastAssistantMsg) {
          chat.retryMessage(lastAssistantMsg.id);
        }
      },
    });
    items.push({
      key: 'action-continue',
      label: '继续生成',
      description: '续写上一条 AI 回复',
      category: 'actions',
      onExecute: () => chat.continueConversation(),
    });
    items.push({
      key: 'action-polish',
      label: '润色输入',
      description: '润色当前输入框文本',
      category: 'actions',
      onExecute: () => {
        message.info('请在输入框中输入文本后点击润色按钮');
      },
    });
    items.push({
      key: 'action-ai-reply',
      label: 'AI 回复',
      description: '以当前用户人设生成对话回复',
      category: 'actions',
      onExecute: () => inputActions.handleGenerateUserReply(),
    });

    // 设置类
    items.push({
      key: 'settings-params',
      label: '参数设置',
      description: '打开参数面板',
      category: 'settings',
      onExecute: () => {
        const panel = document.querySelector('[data-config-panel]') as HTMLElement;
        if (panel) panel.scrollIntoView({ behavior: 'smooth' });
      },
    });

    return items;
  }, [chat, isFullscreen, toggleFullscreen, exportActions, inputActions]);

  return commandPaletteItems;
}
