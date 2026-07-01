/**
 * 存储管理器 - 使用 electron-store 实现
 */

import Store from 'electron-store';
import fs from 'fs';
import path from 'path';
import { app, getAppPath } from '../utils/appPath';
import { getLogDir } from './logPathService';
import {
  StorageModule,
  StorageOperation,
  StoragePermission,
  MODULE_PATH_MAP,
  MODULE_PREFIX_MAP,
  LEGACY_KEY_TO_MODULE,
  DEFAULT_PERMISSIONS,
  StorageResult,
  Metadata,
  CURRENT_VERSION,
  STORAGE_DIRECTORIES,
  NAMING_RULES,
  ParsedFileName,
  STORAGE_ARCHITECTURE_VERSION
} from './storage.types';

export class StorageManager {
  private stores: Map<StorageModule, Store>;
  private permissions: Record<StorageModule, StoragePermission>;
  private logCallback?: (message: string, type: 'error' | 'warn' | 'info' | 'debug', context?: any) => void;
  private baseDataPath: string;
  private appDirPath: string;

  constructor(logCallback?: (message: string, type: 'error' | 'warn' | 'info' | 'debug', context?: any) => void) {
    this.stores = new Map();
    this.permissions = { ...DEFAULT_PERMISSIONS };
    this.logCallback = logCallback;
    this.initializeBaseDirectories();
    this.initializeStores();
  }

  /**
   * 记录日志
   */
  private log(message: string, type: 'error' | 'warn' | 'info' | 'debug' = 'info', context?: any) {
    if (this.logCallback) {
      this.logCallback(message, type, context);
    } else {
      // 如果没有回调，使用 console
      switch (type) {
        case 'error':
          if (context) {
            console.error(`[StorageManager] ${message}`, context);
          } else {
            console.error(`[StorageManager] ${message}`);
          }
          break;
        case 'warn':
          if (context) {
            console.warn(`[StorageManager] ${message}`, context);
          } else {
            console.warn(`[StorageManager] ${message}`);
          }
          break;
        case 'info':
          if (context) {
            console.info(`[StorageManager] ${message}`, context);
          } else {
            console.info(`[StorageManager] ${message}`);
          }
          break;
        case 'debug':
          if (context) {
            console.debug(`[StorageManager] ${message}`, context);
          } else {
            console.debug(`[StorageManager] ${message}`);
          }
          break;
      }
    }
  }

  /**
   * 初始化基础目录结构
   */
  private initializeBaseDirectories(): void {
    const appDataPath = getAppPath('appData');
    this.appDirPath = path.join(appDataPath, 'creative-cafe');
    this.baseDataPath = path.join(this.appDirPath, STORAGE_DIRECTORIES.BASE);

    try {
      // 创建基础目录结构
      const directories = [
        this.appDirPath,
        this.baseDataPath,
        path.join(this.appDirPath, STORAGE_DIRECTORIES.ATTACHMENTS),
        path.join(this.appDirPath, STORAGE_DIRECTORIES.ATTACHMENTS, STORAGE_DIRECTORIES.ATTACHMENT_IMAGES),
        path.join(this.appDirPath, STORAGE_DIRECTORIES.ATTACHMENTS, STORAGE_DIRECTORIES.ATTACHMENT_AUDIO),
        path.join(this.appDirPath, STORAGE_DIRECTORIES.ATTACHMENTS, STORAGE_DIRECTORIES.ATTACHMENT_DOCUMENTS),
        path.join(this.appDirPath, STORAGE_DIRECTORIES.BACKUPS),
        getLogDir()
      ];

      // 为每个模块创建子目录
      const modules = Object.values(StorageModule).filter(
        module => module !== StorageModule.CONFIG
      );
      modules.forEach(module => {
        directories.push(path.join(this.baseDataPath, MODULE_PATH_MAP[module]));

        // 为特殊模块创建额外的子目录
        if (module === StorageModule.MEMORY) {
          directories.push(path.join(this.baseDataPath, MODULE_PATH_MAP[module], STORAGE_DIRECTORIES.MEMORY_CHATS));
          directories.push(path.join(this.baseDataPath, MODULE_PATH_MAP[module], STORAGE_DIRECTORIES.MEMORY_TEMPLATES));
        }
        if (module === StorageModule.EDITOR) {
          directories.push(path.join(this.baseDataPath, MODULE_PATH_MAP[module], STORAGE_DIRECTORIES.EDITOR_CONTENTS));
        }
      });

      // 创建所有目录
      for (const dir of directories) {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          this.log(`创建目录: ${dir}`, 'info');
        }
      }

      this.log(`AppData 路径: ${appDataPath}`, 'info');
      this.log(`应用存储路径: ${this.appDirPath}`, 'info');
      this.log(`基础数据路径: ${this.baseDataPath}`, 'info');
      this.log('目录结构初始化完成', 'info');
    } catch (error) {
      const err = error as Error;
      this.log(`初始化目录结构失败: ${err.message}`, 'error', { error: err });
      throw error;
    }
  }

  /**
   * 初始化各个模块的 Store 实例
   * 仅为 CONFIG 和 EDITOR 模块创建 electron-store 实例
   * 其他模块（CHARACTER, CREATIVE, WORLD_BOOK, MEMORY）的数据已迁移到子目录，不再生成 JSON 文件
   */
  private initializeStores(): void {
    const modulesWithStore = [StorageModule.EDITOR];

    modulesWithStore.forEach(module => {
      const store = new Store({
        name: `${module}`,
        clearInvalidConfig: true,
        cwd: this.baseDataPath
      });
      this.stores.set(module, store);
      this.log(`初始化 Store: ${module} - 路径: ${store.path}`, 'info');
    });
  }

  /**
   * 已迁移到子目录的模块列表（不再使用 electron-store 存储）
   */
  private readonly migratedModules = new Set([
    StorageModule.CHARACTER,
    StorageModule.CREATIVE,
    StorageModule.WORLD_BOOK,
    StorageModule.MEMORY,
    StorageModule.CONFIG
  ]);

  /**
   * 验证权限
   */
  private hasPermission(module: StorageModule, operation: StorageOperation): boolean {
    // 已迁移的模块始终允许读写，因为数据存储在子目录中
    if (this.migratedModules.has(module)) {
      return true;
    }
    const permission = this.permissions[module];
    if (!permission) return false;
    return permission.operations.includes(operation);
  }

  /**
   * 清理文件名中的非法字符
   */
  private sanitizeFileName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 50);
  }

  /**
   * 格式化时间戳
   */
  private formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
  }

  /**
   * 生成文件名
   */
  generateFileName(
    module: StorageModule,
    id: string,
    timestamp: Date = new Date(),
    sequence: number = 1
  ): string {
    const modulePrefix = MODULE_PREFIX_MAP[module];
    const cleanId = this.sanitizeFileName(id);
    const timeStr = this.formatTimestamp(timestamp);
    const paddedSequence = String(Math.min(sequence, NAMING_RULES.MAX_SEQUENCE)).padStart(NAMING_RULES.SEQUENCE_PAD_LENGTH, '0');
    return `${modulePrefix}_${cleanId}_${timeStr}_${paddedSequence}.json`;
  }

  /**
   * 解析文件名
   */
  parseFileName(fileName: string): ParsedFileName | null {
    try {
      const nameWithoutExt = fileName.replace(/\.json$/, '');
      const parts = nameWithoutExt.split(NAMING_RULES.PATH_SEPARATOR);

      if (parts.length < 4) {
        return null;
      }

      const [modulePrefix, id, timestamp, sequenceStr] = parts;
      const module = Object.entries(MODULE_PREFIX_MAP).find(([, prefix]) => prefix === modulePrefix)?.[0] as StorageModule | undefined;

      if (!module) {
        return null;
      }

      const sequence = parseInt(sequenceStr, 10);
      if (isNaN(sequence)) {
        return null;
      }

      return {
        module,
        id,
        timestamp,
        sequence,
        fullName: fileName
      };
    } catch {
      return null;
    }
  }

  /**
   * 获取存储路径
   */
  getStoragePath(module: StorageModule, subPath?: string): string {
    const moduleDir = path.join(this.baseDataPath, MODULE_PATH_MAP[module]);
    return subPath ? path.join(moduleDir, subPath) : moduleDir;
  }

  /**
   * 从键名推断模块
   */
  private inferFromKey(key: string): { module: StorageModule; storeKey: string; isSettingsFileKey: boolean } {
    // 检查直接写入 settings.json 的键
    if (key === 'settings' || key === 'version' || key === 'lastUpdated' || key === 'knowledgeBase') {
      return {
        module: StorageModule.CONFIG,
        storeKey: key,
        isSettingsFileKey: true
      };
    }

    // 首先检查是否是旧的存储键
    const legacyMapping = LEGACY_KEY_TO_MODULE[key];
    if (legacyMapping) {
      return {
        module: legacyMapping.module,
        storeKey: key,
        isSettingsFileKey: false
      };
    }

    // 检查是否是编辑器内容
    if (key.includes('markdown_content') || key.endsWith('_content')) {
      return {
        module: StorageModule.EDITOR,
        storeKey: key,
        isSettingsFileKey: false
      };
    }

    // 默认作为配置处理
    return {
      module: StorageModule.CONFIG,
      storeKey: key,
      isSettingsFileKey: false
    };
  }

  /**
   * 获取数据
   */
  get<T>(key: string): StorageResult<T> {
    try {
      const { module, storeKey, isSettingsFileKey } = this.inferFromKey(key);

      // settings 文件键直接从 settings.json 文件读取（优先于 migratedModules 检查）
      if (isSettingsFileKey) {
        return this.readFromSettingsFile(key) as StorageResult<T>;
      }

      // 已迁移的模块不再生成 JSON 文件，返回空数据
      if (this.migratedModules.has(module)) {
        return { success: true, data: {} as T };
      }

      if (!this.hasPermission(module, 'read')) {
        return { success: false, error: `没有模块 ${module} 的读取权限` };
      }

      const store = this.stores.get(module);
      if (!store) {
        return { success: false, error: `模块 ${module} 的 Store 未初始化` };
      }

      // 确保存储目录存在
      const storeDir = path.dirname(store.path);
      if (!fs.existsSync(storeDir)) {
        fs.mkdirSync(storeDir, { recursive: true });
      }

      this.log(`获取数据 - 键: ${key} -> 模块: ${module} -> 文件路径: ${store.path}`, 'debug');
      const data = store.get(storeKey) as T;
      this.log(`获取数据结果 - 键: ${key} -> 值: ${typeof data === 'string' ? data.substring(0, 50) + '...' : JSON.stringify(data)?.substring(0, 50)}`, 'debug');
      return { success: true, data };
    } catch (error) {
      this.log(`获取数据错误 - 键: ${key} -> 错误: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  /**
   * 从 settings.json 文件读取数据
   */
  private readFromSettingsFile(key: string): StorageResult<any> {
    try {
      const settingsPath = path.join(this.baseDataPath, 'settings.json');
      if (!fs.existsSync(settingsPath)) {
        // settings.json 不存在，返回适当的默认值
        if (key === 'settings') {
          return { success: true, data: {} };
        }
        if (key === 'version') {
          return { success: true, data: CURRENT_VERSION };
        }
        if (key === 'lastUpdated') {
          return { success: true, data: null };
        }
        return { success: true, data: null };
      }

      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(raw);

      if (key === 'settings') {
        return { success: true, data: settings };
      }

      // 从 settings.json 的内容中提取 version 和 lastUpdated
      if (key === 'version') {
        return { success: true, data: settings._version || CURRENT_VERSION };
      }
      if (key === 'lastUpdated') {
        return { success: true, data: settings._lastUpdated || null };
      }

      return { success: true, data: settings[key] || null };
    } catch (error) {
      this.log(`从 settings.json 读取失败 - 键: ${key} -> 错误: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  /**
   * 设置数据
   */
  set<T>(key: string, value: T): StorageResult {
    try {
      const { module, storeKey, isSettingsFileKey } = this.inferFromKey(key);

      // settings、version、lastUpdated 键直接写入 settings.json 文件
      if (isSettingsFileKey) {
        return this.writeToSettingsFile(key, value);
      }

      if (!this.hasPermission(module, 'write')) {
        return { success: false, error: `没有模块 ${module} 的写入权限` };
      }

      const store = this.stores.get(module);
      if (!store) {
        return { success: false, error: `模块 ${module} 的 Store 未初始化` };
      }

      // 确保存储目录存在
      const storeDir = path.dirname(store.path);
      if (!fs.existsSync(storeDir)) {
        try {
          fs.mkdirSync(storeDir, { recursive: true });
        } catch (mkdirError) {
          this.log(`创建存储目录失败: ${storeDir} -> 错误: ${mkdirError instanceof Error ? mkdirError.message : '未知错误'}`, 'error');
          return { success: false, error: `无法创建存储目录: ${storeDir}` };
        }
      }

      this.log(`设置数据 - 键: ${key} -> 模块: ${module} -> 文件路径: ${store.path}`, 'debug');
      this.log(`设置数据值 - 键: ${key} -> 值: ${typeof value === 'string' ? value.substring(0, 50) + '...' : JSON.stringify(value)?.substring(0, 50)}`, 'debug');

      try {
        store.set(storeKey, value);
      } catch (setError) {
        this.log(`写入数据失败 - 键: ${key} -> 错误: ${setError instanceof Error ? setError.message : '未知错误'}`, 'error');
        return { success: false, error: `写入数据失败: ${setError instanceof Error ? setError.message : '未知错误'}` };
      }

      this.updateMetadata();

      return { success: true };
    } catch (error) {
      this.log(`设置数据错误 - 键: ${key} -> 错误: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  /**
   * 写入数据到 settings.json 文件
   */
  private writeToSettingsFile(key: string, value: any): StorageResult {
    try {
      const settingsPath = path.join(this.baseDataPath, 'settings.json');
      const settingsDir = path.dirname(settingsPath);
      if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
      }

      let settings: Record<string, any> = {};
      if (fs.existsSync(settingsPath)) {
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        settings = JSON.parse(raw);
      }

      if (key === 'settings') {
        // 将设置值合并到 settings.json 的顶层
        settings = { ...settings, ...(value as Record<string, any>) };
      } else if (key === 'version') {
        settings._version = value as string;
      } else if (key === 'lastUpdated') {
        settings._lastUpdated = value as string;
      } else {
        settings[key] = value;
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      this.log(`写入 settings.json - 键: ${key}`, 'debug');
      return { success: true };
    } catch (error) {
      this.log(`写入 settings.json 失败 - 键: ${key} -> 错误: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  /**
   * 删除数据
   */
  delete(key: string): StorageResult {
    try {
      const { module, storeKey, isSettingsFileKey } = this.inferFromKey(key);
      
      // 已迁移的模块不支持删除操作
      if (this.migratedModules.has(module)) {
        return { success: true };
      }

      // settings、version、lastUpdated 键不支持直接删除
      if (isSettingsFileKey) {
        return { success: true };
      }

      if (!this.hasPermission(module, 'delete')) {
        return { success: false, error: `没有模块 ${module} 的删除权限` };
      }

      const store = this.stores.get(module);
      if (!store) {
        return { success: false, error: `模块 ${module} 的 Store 未初始化` };
      }

      store.delete(storeKey);
      this.updateMetadata();

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  /**
   * 检查数据是否存在
   */
  has(key: string): StorageResult<boolean> {
    try {
      const { module, storeKey, isSettingsFileKey } = this.inferFromKey(key);
      
      // settings 文件键直接检查 settings.json 文件（优先于 migratedModules 检查）
      if (isSettingsFileKey) {
        const settingsPath = path.join(this.baseDataPath, 'settings.json');
        const exists = fs.existsSync(settingsPath);
        return { success: true, exists };
      }

      // 已迁移的模块始终返回 false（不生成文件）
      if (this.migratedModules.has(module)) {
        return { success: true, exists: false };
      }

      if (!this.hasPermission(module, 'read')) {
        return { success: false, error: `没有模块 ${module} 的读取权限` };
      }

      const store = this.stores.get(module);
      if (!store) {
        return { success: false, error: `模块 ${module} 的 Store 未初始化` };
      }

      const exists = store.has(storeKey);
      return { success: true, exists };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  /**
   * 获取所有数据（用于导出）
   */
  getAll(): StorageResult<Record<string, any>> {
    try {
      const allData: Record<string, any> = {};

      // 读取所有模块的数据（跳过已迁移模块）
      const modules = Object.values(StorageModule).filter(
        module => !this.migratedModules.has(module)
      );
      modules.forEach(module => {
        const store = this.stores.get(module);
        if (store) {
          const storeData = store.store;
          Object.assign(allData, storeData);
        }
      });

      // 读取 settings.json 的内容
      try {
        const settingsPath = path.join(this.baseDataPath, 'settings.json');
        if (fs.existsSync(settingsPath)) {
          const raw = fs.readFileSync(settingsPath, 'utf-8');
          const settings = JSON.parse(raw);
          Object.assign(allData, { settings, version: settings._version, lastUpdated: settings._lastUpdated });
        }
      } catch {
        // settings.json 读取失败时忽略
      }

      return { success: true, data: allData };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  /**
   * 清空所有数据
   */
  clear(): StorageResult {
    try {
      const modules = Object.values(StorageModule);
      modules.forEach(module => {
        if (this.hasPermission(module, 'delete')) {
          const store = this.stores.get(module);
          if (store) {
            store.clear();
          }
        }
      });

      // 重新初始化元数据
      this.initializeMetadata();

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  }

  /**
   * 初始化元数据
   */
  initializeMetadata(): void {
    const metadata: Metadata = {
      version: CURRENT_VERSION,
      lastUpdated: new Date().toISOString()
    };
    this.writeToSettingsFile('version', CURRENT_VERSION);
    this.writeToSettingsFile('lastUpdated', metadata.lastUpdated);
  }

  /**
   * 更新元数据
   */
  private updateMetadata(): void {
    this.writeToSettingsFile('lastUpdated', new Date().toISOString());
  }

  /**
   * 获取备份路径（保留接口兼容性）
   */
  getBackupPath(timestamp: string): string {
    // 实际不需要这个了，但保留接口
    return `creative-cafe.backup.${timestamp}.json`;
  }

  /**
   * 获取基础路径（保留接口兼容性）
   */
  getBasePath(): string {
    // 实际不需要这个了，但保留接口
    return '';
  }

  /**
   * 获取指定模块的 Store（内部使用）
   */
  getStore(module: StorageModule): Store | undefined {
    return this.stores.get(module);
  }
}

// 导出单例
let storageManagerInstance: StorageManager | null = null;

export const getStorageManager = (logCallback?: (message: string, type: 'error' | 'warn' | 'info' | 'debug', context?: any) => void): StorageManager => {
  if (!storageManagerInstance) {
    storageManagerInstance = new StorageManager(logCallback);
  }
  return storageManagerInstance;
};

export default getStorageManager();
