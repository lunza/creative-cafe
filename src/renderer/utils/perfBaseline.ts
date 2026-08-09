/**
 * 性能基线测量工具 — 仅在 dev 模式生效，用于优化前后对比。
 * 详见 .trae/specs/optimize-system-rendering-performance/spec.md
 *
 * 提供：
 * - measureScrollFPS: 测量滚动平均帧间隔 / FPS / 长任务数
 * - measureFirstScreenComplete: 测量图片网格首屏完成时间
 * - startLongTaskObserver: 注册 longtask 观察者
 * - formatBaselineReport: 格式化基线报告
 *
 * 安全策略：生产环境（import.meta.env.DEV === false）或非浏览器环境
 * （typeof performance === 'undefined'）时所有函数 no-op / 返回零值，零性能开销。
 * 纯浏览器 Performance API，不依赖任何外部库。
 */

// ---------------------------------------------------------------------------
// Dev-mode + browser Performance API 可用性守卫
// ---------------------------------------------------------------------------

/**
 * 判断当前是否为 dev 模式。使用 optional chaining 兼容无 vite/client 类型声明的环境。
 */
function isDevMode(): boolean {
  try {
    return (import.meta as any).env?.DEV === true;
  } catch {
    return false;
  }
}

/**
 * 判断浏览器 Performance API 是否可用。
 */
function hasPerformanceAPI(): boolean {
  return (
    typeof performance !== 'undefined' &&
    typeof performance.mark === 'function' &&
    typeof performance.measure === 'function' &&
    typeof PerformanceObserver !== 'undefined'
  );
}

/** 两个守卫同时满足时测量工具才真正生效 */
const isActive = isDevMode() && hasPerformanceAPI();

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export interface ScrollFPSResult {
  /** 平均帧间隔（ms），越低越流畅 */
  avgFrameIntervalMs: number;
  /** 估算 FPS（每秒帧数），越高越流畅 */
  fps: number;
  /** 测量窗口内 >50ms 的长任务数量 */
  longTasks: number;
}

export interface FirstScreenResult {
  /** 第一张图片加载完成耗时（ms） */
  firstImageLoadMs: number;
  /** 所有可见图片（调用时在 DOM 中的）全部加载完成耗时（ms） */
  allVisibleLoadMs: number;
}

// ---------------------------------------------------------------------------
// 1. measureScrollFPS
// ---------------------------------------------------------------------------

/**
 * 测量滚动容器在指定时长内的平均帧间隔、FPS 与长任务数。
 *
 * 调用后请立即手动滚动目标容器，工具会在 durationMs 内通过 requestAnimationFrame
 * 采样帧间隔，同时用 PerformanceObserver 统计 longtask（>50ms）数量。
 *
 * @param scrollContainer 要测量的滚动容器元素
 * @param durationMs 测量时长，默认 2000ms
 * @returns 帧间隔 / FPS / 长任务数；非 dev 模式返回零值
 */
export async function measureScrollFPS(
  scrollContainer: HTMLElement,
  durationMs = 2000
): Promise<ScrollFPSResult> {
  const zero: ScrollFPSResult = { avgFrameIntervalMs: 0, fps: 0, longTasks: 0 };

  if (!isActive) return zero;
  // 校验容器存在且已挂载到 DOM
  if (!scrollContainer || !scrollContainer.isConnected) return zero;

  return new Promise<ScrollFPSResult>((resolve) => {
    const intervals: number[] = [];
    let longTaskCount = 0;
    let lastTs = 0;
    let rafId = 0;
    let observer: PerformanceObserver | null = null;
    let timeoutId = 0;

    const cleanup = () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (timeoutId) clearTimeout(timeoutId);
      if (observer) observer.disconnect();
    };

    // 在测量窗口内观察 longtask 条目
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'longtask') longTaskCount++;
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      // 某些浏览器不支持 longtask entryType，忽略即可
    }

    // 通过 requestAnimationFrame 采样帧间隔
    const sample = (ts: number) => {
      if (lastTs > 0) {
        const delta = ts - lastTs;
        if (delta > 0) intervals.push(delta);
      }
      lastTs = ts;
      rafId = requestAnimationFrame(sample);
    };
    rafId = requestAnimationFrame(sample);

    timeoutId = window.setTimeout(() => {
      cleanup();
      const count = intervals.length;
      const avg = count > 0 ? intervals.reduce((a, b) => a + b, 0) / count : 0;
      const fps = avg > 0 ? Math.round(1000 / avg) : 0;
      resolve({
        avgFrameIntervalMs: Math.round(avg * 100) / 100,
        fps,
        longTasks: longTaskCount,
      });
    }, durationMs);
  });
}

// ---------------------------------------------------------------------------
// 2. measureFirstScreenComplete
// ---------------------------------------------------------------------------

/**
 * 测量图片网格首屏完成时间。
 *
 * 在调用时对容器内所有 <img> 元素（即"当前可见"集合）注册 load 事件监听，
 * 记录第一张图片加载完成时间与全部图片加载完成时间。
 *
 * @param imageContainerSelector 包含 <img> 的容器 CSS 选择器
 * @returns firstImageLoadMs / allVisibleLoadMs；非 dev 模式返回零值
 */
export async function measureFirstScreenComplete(
  imageContainerSelector: string
): Promise<FirstScreenResult> {
  const zero: FirstScreenResult = { firstImageLoadMs: 0, allVisibleLoadMs: 0 };

  if (!isActive) return zero;

  performance.mark('firstScreenStart');

  const container = document.querySelector(imageContainerSelector);
  if (!container) {
    try {
      performance.measure('firstScreen', 'firstScreenStart');
    } catch {
      // mark 可能已被清理，忽略
    }
    return zero;
  }

  const imgs = Array.from(container.querySelectorAll<HTMLImageElement>('img'));
  if (imgs.length === 0) {
    try {
      performance.measure('firstScreen', 'firstScreenStart');
    } catch {
      // 忽略
    }
    return zero;
  }

  const startTs = performance.now();

  return new Promise<FirstScreenResult>((resolve) => {
    let firstLoadMs = 0;
    let remaining = imgs.length;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        performance.measure('firstScreen', 'firstScreenStart');
      } catch {
        // 忽略 measure 失败
      }
      resolve({
        firstImageLoadMs: Math.round(firstLoadMs),
        allVisibleLoadMs: Math.round(performance.now() - startTs),
      });
    };

    imgs.forEach((img) => {
      const handleLoad = () => {
        if (firstLoadMs === 0) {
          firstLoadMs = performance.now() - startTs;
        }
        remaining--;
        if (remaining <= 0) finish();
      };

      // 已加载完成的图片（缓存命中）立即处理
      if (img.complete && img.naturalWidth > 0) {
        handleLoad();
      } else {
        img.addEventListener('load', handleLoad, { once: true });
        img.addEventListener('error', handleLoad, { once: true });
      }
    });

    // 安全兜底：30 秒后强制结束，避免 Promise 永不 resolve
    window.setTimeout(finish, 30000);
  });
}

// ---------------------------------------------------------------------------
// 3. startLongTaskObserver
// ---------------------------------------------------------------------------

/**
 * 注册 longtask PerformanceObserver，返回 cleanup 函数。
 *
 * @param onLongTask 长任务回调，参数为持续时间（ms）
 * @returns cleanup 函数，调用后断开观察；非 dev 模式返回空函数
 */
export function startLongTaskObserver(
  onLongTask: (durationMs: number) => void
): () => void {
  if (!isActive) return () => {};

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'longtask') {
          onLongTask(Math.round(entry.duration));
        }
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
    return () => observer.disconnect();
  } catch {
    // PerformanceObserver 不可用或 longtask 不支持
    return () => {};
  }
}

// ---------------------------------------------------------------------------
// 4. formatBaselineReport
// ---------------------------------------------------------------------------

/**
 * 格式化基线报告为可读字符串，便于在 DevTools Console 中复制粘贴。
 *
 * @param report 任意键值对对象
 * @returns 多行字符串报告
 */
export function formatBaselineReport(report: object): string {
  const header = '===== 性能基线报告 (perfBaseline) =====';
  const footer = '=====================================';
  const lines = Object.entries(report).map(([key, value]) => {
    const formatted =
      typeof value === 'object' && value !== null
        ? JSON.stringify(value)
        : String(value);
    return `  ${key}: ${formatted}`;
  });
  return [header, ...lines, footer].join('\n');
}
