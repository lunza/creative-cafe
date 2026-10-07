/**
 * 全流程创作流水线 IPC handler
 *
 * Spec: add-novel-writing-pipeline-api
 *
 * 通道（端点）：writing:pipeline:*，详见 docs/writing-pipeline-api.md
 * 进度事件：writing:pipeline:progress（转发到所有窗口，渲染层按 projectId 过滤）
 */
import { app, ipcMain, BrowserWindow } from 'electron';
import { writingPipelineService } from '../../services/writing/WritingPipelineService';
import { ExportFormat } from '../../../shared/types/writing.types';
import type {
  PipelineCreateCharacterParams,
  PipelineInitParams,
  PipelineE2EParams,
  PipelineProgressEvent,
} from '../../../shared/types/writing-v2.types';

/** 进度事件转发到所有窗口（事件自带 projectId，渲染层自行过滤） */
function forwardProgress(event: PipelineProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('writing:pipeline:progress', event);
    }
  }
}

export function registerWritingPipelineHandlers(): void {
  ipcMain.handle('writing:pipeline:listResources', async () => {
    return writingPipelineService.listResources();
  });

  ipcMain.handle(
    'writing:pipeline:createCharacterCard',
    async (_event, params: PipelineCreateCharacterParams) => {
      return writingPipelineService.createCharacterCard(params);
    }
  );

  ipcMain.handle(
    'writing:pipeline:init',
    async (_event, params: PipelineInitParams) => {
      return writingPipelineService.init(params);
    }
  );

  ipcMain.handle(
    'writing:pipeline:generateOutline',
    async (_event, projectId: string) => {
      return writingPipelineService.generateOutline(projectId, forwardProgress);
    }
  );

  ipcMain.handle(
    'writing:pipeline:generateChapter',
    async (_event, projectId: string, chapterIndex: number, shardCount?: number) => {
      return writingPipelineService.generateChapter(projectId, chapterIndex, shardCount, forwardProgress);
    }
  );

  ipcMain.handle(
    'writing:pipeline:compose',
    async (_event, projectId: string, format: ExportFormat, chapterIndices?: number[]) => {
      return writingPipelineService.compose(projectId, format, chapterIndices, forwardProgress);
    }
  );

  ipcMain.handle('writing:pipeline:runAll', async (_event, params: PipelineInitParams) => {
    return writingPipelineService.runAll(params, forwardProgress);
  });

  ipcMain.handle('writing:pipeline:status', (_event, projectId: string) => {
    return writingPipelineService.status(projectId);
  });

  ipcMain.handle('writing:pipeline:cancel', (_event, projectId: string) => {
    return writingPipelineService.cancel(projectId);
  });

  // E2E 执行器：仅开发环境可用（打包后拒绝）
  ipcMain.handle('writing:pipeline:runE2E', async (_event, params: PipelineE2EParams) => {
    if (app.isPackaged) {
      return {
        success: false,
        error: 'E2E 执行器仅在开发环境可用',
        code: 'VALIDATION',
      };
    }
    return writingPipelineService.runE2E(params ?? { scale: 'smoke' }, forwardProgress);
  });
}
