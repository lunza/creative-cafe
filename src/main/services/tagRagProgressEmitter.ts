/**
 * TagRagProgressEmitter — RAG 标签库向量化进度事件发射器
 *
 * 职责：
 *  封装 BrowserWindow.webContents.send 的安全调用，向渲染进程广播向量化进度。
 *
 * 降级策略：
 *  - 无窗口（getAllWindows 返回空数组）→ 仅写日志，不抛错
 *  - 窗口已销毁（webContents.destroyed）→ 跳过，仅写日志
 *  - send 异常 → 捕获并写日志，不影响主进程向量化流程
 *
 * 使用方式：
 *  tagRagProgressEmitter.emit({ phase: 'embedding', current: 100, total: 317600, ... });
 */
import { BrowserWindow } from 'electron';
import { createLogger } from './logger';
import type { TagRagProgressEvent } from '../../shared/types/tagRag.types';

const logger = createLogger('tag-rag-progress');

class TagRagProgressEmitter {
  /**
   * 广播进度事件到所有渲染进程窗口。
   *
   * @param event 进度事件载荷
   */
  emit(event: TagRagProgressEvent): void {
    try {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length === 0) {
        logger.warn('No browser windows available, progress event skipped:', event.phase, event.percentage);
        return;
      }
      for (const win of windows) {
        if (win.isDestroyed() || win.webContents.isDestroyed()) {
          continue;
        }
        win.webContents.send('tagRag:progress', event);
      }
    } catch (err) {
      logger.warn('Failed to emit progress event:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * 发射完成事件。
   */
  emitComplete(summary: { vectorized: number; failed: number; durationMs: number }): void {
    this.emit({
      phase: 'done',
      current: summary.vectorized,
      total: summary.vectorized,
      percentage: 100,
      failedCount: summary.failed,
      message: `向量化完成：成功 ${summary.vectorized} 条，失败 ${summary.failed} 条，耗时 ${Math.round(summary.durationMs / 1000)}s`,
    });
  }

  /**
   * 发射错误事件。
   */
  emitError(error: string): void {
    this.emit({
      phase: 'error',
      current: 0,
      total: 0,
      percentage: 0,
      failedCount: 0,
      error,
      message: `向量化失败：${error}`,
    });
  }

  /**
   * 发射取消事件。
   */
  emitCancelled(current: number, total: number): void {
    this.emit({
      phase: 'cancelled',
      current,
      total,
      percentage: total > 0 ? Math.round((current / total) * 100) : 0,
      failedCount: 0,
      message: `向量化已取消（已处理 ${current}/${total}）`,
    });
  }
}

/** 单例导出 */
export const tagRagProgressEmitter = new TagRagProgressEmitter();
