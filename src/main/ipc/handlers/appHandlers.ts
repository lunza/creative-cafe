import { ipcMain, app, shell } from 'electron';
import path from 'path';
import * as fs from 'fs';

export function appHandlers() {
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:getPlatform', () => {
    return process.platform;
  });

  ipcMain.handle('app:openPath', async (_event, path: string) => {
    await shell.openPath(path);
  });

  ipcMain.handle('app:getRootPath', () => {
    return path.join(__dirname, '../..');
  });

  ipcMain.handle('app:getUserDataPath', () => {
    return app.getPath('userData');
  });

  ipcMain.handle('app:openConfigFile', async () => {
    try {
      const userDataPath = app.getPath('userData');
      const configPath = path.join(userDataPath, 'data', 'settings.json');
      if (!fs.existsSync(configPath)) {
        return false;
      }
      await shell.openPath(configPath);
      return true;
    } catch {
      return false;
    }
  });
}
