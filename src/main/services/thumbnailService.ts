/**
 * 缩略图管线服务 — 基于 Electron nativeImage（零新原生依赖）
 * Spec: .trae/specs/optimize-system-rendering-performance/spec.md Task 7
 *
 * ## 设计目标
 * 为主进程提供压缩缩略图生成 + 磁盘/内存两级缓存，供渲染进程通过 IPC 按需
 * 获取 data URL（CSP 兼容），避免渲染进程直接加载大图导致首屏掉帧。
 *
 * ## 选型理由（最小实现优先）
 * 优先采用 Electron 内置 `nativeImage`，零新原生依赖。
 * 若 nativeImage 缩略图质量不足，可切换至 sharp（需 electron-rebuild，
 * 受 Native Module Test Gap Convention 约束）。当前优先 nativeImage 以
 * 零新原生依赖满足"最小实现优先"。
 *
 * ## 输出格式选择
 * Electron `nativeImage.toDataURL()` 的 WebP 支持随版本/平台变化，不可靠；
 * 故采用稳妥策略：
 *   - PNG 源（可能含透明通道）→ 输出 PNG（toPNG，无损保留透明）
 *   - 其余（jpg/webp/bmp/gif 等照片类）→ 输出 JPEG（toJPEG(80)，体积小）
 * 以扩展名判定是否为 PNG（保守策略：不透明 PNG 也会输出 PNG，略大但正确）。
 * nativeImage 未暴露可靠的 alpha 通道检测 API，扩展名判定为当前最小实现。
 *
 * ## 缓存布局
 *   - 磁盘：{userData}/thumbnails/<sha1(sourcePath|mtimeMs|size)>.<jpg|png>
 *     缓存键含 mtime，图片被编辑后 mtime 变化自动失效。
 *   - 内存：LRU（lru-cache ^11，容量 200），key 同上，value={dataUrl,mime}，
 *     避免重复访问时反复读盘。命中顺序：内存 LRU → 磁盘 → 重新生成。
 *
 * ## 缓存失效
 * `invalidateThumbnail()` 为粗粒度实现：清空整个 thumbnails 目录 + 内存 LRU。
 * 原因：缓存键为内容哈希，无法由 sourcePath 反查缓存文件名；精细化失效需
 * 维护索引，与"最小实现优先"冲突，暂不实现。下次 getThumbnail 会重建。
 *
 * ⚠️ Native Module Test Gap Convention: nativeImage 为 Electron 运行时 API，
 * vitest 无法加载，本服务真实行为（resize/格式转换/缓存命中）依赖 Electron 集成测试补位。
 * 单测如需，应注入 fake nativeImage。
 */

import { nativeImage } from 'electron';
import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { LRUCache } from 'lru-cache';
import { getUserDataPath } from '../utils/appPath';

/** 缩略图最大边长（像素）。256 适用于网格列表，384 适用于较大预览。 */
export type ThumbnailSize = 256 | 384;

/** getThumbnail 返回结构。 */
export interface ThumbnailResult {
  /** 形如 `data:image/jpeg;base64,...` 的 data URL，可直接用于 <img src>（CSP 兼容） */
  dataUrl: string;
  /** MIME 类型，如 `image/jpeg` / `image/png` */
  mime: string;
  /** 是否来自缓存（内存或磁盘）。false 表示本次重新生成。 */
  fromCache: boolean;
}

/** 内存 LRU 缓存条目。 */
interface MemoryCacheEntry {
  dataUrl: string;
  mime: string;
}

class ThumbnailService {
  private readonly thumbnailDir: string;
  private readonly memoryCache: LRUCache<string, MemoryCacheEntry>;

  constructor() {
    this.thumbnailDir = path.join(getUserDataPath(), 'thumbnails');
    console.log('[ThumbnailService] Thumbnail cache directory:', this.thumbnailDir);
    this.ensureDirectoryExists();
    this.memoryCache = new LRUCache<string, MemoryCacheEntry>({ max: 200 });
  }

  /**
   * 确保缩略图缓存目录存在（同步，构造时调用一次）。
   * 使用 mkdirSync recursive，与 assetService/avatarService 的 ensure 模式一致。
   */
  private ensureDirectoryExists(): void {
    try {
      if (!fsSync.existsSync(this.thumbnailDir)) {
        fsSync.mkdirSync(this.thumbnailDir, { recursive: true });
        console.log('[ThumbnailService] Created thumbnail directory:', this.thumbnailDir);
      }
    } catch (error) {
      // 不抛异常，后续 getThumbnail 写缓存时会再次尝试 mkdir
      console.error('[ThumbnailService] ensureDirectoryExists failed:', error);
    }
  }

  /**
   * 计算缓存键：sha1(sourcePath + '|' + mtimeMs + '|' + size)。
   * 含 mtime 保证图片被编辑后缓存自动失效。
   */
  private computeCacheKey(sourcePath: string, mtimeMs: number, size: ThumbnailSize): string {
    const raw = `${sourcePath}|${mtimeMs}|${size}`;
    return crypto.createHash('sha1').update(raw, 'utf8').digest('hex');
  }

  /** 以扩展名判定源文件是否为 PNG（保守策略，PNG 一律保留为 PNG 输出）。 */
  private isPngSource(sourcePath: string): boolean {
    return path.extname(sourcePath).toLowerCase() === '.png';
  }

  /**
   * 生成或读取指定源图片的缩略图 data URL。
   *
   * 流程：
   *   1. 校验 sourcePath 存在；读取 stat.mtimeMs
   *   2. 计算 cacheKey；先查内存 LRU，命中直接返回
   *   3. 内存未命中查磁盘缓存文件，命中则读为 base64 data URL 并回填内存
   *   4. 磁盘未命中：nativeImage.createFromPath → isEmpty 校验 → 等比缩放（较大边=size）
   *      → toJPEG(80)/toPNG → 写磁盘 + 写内存
   *
   * @param sourcePath 源图片绝对路径
   * @param size 缩略图最大边长，默认 256
   * @throws 源文件不存在 / nativeImage 无法解码时抛 Error，由 IPC handler 兜底
   */
  async getThumbnail(
    sourcePath: string,
    size: ThumbnailSize = 256
  ): Promise<ThumbnailResult> {
    if (!sourcePath) {
      throw new Error('sourcePath 不能为空');
    }
    if (!fsSync.existsSync(sourcePath)) {
      throw new Error(`源文件不存在: ${sourcePath}`);
    }

    const stat = fsSync.statSync(sourcePath);
    const cacheKey = this.computeCacheKey(sourcePath, stat.mtimeMs, size);
    const usePng = this.isPngSource(sourcePath);
    const ext = usePng ? 'png' : 'jpg';
    const mime = usePng ? 'image/png' : 'image/jpeg';
    const cacheFilePath = path.join(this.thumbnailDir, `${cacheKey}.${ext}`);

    // 1. 内存 LRU 命中
    const memHit = this.memoryCache.get(cacheKey);
    if (memHit) {
      return { dataUrl: memHit.dataUrl, mime: memHit.mime, fromCache: true };
    }

    // 2. 磁盘缓存命中
    if (fsSync.existsSync(cacheFilePath)) {
      try {
        const buf = await fs.readFile(cacheFilePath);
        const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
        this.memoryCache.set(cacheKey, { dataUrl, mime });
        return { dataUrl, mime, fromCache: true };
      } catch (error) {
        // 缓存文件损坏等可恢复错误：降级为重新生成
        console.warn('[ThumbnailService] read cache file failed, regenerating:', error);
      }
    }

    // 3. 生成缩略图
    const image = nativeImage.createFromPath(sourcePath);
    if (image.isEmpty()) {
      throw new Error(`无法加载图片（可能格式不支持或文件损坏）: ${sourcePath}`);
    }

    // nativeImage.resize 不支持 fit，手动等比缩放使较大边 = size；
    // 较大边已 <= size 时不放大（避免无谓放大增加体积）。
    const originalSize = image.getSize();
    let resized = image;
    const longSide = Math.max(originalSize.width, originalSize.height);
    if (longSide > size) {
      const scale = size / longSide;
      const newWidth = Math.max(1, Math.round(originalSize.width * scale));
      const newHeight = Math.max(1, Math.round(originalSize.height * scale));
      resized = image.resize({ width: newWidth, height: newHeight, quality: 'best' });
    }

    const outBuf = usePng ? resized.toPNG() : resized.toJPEG(80);
    const dataUrl = `data:${mime};base64,${outBuf.toString('base64')}`;

    // 4. 写入磁盘缓存（失败仅告警，不阻断主流程）
    try {
      if (!fsSync.existsSync(this.thumbnailDir)) {
        fsSync.mkdirSync(this.thumbnailDir, { recursive: true });
      }
      await fs.writeFile(cacheFilePath, outBuf);
    } catch (error) {
      console.warn('[ThumbnailService] write cache file failed:', error);
    }

    // 5. 写入内存缓存
    this.memoryCache.set(cacheKey, { dataUrl, mime });

    return { dataUrl, mime, fromCache: false };
  }

  /**
   * 粗粒度失效：清空内存 LRU + 删除整个 thumbnails 目录内容。
   *
   * 缓存键为内容哈希，无法由 sourcePath 反查缓存文件名，故全量清除；
   * 目录在下次 getThumbnail 时按需重建。详见文件头「缓存失效」说明。
   */
  async invalidateThumbnail(): Promise<void> {
    this.memoryCache.clear();
    try {
      if (fsSync.existsSync(this.thumbnailDir)) {
        const files = await fs.readdir(this.thumbnailDir);
        await Promise.all(
          files.map(f =>
            fs.unlink(path.join(this.thumbnailDir, f)).catch(() => {
              /* 单文件删除失败不阻断整体失效 */
            })
          )
        );
        console.log(`[ThumbnailService] invalidateThumbnail: cleared ${files.length} files`);
      }
    } catch (error) {
      console.error('[ThumbnailService] invalidateThumbnail failed:', error);
    }
  }
}

/** 单例，与 assetService/avatarService 导出模式一致。 */
export const thumbnailService = new ThumbnailService();

/**
 * 生成或读取缩略图 data URL（standalone 包装，便于 IPC handler 直接导入）。
 * @param sourcePath 源图片绝对路径
 * @param size 缩略图最大边长（256 | 384），默认 256
 */
export function getThumbnail(
  sourcePath: string,
  size: ThumbnailSize = 256
): Promise<ThumbnailResult> {
  return thumbnailService.getThumbnail(sourcePath, size);
}

/**
 * 粗粒度清空全部缩略图缓存（内存 + 磁盘）。详见 thumbnailService.invalidateThumbnail。
 */
export function invalidateThumbnail(): Promise<void> {
  return thumbnailService.invalidateThumbnail();
}
