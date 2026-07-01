/**
 * 写作模式 - 项目相关 IPC handler
 *
 * 涵盖：项目 CRUD、原始大纲保存、资源加载、版本控制、
 * AI 生成历史、清理全部生成请求等。
 *
 * 注意：本文件内 handler 历史上以「try/catch + 返回 { success: false, error }」
 * 模式向渲染进程返回失败结果，因此保留内部 try/catch 以保持 IPC 响应形态不变，
 * 仅移除冗余的 console.error 调试输出。对于「try/catch + throw」的 handler，
 * 统一通过 utils/wrapHandler 包装。
 */
import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { writingStorageService } from '../../../services/WritingStorageService';
import { writingResourceManager } from '../../../services/WritingResourceManager';
import { addLog } from '../../../services/memory/chatLogService';
import {
  WritingConfig,
  WritingProject,
  ProjectStatus,
  ExportFormat
} from '../../../../shared/types/writing.types';
import { wrapHandler } from '../utils/wrapHandler';

// 模块级共享状态：保留与原 writingHandlers.ts 一致的活动 AbortController 集合
// 由 writingChapterHandlers 维护并被多个 writing 子模块共享
import { activeAbortControllers } from './writingChapterHandlers';

export function registerWritingProjectHandlers(): void {
  // ========== 项目 CRUD ==========

  ipcMain.handle('writing:loadProjects', async () => {
    try {
      const projects = await writingStorageService.loadAllProjects();
      return { success: true, projects };
    } catch (error) {
      return {
        success: false,
        projects: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('writing:createProject', async (_event, config: WritingConfig) => {
    try {
      const projectId = `writing_project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const outlineChapters = config.parameters.chapterCount > 0
        ? Array.from({ length: config.parameters.chapterCount }, (_, i) => ({
            index: i,
            title: `第${i + 1}章`,
            summary: '',
            keyPlotPoints: [],
            characters: [],
            scenes: [],
            targetWordCount: Math.round(config.parameters.targetWordCount / config.parameters.chapterCount)
          }))
        : [];

      const project: WritingProject = {
        id: projectId,
        title: config.parameters.creativeDescription.substring(0, 20) || '新作品',
        status: ProjectStatus.OUTLINING,
        config,
        outline: {
          workInfo: {
            suggestedTitle: config.parameters.creativeDescription.substring(0, 20) || '新作品',
            genre: config.parameters.novelType || '',
            targetWordCount: config.parameters.targetWordCount,
            writingStyle: config.parameters.writingStyle || ''
          } as any, // 已分析但保留：字段与 WorkInfo 接口不匹配（latent bug，修复需改 shared types）
          storyLine: { mainPlot: '', subPlots: [], theme: '' } as any, // 已分析但保留：字段与 StoryLine 接口不匹配
          chapters: outlineChapters,
          characterRelationships: [],
          worldbuildingNotes: []
        },
        outlineRaw: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastSavedAt: Date.now(),
        metadata: {
          totalWordCount: 0,
          completedChapters: 0,
          generationSettings: {
            model: config.modelConfig.model,
            temperature: config.modelConfig.temperature
          },
          continuityInfo: {
            foreshadowing: [],
            plotThreads: [],
            characterDevelopment: {}
          }
        }
      };

      const saved = await writingStorageService.saveProject(project);
      return { success: saved, projectId };
    } catch (error) {
      return {
        success: false,
        projectId: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('writing:saveProject', async (_event, project: WritingProject) => {
    try {
      const saved = await writingStorageService.saveProject(project);
      return { success: saved };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('writing:saveProjectRaw', async (_event, projectId: string, rawContent: string) => {
    try {
      const projectDir = writingStorageService.getProjectDirPath(projectId);
      if (projectDir && rawContent) {
        const rawFile = path.join(projectDir, 'outline_raw.md');
        fs.writeFileSync(rawFile, rawContent, 'utf8');
        return { success: true };
      }
      return { success: false, error: 'Project dir not found' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('writing:deleteProject', async (_event, projectId: string) => {
    try {
      const deleted = await writingStorageService.deleteProject(projectId);
      return { success: deleted };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('writing:exportProject', async (_event, projectId: string, format: ExportFormat) => {
    try {
      const filePath = await writingStorageService.exportProject(projectId, format);
      return { success: true, filePath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // ========== 资源加载 ==========

  ipcMain.handle('writing:loadResources', async (_event, params?: { worldBookIds?: string[]; characterCardIds?: string[]; userPersonaIds?: string[] }) => {
    try {
      const worldBookIds = params?.worldBookIds || [];
      const characterCardIds = params?.characterCardIds || [];
      const userPersonaIds = params?.userPersonaIds || [];

      const worldBooks = await writingResourceManager.loadWorldBooks(worldBookIds);
      const characters = await writingResourceManager.loadCharacterCards(characterCardIds);
      const userPersonas = userPersonaIds.length > 0
        ? await writingResourceManager.loadUserPersonas(userPersonaIds)
        : [];
      const summary = writingResourceManager.buildResourceContextSummary(worldBooks, characters, userPersonas);

      return {
        success: true,
        worldBooks,
        characters,
        userPersonas,
        summary
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '加载资源失败'
      };
    }
  });

  // ========== 版本控制 ==========

  ipcMain.handle('writing:autoSaveChapter', async (_event, { projectId, chapterIndex, content }) => {
    try {
      await writingStorageService.autoSaveChapter(projectId, chapterIndex, content);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('writing:saveVersion', async (_event, { projectId, chapterIndex, content, note }) => {
    try {
      const success = await writingStorageService.saveVersion(projectId, chapterIndex, content, note);
      return { success };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('writing:restoreVersion', async (_event, { projectId, chapterIndex, versionId }) => {
    try {
      const success = await writingStorageService.restoreVersion(projectId, chapterIndex, versionId);
      return { success };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // ========== AI 生成历史 ==========

  ipcMain.handle('writing:saveAIGenerationHistory', async (_event, { projectId, history }) => {
    try {
      const project = await writingStorageService.loadProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };

      project.aiGenerationHistory = project.aiGenerationHistory || [];
      project.aiGenerationHistory.push(history);

      const maxHistory = 20;
      if (project.aiGenerationHistory.length > maxHistory) {
        project.aiGenerationHistory = project.aiGenerationHistory.slice(-maxHistory);
      }

      project.updatedAt = Date.now();
      await writingStorageService.saveProject(project);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('writing:loadAIGenerationHistory', async (_event, { projectId }) => {
    try {
      const project = await writingStorageService.loadProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };

      return {
        success: true,
        history: project.aiGenerationHistory || []
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('writing:clearAIGenerationHistory', async (_event, { projectId }) => {
    try {
      const project = await writingStorageService.loadProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };

      project.aiGenerationHistory = [];
      project.updatedAt = Date.now();
      await writingStorageService.saveProject(project);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // ========== 清理生成请求 ==========

  ipcMain.handle(
    'writing:cleanupAll',
    wrapHandler(async () => {
      const keysToDelete: string[] = [];
      for (const [key, controller] of activeAbortControllers) {
        controller.abort();
        keysToDelete.push(key);
      }
      for (const key of keysToDelete) {
        activeAbortControllers.delete(key);
      }
      addLog(`[Abort] 已清理所有生成请求: ${keysToDelete.length} 个`, 'warn');
      return { success: true, cleanedCount: keysToDelete.length };
    })
  );
}
