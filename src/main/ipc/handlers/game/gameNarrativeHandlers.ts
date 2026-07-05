/**
 * 游戏模式 - AI 叙事生成 IPC handler
 *
 * 涵盖：
 *   - game:generateNarrative    流式生成剧情
 *   - game:cancelGeneration     取消指定 saveId 的生成
 *
 * 流式事件推送（通过 event.sender.send 主动推送给渲染进程）：
 *   - game:narrative:chunk      流式文本片段（{ saveId, chunk, index }）
 *   - game:narrative:complete   生成完成（{ saveId, fullText, tableChanges, tableEdits, generationTime, model }）
 *   - game:narrative:error      生成错误（{ saveId, error, code }）
 *   - game:table:updated        表格被 tableEdit 更新后推送（{ saveId, changes }）
 *
 * 取消机制：
 *   - 每个 saveId 对应一个 AbortController（存于 activeAbortControllers Map）
 *   - cancelGeneration(saveId) 调用对应 controller.abort()
 *   - abortAllActiveGameRequests() 取消所有活跃生成（应用退出 / 切换存档场景）
 *
 * 注意：GameNarrativeService 通过 setter 注入仓库依赖（在 gameHandlers.ts 聚合入口中调用）。
 *       本 handler 仅负责将 service 的 callbacks 转换为 IPC 事件推送。
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { gameNarrativeService } from '../../../services/game/GameNarrativeService';
import type {
  GameNarrativeRequest,
  GameNarrativeComplete,
  GameTableUpdated
} from '../../../../shared/types/game.types';
import { wrapHandler } from '../utils/wrapHandler';

// ============================================================================
// 共享状态：活动 AbortController 集合
// ============================================================================

/**
 * 活跃的 AbortController 集合（key 为 saveId）
 *
 * 用于取消单个存档的生成请求，以及 abortAll 时批量取消。
 * 生成完成或出错时从集合中移除对应 controller。
 *
 * 设计同 writing 模块的 activeAbortControllers（writingChapterHandlers.ts:42）。
 */
const activeAbortControllers = new Map<string, AbortController>();

/**
 * 取消所有活动的游戏叙事生成请求
 *
 * 应用退出 / 页面导航 / 切换存档场景下调用。
 * 调用后所有未完成的 generateNarrative 都会触发 onError(code='aborted')。
 */
export function abortAllActiveGameRequests(): void {
  if (activeAbortControllers.size === 0) return;
  // 取消所有 controller
  for (const controller of activeAbortControllers.values()) {
    try {
      controller.abort();
    } catch (error) {
      console.error('[gameNarrativeHandlers] abortAll error:', error);
    }
  }
  activeAbortControllers.clear();
}

/**
 * 取消指定 saveId 的生成请求
 *
 * @returns 是否找到对应请求并取消（未找到返回 false）
 */
function abortRequest(saveId: string): boolean {
  const controller = activeAbortControllers.get(saveId);
  if (!controller) {
    return false;
  }
  try {
    controller.abort();
  } catch (error) {
    console.error(`[gameNarrativeHandlers] abort ${saveId} error:`, error);
  }
  activeAbortControllers.delete(saveId);
  return true;
}

/**
 * 安全地向渲染进程推送 IPC 事件
 * 检查 event.sender 是否已销毁（窗口关闭场景）
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
    console.error(`[gameNarrativeHandlers] Failed to send ${channel}:`, error);
  }
}

export function registerGameNarrativeHandlers(): void {
  // ========== 叙事生成 ==========

  /**
   * 流式生成剧情
   *
   * 调用流程：
   *   1. 为 saveId 创建 AbortController（如已存在则先 abort 旧的）
   *   2. 调用 gameNarrativeService.generateNarrative
   *   3. 通过 callbacks 将 service 回调转换为 IPC 事件推送：
   *      - onChunk(chunk, index) → event.sender.send('game:narrative:chunk', { saveId, chunk, index })
   *      - onComplete(result)   → event.sender.send('game:narrative:complete', result)
   *                              + 若 tableChanges.commandsExecuted > 0，推送 'game:table:updated'
   *      - onError(error, code) → event.sender.send('game:narrative:error', { saveId, error, code })
   *   4. 完成 / 出错时清理 activeAbortControllers
   *
   * 返回值：{ success: true } 表示请求已开始（不代表生成完成）；
   *         生成完成通过 game:narrative:complete 事件通知。
   *
   * 注意：本 handler 立即返回 success: true，实际生成在后台异步进行。
   *       渲染进程需通过 onNarrativeChunk / onNarrativeComplete / onNarrativeError 监听结果。
   */
  ipcMain.handle(
    'game:generateNarrative',
    wrapHandler(async (event, request: GameNarrativeRequest) => {
      const { saveId } = request;

      // 1. 取消同 saveId 的旧请求（避免并发生成同一存档）
      abortRequest(saveId);

      // 2. 创建新的 AbortController
      const controller = new AbortController();
      activeAbortControllers.set(saveId, controller);

      // 3. 异步发起生成（不 await，立即返回 success: true）
      //    生成完成 / 出错时清理 activeAbortControllers
      gameNarrativeService
        .generateNarrative(
          request,
          {
            onChunk: (chunk: string, index: number) => {
              safeSend(event, 'game:narrative:chunk', { saveId, chunk, index });
            },
            onComplete: (result: GameNarrativeComplete) => {
              // 推送完成事件
              safeSend(event, 'game:narrative:complete', result);

              // 若表格有变更，额外推送 table:updated 事件
              if (
                result.tableChanges &&
                result.tableChanges.commandsExecuted > 0
              ) {
                const tableUpdated: GameTableUpdated = {
                  saveId,
                  changes: result.tableChanges
                };
                safeSend(event, 'game:table:updated', tableUpdated);
              }

              // 清理 controller
              activeAbortControllers.delete(saveId);
            },
            onError: (error: string, code: string) => {
              safeSend(event, 'game:narrative:error', { saveId, error, code });

              // 清理 controller
              activeAbortControllers.delete(saveId);
            }
          },
          controller.signal
        )
        .catch((error) => {
          // 兜底：service 内部已捕获，这里仅清理 + 推送 error
          console.error(
            `[gameNarrativeHandlers] generateNarrative unexpected error for ${saveId}:`,
            error
          );
          safeSend(event, 'game:narrative:error', {
            saveId,
            error:
              error instanceof Error ? error.message : '叙事生成未知错误',
            code: 'unknown'
          });
          activeAbortControllers.delete(saveId);
        });

      return { success: true };
    })
  );

  // ========== 取消生成 ==========

  /**
   * 取消指定 saveId 的生成请求
   * 取消后通过 game:narrative:error 事件推送 code='aborted' 错误
   *
   * @returns { success, cancelled } cancelled 表示是否找到并取消了对应请求
   */
  ipcMain.handle(
    'game:cancelGeneration',
    wrapHandler(async (_event, saveId: string) => {
      const cancelled = abortRequest(saveId);
      return { success: true, cancelled };
    })
  );
}
