import type { CharacterTraitItem } from '@shared/types';
import type { SDGenerationOptions } from '@main/services/sdGenerationService';

/**
 * 从基础特征推断性别 tag（Spec: fix-conversation-image-generation-bugs / Bug 5）
 * 提取自 AssetGenerateModal，供 AssetGenerateModal 和对话图片生成共同复用。
 */
export function detectGenderTag(traits: CharacterTraitItem[]): '1girl' | '1boy' | null {
  const basicTraits = traits.filter((t) => t.categoryId === 'basic' && t.enabled);
  const texts = basicTraits.map((t) => t.text.toLowerCase());

  if (texts.includes('1girl')) return '1girl';
  if (texts.includes('1boy')) return '1boy';
  if (texts.includes('female')) return '1girl';
  if (texts.includes('male')) return '1boy';
  if (texts.includes('girl')) return '1girl';
  if (texts.includes('boy')) return '1boy';

  return null;
}

/**
 * SD 生成选项的依赖参数（Spec: fix-conversation-image-generation-bugs / Bug 5）
 */
export interface BuildSdOptionsParams {
  /** SD WebUI 设置对象 */
  sdConfig: any;
  /** 已启用的角色特征 tag 数组（已过滤、去重） */
  enabledTraitTexts: Array<{ text: string; weight?: number }>;
  /** 完整的特征列表（含 disabled 项，用于 detectGenderTag 推断） */
  effectiveTraits: CharacterTraitItem[];
  /** 角色 LoRA 列表 */
  characterLoras: any[];
  /** 图片尺寸 */
  selectedSize: { width: number; height: number };
  /** 视角镜头 tag（可选） */
  selectedCameraAngle?: string;
}

/**
 * 构建 SD 生成选项（传给 IPC 的 options 字段）（Spec: fix-conversation-image-generation-bugs / Bug 5）
 * 提取自 AssetGenerateModal.buildSdOptions，供 AssetGenerateModal 和对话图片生成共同复用。
 */
export function buildSdOptionsFromConfig(params: BuildSdOptionsParams): SDGenerationOptions {
  const { sdConfig, enabledTraitTexts, effectiveTraits, characterLoras, selectedSize, selectedCameraAngle } = params;

  // 高分辨率人物数量约束检测
  let characterGenderTag: string | undefined;
  const pixelCount = selectedSize.width * selectedSize.height;
  if (pixelCount >= 1024 * 1024) {
    const genderTag = detectGenderTag(effectiveTraits);
    if (genderTag) {
      const basicTraitTexts = effectiveTraits
        .filter((t) => t.categoryId === 'basic' && t.enabled)
        .map((t) => t.text.toLowerCase());
      if (!basicTraitTexts.includes(genderTag)) {
        characterGenderTag = genderTag;
      }
    } else {
      console.warn('[buildSdOptionsFromConfig] 无法从基础特征推断性别，跳过人物数量约束注入');
    }
  }

  return {
    endpoint: sdConfig.endpoint,
    denoisingStrength: sdConfig.denoisingStrength,
    steps: sdConfig.steps,
    cfgScale: sdConfig.cfgScale,
    sampler: sdConfig.sampler,
    scheduler: sdConfig.scheduler,
    clipSkip: sdConfig.clipSkip,
    adetailerEnabled: sdConfig.adetailerEnabled,
    model: sdConfig.model || undefined,
    characterTraits: enabledTraitTexts,
    characterGenderTag,
    dynamicCamera: selectedCameraAngle?.trim() || undefined,
    adModel: sdConfig.adModel,
    adConfidence: sdConfig.adConfidence,
    adDenoisingStrength: sdConfig.adDenoisingStrength,
    adMaskBlur: sdConfig.adMaskBlur,
    adDilateErode: sdConfig.adDilateErode,
    adInpaintOnlyMasked: sdConfig.adInpaintOnlyMasked,
    adInpaintOnlyMaskedPadding: sdConfig.adInpaintOnlyMaskedPadding,
    adUseInpaintWidthHeight: sdConfig.adUseInpaintWidthHeight,
    adInpaintWidth: sdConfig.adInpaintWidth,
    adInpaintHeight: sdConfig.adInpaintHeight,
    adUseSteps: sdConfig.adUseSteps,
    adSteps: sdConfig.adSteps,
    adUseCfgScale: sdConfig.adUseCfgScale,
    adCfgScale: sdConfig.adCfgScale,
    adUseSampler: sdConfig.adUseSampler,
    adSampler: sdConfig.adSampler,
    adScheduler: sdConfig.adScheduler,
    adNegativePrompt: sdConfig.adNegativePrompt,
    adUseNoiseMultiplier: sdConfig.adUseNoiseMultiplier,
    adNoiseMultiplier: sdConfig.adNoiseMultiplier,
    adModelClasses: sdConfig.adModelClasses,
    modelType: sdConfig.modelType,
    txt2imgWidth: selectedSize.width,
    txt2imgHeight: selectedSize.height,
    width: selectedSize.width,
    height: selectedSize.height,
    selectedLoras: characterLoras,
    hrFixEnabled: sdConfig.hrFixEnabled,
    hrUpscaler: sdConfig.hrUpscaler,
    hrSteps: sdConfig.hrSteps,
    hrScale: sdConfig.hrScale,
    hrDenoisingStrength: sdConfig.hrDenoisingStrength,
    hrPrompt: sdConfig.hrPrompt,
    hrNegativePrompt: sdConfig.hrNegativePrompt,
    hrCfg: sdConfig.hrCfg,
    hrSamplerName: sdConfig.hrSamplerName,
    hrScheduler: sdConfig.hrScheduler,
    img2imgExtraNoise: sdConfig.img2imgExtraNoise,
    initialNoiseMultiplier: sdConfig.initialNoiseMultiplier,
    img2imgHiresMode: sdConfig.img2imgHiresMode,
  };
}
