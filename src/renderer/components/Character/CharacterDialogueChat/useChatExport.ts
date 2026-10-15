/**
 * 【Phase 2 / M1 - conversation-mode-optimization-report】对话导出逻辑 Hook（God Component 拆分）。
 *
 * 收纳原 CharacterDialogueChat.tsx 中的导出菜单与版本恢复逻辑：
 * - EXPORT_MENU_ITEMS：ChatHeader 导出下拉菜单项（含 M5 多格式导出入口）
 * - handleSaveExport：选择目录并落盘（文件扩展名跟随 M5 导出格式）
 * - handleExportMenuClick：复制/保存/打开多格式导出对话框
 * - handleRestoreVersion：M6 整段对话回退到指定版本（UPDATE_MESSAGES）
 */
import { useCallback } from 'react';
import { message } from 'antd';
import { exportConversation } from './CharacterDialogueChat.utils';
import { EXPORT_FORMAT_EXTENSIONS, DialogueExportFormat } from './exportContent';
import { file as fileService } from '../../../services/characterChatService';
import { useChatUIStore } from './stores/useChatUIStore';
import { useChatGenerationStore } from './stores/useChatGenerationStore';
import { ChatMessage, CharacterInfo } from './CharacterDialogueChat.types';
import type { ChatHook } from './CharacterDialogueChat.hooks';

export const EXPORT_MENU_ITEMS = [
  { key: 'copy', label: '复制到剪贴板' },
  { key: 'save', label: '保存为文件（Markdown）' },
  // 【Phase 2 / M5】多格式导出入口（TXT/Markdown/HTML + 消息多选，N3）
  { key: 'select', label: '多格式导出（选择消息）…' },
];

export function useChatExport(chat: ChatHook, characterInfo: CharacterInfo) {
  const setExportDialogVisible = useChatUIStore(s => s.setExportDialogVisible);

  const handleSaveExport = useCallback(async (content: string, format: DialogueExportFormat = 'markdown') => {
    try {
      const dir = await fileService.selectDirectory();
      if (!dir) return;
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      // 【Phase 2 / M5】文件扩展名跟随导出格式
      const fileName = `${characterInfo.characterCardName}_对话_${stamp}.${EXPORT_FORMAT_EXTENSIONS[format]}`;
      const sep = dir.endsWith('/') || dir.endsWith('\\') ? '' : (dir.includes('\\') ? '\\' : '/');
      const fullPath = `${dir}${sep}${fileName}`;
      const result = await fileService.write(fullPath, content);
      if (result.success) {
        message.success('对话已保存');
      } else {
        message.error(result.error || '保存失败');
      }
    } catch {
      message.error('保存失败');
    }
  }, [characterInfo.characterCardName]);

  const handleExportMenuClick = useCallback((key: string) => {
    if (chat.stateWithVersionInfo.messages.length === 0) {
      message.warning('暂无消息可导出');
      return;
    }
    if (key === 'select') {
      // 【Phase 2 / M5】多格式导出对话框（消息多选）
      setExportDialogVisible(true);
      return;
    }
    const content = exportConversation(chat.stateWithVersionInfo.messages, characterInfo.characterCardName);
    if (key === 'copy') {
      navigator.clipboard.writeText(content).then(
        () => message.success('已复制到剪贴板'),
        () => message.error('复制失败')
      );
    } else if (key === 'save') {
      handleSaveExport(content);
    }
  }, [chat.stateWithVersionInfo.messages, characterInfo.characterCardName, handleSaveExport, setExportDialogVisible]);

  // 【Phase 2 / M6】恢复版本：整段对话回退到指定版本的消息列表（N1）。
  // UPDATE_MESSAGES 仅替换消息列表，不改变 loading/streaming/error 状态。
  const handleRestoreVersion = useCallback((msgs: ChatMessage[]) => {
    useChatGenerationStore.getState().dispatch({ type: 'UPDATE_MESSAGES', messages: msgs });
  }, []);

  return { handleSaveExport, handleExportMenuClick, handleRestoreVersion };
}

export type ChatExportActions = ReturnType<typeof useChatExport>;
