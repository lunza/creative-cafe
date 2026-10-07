/**
 * 写作模式 - 章节生成 / 分片 / shard IPC handler
 *
 * 涵盖：
 *   - 生成取消（cancelGeneration）
 *   - 用户可控 shard 工作流（generateShardOutline / generateShardContent）
 *   - 章节 AI 味审核（checkChapterDeAi / cancelDeAiCheck）
 *   - AI 章节拆并建议（aiSuggestSplit / aiSuggestMerge）
 *
 * 模块同时导出写作域共享的 `activeAbortControllers` Map 与
 * `abortAllActiveRequests` 函数，被 writingProjectHandlers /
 * writingOutlineHandlers / writingStyleHandlers 共同复用，并由
 * writingHandlers.ts 重新导出 `abortAllActiveRequests` 以保持 main/index.ts
 * 调用方式不变。
 *
 * 注意：本文件内 handler 体量较大且包含流式回调与多层错误处理，保留原始
 * try/catch 结构以维持 IPC 响应形态与 `writing:chunk:*`
 * 事件副作用不变；对于纯计算 / 无副作用的简单 handler，使用 wrapHandler 统一兜底。
 */
import { ipcMain } from 'electron';
import { writingStorageService } from '../../../services/WritingStorageService';
import { contentGenerator } from '../../../services/writing/ContentGenerator';
import { aiAssistedChapterService } from '../../../services/writing/AIAssistedChapterService';
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

      // 思考模型（Qwen3 等）先输出 reasoning_content 再输出正文，思考期可能占生成时长的
      // 大半——透出思考流事件让前端展示"AI 思考中"实时进度，避免用户长时间看不到任何输出
      const onReasoning = (chunk: string) => {
        event.sender.send('writing:chunk:reasoning', {
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
          abortController.signal,
          onReasoning
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

  // ========== 章节内容 AI 味审核（humanizer 规则审读 + 修订文本） ==========

  ipcMain.handle('writing:checkChapterDeAi', async (event, request) => {
    try {
      addLog('===== 写作模式: 章节AI味审核请求 =====', 'debug');
      // 过程流式增量透传（思考流/正文），前端弹窗实时展示审核过程
      const result = await contentGenerator.checkChapterDeAi(request, (chunk, reasoning) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('writing:deai:stream', { chunk, reasoning });
        }
      });
      return { success: true, ...result };
    } catch (error) {
      // 用户中止（writing:cancelDeAiCheck）：返回 cancelled 标记，前端提示"已停止"而非报错
      if (error && typeof error === 'object' && (error as { cancelled?: unknown }).cancelled) {
        addLog('[章节AI味审核] 用户已停止', 'warn');
        return { success: false, cancelled: true, error: '用户已停止' };
      }
      // 注意：createError 返回的是普通 WritingError 对象（非 Error 实例），需按对象取 message，否则 String() 得 "[object Object]"
      const errMsg =
        error && typeof error === 'object' && 'message' in error && String((error as { message?: unknown }).message)
          ? String((error as { message: unknown }).message)
          : error instanceof Error
            ? error.message
            : String(error);
      addLog(`[章节AI味审核] 失败: ${errMsg}`, 'error');
      return {
        success: false,
        error: errMsg
      };
    }
  });

  // ========== 中止进行中的章节 AI 味审核 ==========
  ipcMain.handle('writing:cancelDeAiCheck', async (): Promise<{ success: boolean }> => {
    contentGenerator.cancelDeAiCheck();
    return { success: true };
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
