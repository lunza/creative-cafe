/**
 * 缩略图管线 IPC 处理器（Spec: optimize-system-rendering-performance / Task 7）
 *
 * 通道列表：
 *   - thumbnail:get          生成/读取缩略图 data URL（命中内存→磁盘→重新生成）
 *   - thumbnail:invalidate   粗粒度清空全部缩略图缓存（内存 LRU + 磁盘目录）
 *
 * 注册模式参照 registerAssetHandlers()：导出 registerThumbnailHandlers() 函数，
 * 由 src/main/ipc/index.ts 的 setupIpcHandlers() 调用。
 *
 * 错误处理：service 内部对不可恢复错误（源文件不存在 / nativeImage 无法解码）抛异常，
 * 外层 handler try/catch 兜底，返回 `{ error: string }` 形态，不向渲染进程抛异常。
 *
 * ⚠️ Native Module Test Gap Convention: 依赖 nativeImage（Electron 运行时 API），
 * 真实行为依赖 Electron 集成测试，vitest 无法覆盖。
 */
import { ipcMain } from 'electron';
import { getThumbnail, invalidateThumbnail } from '../../services/thumbnailService';

export function registerThumbnailHandlers() {
  /**
   * 生成或读取指定源图片的缩略图 data URL。
   *
   * @param args.sourcePath 源图片绝对路径
   * @param args.size       缩略图最大边长（256 | 384，默认 256）
   * @returns 成功：{ dataUrl, mime, fromCache }；失败：{ error }
   *
   * 返回的 dataUrl 可直接用于 <img src>（CSP 兼容，无需渲染进程再读盘）。
   */
  ipcMain.handle(
    'thumbnail:get',
    async (_event, args: { sourcePath: string; size?: 256 | 384 }) => {
      try {
        if (!args?.sourcePath) {
          return { error: 'sourcePath 不能为空' };
        }
        const result = await getThumbnail(args.sourcePath, args.size ?? 256);
        return result;
      } catch (error) {
        console.error('[ThumbnailHandler] get failed:', error);
        return {
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * 粗粒度清空全部缩略图缓存（内存 LRU + 磁盘 thumbnails 目录内容）。
   * 缓存键为内容哈希，无法按 sourcePath 精细失效，故全量清除，下次访问时重建。
   */
  ipcMain.handle('thumbnail:invalidate', async () => {
    try {
      await invalidateThumbnail();
      return { ok: true };
    } catch (error) {
      console.error('[ThumbnailHandler] invalidate failed:', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
