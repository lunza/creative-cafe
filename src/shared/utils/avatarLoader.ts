/**
 * 【Phase 3 / L3 - conversation-mode-optimization-report】头像加载器（R4）。
 *
 * 原两处 loadAvatar 流程合并（CreationCenter 收藏面板 + CharacterSelectorPanel 角色选择面板）：
 * - 图片文件路径 → readAsBase64 直接读取
 * - 角色卡路径 → character.read 取 avatar 字段，再经 resolveAvatarUrl 解析
 *   （data: 透传 / 嵌套路径读取 / 裸 base64 魔数补前缀）
 * 成功返回 data URL，失败返回 null（由调用方决定缓存/错误状态）。
 *
 * 注意：依赖 window.electronAPI，仅可在渲染进程调用。
 */
import { isImageFilePath, resolveAvatarUrl } from './imageUtils';

export async function loadCharacterAvatar(path: string): Promise<string | null> {
  try {
    if (isImageFilePath(path)) {
      const result = await window.electronAPI.file.readAsBase64(path);
      return result?.success && result.data ? result.data : null;
    }
    const content = await window.electronAPI.character.read(path);
    if (content?.avatar) {
      return await resolveAvatarUrl(content.avatar);
    }
    return null;
  } catch (err) {
    console.error('[avatarLoader] Avatar load failed for:', path, err);
    return null;
  }
}
