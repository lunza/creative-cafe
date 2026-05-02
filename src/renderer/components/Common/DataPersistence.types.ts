// 数据存储结构类型定义
export interface DataStorage {
  settings: any;
  worldbooks: Record<string, any>;
  characters: Record<string, any>;
  creatives: Record<string, any>;
  chats: Record<string, any>;
  templates: Record<string, any>;
  version: string;
  lastUpdated: string;
}

// 数据持久化接口定义
export interface DataPersistence {
  // 通用方法
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  update<T>(key: string, updater: (value: T) => T): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  has(key: string): Promise<boolean>;
  getAll(): Promise<Record<string, any>>;
  export(): Promise<string>;
  import(data: string): Promise<void>;
  
  // 分类方法
  getSettings(): Promise<any>;
  setSettings(settings: any): Promise<void>;
  getWorldBook(id: string): Promise<any>;
  setWorldBook(id: string, data: any): Promise<void>;
  getCharacter(id: string): Promise<any>;
  setCharacter(id: string, data: any): Promise<void>;
  getCreative(id: string): Promise<any>;
  setCreative(id: string, data: any): Promise<void>;
  getChat(id: string): Promise<any>;
  setChat(id: string, data: any): Promise<void>;
  getTemplate(id: string): Promise<any>;
  setTemplate(id: string, data: any): Promise<void>;
  
  // 批量操作
  getWorldBooks(): Promise<Record<string, any>>;
  getCharacters(): Promise<Record<string, any>>;
  getCreatives(): Promise<Record<string, any>>;
  getChats(): Promise<Record<string, any>>;
  getTemplates(): Promise<Record<string, any>>;
  
  // 版本控制
  getVersion(): Promise<string>;
  setVersion(version: string): Promise<void>;
}

// 错误类型定义
export interface DataPersistenceError {
  code: string;
  message: string;
  details?: any;
}

// 数据验证结果类型
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  data?: any;
}

// 存储选项类型
export interface StorageOptions {
  name?: string;
  cwd?: string;
  encryptionKey?: string;
  clearInvalidConfig?: boolean;
  serialize?: (value: any) => string;
  deserialize?: (value: string) => any;
}
