/**
 * 存储管理器 - 使用 electron-store 实现
 */

import Store from 'electron-store';
import fs from 'fs';
import path from 'path';
import { app, getAppPath } from '../utils/appPath';
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
        path.join(this.appDirPath, STORAGE_DIRECTORIES.LOGS)
      ];

      // 为每个模块创建子目录
      const modules = Object.values(StorageModule);
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
   */
  private initializeStores(): void {
    // 为每个模块创建独立的 Store 实例
    const modules = Object.values(StorageModule);

    modules.forEach(module => {
      const modulePath = path.join(this.baseDataPath, MODULE_PATH_MAP[module]);
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
   * 验证权限
   */
  private hasPermission(module: StorageModule, operation: StorageOperation): boolean {
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
  private inferFromKey(key: string): { module: StorageModule; storeKey: string } {
    // 首先检查是否是旧的存储键
    const legacyMapping = LEGACY_KEY_TO_MODULE[key];
    if (legacyMapping) {
      return {
        module: legacyMapping.module,
        storeKey: key
      };
    }

    // 检查是否是编辑器内容
    if (key.includes('markdown_content') || key.endsWith('_content')) {
      return {
        module: StorageModule.EDITOR,
        storeKey: key
      };
    }

    // 默认作为配置处理
    return {
      module: StorageModule.CONFIG,
      storeKey: key
    };
  }

  /**
   * 获取数据
   */
  get<T>(key: string): StorageResult<T> {
    try {
      const { module, storeKey } = this.inferFromKey(key);

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
   * 设置数据
   */
  set<T>(key: string, value: T): StorageResult {
    try {
      const { module, storeKey } = this.inferFromKey(key);

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
   * 删除数据
   */
  delete(key: string): StorageResult {
    try {
      const { module, storeKey } = this.inferFromKey(key);
      
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
      const { module, storeKey } = this.inferFromKey(key);
      
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

      // 读取所有模块的数据
      const modules = Object.values(StorageModule);
      modules.forEach(module => {
        const store = this.stores.get(module);
        if (store) {
          const storeData = store.store;
          Object.assign(allData, storeData);
        }
      });

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
    const configStore = this.stores.get(StorageModule.CONFIG);
    if (configStore) {
      const metadata: Metadata = {
        version: CURRENT_VERSION,
        lastUpdated: new Date().toISOString()
      };
      configStore.set('_metadata', metadata);
    }
  }

  /**
   * 更新元数据
   */
  private updateMetadata(): void {
    const configStore = this.stores.get(StorageModule.CONFIG);
    if (configStore) {
      const metadata = configStore.get('_metadata') as Metadata || {
        version: CURRENT_VERSION,
        lastUpdated: new Date().toISOString()
      };
      
      metadata.lastUpdated = new Date().toISOString();
      configStore.set('_metadata', metadata);
    }
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
