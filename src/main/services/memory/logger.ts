/**
 * 聊天记录服务共享模块
 * - 游离日志函数（generateNewRequestId/getCurrentRequestId/setRequestId/addLog）
 * - 共享类型定义
 * - 共享上下文 ChatLogContext 与工具函数 getSafeChatId
 *
 * 这些内容被各子模块（chatSessionRepository/aiPromptBuilder/...）共享引用，
 * 放在此处可避免 organizeOrchestrator 与 associationRepository 之间的运行时循环依赖。
 */

import { createLogger } from '../logger';

// 主应用日志实例（writing 分类），供 sendOrganizeNotification 等直接使用
export const logger = createLogger('writing');

// ========== 请求 ID 与 addLog ==========

let currentRequestId = '';

export function generateNewRequestId(): string {
  currentRequestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  return currentRequestId;
}

export function getCurrentRequestId(): string {
  return currentRequestId;
}

export function setRequestId(id: string): void {
  currentRequestId = id;
}

// 记录日志的函数（导出供写作模式等模块使用）
export const addLog = (message: string, type: 'error' | 'warn' | 'info' | 'debug' = 'info') => {
  const requestId = currentRequestId ? `[${currentRequestId}]` : '';
  const fullMessage = requestId ? `${requestId} ${message}` : message;
  switch (type) {
    case 'error':
      logger.error(fullMessage);
      break;
    case 'warn':
      logger.warn(fullMessage);
      break;
    case 'debug':
      logger.debug(fullMessage);
      break;
    case 'info':
    default:
      logger.info(fullMessage);
      break;
  }
};

/**
 * 整理任务通知：与 addLog 行为一致（按 level 路由到 logger.error/warn/info/debug）。
 * 第一个参数 chatId 当前未参与日志输出，保留参数以兼容原 API。
 */
export function sendOrganizeNotification(chatId: string, message: string, level: 'info' | 'warn' | 'error' | 'debug'): void {
  void chatId;
  switch (level) {
    case 'error':
      logger.error(message);
      break;
    case 'warn':
      logger.warn(message);
      break;
    case 'debug':
      logger.debug(message);
      break;
    case 'info':
    default:
      logger.info(message);
      break;
  }
}

// ========== 共享类型定义 ==========

// 定义聊天记录接口
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  chatId: string;
}

export interface ChatSession {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  messageCount: number;
  preview: string;
  characterName: string;
  templateId?: string;
  isTemplateAssociated?: boolean;
  isProcessed?: boolean; // 是否已完成整理
  organizingProgress?: { processedCount: number; totalMessages: number; lastProcessedAt?: string };
}

export interface AssociationRecord {
  templateId: string;
  processedCount: number;
  totalMessages: number;
  lastProcessedAt?: string;
}

export interface AIProcessingResult {
  sheetName: string;
  updates: Record<string, unknown>[];
  preview: string;
}

// 整理选项接口
export interface OrganizeOptions {
  continueFromLast?: boolean; // 是否从上次位置继续（实时整理）
  restart?: boolean; // 是否重新开始（完全整理）
  minInterval?: number; // 最小间隔时间（毫秒），用于防抖
}

// 定义 SillyTavern 消息接口
export interface SillyTavernMessage {
  name: string;
  is_user: boolean;
  is_system: boolean;
  send_date: string;
  mes: string;
  extra?: unknown;
  swipes?: string[];
  swipe_id?: number;
  swipe_info?: unknown[];
  hash_sheets?: unknown;
}

// 定义 SillyTavern 聊天元数据接口
export interface SillyTavernChatMetadata {
  chat_metadata: {
    integrity: string;
    sheets: unknown[];
    selected_sheets: string[];
  };
  user_name: string;
  character_name: string;
}

// 整理锁条目类型
export interface OrganizingLockEntry {
  isOrganizing: boolean;
  lastOrganizeTime: number;
  organizeType: 'auto' | 'manual';
}

// ========== 共享上下文 ==========
// 各子模块通过此上下文访问共享状态（目录、锁、AbortController），
// 由 Facade (chatLogService.ts) 创建并维护唯一实例。

export interface ChatLogContext {
  chatsDir: string;
  chatlogDir: string;
  organizingLocks: Map<string, OrganizingLockEntry>;
  organizeAbortControllers: Map<string, AbortController>;
}

export function createInitialContext(): ChatLogContext {
  return {
    chatsDir: '',
    chatlogDir: '',
    organizingLocks: new Map(),
    organizeAbortControllers: new Map(),
  };
}

// ========== 工具函数 ==========

/**
 * 将 chatId 转换为安全的文件名（替换路径分隔符与特殊字符）
 */
export function getSafeChatId(chatId: string): string {
  return chatId
    .replace(/\//g, '_')
    .replace(/\\/g, '_')
    .replace(/\s+/g, '_')
    .replace(/@/g, '_')
    .replace(/-/g, '_')
    .replace(/:/g, '_')
    .replace(/\*/g, '_')
    .replace(/\?/g, '_')
    .replace(/"/g, '_')
    .replace(/</g, '_')
    .replace(/>/g, '_')
    .replace(/\|/g, '_');
}
