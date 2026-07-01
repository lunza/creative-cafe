/**
 * 聊天记录管理服务（Facade 编排层）
 *
 * 本文件是 Task 7 拆分后的对外统一入口。原 3567 行 God Class 已按职责拆分为 8 个子模块：
 *   - logger.ts                  共享日志/类型/上下文/工具函数（叶子模块，避免循环依赖）
 *   - chatSessionRepository.ts   JSONL/角色卡聊天记录读取、会话列表、消息分页、搜索、筛选
 *   - aiPromptBuilder.ts         buildAIPrompt / buildAIPromptForProgressive / buildTableContext
 *   - aiClient.ts               AI 引擎参数、buildOrganizeConfig、callAIAPI(+Retry)、解析
 *   - tableFileRepository.ts     getTableData / saveTableData / applyAIResults / autoInit / deleteSession
 *                                 + rollbackTableData / saveProcessingResult（Task 7 从 organizeOrchestrator 迁入）
 *   - tableOperationExecutor.ts   executeTableEditCommands + 5 分支 + levenshteinDistance
 *   - associationRepository.ts    associateTemplate / saveAssociation / migrate / progress / status
 *   - organizeOrchestrator.ts    processChat / processChatProgressive / processChatFull + 锁 + AbortController
 *
 * 外部 API 完全保持不变：
 *   - `chatLogService` 单例（公共方法签名与原 ChatLogService 一致）
 *   - `externalTableProcessingService` 单例
 *   - `ExternalTableProcessingService` / `ChatLogService` 类导出
 *   - 全部 IPC channel 名不变（由 memoryHandlers.ts 调用方决定）
 *   - 全部接口类型 re-export（ChatSession/ChatMessage/AIProcessingResult/ExternalProcess*）
 *   - logger.ts 的 addLog / generateNewRequestId 等游离日志函数 re-export，供 writing/* 模块继续 import
 *
 * Task 6 性能优化保留：getTableData 返回 filePath、buildTableContext 第三参数 cachedJsonData、
 * processMessagesCore 内 cachedTableData / refreshTableCache / maybeSaveProgress（已在 organizeOrchestrator 内）。
 */

import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../../utils/appPath';

// ---------- 共享类型 + 日志 + 上下文（re-export） ----------
export {
  // 日志实例与函数
  logger,
  addLog,
  generateNewRequestId,
  getCurrentRequestId,
  setRequestId,
  sendOrganizeNotification,
  // 共享类型
  type ChatMessage,
  type ChatSession,
  type AssociationRecord,
  type AIProcessingResult,
  type OrganizeOptions,
  type SillyTavernMessage,
  type SillyTavernChatMetadata,
  type OrganizingLockEntry,
  type ChatLogContext,
  // 上下文工厂 + 工具
  createInitialContext,
  getSafeChatId,
} from './logger';

import { createInitialContext, addLog, type ChatLogContext, type AIProcessingResult, type OrganizeOptions } from './logger';

// ---------- 子模块函数 import ----------
import {
  getChatSessions,
  getChatSession,
  getChatMessages,
  searchChatMessages,
  filterChatMessages,
} from './chatSessionRepository';

import {
  applyAIResults,
  deleteChatSession,
  autoInitializeChatSession,
  getTableData,
  saveTableData,
} from './tableFileRepository';
import { executeTableEditCommands } from './tableOperationExecutor';
import {
  associateTemplate,
  getAssociatedTemplate,
  clearOrganizingProgress,
  clearTableData,
  getOrganizingProgress,
  setSessionProcessedStatus,
} from './associationRepository';
import {
  stopOrganizing,
  processChatWithAI,
  processChat,
  processChatProgressive,
  processChatFull,
} from './organizeOrchestrator';

// ---------- ExternalProcess 接口（原文件位置保持，外部已 import） ----------

/**
 * 单条聊天记录整理请求参数
 */
export interface ExternalProcessSingleChatRequest {
  chatId: string;
  templateId: string;
  config?: {
    apiKey: string;
    apiUrl: string;
    modelName: string;
    apiMode: string;
  };
  selectedMessageIds?: string[];
}

/**
 * 多条聊天记录批量整理请求参数
 */
export interface ExternalProcessBatchChatRequest {
  chatIds: string[];
  templateId: string;
  config?: {
    apiKey: string;
    apiUrl: string;
    modelName: string;
    apiMode: string;
  };
  selectedMessageIds?: string[];
}

/**
 * 单条聊天记录整理响应
 */
export interface ExternalProcessSingleChatResponse {
  success: boolean;
  chatId: string;
  tablePath?: string;
  error?: string;
}

/**
 * 多条聊天记录批量整理响应
 */
export interface ExternalProcessBatchChatResponse {
  success: boolean;
  results: Array<{
    chatId: string;
    success: boolean;
    tablePath?: string;
    error?: string;
  }>;
  totalCount: number;
  successCount: number;
  failureCount: number;
}

// ---------- Facade 类 ----------

/**
 * ChatLogService Facade
 * - 持有唯一 `ctx: ChatLogContext` 实例（chatsDir / chatlogDir / 锁 / AbortController）
 * - 每个公共方法委托到对应子模块函数，传入 ctx
 * - 公共方法签名与原 God Class 完全一致（executeTableEditCommands 由原 private 改为 public，供 memoryHandlers 调用）
 */
export class ChatLogService {
  private ctx: ChatLogContext;

  constructor() {
    this.ctx = createInitialContext();

    // 使用 getUserDataPath 获取用户数据目录
    const userDataPath = getUserDataPath();

    // 聊天记录目录 - 使用用户数据目录
    this.ctx.chatsDir = path.join(userDataPath, 'data', 'memories', 'chats');
    addLog(`聊天记录目录: ${this.ctx.chatsDir}`, 'debug');

    // 设置聊天记录表格存储目录
    this.ctx.chatlogDir = path.join(userDataPath, 'data', 'memories', 'chatlog');
    addLog(`聊天记录表格存储目录: ${this.ctx.chatlogDir}`, 'debug');

    // 确保目录存在
    if (!fs.existsSync(this.ctx.chatsDir)) {
      console.warn('聊天记录目录不存在，将在首次使用时创建:', this.ctx.chatsDir);
    }

    // 确保聊天记录表格存储目录存在
    if (!fs.existsSync(this.ctx.chatlogDir)) {
      fs.mkdirSync(this.ctx.chatlogDir, { recursive: true });
      addLog(`创建聊天记录表格存储目录: ${this.ctx.chatlogDir}`, 'info');
    }
  }

  // ========== 目录管理 ==========

  /** 动态设置聊天记录目录（仅设置 chatsDir，不影响 chatlogDir，保持原行为） */
  setChatsDir(dir: string): void {
    this.ctx.chatsDir = dir;
    addLog(`聊天记录目录设置为: ${dir}`, 'debug');
  }

  /** 获取聊天记录目录 */
  getChatsDir(): string {
    return this.ctx.chatsDir;
  }

  // ========== 整理任务控制 ==========

  /** 停止正在进行的整理任务 */
  stopOrganizing(chatId: string): boolean {
    return stopOrganizing(this.ctx, chatId);
  }

  // ========== 聊天记录读取 ==========

  getChatSessions() {
    return getChatSessions(this.ctx);
  }

  getChatSession(chatId: string) {
    return getChatSession(this.ctx, chatId);
  }

  getChatMessages(chatId: string, page: number = 1, pageSize: number = 50) {
    return getChatMessages(this.ctx, chatId, page, pageSize);
  }

  searchChatMessages(keyword: string, chatId?: string) {
    return searchChatMessages(this.ctx, keyword, chatId);
  }

  filterChatMessages(chatId: string, filters: { sheetName?: string; startTime?: string; endTime?: string }) {
    return filterChatMessages(this.ctx, chatId, filters);
  }

  // ========== AI 处理 ==========

  async processChatWithAI(
    chatId: string,
    templateId: string,
    apiKey: string,
    apiUrl: string,
    modelName: string
  ) {
    return processChatWithAI(this.ctx, chatId, templateId, apiKey, apiUrl, modelName);
  }

  async processChat(
    chatId: string,
    templateId: string,
    selectedMessageIds?: string[],
    config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string }
  ): Promise<void> {
    return processChat(this.ctx, chatId, templateId, selectedMessageIds, config);
  }

  async processChatProgressive(
    chatId: string,
    templateId: string,
    config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string },
    onProgress?: (current: number, total: number, message: string, percent?: number) => void,
    options?: OrganizeOptions
  ) {
    return processChatProgressive(this.ctx, chatId, templateId, config, onProgress, options);
  }

  async processChatFull(
    chatId: string,
    templateId: string,
    config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string },
    onProgress?: (current: number, total: number, message: string, percent?: number) => void
  ) {
    return processChatFull(this.ctx, chatId, templateId, config, onProgress);
  }

  // ========== 表格文件操作 ==========

  applyAIResults(chatId: string, results: AIProcessingResult[]): string {
    return applyAIResults(this.ctx, chatId, results);
  }

  getTableData(chatId: string): any {
    return getTableData(this.ctx, chatId);
  }

  saveTableData(chatId: string, sheetName: string, sheetData: any[]): void {
    saveTableData(this.ctx, chatId, sheetName, sheetData);
  }

  deleteChatSession(chatId: string): boolean {
    return deleteChatSession(this.ctx, chatId);
  }

  autoInitializeChatSession(chatId: string): boolean {
    return autoInitializeChatSession(this.ctx, chatId);
  }

  /**
   * 直接执行 tableEdit 命令（异步整理模式使用）。
   * 原为 private 方法，因 memoryHandlers 通过 'memory:executeTableEditCommands' IPC
   * 外部调用，Facade 中改为 public 以保持 IPC 行为不变。
   */
  executeTableEditCommands(chatId: string, commands: any[]): { success: boolean; executed: number; errors: string[] } {
    return executeTableEditCommands(this.ctx, chatId, commands);
  }

  // ========== 模板关联与进度 ==========

  associateTemplate(chatId: string, templateId: string): void {
    associateTemplate(this.ctx, chatId, templateId);
  }

  getAssociatedTemplate(chatId: string): string | null {
    return getAssociatedTemplate(this.ctx, chatId);
  }

  clearOrganizingProgress(chatId: string): void {
    clearOrganizingProgress(this.ctx, chatId);
  }

  clearTableData(chatId: string): void {
    clearTableData(this.ctx, chatId);
  }

  getOrganizingProgress(chatId: string): { processedCount: number; totalMessages: number; lastProcessedAt?: string } | null {
    return getOrganizingProgress(this.ctx, chatId);
  }

  setSessionProcessedStatus(chatId: string, isProcessed: boolean): void {
    setSessionProcessedStatus(this.ctx, chatId, isProcessed);
  }
}

// ---------- 外部系统调用服务（保持原 API） ----------

/**
 * 外部系统调用服务
 * 提供给其他系统调用的表格整理接口
 */
export class ExternalTableProcessingService {
  private chatLogService: ChatLogService;

  constructor(chatLogService: ChatLogService) {
    this.chatLogService = chatLogService;
  }

  /**
   * 处理单条聊天记录
   */
  public async processSingleChat(request: ExternalProcessSingleChatRequest): Promise<ExternalProcessSingleChatResponse> {
    try {
      addLog(`[External API] 开始处理单条聊天记录: ${request.chatId}`, 'info');

      await this.chatLogService.processChat(
        request.chatId,
        request.templateId,
        request.selectedMessageIds,
        request.config
      );

      const tableData = this.chatLogService.getTableData(request.chatId);

      addLog(`[External API] 单条聊天记录处理成功: ${request.chatId}`, 'info');

      return {
        success: true,
        chatId: request.chatId,
        tablePath: tableData?.filePath || ''
      };
    } catch (error) {
      console.error('[External API] 单条聊天记录处理失败:', request.chatId, error);
      return {
        success: false,
        chatId: request.chatId,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 批量处理多条聊天记录
   */
  public async processBatchChat(request: ExternalProcessBatchChatRequest): Promise<ExternalProcessBatchChatResponse> {
    addLog(`[External API] 开始批量处理聊天记录，总数: ${request.chatIds.length}`, 'info');

    const results: ExternalProcessBatchChatResponse['results'] = [];
    let successCount = 0;
    let failureCount = 0;

    for (const chatId of request.chatIds) {
      try {
        addLog(`[External API] 处理聊天记录: ${chatId}`, 'info');

        await this.chatLogService.processChat(
          chatId,
          request.templateId,
          request.selectedMessageIds,
          request.config
        );

        const tableData = this.chatLogService.getTableData(chatId);

        results.push({
          chatId,
          success: true,
          tablePath: tableData?.filePath || ''
        });
        successCount++;

        addLog(`[External API] 聊天记录处理成功: ${chatId}`, 'info');
      } catch (error) {
        console.error('[External API] 聊天记录处理失败:', chatId, error);
        results.push({
          chatId,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
        failureCount++;
      }
    }

    addLog(`[External API] 批量处理完成，成功: ${successCount}, 失败: ${failureCount}`, 'info');

    return {
      success: failureCount === 0,
      results,
      totalCount: request.chatIds.length,
      successCount,
      failureCount
    };
  }

  // 注：原 getChatSessions / getChatMessages / getTableData / associateTemplate
  // 4 个纯转调代理方法已删除（外部调用方 memoryHandlers.ts 仅使用 processSingleChat/processBatchChat，
  // 其他场景应直接使用 chatLogService 实例）。如需保留兼容接口请在此处重新添加。
}

// ---------- 单例导出 ----------

// 先创建 chatLogService 实例
export const chatLogService = new ChatLogService();

// 再创建外部服务实例（确保 chatLogService 已初始化）
export const externalTableProcessingService = new ExternalTableProcessingService(chatLogService);
