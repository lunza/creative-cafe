/**
 * 【Phase 4 / L5 - conversation-mode-optimization-report】角色风格学习 IPC handler。
 *
 * 涵盖：
 *   - 基于对话历史学习角色风格（characterStyle:learn）
 *   - 风格档案列表 / 查询 / 删除（characterStyle:list / get / delete）
 *
 * 注意与 writingStyleHandlers.ts（写作模式风格学习）区分：
 * 本 handler 服务于角色卡对话模式，学习素材是对话历史而非上传文件。
 */
import { ipcMain } from 'electron';
import { characterStyleLearningService } from '../../services/character/CharacterStyleLearningService';
import { addLog } from '../../services/memory/chatLogService';
import { CharacterStyleLearningRequest } from '../../../shared/types/characterStyle.types';

export function registerCharacterStyleHandlers(): void {
  ipcMain.handle('characterStyle:learn', async (_event, request: CharacterStyleLearningRequest) => {
    try {
      addLog('===== 角色风格学习请求 =====', 'debug');
      const resource = await characterStyleLearningService.learnFromDialogue(request);
      return { success: resource.status === 'completed', resource, error: resource.error || null };
    } catch (error) {
      addLog(`角色风格学习错误: ${error instanceof Error ? error.message : String(error)}`, 'error');
      return {
        success: false,
        resource: null,
        error: error instanceof Error ? error.message : '风格学习失败',
      };
    }
  });

  ipcMain.handle('characterStyle:list', async () => {
    try {
      return { success: true, styles: characterStyleLearningService.list() };
    } catch (error) {
      return {
        success: false,
        styles: [],
        error: error instanceof Error ? error.message : '获取风格档案列表失败',
      };
    }
  });

  ipcMain.handle('characterStyle:get', async (_event, characterCardId: string) => {
    try {
      const style = characterStyleLearningService.get(characterCardId);
      return { success: true, style };
    } catch (error) {
      return {
        success: false,
        style: null,
        error: error instanceof Error ? error.message : '获取风格档案失败',
      };
    }
  });

  ipcMain.handle('characterStyle:delete', async (_event, characterCardId: string) => {
    try {
      const success = characterStyleLearningService.delete(characterCardId);
      return { success };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除风格档案失败',
      };
    }
  });
}
