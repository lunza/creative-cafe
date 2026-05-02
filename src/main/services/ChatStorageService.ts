import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getUserDataPath } from '../utils/appPath';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
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

interface GenerationChatData extends ChatData {
  targetType: 'character' | 'worldbook';
  name: string;
}

interface CacheEntry {
  data: any;
  timestamp: number;
}

interface MigrationResult {
  success: boolean;
  migrated: number;
  errors: string[];
}

class ChatStorageService {
  private baseDir: string;
  private testDir: string;
  private generationDir: string;
  private migrationBackupDir: string;
  private cache: Map<string, CacheEntry>;
  private initialized: boolean;

  private readonly CACHE_TTL = 60000;

  constructor() {
    const dataDir = path.join(getUserDataPath(), 'data', 'character-chats');
    this.baseDir = dataDir;
    this.testDir = path.join(dataDir, 'test');
    this.generationDir = path.join(dataDir, 'generation');
    this.migrationBackupDir = path.join(dataDir, 'migration_backup');
    this.cache = new Map();
    this.initialized = false;
  }

  private async initDirectories(): Promise<void> {
    if (this.initialized) return;
    
    await fs.mkdir(this.testDir, { recursive: true });
    await fs.mkdir(this.generationDir, { recursive: true });
    await fs.mkdir(this.migrationBackupDir, { recursive: true });
    
    this.initialized = true;
    console.log('[ChatStorage] Directories initialized:', this.baseDir);
  }

  private sanitizeFileName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .substring(0, 100);
  }

  private getTestChatFilePath(creativeId: string, characterCardId: string): string {
    const safeCreativeId = this.sanitizeFileName(creativeId);
    const safeCharacterCardId = this.sanitizeFileName(characterCardId);
    const fileName = `${safeCreativeId}_${safeCharacterCardId}.json`;
    return path.join(this.testDir, fileName);
  }

  private getGenerationChatFilePath(creativeId: string, targetType: string, name: string): string {
    const safeCreativeId = this.sanitizeFileName(creativeId);
    const safeTargetType = this.sanitizeFileName(targetType);
    const safeName = this.sanitizeFileName(name);
    const fileName = `${safeCreativeId}_${safeTargetType}_${safeName}.json`;
    return path.join(this.generationDir, fileName);
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
    
    const cacheKey = this.getCacheKey('test', creativeId, characterCardId);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    const filePath = this.getTestChatFilePath(creativeId, characterCardId);
    
    try {
      if (!fsSync.existsSync(filePath)) {
        return null;
      }

      const data = await fs.readFile(filePath, 'utf8');
      const chatData: TestChatData = JSON.parse(data);
      this.setCache(cacheKey, chatData);
      return chatData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      console.error('[ChatStorage] Failed to read test chat:', { creativeId, characterCardId, error });
      return null;
    }
  }

  async saveTestChat(data: TestChatData): Promise<TestChatData> {
    await this.initDirectories();
    
    const { creativeId, characterCardId } = data;
    const filePath = this.getTestChatFilePath(creativeId, characterCardId);
    const cacheKey = this.getCacheKey('test', creativeId, characterCardId);

    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      this.setCache(cacheKey, data);
      console.log('[ChatStorage] Test chat saved:', { creativeId, characterCardId });
      return data;
    } catch (error) {
      console.error('[ChatStorage] Failed to save test chat:', { creativeId, characterCardId, error });
      throw error;
    }
  }

  async deleteTestChat(creativeId: string, characterCardId: string): Promise<boolean> {
    await this.initDirectories();
    
    const filePath = this.getTestChatFilePath(creativeId, characterCardId);
    const cacheKey = this.getCacheKey('test', creativeId, characterCardId);

    try {
      if (!fsSync.existsSync(filePath)) {
        return false;
      }

      await fs.unlink(filePath);
      this.invalidateCache(cacheKey);
      console.log('[ChatStorage] Test chat deleted:', { creativeId, characterCardId });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      console.error('[ChatStorage] Failed to delete test chat:', { creativeId, characterCardId, error });
      throw error;
    }
  }

  async getAllTestChats(): Promise<TestChatData[]> {
    await this.initDirectories();
    
    const chats: TestChatData[] = [];

    try {
      const files = await fs.readdir(this.testDir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const filePath = path.join(this.testDir, file);
          const data = await fs.readFile(filePath, 'utf8');
          const chatData: TestChatData = JSON.parse(data);
          chats.push(chatData);
        } catch (error) {
          console.warn('[ChatStorage] Failed to read test chat file:', file, error);
        }
      }

      console.log('[ChatStorage] Loaded all test chats:', chats.length);
      return chats;
    } catch (error) {
      console.error('[ChatStorage] Failed to list test chats:', error);
      return [];
    }
  }

  async getGenerationChat(creativeId: string, targetType: string, name: string): Promise<GenerationChatData | null> {
    await this.initDirectories();
    
    const cacheKey = this.getCacheKey('generation', creativeId, targetType, name);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    const filePath = this.getGenerationChatFilePath(creativeId, targetType, name);
    
    try {
      if (!fsSync.existsSync(filePath)) {
        return null;
      }

      const data = await fs.readFile(filePath, 'utf8');
      const chatData: GenerationChatData = JSON.parse(data);
      this.setCache(cacheKey, chatData);
      return chatData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      console.error('[ChatStorage] Failed to read generation chat:', { creativeId, targetType, name, error });
      return null;
    }
  }

  async saveGenerationChat(data: GenerationChatData): Promise<GenerationChatData> {
    await this.initDirectories();
    
    const { creativeId, targetType, name } = data;
    const filePath = this.getGenerationChatFilePath(creativeId, targetType, name);
    const cacheKey = this.getCacheKey('generation', creativeId, targetType, name);

    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      this.setCache(cacheKey, data);
      console.log('[ChatStorage] Generation chat saved:', { creativeId, targetType, name });
      return data;
    } catch (error) {
      console.error('[ChatStorage] Failed to save generation chat:', { creativeId, targetType, name, error });
      throw error;
    }
  }

  async deleteGenerationChat(creativeId: string, targetType: string, name: string): Promise<boolean> {
    await this.initDirectories();
    
    const filePath = this.getGenerationChatFilePath(creativeId, targetType, name);
    const cacheKey = this.getCacheKey('generation', creativeId, targetType, name);

    try {
      if (!fsSync.existsSync(filePath)) {
        return false;
      }

      await fs.unlink(filePath);
      this.invalidateCache(cacheKey);
      console.log('[ChatStorage] Generation chat deleted:', { creativeId, targetType, name });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      console.error('[ChatStorage] Failed to delete generation chat:', { creativeId, targetType, name, error });
      throw error;
    }
  }

  async getAllGenerationChats(): Promise<GenerationChatData[]> {
    await this.initDirectories();
    
    const chats: GenerationChatData[] = [];

    try {
      const files = await fs.readdir(this.generationDir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const filePath = path.join(this.generationDir, file);
          const data = await fs.readFile(filePath, 'utf8');
          const chatData: GenerationChatData = JSON.parse(data);
          chats.push(chatData);
        } catch (error) {
          console.warn('[ChatStorage] Failed to read generation chat file:', file, error);
        }
      }

      console.log('[ChatStorage] Loaded all generation chats:', chats.length);
      return chats;
    } catch (error) {
      console.error('[ChatStorage] Failed to list generation chats:', error);
      return [];
    }
  }

  async migrateFromLegacyFile(): Promise<MigrationResult> {
    await this.initDirectories();
    
    const legacyPath = path.join(getUserDataPath(), 'data', 'character-chats.json');
    
    if (!fsSync.existsSync(legacyPath)) {
      console.log('[ChatStorage] No legacy file found, skipping migration');
      return { success: true, migrated: 0, errors: [] };
    }

    console.log('[ChatStorage] Starting migration from legacy file:', legacyPath);

    try {
      const legacyData = JSON.parse(await fs.readFile(legacyPath, 'utf8'));
      
      const result: MigrationResult = {
        success: true,
        migrated: 0,
        errors: []
      };

      for (const chat of legacyData.characterTestChats || []) {
        try {
          await this.saveTestChat(chat);
          result.migrated++;
        } catch (error) {
          result.errors.push(`Failed to migrate test chat: ${chat.id || 'unknown'}`);
          console.error('[ChatStorage] Migration error (test chat):', chat.id, error);
        }
      }

      for (const chat of legacyData.characterGenerationChats || []) {
        try {
          await this.saveGenerationChat(chat);
          result.migrated++;
        } catch (error) {
          result.errors.push(`Failed to migrate generation chat: ${chat.id || 'unknown'}`);
          console.error('[ChatStorage] Migration error (generation chat):', chat.id, error);
        }
      }

      const backupPath = path.join(this.migrationBackupDir, 'character-chats.json.bak');
      await fs.copyFile(legacyPath, backupPath);
      console.log('[ChatStorage] Legacy file backed up to:', backupPath);

      console.log('[ChatStorage] Migration completed:', {
        migrated: result.migrated,
        errors: result.errors.length
      });

      return result;
    } catch (error) {
      console.error('[ChatStorage] Migration failed:', error);
      return {
        success: false,
        migrated: 0,
        errors: [`Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }
}

export const chatStorageService = new ChatStorageService();
export type { ChatMessage, ChatData, TestChatData, GenerationChatData, MigrationResult };
