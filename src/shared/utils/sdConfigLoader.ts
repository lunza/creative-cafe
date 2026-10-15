/**
 * 【Phase 3 / L3 - conversation-mode-optimization-report】SD 配置加载器（R4）。
 *
 * 原两处内联实现合并（setting.load + sdWebui 提取 + 失败兜底空配置）：
 * - useImageGeneration.executeImageGeneration（对话图片生成）
 * - AssetGenerateModal（素材生成弹窗）
 *
 * 注意：依赖 window.electronAPI，仅可在渲染进程调用。
 */

/** 加载 SD WebUI 配置；失败或不存在时返回空对象（调用方自行决定兜底值） */
export async function loadSdWebuiConfig(): Promise<Record<string, any>> {
  try {
    const result = await window.electronAPI.setting.load();
    if (result?.success && result.setting?.sdWebui) {
      return result.setting.sdWebui;
    }
  } catch (e) {
    console.warn('[sdConfigLoader] 加载 SD 设置失败:', e);
  }
  return {};
}
