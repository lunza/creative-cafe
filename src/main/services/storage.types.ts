/**
 * 存储系统类型定义
 */

// 存储模块枚举
export enum StorageModule {
  CONFIG = 'config',
  CREATIVE = 'creative',
  CHARACTER = 'character',
  WORLD_BOOK = 'worldbook',
  MEMORY = 'memory',
  EDITOR = 'editor'
}

// 操作类型
export type StorageOperation = 'read' | 'write' | 'delete';

// 权限接口
export interface StoragePermission {
  module: StorageModule;
  operations: StorageOperation[];
}

// 模块路径映射
export const MODULE_PATH_MAP: Record<StorageModule, string> = {
  [StorageModule.CONFIG]: 'config',
  [StorageModule.CREATIVE]: 'creatives',
  [StorageModule.CHARACTER]: 'characters',
  [StorageModule.WORLD_BOOK]: 'worldbooks',
  [StorageModule.MEMORY]: 'memories',
  [StorageModule.EDITOR]: 'editor'
};

// 模块前缀映射（用于文件名生成）
export const MODULE_PREFIX_MAP: Record<StorageModule, string> = {
  [StorageModule.CONFIG]: 'cfg',
  [StorageModule.CREATIVE]: 'crt',
  [StorageModule.CHARACTER]: 'chr',
  [StorageModule.WORLD_BOOK]: 'wbk',
  [StorageModule.MEMORY]: 'mem',
  [StorageModule.EDITOR]: 'edt'
};

// 新的目录结构常量
export const STORAGE_DIRECTORIES = {
  BASE: 'data',
  ATTACHMENTS: 'attachments',
  BACKUPS: 'backups',
  LOGS: 'logs',
  METADATA: 'metadata.json',
  EDITOR_CONTENTS: 'contents',
  MEMORY_CHATS: 'chats',
  MEMORY_TEMPLATES: 'templates',
  ATTACHMENT_IMAGES: 'images',
  ATTACHMENT_AUDIO: 'audio',
  ATTACHMENT_DOCUMENTS: 'documents'
};

// 存储文件命名规则
export const NAMING_RULES = {
  TIMESTAMP_FORMAT: 'YYYYMMDD_HHmmss',
  SEQUENCE_PAD_LENGTH: 3,
  MAX_SEQUENCE: 999,
  VALID_FILE_NAME_REGEX: /^[a-zA-Z0-9_-]+$/,
  PATH_SEPARATOR: '_'
};

// 解析后的文件名结构
export interface ParsedFileName {
  module: StorageModule;
  id: string;
  timestamp: string;
  sequence: number;
  fullName: string;
}

// 架构版本
export const STORAGE_ARCHITECTURE_VERSION = '3.0.0';

// 旧存储键到新模块的映射
export const LEGACY_KEY_TO_MODULE: Record<string, { module: StorageModule; file?: string }> = {
  'settings': { module: StorageModule.CONFIG, file: 'settings.json' },
  'version': { module: StorageModule.CONFIG, file: 'version.json' },
  'lastUpdated': { module: StorageModule.CONFIG, file: 'metadata.json' },
  'worldbooks': { module: StorageModule.WORLD_BOOK, file: 'worldbooks.json' },
  'characters': { module: StorageModule.CHARACTER, file: 'characters.json' },
  'creatives': { module: StorageModule.CREATIVE, file: 'creatives.json' },
  'chats': { module: StorageModule.MEMORY, file: 'chats.json' },
  'templates': { module: StorageModule.MEMORY, file: 'templates.json' }
};

// 默认的模块权限（每个模块对自己有完整权限）
export const DEFAULT_PERMISSIONS: Record<StorageModule, StoragePermission> = {
  [StorageModule.CONFIG]: { module: StorageModule.CONFIG, operations: ['read', 'write', 'delete'] },
  [StorageModule.CREATIVE]: { module: StorageModule.CREATIVE, operations: ['read', 'write', 'delete'] },
  [StorageModule.CHARACTER]: { module: StorageModule.CHARACTER, operations: ['read', 'write', 'delete'] },
  [StorageModule.WORLD_BOOK]: { module: StorageModule.WORLD_BOOK, operations: ['read', 'write', 'delete'] },
  [StorageModule.MEMORY]: { module: StorageModule.MEMORY, operations: ['read', 'write', 'delete'] },
  [StorageModule.EDITOR]: { module: StorageModule.EDITOR, operations: ['read', 'write', 'delete'] }
};

// 存储操作结果
export interface StorageResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  exists?: boolean;
}

// 元数据结构
export interface Metadata {
  version: string;
  lastUpdated: string;
}

// 版本号
export const CURRENT_VERSION = '3.0.0';
