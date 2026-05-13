import { ipcMain } from 'electron';
import { GroupChatStorageService } from '../../services/GroupChat/GroupChatStorageService';
import { GroupChatHeader, GroupChatMessage } from '../../../shared/types/groupChat.types';
import { getUserDataPath } from '../../utils/appPath';
import path from 'path';

function getDirectories() {
  const userDataPath = getUserDataPath();
  const groupChatsDir = path.join(userDataPath, 'data', 'groupchats');
  
  // 确保 groupchats 目录存在
  const fs = require('fs');
  if (!fs.existsSync(groupChatsDir)) {
    fs.mkdirSync(groupChatsDir, { recursive: true });
  }
  
  return { groupChats: groupChatsDir };
}

let serviceInstance: GroupChatStorageService | null = null;

function getService(): GroupChatStorageService {
  if (!serviceInstance) {
    const directories = getDirectories();
    serviceInstance = GroupChatStorageService.getInstance(directories as any);
  }
  return serviceInstance;
}

export function registerGroupChatHandlers(): void {
  ipcMain.handle(
    'group-chat:get',
    async (_event, chatId: string): Promise<(GroupChatHeader | GroupChatMessage)[]> => {
      return await getService().getChat(chatId);
    }
  );

  ipcMain.handle(
    'group-chat:save',
    async (
      _event,
      chatId: string,
      chat: (GroupChatHeader | GroupChatMessage)[],
      force: boolean = false
    ): Promise<{ ok: true } | { error: string }> => {
      return await getService().saveChat(chatId, chat, force);
    }
  );

  ipcMain.handle(
    'group-chat:delete',
    async (_event, chatId: string): Promise<boolean> => {
      return await getService().deleteChat(chatId);
    }
  );

  ipcMain.handle(
    'group-chat:info',
    async (_event, chatId: string) => {
      return await getService().getChatInfo(chatId);
    }
  );

  ipcMain.handle(
    'group-chat:import',
    async (_event, content: string, suggestedId?: string): Promise<string> => {
      return await getService().importChat(content, suggestedId);
    }
  );
}
