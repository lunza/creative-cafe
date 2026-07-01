import { ipcMain } from 'electron';
import { avatarService } from '../../services/avatarService';
import { resolveUserDataPlaceholder } from '../../utils/appPath';

export function avatarHandlers() {
  ipcMain.handle('avatar:list', async () => {
    return await avatarService.listAvatars();
  });

  ipcMain.handle('avatar:read', async (_event, path: string) => {
    return await avatarService.readAvatar(path);
  });

  ipcMain.handle('avatar:write', async (_event, path: string, data: any) => {
    return await avatarService.writeAvatar(path, data);
  });

  ipcMain.handle('avatar:delete', async (_event, path: string) => {
    return await avatarService.deleteAvatar(path);
  });

  ipcMain.handle('avatar:getDirectory', async () => {
    return avatarService.getAvatarDir();
  });

  ipcMain.handle('avatar:setDirectory', async (_event, dir: string) => {
    const resolvedDir = resolveUserDataPlaceholder(dir);
    console.log('avatar:setDirectory called with dir:', dir);
    console.log('avatar:setDirectory resolved dir:', resolvedDir);
    avatarService.setAvatarDir(resolvedDir);
    const avatarDir = avatarService.getAvatarDir();
    console.log('Avatar directory after setting:', avatarDir);
    return { success: true, avatarDir };
  });
}
