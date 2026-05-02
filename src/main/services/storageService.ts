/**
 * 存储服务 - 新架构版本
 * 集成 StorageManager
 */

import { ipcMain, ipcRenderer, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getStorageManager, StorageManager } from './storageManager';
import { CURRENT_VERSION } from './storage.types';
import { getUserDataPath } from '../utils/appPath';
import { pathService } from './pathService';

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

  constructor() {
    // 创建 StorageManager 时传递日志回调
    this.storageManager = getStorageManager((message, type, context) => {
      this.sendLog(`StorageManager: ${message}`, type, context);
    });
    
    // 立即设置 IPC 处理，不等待异步初始化
    this.setupIPC();
    
    // 异步初始化其他内容
    this.initialize();
  }

  /**
   * 向渲染进程发送日志
   */
  private sendLog(message: string, type: 'error' | 'warn' | 'info' | 'debug' = 'info', context?: any) {
    try {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(window => {
        if (window.webContents && !window.isDestroyed()) {
          window.webContents.send('memory:addLog', message, type);
        }
      });
    } catch (error) {
      // 如果发送失败，使用 console
      if (context) {
        console.log(`[StorageService] ${type.toUpperCase()}: ${message}`, context);
      } else {
        console.log(`[StorageService] ${type.toUpperCase()}: ${message}`);
      }
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
        // 使用默认设置初始化
        const defaultSetting = {
          preset_name: 'Default',
          aiEngines: [
            {
              id: 'default',
              name: '默认引擎',
              api_url: 'http://127.0.0.1:5000',
              api_key: '',
              model_name: 'llmfan46/Qwen3.5-27B-heretic-v3-no-think',
              api_mode: 'text_completion',
              prompt_template: '',
              stop_words: '',
              max_generation_length: 1024,
              custom_optimization_prompt: '# 请按照要求优化以下提示词模板：\n\n{{prompt}}\n\n# 优化说明\n\n- 增强了任务描述的清晰度，使其更符合SillyTavern的使用场景\n\n- 添加了更明确的格式要求，确保与SillyTavern的用户交互模式匹配\n\n- 优化了指令的逻辑结构，提高了在SillyTavern平台上的性能\n\n- 调整了提示模板的表达方式，使其更符合SillyTavern的最佳实践\n\n- 确保了提示模板与SillyTavern平台的预期用例保持一致',
              system_prompt: '',
              temperature: 1,
              max_tokens: 300,
              streaming: true,
              enable_chain_of_thought: false,
              openai_max_context: 4095,
              names_behavior: 0,
              send_if_empty: '',
              impersonation_prompt: "[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don't write as {{char}} or system. Don't describe actions of {{char}}.]",
              new_chat_prompt: "[Start a new Chat]",
              new_group_chat_prompt: "[Start a new group chat. Group members: {{group}}]",
              new_example_chat_prompt: "[Example Chat]",
              continue_nudge_prompt: "[Continue your last message without repeating its original content.]",
              bias_preset_selected: "Default (none)",
              max_context_unlocked: false,
              wi_format: "{0}",
              scenario_format: "{{scenario}}",
              personality_format: "{{personality}}",
              group_nudge_prompt: "[Write the next reply only as {{char}}.]",
              assistant_prefill: "",
              assistant_impersonation: "",
              use_sysprompt: false,
              squash_system_messages: false,
              media_inlining: true,
              continue_prefill: false,
              continue_postfix: " ",
              seed: -1,
              n: 1,
              novelai_api_key: '',
              novelai_model: 'krake-v2',
              novelai_sampler: 'k_dpm_2',
              novelai_cfg_scale: 7.0,
              ai_horde_api_key: '',
              ai_horde_model: '',
              ai_horde_max_wait: 60,
              ai_horde_priority: 50,
              temp: 2,
              temperature_last: false,
              top_p: 1,
              top_k: 0,
              top_a: 0,
              tfs: 1,
              epsilon_cutoff: 0,
              eta_cutoff: 0,
              typical_p: 1,
              min_p: 0.1,
              rep_pen: 1,
              rep_pen_range: 0,
              rep_pen_decay: 0,
              rep_pen_slope: 1,
              no_repeat_ngram_size: 0,
              penalty_alpha: 0,
              num_beams: 1,
              length_penalty: 1,
              min_length: 0,
              encoder_rep_pen: 1,
              freq_pen: 0,
              presence_pen: 0,
              skew: 0,
              do_sample: true,
              early_stopping: false,
              dynatemp: false,
              min_temp: 0,
              max_temp: 2,
              dynatemp_exponent: 1,
              smoothing_factor: 0,
              smoothing_curve: 1,
              dry_allowed_length: 2,
              dry_multiplier: 0,
              dry_base: 1.75,
              dry_sequence_breakers: '["\n", ":", "\"", "*"]',
              dry_penalty_last_n: 0,
              add_bos_token: true,
              ban_eos_token: false,
              skip_special_tokens: true,
              mirostat_mode: 0,
              mirostat_tau: 5,
              mirostat_eta: 0.1,
              guidance_scale: 1,
              negative_prompt: '',
              grammar_string: '',
              json_schema: null,
              json_schema_allow_empty: false,
              banned_tokens: '',
              sampler_priority: [
                  "repetition_penalty", "presence_penalty", "frequency_penalty", "dry",
                  "temperature", "dynamic_temperature", "quadratic_sampling", "top_n_sigma",
                  "top_k", "top_p", "typical_p", "epsilon_cutoff", "eta_cutoff", "tfs",
                  "top_a", "min_p", "mirostat", "xtc", "encoder_repetition_penalty", "no_repeat_ngram"
              ],
              samplers: [
                  "penalties", "dry", "top_n_sigma", "top_k", "typ_p", "tfs_z",
                  "typical_p", "xtc", "top_p", "adaptive_p", "min_p", "temperature"
              ],
              samplers_priorities: [
                  "dry", "penalties", "no_repeat_ngram", "temperature", "top_nsigma",
                  "top_p_top_k", "top_a", "min_p", "tfs", "eta_cutoff", "epsilon_cutoff",
                  "typical_p", "quadratic", "xtc"
              ],
              ignore_eos_token: false,
              spaces_between_special_tokens: true,
              speculative_ngram: false,
              sampler_order: [5, 6, 0, 1, 2, 3, 4],
              logit_bias: [],
              xtc_threshold: 0.1,
              xtc_probability: 0,
              nsigma: 0,
              min_keep: 0,
              extensions: {},
              adaptive_target: -0.01,
              adaptive_decay: 0.9,
              rep_pen_size: 0,
              genamt: 350,
              max_length: 8192,
              frequency_penalty: 0.0,
              presence_penalty: 0.0,
              use_function_calling: false,
              auto_connect: true,
              skip_status_check: false,
              use_proxy: false,
              proxy_url: 'http://localhost:7890',
              proxy_port: 7890,
              encrypt_api_key: false,
              enable_access_control: false,
              api_key_transmission: 'body'
            }
          ],
          activeEngineId: 'default',
          defaultEngineId: 'default',
          logLevel: 'info',
          characterPath: this.resolvePath('__USER_DATA__/data/characters'),
          worldBookPath: this.resolvePath('__USER_DATA__/data/worldbooks'),
          avatarPath: this.resolvePath('__USER_DATA__/data/avatars'),
          creativePath: this.resolvePath('__USER_DATA__/data/creatives'),
          memoryPath: this.resolvePath('__USER_DATA__/data/memories'),
          pluginPath: this.resolvePath('__USER_DATA__/data/plugins'),
          dashboardBackgroundImage: '',
          animationEnabled: true,
          compactMode: false
        };
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

      // 加载自定义路径到 pathService
      await this.loadCustomPaths();

      // 确保所有模块目录存在
      await this.ensureModuleDirectories();

      console.log('默认数据初始化完成');
    } catch (error) {
      console.error('初始化默认数据失败:', error);
    }
  }

  /**
   * 从设置中加载自定义路径到 pathService
   */
  private async loadCustomPaths(): Promise<void> {
    try {
      const settingResult = this.storageManager.get('settings');
      if (settingResult.data) {
        const settings = settingResult.data;
        const customPaths: Record<string, string> = {};
        
        const pathFields = ['characterPath', 'worldBookPath', 'avatarPath', 'creativePath', 'memoryPath', 'pluginPath'] as const;
        const moduleMap: Record<string, string> = {
          characterPath: 'character',
          worldBookPath: 'worldbook',
          avatarPath: 'avatar',
          creativePath: 'creative',
          memoryPath: 'memory',
          pluginPath: 'plugin',
        };

        for (const field of pathFields) {
          const value = settings[field];
          if (value) {
            const resolved = value.startsWith('__USER_DATA__') 
              ? value.replace('__USER_DATA__', getUserDataPath())
              : value;
            customPaths[moduleMap[field]] = resolved;
          }
        }

        if (Object.keys(customPaths).length > 0) {
          pathService.loadCustomPaths(customPaths);
          console.log('[StorageService] Loaded custom paths:', customPaths);
        }
      }
    } catch (error) {
      console.error('[StorageService] Failed to load custom paths:', error);
    }
  }

  /**
   * 确保所有模块目录存在
   */
  private async ensureModuleDirectories(): Promise<void> {
    try {
      const userDataPath = getUserDataPath();
      const modules = ['characters', 'worldbooks', 'avatars', 'creatives', 'memories', 'plugins'];
      for (const mod of modules) {
        const dirPath = path.join(userDataPath, 'data', mod);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
          console.log(`[StorageService] Created module directory: ${dirPath}`);
        }
      }
    } catch (error) {
      console.error('[StorageService] Failed to create module directories:', error);
    }
  }

  /**
   * 设置 IPC 处理
   */
  private setupIPC(): void {
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
  getSettings(): any {
    try {
      const settingsPath = path.join(this.storageManager['baseDataPath'], 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        return JSON.parse(raw);
      }
      // 回退到存储管理器
      return this.get(STORAGE_KEYS.SETTINGS);
    } catch (error) {
      console.error('读取 settings.json 失败:', error);
      return this.get(STORAGE_KEYS.SETTINGS);
    }
  }

  // 直接写入 settings.json 文件（兼容旧数据格式）
  setSettings(settings: any): void {
    try {
      const settingsPath = path.join(this.storageManager['baseDataPath'], 'settings.json');
      const settingsDir = path.dirname(settingsPath);
      if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (error) {
      console.error('写入 settings.json 失败:', error);
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
