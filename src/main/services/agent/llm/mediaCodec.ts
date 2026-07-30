/**
 * 媒体编解码器 —— 图像/音频 Base64 编解码
 *
 * 来源：spec §二 Task 6.2（mediaCodec.ts）
 * 决策：自研。openclaw 的 media 模块较重（含多种格式），本项目首期仅需
 *       图像 Base64 编解码（用于多模态消息中的 image_url）。
 *
 * 职责：
 *  1. 文件路径 → data URL（读取文件并编码为 base64 data URL）
 *  2. data URL → MIME + base64（解析 data URL 提取 MIME 和 base64 数据）
 *  3. 校验图像格式是否受支持
 *
 * 设计约束：
 *  - 仅在 Electron 主进程使用（fs.readFileSync）
 *  - 支持的格式：png / jpeg / gif / webp
 */

import fs from 'fs';
import path from 'path';

// ==================== 支持的图像格式 ====================

const SUPPORTED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// ==================== 编解码函数 ====================

/**
 * 将图像文件编码为 data URL。
 *
 * @param filePath 图像文件绝对路径
 * @returns data URL（如 data:image/png;base64,...）
 * @throws 如果文件不存在或格式不支持
 */
export function encodeImageFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`图像文件不存在: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = EXT_TO_MIME[ext];
  if (!mime) {
    throw new Error(`不支持的图像格式: ${ext}（支持 png/jpeg/gif/webp）`);
  }

  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');
  return `data:${mime};base64,${base64}`;
}

/**
 * 解析 data URL，提取 MIME 类型和 base64 数据。
 *
 * @param dataUrl data URL（如 data:image/png;base64,iVBOR...）
 * @returns { mime, base64 } 或 null（格式不合法时）
 */
export function decodeDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

/**
 * 检查 MIME 类型是否为受支持的图像格式。
 */
export function isSupportedImageMime(mime: string): boolean {
  return SUPPORTED_IMAGE_MIMES.has(mime);
}

/**
 * 从文件路径推断 MIME 类型。
 */
export function inferImageMime(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_MIME[ext];
}

/**
 * 批量编码图像文件为 data URL（用于多模态消息构建）。
 *
 * @param filePaths 图像文件路径数组
 * @returns data URL 数组（失败的文件跳过并记录警告）
 */
export function encodeImageFiles(filePaths: string[]): string[] {
  const results: string[] = [];
  for (const fp of filePaths) {
    try {
      results.push(encodeImageFile(fp));
    } catch (err) {
      console.warn(`[mediaCodec] 跳过无法编码的图像 ${fp}:`, err);
    }
  }
  return results;
}
