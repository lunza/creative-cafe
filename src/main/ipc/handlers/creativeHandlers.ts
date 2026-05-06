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

function getCreativeDataPath(): string {
  const dataDir = path.join(getUserDataPath(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
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

  ipcMain.handle('creative:getDirectory', async () => {
    return getCreativeDataPath();
  });

  console.log('[Creative] Creative handlers registered');
}
