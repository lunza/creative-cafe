/**
 * 记忆插件 - 聊天会话 / 角色卡聊天记录 IPC handler
 *
 * 涵盖：
 *   - 聊天会话管理（getChatSessions / getChatSession / deleteChatSession）
 *   - 聊天记录查询（getChatMessages / searchChatMessages / filterChatMessages）
 *   - 模板关联与自动初始化（associateTemplate / getAssociatedTemplate /
 *     autoInitializeSession）
 *   - 聊天记录 AI 处理（processChatWithAI / applyAIResults /
 *     processChatProgressive / processChatFull / processChat / stopOrganizing）
 *   - 整理进度（getOrganizingProgress / clearOrganizingProgress）
 *   - 通用工具（addLog / getMemoryDirectory）
 *   - 角色卡聊天记录（getCharacterChatRecords / getCharacterChatRecord /
 *     saveCharacterChatRecord / deleteCharacterChatRecord /
 *     vectorizeCharacterChat / getCharacterThumbnail）
 *
 * 对于「try/catch + console.error + throw」模式的 handler，统一通过
 * utils/wrapHandler 包装以消除重复样板；对于返回兜底值的 handler，
 * 保留原 try/catch 结构以保持 IPC 响应形态不变。
 */
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import { getUserDataPath } from '../../../utils/appPath';
import {
  chatLogService,
  ChatSession,
  ChatMessage,
  AIProcessingResult
} from '../../../services/memory/chatLogService';
import { characterChatRecordService } from '../../../services/memory/characterChatRecordService';
import { chatVectorizationService } from '../../../services/ChatVectorizationService';
import { wrapHandler } from '../utils/wrapHandler';

export function registerMemorySessionHandlers(): void {
  // ========== 整理控制 ==========

  ipcMain.handle('memory:stopOrganizing', async (
    _event: IpcMainInvokeEvent,
    chatId: string
  ): Promise<{ success: boolean }> => {
    try {
      const success = chatLogService.stopOrganizing(chatId);
      return { success };
    } catch (error) {
      return { success: false };
    }
  });

  // ========== 聊天会话管理 ==========

  /**
   * 获取所有聊天会话列表
   */
  ipcMain.handle('memory:getChatSessions', async (): Promise<ChatSession[]> => {
    try {
      console.log('获取所有聊天会话列表...');
      const sessions = await chatLogService.getChatSessions();
      console.log(`成功获取 ${sessions.length} 个聊天会话`);
      return sessions;
    } catch (error) {
      return [];
    }
  });

  /**
   * 获取聊天会话信息
   */
  ipcMain.handle(
    'memory:getChatSession',
    wrapHandler(async (_event: IpcMainInvokeEvent, chatId: string): Promise<ChatSession | null> => {
      return chatLogService.getChatSession(chatId);
    })
  );

  /**
   * 获取聊天记录（分页）
   */
  ipcMain.handle(
    'memory:getChatMessages',
    wrapHandler(async (
      _event: IpcMainInvokeEvent,
      chatId: string,
      page: number,
      pageSize: number
    ): Promise<{ messages: ChatMessage[]; total: number; totalPages: number }> => {
      return chatLogService.getChatMessages(chatId, page, pageSize);
    })
  );

  /**
   * 搜索聊天记录
   */
  ipcMain.handle(
    'memory:searchChatMessages',
    wrapHandler(async (
      _event: IpcMainInvokeEvent,
      keyword: string,
      chatId?: string
    ): Promise<ChatMessage[]> => {
      return chatLogService.searchChatMessages(keyword, chatId);
    })
  );

  /**
   * 筛选聊天记录
   */
  ipcMain.handle(
    'memory:filterChatMessages',
    wrapHandler(async (
      _event: IpcMainInvokeEvent,
      chatId: string,
      filters: { sheetName?: string; startTime?: string; endTime?: string }
    ): Promise<ChatMessage[]> => {
      return chatLogService.filterChatMessages(chatId, filters);
    })
  );

  /**
   * AI 处理聊天记录
   */
  ipcMain.handle(
    'memory:processChatWithAI',
    wrapHandler(async (
      _event: IpcMainInvokeEvent,
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
    })
  );

  /**
   * 应用 AI 处理结果
   */
  ipcMain.handle(
    'memory:applyAIResults',
    wrapHandler(async (
      _event: IpcMainInvokeEvent,
      chatId: string,
      results: AIProcessingResult[]
    ): Promise<string> => {
      return chatLogService.applyAIResults(chatId, results);
    })
  );

  /**
   * 删除聊天会话
   */
  ipcMain.handle(
    'memory:deleteChatSession',
    wrapHandler(async (_event: IpcMainInvokeEvent, chatId: string): Promise<boolean> => {
      return chatLogService.deleteChatSession(chatId);
    })
  );

  // ========== 模板关联 / 自动初始化 ==========

  /**
   * 关联模板到聊天会话
   */
  ipcMain.handle(
    'memory:associateTemplate',
    wrapHandler(async (_event: IpcMainInvokeEvent, chatId: string, templateId: string): Promise<void> => {
      console.log('关联模板:', { chatId, templateId });
      chatLogService.associateTemplate(chatId, templateId);
    })
  );

  /**
   * 获取聊天会话关联的模板ID
   */
  ipcMain.handle('memory:getAssociatedTemplate', async (_event: IpcMainInvokeEvent, chatId: string): Promise<string | null> => {
    try {
      const templateId = chatLogService.getAssociatedTemplate(chatId);
      console.log('[IPC] memory:getAssociatedTemplate 返回:', { chatId, templateId });
      return templateId || null;
    } catch (error) {
      return null;
    }
  });

  /**
   * 自动初始化聊天会话（首次对话时自动绑定默认模板并创建空表格）
   */
  ipcMain.handle('memory:autoInitializeSession', async (
    _event: IpcMainInvokeEvent,
    chatId: string
  ): Promise<{ success: boolean; templateId: string | null }> => {
    try {
      console.log('[IPC] memory:autoInitializeSession 请求, chatId:', chatId);

      // 如果已有模板，说明已初始化
      const existingTemplateId = chatLogService.getAssociatedTemplate(chatId);
      if (existingTemplateId) {
        console.log('[IPC] memory:autoInitializeSession 已初始化, templateId:', existingTemplateId);
        return { success: true, templateId: existingTemplateId };
      }

      // 执行自动初始化
      const success = chatLogService.autoInitializeChatSession(chatId);
      const newTemplateId = success ? chatLogService.getAssociatedTemplate(chatId) : null;

      console.log('[IPC] memory:autoInitializeSession 返回结果:', { success, templateId: newTemplateId });
      return { success, templateId: newTemplateId };
    } catch (error) {
      return { success: false, templateId: null };
    }
  });

  // ========== 聊天记录处理 ==========

  /**
   * 处理聊天记录（逐条处理模式 - 实时整理/增量更新）
   */
  ipcMain.handle(
    'memory:processChatProgressive',
    wrapHandler(async (
      event: IpcMainInvokeEvent,
      chatId: string,
      templateId: string,
      config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string },
      options?: { continueFromLast?: boolean; minInterval?: number }
    ): Promise<{ success: boolean; processedCount: number; errorCount: number; errors: string[]; resumed: boolean }> => {
      const { continueFromLast = true, minInterval = 3000 } = options || {};
      console.log('实时整理聊天记录:', { chatId, templateId, config, continueFromLast, minInterval });

      // 进度回调函数，通过事件发送到渲染进程
      const onProgress = (current: number, total: number, message: string, percent?: number) => {
        event.sender.send('memory:processChatProgress', { current, total, message, percent });
      };

      const result = await chatLogService.processChatProgressive(chatId, templateId, config, onProgress, { continueFromLast, minInterval });
      console.log('实时整理完成:', result);
      return result;
    })
  );

  /**
   * 完全整理聊天记录（清空数据重新处理）
   */
  ipcMain.handle(
    'memory:processChatFull',
    wrapHandler(async (
      event: IpcMainInvokeEvent,
      chatId: string,
      templateId: string,
      config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string }
    ): Promise<{ success: boolean; processedCount: number; errorCount: number; errors: string[] }> => {
      console.log('完全整理聊天记录:', { chatId, templateId, config });

      // 进度回调函数，通过事件发送到渲染进程
      const onProgress = (current: number, total: number, message: string, percent?: number) => {
        event.sender.send('memory:processChatProgress', { current, total, message, percent });
      };

      const result = await chatLogService.processChatFull(chatId, templateId, config, onProgress);
      console.log('完全整理完成:', result);
      return result;
    })
  );

  /**
   * 处理聊天记录
   */
  ipcMain.handle(
    'memory:processChat',
    wrapHandler(async (_event: IpcMainInvokeEvent, chatId: string, templateId: string, selectedMessageIds?: string[], config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string }): Promise<void> => {
      console.log('处理聊天记录:', { chatId, templateId, selectedMessageIds, config });
      await chatLogService.processChat(chatId, templateId, selectedMessageIds, config);
    })
  );

  // ========== 整理进度 ==========

  /**
   * 获取整理进度
   */
  ipcMain.handle('memory:getOrganizingProgress', async (
    _event: IpcMainInvokeEvent,
    chatId: string
  ): Promise<{ processedCount: number; totalMessages: number; lastProcessedAt?: string } | null> => {
    try {
      const progress = chatLogService.getOrganizingProgress(chatId);
      return progress;
    } catch (error) {
      return null;
    }
  });

  /**
   * 清除整理进度
   */
  ipcMain.handle('memory:clearOrganizingProgress', async (
    _event: IpcMainInvokeEvent,
    chatId: string
  ): Promise<boolean> => {
    try {
      console.log('清除整理进度:', chatId);
      chatLogService.clearOrganizingProgress(chatId);
      return true;
    } catch (error) {
      return false;
    }
  });

  // ========== 通用工具 ==========

  /**
   * 记录日志
   * 注意：原始实现使用 ipcMain.on（而非 ipcMain.handle），保留不变。
   */
  ipcMain.on('memory:addLog', (_event, message, _type) => {
    console.log(`[MEMORY] ${message}`);
  });

  /**
   * 获取记忆目录路径
   */
  ipcMain.handle(
    'memory:getMemoryDirectory',
    wrapHandler(async (): Promise<string> => {
      return path.join(getUserDataPath(), 'data', 'memories');
    })
  );

  // ========== 角色卡聊天记录管理 ==========

  /**
   * 获取所有角色卡聊天记录
   */
  ipcMain.handle('memory:getCharacterChatRecords', async () => {
    try {
      console.log('[IPC] memory:getCharacterChatRecords');
      const records = characterChatRecordService.getCharacterChatRecords();
      return records;
    } catch (error) {
      return [];
    }
  });

  /**
   * 获取单个角色卡聊天记录
   */
  ipcMain.handle('memory:getCharacterChatRecord', async (_event: IpcMainInvokeEvent, fileName: string) => {
    try {
      console.log('[IPC] memory:getCharacterChatRecord:', fileName);
      const record = characterChatRecordService.getCharacterChatRecord(fileName);
      return record;
    } catch (error) {
      return null;
    }
  });

  /**
   * 保存角色卡聊天记录
   */
  ipcMain.handle('memory:saveCharacterChatRecord', async (_event: IpcMainInvokeEvent, fileName: string, content: string) => {
    try {
      console.log('[IPC] memory:saveCharacterChatRecord:', fileName);
      const result = characterChatRecordService.saveCharacterChatRecord(fileName, content);
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 删除角色卡聊天记录
   */
  ipcMain.handle('memory:deleteCharacterChatRecord', async (_event: IpcMainInvokeEvent, fileName: string, characterCardName: string) => {
    try {
      console.log('[IPC] memory:deleteCharacterChatRecord:', fileName, characterCardName);
      const result = characterChatRecordService.deleteCharacterChatRecord(fileName, characterCardName);
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 向量化角色卡聊天记录
   */
  ipcMain.handle('memory:vectorizeCharacterChat', async (_event: IpcMainInvokeEvent, fileName: string) => {
    try {
      console.log('[IPC] memory:vectorizeCharacterChat:', fileName);
      const record = characterChatRecordService.getCharacterChatRecord(fileName);
      if (!record) {
        return { success: false, error: 'Chat record not found' };
      }
      const characterId = record.characterCardName;
      const messages = record.messages || [];
      const result = await chatVectorizationService.vectorizeChat(characterId, messages);
      console.log('[IPC] memory:vectorizeCharacterChat result:', result);
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 获取角色卡缩略图
   */
  ipcMain.handle('memory:getCharacterThumbnail', async (_event: IpcMainInvokeEvent, characterCardName: string) => {
    try {
      console.log('[IPC] memory:getCharacterThumbnail:', characterCardName);
      const thumbnail = await characterChatRecordService.getCharacterThumbnail(characterCardName);
      return thumbnail;
    } catch (error) {
      return null;
    }
  });
}
