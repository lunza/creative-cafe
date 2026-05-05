import { ipcMain } from 'electron';
import { worldBookService } from '../../services/worldBookService';
import { getUserDataPath } from '../../utils/appPath';

function resolveUserDataPlaceholder(dir: string): string {
  console.log('[resolveUserDataPlaceholder] 输入路径:', dir);
  const userDataPath = getUserDataPath();
  console.log('[resolveUserDataPlaceholder] 用户数据目录:', userDataPath);
  if (dir.includes('__USER_DATA__')) {
    const resolved = dir.replace(/__USER_DATA__/g, userDataPath);
    console.log('[resolveUserDataPlaceholder] 解析后路径:', resolved);
    return resolved;
  }
  console.log('[resolveUserDataPlaceholder] 路径不含占位符,直接返回');
  return dir;
}

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

  // 世界书向量化处理
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
