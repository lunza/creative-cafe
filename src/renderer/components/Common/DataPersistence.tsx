// 数据持久化组件实现 - 渲染进程版本
import { DataPersistence, DataStorage, StorageOptions } from './DataPersistence.types';
import {
  validateData,
  createError,
  deepClone,
  formatDate,
  exportData,
  importData
} from './DataPersistence.utils';

// 版本号
const CURRENT_VERSION = '1.0.0';

// 存储键名
const STORAGE_KEYS = {
  SETTINGS: 'settings',
  WORLDBOOKS: 'worldbooks',
  CHARACTERS: 'characters',
  CREATIVES: 'creatives',
  CHATS: 'chats',
  TEMPLATES: 'templates',
  VERSION: 'version',
  LAST_UPDATED: 'lastUpdated'
};

// 数据持久化组件实现 - 使用IPC与主进程通信
export class DataPersistenceImpl implements DataPersistence {
  // 通用方法
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const result = await window.electronAPI.storage.get(key);
      return result.data as T;
    } catch (error) {
      console.error('获取数据失败:', error);
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      const validation = validateData(value);
      if (!validation.valid) {
        throw createError('VALIDATION_ERROR', '数据验证失败', validation.errors);
      }
      
      console.log(`[DataPersistence.set] 开始保存 - 键: ${key}, 值: ${typeof value === 'string' ? value.substring(0, 50) + '...' : JSON.stringify(value)?.substring(0, 50)}`);
      const result = await window.electronAPI.storage.set({ key, value });
      console.log(`[DataPersistence.set] IPC 返回 - success: ${result.success}, error: ${result.error}`);
      if (!result.success) {
        throw createError('STORAGE_ERROR', result.error || '存储操作失败');
      }
    } catch (error) {
      console.error('[DataPersistence.set] 设置数据失败:', error);
      throw error;
    }
  }

  async update<T>(key: string, updater: (value: T) => T): Promise<void> {
    try {
      const currentValue = await this.get<T>(key);
      const newValue = updater(currentValue as T);
      // 验证新值
      const validation = validateData(newValue);
      if (!validation.valid) {
        throw createError('VALIDATION_ERROR', '更新数据验证失败', validation.errors);
      }
      await this.set(key, newValue);
    } catch (error) {
      console.error('更新数据失败:', error);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await window.electronAPI.storage.delete(key);
    } catch (error) {
      console.error('删除数据失败:', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      await window.electronAPI.storage.clear();
    } catch (error) {
      console.error('清空数据失败:', error);
      throw error;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const result = await window.electronAPI.storage.has(key);
      return result.exists;
    } catch (error) {
      console.error('检查数据失败:', error);
      return false;
    }
  }

  async getAll(): Promise<Record<string, any>> {
    try {
      const result = await window.electronAPI.storage.getAll();
      return result.data;
    } catch (error) {
      console.error('获取所有数据失败:', error);
      return {};
    }
  }

  async export(): Promise<string> {
    try {
      const data = await this.getAll();
      return exportData(data);
    } catch (error) {
      console.error('导出数据失败:', error);
      throw error;
    }
  }

  async import(data: string): Promise<void> {
    try {
      await window.electronAPI.storage.import(data);
    } catch (error) {
      console.error('导入数据失败:', error);
      throw error;
    }
  }

  // 分类方法
  async getSettings(): Promise<any> {
    return this.get(STORAGE_KEYS.SETTINGS);
  }

  async setSettings(settings: any): Promise<void> {
    await this.set(STORAGE_KEYS.SETTINGS, settings);
  }

  async getWorldBook(id: string): Promise<any> {
    const worldbooks = await this.get<Record<string, any>>(STORAGE_KEYS.WORLDBOOKS) || {};
    return worldbooks[id];
  }

  async setWorldBook(id: string, data: any): Promise<void> {
    const worldbooks = await this.get<Record<string, any>>(STORAGE_KEYS.WORLDBOOKS) || {};
    worldbooks[id] = data;
    await this.set(STORAGE_KEYS.WORLDBOOKS, worldbooks);
  }

  async getCharacter(id: string): Promise<any> {
    const characters = await this.get<Record<string, any>>(STORAGE_KEYS.CHARACTERS) || {};
    return characters[id];
  }

  async setCharacter(id: string, data: any): Promise<void> {
    const characters = await this.get<Record<string, any>>(STORAGE_KEYS.CHARACTERS) || {};
    characters[id] = data;
    await this.set(STORAGE_KEYS.CHARACTERS, characters);
  }

  async getCreative(id: string): Promise<any> {
    const creatives = await this.get<Record<string, any>>(STORAGE_KEYS.CREATIVES) || {};
    return creatives[id];
  }

  async setCreative(id: string, data: any): Promise<void> {
    const creatives = await this.get<Record<string, any>>(STORAGE_KEYS.CREATIVES) || {};
    creatives[id] = data;
    await this.set(STORAGE_KEYS.CREATIVES, creatives);
  }

  async getChat(id: string): Promise<any> {
    const chats = await this.get<Record<string, any>>(STORAGE_KEYS.CHATS) || {};
    return chats[id];
  }

  async setChat(id: string, data: any): Promise<void> {
    const chats = await this.get<Record<string, any>>(STORAGE_KEYS.CHATS) || {};
    chats[id] = data;
    await this.set(STORAGE_KEYS.CHATS, chats);
  }

  async getTemplate(id: string): Promise<any> {
    const templates = await this.get<Record<string, any>>(STORAGE_KEYS.TEMPLATES) || {};
    return templates[id];
  }

  async setTemplate(id: string, data: any): Promise<void> {
    const templates = await this.get<Record<string, any>>(STORAGE_KEYS.TEMPLATES) || {};
    templates[id] = data;
    await this.set(STORAGE_KEYS.TEMPLATES, templates);
  }

  // 批量操作
  async getWorldBooks(): Promise<Record<string, any>> {
    return this.get<Record<string, any>>(STORAGE_KEYS.WORLDBOOKS) || {};
  }

  async getCharacters(): Promise<Record<string, any>> {
    return this.get<Record<string, any>>(STORAGE_KEYS.CHARACTERS) || {};
  }

  async getCreatives(): Promise<Record<string, any>> {
    return this.get<Record<string, any>>(STORAGE_KEYS.CREATIVES) || {};
  }

  async getChats(): Promise<Record<string, any>> {
    return this.get<Record<string, any>>(STORAGE_KEYS.CHATS) || {};
  }

  async getTemplates(): Promise<Record<string, any>> {
    return this.get<Record<string, any>>(STORAGE_KEYS.TEMPLATES) || {};
  }

  // 版本控制
  async getVersion(): Promise<string> {
    return await this.get<string>(STORAGE_KEYS.VERSION) || CURRENT_VERSION;
  }

  async setVersion(version: string): Promise<void> {
    await this.set(STORAGE_KEYS.VERSION, version);
  }

}

// 单例实例
let dataPersistenceInstance: DataPersistence | null = null;

// 创建或获取实例
export const getDataPersistence = (options?: StorageOptions): DataPersistence => {
  if (!dataPersistenceInstance) {
    dataPersistenceInstance = new DataPersistenceImpl();
  }
  return dataPersistenceInstance;
};

// 导出默认实例
export const dataPersistence = getDataPersistence();
