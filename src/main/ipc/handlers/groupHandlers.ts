import { ipcMain } from 'electron';
import { GroupStorageService } from '../../services/GroupChat/GroupStorageService';
import { Group } from '../../../shared/types/groupChat.types';
import { getStorageService } from '../../services/storageService';
import { getUserDataPath } from '../../utils/appPath';
import path from 'path';

function getDirectories() {
  const userDataPath = getUserDataPath();
  const groupsDir = path.join(userDataPath, 'data', 'groups');
  
  // 确保 groups 目录存在
  const fs = require('fs');
  if (!fs.existsSync(groupsDir)) {
    fs.mkdirSync(groupsDir, { recursive: true });
  }
  
  return { groups: groupsDir };
}

let serviceInstance: GroupStorageService | null = null;

function getService(): GroupStorageService {
  if (!serviceInstance) {
    const directories = getDirectories();
    serviceInstance = GroupStorageService.getInstance(directories as any);
  }
  return serviceInstance;
}

export function registerGroupHandlers(): void {
  ipcMain.handle('group:getAll', async (): Promise<Group[]> => {
    return await getService().getAllGroups();
  });

  ipcMain.handle('group:get', async (_event, id: string): Promise<Group | null> => {
    return await getService().getGroup(id);
  });

  ipcMain.handle('group:create', async (_event, data: Partial<Group>): Promise<Group> => {
    return await getService().createGroup(data);
  });

  ipcMain.handle('group:edit', async (_event, group: Group): Promise<boolean> => {
    return await getService().editGroup(group);
  });

  ipcMain.handle('group:delete', async (_event, id: string): Promise<boolean> => {
    return await getService().deleteGroup(id);
  });
}
