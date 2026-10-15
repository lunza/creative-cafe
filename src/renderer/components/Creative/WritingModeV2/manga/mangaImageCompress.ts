/**
 * 漫画图片压缩工具（渲染层共享）
 *
 * 供 V2MangaMetaModal（人物参考图）与 V2MangaStage（单页/批量页面分析）复用：
 * 漫画单页 / 人物参考图常超过 8MB（Vision API 载荷上限），无损 PNG 尤甚。
 * 本模块用 canvas 等比重编码为 JPEG，把体积压到 8MB 以下且尽量保留细节，
 * 避免被主进程 8MB 校验拒收。
 *
 * 关键：必须用 img.decode() 而非 onload 后再 drawImage——onload 只保证字节加载完成，
 * 大图（如 11MB PNG）像素解码可能尚未就绪，drawImage 会抓到未解码像素导致内容错乱。
 */

// 与主进程 MAX_FILE_SIZE 一致：8MB 载荷上限
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** 估算 data URI 的原始字节数（base64 段长度 × 3/4） */
export const estimateBytesFromDataUri = (dataUri: string): number => {
  const commaIdx = dataUri.indexOf(',');
  return commaIdx >= 0 ? Math.floor(((dataUri.length - commaIdx - 1) * 3) / 4) : 0;
};

/**
 * 等比压缩图片到指定大小以下（canvas 重编码为 JPEG），并尽量保留细节。
 * 策略（为模型识别精度服务，避免过度压缩）：
 *  1. 保留原始分辨率（仅限制最大边 8192 防 OOM，不主动缩小）；
 *  2. 先试最高质量 1.0——若本就低于上限，直接采用（细节损失最小）；
 *  3. 否则在质量区间 [0.4, 1.0) 二分搜索，找到「能压进上限的最高质量」，
 *     即尽量把体积顶到接近上限（如 7.9MB），最大限度保留画面细节；
 *  4. 极端情况（最低质量仍超限）才等比缩小 0.75x 兜底。
 * 返回压缩后的 data URI；解码失败返回 null。
 */
export const compressImageToLimit = (dataUri: string, maxBytes: number): Promise<string | null> => {
  // 注意：调用方组件可能从 antd 导入了同名组件 Image，会遮蔽全局 DOM Image 构造函数，
  // 故用 document.createElement('img') 显式创建 <img> 元素
  const img = document.createElement('img');
  img.src = dataUri;
  // ⚠️ 关键：必须用 img.decode() 而非 onload。decode() 的 Promise 在「像素完全解码、
  // 可安全绘制」时才 resolve，从根源消除大图解码-绘制竞态导致的内容错乱。
  return img
    .decode()
    .then(() => {
      try {
        const MAX_DIM = 8192;
        const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, w, h);
        // 复用同一 canvas，仅改变 JPEG 质量重编码，避免每次重绘
        const render = (quality: number) => canvas.toDataURL('image/jpeg', quality);
        const sizeOf = (uri: string) => estimateBytesFromDataUri(uri);

        // 1. 最高质量 1.0 若本就低于上限，直接采用（最接近原图、细节损失最小）
        const full = render(1.0);
        if (sizeOf(full) <= maxBytes) return full;
        // 2. 二分搜索质量区间 [0.4, 1.0)，找能压进上限的最高质量（体积尽量接近上限）
        let lo = 0.4;
        let hi = 1.0;
        let best = full; // 兜底：若搜索中无一达标，退回最高质量结果
        for (let i = 0; i < 7; i++) {
          const mid = (lo + hi) / 2;
          const out = render(mid);
          if (sizeOf(out) <= maxBytes) {
            best = out;
            lo = mid; // 还能更高
          } else {
            hi = mid; // 太大，往下降
          }
        }
        if (sizeOf(best) <= maxBytes) return best;
        // 3. 极端情况：最低质量仍超限（超高分辨率）→ 等比缩小 0.75x 兜底
        canvas.width = Math.max(1, Math.round(w * 0.75));
        canvas.height = Math.max(1, Math.round(h * 0.75));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.9);
      } catch {
        return null;
      }
    })
    .catch(() => null);
};

/**
 * 读取本地图片为 data URI，超过 maxBytes 时自动等比压缩到上限以下。
 * 供 analyzePage 等「按文件路径分析」的场景使用：读取 → 超限则压缩 → 返回可直传 AI 的 data URI。
 * 读取或压缩失败返回 null。
 */
export const readImageAsDataUri = async (
  absolutePath: string,
  maxBytes: number = MAX_IMAGE_BYTES
): Promise<string | null> => {
  const result = await window.electronAPI.file.readAsBase64(absolutePath);
  if (!result?.success || !result.data) return null;
  if (estimateBytesFromDataUri(result.data) <= maxBytes) return result.data;
  return compressImageToLimit(result.data, maxBytes);
};
