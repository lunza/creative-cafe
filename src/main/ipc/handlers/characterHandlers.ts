import { ipcMain, app } from 'electron';
import { characterService } from '../../services/characterService';
import { getUserDataPath } from '../../utils/appPath';
import { getStorageService } from '../../services/storageService';

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

export function characterHandlers() {
  // 初始化时从设置中加载角色卡路径
  try {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    if (settings && settings.characterPath) {
      const resolvedPath = resolveUserDataPlaceholder(settings.characterPath);
      console.log('[characterHandlers] 从设置中加载角色卡路径:', resolvedPath);
      characterService.setCharacterDir(resolvedPath);
    } else {
      // 如果没有设置，使用默认路径
      const defaultPath = resolveUserDataPlaceholder('__USER_DATA__/data/characters');
      console.log('[characterHandlers] 使用默认角色卡路径:', defaultPath);
      characterService.setCharacterDir(defaultPath);
    }
  } catch (error) {
    console.error('[characterHandlers] 加载角色卡路径失败:', error);
    const defaultPath = resolveUserDataPlaceholder('__USER_DATA__/data/characters');
    characterService.setCharacterDir(defaultPath);
  }

  ipcMain.handle('character:list', async () => {
    return await characterService.listCharacters();
  });

  ipcMain.handle('character:read', async (_event, filePath: string) => {
    return await characterService.readCharacter(filePath);
  });

  ipcMain.handle('character:write', async (_event, filePath: string, data: any) => {
    return await characterService.writeCharacter(filePath, data);
  });

  ipcMain.handle('character:delete', async (_event, filePath: string) => {
    return await characterService.deleteCharacter(filePath);
  });

  ipcMain.handle('character:optimize', async (_event, filePath: string) => {
    return await characterService.optimizeCharacter(filePath);
  });

  ipcMain.handle('character:getDirectory', async () => {
    return characterService.getCharacterDir();
  });

  ipcMain.handle('character:testRead', async (_event, filePath: string) => {
    return await characterService.testReadCharacter(filePath);
  });

  ipcMain.handle('character:setDirectory', async (_event, dir: string) => {
    const resolvedDir = resolveUserDataPlaceholder(dir);
    console.log('character:setDirectory called with dir:', dir);
    console.log('character:setDirectory resolved dir:', resolvedDir);
    characterService.setCharacterDir(resolvedDir);
    const characterDir = characterService.getCharacterDir();
    console.log('Character directory after setting:', characterDir);
    return { success: true, characterDir };
  });

  ipcMain.handle('character:import', async (_event, sourcePath: string, fileName: string) => {
    return await characterService.importCharacter(sourcePath, fileName);
  });

  ipcMain.handle('character:getWorldBookRelations', async (_event, filePath: string) => {
    return await characterService.getWorldBookRelations(filePath);
  });

  ipcMain.handle('character:setWorldBookRelations', async (_event, filePath: string, relations: any[]) => {
    return await characterService.setWorldBookRelations(filePath, relations);
  });
}
