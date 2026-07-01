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
  }, [filePath]);

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
  }, [filePath]);

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
