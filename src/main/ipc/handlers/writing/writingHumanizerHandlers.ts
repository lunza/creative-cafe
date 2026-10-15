/**
 * 写作模式 - Humanizer 文本转写 IPC handler（独立接口）
 *
 * 仅适配 jialinyyzz/humanizer 模型（text completion 接口，见 HumanizerService 头注释）。
 * 与既有润色/检查链路完全隔离：不复用 prompt 构建、不注入任何 humanizer 规则块、
 * 不走 chat completions——该模型要求字节级精确的 completion prompt。
 */
import { ipcMain } from 'electron';
import { writingStorageService } from '../../../services/WritingStorageService';
import { humanizerService } from '../../../services/writing/HumanizerService';
import { addLog } from '../../../services/memory/chatLogService';

export function registerWritingHumanizerHandlers(): void {
  ipcMain.handle('writing:humanizeChapter', async (_event, request: { projectId: string; chapterIndex: number; content: string }) => {
    try {
      addLog(`[Humanizer] 转写请求：项目=${request.projectId} 章节=${request.chapterIndex} 长度=${request.content?.length || 0}`, 'debug');

      const project = await writingStorageService.loadProject(request.projectId);
      if (!project) {
        return { success: false, error: '项目不存在' };
      }

      return await humanizerService.humanizeText(request.content || '');
    } catch (error: any) {
      addLog(`[Humanizer] 转写失败：${error?.message || error}`, 'error');
      return { success: false, error: `文本转写失败：${error?.message || error}` };
    }
  });
}
