/**
 * 【Phase 4 / L4 - conversation-mode-optimization-report】对话质量检查 IPC handler。
 *
 * 涵盖：
 *   - 对话质量检查（characterQuality:check）
 *   - 单条问题自动修正（characterQuality:fixIssue）
 *   - 检查历史查询 / 清空（characterQuality:getHistory / characterQuality:clearHistory）
 */
import { ipcMain } from 'electron';
import { dialogueQualityCheckerService } from '../../services/character/DialogueQualityCheckerService';
import { addLog } from '../../services/memory/chatLogService';
import {
  DialogueQualityCheckRequest,
  DialogueQualityFixRequest,
} from '../../../shared/types/dialogueQuality.types';

export function registerCharacterQualityCheckHandlers(): void {
  ipcMain.handle('characterQuality:check', async (_event, request: DialogueQualityCheckRequest) => {
    try {
      addLog('===== 对话质量检查请求 =====', 'debug');
      const report = await dialogueQualityCheckerService.checkDialogue(request);
      return { success: true, report, error: null };
    } catch (error) {
      addLog(`对话质量检查错误: ${error instanceof Error ? error.message : String(error)}`, 'error');
      return {
        success: false,
        report: null,
        error: error instanceof Error ? error.message : '对话质量检查失败',
      };
    }
  });

  ipcMain.handle('characterQuality:fixIssue', async (_event, request: DialogueQualityFixRequest) => {
    try {
      const result = await dialogueQualityCheckerService.fixIssue(request);
      return result;
    } catch (error) {
      return {
        success: false,
        fixedContent: request.targetMessage.content,
        error: error instanceof Error ? error.message : '自动修正失败',
      };
    }
  });

  ipcMain.handle('characterQuality:getHistory', async (_event, characterCardId: string) => {
    try {
      return { success: true, history: dialogueQualityCheckerService.getHistory(characterCardId) };
    } catch (error) {
      return { success: false, history: [], error: error instanceof Error ? error.message : '获取检查历史失败' };
    }
  });

  ipcMain.handle('characterQuality:clearHistory', async (_event, characterCardId: string) => {
    try {
      return { success: dialogueQualityCheckerService.clearHistory(characterCardId) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '清空检查历史失败' };
    }
  });
}
