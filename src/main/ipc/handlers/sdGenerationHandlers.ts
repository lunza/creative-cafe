/**
 * SD 表情生成 IPC 处理器（Spec: add-ai-expression-generation / Task 2）
 *
 * 通道列表：
 *   - sd:checkStatus              检查 SD WebUI API 状态
 *   - sd:getModels                获取 SD WebUI 已加载的模型列表
 *   - sd:generateExpression       生成单个表情图片（img2img）
 *   - sd:generateTxt2Img          文生图（txt2img，NL 驱动模型专用）
 *   - sd:generateAllExpressions   批量生成多个表情（带进度推送与取消支持）
 *   - sd:cancelGeneration         取消正在进行的批量生成任务
 *
 * 事件推送（通过 event.sender.send 主动推送给渲染进程）：
 *   - sd:generationProgress       单个表情生成进度
 *                                 { current, total, emotionKey, status, error?, imageBase64? }
 *   - sd:generationComplete       批量生成完成汇总
 *                                 { total, success, failed, cancelled }
 *
 * 取消机制：
 *   - 模块级 `isCancelled` 标志位，cancelGeneration 设置为 true
 *   - generateAllExpressions 在每次循环开始前检查，若为 true 则 break
 *   - 每次新批次开始时重置为 false
 *
 * 注册模式参照 registerExpressionHandlers()：导出 registerSdGenerationHandlers() 函数。
 * safeSend 模式参照 gameNarrativeHandlers.ts，避免窗口销毁后发送事件抛错。
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { sdGenerationService } from '../../services/sdGenerationService';
import type { SDGenerationOptions } from '../../services/sdGenerationService';

/** 模块级取消标志：cancelGeneration 设置为 true，generateAllExpressions 每次循环检查 */
let isCancelled = false;

/**
 * 安全地向渲染进程推送 IPC 事件
 * 检查 event.sender 是否已销毁（窗口关闭场景），与 gameNarrativeHandlers 中的 safeSend 一致。
 */
function safeSend(
  event: IpcMainInvokeEvent,
  channel: string,
  ...args: any[]
): void {
  try {
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send(channel, ...args);
    }
  } catch (error) {
    console.error(`[sdGenerationHandlers] Failed to send ${channel}:`, error);
  }
}

export function registerSdGenerationHandlers() {
  /**
   * 检查 SD WebUI API 状态
   * Spec: add-ai-expression-generation / Task 2
   *
   * @param args.endpoint SD WebUI API 端点（如 http://localhost:7860）
   * @returns { available, currentModel?, error? }
   */
  ipcMain.handle(
    'sd:checkStatus',
    async (_event, args: { endpoint: string }) => {
      try {
        const { endpoint } = args;
        return await sdGenerationService.checkStatus(endpoint);
      } catch (error) {
        console.error('[sd:checkStatus] failed:', error);
        return {
          available: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * 获取 SD WebUI 已加载的模型列表
   * Spec: add-ai-expression-generation / Task 2
   *
   * @param args.endpoint SD WebUI API 端点
   * @returns { success, models, error? }
   */
  ipcMain.handle(
    'sd:getModels',
    async (_event, args: { endpoint: string }) => {
      try {
        const { endpoint } = args;
        return await sdGenerationService.getModels(endpoint);
      } catch (error) {
        console.error('[sd:getModels] failed:', error);
        return {
          success: false,
          models: [],
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * 生成单个表情图片
   * Spec: add-ai-expression-generation / Task 2
   *
   * 流程：先 extractBaseImage 提取角色卡基底图片，再 generateExpression 通过 img2img 生成。
   *
   * @param args.characterCardPath 角色卡 PNG 文件绝对路径
   * @param args.emotionKey 情绪键（用于日志）
   * @param args.prompt 正面提示词
   * @param args.negativePrompt 负面提示词
   * @param args.options SD 生成选项（端点 / 采样参数 / ADetailer 等）
   * @returns { success, imageBase64?, error? }
   */
  ipcMain.handle(
    'sd:generateExpression',
    async (
      _event,
      args: {
        characterCardPath: string;
        emotionKey: string;
        prompt: string;
        negativePrompt: string;
        options?: SDGenerationOptions;
      }
    ) => {
      try {
        const { characterCardPath, prompt, negativePrompt, options } = args;

        // Step 1: 从角色卡提取基底图片
        const extractResult = await sdGenerationService.extractBaseImage(characterCardPath);
        if (!extractResult.success || !extractResult.imageBase64) {
          return {
            success: false,
            error: extractResult.error || '提取基底图片失败',
          };
        }

        // Step 2: 通过 img2img 生成表情
        const endpoint = options?.endpoint || '';
        const generateResult = await sdGenerationService.generateExpression({
          endpoint,
          baseImageBase64: extractResult.imageBase64,
          prompt,
          negativePrompt,
          options,
        });

        return generateResult;
      } catch (error) {
        console.error('[sd:generateExpression] failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * 文生图（txt2img）— 不需要基底图片
   * Spec: integrate-nl-driven-sd-models / Task 5
   *
   * 适用于 qwen-image / flux2 等 NL 驱动模型的文生图模式，
   * 直接通过 prompt 生成图片，不走 img2img 流程。
   *
   * @param args.endpoint SD WebUI API 端点
   * @param args.prompt 正面提示词
   * @param args.negativePrompt 负面提示词（可选）
   * @param args.options SD 生成选项（采样参数 / 模型类型 / 宽高等）
   * @returns { success, imageBase64?, error?, warning? }
   */
  ipcMain.handle(
    'sd:generateTxt2Img',
    async (
      _event,
      args: {
        endpoint: string;
        prompt: string;
        negativePrompt?: string;
        options?: SDGenerationOptions;
      }
    ) => {
      try {
        const result = await sdGenerationService.generateTxt2Img({
          endpoint: args.endpoint,
          prompt: args.prompt,
          negativePrompt: args.negativePrompt,
          options: args.options,
        });
        return result; // { success, imageBase64?, error?, warning?, finalPrompt? }（Spec: enhance-conversation-image-auditability / Task 4.4 透传 finalPrompt）
      } catch (error) {
        console.error('[sd:generateTxt2Img] failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  /**
   * 批量生成多个表情
   * Spec: add-ai-expression-generation / Task 2
   *
   * 流程：
   *   1. extractBaseImage 一次（所有情绪共用基底图片）
   *   2. 循环 emotions 数组，对每个情绪调用 generateExpression
   *   3. 每个情绪完成后通过 sd:generationProgress 推送进度
   *   4. 全部完成后通过 sd:generationComplete 推送汇总
   *
   * 取消机制：每次循环开始前检查 isCancelled，若为 true 则 break。
   *
   * @param args.characterCardPath 角色卡 PNG 文件绝对路径
   * @param args.emotions 情绪数组（key / prompt / negativePrompt）
   * @param args.options SD 生成选项
   * @returns { success, total, successCount, failedCount, cancelledCount }
   */
  ipcMain.handle(
    'sd:generateAllExpressions',
    async (
      event,
      args: {
        characterCardPath: string;
        emotions: Array<{ key: string; prompt: string; negativePrompt: string }>;
        options?: SDGenerationOptions;
      }
    ) => {
      // 重置取消标志（每个新批次开始时）
      isCancelled = false;

      const { characterCardPath, emotions, options } = args;
      const total = emotions.length;
      let success = 0;
      let failed = 0;
      let cancelled = 0;

      // Step 1: 从角色卡提取基底图片（一次）
      const extractResult = await sdGenerationService.extractBaseImage(characterCardPath);
      if (!extractResult.success || !extractResult.imageBase64) {
        // 提取失败：所有情绪都标记为 failed 并发送完成事件
        for (let i = 0; i < total; i++) {
          safeSend(event, 'sd:generationProgress', {
            current: i + 1,
            total,
            emotionKey: emotions[i].key,
            status: 'failed',
            error: extractResult.error || '提取基底图片失败',
          });
        }
        failed = total;
        safeSend(event, 'sd:generationComplete', {
          total,
          success: 0,
          failed,
          cancelled: 0,
        });
        return {
          success: false,
          total,
          successCount: 0,
          failedCount: failed,
          cancelledCount: 0,
        };
      }

      const baseImageBase64 = extractResult.imageBase64;
      const endpoint = options?.endpoint || '';

      // Step 2: 循环生成每个表情
      for (let i = 0; i < total; i++) {
        // 检查取消标志：若已取消则跳出循环，剩余未处理的记入 cancelled
        if (isCancelled) {
          cancelled = total - i;
          break;
        }

        const emotion = emotions[i];

        try {
          const generateResult = await sdGenerationService.generateExpression({
            endpoint,
            baseImageBase64,
            prompt: emotion.prompt,
            negativePrompt: emotion.negativePrompt,
            options,
          });

          if (generateResult.success && generateResult.imageBase64) {
            success++;
            safeSend(event, 'sd:generationProgress', {
              current: i + 1,
              total,
              emotionKey: emotion.key,
              status: 'success',
              imageBase64: generateResult.imageBase64,
            });
          } else {
            failed++;
            safeSend(event, 'sd:generationProgress', {
              current: i + 1,
              total,
              emotionKey: emotion.key,
              status: 'failed',
              error: generateResult.error || '生成失败',
            });
          }
        } catch (error) {
          failed++;
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[sd:generateAllExpressions] emotion "${emotion.key}" failed:`, errorMsg);
          safeSend(event, 'sd:generationProgress', {
            current: i + 1,
            total,
            emotionKey: emotion.key,
            status: 'failed',
            error: errorMsg,
          });
        }
      }

      // Step 3: 推送完成事件
      safeSend(event, 'sd:generationComplete', {
        total,
        success,
        failed,
        cancelled,
      });

      return {
        success: failed === 0 && cancelled === 0,
        total,
        successCount: success,
        failedCount: failed,
        cancelledCount: cancelled,
      };
    }
  );

  /**
   * 取消正在进行的批量生成任务
   * Spec: add-ai-expression-generation / Task 2
   *
   * 设置模块级 isCancelled 标志为 true，generateAllExpressions 在下次循环检查时退出。
   * 注意：当前正在进行的 img2img HTTP 请求无法被外部 abort（由 120s 超时兜底），
   *       取消仅阻止后续未处理的情绪继续生成。
   *
   * @returns { success: true }
   */
  ipcMain.handle('sd:cancelGeneration', async () => {
    isCancelled = true;
    console.log('[sd:cancelGeneration] cancellation flag set to true');
    return { success: true };
  });
}
