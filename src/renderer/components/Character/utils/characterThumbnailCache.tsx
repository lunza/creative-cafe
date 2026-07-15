import React, { useEffect, useState } from 'react';
import { LoadingOutlined, UserOutlined } from '@ant-design/icons';
import { LRUCache } from 'lru-cache';

/**
 * Character image thumbnail/avatar cache (LRU-bounded).
 *
 * Previously these were module-level `LimitedCache`/`Map` singletons defined
 * inline at the top of `CharacterManager.tsx` with no hard upper bound on the
 * `avatar*` maps. They have been extracted here and converted to LRU caches
 * (max 100 entries each) using the project's existing `lru-cache` (v11)
 * dependency to prevent unbounded memory growth when browsing many cards.
 */
const MAX_CACHE_SIZE = 100;

export const thumbnailCache = new LRUCache<string, string>({ max: MAX_CACHE_SIZE });
export const thumbnailErrorCache = new LRUCache<string, boolean>({ max: MAX_CACHE_SIZE });
export const avatarCache = new LRUCache<string, string>({ max: MAX_CACHE_SIZE });
export const avatarErrorCache = new LRUCache<string, boolean>({ max: MAX_CACHE_SIZE });

/**
 * 【重点标记 - 缓存失效 Bug 修复】
 * 发布-订阅机制：当角色卡图片被替换/删除/导入时，通过此机制通知正在显示的
 * ThumbnailImage/AvatarImage 组件清除旧缓存并重新从磁盘加载最新图片。
 *
 * 背景：LRU 缓存以 filePath 为键，角色卡编辑后文件路径不变但内容已变，
 * 若不主动失效，组件会持续显示旧的 base64 数据。
 */
const invalidationListeners = new Map<string, Set<() => void>>();

/**
 * 清除指定文件路径的所有图片缓存，并通知所有订阅该路径的组件重新加载。
 * 应在角色卡保存（图片替换）、删除、导入（覆盖同名文件）时调用。
 */
export function invalidateCharacterImageCache(filePath: string): void {
  thumbnailCache.delete(filePath);
  thumbnailErrorCache.delete(filePath);
  avatarCache.delete(filePath);
  avatarErrorCache.delete(filePath);
  const listeners = invalidationListeners.get(filePath);
  if (listeners) {
    listeners.forEach(cb => cb());
  }
}

/**
 * 订阅指定文件路径的缓存失效事件。返回取消订阅函数。
 * ThumbnailImage/AvatarImage 在挂载时调用此函数注册监听器，
 * 当 invalidateCharacterImageCache 被调用时触发重新加载。
 */
export function subscribeToImageInvalidation(filePath: string, callback: () => void): () => void {
  if (!invalidationListeners.has(filePath)) {
    invalidationListeners.set(filePath, new Set());
  }
  invalidationListeners.get(filePath)!.add(callback);
  return () => {
    invalidationListeners.get(filePath)?.delete(callback);
  };
}

interface ImageCacheLike<K, V> {
  get(key: K): V | undefined;
  has(key: K): boolean;
  set(key: K, value: V): void;
}

interface LoadOptions {
  dataCache: ImageCacheLike<string, string>;
  errorCache: ImageCacheLike<string, boolean>;
  filePath: string;
  setImageSrc: (value: string | null) => void;
  setLoading: (value: boolean) => void;
  setError: (value: boolean) => void;
  cancelledRef: () => boolean;
}

/**
 * Shared image-load routine used by both `ThumbnailImage` and `AvatarImage`.
 * Behavior is identical to the original implementation (3 retry attempts,
 * 5s timeout, error cache, success cache) — only the cache backend changed.
 */
function loadImage(opts: LoadOptions): () => void {
  const { dataCache, errorCache, filePath, setImageSrc, setLoading, setError, cancelledRef } = opts;

  let retryTimer: NodeJS.Timeout | null = null;
  let timeoutTimer: NodeJS.Timeout | null = null;

  const load = async (retryCount: number = 0) => {
    setLoading(true);
    setError(false);

    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = setTimeout(() => {
      if (!cancelledRef() && !dataCache.has(filePath)) {
        setLoading(false);
        setError(true);
        errorCache.set(filePath, true);
      }
    }, 5000);

    try {
      const result = await window.electronAPI.file.readAsBase64(filePath);
      if (!cancelledRef()) {
        if (result && result.success && result.data) {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          dataCache.set(filePath, result.data);
          setImageSrc(result.data);
          setLoading(false);
          setError(false);
          errorCache.set(filePath, false);
        } else if (retryCount < 2) {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          retryTimer = setTimeout(() => load(retryCount + 1), 500);
        } else {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          setLoading(false);
          setError(true);
          errorCache.set(filePath, true);
        }
      }
    } catch (error) {
      if (!cancelledRef()) {
        if (retryCount < 2) {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          retryTimer = setTimeout(() => load(retryCount + 1), 500);
        } else {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          setLoading(false);
          setError(true);
          errorCache.set(filePath, true);
        }
      }
    }
  };

  load();
  return () => {
    if (retryTimer) clearTimeout(retryTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
  };
}

export interface ThumbnailImageProps {
  filePath: string;
  name: string;
  size?: number;
}

export const ThumbnailImage: React.FC<ThumbnailImageProps> = React.memo(({ filePath, name, size = 60 }) => {
  const [imageSrc, setImageSrc] = useState<string | null>(thumbnailCache.get(filePath) || null);
  const [loading, setLoading] = useState(thumbnailCache.has(filePath) ? false : true);
  const [error, setError] = useState(thumbnailErrorCache.get(filePath) || false);
  // 【重点标记 - 缓存失效 Bug 修复】
  // refreshKey 在缓存失效事件触发时递增，使下方加载 useEffect 重新执行
  const [refreshKey, setRefreshKey] = useState(0);

  // 订阅缓存失效事件，filePath 变化时重新订阅
  useEffect(() => {
    return subscribeToImageInvalidation(filePath, () => {
      setRefreshKey(k => k + 1);
    });
  }, [filePath]);

  useEffect(() => {
    if (thumbnailCache.has(filePath)) {
      setImageSrc(thumbnailCache.get(filePath) || null);
      setLoading(false);
      setError(thumbnailErrorCache.get(filePath) || false);
      return;
    }

    let cancelled = false;
    const cleanup = loadImage({
      dataCache: thumbnailCache,
      errorCache: thumbnailErrorCache,
      filePath,
      setImageSrc,
      setLoading,
      setError,
      cancelledRef: () => cancelled,
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [filePath, refreshKey]);

  if (loading) {
    return (
      <div style={{ width: size, height: size, borderRadius: 4, backgroundColor: 'var(--bg-container, #1f1f1f)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoadingOutlined style={{ fontSize: 16, color: '#999' }} spin />
      </div>
    );
  }

  if (error || !imageSrc) {
    return (
      <div style={{ width: size, height: size, borderRadius: 4, backgroundColor: 'var(--bg-container, #1f1f1f)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <UserOutlined style={{ fontSize: 24, color: '#999' }} />
      </div>
    );
  }

  return (
    <img
      src={imageSrc}
      alt={name}
      style={{ width: size, height: size, borderRadius: 4, objectFit: 'cover' }}
    />
  );
});
ThumbnailImage.displayName = 'ThumbnailImage';

export interface AvatarImageProps {
  filePath: string;
  name: string;
  fallbackSrc?: string;
}

export const AvatarImage: React.FC<AvatarImageProps> = React.memo(({ filePath, name, fallbackSrc }) => {
  const [imageSrc, setImageSrc] = useState<string | null>(avatarCache.get(filePath) || null);
  const [loading, setLoading] = useState(avatarCache.has(filePath) ? false : true);
  const [error, setError] = useState(avatarErrorCache.get(filePath) || false);
  // 【重点标记 - 缓存失效 Bug 修复】
  // refreshKey 在缓存失效事件触发时递增，使下方加载 useEffect 重新执行
  const [refreshKey, setRefreshKey] = useState(0);

  // 订阅缓存失效事件，filePath 变化时重新订阅
  useEffect(() => {
    return subscribeToImageInvalidation(filePath, () => {
      setRefreshKey(k => k + 1);
    });
  }, [filePath]);

  useEffect(() => {
    if (avatarCache.has(filePath)) {
      setImageSrc(avatarCache.get(filePath) || null);
      setLoading(false);
      setError(avatarErrorCache.get(filePath) || false);
      return;
    }

    let cancelled = false;
    const cleanup = loadImage({
      dataCache: avatarCache,
      errorCache: avatarErrorCache,
      filePath,
      setImageSrc,
      setLoading,
      setError,
      cancelledRef: () => cancelled,
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [filePath, refreshKey]);

  if (loading) {
    return (
      <div style={{ flex: '0 0 200px', borderRadius: 12, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)', minHeight: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-container, #1f1f1f)' }}>
        <LoadingOutlined style={{ fontSize: 24, color: '#999' }} spin />
      </div>
    );
  }

  const src = imageSrc || fallbackSrc;
  if (error || !src) {
    return null;
  }

  return (
    <div style={{ flex: '0 0 200px', borderRadius: 12, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)' }}>
      <img
        src={src}
        alt={name}
        style={{ width: '100%', height: 'auto', objectFit: 'cover' }}
      />
    </div>
  );
});
AvatarImage.displayName = 'AvatarImage';

export default ThumbnailImage;
