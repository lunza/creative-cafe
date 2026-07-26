import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getUserDataPath } from '../utils/appPath';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  suggestedOptions?: string[];
}

interface ChatData {
  id: string;
  creativeId: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface TestChatData extends ChatData {
  characterCardId: string;
  characterCardName: string;
}

interface CacheEntry {
  data: any;
  timestamp: number;
}

class ChatStorageService {
  private baseDir: string;
  private cache: Map<string, CacheEntry>;
  private initialized: boolean;
  private migrated: boolean;

  private readonly CACHE_TTL = 60000;

  constructor() {
    const dataDir = path.join(getUserDataPath(), 'data', 'memories', 'chats');
    this.baseDir = dataDir;
    this.cache = new Map();
    this.initialized = false;
    this.migrated = false;
  }

  private async initDirectories(): Promise<void> {
    if (this.initialized) return;
    
    await fs.mkdir(this.baseDir, { recursive: true });
    
    this.initialized = true;
    console.log('[ChatStorage] Directory initialized:', this.baseDir);
  }

  private async migrateOldTestDirectory(): Promise<void> {
    if (this.migrated) return;
    
    const oldTestDir = path.join(this.baseDir, 'test');
    
    if (!fsSync.existsSync(oldTestDir)) {
      this.migrated = true;
      return;
    }

    try {
      const files = await fs.readdir(oldTestDir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const oldPath = path.join(oldTestDir, file);
          const newPath = path.join(this.baseDir, file);
          
          await fs.rename(oldPath, newPath);
          console.log('[ChatStorage] Migrated chat file:', file);
        } catch (error) {
          console.warn('[ChatStorage] Failed to migrate file:', file, error);
        }
      }

      await fs.rmdir(oldTestDir);
      console.log('[ChatStorage] Removed old test directory');
    } catch (error) {
      console.warn('[ChatStorage] Migration failed:', error);
    }
    
    this.migrated = true;
  }

  private sanitizeFileName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .substring(0, 50);
  }

  private generateShortId(longPath: string): string {
    const basename = path.basename(longPath);
    const nameWithoutExt = basename.replace(/\.[^/.]+$/, '');
    return nameWithoutExt.substring(0, 30);
  }

  private getChatFilePath(creativeId: string, characterCardId: string, characterCardName: string): string {
    const shortId = this.generateShortId(creativeId);
    const safeName = this.sanitizeFileName(characterCardName || shortId);
    const fileName = `${safeName}.json`;
    return path.join(this.baseDir, fileName);
  }

  private getCacheKey(type: string, ...args: string[]): string {
    return `${type}_${args.join('_')}`;
  }

  private getFromCache(key: string): any | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  private invalidateCache(key: string): void {
    this.cache.delete(key);
  }

  clearCache(): void {
    this.cache.clear();
    console.log('[ChatStorage] Cache cleared');
  }

  async getTestChat(creativeId: string, characterCardId: string): Promise<TestChatData | null> {
    await this.initDirectories();
    await this.migrateOldTestDirectory();
    
    const cacheKey = this.getCacheKey('chat', creativeId, characterCardId);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    const shortId = this.generateShortId(creativeId);
    
    try {
      // First try to find by scanning directory for matching file
      const files = await fs.readdir(this.baseDir);
      let filePath: string | null = null;
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePathFull = path.join(this.baseDir, file);
        try {
          const data = await fs.readFile(filePathFull, 'utf8');
          const chatData = JSON.parse(data);
          if (chatData.creativeId === creativeId && chatData.characterCardId === characterCardId) {
            filePath = filePathFull;
            const chatDataWithCache: TestChatData = chatData;
            this.setCache(cacheKey, chatDataWithCache);
            return chatDataWithCache;
          }
        } catch {
          continue;
        }
      }
      
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      console.error('[ChatStorage] Failed to read chat:', { creativeId, characterCardId, error });
      return null;
    }
  }

  async saveTestChat(data: TestChatData): Promise<TestChatData> {
    await this.initDirectories();
    await this.migrateOldTestDirectory();
    
    const { creativeId, characterCardId, characterCardName } = data;
    const filePath = this.getChatFilePath(creativeId, characterCardId, characterCardName);
    const cacheKey = this.getCacheKey('chat', creativeId, characterCardId);

    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      this.setCache(cacheKey, data);
      console.log('[ChatStorage] Chat saved:', { creativeId, characterCardId, characterCardName, fileName: path.basename(filePath) });
      return data;
    } catch (error) {
      console.error('[ChatStorage] Failed to save chat:', { creativeId, characterCardId, error });
      throw error;
    }
  }

  async deleteTestChat(creativeId: string, characterCardId: string): Promise<boolean> {
    await this.initDirectories();
    await this.migrateOldTestDirectory();
    
    const cacheKey = this.getCacheKey('chat', creativeId, characterCardId);

    try {
      const files = await fs.readdir(this.baseDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(this.baseDir, file);
        try {
          const data = await fs.readFile(filePath, 'utf8');
          const chatData = JSON.parse(data);
          if (chatData.creativeId === creativeId && chatData.characterCardId === characterCardId) {
            await fs.unlink(filePath);
            this.invalidateCache(cacheKey);
            console.log('[ChatStorage] Chat deleted:', { creativeId, characterCardId, fileName: file });
            return true;
          }
        } catch {
          continue;
        }
      }
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      console.error('[ChatStorage] Failed to delete chat:', { creativeId, characterCardId, error });
      throw error;
    }
  }

  async getAllTestChats(): Promise<TestChatData[]> {
    await this.initDirectories();
    await this.migrateOldTestDirectory();
    
    const chats: TestChatData[] = [];

    try {
      const files = await fs.readdir(this.baseDir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const filePath = path.join(this.baseDir, file);
          const data = await fs.readFile(filePath, 'utf8');
          const chatData: TestChatData = JSON.parse(data);
          chats.push(chatData);
        } catch (error) {
          console.warn('[ChatStorage] Failed to read chat file:', file, error);
        }
      }

      console.log('[ChatStorage] Loaded all chats:', chats.length);
      return chats;
    } catch (error) {
      console.error('[ChatStorage] Failed to list chats:', error);
      return [];
    }
  }
}

export const chatStorageService = new ChatStorageService();
export type { ChatMessage, ChatData, TestChatData };
