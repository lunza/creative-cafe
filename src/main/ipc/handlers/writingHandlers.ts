import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { writingStorageService } from '../../services/WritingStorageService';
import { writingResourceManager } from '../../services/WritingResourceManager';
import { outlineGenerator } from '../../services/writing/OutlineGenerator';
import { contentGenerator } from '../../services/writing/ContentGenerator';
import { logRequest, logResponse, logErrorWithContext, logInfo } from '../../services/AiLogger';
import {
  WritingConfig,
  WritingProject,
  ProjectStatus,
  ChapterStatus,
  ProjectMetadata,
  GenerationMetadata,
  WritingErrorCode,
  ExportFormat,
  GeneratedOutline,
  ChapterOutline
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
        outlineRaw: null,
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

  ipcMain.handle('writing:saveProjectRaw', async (_event, projectId: string, rawContent: string) => {
    try {
      const projectDir = writingStorageService.getProjectDirPath(projectId);
      if (projectDir && rawContent) {
        const rawFile = path.join(projectDir, 'outline_raw.md');
        fs.writeFileSync(rawFile, rawContent, 'utf8');
        console.log('[Writing] Saved raw outline content for project:', projectId, 'length:', rawContent.length);
        return { success: true };
      }
      return { success: false, error: 'Project dir not found' };
    } catch (error) {
      console.error('[Writing] Failed to save raw outline:', error);
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

  ipcMain.handle('writing:generateOutline', async (event, request) => {
    try {
      logRequest('writing:generateOutline', {
        parameters: {
          creativeDescription: request.parameters.creativeDescription,
          novelType: request.parameters.novelType,
          targetWordCount: request.parameters.targetWordCount,
          chapterCount: request.parameters.chapterCount,
          writingStyle: request.parameters.writingStyle,
          narrativePerspective: request.parameters.narrativePerspective,
          includeEnding: request.parameters.includeEnding,
          chapterRangeStart: request.parameters.chapterRangeStart,
          chapterRangeEnd: request.parameters.chapterRangeEnd
        },
        modelConfig: request.modelConfig,
        resources: request.resources
      });

      if (!request || !request.parameters || !request.modelConfig) {
        console.error('[Writing] Invalid request format:', JSON.stringify(request, null, 2));
        return {
          success: false,
          outline: null,
          outlineRaw: null,
          error: '请求参数格式不正确'
        };
      }

      const abortController = new AbortController();
      const outlineKey = 'outline_generate';
      activeAbortControllers.set(outlineKey, abortController);

      try {
        const resources = request.resources || { worldBookIds: [], characterCardIds: [] };
        const userPersonaIds = resources.userPersonaIds || [];
        console.log('[Writing] Generating outline with resources:', {
          worldBooks: resources.worldBookIds?.length || 0,
          characters: resources.characterCardIds?.length || 0,
          personas: userPersonaIds.length
        });

        const worldBooks = await writingResourceManager.loadWorldBooks(resources.worldBookIds || []);
        const characters = await writingResourceManager.loadCharacterCards(resources.characterCardIds || []);
        const userPersonas = await writingResourceManager.loadUserPersonas(userPersonaIds);

        console.log('[Writing] Loaded resources:', {
          worldBooks: worldBooks.length,
          characters: characters.length,
          personas: userPersonas.length
        });

        const resourceContext = writingResourceManager.buildResourceContextSummary(worldBooks, characters, userPersonas);
        console.log('[Writing] Resource context (length):', resourceContext.length);

        outlineGenerator.onStreamChunk((chunk: string) => {
          event.sender.send('writing:stream:chunk', { chunk });
        });

        const result = await outlineGenerator.generate(
          outlineGenerator.buildPrompt({ ...request, resources, _resourceContext: resourceContext }),
          request.modelConfig,
          abortController.signal
        );

        activeAbortControllers.delete(outlineKey);

        logResponse('writing:generateOutline', 'success', {
          rawContentLength: result.rawContent?.length || 0,
          success: true
        });

        return {
          success: true,
          outline: null,
          outlineRaw: result.rawContent
        };
      } catch (error) {
        activeAbortControllers.delete(outlineKey);
        console.error('[Writing] Outline generation error:', error);

        if (error instanceof Error && 'rawContent' in error && error.rawContent) {
          return {
            success: false,
            outline: null,
            outlineRaw: error.rawContent as string,
            error: '大纲解析失败，但原始内容已保留'
          };
        }

        throw error;
      }
    } catch (error) {
      logErrorWithContext('writing:generateOutline', error, { parameters: request?.parameters });
      console.error('[Writing] Outline generation failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        outline: null,
        outlineRaw: null,
        error: errorMessage || '大纲生成失败，请稍后重试'
      };
    }
  });

  ipcMain.handle('writing:saveOutline', async (_event, { rawContent, config }) => {
    try {
      logRequest('writing:saveOutline', {
        rawContentLength: rawContent?.length || 0,
        config: {
          parameters: {
            creativeDescription: config.parameters.creativeDescription,
            chapterCount: config.parameters.chapterCount
          }
        }
      });

      if (!rawContent) {
        return { success: false, error: '原始内容为空', outline: null, outlineRaw: null };
      }

      const outline = outlineGenerator.parseOutlineResponse(rawContent);

      const projectId = `writing_project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const chapters = config.parameters.chapterCount > 0
        ? Array.from({ length: config.parameters.chapterCount }, (_, i) => ({
            index: i,
            title: outline.chapters[i]?.title || `第${i + 1}章`,
            outline: {
              summary: outline.chapters[i]?.summary || '',
              keyPlotPoints: outline.chapters[i]?.keyPlotPoints || [],
              characters: outline.chapters[i]?.characters || [],
              scenes: outline.chapters[i]?.scenes || [],
              targetWordCount: outline.chapters[i]?.targetWordCount || Math.round(config.parameters.targetWordCount / config.parameters.chapterCount)
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
        title: outline.workInfo?.suggestedTitle || config.parameters.creativeDescription.substring(0, 20) || '新作品',
        status: ProjectStatus.OUTLINING,
        config,
        outline,
        outlineRaw: rawContent,
        outlineHistory: [],
        chapters,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastSavedAt: Date.now(),
        metadata: {
          totalWordCount: 0,
          completedChapters: 0,
          generationSettings: {
            model: config.modelConfig?.model || '',
            temperature: config.modelConfig?.temperature || 0.7
          },
          continuityInfo: {
            foreshadowing: [],
            plotThreads: [],
            characterDevelopment: {}
          }
        }
      };

      await writingStorageService.saveProject(project);

      logResponse('writing:saveOutline', 'success', {
        projectId,
        chaptersCount: config.parameters.chapterCount
      });

      return {
        success: true,
        outline,
        outlineRaw: rawContent,
        projectId
      };
    } catch (error) {
      logErrorWithContext('writing:saveOutline', error, { rawContentLength: rawContent?.length || 0 });
      console.error('[Writing] Save outline failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        outline: null,
        outlineRaw: rawContent,
        error: errorMessage || '解析失败'
      };
    }
  });

  ipcMain.handle('writing:generateChapter', async (event, request) => {
    try {
      logRequest('writing:generateChapter', {
        chapterIndex: request.chapterIndex,
        chapterInfo: request.chapterInfo,
        modelConfig: request.modelConfig,
        generationParams: request.generationParams,
        previousChaptersCount: request.previousChapters?.length || 0
      });

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

        logResponse('writing:generateChapter', 'success', {
          chapterIndex: request.chapterIndex,
          contentLength: result.content?.length || 0,
          generationTime: result.metadata?.generationTime || 0
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

        logErrorWithContext('writing:generateChapter', error, { chapterIndex: request?.chapterIndex });

        return { success: false, error: errorMessage };
      } finally {
        activeAbortControllers.delete(`${projectId}_${chapterIndex}`);
      }
    } catch (error) {
      logErrorWithContext('writing:generateChapter', error, { chapterIndex: request?.chapterIndex });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle('writing:cancelGeneration', async (_event, projectId: string) => {
    const keysToDelete: string[] = [];
    for (const [key, controller] of activeAbortControllers) {
      if (key === 'outline_generate' || key.startsWith(projectId)) {
        controller.abort();
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      activeAbortControllers.delete(key);
    }
    return { success: true };
  });

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

  ipcMain.handle('writing:outline:update', async (_event, { projectId, chapters }) => {
    try {
      const project = await writingStorageService.loadProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      project.outline = { ...project.outline, chapters } as GeneratedOutline;
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

  ipcMain.handle('writing:outline:save', async (_event, { projectId, outline, note }) => {
    try {
      const project = await writingStorageService.loadProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      project.outlineHistory = project.outlineHistory || [];
      project.outlineHistory.push({
        outline,
        timestamp: Date.now(),
        note
      });
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

  ipcMain.handle('writing:outline:load', async (_event, { projectId }) => {
    try {
      const project = await writingStorageService.loadProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      return { success: true, outline: project.outline, outlineRaw: project.outlineRaw };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  console.log('[Writing] Writing handlers registered');
}
