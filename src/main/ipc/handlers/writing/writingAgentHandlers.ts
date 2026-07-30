/**
 * WritingAgent IPC Handlers —— 写作智能体编排 IPC 通道
 *
 * 来源：spec §二 Task 15.2（前端"智能体写作"按钮 + 进度流 + 断点续跑）
 * 决策：自研（spec §三无对应 openclaw 文件）。
 *
 * 5 个 IPC 通道：
 *  1. writing-agent:run      - 启动智能体写作编排（ipcMain.handle，返回 AgentWritingResult）
 *  2. writing-agent:cancel   - 取消编排（ipcMain.handle）
 *  3. writing-agent:status   - 查询编排状态（ipcMain.handle）
 *  4. writing-agent:progress - 进度事件流（event.sender.send 推送）
 *  5. writing-agent:resume   - 从 checkpoint 恢复编排（ipcMain.handle）
 *
 * 设计约束：
 *  - 进度事件通过 event.sender.send 实时推送 writing-agent:progress
 *  - 单实例守卫：同一时刻仅允许一个编排运行
 *  - 取消支持：前端可随时调用 writing-agent:cancel
 *  - 断点续跑：编排完成后保存 checkpoint，前端可调用 writing-agent:resume 恢复
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { WritingAgentService } from '../../../services/agent/writing/writingAgentService';
import { createLogger } from '../../../services/logger';
import type { AgentWritingRequest } from '../../../services/agent/writing/writingAgentTypes';

const logger = createLogger('writing-agent-handlers');

// ==================== 活跃编排管理 ====================

/** 进度订阅取消函数 */
let progressUnsubscribe: (() => void) | null = null;

// ==================== IPC 通道注册 ====================

/**
 * 注册写作智能体 IPC handler。
 *
 * 在 setupIpcHandlers 中调用。
 */
export function registerWritingAgentHandlers(): void {
  registerRunHandler();
  registerCancelHandler();
  registerStatusHandler();
  registerResumeHandler();

  logger.info('Writing agent IPC handlers registered (4 channels + progress stream)');
}

// ==================== writing-agent:run ====================

function registerRunHandler(): void {
  ipcMain.handle('writing-agent:run', async (event: IpcMainInvokeEvent, request: AgentWritingRequest) => {
    const service = WritingAgentService.getInstance();

    // 单实例守卫
    if (service.running) {
      return {
        success: false,
        error: '智能体写作正在运行中，请先取消当前任务',
      };
    }

    // 订阅进度事件，桥接到渲染进程
    progressUnsubscribe = service.onProgress((progressEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('writing-agent:progress', progressEvent);
      }
    });

    try {
      logger.info('Writing agent run started', undefined, { projectId: request.projectId });
      const result = await service.runAgentWriting(request);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Writing agent run failed', message);
      return {
        success: false,
        projectId: request.projectId,
        startChapterIndex: request.startChapterIndex ?? 0,
        endChapterIndex: request.endChapterIndex ?? 0,
        totalChapters: 0,
        succeededChapters: 0,
        failedChapters: 0,
        skippedChapters: 0,
        chapterResults: [],
        totalDurationMs: 0,
        cancelled: false,
        error: message,
      };
    } finally {
      // 清理订阅
      if (progressUnsubscribe) {
        progressUnsubscribe();
        progressUnsubscribe = null;
      }
    }
  });
}

// ==================== writing-agent:cancel ====================

function registerCancelHandler(): void {
  ipcMain.handle('writing-agent:cancel', async () => {
    const service = WritingAgentService.getInstance();
    if (!service.running) {
      return { success: false, error: '没有正在运行的智能体写作任务' };
    }
    try {
      service.cancel();
      logger.info('Writing agent cancelled by user');
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Writing agent cancel failed', message);
      return { success: false, error: message };
    }
  });
}

// ==================== writing-agent:status ====================

function registerStatusHandler(): void {
  ipcMain.handle('writing-agent:status', async () => {
    const service = WritingAgentService.getInstance();
    const checkpoint = WritingAgentService.getLastCheckpoint();

    return {
      running: service.running,
      hasCheckpoint: checkpoint !== null,
      checkpoint: checkpoint
        ? {
            projectId: checkpoint.projectId,
            nextChapterIndex: checkpoint.nextChapterIndex,
            endChapterIndex: checkpoint.endChapterIndex,
            completedChapters: checkpoint.completedChapters.length,
            updatedAt: checkpoint.updatedAt,
          }
        : null,
    };
  });
}

// ==================== writing-agent:resume ====================

function registerResumeHandler(): void {
  ipcMain.handle(
    'writing-agent:resume',
    async (event: IpcMainInvokeEvent, request: AgentWritingRequest) => {
      const service = WritingAgentService.getInstance();

      // 单实例守卫
      if (service.running) {
        return {
          success: false,
          error: '智能体写作正在运行中，请先取消当前任务',
        };
      }

      // 订阅进度事件
      progressUnsubscribe = service.onProgress((progressEvent) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('writing-agent:progress', progressEvent);
        }
      });

      try {
        logger.info('Writing agent resume from checkpoint', undefined, {
          projectId: request.projectId,
        });
        const result = await service.resumeFromCheckpoint(request);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Writing agent resume failed', message);
        return {
          success: false,
          projectId: request.projectId,
          startChapterIndex: 0,
          endChapterIndex: 0,
          totalChapters: 0,
          succeededChapters: 0,
          failedChapters: 0,
          skippedChapters: 0,
          chapterResults: [],
          totalDurationMs: 0,
          cancelled: false,
          error: message,
        };
      } finally {
        if (progressUnsubscribe) {
          progressUnsubscribe();
          progressUnsubscribe = null;
        }
      }
    }
  );
}

// ==================== 应用退出清理 ====================

/**
 * 取消活跃的写作智能体编排（应用退出时调用）。
 */
export function abortActiveWritingAgent(): void {
  const service = WritingAgentService.getInstance();
  if (service.running) {
    try {
      service.cancel();
      logger.info('Aborted active writing agent on shutdown');
    } catch (err) {
      logger.error(
        'Failed to abort writing agent on shutdown',
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  if (progressUnsubscribe) {
    progressUnsubscribe();
    progressUnsubscribe = null;
  }
}
