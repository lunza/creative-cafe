/**
 * Token 计数 IPC 处理器
 *
 * 暴露精确 Token 计数能力给渲染进程：
 * - `token:count`：单条文本计数
 * - `token:countBatch`：批量计数（减少跨进程往返）
 *
 * 底层服务：TokenCountService（gpt-tokenizer / cl100k_base，纯 JS 同步实现）
 *
 * Spec: optimize-chat-ai-intelligence / Task 1.2
 */

import { ipcMain } from 'electron';
import { getTokenCountService } from '../../services/TokenCountService';

export interface TokenCountBatchItem {
  id: string;
  text: string;
}

export interface TokenCountBatchResult {
  id: string;
  count: number;
}

export function registerTokenHandlers(): void {
  const service = getTokenCountService();

  // 单条文本计数
  ipcMain.handle('token:count', async (_event, text: string): Promise<number> => {
    try {
      // 确保 cl100k_base 编码器已加载（首次会触发异步 import）
      await service.warmup();
      return service.countTokens(text ?? '');
    } catch (err) {
      console.error('[tokenHandlers] token:count error:', err);
      // 兜底：返回字节估算，永远不抛错给前端
      return service.countTokens(text ?? '');
    }
  });

  // 批量计数：messages: {id, text}[] -> {id, count}[]
  ipcMain.handle(
    'token:countBatch',
    async (_event, items: TokenCountBatchItem[]): Promise<TokenCountBatchResult[]> => {
      try {
        await service.warmup();
        if (!Array.isArray(items)) return [];
        return items.map((item) => ({
          id: item?.id ?? '',
          count: service.countTokens(item?.text ?? ''),
        }));
      } catch (err) {
        console.error('[tokenHandlers] token:countBatch error:', err);
        return (items ?? []).map((item) => ({
          id: item?.id ?? '',
          count: service.countTokens(item?.text ?? ''),
        }));
      }
    }
  );
}
