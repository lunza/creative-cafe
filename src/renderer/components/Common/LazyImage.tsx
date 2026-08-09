/**
 * LazyImage — 懒加载缩略图组件（Spec: optimize-system-rendering-performance / Task 6.1）
 *
 * ## 职责
 * 配合主进程 `thumbnail:get` IPC（Task 7）与渲染进程 `imageCache`（Task 8.1），
 * 将「全尺寸大图直显」替换为「滚动进入视口时按需加载压缩缩略图」，解决 AssetManagerModal
 * 素材网格（图片密集页）滚动卡顿问题。
 *
 * ## 工作流程
 * 1. IntersectionObserver 监听容器进入视口（rootMargin=200px 预加载，平滑滚动避免空白）
 * 2. 进入视口后：
 *    - 若 `src` 为 dataUrl（`data:` 前缀）：直接渲染 `<img src={dataUrl}>`，不走 IPC
 *      （对应「dataUrl-only 回退」场景：素材仅有 data URL 无磁盘路径时无法缩略图化）
 *    - 若 `src` 为磁盘路径：先查 `imageCache` 渲染 LRU；命中直接用；未命中调
 *      `thumbnail:get` IPC → 成功后写 `imageCache` 并渲染；失败显示错误占位 + 点击重试
 * 3. 加载中显示占位（默认灰底 + Spin；可自定义 `placeholder`）
 * 4. 图片 `onLoad` 触发淡入动画（opacity 0→1，transition 0.2s）
 *
 * ## dataUrl vs Blob URL（设计决策，最小实现优先）
 * thumbnail IPC 返回 dataUrl 字符串，可直接作 `<img src>`，**无需 Blob URL**。
 * 故本组件不做 Blob URL 创建/释放；dataUrl 为普通字符串，由 JS GC 回收。
 * 详见 `src/renderer/utils/imageCache.ts` 文件头说明。
 *
 * ## 虚拟列表回收
 * `src` prop 变化（虚拟化器回收卡片复用 DOM）时，重置内部状态并重新 observe。
 * 不在「滚出视口」时主动降级释放（dataUrl 为字符串，GC 处理；降级会增加复杂度，
 * 与最小实现优先冲突）。已通过 src 变化回收覆盖主要场景。
 *
 * ## React.memo
 * 按 `src` + `size` 浅比较；其余 props（alt/className/style/onClick/placeholder）
 * 由父级以稳定引用传入（与 AssetCard 的 useCallback 模式一致）。
 *
 * 参考：
 * - src/renderer/utils/imageCache.ts（渲染 LRU，Task 8.1）
 * - src/main/ipc/handlers/thumbnailHandlers.ts（thumbnail:get / thumbnail:invalidate）
 * - src/renderer/components/Character/utils/characterThumbnailCache.tsx（已有同类组件参考）
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Spin } from 'antd';
import { PictureOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  getCachedThumbnail,
  setCachedThumbnail,
} from '../../utils/imageCache';

/** 缩略图最大边长，与主进程 ThumbnailSize 对齐。 */
export type LazyImageSize = 256 | 384;

export interface LazyImageProps {
  /**
   * 图片源。两种形态：
   * - 磁盘绝对路径：走 `thumbnail:get` IPC 取压缩缩略图（推荐）
   * - dataUrl（`data:` 前缀）：直接渲染，不走 IPC（dataUrl-only 回退场景）
   * 空字符串/undefined：显示占位（等待 src 就绪，如路径异步解析中）
   */
  src: string | undefined;
  /** img alt 文本 */
  alt?: string;
  /** 缩略图最大边长，默认 256 */
  size?: LazyImageSize;
  /** 透传 className */
  className?: string;
  /** 透传 style（注意：会与组件内部淡入 opacity 合并） */
  style?: React.CSSProperties;
  /** 点击图片回调（用于「点击重试」与外层点击） */
  onClick?: () => void;
  /** 自定义占位节点；不传则使用默认灰底 + Spin */
  placeholder?: React.ReactNode;
}

/** IntersectionObserver rootMargin：提前 200px 预加载，平滑滚动。 */
const IO_ROOT_MARGIN = '200px';

/** 淡入过渡时长（ms）。 */
const FADE_DURATION_MS = 200;

/**
 * 调用 thumbnail:get IPC 获取缩略图 dataUrl。
 * 优先用 preload 暴露的 `thumbnail.get` 命名空间；不可用时回退通用 `invoke`。
 */
async function fetchThumbnail(
  sourcePath: string,
  size: LazyImageSize
): Promise<{ dataUrl?: string; error?: string }> {
  try {
    const api = (typeof window !== 'undefined' ? window.electronAPI : undefined) as any;
    if (api?.thumbnail?.get) {
      const res = await api.thumbnail.get({ sourcePath, size });
      if (res && res.error) return { error: res.error };
      return { dataUrl: res?.dataUrl };
    }
    if (api?.invoke) {
      // 回退：preload 未暴露 thumbnail 命名空间时走通用 invoke
      const res = await api.invoke('thumbnail:get', { sourcePath, size });
      if (res && res.error) return { error: res.error };
      return { dataUrl: res?.dataUrl };
    }
    return { error: 'electronAPI 不可用' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/** 默认占位：灰底 + Spin。 */
const DefaultPlaceholder: React.FC = () => (
  <div
    style={{
      width: '100%',
      height: '100%',
      minHeight: 40,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0f0f1a',
      color: 'var(--text-tertiary, #6b7280)',
    }}
  >
    <Spin size="small" />
  </div>
);

/** 错误占位：点击重试。 */
const ErrorPlaceholder: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <div
    onClick={(e) => {
      e.stopPropagation();
      onRetry();
    }}
    style={{
      width: '100%',
      height: '100%',
      minHeight: 40,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      background: '#0f0f1a',
      color: 'var(--text-tertiary, #6b7280)',
      cursor: 'pointer',
    }}
    title="点击重试加载"
  >
    <PictureOutlined style={{ fontSize: 20, opacity: 0.6 }} />
    <span style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 2 }}>
      <ReloadOutlined style={{ fontSize: 10 }} /> 重试
    </span>
  </div>
);

/**
 * LazyImage 组件实现。
 *
 * 内部状态：
 * - visible：是否进入视口（IntersectionObserver）
 * - imgSrc：已加载的图片源（dataUrl）；为 null 表示尚未加载
 * - loading：缩略图加载中
 * - error：加载失败（点击可重试）
 * - loaded：img onLoad 完成（触发淡入）
 *
 * src 变化时（虚拟化器回收）重置全部状态并重新 observe。
 */
const LazyImageInner: React.FC<LazyImageProps> = ({
  src,
  alt = '',
  size = 256,
  className,
  style,
  onClick,
  placeholder,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // 用于在重试时递增，触发加载 effect 重新执行
  const [retryToken, setRetryToken] = useState(0);

  const isDataUrl = typeof src === 'string' && src.startsWith('data:');
  const hasPathSrc = typeof src === 'string' && src.length > 0 && !isDataUrl;

  // ---- src 变化时重置内部状态（虚拟化器回收复用）----
  useEffect(() => {
    setVisible(false);
    setImgSrc(null);
    setLoading(false);
    setError(false);
    setLoaded(false);
    // 不重置 retryToken（避免额外渲染）；下方加载 effect 依赖 src 即可重新触发
  }, [src]);

  // ---- IntersectionObserver：进入视口（含 200px 预加载）后 setVisible ----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // 无 src（空/undefined）时不 observe，直接显示占位
    if (!src) return;
    if (typeof IntersectionObserver === 'undefined') {
      // SSR/不支持环境降级：直接可见
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect(); // 首次进入后不再监听（src 变化时由重置 effect + 本 effect 重建）
          }
        }
      },
      { rootMargin: IO_ROOT_MARGIN }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [src]);

  // ---- 加载缩略图（可见 && 有路径 && 未加载）----
  useEffect(() => {
    if (!visible) return;
    // dataUrl：直接用，不走 IPC
    if (isDataUrl && src) {
      setImgSrc(src);
      setLoading(false);
      setError(false);
      return;
    }
    if (!hasPathSrc || !src) return;
    if (imgSrc || loading) return; // 已加载或加载中，避免重复

    // 1. 先查渲染进程 LRU 缓存
    const cached = getCachedThumbnail(src, size);
    if (cached) {
      setImgSrc(cached);
      setLoading(false);
      setError(false);
      return;
    }

    // 2. 走 thumbnail:get IPC
    let cancelled = false;
    setLoading(true);
    setError(false);
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

    (async () => {
      const res = await fetchThumbnail(src, size);
      if (cancelled) return;
      setLoading(false);
      if (res.error || !res.dataUrl) {
        setError(true);
        return;
      }
      // 写入渲染 LRU，供后续滚动复用
      setCachedThumbnail(src, size, res.dataUrl);
      setImgSrc(res.dataUrl);

      // DEV 慢加载告警（>500ms）
      // 注：import.meta.env 由 Vite 注入，但项目未引用 vite/client 类型，
      // 故此处用 as any 访问以避免 TS 报错（dev 守卫为可选项，保持最小依赖）。
      const importMeta = import.meta as any;
      if (importMeta.env?.DEV && t0) {
        const elapsed = performance.now() - t0;
        if (elapsed > 500) {
          console.warn(`[LazyImage] slow thumbnail load (${Math.round(elapsed)}ms):`, src);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // retryToken 触发重试；imgSrc/loading 作为防重入守卫（不放入依赖，避免循环）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, src, size, isDataUrl, hasPathSrc, retryToken]);

  // ---- img onLoad：触发淡入 ----
  const handleLoad = useCallback(() => {
    setLoaded(true);
  }, []);

  // ---- 点击：错误时重试，否则透传 onClick ----
  const handleClick = useCallback(() => {
    if (error) {
      setError(false);
      setImgSrc(null);
      setLoaded(false);
      setRetryToken((t) => t + 1);
      return;
    }
    onClick?.();
  }, [error, onClick]);

  // ---- 渲染 ----
  const showPlaceholder = !imgSrc && !loaded;
  const showImage = !!imgSrc;

  return (
    <div
      ref={containerRef}
      className={className}
      onClick={handleClick}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        cursor: error ? 'pointer' : onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {showPlaceholder && (error ? (
        <ErrorPlaceholder onRetry={handleClick} />
      ) : (
        placeholder ?? <DefaultPlaceholder />
      ))}
      {showImage && (
        <img
          src={imgSrc}
          alt={alt}
          onLoad={handleLoad}
          // onError：若 img 加载失败（如 dataUrl 损坏），标记错误
          onError={() => {
            setLoaded(false);
            setError(true);
            setLoading(false);
          }}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: loaded ? 1 : 0,
            transition: `opacity ${FADE_DURATION_MS}ms ease`,
            display: 'block',
          }}
        />
      )}
    </div>
  );
};

/**
 * React.memo 包装：按 `src` + `size` 浅比较。
 * 其余 props（alt/className/style/onClick/placeholder）应由父级以稳定引用传入。
 */
export const LazyImage = React.memo(LazyImageInner, (prev, next) => {
  return prev.src === next.src && prev.size === next.size;
});
LazyImage.displayName = 'LazyImage';

export default LazyImage;
