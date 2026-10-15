/**
 * 【Phase 3 / L2 - conversation-mode-optimization-report】Base64 图片处理工具（R3）。
 *
 * 原分散实现合并：
 * - isImageFilePath：CreationCenter.loadAvatar + CharacterSelectorPanel.loadAvatar 各自的扩展名判断
 * - toPngDataUrl / base64ToDataUrl：useImageGeneration 的 PNG_DATA_URI_PREFIX 拼接 +
 *   CreationCenter 的魔数识别（R0lG/JFIF/UklGR）
 * - resolveAvatarUrl：CreationCenter.loadAvatar 的 data: 透传 / 路径读取 / 裸 base64 补前缀逻辑
 *
 * 注意：resolveAvatarUrl 依赖 window.electronAPI，仅可在渲染进程调用。
 */

/** 判断文件路径是否为图片文件（png/jpg/jpeg/webp） */
export function isImageFilePath(path: string): boolean {
  return (
    path.endsWith('.png') ||
    path.endsWith('.jpg') ||
    path.endsWith('.jpeg') ||
    path.endsWith('.webp')
  );
}

export const PNG_DATA_URI_PREFIX = 'data:image/png;base64,';

/** 将裸 base64 字符串补全为 PNG data URL（已是 data URL 则原样返回） */
export function toPngDataUrl(base64: string): string {
  return base64.startsWith(PNG_DATA_URI_PREFIX) ? base64 : PNG_DATA_URI_PREFIX + base64;
}

/** 通过 base64 魔数识别图片类型并补全 data URL 前缀（裸 base64 输入） */
export function base64ToDataUrl(rawBase64: string): string {
  let imgType = 'png';
  if (rawBase64.includes('R0lG')) imgType = 'gif';
  else if (rawBase64.includes('JFIF') || rawBase64.includes('/9j/')) imgType = 'jpeg';
  else if (rawBase64.includes('UklGR')) imgType = 'webp';
  return `data:image/${imgType};base64,${rawBase64}`;
}

/**
 * 解析角色卡 avatar 字段为可直接用于 <img src> 的 data URL。
 * - data: 开头：原样返回
 * - 文件路径（含 /）：readAsBase64 读取
 * - 裸 base64（长度 > 100）：魔数识别补前缀
 */
export async function resolveAvatarUrl(avatar: string): Promise<string> {
  if (avatar.startsWith('data:')) return avatar;
  if (avatar.startsWith('/') || avatar.includes('/')) {
    const result = await window.electronAPI.file.readAsBase64(avatar);
    if (result?.success && result.data) return result.data;
    return avatar;
  }
  if (avatar.length > 100) return base64ToDataUrl(avatar);
  return avatar;
}
