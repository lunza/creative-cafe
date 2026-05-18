import { ipcMain } from 'electron';
import { writingStorageService } from '../../services/WritingStorageService';
import { writingResourceManager } from '../../services/WritingResourceManager';
import { outlineGenerator } from '../../services/writing/OutlineGenerator';
import { contentGenerator } from '../../services/writing/ContentGenerator';
import {
  WritingConfig,
  WritingProject,
  ProjectStatus,
  ChapterStatus,
  ProjectMetadata,
  GenerationMetadata,
  WritingErrorCode,
  ExportFormat
} from '../../../shared/types/writing.types';

const activeAbortControllers = new Map<string, AbortController>();

export function registerWritingHandlers(): void {
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
      const chapters = config.parameters.chapterCount > 0
        ? Array.from({ length: config.parameters.chapterCount }, (_, i) => ({
            index: i,
            title: `第${i + 1}章`,
            outline: {
              summary: '',
              keyPlotPoints: [],
              characters: [],
              scenes: [],
              targetWordCount: Math.round(config.parameters.targetWordCount / config.parameters.chapterCount)
            },
            content: '',
            status: ChapterStatus.PENDING,
            wordCount: 0,
            versions: [],
            lastModified: Date.now()
          }))
        : [];

      const project: WritingProject = {
        id: projectId,
        title: config.parameters.creativeDescription.substring(0, 20) || '新作品',
        status: ProjectStatus.OUTLINING,
        config,
        outline: null,
        outlineHistory: [],
        chapters,
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

  ipcMain.handle('writing:generateOutline', async (_event, request) => {
    try {
      const abortController = new AbortController();
      const requestId = `outline_${Date.now()}`;
      activeAbortControllers.set(requestId, abortController);

      try {
        const outline = await outlineGenerator.generate(
          outlineGenerator.buildPrompt(request),
          request.modelConfig
        );

        activeAbortControllers.delete(requestId);
        return { success: true, outline };
      } catch (error) {
        activeAbortControllers.delete(requestId);
        throw error;
      }
    } catch (error) {
      return {
        success: false,
        outline: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('writing:generateChapter', async (event, request) => {
    try {
      const abortController = new AbortController();
      const { projectId, chapterIndex } = request;
      activeAbortControllers.set(`${projectId}_${chapterIndex}`, abortController);

      const onStream = (chunk: string) => {
        event.sender.send('writing:stream:chunk', {
          projectId,
          chapterIndex,
          chunk
        });
      };

      try {
        const result = await contentGenerator.generateStream(
          request,
          request.modelConfig,
          onStream,
          abortController.signal
        );

        event.sender.send('writing:stream:complete', {
          projectId,
          chapterIndex,
          content: result.content,
          metadata: result.metadata
        });

        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorObj = {
          code: WritingErrorCode.CONTENT_GENERATION_FAILED,
          message: errorMessage,
          recoverable: true
        };

        event.sender.send('writing:stream:error', {
          projectId: request.projectId,
          chapterIndex: request.chapterIndex,
          error: errorObj
        });

        return { success: false, error: errorMessage };
      } finally {
        activeAbortControllers.delete(`${projectId}_${chapterIndex}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('writing:cancelGeneration', async (_event, projectId: string) => {
    const keysToDelete: string[] = [];
    for (const [key, controller] of activeAbortControllers) {
      if (key.startsWith(projectId)) {
        controller.abort();
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      activeAbortControllers.delete(key);
    }
    return { success: true };
  });

  ipcMain.handle('writing:loadResources', async (_event, { worldBookIds, characterCardIds }) => {
    try {
      const worldBooks = await writingResourceManager.loadWorldBooks(worldBookIds);
      const characters = await writingResourceManager.loadCharacterCards(characterCardIds);
      const summary = writingResourceManager.buildResourceContextSummary(worldBooks, characters);

      return {
        success: true,
        worldBooks,
        characters,
        summary
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

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

  console.log('[Writing] Writing handlers registered');
}
