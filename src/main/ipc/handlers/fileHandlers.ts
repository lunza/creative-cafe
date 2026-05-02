import { ipcMain, dialog, shell, app } from 'electron';
import { fileService } from '../../services/fileService';
import { pathService } from '../../services/pathService';
import * as fs from 'fs';
import * as path from 'path';
import JSON5 from 'json5';

function getSettingData(): any {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'storage', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      return JSON5.parse(content);
    }
  } catch {
    // ignore
  }
  return null;
}

function resolveSettingPath(key: string, defaultModule: string): string {
  const data = getSettingData();
  const customPath = data?.data?.[key];
  if (customPath && customPath.startsWith('__USER_DATA__')) {
    return customPath.replace('__USER_DATA__', app.getPath('userData'));
  }
  return customPath || pathService.getDefaultPath(defaultModule);
}

export function fileHandlers() {
  ipcMain.handle('file:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('file:selectFile', async (_event, filters: any[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('file:exists', async (_event, path: string) => {
    return await fileService.exists(path);
  });

  ipcMain.handle('file:read', async (_event, path: string) => {
    return await fileService.readFile(path);
  });

  ipcMain.handle('file:write', async (_event, path: string, content: string) => {
    try {
      await fileService.writeFile(path, content);
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  });

  ipcMain.handle('file:openFolder', async (_event, pathOrModule: string) => {
    try {
      let folderPath: string;
      
      if (pathOrModule === 'worldbook' || pathOrModule === 'worldbooks') {
        folderPath = resolveSettingPath('worldBookPath', 'worldbook');
      } else if (pathOrModule === 'character' || pathOrModule === 'characters') {
        folderPath = resolveSettingPath('characterPath', 'character');
      } else if (pathOrModule === 'avatar' || pathOrModule === 'avatars') {
        folderPath = resolveSettingPath('avatarPath', 'avatar');
      } else if (pathOrModule === 'creative' || pathOrModule === 'creatives') {
        folderPath = resolveSettingPath('creativePath', 'creative');
      } else if (pathOrModule === 'memory' || pathOrModule === 'memories') {
        folderPath = resolveSettingPath('memoryPath', 'memory');
      } else {
        folderPath = pathOrModule;
      }

      if (!fs.existsSync(folderPath)) {
        try {
          fs.mkdirSync(folderPath, { recursive: true });
          console.log(`[fileHandlers] Created directory: ${folderPath}`);
        } catch (err) {
          return { success: false, message: `无法创建目录: ${folderPath}` };
        }
      }
      
      const result = await shell.openPath(folderPath);
      return { success: true };
    } catch (error) {
      console.error('Error opening folder:', error);
      return { success: false, message: error instanceof Error ? error.message : '未知错误' };
    }
  });

  ipcMain.handle('file:openFile', async (_event, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }
      await shell.openPath(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('file:validatePath', async (_event, targetPath: string) => {
    return pathService.validatePath(targetPath);
  });

  ipcMain.handle('file:readJson', async (_event, fileName: string) => {
    return await fileService.readJsonFile(fileName);
  });

  ipcMain.handle('file:readAsBase64', async (_event, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' };
      }
      const fileBuffer = fs.readFileSync(filePath);
      const mimeType = getMimeType(filePath);
      const base64 = fileBuffer.toString('base64');
      return { success: true, data: `data:${mimeType};base64,${base64}` };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  });

  function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  ipcMain.handle('file:writeBinary', async (_event, filePath: string, content: string, isBase64: boolean = true) => {
    try {
      await fileService.writeBinaryFile(filePath, content, isBase64);
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  });

  ipcMain.handle('file:copyFile', async (_event, sourcePath: string, targetPath: string) => {
    try {
      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: 'Source file not found' };
      }
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.copyFileSync(sourcePath, targetPath);
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  });
}
