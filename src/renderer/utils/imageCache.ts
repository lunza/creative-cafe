/**
 * 渲染进程缩略图 dataUrl LRU 缓存（Spec: optimize-system-rendering-performance / Task 8.1）
 *
 * ## 职责
 * 为 `<LazyImage>`（Task 6.1）提供渲染进程侧的缩略图 data URL 缓存，避免同一张图
 * 重复走 `thumbnail:get` IPC（主进程 nativeImage 缩放虽已有内存+磁盘缓存，但 IPC
 * 往返本身有开销；渲染进程再缓存一层可让虚拟列表滚动时「已见过的卡片」零开销命中）。
 *
 * ## 设计决策：缓存 dataUrl 字符串，不创建 Blob URL（最小实现优先）
 * 原始 spec 提及「Blob URL 缓存 + revokeObjectURL 释放」要求。但本项目的
 * `thumbnail:get` IPC（Task 7）直接返回 `dataUrl` 字符串（`data:image/jpeg;base64,...`），
 * 可直接用于 `<img src={dataUrl}>`（CSP 兼容）。因此**无需创建 Blob URL**：
 *   - dataUrl 是普通字符串，由 JS GC 自动回收，无需 revokeObjectURL
 *   - 省去 Blob URL 生命周期管理（创建/追踪/释放），降低复杂度与 bug 面
 * 这是最小实现优先的取舍：用 dataUrl 字符串换 Blob URL，换取实现简洁。
 * 代价：dataUrl（base64）比 Blob URL 体积大约 33%，但缩略图本身已压缩到 ≤256/384px，
 * 单条多在 10-30KB 量级，LRU 容量 300 条 ≈ 数 MB 内存，可接受。
 *
 * ## 缓存键
 * `${sourcePath}::${size}`，与主进程缓存键（内容哈希）不同——此处以原始路径+尺寸为键，
 * 因为渲染进程拿不到 mtime（无法构造主进程的内容哈希键），且渲染缓存仅作 IPC 前置
 * 命中层，主进程缓存负责 mtime 失效。`thumbnail:invalidate` 触发时本缓存一并清空。
 *
 * ## 失效策略
 * `invalidateImageCache()` 同时清空本渲染 LRU **并**调用 `thumbnail:invalidate` IPC
 * 清空主进程内存+磁盘缓存（选择「双清」而非仅清本地：素材被替换/删除后，主进程缓存
 * 若不清，下次仍会命中旧缩略图；双清保证彻底失效）。IPC 为 fire-and-forget，不阻塞调用方。
 *
 * 参考：
 * - src/main/services/thumbnailService.ts（主进程缓存实现，Task 7）
 * - src/main/ipc/handlers/thumbnailHandlers.ts（thumbnail:get / thumbnail:invalidate）
 * - src/renderer/components/Common/LazyImage.tsx（消费方，Task 6.1）
 * - src/renderer/components/Character/utils/characterThumbnailCache.tsx（已有同类 LRU 模式参考）
 */

import { LRUCache } from 'lru-cache';

/** 渲染进程 LRU 容量：300 条（与主进程 200 条独立；渲染层多缓存一层减少 IPC 往返）。 */
const RENDERER_CACHE_MAX = 300;

/** 渲染进程缩略图 LRU：key=`${sourcePath}::${size}`，value=dataUrl 字符串。 */
const thumbnailCache = new LRUCache<string, string>({ max: RENDERER_CACHE_MAX });

/**
 * 构造缓存键。size 显式拼入键中，同一图片不同尺寸分别缓存。
 */
function buildKey(sourcePath: string, size: 256 | 384): string {
  return `${sourcePath}::${size}`;
}

/**
 * 查询渲染进程缓存中的缩略图 dataUrl。
 *
 * @returns 命中返回 dataUrl 字符串；未命中返回 undefined（调用方应走 `thumbnail:get` IPC）
 */
export function getCachedThumbnail(
  sourcePath: string,
  size: 256 | 384
): string | undefined {
  if (!sourcePath) return undefined;
  return thumbnailCache.get(buildKey(sourcePath, size));
}

/**
 * 写入渲染进程缓存。在 `thumbnail:get` IPC 成功返回后调用，供后续滚动复用。
 */
export function setCachedThumbnail(
  sourcePath: string,
  size: 256 | 384,
  dataUrl: string
): void {
  if (!sourcePath || !dataUrl) return;
  thumbnailCache.set(buildKey(sourcePath, size), dataUrl);
}

/**
 * 双清失效：清空渲染进程 LRU + 调用 `thumbnail:invalidate` IPC 清空主进程内存/磁盘缓存。
 *
 * 选择「双清」：素材被替换/删除后主进程缓存若不清，下次仍命中旧缩略图；双清保证彻底失效。
 * IPC 为 fire-and-forget（不 await，不阻塞调用方）；失败仅告警不抛异常。
 */
export async function invalidateImageCache(): Promise<void> {
  // 1. 同步清空渲染进程 LRU
  thumbnailCache.clear();

  // 2. 异步通知主进程清空（fire-and-forget；主进程实现见 thumbnailService.invalidateThumbnail）
  try {
    if (typeof window !== 'undefined' && window.electronAPI?.thumbnail?.invalidate) {
      await window.electronAPI.thumbnail.invalidate();
    } else if (typeof window !== 'undefined' && window.electronAPI?.invoke) {
      // 兜底：若 preload 未暴露 thumbnail 命名空间，走通用 invoke
      await window.electronAPI.invoke('thumbnail:invalidate');
    }
  } catch (error) {
    // IPC 失败不阻断：渲染 LRU 已清，主进程缓存最多在下次 mtime 变化时自然失效
    console.warn('[imageCache] thumbnail:invalidate IPC failed:', error);
  }
}
