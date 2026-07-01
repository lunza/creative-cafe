/**
 * 写作模式 - 大纲相关 IPC handler
 *
 * 涵盖：AI 大纲生成、大纲保存、大纲续写、大纲 CRUD（update/save/load）。
 *
 * 大纲生成与续写均使用 `activeAbortControllers` 中止控制器，
 * 该共享状态由 writingChapterHandlers 维护。
 */
import { ipcMain } from 'electron';
import { writingStorageService } from '../../../services/WritingStorageService';
import { writingResourceManager } from '../../../services/WritingResourceManager';
import { outlineGenerator } from '../../../services/writing/OutlineGenerator';
import { promptBuilder } from '../../../services/writing/PromptBuilder';
import { getStorageService } from '../../../services/storageService';
import { addLog } from '../../../services/memory/chatLogService';
import {
  WritingProject,
  ProjectStatus,
  GeneratedOutline,
  ModelConfig
} from '../../../../shared/types/writing.types';
import { activeAbortControllers } from './writingChapterHandlers';

export function registerWritingOutlineHandlers(): void {
  // ========== AI 大纲生成 ==========

  ipcMain.handle('writing:generateOutline', async (event, request) => {
    try {
      addLog('===== 写作模式: AI大纲生成请求 =====', 'debug');
      addLog(`创意描述: ${request.parameters.creativeDescription}`, 'debug');
      addLog(`小说类型: ${request.parameters.novelType}`, 'debug');
      addLog(`目标字数: ${request.parameters.targetWordCount}`, 'debug');
      addLog(`章节数量: ${request.parameters.chapterCount}`, 'debug');
      addLog(`写作风格: ${request.parameters.writingStyle}`, 'debug');
      addLog(`叙事视角: ${request.parameters.narrativePerspective}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

      if (!request || !request.parameters || !request.modelConfig) {
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

        const worldBooks = await writingResourceManager.loadWorldBooks(resources.worldBookIds || []);
        const characters = await writingResourceManager.loadCharacterCards(resources.characterCardIds || []);
        const userPersonas = await writingResourceManager.loadUserPersonas(userPersonaIds);

        // Load writing styles
        const writingStyleIds = resources.writingStyleIds || [];
        const writingStyles = await writingResourceManager.loadWritingStyles(writingStyleIds);

        const resourceContext = writingResourceManager.buildResourceContextSummary(worldBooks, characters, userPersonas, writingStyles);

        // Build writing style context for prompts
        let writingStyleContext = '';
        if (writingStyles.length > 0) {
          writingStyleContext = promptBuilder.buildWritingStylePrompt(writingStyles);
        }

        outlineGenerator.onStreamChunk((chunk: string) => {
          event.sender.send('writing:stream:chunk', { chunk });
        });

        const result = await outlineGenerator.generate(
          outlineGenerator.buildPrompt({ ...request, resources, _resourceContext: resourceContext, _writingStyleContext: writingStyleContext }),
          request.modelConfig,
          abortController.signal
        );

        activeAbortControllers.delete(outlineKey);

        addLog('===== 写作模式: 大纲生成成功 =====', 'debug');
        addLog(`原始内容长度: ${result.rawContent?.length || 0}`, 'debug');
        addLog('===== 响应结束 =====', 'debug');

        return {
          success: true,
          outline: null,
          outlineRaw: result.rawContent,
          chainOfThought: result.chainOfThought || null
        };
      } catch (error) {
        activeAbortControllers.delete(outlineKey);

        if (error instanceof Error && 'rawContent' in error && error.rawContent) {
          return {
            success: false,
            outline: null,
            outlineRaw: error.rawContent as string,
            chainOfThought: (error as any).chainOfThought || null, // 已分析但保留：访问 Error 上的自定义 chainOfThought 属性
            error: '大纲解析失败，但原始内容已保留'
          };
        }

        throw error;
      }
    } catch (error) {
      addLog('===== 写作模式: 大纲生成错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        outline: null,
        outlineRaw: null,
        error: errorMessage || '大纲生成失败，请稍后重试'
      };
    }
  });

  // ========== 大纲保存 ==========

  ipcMain.handle('writing:saveOutline', async (_event, { rawContent, config }) => {
    try {
      addLog('===== 写作模式: 保存大纲请求 =====', 'debug');
      addLog(`原始内容长度: ${rawContent?.length || 0}`, 'debug');
      addLog(`章节数量: ${config.parameters.chapterCount}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

      if (!rawContent) {
        return { success: false, error: '原始内容为空', outline: null, outlineRaw: null };
      }

      const outline = outlineGenerator.parseOutlineResponse(rawContent);

      const projectId = `writing_project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      if (config.parameters.chapterCount > 0) {
        outline.chapters = Array.from({ length: config.parameters.chapterCount }, (_, i) => ({
          index: i,
          title: outline.chapters[i]?.title || `第${i + 1}章`,
          summary: outline.chapters[i]?.summary || '',
          keyPlotPoints: outline.chapters[i]?.keyPlotPoints || [],
          characters: outline.chapters[i]?.characters || [],
          scenes: outline.chapters[i]?.scenes || [],
          targetWordCount: outline.chapters[i]?.targetWordCount || Math.round(config.parameters.targetWordCount / config.parameters.chapterCount)
        }));
      }

      const project: WritingProject = {
        id: projectId,
        title: outline.workInfo?.suggestedTitle || config.parameters.creativeDescription.substring(0, 20) || '新作品',
        status: ProjectStatus.OUTLINING,
        config,
        outline,
        outlineRaw: rawContent,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastSavedAt: Date.now(),
        metadata: {
          totalWordCount: 0,
          completedChapters: 0,
          generationSettings: {
            model: config.modelConfig?.model || '',
            temperature: config.modelConfig?.temperature ?? 0.7
          },
          continuityInfo: {
            foreshadowing: [],
            plotThreads: [],
            characterDevelopment: {}
          }
        }
      };

      await writingStorageService.saveProject(project);

      addLog('===== 写作模式: 保存大纲成功 =====', 'debug');
      addLog(`项目ID: ${projectId}`, 'debug');
      addLog(`章节数量: ${config.parameters.chapterCount}`, 'debug');
      addLog('===== 响应结束 =====', 'debug');

      return {
        success: true,
        outline,
        outlineRaw: rawContent,
        projectId
      };
    } catch (error) {
      addLog('===== 写作模式: 保存大纲错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        outline: null,
        outlineRaw: rawContent,
        error: errorMessage || '解析失败'
      };
    }
  });

  // ========== 大纲 CRUD ==========

  ipcMain.handle('writing:outline:update', async (_event, { projectId, chapters }) => {
    try {
      if (!projectId || !Array.isArray(chapters)) {
        return { success: false, error: 'Invalid parameters' };
      }

      const project = await writingStorageService.loadProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
      if (!project.outline) return { success: false, error: 'Outline not found' };

      const validatedChapters = chapters.filter(ch => ch && typeof ch.index === 'number').sort((a, b) => a.index - b.index);
      if (validatedChapters.length === 0) {
        return { success: false, error: 'No valid chapters' };
      }

      project.outline.chapters = validatedChapters;

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

  ipcMain.handle('writing:outline:save', async (_event, { projectId, outline: _outline, note: _note }) => {
    try {
      const project = await writingStorageService.loadProject(projectId);
      if (!project) return { success: false, error: 'Project not found' };
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

  // ========== 大纲续写 ==========

  ipcMain.handle('writing:continueOutline', async (_event, request: { outline: GeneratedOutline; chapterCount: number; instructions: string }) => {
    try {
      addLog('===== 写作模式: 大纲续写请求 =====', 'debug');
      addLog(`已有章节数: ${request.outline.chapters.length}`, 'debug');
      addLog(`续写章节数: ${request.chapterCount}`, 'debug');
      addLog(`续写指令: ${request.instructions || '无'}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

      // Note: loadProject result is intentionally unused (preserved from original behavior)
      await writingStorageService.loadProject(request.outline.workInfo?.suggestedTitle || '');

      const storageService = getStorageService();
      const settings = storageService.getSettings();
      const engines = settings?.aiEngines || [];
      // 已分析但保留：settings.aiEngines 类型未声明，TS 无法推断 .find 回调参数；保留 (e: any)
      const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];

      const modelConfig: ModelConfig = {
        model: activeEngine?.model_name || 'gpt-4o',
        temperature: typeof activeEngine?.temperature === 'number' ? activeEngine.temperature : 0.7,
        maxTokens: typeof activeEngine?.max_tokens === 'number' && activeEngine.max_tokens > 0 ? activeEngine.max_tokens : 10240,
      };

      const abortController = new AbortController();

      try {
        const newChapters = await outlineGenerator.generateContinuation(
          request.outline,
          request.chapterCount,
          request.instructions,
          modelConfig,
          abortController.signal,
        );

        addLog('===== 写作模式: 大纲续写成功 =====', 'debug');
        addLog(`新增章节数: ${newChapters.length}`, 'debug');
        addLog('===== 响应结束 =====', 'debug');

        return { success: true, chapters: newChapters };
      } catch (error) {
        addLog('===== 写作模式: 大纲续写错误 =====', 'error');
        addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
        addLog('===== 错误详情结束 =====', 'error');
        return {
          success: false,
          error: error instanceof Error ? error.message : '大纲续写失败',
        };
      }
    } catch (error) {
      addLog('===== 写作模式: 大纲续写外部错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      return {
        success: false,
        error: error instanceof Error ? error.message : '大纲续写失败',
      };
    }
  });
}
