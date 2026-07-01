/**
 * 记忆插件 - 外部系统调用 IPC handler
 *
 * 涵盖：
 *   - 单条聊天记录处理（external:processSingleChat）
 *   - 批量聊天记录处理（external:processBatchChat）
 *
 * 这些 handler 为外部系统提供 REST 风格的 IPC 入口，返回结构化失败对象
 * （而非抛出异常），因此保留原 try/catch 结构以保持 IPC 响应形态不变，
 * 仅移除冗余的 console.error 调试输出。
 */
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import {
  ExternalProcessSingleChatRequest,
  ExternalProcessBatchChatRequest,
  ExternalProcessSingleChatResponse,
  ExternalProcessBatchChatResponse,
  externalTableProcessingService
} from '../../../services/memory/chatLogService';

export function registerMemoryExternalHandlers(): void {
  // ========== 外部系统调用 API ==========

  /**
   * 外部API：处理单条聊天记录
   */
  ipcMain.handle('memory:external:processSingleChat', async (
    _event: IpcMainInvokeEvent,
    request: ExternalProcessSingleChatRequest
  ): Promise<ExternalProcessSingleChatResponse> => {
    try {
      console.log('[External API IPC] 收到单条处理请求:', request.chatId);
      return await externalTableProcessingService.processSingleChat(request);
    } catch (error) {
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
    _event: IpcMainInvokeEvent,
    request: ExternalProcessBatchChatRequest
  ): Promise<ExternalProcessBatchChatResponse> => {
    try {
      console.log('[External API IPC] 收到批量处理请求，总数:', request.chatIds.length);
      return await externalTableProcessingService.processBatchChat(request);
    } catch (error) {
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
}
