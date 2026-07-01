/**
 * 写作模式 - 章节生成 / 分片 / shard IPC handler
 *
 * 涵盖：
 *   - 章节流式生成（generateChapter / cancelGeneration）
 *   - 分片 chunk 流式生成（generateChapterChunk / cancelChunkGeneration /
 *     generateChunkSummary / save|get|clear ChunkCheckpoint）
 *   - 用户可控 shard 工作流（generateShardOutline / generateShardContent）
 *   - AI 章节拆并建议（aiSuggestSplit / aiSuggestMerge）
 *
 * 模块同时导出写作域共享的 `activeAbortControllers` Map 与
 * `abortAllActiveRequests` 函数，被 writingProjectHandlers /
 * writingOutlineHandlers / writingStyleHandlers 共同复用，并由
 * writingHandlers.ts 重新导出 `abortAllActiveRequests` 以保持 main/index.ts
 * 调用方式不变。
 *
 * 注意：本文件内 handler 体量较大且包含流式回调与多层错误处理，保留原始
 * try/catch 结构以维持 IPC 响应形态与 `writing:stream:*` / `writing:chunk:*`
 * 事件副作用不变；对于纯计算 / 无副作用的简单 handler，使用 wrapHandler 统一兜底。
 */
import { ipcMain } from 'electron';
import { writingStorageService } from '../../../services/WritingStorageService';
import { writingResourceManager } from '../../../services/WritingResourceManager';
import { worldBookService } from '../../../services/worldBookService';
import { contentGenerator } from '../../../services/writing/ContentGenerator';
import { promptBuilder } from '../../../services/writing/PromptBuilder';
import { aiAssistedChapterService } from '../../../services/writing/AIAssistedChapterService';
import { chapterChunkService } from '../../../services/writing/ChapterChunkService';
import { addLog } from '../../../services/memory/chatLogService';
import {
  WritingError,
  WritingErrorCode
} from '../../../../shared/types/writing.types';
import { wrapHandler } from '../utils/wrapHandler';

// ============================================================================
// 共享状态：活动 AbortController 集合
// ============================================================================
// 原本定义在 writingHandlers.ts 顶层，被 outline / chapter / style / cleanup
// 等多个 handler 共同读写。拆分后由本模块统一持有，其它 writing/* 子模块
// 通过 import 引用同一 Map 实例，保证中止逻辑行为不变。
export const activeAbortControllers = new Map<string, AbortController>();

/**
 * 中止所有活动生成请求。
 * 在 BrowserWindow 的 will-navigate 事件中调用（main/index.ts 直接 import）。
 */
export function abortAllActiveRequests(): void {
  const count = activeAbortControllers.size;
  for (const controller of activeAbortControllers.values()) {
    controller.abort();
  }
  activeAbortControllers.clear();
  if (count > 0) {
    addLog(`[Abort] 页面导航，已中止 ${count} 个生成请求`, 'warn');
  }
}

export function registerWritingChapterHandlers(): void {
  // ========== 章节生成 ==========

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
              chapterOutline,
              5
            );

            if (searchResults.length > 0) {
              addLog(`[WorldBook] 世界书"${wb.name}" 检索到 ${searchResults.length} 个相关条目`, 'debug');

              for (const result of searchResults) {
                const meta = result.metadata as any; // 已分析但保留：metadata 为松散结构，下游需访问 .entryName/.entryContent 等字符串属性，改 Record<string,unknown> 会引发 unknown 不能调 .length/.trim() 的级联错误

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
          personality: char.personality || (char as { traits?: string[] }).traits?.join('、') || '',
          mesExample: (char as { mesExample?: string }).mesExample || ''
        }));
      }

      if (userPersonas.length > 0) {
        addLog(`[Resources] 加载用户人设: ${userPersonas.length}个`, 'debug');
        (request as any).userPersonaContext = userPersonas.map(p => ({ // 已分析但保留：request 类型无 userPersonaContext 字段
          name: p.name || '未知',
          description: p.description || '',
          traits: (p as { traits?: string[] }).traits || []
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
      const controllerKey = `${projectId}_${chapterIndex}`;

      // Abort any existing request for the same chapter before starting a new one
      const existingController = activeAbortControllers.get(controllerKey);
      if (existingController) {
        addLog(`  检测到同章节已有活跃请求，先中止旧请求`, 'warn');
        existingController.abort();
      }

      activeAbortControllers.set(controllerKey, abortController);

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
        const writingError = error as WritingError;
        const errorObj: WritingError = {
          code: writingError.code || WritingErrorCode.CONTENT_GENERATION_FAILED,
          message: errorMessage,
          recoverable: writingError.recoverable ?? true,
          details: writingError.details,
          errorType: writingError.errorType
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

  ipcMain.handle(
    'writing:cancelGeneration',
    wrapHandler(async (_event, projectId: string) => {
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
      addLog(`[Abort] 已取消生成: ${keysToDelete.length} 个请求`, 'warn');
      return { success: true, cancelledCount: keysToDelete.length };
    })
  );

  // ========== 分片生成相关 IPC handler ==========

  /**
   * 分片生成章节内容
   * 支持流式输出，通过事件通知前端进度
   */
  ipcMain.handle('writing:generateChapterChunk', async (event, request) => {
    try {
      const { projectId, chapterIndex, chunkIndex, totalChunks, chapterInfo, modelConfig, previousChunkContent } = request;

      addLog('===== 写作模式: 分片章节生成请求 =====', 'debug');
      addLog(`章节索引: ${chapterIndex}, 分片索引: ${chunkIndex}/${totalChunks}`, 'debug');
      addLog(`章节信息: ${JSON.stringify(chapterInfo)}`, 'debug');
      addLog(`模型配置: ${JSON.stringify(modelConfig)}`, 'debug');

      const abortController = new AbortController();
      const controllerKey = `${projectId}_${chapterIndex}_chunk_${chunkIndex}`;

      // 中止同一分片的旧请求
      const existingController = activeAbortControllers.get(controllerKey);
      if (existingController) {
        addLog(`  检测到同分片已有活跃请求，先中止旧请求`, 'warn');
        existingController.abort();
      }

      activeAbortControllers.set(controllerKey, abortController);

      // 发送分片开始事件
      event.sender.send('writing:chunk:start', {
        projectId,
        chapterIndex,
        chunkIndex
      });

      let accumulatedContent = '';

      const onStream = (chunk: string) => {
        accumulatedContent += chunk;
        // 发送分片进度事件
        event.sender.send('writing:chunk:progress', {
          projectId,
          chapterIndex,
          chunkIndex,
          chunk
        });
      };

      try {
        // 调用内容生成器，传入分片上下文
        const result = await contentGenerator.generateStream(
          {
            ...request,
            previousChunkContent, // 前序分片内容作为上下文
            chunkContext: {
              chunkIndex,
              totalChunks,
              isLastChunk: chunkIndex === totalChunks - 1
            }
          },
          modelConfig,
          onStream,
          abortController.signal
        );

        // 发送分片完成事件
        event.sender.send('writing:chunk:complete', {
          projectId,
          chapterIndex,
          chunkIndex,
          content: result.content
        });

        addLog('===== 写作模式: 分片生成成功 =====', 'debug');
        addLog(`章节索引: ${chapterIndex}, 分片索引: ${chunkIndex}`, 'debug');
        addLog(`内容长度: ${result.content?.length || 0}`, 'debug');
        addLog('===== 响应结束 =====', 'debug');

        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const writingError = error as WritingError;
        const errorObj: WritingError = {
          code: writingError.code || WritingErrorCode.CONTENT_GENERATION_FAILED,
          message: errorMessage,
          recoverable: writingError.recoverable ?? true,
          details: writingError.details,
          errorType: writingError.errorType
        };

        // 发送分片错误事件
        event.sender.send('writing:chunk:error', {
          projectId,
          chapterIndex,
          chunkIndex,
          error: errorObj
        });

        addLog('===== 写作模式: 分片生成错误 =====', 'error');
        addLog(`章节索引: ${chapterIndex}, 分片索引: ${chunkIndex}`, 'error');
        addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
        addLog('===== 错误详情结束 =====', 'error');

        return { success: false, error: errorMessage };
      } finally {
        activeAbortControllers.delete(controllerKey);
      }
    } catch (error) {
      addLog('===== 写作模式: 分片生成外部错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  /**
   * 取消分片生成
   */
  ipcMain.handle(
    'writing:cancelChunkGeneration',
    wrapHandler(async (_event, projectId: string, chapterIndex: number, chunkIndex: number) => {
      const controllerKey = `${projectId}_${chapterIndex}_chunk_${chunkIndex}`;
      const controller = activeAbortControllers.get(controllerKey);

      if (controller) {
        controller.abort();
        activeAbortControllers.delete(controllerKey);
        addLog(`[Abort] 已取消分片生成: ${controllerKey}`, 'warn');
        return { success: true };
      }

      return { success: false, error: '未找到对应的生成任务' };
    })
  );

  /**
   * 生成分片摘要
   * 用于在分片生成完成后生成摘要，供后续分片参考
   */
  ipcMain.handle('writing:generateChunkSummary', async (_event, request) => {
    try {
      const { projectId, chapterIndex, chunkIndex, content } = request;

      addLog('===== 写作模式: 生成分片摘要 =====', 'debug');
      addLog(`章节索引: ${chapterIndex}, 分片索引: ${chunkIndex}`, 'debug');
      addLog(`内容长度: ${content?.length || 0}`, 'debug');

      if (!content || content.trim().length === 0) {
        return '';
      }

      // 使用 chapterChunkService 生成摘要
      const summary = await chapterChunkService.generateSummary(content);

      // 保存 checkpoint 到磁盘（用于断点续传）
      try {
        await writingStorageService.saveChunkCheckpoint(
          projectId,
          chapterIndex,
          chunkIndex,
          content
        );
      } catch (checkpointError) {
        addLog(`保存 checkpoint 失败: ${checkpointError}`, 'warn');
      }

      addLog(`分片摘要生成成功: ${summary.substring(0, 100)}...`, 'debug');

      return summary;
    } catch (error) {
      addLog('===== 写作模式: 生成分片摘要错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      // 降级：返回内容前 200 字作为简单摘要
      const fallbackSummary = request.content?.substring(0, 200).replace(/\n/g, ' ') + '...';
      return fallbackSummary || '';
    }
  });

  /**
   * 保存分片 checkpoint 到磁盘
   * 用于中断时持久化当前分片内容，支持断点续传
   */
  ipcMain.handle('writing:saveChunkCheckpoint', async (_event, request) => {
    try {
      const { projectId, chapterIndex, chunkIndex, content } = request;

      addLog('===== 写作模式: 保存分片 checkpoint =====', 'debug');
      addLog(`章节索引: ${chapterIndex}, 分片索引: ${chunkIndex}`, 'debug');
      addLog(`内容长度: ${content?.length || 0}`, 'debug');

      if (!content || content.trim().length === 0) {
        addLog('内容为空，跳过保存', 'warn');
        return { success: false, error: '内容为空' };
      }

      await writingStorageService.saveChunkCheckpoint(
        projectId,
        chapterIndex,
        chunkIndex,
        content
      );

      addLog('分片 checkpoint 保存成功', 'debug');

      return { success: true };
    } catch (error) {
      addLog('===== 写作模式: 保存分片 checkpoint 错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * 获取分片 checkpoint
   * 用于断点续传时恢复已生成的分片内容
   */
  ipcMain.handle('writing:getChunkCheckpoint', async (_event, request) => {
    try {
      const { projectId, chapterIndex, chunkIndex } = request;

      addLog('===== 写作模式: 获取分片 checkpoint =====', 'debug');
      addLog(`章节索引: ${chapterIndex}, 分片索引: ${chunkIndex}`, 'debug');

      const content = await writingStorageService.loadChunkCheckpoint(projectId, chapterIndex, chunkIndex);

      return content;
    } catch (error) {
      addLog('===== 写作模式: 获取分片 checkpoint 错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      return null;
    }
  });

  /**
   * 清理分片 checkpoint
   * 在章节所有分片生成完成后调用，释放磁盘空间
   */
  ipcMain.handle('writing:clearChunkCheckpoint', async (_event, request) => {
    try {
      const { projectId, chapterIndex } = request;

      addLog('===== 写作模式: 清理分片 checkpoint =====', 'debug');
      addLog(`章节索引: ${chapterIndex}`, 'debug');

      await writingStorageService.clearChunkCheckpoints(projectId, chapterIndex);

      return { success: true };
    } catch (error) {
      addLog('===== 写作模式: 清理分片 checkpoint 错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ========== 新分片生成相关 IPC handler（用户可控分片工作流） ==========

  /**
   * 生成分片大纲（非流式）
   * 根据章节大纲与用户指定分片数，生成各分片的剧情简介与目标字数。
   */
  ipcMain.handle('writing:generateShardOutline', async (_event, request) => {
    try {
      const { projectId, chapterIndex } = request;

      addLog('===== 写作模式: 分片大纲生成请求 =====', 'debug');
      addLog(`章节索引: ${chapterIndex}, 分片数: ${request.shardCount}`, 'debug');
      addLog(`章节信息: ${JSON.stringify(request.chapterInfo)}`, 'debug');
      addLog(`模型配置: ${JSON.stringify(request.modelConfig)}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

      // 加载历史表格数据，作为分片大纲生成的参考素材（与单次生成流程一致）
      if (projectId) {
        const tableData = await writingStorageService.getTableData(projectId);
        const tableConfig = await writingStorageService.getTableConfig(projectId);
        if (tableData && tableConfig) {
          addLog(`[WritingTable] 分片大纲-加载表格数据: ${tableData.sheets?.length || 0}个表`, 'debug');
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

      const abortController = new AbortController();
      const controllerKey = `${projectId}_${chapterIndex}_shard_outline`;

      // 中止同一分片大纲的旧请求
      const existingController = activeAbortControllers.get(controllerKey);
      if (existingController) {
        addLog(`  检测到同分片大纲已有活跃请求，先中止旧请求`, 'warn');
        existingController.abort();
      }

      activeAbortControllers.set(controllerKey, abortController);

      try {
        const result = await contentGenerator.generateShardOutline(
          request,
          request.modelConfig,
          abortController.signal
        );

        addLog('===== 写作模式: 分片大纲生成完成 =====', 'debug');
        addLog(`章节索引: ${chapterIndex}, 分片数: ${result.shards?.length || 0}, 成功: ${result.success}`, 'debug');
        addLog('===== 响应结束 =====', 'debug');

        if (result.success) {
          return { success: true, data: result.shards };
        }

        return { success: false, error: result.error || '分片大纲生成失败' };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const writingError = error as WritingError;
        const errorObj: WritingError = {
          code: writingError.code || WritingErrorCode.OUTLINE_GENERATION_FAILED,
          message: errorMessage,
          recoverable: writingError.recoverable ?? true,
          details: writingError.details,
          errorType: writingError.errorType
        };

        addLog('===== 写作模式: 分片大纲生成错误 =====', 'error');
        addLog(`章节索引: ${chapterIndex}`, 'error');
        addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
        addLog(`错误对象: ${JSON.stringify(errorObj)}`, 'error');
        addLog('===== 错误详情结束 =====', 'error');

        return { success: false, error: errorMessage };
      } finally {
        activeAbortControllers.delete(controllerKey);
      }
    } catch (error) {
      addLog('===== 写作模式: 分片大纲生成外部错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  /**
   * 流式生成分片内容
   * 复用现有 chunk 流式事件机制（writing:chunk:start/progress/complete/error），
   * 以 chunkIndex = shardIndex 区分分片，避免前端重复造监听。
   */
  ipcMain.handle('writing:generateShardContent', async (event, request) => {
    try {
      const { projectId, chapterIndex, shardIndex, totalShards } = request;

      addLog('===== 写作模式: 分片内容生成请求 =====', 'debug');
      addLog(`章节索引: ${chapterIndex}, 分片索引: ${shardIndex}/${totalShards}`, 'debug');
      addLog(`章节信息: ${JSON.stringify(request.chapterInfo)}`, 'debug');
      addLog(`模型配置: ${JSON.stringify(request.modelConfig)}`, 'debug');
      addLog('===== 请求入参结束 =====', 'debug');

      // 加载历史表格数据，作为分片内容生成的参考素材（与单次生成流程一致）
      if (projectId) {
        const tableData = await writingStorageService.getTableData(projectId);
        const tableConfig = await writingStorageService.getTableConfig(projectId);
        if (tableData && tableConfig) {
          addLog(`[WritingTable] 分片内容-加载表格数据: ${tableData.sheets?.length || 0}个表`, 'debug');
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

      const abortController = new AbortController();
      const controllerKey = `${projectId}_${chapterIndex}_shard_${shardIndex}`;

      // 中止同一分片的旧请求
      const existingController = activeAbortControllers.get(controllerKey);
      if (existingController) {
        addLog(`  检测到同分片已有活跃请求，先中止旧请求`, 'warn');
        existingController.abort();
      }

      activeAbortControllers.set(controllerKey, abortController);

      // 发送分片开始事件（复用 chunk 流式事件，chunkIndex = shardIndex）
      event.sender.send('writing:chunk:start', {
        projectId,
        chapterIndex,
        chunkIndex: shardIndex
      });

      let accumulatedContent = '';

      const onStream = (chunk: string) => {
        accumulatedContent += chunk;
        // 发送分片进度事件
        event.sender.send('writing:chunk:progress', {
          projectId,
          chapterIndex,
          chunkIndex: shardIndex,
          chunk
        });
      };

      try {
        const result = await contentGenerator.generateShardContent(
          request,
          request.modelConfig,
          onStream,
          abortController.signal
        );

        // 发送分片完成事件
        event.sender.send('writing:chunk:complete', {
          projectId,
          chapterIndex,
          chunkIndex: shardIndex,
          content: result.content
        });

        addLog('===== 写作模式: 分片内容生成成功 =====', 'debug');
        addLog(`章节索引: ${chapterIndex}, 分片索引: ${shardIndex}`, 'debug');
        addLog(`内容长度: ${result.content?.length || 0}`, 'debug');
        addLog('===== 响应结束 =====', 'debug');

        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const writingError = error as WritingError;
        const errorObj: WritingError = {
          code: writingError.code || WritingErrorCode.CONTENT_GENERATION_FAILED,
          message: errorMessage,
          recoverable: writingError.recoverable ?? true,
          details: writingError.details,
          errorType: writingError.errorType
        };

        // 发送分片错误事件
        event.sender.send('writing:chunk:error', {
          projectId,
          chapterIndex,
          chunkIndex: shardIndex,
          error: errorObj
        });

        addLog('===== 写作模式: 分片内容生成错误 =====', 'error');
        addLog(`章节索引: ${chapterIndex}, 分片索引: ${shardIndex}`, 'error');
        addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
        addLog('===== 错误详情结束 =====', 'error');

        return { success: false, error: errorMessage };
      } finally {
        activeAbortControllers.delete(controllerKey);
      }
    } catch (error) {
      addLog('===== 写作模式: 分片内容生成外部错误 =====', 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // ========== AI 章节拆并建议 ==========

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
      addLog(`章节索引: ${JSON.stringify(request.chapters?.map((ch: any) => ch.index) || [])}`, 'debug'); // 已分析但保留：request 无显式类型，ch 无法推断
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
}
