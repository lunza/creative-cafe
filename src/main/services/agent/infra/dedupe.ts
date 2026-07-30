/**
 * 去重缓存（Dedupe Cache）—— 照抄 openclaw src/infra/dedupe.ts 核心逻辑
 *
 * 来源：g:\AI\creative-cafe\sillytavern-source\openclaw-main\src\infra\dedupe.ts
 * 决策：照抄（spec §三）。openclaw 原版依赖 packages/normalization-core +
 *       shared/global-singleton + map-size，本项目无此依赖链，故将核心算法
 *       内联为自包含实现，保留 API 兼容（createDedupeCache）。
 *
 * 职责：
 *  1. 进程内 TTL + LRU 去重缓存
 *  2. check(key)：查重并记录（刷新 recency）
 *  3. peek(key)：仅查重不记录
 *  4. delete/clear/size：缓存管理
 *
 * 使用场景：
 *  - agentLoop 工具调用去重（避免同一工具在短时间内被重复调用）
 *  - dreaming 记忆去重（避免同一事实被反复写入）
 *  - cron 任务去重（避免同一任务被并发调度）
 *
 * 设计约束：
 *  - ttlMs <= 0 禁用过期检查（永久缓存）
 *  - maxSize <= 0 禁用存储（所有 check 返回 false）
 *  - check() 刷新 recency，活跃的重复突发保持 key 在 LRU 尾部
 *  - Map 的插入顺序即为 LRU 顺序（delete + set 实现 touch）
 */

/**
 * 去重缓存接口
 */
export interface DedupeCache {
  /** 查重并记录。返回 true 表示是最近出现过的重复；false 表示首次出现并已记录。 */
  check: (key: string | undefined | null, now?: number) => boolean;
  /** 仅查重，不记录、不刷新 recency。 */
  peek: (key: string | undefined | null, now?: number) => boolean;
  /** 删除指定 key。 */
  delete: (key: string | undefined | null) => void;
  /** 清空缓存。 */
  clear: () => void;
  /** 当前缓存条目数。 */
  size: () => number;
}

/**
 * 去重缓存配置
 */
export interface DedupeCacheOptions {
  /** TTL 毫秒（<=0 禁用过期检查） */
  ttlMs: number;
  /** 最大条目数（<=0 禁用存储，所有 check 返回 false） */
  maxSize: number;
}

/**
 * 将 Map 裁剪到 maxSize 以内（按插入顺序淘汰最早的，即 LRU）。
 */
function pruneMapToMaxSize(map: Map<string, number>, maxSize: number): void {
  while (map.size > maxSize) {
    const firstKey = map.keys().next().value;
    if (firstKey === undefined) break;
    map.delete(firstKey);
  }
}

/**
 * 创建有界的进程内去重缓存（TTL + LRU）。
 *
 * @param options.ttlMs TTL 毫秒（<=0 禁用）
 * @param options.maxSize 最大条目数（<=0 禁用存储）
 * @returns DedupeCache 实例
 */
export function createDedupeCache(options: DedupeCacheOptions): DedupeCache {
  const ttlMs = Math.max(0, Math.floor(Number.isFinite(options.ttlMs) ? options.ttlMs : 0) || 0);
  const maxSize = Math.max(0, Math.floor(Number.isFinite(options.maxSize) ? options.maxSize : 0) || 0);
  const cache = new Map<string, number>();

  const touch = (key: string, now: number): void => {
    cache.delete(key);
    cache.set(key, now);
  };

  const prune = (now: number): void => {
    const cutoff = ttlMs > 0 ? now - ttlMs : undefined;
    if (cutoff !== undefined) {
      for (const [entryKey, entryTs] of cache) {
        if (entryTs < cutoff) {
          cache.delete(entryKey);
        }
      }
    }
    if (maxSize <= 0) {
      cache.clear();
      return;
    }
    pruneMapToMaxSize(cache, maxSize);
  };

  const hasUnexpired = (key: string, now: number, touchOnRead: boolean): boolean => {
    const existing = cache.get(key);
    if (existing === undefined) return false;
    if (ttlMs > 0 && now - existing >= ttlMs) {
      cache.delete(key);
      return false;
    }
    if (touchOnRead) {
      // check() 刷新 recency，活跃的重复突发保持 key 在 LRU 尾部
      touch(key, now);
    }
    return true;
  };

  return {
    check: (key, now = Date.now()): boolean => {
      if (!key) return false;
      if (hasUnexpired(key, now, true)) return true;
      touch(key, now);
      prune(now);
      return false;
    },
    peek: (key, now = Date.now()): boolean => {
      if (!key) return false;
      return hasUnexpired(key, now, false);
    },
    delete: (key): void => {
      if (!key) return;
      cache.delete(key);
    },
    clear: (): void => {
      cache.clear();
    },
    size: (): number => cache.size,
  };
}

// ==================== 进程级全局缓存（防热路径重复加载） ====================

/**
 * 进程级全局单例缓存注册表。
 * 防止同一 symbol 对应的 DedupeCache 在模块多次加载时被重复创建。
 * 注：ES2020 WeakMap 不支持 symbol 键，改用 Map（symbol 通常为 Symbol.for() 全局符号，数量有限，无内存泄漏风险）。
 */
const globalDedupeRegistry = new Map<symbol, DedupeCache>();

/**
 * 获取进程全局 DedupeCache 单例。
 * 同一 symbol 始终返回同一实例（热路径防重复创建）。
 *
 * @param key 全局唯一标识（用 Symbol.for() 创建跨模块共享的 symbol）
 * @param options 首次创建时的配置（已存在则忽略）
 */
export function resolveGlobalDedupeCache(
  key: symbol,
  options: DedupeCacheOptions
): DedupeCache {
  let instance = globalDedupeRegistry.get(key);
  if (!instance) {
    instance = createDedupeCache(options);
    globalDedupeRegistry.set(key, instance);
  }
  return instance;
}
