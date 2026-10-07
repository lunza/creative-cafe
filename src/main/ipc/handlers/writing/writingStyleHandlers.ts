/**
 * 写作模式 - 风格学习 IPC handler
 *
 * 涵盖：风格学习（upload / list / get / delete / cancel / getActiveTasks）
 */
import { ipcMain } from 'electron';
import { writingStorageService } from '../../../services/WritingStorageService';
import { writingStyleLearningService } from '../../../services/WritingStyleLearningService';

export function registerWritingStyleHandlers(): void {
  // ========== 风格学习 ==========

  // File upload and start learning
  ipcMain.handle('writing:style:upload', async (event, request: { filePath: string; fileName: string; fileSize: number }) => {
    try {
      const taskId = `style_learning_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Start learning in background (don't await)
      writingStyleLearningService.startLearning(request, taskId).then(resource => {
        return { success: true, taskId, resource };
      }).catch(error => {
        console.error('[Writing] Style learning failed:', error);
        event.sender.send('writing:style:error', {
          taskId,
          error: error instanceof Error ? error.message : '学习失败'
        });
        return { success: false, taskId, error: error instanceof Error ? error.message : '学习失败' };
      });

      return { success: true, taskId };
    } catch (error) {
      return {
        success: false,
        taskId: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // List all learned writing styles
  ipcMain.handle('writing:style:list', async () => {
    try {
      const styles = await writingStorageService.listWritingStyles();
      return { success: true, styles };
    } catch (error) {
      return {
        success: false,
        styles: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Get single writing style resource
  ipcMain.handle('writing:style:get', async (_event, resourceId: string) => {
    try {
      const style = await writingStorageService.loadWritingStyle(resourceId);
      if (!style) {
        return { success: false, style: null, error: '写作风格不存在' };
      }
      return { success: true, style };
    } catch (error) {
      return {
        success: false,
        style: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Delete writing style
  ipcMain.handle('writing:style:delete', async (_event, resourceId: string) => {
    try {
      const success = await writingStorageService.deleteWritingStyle(resourceId);
      return { success };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Cancel learning task
  ipcMain.handle('writing:style:cancel', async (_event, taskId: string) => {
    try {
      const cancelled = writingStyleLearningService.cancelLearning(taskId);
      return { success: cancelled };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Get active learning tasks
  ipcMain.handle('writing:style:getActiveTasks', async () => {
    try {
      const activeTaskIds = writingStyleLearningService.getActiveTaskIds();
      return { success: true, activeTaskIds };
    } catch (error) {
      return {
        success: false,
        activeTaskIds: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

}
