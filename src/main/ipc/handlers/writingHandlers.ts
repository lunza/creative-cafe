import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { writingStorageService } from '../../services/WritingStorageService';
import { writingResourceManager } from '../../services/WritingResourceManager';
import { writingStyleLearningService } from '../../services/WritingStyleLearningService';
import { outlineGenerator } from '../../services/writing/OutlineGenerator';
import { contentGenerator } from '../../services/writing/ContentGenerator';
import { promptBuilder } from '../../services/writing/PromptBuilder';
import { aiAssistedChapterService } from '../../services/writing/AIAssistedChapterService';
import { plotCheckerService, PlotCheckRequestData } from '../../services/writing/PlotCheckerService';
import { logicCheckRecorder } from '../../services/writing/LogicCheckRecorder';
import { addLog } from '../../services/memory/chatLogService';
import { worldBookService } from '../../services/worldBookService';
import { getStorageService } from '../../services/storageService';
import { tableTemplateService } from '../../services/memory/tableTemplateService';
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
  ChapterOutline,
  WritingStyleResource,
  WritingStyleLearningRequest,
  PlotCheckRequest,
  PlotCheckReport,
  PlotCheckIssue,
  LogicCheckIssue,
  ModelConfig,
  BatchFixRequest,
  BatchFixResult
} from '../../../shared/types/writing.types';

const activeAbortControllers = new Map<string, AbortController>();

export function registerWritingHandlers(): void {
  ipcMain.handle('writing:loadProjects', async () => {
    try {
      console.log('[Writing] writing:loadProjects - Starting load...');
      const projects = await writingStorageService.loadAllProjects();
      console.log('[Writing] writing:loadProjects - Loaded', projects.length, 'projects');
      if (projects.length > 0) {
        const firstProject = projects[0];
        console.log('[Writing] writing:loadProjects - First project check:', {
          projectId: firstProject.id,
          chapterCount: firstProject.outline?.chapters?.length || 0,
          chapter0ContentLength: firstProject.outline?.chapters?.[0]?.content?.length || 0,
          chapter0ContentPreview: firstProject.outline?.chapters?.[0]?.content?.substring(0, 50) || 'empty'
        });
      }
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
          },
          storyLine: { mainPlot: '', subPlots: [], theme: '' },
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
      console.error('[Writing] IPC writing:saveProject error:', error);
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
      addLog('===== 写作模式: AI大纲生成请求 =====', 'debug');
      addLog(`创意描述: ${request.parameters.creativeDescription}`, 'debug');
      addLog(`小说类型: ${request.parameters.novelType}`, 'debug');
      addLog(`目标字数: ${request.parameters.targetWordCount}`, 'debug');
      addLog(`章节数量: ${request.parameters.chapterCount}`, 'debug');
      addLog(`写作风格: ${request.parameters.writingStyle}`, 'debug');
      addLog(`叙事视角: ${request.parameters.narrativePerspective}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

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

        // Load writing styles
        const writingStyleIds = resources.writingStyleIds || [];
        const writingStyles = await writingResourceManager.loadWritingStyles(writingStyleIds);

        console.log('[Writing] Loaded resources:', {
          worldBooks: worldBooks.length,
          characters: characters.length,
          personas: userPersonas.length,
          writingStyles: writingStyles.length
        });

        const resourceContext = writingResourceManager.buildResourceContextSummary(worldBooks, characters, userPersonas, writingStyles);
        console.log('[Writing] Resource context (length):', resourceContext.length);

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
      addLog('===== 写作模式: 大纲生成错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
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
      // 立即记录请求入参日志（在AI调用前持久化）
      addLog('===== 写作模式: 章节生成请求 =====', 'debug');
      addLog(`章节索引: ${request.chapterIndex}`, 'debug');
      addLog(`章节信息: ${JSON.stringify(request.chapterInfo)}`, 'debug');
      addLog(`模型配置: ${JSON.stringify(request.modelConfig)}`, 'debug');
      addLog(`前序章节数量: ${request.previousChapters?.length || 0}`, 'debug');
      addLog(`素材资源: worldBook=${request.resources?.worldBookIds?.length || 0}, character=${request.resources?.characterCardIds?.length || 0}, persona=${request.resources?.userPersonaIds?.length || 0}, knowledge=${request.resources?.knowledgeItemIds?.length || 0}`, 'debug');

      // Load all resource materials
      const resources = request.resources || {};
      const worldBookIds = resources.worldBookIds || [];
      const characterCardIds = resources.characterCardIds || [];
      const userPersonaIds = resources.userPersonaIds || [];
      const knowledgeItemIds = resources.knowledgeItemIds || [];
      const writingStyleIds = resources.writingStyleIds || [];

      if (worldBookIds.length > 0 || characterCardIds.length > 0 || userPersonaIds.length > 0 || knowledgeItemIds.length > 0) {
        addLog(`[Resources] 开始加载素材资源...`, 'debug');
      }

      const worldBooks = worldBookIds.length > 0
        ? await writingResourceManager.loadWorldBooks(worldBookIds)
        : [];
      const characters = characterCardIds.length > 0
        ? await writingResourceManager.loadCharacterCards(characterCardIds)
        : [];
      const userPersonas = userPersonaIds.length > 0
        ? await writingResourceManager.loadUserPersonas(userPersonaIds)
        : [];

      if (worldBooks.length > 0) {
        addLog(`[Resources] 加载世界书: ${worldBooks.length}个`, 'debug');
        
        // 基于章节大纲内容进行向量检索，获取相关世界书条目
        const chapterOutline = request.chapterInfo?.outline || request.chapterInfo?.title || '';
        const worldBookEntries: { entryName: string; content: string; keywords: string[]; relevance: number }[] = [];
        
        for (const wb of worldBooks) {
          try {
            const searchResults = await worldBookService.searchWorldBookEntriesByVector(
              wb.id,
              chapterOutline,
              5
            );
            
            if (searchResults.length > 0) {
              addLog(`[WorldBook] 世界书"${wb.name}" 检索到 ${searchResults.length} 个相关条目`, 'debug');
              
              for (const result of searchResults) {
                const meta = result.metadata as any;
                
                // 向量存储中的字段名: entryName, entryContent, entryKeys
                const entryName = meta.entryName || meta.name || wb.name;
                const entryContent = meta.entryContent || meta.content || meta.value || meta.text || '';
                const entryKeywords = meta.entryKeys || meta.entryKey || meta.keywords || [];
                
                addLog(`[WorldBook] 条目"${entryName}" 内容长度: ${entryContent.length}, 关键词数: ${entryKeywords.length}`, 'debug');
                
                // 跳过无内容的条目
                if (!entryContent || !entryContent.trim()) {
                  addLog(`[WorldBook] 跳过无内容的条目: ${entryName}`, 'debug');
                  continue;
                }
                
                worldBookEntries.push({
                  entryName,
                  content: entryContent,
                  keywords: Array.isArray(entryKeywords) ? entryKeywords : (entryKeywords ? [entryKeywords] : []),
                  relevance: result.score
                });
              }
            } else {
              addLog(`[WorldBook] 世界书"${wb.name}" 未检索到相关条目，回退使用原始数据`, 'warn');
              // 回退：使用原始数据中的 entries
              if (wb.entries && wb.entries.length > 0) {
                for (const entry of wb.entries) {
                  if (entry.content && entry.content.trim()) {
                    worldBookEntries.push({
                      entryName: entry.name || '未命名',
                      content: entry.content,
                      keywords: entry.keywords || [],
                      relevance: 0.5
                    });
                  }
                }
              }
            }
          } catch (error) {
            addLog(`[WorldBook] 世界书"${wb.name}" 向量检索失败: ${error instanceof Error ? error.message : String(error)}，回退使用原始数据`, 'warn');
            // 回退：使用原始数据
            if (wb.entries && wb.entries.length > 0) {
              for (const entry of wb.entries) {
                if (entry.content && entry.content.trim()) {
                  worldBookEntries.push({
                    entryName: entry.name || '未命名',
                    content: entry.content,
                    keywords: entry.keywords || [],
                    relevance: 0.5
                  });
                }
              }
            }
          }
        }
        
        if (worldBookEntries.length > 0) {
          addLog(`[Resources] 世界书条目提取完成: 共 ${worldBookEntries.length} 个条目`, 'debug');
        }
        request.worldBookContext = worldBookEntries;
      }

      if (characters.length > 0) {
        addLog(`[Resources] 加载角色卡: ${characters.length}个`, 'debug');
        request.characterContext = characters.map(char => ({
          name: char.name || '未知',
          description: char.description || '',
          personality: char.personality || char.traits?.join('、') || '',
          mesExample: (char as any).mesExample || ''
        }));
      }

      if (userPersonas.length > 0) {
        addLog(`[Resources] 加载用户人设: ${userPersonas.length}个`, 'debug');
        (request as any).userPersonaContext = userPersonas.map(p => ({
          name: p.name || '未知',
          description: p.description || '',
          traits: p.traits || []
        }));
      }

      // Load writing styles
      if (writingStyleIds.length > 0) {
        const writingStyles = await writingResourceManager.loadWritingStyles(writingStyleIds);
        if (writingStyles.length > 0) {
          addLog(`[Resources] 加载写作风格: ${writingStyles.length}个`, 'debug');
          request.generationParams.writingStyleContext = promptBuilder.buildWritingStylePrompt(writingStyles);
        }
      }

      const resourceSummary = writingResourceManager.buildResourceContextSummary(
        worldBooks, characters, userPersonas, []
      );
      if (resourceSummary) {
        addLog(`[Resources] 素材上下文摘要(长度): ${resourceSummary.length}`, 'debug');
      }

      // Load writing table data for chapter generation context
      const projectId = request.projectId;
      if (projectId) {
        const tableData = await writingStorageService.getTableData(projectId);
        const tableConfig = await writingStorageService.getTableConfig(projectId);
        if (tableData && tableConfig) {
          addLog(`[WritingTable] 加载表格数据: ${tableData.sheets?.length || 0}个表`, 'debug');
          request.writingTableData = {
            tableConfig: {
              associatedTemplateId: tableConfig.associatedTemplateId,
              associatedTemplateName: tableConfig.associatedTemplateName
            },
            sheets: tableData.sheets,
            headers: tableData.headers,
            data: tableData.data,
            sheetDescriptions: tableData.sheetDescriptions
          };
        }
      }

      addLog('===== 请求入参结束 =====', 'debug');

      const abortController = new AbortController();
      const { chapterIndex } = request;
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

        addLog('===== 写作模式: 章节生成成功 =====', 'debug');
        addLog(`章节索引: ${request.chapterIndex}`, 'debug');
        addLog(`内容长度: ${result.content?.length || 0}`, 'debug');
        addLog(`生成耗时: ${result.metadata?.generationTime || 0}ms`, 'debug');
        addLog('===== 响应结束 =====', 'debug');

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

        addLog('===== 写作模式: 章节生成错误 =====', 'error');
        addLog(`章节索引: ${request?.chapterIndex}`, 'error');
        addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
        addLog('===== 错误详情结束 =====', 'error');

        return { success: false, error: errorMessage };
      } finally {
        activeAbortControllers.delete(`${projectId}_${chapterIndex}`);
      }
    } catch (error) {
      addLog('===== 写作模式: 章节生成外部错误 =====', 'error');
      addLog(`章节索引: ${request?.chapterIndex}`, 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
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

  ipcMain.handle('writing:outline:save', async (_event, { projectId, outline, note }) => {
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

  ipcMain.handle('writing:aiSuggestSplit', async (_event, request) => {
    try {
      addLog('===== 写作模式: AI拆分建议请求 =====', 'debug');
      addLog(`章节标题: ${request.chapterTitle}`, 'debug');
      addLog(`拆分数量: ${request.splitCount}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

      const result = await aiAssistedChapterService.suggestSplit(request);

      addLog('===== 写作模式: AI拆分建议成功 =====', 'debug');
      addLog(`拆分数量: ${result.splitCount}`, 'debug');
      addLog(`信心度: ${result.confidence}`, 'debug');
      addLog('===== 响应结束 =====', 'debug');

      return { success: true, data: result };
    } catch (error) {
      addLog('===== 写作模式: AI拆分建议错误 =====', 'error');
      addLog(`章节标题: ${request?.chapterTitle}`, 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'AI拆分建议生成失败'
      };
    }
  });

  ipcMain.handle('writing:aiSuggestMerge', async (_event, request) => {
    try {
      addLog('===== 写作模式: AI合并建议请求 =====', 'debug');
      addLog(`章节数量: ${request.chapters?.length || 0}`, 'debug');
      addLog(`章节索引: ${JSON.stringify(request.chapters?.map((ch: any) => ch.index) || [])}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

      const result = await aiAssistedChapterService.suggestMerge(request);

      addLog('===== 写作模式: AI合并建议成功 =====', 'debug');
      addLog(`合并标题: ${result.mergedTitle}`, 'debug');
      addLog(`信心度: ${result.confidence}`, 'debug');
      addLog('===== 响应结束 =====', 'debug');

      return { success: true, data: result };
    } catch (error) {
      addLog('===== 写作模式: AI合并建议错误 =====', 'error');
      addLog(`章节数量: ${request?.chapters?.length || 0}`, 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'AI合并建议生成失败'
      };
    }
  });

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

  ipcMain.handle('writing:checkChapter', async (_event, request: { projectId: string; chapterIndex: number; content: string; previousChapters?: { index: number; title: string; content: string }[] }) => {
    try {
      addLog('===== 写作模式: 剧情检查请求 =====', 'debug');
      addLog(`章节索引: ${request.chapterIndex}`, 'debug');
      addLog(`内容长度: ${request.content?.length || 0}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

      const project = await writingStorageService.loadProject(request.projectId);
      if (!project) {
        return { success: false, error: '项目不存在', report: null };
      }

      // Read model config from active AI engine settings (same logic as PlotCheckerService.getConfig)
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      const engines = settings?.aiEngines || [];
      const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];

      const modelConfig: ModelConfig = {
        model: activeEngine?.model_name ?? project.config?.modelConfig?.model ?? (() => { throw new Error('未配置 AI 模型名称') })(),
        temperature: (typeof activeEngine?.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : (project.config?.modelConfig?.temperature ?? 0.7),
        maxTokens: (typeof activeEngine?.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : (project.config?.modelConfig?.maxTokens ?? 10240)
      };

      addLog(`模型配置: ${JSON.stringify(modelConfig)}`, 'debug');

      if (!modelConfig.model) {
        return { success: false, error: '未配置 AI 模型，请在设置中配置 AI 引擎', report: null };
      }

      const tableData = await writingStorageService.getTableData(request.projectId);
      const tableConfig = await writingStorageService.getTableConfig(request.projectId);

      const checkRequest: PlotCheckRequestData = {
        projectId: request.projectId,
        chapterIndex: request.chapterIndex,
        content: request.content,
        outline: project.outline,
        resources: project.config?.resources || { worldBookIds: [], characterCardIds: [] },
        novelType: project.config?.parameters?.novelType,
        writingStyle: project.config?.parameters?.writingStyle,
        modelConfig,
        previousChapters: request.previousChapters || [],
        writingTableData: tableData && tableConfig ? {
          tableConfig: {
            associatedTemplateId: tableConfig.associatedTemplateId,
            associatedTemplateName: tableConfig.associatedTemplateName
          },
          sheets: tableData.sheets,
          headers: tableData.headers,
          data: tableData.data,
          sheetDescriptions: tableData.sheetDescriptions
        } : undefined
      };

      const report = await plotCheckerService.checkChapter(checkRequest);

      // 记录逻辑异常到记忆表格
      if (report.logicCheckResult && report.logicCheckResult.issues.length > 0) {
        const chapterTitle = project.outline?.chapters?.find(ch => ch.index === request.chapterIndex)?.title;
        await logicCheckRecorder.recordIssues(
          report.logicCheckResult.issues,
          request.projectId,
          request.chapterIndex,
          chapterTitle
        );
      }

      addLog('===== 写作模式: 剧情检查完成 =====', 'debug');
      addLog(`综合评分: ${report.overallScore}`, 'debug');
      addLog(`问题总数: ${report.totalIssues}`, 'debug');
      addLog('===== 响应结束 =====', 'debug');

      return { success: true, report, error: null };
    } catch (error) {
      addLog('===== 写作模式: 剧情检查错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      return {
        success: false,
        report: null,
        error: error instanceof Error ? error.message : '剧情检查失败'
      };
    }
  });

  ipcMain.handle('writing:autoFixIssue', async (_event, request: { projectId: string; chapterIndex: number; content: string; issue: PlotCheckIssue; issueType?: 'dimension' | 'logic'; modelConfig?: ModelConfig }) => {
    try {
      addLog('===== 写作模式: 自动修正请求 =====', 'debug');
      addLog(`章节索引: ${request.chapterIndex}`, 'debug');
      addLog(`问题标题: ${request.issue?.title || request.issue?.description}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

      // Read model config from active AI engine settings
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      const engines = settings?.aiEngines || [];
      const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];

      const modelConfig: ModelConfig = {
        model: activeEngine?.model_name ?? request.modelConfig?.model ?? (() => { throw new Error('未配置 AI 模型名称') })(),
        temperature: (typeof activeEngine?.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : (request.modelConfig?.temperature ?? 0.7),
        maxTokens: (typeof activeEngine?.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : (request.modelConfig?.maxTokens ?? 10240)
      };

      addLog(`【自动修正】模型配置: ${JSON.stringify(modelConfig)}`, 'debug');

      const result = await plotCheckerService.autoFixIssue(
        request.projectId,
        request.chapterIndex,
        request.content,
        request.issue,
        request.issueType || 'dimension',
        modelConfig
      );

      addLog('===== 写作模式: 自动修正完成 =====', 'debug');
      addLog(`修正成功: ${result.success}`, 'debug');
      addLog('===== 响应结束 =====', 'debug');

      return {
        success: result.success,
        fixedContent: result.fixedContent,
        diffs: result.diffs || [],
        error: result.error || null
      };
    } catch (error) {
      addLog('===== 写作模式: 自动修正错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      return {
        success: false,
        fixedContent: request.content,
        diffs: [],
        error: error instanceof Error ? error.message : '自动修正失败'
      };
    }
  });

  ipcMain.handle('writing:batchFixIssues', async (_event, req: BatchFixRequest): Promise<BatchFixResult> => {
    try {
      addLog('===== 写作模式: 批量修正请求 =====', 'debug');
      addLog(`章节索引: ${req.chapterIndex}`, 'debug');
      addLog(`问题数量: ${req.issues?.length || 0}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

      const project = await writingStorageService.loadProject(req.projectId);
      if (!project) {
        throw new Error('项目不存在');
      }

      // Read model config from active AI engine settings
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      const engines = settings?.aiEngines || [];
      const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];

      const modelConfig: ModelConfig = {
        model: activeEngine?.model_name ?? req.modelConfig?.model ?? (() => { throw new Error('未配置 AI 模型名称') })(),
        temperature: (typeof activeEngine?.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : (req.modelConfig?.temperature ?? 0.7),
        maxTokens: (typeof activeEngine?.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : (req.modelConfig?.maxTokens ?? 10240)
      };

      addLog(`【批量修正】模型配置: ${JSON.stringify(modelConfig)}`, 'debug');

      const result = await plotCheckerService.batchFixIssues(
        req.projectId,
        req.chapterIndex,
        req.content,
        req.issues,
        modelConfig
      );

      addLog('===== 写作模式: 批量修正完成 =====', 'debug');
      addLog(`修正成功: ${result.success}`, 'debug');
      addLog('===== 响应结束 =====', 'debug');

      return result;
    } catch (error) {
      addLog('===== 写作模式: 批量修正错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      return {
        success: false,
        fixedContent: req.content,
        results: req.issues.map((_, i) => ({ index: i, success: false, error: error instanceof Error ? error.message : 'Unknown error' })),
        error: error instanceof Error ? error.message : '批量修正失败'
      };
    }
  });

  ipcMain.handle('writing:getLogicCheckRecords', async () => {
    try {
      const result = logicCheckRecorder.getRecords();
      return result;
    } catch (error) {
      return { success: false, records: [], error: error instanceof Error ? error.message : '获取记录失败' };
    }
  });

  ipcMain.handle('writing:clearLogicCheckRecords', async () => {
    try {
      return logicCheckRecorder.clearRecords();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '清空记录失败' };
    }
  });

  // ========== Table Management ==========

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

  ipcMain.handle('writing:table:saveTableConfig', async (_event, projectId: string, config: any) => {
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
      console.log('[DEBUG IPC] associateTableTemplate 接收参数:', {
        projectId,
        templateId,
        templateName,
        templateSheetsType: typeof templateSheets,
        templateSheetsIsArray: Array.isArray(templateSheets),
        templateSheetsLength: templateSheets?.length,
        templateSheetsFirst: templateSheets?.[0]
      });
      if (!templateSheets || !Array.isArray(templateSheets) || templateSheets.length === 0) {
        console.error('[DEBUG IPC] 模板页签数据为空或格式错误');
        return { success: false, error: '模板页签数据为空' };
      }
      await writingStorageService.associateTableTemplate(projectId, templateId, templateName, templateSheets);
      return { success: true };
    } catch (error) {
      console.error('[writing:table:associateTableTemplate] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '关联模板失败'
      };
    }
  });

  ipcMain.handle('writing:table:getAllTemplates', async () => {
    try {
      const templates = tableTemplateService.getAllTemplates();
      return { success: true, templates };
    } catch (error) {
      console.error('[writing:table:getAllTemplates] Error:', error);
      return {
        success: false,
        templates: [],
        error: error instanceof Error ? error.message : '获取模板列表失败'
      };
    }
  });

  ipcMain.handle('writing:table:organizeTable', async (event, projectId: string, modelConfig: ModelConfig, chapterIndex?: number) => {
    try {
      console.log('[WritingOrganize] IPC handler 收到请求:', { projectId, chapterIndex });
      const result = await writingStorageService.organizeTable(
        projectId,
        modelConfig,
        chapterIndex,
        // onProgress callback - 发送进度事件到渲染进程
        (current: number, total: number, message: string, percent?: number) => {
          if (event.sender && !event.sender.isDestroyed()) {
            event.sender.send('writing:table:organizeProgress', projectId, {
              current,
              total,
              message,
              percent: percent || 0,
              timestamp: Date.now()
            });
          }
        }
      );
      return { success: true, ...result };
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

  ipcMain.handle('writing:continueOutline', async (_event, request: { outline: GeneratedOutline; chapterCount: number; instructions: string }) => {
    try {
      addLog('===== 写作模式: 大纲续写请求 =====', 'debug');
      addLog(`已有章节数: ${request.outline.chapters.length}`, 'debug');
      addLog(`续写章节数: ${request.chapterCount}`, 'debug');
      addLog(`续写指令: ${request.instructions || '无'}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

      const project = await writingStorageService.loadProject(request.outline.workInfo?.suggestedTitle || '');
      
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      const engines = settings?.aiEngines || [];
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

  console.log('[Writing] Writing handlers registered');
}
