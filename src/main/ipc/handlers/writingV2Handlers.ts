/**
 * 写作模式 2.0（V2）专用 IPC handler
 *
 * Spec: refactor-writing-mode-v2 / Phase 1
 *
 * V1 的 writing:* 通道全部复用（零改动），本文件仅提供 V2 独有的两个能力：
 *   - writingV2:parseOutline          解析大纲原始文本（不创建项目，V1 的
 *                                     writing:saveOutline 会新建项目，不适用于
 *                                     V2 "先建项目后生成大纲" 的流程）
 *   - writingV2:exportWithChapters    按章节选择导出（V1 的 exportProject 只能全量导出，
 *                                     且 preload 已声明的 writing:exportProjectWithChapters
 *                                     通道在主进程从未实现）
 */
import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { writingStorageService, getWritingProjectsPath } from '../../services/WritingStorageService';
import { outlineGenerator } from '../../services/writing/OutlineGenerator';
import { addLog } from '../../services/memory/chatLogService';
import { ExportFormat } from '../../../shared/types/writing.types';
import type { GeneratedOutline } from '../../../shared/types/writing.types';
import { buildExportContent } from '../../../shared/utils/v2ExportContent';

interface V2ParseOutlineResponse {
  success: boolean;
  outline?: GeneratedOutline | null;
  error?: string;
}

interface V2ExportResponse {
  success: boolean;
  filePath?: string;
  error?: string;
}

export function registerWritingV2Handlers(): void {
  // ========== 大纲原始文本解析（不创建项目） ==========
  ipcMain.handle('writingV2:parseOutline', async (_event, rawContent: string): Promise<V2ParseOutlineResponse> => {
    try {
      if (!rawContent || !rawContent.trim()) {
        return { success: false, outline: null, error: '原始内容为空' };
      }
      const outline = outlineGenerator.parseOutlineResponse(rawContent);
      return { success: true, outline };
    } catch (error) {
      const message = error instanceof Error ? error.message : '大纲解析失败';
      addLog(`[WritingV2] 大纲解析失败: ${message}`, 'error');
      return { success: false, outline: null, error: message };
    }
  });

  // ========== 按章节选择导出 ==========
  ipcMain.handle(
    'writingV2:exportWithChapters',
    async (_event, projectId: string, format: ExportFormat, chapterIndices: number[]): Promise<V2ExportResponse> => {
      try {
        const project = await writingStorageService.loadProject(projectId);
        if (!project) {
          return { success: false, error: '项目不存在' };
        }
        const allChapters = project.outline?.chapters ?? [];
        // chapterIndices 为空数组 = 导出全部章节
        const selected = chapterIndices && chapterIndices.length > 0
          ? allChapters.filter((c) => chapterIndices.includes(c.index))
          : allChapters;
        if (selected.length === 0) {
          return { success: false, error: '没有可导出的章节内容' };
        }

        const exportDir = path.join(getWritingProjectsPath(), 'exports');
        if (!fs.existsSync(exportDir)) {
          fs.mkdirSync(exportDir, { recursive: true });
        }

        const ext =
          format === ExportFormat.MARKDOWN ? 'md' : format === ExportFormat.JSON ? 'json' : 'txt';
        const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        const fileName = `${project.title || 'untitled'}-${stamp}.${ext}`;
        const exportPath = path.join(exportDir, fileName);

        const content = buildExportContent(project, selected, format);
        fs.writeFileSync(exportPath, content, 'utf8');

        addLog(`[WritingV2] 导出成功: ${exportPath}（${selected.length} 章）`, 'info');
        return { success: true, filePath: exportPath };
      } catch (error) {
        const message = error instanceof Error ? error.message : '导出失败';
        addLog(`[WritingV2] 导出失败: ${message}`, 'error');
        return { success: false, error: message };
      }
    }
  );
}
