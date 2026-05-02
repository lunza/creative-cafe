import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../../utils/appPath';

interface Version {
  id: string;
  content: string;
  timestamp: number;
  description?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface CharacterCard {
  id: string;
  name: string;
  content: string;
  versions: Version[];
  chatHistory: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface WorldBook {
  id: string;
  name: string;
  content: string;
  versions: Version[];
  chatHistory: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface Creative {
  id: string;
  title: string;
  description: string;
  content: string;
  tags: string[];
  characterCards: CharacterCard[];
  worldBooks: WorldBook[];
  createdAt: number;
  updatedAt: number;
}

interface CreativeData {
  creatives: Creative[];
  currentCreativeId: string | null;
  currentEditorTarget: { type: 'character' | 'worldbook'; id: string } | null;
}

// 旧数据结构，用于迁移
interface OldCreativeItem {
  id: string;
  title: string;
  content: string;
  type: 'character' | 'worldbook';
  status: 'draft' | 'in_progress' | 'completed';
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  versions?: {
    id: string;
    content: string;
    timestamp: number;
  }[];
}

interface OldCreativeData {
  creativeItems: OldCreativeItem[];
  currentCreativeId: string | null;
}

function getCreativeDataPath(): string {
  const dataDir = path.join(getUserDataPath(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, 'creative-data.json');
}

function getOldCreativeDataPath(): string {
  const dataDir = path.join(getUserDataPath(), 'data');
  return path.join(dataDir, 'creative-data.json');
}

function loadCreativeData(): CreativeData {
  const dataPath = getCreativeDataPath();
  try {
    if (fs.existsSync(dataPath)) {
      const data = fs.readFileSync(dataPath, 'utf8');
      const parsed = JSON.parse(data);
      return {
        creatives: parsed.creatives || [],
        currentCreativeId: parsed.currentCreativeId || null,
        currentEditorTarget: parsed.currentEditorTarget || null
      };
    }
  } catch (error) {
    console.error('[Creative] Failed to load creative data:', error);
  }
  return {
    creatives: [],
    currentCreativeId: null,
    currentEditorTarget: null
  };
}

function saveCreativeData(data: CreativeData): boolean {
  const dataPath = getCreativeDataPath();
  try {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('[Creative] Failed to save creative data:', error);
    return false;
  }
}

function migrateOldData(): { success: boolean; data?: CreativeData; error?: string } {
  const oldDataPath = getOldCreativeDataPath();
  try {
    if (!fs.existsSync(oldDataPath)) {
      return { success: false, error: 'Old data file not found' };
    }

    const oldData = fs.readFileSync(oldDataPath, 'utf8');
    const parsedOldData = JSON.parse(oldData);

    // 检查是否是旧格式
    if (parsedOldData.creativeItems && Array.isArray(parsedOldData.creativeItems)) {
      // 备份旧数据
      const backupPath = path.join(
        path.dirname(oldDataPath),
        `creative-data-backup-${Date.now()}.json`
      );
      fs.copyFileSync(oldDataPath, backupPath);

      // 转换数据
      const oldCreativeItems: OldCreativeItem[] = parsedOldData.creativeItems || [];
      const newCreatives: Creative[] = [];

      // 将旧的项目按类型分组，每类一个创意
      const characterItems = oldCreativeItems.filter(item => item.type === 'character');
      const worldbookItems = oldCreativeItems.filter(item => item.type === 'worldbook');

      // 创建角色卡创意
      if (characterItems.length > 0) {
        const characterCreative: Creative = {
          id: `migrated-creative-characters-${Date.now()}`,
          title: '迁移的角色卡',
          description: '从旧系统迁移的角色卡数据',
          content: '',
          tags: ['迁移'],
          characterCards: characterItems.map(item => ({
            id: item.id,
            name: item.title,
            content: item.content,
            versions: (item.versions || []).map(v => ({
              id: v.id,
              content: v.content,
              timestamp: v.timestamp,
              description: '迁移的版本'
            })),
            chatHistory: [],
            createdAt: item.createdAt,
            updatedAt: item.updatedAt
          })),
          worldBooks: [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        newCreatives.push(characterCreative);
      }

      // 创建世界书创意
      if (worldbookItems.length > 0) {
        const worldbookCreative: Creative = {
          id: `migrated-creative-worldbooks-${Date.now()}`,
          title: '迁移的世界书',
          description: '从旧系统迁移的世界书数据',
          content: '',
          tags: ['迁移'],
          characterCards: [],
          worldBooks: worldbookItems.map(item => ({
            id: item.id,
            name: item.title,
            content: item.content,
            versions: (item.versions || []).map(v => ({
              id: v.id,
              content: v.content,
              timestamp: v.timestamp,
              description: '迁移的版本'
            })),
            chatHistory: [],
            createdAt: item.createdAt,
            updatedAt: item.updatedAt
          })),
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        newCreatives.push(worldbookCreative);
      }

      // 如果没有分类的数据，创建默认创意
      if (newCreatives.length === 0 && oldCreativeItems.length > 0) {
        const defaultCreative: Creative = {
          id: `migrated-creative-default-${Date.now()}`,
          title: '迁移的创意',
          description: '从旧系统迁移的创意数据',
          content: '',
          tags: ['迁移'],
          characterCards: oldCreativeItems.filter(item => item.type === 'character').map(item => ({
            id: item.id,
            name: item.title,
            content: item.content,
            versions: (item.versions || []).map(v => ({
              id: v.id,
              content: v.content,
              timestamp: v.timestamp,
              description: '迁移的版本'
            })),
            chatHistory: [],
            createdAt: item.createdAt,
            updatedAt: item.updatedAt
          })),
          worldBooks: oldCreativeItems.filter(item => item.type === 'worldbook').map(item => ({
            id: item.id,
            name: item.title,
            content: item.content,
            versions: (item.versions || []).map(v => ({
              id: v.id,
              content: v.content,
              timestamp: v.timestamp,
              description: '迁移的版本'
            })),
            chatHistory: [],
            createdAt: item.createdAt,
            updatedAt: item.updatedAt
          })),
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        newCreatives.push(defaultCreative);
      }

      const newData: CreativeData = {
        creatives: newCreatives,
        currentCreativeId: newCreatives.length > 0 ? newCreatives[0].id : null,
        currentEditorTarget: null
      };

      saveCreativeData(newData);
      console.log('[Creative] Old data migrated successfully');
      return { success: true, data: newData };
    }

    return { success: false, error: 'No old data found or already migrated' };
  } catch (error) {
    console.error('[Creative] Failed to migrate old data:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown migration error'
    };
  }
}

export function registerCreativeHandlers(): void {
  ipcMain.handle('creative:load', async () => {
    console.log('[Creative] Handler creative:load called');
    return loadCreativeData();
  });

  ipcMain.handle('creative:save', async (_event, data: CreativeData) => {
    console.log('[Creative] Handler creative:save called');
    return saveCreativeData(data);
  });

  ipcMain.handle('creative:export', async () => {
    console.log('[Creative] Handler creative:export called');
    const data = loadCreativeData();
    return JSON.stringify(
      {
        version: '2.0',
        exportTime: new Date().toISOString(),
        ...data
      },
      null,
      2
    );
  });

  ipcMain.handle('creative:import', async (_event, jsonData: string) => {
    console.log('[Creative] Handler creative:import called');
    try {
      const parsed = JSON.parse(jsonData);
      const creatives = parsed.creatives && Array.isArray(parsed.creatives) ? parsed.creatives : [];
      const currentCreativeId = parsed.currentCreativeId || (creatives.length > 0 ? creatives[0].id : null);
      const currentEditorTarget = parsed.currentEditorTarget || null;
      const data: CreativeData = { creatives, currentCreativeId, currentEditorTarget };
      saveCreativeData(data);
      return { success: true, data };
    } catch (error) {
      console.error('[Creative] Failed to import creative data:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('creative:migrate', async () => {
    console.log('[Creative] Handler creative:migrate called');
    return migrateOldData();
  });

  ipcMain.handle('creative:getDirectory', async () => {
    return getCreativeDataPath();
  });

  console.log('[Creative] Creative handlers registered');
}
