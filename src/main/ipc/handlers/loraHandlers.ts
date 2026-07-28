/**
 * LoRA 模型 IPC 处理器
 *
 * 通道列表：
 *   - lora:list  获取 LoRA 模型列表（含预览图 URL + JSON 元数据）
 */
import { ipcMain } from 'electron';
import { loraService } from '../../services/loraService';

export function registerLoraHandlers() {
  ipcMain.handle('lora:list', async (_event, args: { endpoint: string }) => {
    try {
      return await loraService.fetchLoraList(args.endpoint);
    } catch (error) {
      console.error('[LoraHandler] lora:list failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
