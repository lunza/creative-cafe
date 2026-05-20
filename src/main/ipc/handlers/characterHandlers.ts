import { ipcMain, app } from 'electron';
import { characterService, encode } from '../../services/characterService';
import { getUserDataPath } from '../../utils/appPath';
import { getStorageService } from '../../services/storageService';
import fs from 'fs/promises';
import path from 'path';
import extract from 'png-chunks-extract';
import * as PNGtext from 'png-chunk-text';

// 配置文件路径：与角色卡同目录、同名，扩展名改为 .json
// 例如：角色卡路径为 "data/characters/克拉拉.png" → 配置文件为 "data/characters/克拉拉.json"
function getConfigFilePath(characterCardPath: string): string {
  const ext = path.extname(characterCardPath);
  return characterCardPath.replace(new RegExp(`${ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '.json');
}

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

  ipcMain.handle('character:createFromImage', async (_event, filePath: string, imageDataBase64: string, characterData: any) => {
    return await characterService.createCharacterFromImage(filePath, imageDataBase64, characterData);
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

  // Character config save/load handlers
  ipcMain.handle('characterConfig:save', async (_event, characterCardId: string, config: any) => {
    try {
      console.log('[characterConfig:save] Saving config for characterCardId:', characterCardId);
      console.log('[characterConfig:save] Config data:', config ? JSON.stringify(config, null, 2).substring(0, 200) : 'null');
      
      if (!characterCardId) {
        console.error('[characterConfig:save] characterCardId is empty!');
        return { success: false, error: '角色卡ID无效' };
      }
      
      const filePath = getConfigFilePath(characterCardId);
      console.log('[characterConfig:save] File path:', filePath);
      
      await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
      console.log('[characterConfig:save] Successfully saved config to:', filePath);
      return { success: true };
    } catch (error) {
      console.error('[characterConfig:save] Failed to save config:', error);
      console.error('[characterConfig:save] Error stack:', error instanceof Error ? error.stack : 'N/A');
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('characterConfig:load', async (_event, characterCardId: string) => {
    try {
      const filePath = getConfigFilePath(characterCardId);
      console.log('[characterConfig:load] Trying to load config from:', filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      console.log('[characterConfig:load] Successfully loaded config from:', filePath);
      return { success: true, config: JSON.parse(content) };
    } catch (error) {
      console.log('[characterConfig:load] No saved config for:', characterCardId, error instanceof Error ? error.message : 'Unknown error');
      return { success: false, config: null };
    }
  });

  // ========== 导出PNG到角色卡目录 ==========
  
  /**
   * 保存PNG角色卡到角色卡目录（包含正确的chara和ccv3 tEXt chunks）
   * @param params.base64Image PNG图片的base64编码
   * @param params.filename 文件名（不含扩展名）
   * @param params.characterData 角色卡数据
   */
  ipcMain.handle('character:savePNGToDirectory', async (_event, params: {
    base64Image: string;
    filename: string;
    characterData: any;
  }) => {
    try {
      console.log('[character:savePNGToDirectory] Starting save:', { filename: params.filename });
      
      const { base64Image, filename, characterData } = params;
      
      // 从base64解码为Buffer
      const base64Data = base64Image.replace(/^data:image\/png;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      
      // 使用png-chunks-extract解析PNG chunks
      const chunks = extract(new Uint8Array(imageBuffer));
      
      // 移除已有的chara和ccv3 chunks（如果有）
      const tEXtChunks = chunks.filter(chunk => chunk.name === 'tEXt');
      for (const tEXtChunk of tEXtChunks) {
        const chunkData = PNGtext.decode(tEXtChunk.data);
        if (chunkData.keyword.toLowerCase() === 'chara' || chunkData.keyword.toLowerCase() === 'ccv3') {
          chunks.splice(chunks.indexOf(tEXtChunk), 1);
        }
      }
      
      // 创建V2格式的chara chunk
      console.log('[character:savePNGToDirectory] V2 data:', characterData.data);
      const v2Data = JSON.stringify(characterData.data);
      const v2Base64 = Buffer.from(v2Data, 'utf8').toString('base64');
      chunks.splice(-1, 0, PNGtext.encode('chara', v2Base64));
      
      // 创建V3格式的ccv3 chunk
      const v3Data = {
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: characterData.data
      };
      console.log('[character:savePNGToDirectory] V3 data:', v3Data);
      const v3Base64 = Buffer.from(JSON.stringify(v3Data), 'utf8').toString('base64');
      chunks.splice(-1, 0, PNGtext.encode('ccv3', v3Base64));
      
      // 使用png-chunks-encode重新编码PNG
      const newBuffer = Buffer.from(encode(chunks));
      
      console.log('[character:savePNGToDirectory] PNG encoded successfully, size:', newBuffer.length);
      
      const characterDir = characterService.getCharacterDir();
      console.log('[character:savePNGToDirectory] Character directory:', characterDir);
      
      // 确保目录存在
      try {
        await fs.access(characterDir);
      } catch {
        await fs.mkdir(characterDir, { recursive: true });
        console.log('[character:savePNGToDirectory] Created character directory:', characterDir);
      }
      
      // 构建完整文件路径
      const filePath = path.join(characterDir, `${filename}.png`);
      console.log('[character:savePNGToDirectory] File path:', filePath);
      
      // 写入处理后的PNG文件
      await fs.writeFile(filePath, newBuffer);
      console.log('[character:savePNGToDirectory] Successfully saved:', filePath);
      
      return { success: true, path: filePath };
    } catch (error) {
      console.error('[character:savePNGToDirectory] Failed to save:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      };
    }
  });

  ipcMain.handle('character:checkPNGExists', async (_event, filename: string) => {
    try {
      const characterDir = characterService.getCharacterDir();
      const filePath = path.join(characterDir, `${filename}.png`);
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      return { success: true, exists, filePath };
    } catch (error) {
      return { success: false, exists: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ========== 导出角色卡（使用正确的PNG chunk处理） ==========
  
  /**
   * 导出角色卡为PNG文件（包含正确的chara和ccv3 tEXt chunks）
   * @param base64Image PNG图片的base64编码
   * @param filename 文件名
   * @param characterData 角色卡数据
   */
  ipcMain.handle('character:exportCharacterCard', async (_event, params: {
    base64Image: string;
    filename: string;
    characterData: any;
  }) => {
    try {
      console.log('[character:exportCharacterCard] Starting export:', { filename: params.filename });
      
      const { base64Image, filename, characterData } = params;
      
      // 从base64解码为Buffer
      const base64Data = base64Image.replace(/^data:image\/png;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      
      // 使用png-chunks-extract解析PNG chunks
      const chunks = extract(new Uint8Array(imageBuffer));
      
      // 移除已有的chara和ccv3 chunks（如果有）
      const tEXtChunks = chunks.filter(chunk => chunk.name === 'tEXt');
      for (const tEXtChunk of tEXtChunks) {
        const chunkData = PNGtext.decode(tEXtChunk.data);
        if (chunkData.keyword.toLowerCase() === 'chara' || chunkData.keyword.toLowerCase() === 'ccv3') {
          chunks.splice(chunks.indexOf(tEXtChunk), 1);
        }
      }
      
      // 创建V2格式的chara chunk
      const v2Data = JSON.stringify(characterData.data);
      const v2Base64 = Buffer.from(v2Data, 'utf8').toString('base64');
      chunks.splice(-1, 0, PNGtext.encode('chara', v2Base64));
      
      // 创建V3格式的ccv3 chunk
      const v3Data = {
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: characterData.data
      };
      const v3Base64 = Buffer.from(JSON.stringify(v3Data), 'utf8').toString('base64');
      chunks.splice(-1, 0, PNGtext.encode('ccv3', v3Base64));
      
      // 使用png-chunks-encode重新编码PNG
      const newBuffer = Buffer.from(encode(chunks));
      
      console.log('[character:exportCharacterCard] PNG encoded successfully, size:', newBuffer.length);
      
      // 将编码后的PNG转回base64返回给前端
      const resultBase64 = newBuffer.toString('base64');
      
      return { 
        success: true, 
        base64Png: `data:image/png;base64,${resultBase64}`
      };
    } catch (error) {
      console.error('[character:exportCharacterCard] Failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      };
    }
  });
}
