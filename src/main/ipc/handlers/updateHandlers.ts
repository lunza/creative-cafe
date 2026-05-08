import { ipcMain } from 'electron';

export function updateHandlers() {
  ipcMain.handle('update:check', async () => {
    return { 
      success: false, 
      message: '更新功能尚未实现',
      data: { hasUpdate: false, currentVersion: '1.0.0', latestVersion: '1.0.0' }
    };
  });

  ipcMain.handle('update:download', async (_event, latestVersion: string) => {
    return { success: false, message: '更新功能尚未实现' };
  });

  ipcMain.handle('update:install', async (_event, downloadPath: string) => {
    return { success: false, message: '更新功能尚未实现' };
  });
}
