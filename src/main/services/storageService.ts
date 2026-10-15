/**
 * 存储服务 - 新架构版本
 * 集成 StorageManager
 */

import { ipcMain, ipcRenderer } from 'electron';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { createLogger } from './logger';
import { getStorageManager, StorageManager } from './storageManager';
import { CURRENT_VERSION } from './storage.types';
import { getUserDataPath } from '../utils/appPath';
import { pathService } from './pathService';
import { atomicWriteJsonSync, readSettingsFile, readSettingsFileAsync } from './settingsFileIO';
// Spec: settings-feature-optimization-report / H-5（M-6/FL-7）引擎默认单一来源；
// M-6：完整默认设置收敛到 buildDefaultSetting()（与渲染侧 shared/settings.ts 同源）
import { buildDefaultSetting } from '../../shared/settingDefaults';

const logger = createLogger('storage');

// 存储键名（保持向后兼容）
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

class StorageService {
  private storageManager: StorageManager;
  private initialized: boolean = false;
  // L-4/ST-7：暴露初始化 Promise，供启动期读取方（setting:load）等待，
  // 消除「冷启动立即打开设置页读到未初始化状态」的竞态窗口
  private initializing: Promise<void>;

  constructor() {
    // 创建 StorageManager 时传递日志回调
    this.storageManager = getStorageManager((message, type, context) => {
      this.sendLog(`StorageManager: ${message}`, type, context);
    });
    
    // 立即设置 IPC 处理，不等待异步初始化
    this.setupIPC();
    
    // 异步初始化其他内容
    this.initializing = this.initialize();
  }

  /** L-4/ST-7：等待 initializeDefaultData 完成（读取方消除竞态窗口） */
  getInitializing(): Promise<void> {
    return this.initializing;
  }

  /**
   * 向渲染进程发送日志
   */
  private sendLog(message: string, type: 'error' | 'warn' | 'info' | 'debug' = 'info', context?: any) {
    switch (type) {
      case 'error':
        logger.error(message, undefined, context);
        break;
      case 'warn':
        logger.warn(message, undefined, context);
        break;
      case 'debug':
        logger.debug(message, undefined, context);
        break;
      default:
        logger.info(message, undefined, context);
        break;
    }
  }

  /**
   * 初始化存储服务
   */
  private async initialize(): Promise<void> {
    console.log('开始初始化存储服务...');

    try {
      // 初始化默认数据结构
      await this.initializeDefaultData();

      this.initialized = true;
      console.log('存储服务初始化完成');
    } catch (error) {
      console.error('存储服务初始化失败:', error);
    }
  }

  /**
   * 解析路径中的 __USER_DATA__ 标记
   */
  private resolvePath(rawPath: string): string {
    if (!rawPath) return '';
    if (rawPath.startsWith('__USER_DATA__')) {
      return rawPath.replace('__USER_DATA__', getUserDataPath());
    }
    return rawPath;
  }

  /**
   * 初始化默认数据
   */
  private async initializeDefaultData(): Promise<void> {
    console.log('初始化默认数据结构...');

    try {
      // 检查并初始化 settings
      const settingsResult = this.storageManager.get('settings');
      if (!settingsResult.data) {
        console.log('SETTINGS 不存在，初始化默认设置');
        // Spec: settings-feature-optimization-report / M-6（FL-7 双默认合一）：
        // 默认设置收敛到 shared/settingDefaults.buildDefaultSetting() 单一来源，
        // 与渲染侧 shared/settings.ts defaultSetting 字段级一致（此前本方法内联
        // 一份缺全部配置域的顶层默认，文件缺失时渲染/主进程「默认」理解不同）。
        // *Path 五键解析 __USER_DATA__ 占位符后落盘（存量消费方读取时亦会解析，
        // 此处解析保持磁盘为绝对路径的既有格式）。
        const defaultSetting = buildDefaultSetting();
        defaultSetting.characterPath = this.resolvePath(defaultSetting.characterPath);
        defaultSetting.worldBookPath = this.resolvePath(defaultSetting.worldBookPath);
        defaultSetting.avatarPath = this.resolvePath(defaultSetting.avatarPath);
        defaultSetting.creativePath = this.resolvePath(defaultSetting.creativePath);
        defaultSetting.memoryPath = this.resolvePath(defaultSetting.memoryPath);
        this.storageManager.set('settings', defaultSetting);
        console.log('SETTINGS 初始化成功');
      } else {
        console.log('SETTINGS 已存在');
      }

      // 检查并初始化其他模块的空对象
      const modules = [
        { key: 'worldbooks', defaultValue: {} },
        { key: 'characters', defaultValue: {} },
        { key: 'creatives', defaultValue: {} },
        { key: 'chats', defaultValue: {} },
        { key: 'templates', defaultValue: {} }
      ];

      for (const { key, defaultValue } of modules) {
        const result = this.storageManager.get(key);
        if (!result.data) {
          this.storageManager.set(key, defaultValue);
        }
      }

      // 初始化元数据
      this.storageManager.initializeMetadata();

      // 确保通用人设预设存在
      await this.ensureGenericPersona();

      // 确保所有模块目录存在
      await this.ensureModuleDirectories();

      console.log('默认数据初始化完成');
    } catch (error) {
      console.error('初始化默认数据失败:', error);
    }
  }

  // 确保通用人设预设存在
  async ensureInit() {
    await this.ensureGenericPersona();
  }

  /**
   * 确保通用人设预设文件存在（内置预设，不可删除）
   * 通用人设不提供固定身份描述，而是引导 AI 根据角色卡中 {{user}} 的设定动态确定用户身份
   *
   * 异步 I/O（spec §4.2 P3）：使用 fs.promises 替代同步 API，避免启动期阻塞事件循环。
   */
  private async ensureGenericPersona(): Promise<void> {
    try {
      const userDataPath = getUserDataPath();
      const avatarDir = path.join(userDataPath, 'data', 'avatars');
      await fsp.mkdir(avatarDir, { recursive: true });
      const genericPersonaPath = path.join(avatarDir, 'generic-persona.json');
      try {
        await fsp.access(genericPersonaPath);
        // 文件已存在，无需创建
        return;
      } catch {
        // 文件不存在，继续创建
      }
      const genericPersona = {
        id: 'generic-persona',
        name: 'User',
        description: '',
        avatarPath: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isGeneric: true,
        isSystem: true
      };
      await fsp.writeFile(genericPersonaPath, JSON.stringify(genericPersona, null, 2), 'utf-8');
      console.log('[StorageService] Created generic persona preset');
    } catch (error) {
      console.error('[StorageService] Failed to ensure generic persona:', error);
    }
  }

  /**
   * 确保所有模块目录存在
   *
   * 异步 I/O（spec §4.2 P3）：使用 fs.promises.mkdir（recursive，幂等）替代
   * existsSync + mkdirSync 组合，避免启动期阻塞事件循环。
   */
  private async ensureModuleDirectories(): Promise<void> {
    try {
      const userDataPath = getUserDataPath();
      const modules = ['characters', 'worldbooks', 'avatars', 'creatives', 'memories'];
      for (const mod of modules) {
        const dirPath = path.join(userDataPath, 'data', mod);
        // mkdir recursive 幂等：目录已存在时不报错，省去 existsSync 预检
        await fsp.mkdir(dirPath, { recursive: true });
      }
    } catch (error) {
      console.error('[StorageService] Failed to create module directories:', error);
    }
  }

  /**
   * 设置 IPC 处理
   */
  private setupIPC(): void {
    // 防御：非 Electron 主进程环境（如 vitest 单元测试）下 ipcMain 为 undefined，
    // 跳过 IPC 处理器注册，避免模块加载即崩溃。生产环境（Electron 主进程）ipcMain 始终可用。
    // ⚠️ Bug修复：原实现直接调用 ipcMain.handle，导致所有经由 VectorConfigManager →
    //    storageService 的测试套件（ChatVectorizationService / e2e-performance 等）加载即崩溃。
    if (!ipcMain || typeof ipcMain.handle !== 'function') {
      this.sendLog('setupIPC 跳过：非 Electron 主进程环境（ipcMain 不可用）', 'warn');
      return;
    }
    // 获取数据
    ipcMain.handle('storage:get', (event, key) => {
      try {
        this.sendLog(`收到存储获取请求 - 键: ${key}`, 'debug');
        const result = this.storageManager.get(key);
        this.sendLog(`存储获取结果 - 键: ${key}, 成功: ${result.success}, 有数据: ${result.data !== undefined}`, 'debug');
        return { success: result.success, data: result.data, error: result.error };
      } catch (error) {
        this.sendLog(`存储获取错误 - 键: ${key}, 错误: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    });

    // 设置数据
    ipcMain.handle('storage:set', (event, { key, value }) => {
      try {
        this.sendLog(`收到存储设置请求 - 键: ${key}, 值: ${typeof value === 'string' ? value.substring(0, 50) + '...' : JSON.stringify(value)?.substring(0, 50)}`, 'debug');
        const result = this.storageManager.set(key, value);
        this.sendLog(`存储设置结果 - 键: ${key}, 成功: ${result.success}, 错误: ${result.error}`, 'debug');
        return { success: result.success, error: result.error };
      } catch (error) {
        this.sendLog(`存储设置错误 - 键: ${key}, 错误: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    });

    // 删除数据
    ipcMain.handle('storage:delete', (event, key) => {
      try {
        const result = this.storageManager.delete(key);
        return { success: result.success, error: result.error };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    });

    // 清空数据
    ipcMain.handle('storage:clear', async (event) => {
      try {
        const result = this.storageManager.clear();
        if (result.success) {
          // 重新初始化默认数据
          await this.initializeDefaultData();
        }
        return { success: result.success, error: result.error };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    });

    // 检查数据是否存在
    ipcMain.handle('storage:has', (event, key) => {
      try {
        const result = this.storageManager.has(key);
        return { success: result.success, exists: result.exists, error: result.error };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    });

    // 获取所有数据
    ipcMain.handle('storage:getAll', (event) => {
      try {
        const result = this.storageManager.getAll();
        return { success: result.success, data: result.data, error: result.error };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    });

    // 导入数据
    ipcMain.handle('storage:import', (event, data) => {
      try {
        const parsedData = JSON.parse(data);
        
        // 先清空数据
        this.storageManager.clear();
        
        // 逐个导入数据
        for (const key in parsedData) {
          if (parsedData.hasOwnProperty(key)) {
            this.storageManager.set(key, parsedData[key]);
          }
        }
        
        // 重新初始化元数据
        this.storageManager.initializeMetadata();
        
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    });
  }

  // ========== 通用方法（保持向后兼容） ==========

  get<T>(key: string): T | undefined {
    try {
      const result = this.storageManager.get(key);
      return result.data as T;
    } catch (error) {
      console.error('获取数据失败:', error);
      return undefined;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      const result = this.storageManager.set(key, value);
      if (!result.success) {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('设置数据失败:', error);
      throw error;
    }
  }

  delete(key: string): void {
    try {
      const result = this.storageManager.delete(key);
      if (!result.success) {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('删除数据失败:', error);
      throw error;
    }
  }

  clear(): void {
    try {
      const result = this.storageManager.clear();
      if (!result.success) {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('清空数据失败:', error);
      throw error;
    }
  }

  has(key: string): boolean {
    try {
      const result = this.storageManager.has(key);
      return result.exists || false;
    } catch (error) {
      console.error('检查数据失败:', error);
      return false;
    }
  }

  getAll(): Record<string, any> {
    try {
      const result = this.storageManager.getAll();
      return result.data || {};
    } catch (error) {
      console.error('获取所有数据失败:', error);
      return {};
    }
  }

  // ========== 分类方法（保持向后兼容） ==========

  // 直接从 settings.json 文件读取设置（兼容旧数据格式）
  // 统一走 readSettingsFile：损坏自动恢复（备份坏文件 + 重写空对象）+ schema 迁移（H-4/H-12）
  getSettings(): any {
    try {
      const settingsPath = path.join(this.storageManager['baseDataPath'], 'settings.json');
      // 统一读取入口内部已完成「损坏恢复 + schema 迁移」（H-4/H-12），
      // 迁移/恢复产生变更时 needsWriteBack=true，此处原子回写。
      const read = readSettingsFile(settingsPath, (msg, type, context) => this.sendLog(msg, type, context));
      if (read.needsWriteBack && read.data !== null) {
        atomicWriteJsonSync(settingsPath, read.data);
      }
      if (read.data !== null) {
        return read.data;
      }
      // 文件不存在，回退到存储管理器
      return this.get(STORAGE_KEYS.SETTINGS);
    } catch (error) {
      console.error('读取 settings.json 失败:', error);
      return this.get(STORAGE_KEYS.SETTINGS);
    }
  }

  // 清理配置中的向量数据，防止配置文件膨胀
  private sanitizeSettings(settings: any): any {
    const sanitized = { ...settings };
    
    // 移除可能错误存储的顶级向量数据数组
    const vectorDataKeys = ['vectors', 'vectorData', 'embeddings', 'vectorArray', 'vectors_data'];
    for (const key of vectorDataKeys) {
      if (sanitized[key] && Array.isArray(sanitized[key])) {
        console.warn(`[StorageService] 检测到配置中包含向量数据字段 "${key}"，已自动移除`);
        delete sanitized[key];
      }
    }
    
    // 检查 vector 配置字段是否包含异常大的数据
    if (sanitized.vector) {
      const vectorConfig = sanitized.vector;
      const vectorConfigStr = JSON.stringify(vectorConfig);
      const vectorConfigSize = vectorConfigStr.length;
      
      // 如果vector配置超过10KB，视为异常
      if (vectorConfigSize > 10000) {
        console.warn(`[StorageService] vector配置异常大: ${vectorConfigSize} bytes，执行清理`);
        
        // 仅保留合法配置字段，移除可能的数据字段
        // 【M-15/S-9】vectorStoreMode 等四孤儿子键已移出白名单（无消费）
        const allowedFields = [
          'embeddingMode', 'remoteModel', 'remoteApiUrl', 'remoteApiKey',
          'remoteApiKeyTransmission', 'localModel',
          'cacheEnabled', 'cacheL1Size', 'cacheL1TTL', 'cacheL2TTL',
          'defaultTopK', 'minSimilarityScore', 'contextWindowTokens',
          'autoVectorizeWorldBook', 'autoVectorizeKnowledge',
          'dimension'
        ];
        
        const cleanedVectorConfig: any = {};
        for (const field of allowedFields) {
          if (field in vectorConfig) {
            cleanedVectorConfig[field] = vectorConfig[field];
          }
        }
        
        // 检查是否包含向量数据字段并移除
        const vectorDataInConfig = ['vectors', 'vectorData', 'embeddings', 'items', 'records'];
        for (const key of vectorDataInConfig) {
          if (cleanedVectorConfig[key]) {
            console.warn(`[StorageService] 从vector配置中移除数据字段 "${key}"`);
            delete cleanedVectorConfig[key];
          }
        }
        
        sanitized.vector = cleanedVectorConfig;
        console.log(`[StorageService] vector配置已清理，新大小: ${JSON.stringify(cleanedVectorConfig).length} bytes`);
      }
    }
    
    return sanitized;
  }

  // 直接写入 settings.json 文件（兼容旧数据格式）
  // 【H-2 消除双写】不再自行 writeFileSync，统一收敛到 StorageManager.writeToSettingsFile
  // 这一唯一同步原子写路径。原「本方法整文件覆盖 + set('settings') read-modify-write 二次覆盖」
  // 的双写是 lost-update 竞态的根源；收敛为单写后，Node 单线程事件循环保证写操作不交错。
  setSettings(settings: any): void {
    try {
      // 清理配置中的向量数据
      const cleanedSettings = this.sanitizeSettings(settings);
      this.set(STORAGE_KEYS.SETTINGS, cleanedSettings);
    } catch (error) {
      console.error('写入 settings.json 失败:', error);
      this.set(STORAGE_KEYS.SETTINGS, settings);
    }
  }

  // ========== 异步变体（spec §4.2 P3：fs.promises，供新代码使用） ==========
  // 旧调用方（构造函数/同步初始化路径）继续使用同步 getSettings/setSettings；
  // 新代码（agent 模块、IPC handler 中已 async 的路径）应优先使用异步变体，
  // 避免在主进程事件循环上阻塞。两者的读写语义、sanitize 逻辑完全一致。

  /**
   * 异步读取 settings.json（spec §4.2 P3）。
   *
   * 与同步 getSettings 行为一致：统一走 readSettingsFile（损坏恢复 + schema 迁移，H-4/H-12），
   * 文件不存在时回退到 StorageManager。
   *
   * 【重点标记 - L-4/ST-7】原实现名为异步实际同步——内部调用同步 readSettingsFile
   * （readFileSync），1400+ 行 JSON 解析仍阻塞主进程事件循环，「异步」名不副实。
   * 现改 readSettingsFileAsync（fs.promises），行为不变、I/O 真异步。写回保留
   * atomicWriteJsonSync：写必须与唯一同步写路径（H-2）串行化，异步 rename 会
   * 重开 lost-update 竞态窗口。
   */
  async getSettingsAsync(): Promise<any> {
    try {
      const settingsPath = path.join(this.storageManager['baseDataPath'], 'settings.json');
      const read = await readSettingsFileAsync(settingsPath, (msg, type, context) => this.sendLog(msg, type, context));
      if (read.needsWriteBack && read.data !== null) {
        atomicWriteJsonSync(settingsPath, read.data);
      }
      if (read.data !== null) {
        return read.data;
      }
      return this.get(STORAGE_KEYS.SETTINGS);
    } catch (error) {
      console.error('异步读取 settings.json 失败:', error);
      return this.get(STORAGE_KEYS.SETTINGS);
    }
  }

  /**
   * 异步写入 settings.json（spec §4.2 P3）。
   *
   * 与同步 setSettings 行为一致：先 sanitize，再走唯一同步原子写路径（H-2 消除双写）。
   * 原 fsp.writeFile 异步整文件覆盖与同步 read-modify-write 交错是竞态窗口，已移除。
   */
  async setSettingsAsync(settings: any): Promise<void> {
    try {
      // 清理配置中的向量数据
      const cleanedSettings = this.sanitizeSettings(settings);
      this.set(STORAGE_KEYS.SETTINGS, cleanedSettings);
    } catch (error) {
      console.error('异步写入 settings.json 失败:', error);
      this.set(STORAGE_KEYS.SETTINGS, settings);
    }
  }

  getWorldBook(id: string): any {
    const worldbooks = this.get<Record<string, any>>(STORAGE_KEYS.WORLDBOOKS) || {};
    return worldbooks[id];
  }

  setWorldBook(id: string, data: any): void {
    const worldbooks = this.get<Record<string, any>>(STORAGE_KEYS.WORLDBOOKS) || {};
    worldbooks[id] = data;
    this.set(STORAGE_KEYS.WORLDBOOKS, worldbooks);
  }

  getCharacter(id: string): any {
    const characters = this.get<Record<string, any>>(STORAGE_KEYS.CHARACTERS) || {};
    return characters[id];
  }

  setCharacter(id: string, data: any): void {
    const characters = this.get<Record<string, any>>(STORAGE_KEYS.CHARACTERS) || {};
    characters[id] = data;
    this.set(STORAGE_KEYS.CHARACTERS, characters);
  }

  getCreative(id: string): any {
    const creatives = this.get<Record<string, any>>(STORAGE_KEYS.CREATIVES) || {};
    return creatives[id];
  }

  setCreative(id: string, data: any): void {
    const creatives = this.get<Record<string, any>>(STORAGE_KEYS.CREATIVES) || {};
    creatives[id] = data;
    this.set(STORAGE_KEYS.CREATIVES, creatives);
  }

  getChat(id: string): any {
    const chats = this.get<Record<string, any>>(STORAGE_KEYS.CHATS) || {};
    return chats[id];
  }

  setChat(id: string, data: any): void {
    const chats = this.get<Record<string, any>>(STORAGE_KEYS.CHATS) || {};
    chats[id] = data;
    this.set(STORAGE_KEYS.CHATS, chats);
  }

  getTemplate(id: string): any {
    const templates = this.get<Record<string, any>>(STORAGE_KEYS.TEMPLATES) || {};
    return templates[id];
  }

  setTemplate(id: string, data: any): void {
    const templates = this.get<Record<string, any>>(STORAGE_KEYS.TEMPLATES) || {};
    templates[id] = data;
    this.set(STORAGE_KEYS.TEMPLATES, templates);
  }

  // ========== 批量操作（保持向后兼容） ==========

  getWorldBooks(): Record<string, any> {
    return this.get<Record<string, any>>(STORAGE_KEYS.WORLDBOOKS) || {};
  }

  getCharacters(): Record<string, any> {
    return this.get<Record<string, any>>(STORAGE_KEYS.CHARACTERS) || {};
  }

  getCreatives(): Record<string, any> {
    return this.get<Record<string, any>>(STORAGE_KEYS.CREATIVES) || {};
  }

  getChats(): Record<string, any> {
    return this.get<Record<string, any>>(STORAGE_KEYS.CHATS) || {};
  }

  getTemplates(): Record<string, any> {
    return this.get<Record<string, any>>(STORAGE_KEYS.TEMPLATES) || {};
  }

  // ========== 版本控制（保持向后兼容） ==========

  getVersion(): string {
    const version = this.get<string>(STORAGE_KEYS.VERSION);
    return version || CURRENT_VERSION;
  }

  setVersion(version: string): void {
    this.set(STORAGE_KEYS.VERSION, version);
  }

  // ========== 新架构的额外方法 ==========

  /**
   * 获取存储管理器
   */
  getStorageManager(): StorageManager {
    return this.storageManager;
  }
}

// 导出单例
let storageServiceInstance: StorageService | null = null;

export const getStorageService = (): StorageService => {
  if (!storageServiceInstance) {
    storageServiceInstance = new StorageService();
  }
  return storageServiceInstance;
};

export default getStorageService();
