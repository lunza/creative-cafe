/**
 * 记忆插件 IPC 处理器
 * 处理与记忆插件相关的 IPC 请求
 */

import { ipcMain, IpcMainInvokeEvent, dialog } from 'electron';
import path from 'path';
import { getUserDataPath } from '../../utils/appPath';
import { getStorageService } from '../../services/storageService';
import { tableTemplateService } from '../../services/memory/tableTemplateService';
import { chatLogService } from '../../services/memory/chatLogService';
import { TableTemplate, TableSheet } from '../../services/memory/tableTemplateService';
import { 
  ChatSession, 
  ChatMessage, 
  AIProcessingResult,
  ExternalProcessSingleChatRequest,
  ExternalProcessBatchChatRequest,
  ExternalProcessSingleChatResponse,
  ExternalProcessBatchChatResponse,
  externalTableProcessingService
} from '../../services/memory/chatLogService';

function resolveUserDataPlaceholder(dir: string): string {
  if (dir.startsWith('__USER_DATA__')) {
    return dir.replace('__USER_DATA__', getUserDataPath());
  }
  return dir;
}

export function registerMemoryHandlers() {
  // 初始化时从设置中加载聊天记录路径
  try {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    if (settings && settings.memoryPath) {
      const resolvedPath = resolveUserDataPlaceholder(settings.memoryPath);
      const chatsDir = path.join(resolvedPath, 'chats');
      console.log('[registerMemoryHandlers] 从设置中加载聊天记录路径:', chatsDir);
      chatLogService.setChatsDir(chatsDir);
    } else {
      // 如果没有设置，使用默认路径
      const defaultPath = resolveUserDataPlaceholder('__USER_DATA__/data/memories');
      const chatsDir = path.join(defaultPath, 'chats');
      console.log('[registerMemoryHandlers] 使用默认聊天记录路径:', chatsDir);
      chatLogService.setChatsDir(chatsDir);
    }
  } catch (error) {
    console.error('[registerMemoryHandlers] 加载聊天记录路径失败:', error);
    const defaultPath = resolveUserDataPlaceholder('__USER_DATA__/data/memories');
    const chatsDir = path.join(defaultPath, 'chats');
    chatLogService.setChatsDir(chatsDir);
  }

  // ========== 表格模板管理 ==========
  
  /**
   * 获取所有模板
   */
  ipcMain.handle('memory:getAllTemplates', async (): Promise<TableTemplate[]> => {
    try {
      console.log('获取所有模板...');
      const templates = tableTemplateService.getAllTemplates();
      console.log(`成功获取 ${templates.length} 个模板`);
      return templates;
    } catch (error) {
      console.error('获取模板失败:', error);
      throw error;
    }
  });

  /**
   * 获取单个模板
   */
  ipcMain.handle('memory:getTemplate', async (event: IpcMainInvokeEvent, templateId: string): Promise<TableTemplate | null> => {
    try {
      console.log(`获取模板 ${templateId}...`);
      const template = tableTemplateService.getTemplate(templateId);
      console.log(`模板 ${templateId} 获取成功:`, template ? '找到' : '未找到');
      return template;
    } catch (error) {
      console.error(`获取模板 ${templateId} 失败:`, error);
      throw error;
    }
  });

  /**
   * 创建新模板
   */
  ipcMain.handle('memory:createTemplate', async (
    event: IpcMainInvokeEvent,
    template: Omit<TableTemplate, 'id' | 'createdAt' | 'updatedAt' | 'version'>
  ): Promise<TableTemplate> => {
    try {
      console.log('创建新模板:', template.name);
      console.log('模板数据:', JSON.stringify(template, null, 2));
      const createdTemplate = tableTemplateService.createTemplate(template);
      console.log('模板创建成功:', createdTemplate.id);
      return createdTemplate;
    } catch (error) {
      console.error('创建模板失败:', error);
      throw error;
    }
  });

  /**
   * 更新模板
   */
  ipcMain.handle('memory:updateTemplate', async (
    event: IpcMainInvokeEvent,
    templateId: string,
    updates: Partial<TableTemplate>
  ): Promise<TableTemplate | null> => {
    try {
      console.log(`更新模板 ${templateId}...`);
      console.log('更新数据:', JSON.stringify(updates, null, 2));
      const updatedTemplate = tableTemplateService.updateTemplate(templateId, updates);
      console.log(`模板 ${templateId} 更新成功`);
      return updatedTemplate;
    } catch (error) {
      console.error(`更新模板 ${templateId} 失败:`, error);
      throw error;
    }
  });

  /**
   * 删除模板
   */
  ipcMain.handle('memory:deleteTemplate', async (event: IpcMainInvokeEvent, templateId: string): Promise<boolean> => {
    try {
      console.log(`删除模板 ${templateId}...`);
      const result = tableTemplateService.deleteTemplate(templateId);
      console.log(`模板 ${templateId} 删除 ${result ? '成功' : '失败'}`);
      return result;
    } catch (error) {
      console.error(`删除模板 ${templateId} 失败:`, error);
      throw error;
    }
  });

  /**
   * 创建表格文件
   */
  ipcMain.handle('memory:createTableFile', async (
    event: IpcMainInvokeEvent,
    chatId: string,
    templateId: string
  ): Promise<string> => {
    return tableTemplateService.createTableFile(chatId, templateId);
  });

  /**
   * 读取表格文件
   */
  ipcMain.handle('memory:readTableFile', async (event: IpcMainInvokeEvent, chatId: string): Promise<Record<string, any[]>> => {
    return tableTemplateService.readTableFile(chatId);
  });

  /**
   * 更新表格文件
   */
  ipcMain.handle('memory:updateTableFile', async (event: IpcMainInvokeEvent, chatId: string, sheetName: string, data: any[]): Promise<string> => {
    return tableTemplateService.updateTableFile(chatId, sheetName, data);
  });

  /**
   * 获取模板版本历史
   */
  ipcMain.handle('memory:getVersionHistory', async (event: IpcMainInvokeEvent, templateId: string): Promise<string[]> => {
    return tableTemplateService.getVersionHistory(templateId);
  });

  /**
   * 恢复历史版本
   */
  ipcMain.handle('memory:restoreVersion', async (event: IpcMainInvokeEvent, templateId: string, version: string): Promise<TableTemplate | null> => {
    return tableTemplateService.restoreVersion(templateId, version);
  });

  /**
   * 获取模板绑定状态
   */
  ipcMain.handle('memory:getTemplateBindingStatus', async (): Promise<Record<string, boolean>> => {
    try {
      console.log('获取模板绑定状态...');
      const bindingStatus = tableTemplateService.getTemplateBindingStatus();
      console.log('模板绑定状态获取成功:', bindingStatus);
      return bindingStatus;
    } catch (error) {
      console.error('获取模板绑定状态失败:', error);
      return {};
    }
  });

  // ========== 聊天记录管理 ==========
  
  /**
   * 获取所有聊天会话列表
   */
  ipcMain.handle('memory:getChatSessions', async (): Promise<ChatSession[]> => {
    try {
      console.log('获取所有聊天会话列表...');
      const sessions = chatLogService.getChatSessions();
      console.log(`成功获取 ${sessions.length} 个聊天会话`);
      return sessions;
    } catch (error) {
      console.error('获取聊天会话失败:', error);
      return [];
    }
  });

  /**
   * 获取聊天会话信息
   */
  ipcMain.handle('memory:getChatSession', async (event: IpcMainInvokeEvent, chatId: string): Promise<ChatSession | null> => {
    return chatLogService.getChatSession(chatId);
  });

  /**
   * 获取聊天记录（分页）
   */
  ipcMain.handle('memory:getChatMessages', async (
    event: IpcMainInvokeEvent,
    chatId: string,
    page: number,
    pageSize: number
  ): Promise<{ messages: ChatMessage[], total: number, totalPages: number }> => {
    return chatLogService.getChatMessages(chatId, page, pageSize);
  });

  /**
   * 搜索聊天记录
   */
  ipcMain.handle('memory:searchChatMessages', async (
    event: IpcMainInvokeEvent,
    keyword: string,
    chatId?: string
  ): Promise<ChatMessage[]> => {
    return chatLogService.searchChatMessages(keyword, chatId);
  });

  /**
   * 筛选聊天记录
   */
  ipcMain.handle('memory:filterChatMessages', async (
    event: IpcMainInvokeEvent,
    chatId: string,
    filters: { sheetName?: string; startTime?: string; endTime?: string }
  ): Promise<ChatMessage[]> => {
    return chatLogService.filterChatMessages(chatId, filters);
  });

  /**
   * AI 处理聊天记录
   */
  ipcMain.handle('memory:processChatWithAI', async (
    event: IpcMainInvokeEvent,
    chatId: string,
    templateId: string,
    config: { apiKey: string; apiUrl: string; modelName: string }
  ): Promise<AIProcessingResult[]> => {
    return chatLogService.processChatWithAI(
      chatId,
      templateId,
      config.apiKey,
      config.apiUrl,
      config.modelName
    );
  });

  /**
   * 应用 AI 处理结果
   */
  ipcMain.handle('memory:applyAIResults', async (
    event: IpcMainInvokeEvent,
    chatId: string,
    results: AIProcessingResult[]
  ): Promise<string> => {
    return chatLogService.applyAIResults(chatId, results);
  });

  /**
   * 删除聊天会话
   */
  ipcMain.handle('memory:deleteChatSession', async (event: IpcMainInvokeEvent, chatId: string): Promise<boolean> => {
    return chatLogService.deleteChatSession(chatId);
  });

  /**
   * 关联模板到聊天会话
   */
  ipcMain.handle('memory:associateTemplate', async (event: IpcMainInvokeEvent, chatId: string, templateId: string): Promise<void> => {
    try {
      console.log('关联模板:', { chatId, templateId });
      chatLogService.associateTemplate(chatId, templateId);
    } catch (error) {
      console.error('关联模板失败:', error);
      throw error;
    }
  });

  /**
   * 处理聊天记录
   */
  ipcMain.handle('memory:processChat', async (event: IpcMainInvokeEvent, chatId: string, templateId: string, selectedMessageIds?: string[], config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string }): Promise<void> => {
    try {
      console.log('处理聊天记录:', { chatId, templateId, selectedMessageIds, config });
      await chatLogService.processChat(chatId, templateId, selectedMessageIds, config);
    } catch (error) {
      console.error('处理聊天记录失败:', error);
      throw error;
    }
  });

  /**
   * 获取表格数据
   */
  ipcMain.handle('memory:getTableData', async (event: IpcMainInvokeEvent, chatId: string): Promise<any> => {
    console.log('获取表格数据:', chatId);
    return chatLogService.getTableData(chatId);
  });

  /**
   * 保存表格数据
   */
  ipcMain.handle('memory:saveTableData', async (event: IpcMainInvokeEvent, chatId: string, sheetName: string, sheetData: any[]): Promise<void> => {
    try {
      console.log('保存表格数据:', { chatId, sheetName, dataCount: sheetData.length });
      chatLogService.saveTableData(chatId, sheetName, sheetData);
      console.log('表格数据保存成功');
    } catch (error) {
      console.error('保存表格数据失败:', error);
      throw error;
    }
  });

  /**
   * 记录日志
   */
  ipcMain.on('memory:addLog', (event, message, type) => {
    console.log(`[MEMORY] ${message}`);
  });

  /**
   * 获取记忆目录路径
   */
  ipcMain.handle('memory:getMemoryDirectory', async (): Promise<string> => {
    return path.join(getUserDataPath(), 'data', 'memory');
  });

  // ========== 外部系统调用 API ==========
  
  /**
   * 外部API：处理单条聊天记录
   */
  ipcMain.handle('memory:external:processSingleChat', async (
    event: IpcMainInvokeEvent,
    request: ExternalProcessSingleChatRequest
  ): Promise<ExternalProcessSingleChatResponse> => {
    try {
      console.log('[External API IPC] 收到单条处理请求:', request.chatId);
      return await externalTableProcessingService.processSingleChat(request);
    } catch (error) {
      console.error('[External API IPC] 单条处理失败:', error);
      return {
        success: false,
        chatId: request.chatId,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  /**
   * 外部API：批量处理多条聊天记录
   */
  ipcMain.handle('memory:external:processBatchChat', async (
    event: IpcMainInvokeEvent,
    request: ExternalProcessBatchChatRequest
  ): Promise<ExternalProcessBatchChatResponse> => {
    try {
      console.log('[External API IPC] 收到批量处理请求，总数:', request.chatIds.length);
      return await externalTableProcessingService.processBatchChat(request);
    } catch (error) {
      console.error('[External API IPC] 批量处理失败:', error);
      return {
        success: false,
        results: request.chatIds.map(chatId => ({
          chatId,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        })),
        totalCount: request.chatIds.length,
        successCount: 0,
        failureCount: request.chatIds.length
      };
    }
  });

  console.log('记忆插件 IPC 处理器已注册');
}
