/**
 * 写作模式 - 表格管理 IPC handler
 *
 * 涵盖：
 *   - 表格数据 CRUD（getTableData / saveTableData / clearTableData / updateRowInTable）
 *   - 表格配置 CRUD（getTableConfig / saveTableConfig / associateTableTemplate）
 *   - 模板查询（getAllTemplates）
 *   - 表格整理（organizeTable / organizeSingleSheet / reorganizeRow /
 *     getOrganizeProgress / getChapterOrganizeStatus）
 *   - 版本快照（getVersionSnapshot / confirmVersion / rollbackVersion）
 *
 * organize* 系列通过 `writing:table:organizeProgress` 事件向渲染进程推送进度。
 */
import { ipcMain } from 'electron';
import { writingStorageService } from '../../../services/WritingStorageService';
import type { WritingTableConfig } from '../../../services/WritingStorageService';
import { tableTemplateService } from '../../../services/memory/tableTemplateService';
import { ModelConfig } from '../../../../shared/types/writing.types';

export function registerWritingTableHandlers(): void {
  // ========== 表格数据 CRUD ==========

  ipcMain.handle('writing:table:getTableData', async (_event, projectId: string) => {
    try {
      const data = await writingStorageService.getTableData(projectId);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : '获取表格数据失败'
      };
    }
  });

  ipcMain.handle('writing:table:saveTableData', async (_event, projectId: string, sheetName: string, sheetData: Record<string, any>[]) => {
    try {
      await writingStorageService.saveTableData(projectId, sheetName, sheetData);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存表格数据失败'
      };
    }
  });

  ipcMain.handle('writing:table:clearTableData', async (_event, projectId: string) => {
    try {
      await writingStorageService.clearTableData(projectId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '清空表格数据失败'
      };
    }
  });

  ipcMain.handle('writing:table:updateRowInTable', async (_event, projectId: string, sheetName: string, rowIndex: number, rowData: Record<string, any>) => {
    try {
      const result = await writingStorageService.updateRowInTable(projectId, sheetName, rowIndex, rowData);
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        result: false,
        error: error instanceof Error ? error.message : '更新行数据失败'
      };
    }
  });

  // ========== 表格配置 CRUD ==========

  ipcMain.handle('writing:table:getTableConfig', async (_event, projectId: string) => {
    try {
      const config = await writingStorageService.getTableConfig(projectId);
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        config: null,
        error: error instanceof Error ? error.message : '获取表格配置失败'
      };
    }
  });

  ipcMain.handle('writing:table:saveTableConfig', async (_event, projectId: string, config: WritingTableConfig) => {
    try {
      await writingStorageService.saveTableConfig(projectId, config);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存表格配置失败'
      };
    }
  });

  ipcMain.handle('writing:table:associateTableTemplate', async (_event, projectId: string, templateId: string, templateName: string, templateSheets: Array<{ name: string; headers: string[]; description?: string }>) => {
    try {
      if (!templateSheets || !Array.isArray(templateSheets) || templateSheets.length === 0) {
        return { success: false, error: '模板页签数据为空' };
      }
      await writingStorageService.associateTableTemplate(projectId, templateId, templateName, templateSheets);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '关联模板失败'
      };
    }
  });

  // ========== 模板查询 ==========

  ipcMain.handle('writing:table:getAllTemplates', async () => {
    try {
      const templates = tableTemplateService.getAllTemplates();
      return { success: true, templates };
    } catch (error) {
      return {
        success: false,
        templates: [],
        error: error instanceof Error ? error.message : '获取模板列表失败'
      };
    }
  });

  // ========== 表格整理 ==========

  ipcMain.handle('writing:table:organizeTable', async (event, projectId: string, modelConfig: ModelConfig, chapterIndex?: number, requirements?: string, skipOrganized?: boolean) => {
    try {
      const result = await writingStorageService.organizeTable(
        projectId,
        modelConfig,
        chapterIndex,
        // onProgress callback - 发送进度事件到渲染进程
        (current: number, total: number, message: string, percent?: number, currentChunk?: number, totalChunks?: number) => {
          if (event.sender && !event.sender.isDestroyed()) {
            event.sender.send('writing:table:organizeProgress', projectId, {
              current,
              total,
              message,
              percent: percent || 0,
              currentChunk: currentChunk || 0,
              totalChunks: totalChunks || 0,
              timestamp: Date.now()
            });
          } else {
            console.warn('[writingTableHandlers] organizeTable: 渲染进程已销毁，跳过进度事件发送:', { projectId, current, total, message });
          }
        },
        requirements,
        skipOrganized
      );
      return Object.assign({ success: true }, result);
    } catch (error) {
      return {
        success: false,
        processedCount: 0,
        errorCount: 0,
        errors: [error instanceof Error ? error.message : '整理失败'],
        error: error instanceof Error ? error.message : '整理失败'
      };
    }
  });

  // 整理单个表格
  ipcMain.handle('writing:table:organizeSingleSheet', async (event, projectId: string, sheetName: string, modelConfig: ModelConfig, chapterIndex?: number, requirements?: string) => {
    try {
      const result = await writingStorageService.organizeSingleSheet(
        projectId,
        sheetName,
        modelConfig,
        chapterIndex,
        // onProgress callback
        (current: number, total: number, message: string, percent?: number, currentChunk?: number, totalChunks?: number) => {
          if (event.sender && !event.sender.isDestroyed()) {
            event.sender.send('writing:table:organizeProgress', projectId, {
              current,
              total,
              message,
              percent: percent || 0,
              currentChunk: currentChunk || 0,
              totalChunks: totalChunks || 0,
              timestamp: Date.now()
            });
          } else {
            console.warn('[writingTableHandlers] organizeSingleSheet: 渲染进程已销毁，跳过进度事件发送:', { projectId, sheetName, current, total, message });
          }
        },
        requirements
      );
      return Object.assign({ success: true }, result);
    } catch (error) {
      return {
        success: false,
        processedCount: 0,
        errorCount: 0,
        errors: [error instanceof Error ? error.message : '整理失败'],
        error: error instanceof Error ? error.message : '整理失败'
      };
    }
  });

  ipcMain.handle('writing:table:reorganizeRow', async (_event, projectId: string, sheet: string, rowIndex: number, rowData: Record<string, any>, requirements: string, modelConfig: ModelConfig) => {
    try {
      if (!requirements || requirements.trim() === '') {
        return { success: false, error: '请输入整理要求' };
      }
      const result = await writingStorageService.reorganizeRow(
        projectId, sheet, rowIndex, rowData, requirements, modelConfig
      );
      return Object.assign({ success: true }, result);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '重新整理失败'
      };
    }
  });

  ipcMain.handle('writing:table:getOrganizeProgress', async (_event, projectId: string) => {
    try {
      const progress = await writingStorageService.getOrganizeProgress(projectId);
      return { success: true, progress };
    } catch (error) {
      return {
        success: false,
        progress: null,
        error: error instanceof Error ? error.message : '获取进度失败'
      };
    }
  });

  ipcMain.handle('writing:table:getChapterOrganizeStatus', async (_event, projectId: string) => {
    try {
      const status = await writingStorageService.getChapterOrganizeStatus(projectId);
      return { success: true, status };
    } catch (error) {
      return { success: false, status: [], error: error instanceof Error ? error.message : '获取章节状态失败' };
    }
  });

  // ========== 版本快照 ==========

  ipcMain.handle('writing:table:getVersionSnapshot', async (_event, projectId: string) => {
    try {
      const snapshot = await writingStorageService.getVersionSnapshot(projectId);
      return { success: true, snapshot };
    } catch (error) {
      return {
        success: false,
        snapshot: null,
        error: error instanceof Error ? error.message : '获取版本快照失败'
      };
    }
  });

  ipcMain.handle('writing:table:confirmVersion', async (_event, projectId: string) => {
    try {
      const result = await writingStorageService.confirmVersion(projectId);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '确认版本失败'
      };
    }
  });

  ipcMain.handle('writing:table:rollbackVersion', async (_event, projectId: string) => {
    try {
      const result = await writingStorageService.rollbackVersion(projectId);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '回退版本失败'
      };
    }
  });
}
