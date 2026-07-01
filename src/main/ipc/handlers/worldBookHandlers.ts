import { ipcMain } from 'electron';
import { worldBookService } from '../../services/worldBookService';
import { resolveUserDataPlaceholder } from '../../utils/appPath';
import fs from 'fs/promises';
import path from 'path';

export function worldBookHandlers() {
  ipcMain.handle('worldBook:list', async () => {
    return await worldBookService.listWorldBooks();
  });

  ipcMain.handle('worldBook:read', async (_event, filePath: string) => {
    return await worldBookService.readWorldBook(filePath);
  });

  ipcMain.handle('worldBook:write', async (_event, filePath: string, data: any) => {
    return await worldBookService.writeWorldBook(filePath, data);
  });

  ipcMain.handle('worldBook:delete', async (_event, filePath: string) => {
    return await worldBookService.deleteWorldBook(filePath);
  });

  ipcMain.handle('worldBook:import', async (_event, sourcePath: string, fileName: string) => {
    return await worldBookService.importWorldBook(sourcePath, fileName);
  });

  ipcMain.handle('worldBook:optimize', async (_event, filePath: string) => {
    return await worldBookService.optimizeWorldBook(filePath);
  });

  ipcMain.handle('worldBook:getDirectory', async () => {
    return worldBookService.getWorldBookDir();
  });

  ipcMain.handle('worldBook:setDirectory', async (_event, dir: string) => {
    const resolvedDir = resolveUserDataPlaceholder(dir);
    worldBookService.setWorldBookDir(resolvedDir);
    return { success: true, worldBookDir: worldBookService.getWorldBookDir() };
  });

  ipcMain.handle('worldBook:readTags', async (_event, worldBookPath: string) => {
    return await worldBookService.readTags(worldBookPath);
  });

  ipcMain.handle('worldBook:writeTags', async (_event, worldBookPath: string, data: any) => {
    return await worldBookService.writeTags(worldBookPath, data);
  });

  ipcMain.handle('worldBook:deleteTags', async (_event, worldBookPath: string) => {
    return await worldBookService.deleteTags(worldBookPath);
  });

  ipcMain.handle('worldBook:saveToKnowledgeBase', async (_event, data: any, fileName: string) => {
    try {
      const worldBookDir = worldBookService.getWorldBookDir();
      
      await fs.mkdir(worldBookDir, { recursive: true });
      
      const filePath = path.join(worldBookDir, `${fileName}.json`);
      
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      
      const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      
      await fs.writeFile(filePath, content, 'utf8');
      
      return { 
        success: true, 
        filePath, 
        message: exists ? '文件已覆盖保存' : '文件已成功保存',
        fileExists: exists
      };
    } catch (error) {
      console.error('[worldBook:saveToKnowledgeBase] Failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  });

  ipcMain.handle('worldBook:checkFileExists', async (_event, fileName: string) => {
    try {
      const worldBookDir = worldBookService.getWorldBookDir();
      const filePath = path.join(worldBookDir, `${fileName}.json`);
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      return { success: true, exists, filePath };
    } catch (error) {
      return { success: false, exists: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('worldBook:vectorize', async (_event, worldBookPath: string) => {
    try {
      return await worldBookService.vectorizeWorldBook(worldBookPath);
    } catch (error) {
      return { 
        success: false, 
        descriptionVectorized: false, 
        entriesVectorized: 0, 
        entriesFailed: 0, 
        error: error instanceof Error ? error.message : 'Unknown error',
        entryVectorIds: []
      };
    }
  });
}
