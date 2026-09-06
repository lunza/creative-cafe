/**
 * 服务端 headless 对话图片生成管线（Spec: fix-android-chat-feature-parity / Task 5）
 *
 * 在 Electron 主进程中提供与桌面端 executeImageGeneration 核心路径一致的对话图片生成：
 *   定位父消息 → 情绪快照 → 读角色特征 traits.json（含权重）+ LoRA 清单
 *   → 父消息 emotion 动态表情标签注入（EMOTION_PROMPT_MAP + 冲突 tag 过滤，对齐 §7.43）
 *   → interaction 分类标签权重提升（会话配置 interaction_weight）
 *   → SD 配置/状态检查 → generateTxt2Img → 素材落盘（asset:save 同路径）
 *   → 更新消息 imageAttachment（history 追加 + usedTags/usedPrompt/usedLoras 快照）→ 持久化
 *
 * 与桌面端的差异（V2 范围边界，spec「明确不做」）：
 * - 不移植 AI 上下文标签生成（generateTraitPrompts）与 AI 标签优化（ai_optimize_traits）
 * - 无 sessionTraits 临时编辑（LAN 无此概念，直接读角色卡特征清单）
 * - 无视角镜头选择（{camera} 占位符替换为空）
 *
 * 复用说明：
 * - 表情标签动态替换逻辑对齐渲染进程 CharacterDialogueChat.executeImageGeneration
 *   （含 EXPRESSION_PROMPT_EXCLUDE_TAGS 冲突过滤集合）
 * - SD options 构建对齐渲染进程 buildSdOptionsFromConfig（此处内联精简版，避免跨进程别名依赖）
 */

import path from 'path';
import { characterService } from '../characterService';
import { chatStorageService } from '../ChatStorageService';
import { getStorageService } from '../storageService';
import { sdGenerationService, type SDGenerationOptions } from '../sdGenerationService';
import { assetService } from '../assetService';
import { characterTraitService } from '../characterTraitService';
import { characterLoraService } from '../characterLoraService';
import {
  EMOTION_PROMPT_MAP,
  buildAssetPromptTemplate,
} from '../../../renderer/components/Character/CharacterDialogueChat/PromptBuilder';
import type {
  ImageAttachment,
  ImageHistoryItem,
} from '../../../renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types';
import { sessionConfigStore } from './sessionConfigStore';

// ==================== 类型定义 ====================

export type ImageGenResult =
  | { ok: true; imageAttachment: ImageAttachment }
  | { ok: false; code: string; message: string; imageAttachment: ImageAttachment };

interface LanChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  emotion?: string;
  imageAttachment?: ImageAttachment;
  [key: string]: unknown;
}

/**
 * 表情标签冲突过滤集合（对齐桌面端 executeImageGeneration 的 EXPRESSION_PROMPT_EXCLUDE_TAGS）。
 * 情绪预置 prompt 中的背景/光效/全身姿势/视线类 tag 与特征清单的
 * background/pose 分类冲突，注入前过滤。
 */
const EXPRESSION_PROMPT_EXCLUDE_TAGS = new Set([
  // 背景类
  'simple_background', 'white_background', 'gradient_background', 'dark_background',
  'grey_background', 'pink_background', 'colorful_background', 'red_background',
  'pastel_background', 'blurred_background',
  // 光效/氛围
  'sunny', 'blue_sky', 'bokeh', 'soft_lighting', 'ambient_lighting', 'dim_lighting',
  'spotlight', 'light_rays', 'shining', 'depth_of_field', 'vignette', 'motion_blur',
  'speed_lines', 'shadow', 'dark_aura', 'light_particles', 'sunlight',
  // 背景装饰
  'petals', 'confetti', 'rain', 'flower', 'sun', 'light_bulb', 'steam', 'fire', 'lightning',
  // 全身姿势（与 pose 分类冲突）
  'standing', 'arms_at_sides', 'sitting', 'kneeling', 'jumping', 'cowering',
  'self_hug', 'curled_up', 'slouching', 'bowing', 'waving', 'arms_up',
  'v_sign', 'v', 'pointing', 'nodding', 'thumbs_up',
  // 视线方向（可能与对话图片视角冲突）
  'looking_at_viewer', 'looking_away', 'looking_down', 'looking_up', 'looking_sideways',
]);

const DEFAULT_NEGATIVE_PROMPT =
  'deformed, ugly, bad_anatomy, bad_hands, missing_fingers, extra_digits, low_quality, worst_quality, normal_quality, jpeg_artifacts, blurry, watermark';

/** 并发防护：同一消息同时只允许一次生成（key = characterFilePath::messageId） */
const inFlight = new Set<string>();

// ==================== 工具函数 ====================

/**
 * 从基础特征推断性别 tag（对齐渲染进程 buildSdOptions.detectGenderTag）。
 * 高分辨率（≥1024×1024）时用于注入人物数量约束（1girl/1boy）。
 */
function detectGenderTag(
  traits: Array<{ text: string; categoryId: string; enabled: boolean }>,
): '1girl' | '1boy' | null {
  const texts = traits.filter(t => t.categoryId === 'basic' && t.enabled).map(t => t.text.toLowerCase());
  if (texts.includes('1girl')) return '1girl';
  if (texts.includes('1boy')) return '1boy';
  if (texts.includes('female')) return '1girl';
  if (texts.includes('male')) return '1boy';
  if (texts.includes('girl')) return '1girl';
  if (texts.includes('boy')) return '1boy';
  return null;
}

/**
 * 构建 SD 生成选项（对齐渲染进程 buildSdOptionsFromConfig 的精简版）。
 * 差异：无视角镜头（dynamicCamera 恒 undefined，{camera} 由 applyTraitsAndLora 置空）。
 */
function buildLanSdOptions(params: {
  sdConfig: Record<string, any>;
  finalTraits: Array<{ text: string; weight?: number }>;
  allTraits: Array<{ text: string; categoryId: string; enabled: boolean }>;
  loras: Array<{ name: string; weight: number }>;
  width: number;
  height: number;
}): SDGenerationOptions {
  const { sdConfig, finalTraits, allTraits, loras, width, height } = params;

  // 高分辨率人物数量约束（≥1024×1024 时检测性别 tag，且基础特征未包含时注入）
  let characterGenderTag: string | undefined;
  if (width * height >= 1024 * 1024) {
    const genderTag = detectGenderTag(allTraits);
    if (genderTag) {
      const basicTexts = allTraits
        .filter(t => t.categoryId === 'basic' && t.enabled)
        .map(t => t.text.toLowerCase());
      if (!basicTexts.includes(genderTag)) {
        characterGenderTag = genderTag;
      }
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
    characterTraits: finalTraits,
    characterGenderTag,
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
    txt2imgWidth: width,
    txt2imgHeight: height,
    width,
    height,
    selectedLoras: loras,
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

/** 组装最终特征标签：情绪动态表情标签注入 + interaction 分类权重提升 */
function assembleFinalTraits(params: {
  traits: Array<{ text: string; weight?: number; categoryId?: string; enabled?: boolean }>;
  emotion: string;
  interactionWeight: number;
}): Array<{ text: string; weight?: number }> {
  const { traits, emotion, interactionWeight } = params;

  // 1. 取已启用特征（text/weight/categoryId），按 text 小写去重
  let enabled: Array<{ text: string; weight?: number; categoryId?: string }> = traits
    .filter(t => t.enabled !== false)
    .map(t => ({ text: t.text, weight: t.weight, categoryId: t.categoryId }))
    .filter((item, _i, arr) => {
      const key = item.text.trim().toLowerCase();
      return arr.findIndex(t => t.text.trim().toLowerCase() === key) === _i;
    });

  // 2. 情绪动态表情标签替换（对齐桌面端 §7.43 修复逻辑）：
  //    移除 expression 分类固定标签 → 注入 EMOTION_PROMPT_MAP[emotion] 过滤后的面部表情 tag；
  //    emotion 无预置映射（自定义情绪/default）时恢复原 expression 分类标签
  const hasExpressionTraits = enabled.some(t => t.categoryId === 'expression');
  if (hasExpressionTraits) {
    enabled = enabled.filter(t => t.categoryId !== 'expression');
  }
  const emotionPreset = EMOTION_PROMPT_MAP[emotion];
  if (emotionPreset?.positive) {
    const emotionTags = emotionPreset.positive
      .split(',')
      .map(t => t.trim())
      .filter(t => t && !EXPRESSION_PROMPT_EXCLUDE_TAGS.has(t));
    for (const tag of emotionTags) {
      const tagLower = tag.toLowerCase();
      if (!enabled.some(t => t.text.trim().toLowerCase() === tagLower)) {
        enabled.push({ text: tag, categoryId: 'expression' });
      }
    }
  } else if (hasExpressionTraits) {
    // 无预置映射：恢复原 expression 分类标签
    enabled.push(
      ...traits
        .filter(t => t.enabled !== false && t.categoryId === 'expression')
        .map(t => ({ text: t.text, weight: t.weight, categoryId: t.categoryId })),
    );
  }

  // 3. interaction 分类权重提升（对齐桌面端：weight = (per-tag weight ?? 1.0) × interactionWeight）
  if (interactionWeight !== 1.0) {
    return enabled.map(t => {
      if (t.categoryId === 'interaction') {
        const base = t.weight ?? 1.0;
        return { text: t.text, weight: Math.round(base * interactionWeight * 10) / 10 };
      }
      return { text: t.text, weight: t.weight };
    });
  }
  return enabled.map(t => ({ text: t.text, weight: t.weight }));
}

/** 读取素材 PNG 二进制（assetType 固定 general，对话图片统一落盘该目录） */
export async function readConversationAssetPng(
  characterFilePath: string,
  assetId: string,
): Promise<Buffer | null> {
  const fs = await import('fs/promises');
  const imagePath = await assetService.getAssetPath(characterFilePath, 'general', assetId);
  if (!imagePath) return null;
  try {
    return await fs.readFile(imagePath);
  } catch {
    return null;
  }
}

// ==================== 主流程 ====================

/**
 * 为指定消息生成对话图片（headless）。
 *
 * @param characterFilePath 角色卡绝对路径（白名单已校验）
 * @param messageId 目标消息 ID（assistant 消息；'greeting' 特例见内部处理）
 * @param regenerate true=复用已有 imageAttachment 追加 history；false=首次生成
 */
export async function generateConversationImage(
  characterFilePath: string,
  messageId: string,
  regenerate: boolean,
): Promise<ImageGenResult> {
  const flightKey = `${characterFilePath}::${messageId}`;
  if (inFlight.has(flightKey)) {
    throw Object.assign(new Error('该消息图片正在生成中'), { code: 'IMAGE_GENERATION_IN_PROGRESS' });
  }
  inFlight.add(flightKey);
  try {
    return await generateConversationImageInner(characterFilePath, messageId, regenerate);
  } finally {
    inFlight.delete(flightKey);
  }
}

async function generateConversationImageInner(
  characterFilePath: string,
  messageId: string,
  regenerate: boolean,
): Promise<ImageGenResult> {
  // ---- 1. 定位父消息（读存储，与桌面端同一会话数据） ----
  const savedChat = await chatStorageService.getTestChat(characterFilePath, characterFilePath);
  let messages: LanChatMessage[] = Array.isArray(savedChat?.messages)
    ? (savedChat!.messages as LanChatMessage[])
    : [];

  let parentMsg = messages.find(m => m.id === messageId) || null;

  // 特例：问候消息（id='greeting'）尚未持久化时，先补写入存储（对齐桌面端首次打开行为）
  if (!parentMsg && messageId === 'greeting' && messages.length === 0) {
    const card = await characterService.readCharacter(characterFilePath);
    const firstMes = card?.data?.first_mes;
    if (firstMes && String(firstMes).trim()) {
      parentMsg = { id: 'greeting', role: 'assistant', content: String(firstMes), timestamp: Date.now() };
      messages = [...messages, parentMsg];
    }
  }

  if (!parentMsg || parentMsg.role !== 'assistant') {
    throw Object.assign(new Error('目标消息不存在或不是 AI 消息'), { code: 'MESSAGE_NOT_FOUND' });
  }

  const emotionSnapshot = parentMsg.emotion || 'default';

  // ---- 2. 初始化/复用 imageAttachment 占位（generating 状态） ----
  // headless 为同步请求-响应模型，generating 占位不持久化（客户端以请求 pending 态展示 loading），
  // 仅在内存中构造基线，最终以 idle/error 状态一次性写回。
  const baseline: ImageAttachment = regenerate && parentMsg.imageAttachment
    ? { ...parentMsg.imageAttachment, emotion: emotionSnapshot, errorMessage: undefined }
    : {
        currentAssetId: '',
        emotion: emotionSnapshot,
        createdAt: Date.now(),
        history: [],
        currentIndex: -1,
      };

  // ---- 3. 读取会话配置 / 特征 / LoRA ----
  const sessionConfig = await sessionConfigStore.load(characterFilePath);
  const cp = sessionConfig.customParameters || {};
  const traitManifest = await characterTraitService.loadTraitData(characterFilePath);
  const loras = await characterLoraService.loadLoras(characterFilePath);

  const interactionWeight = typeof cp.interaction_weight === 'number' ? cp.interaction_weight : 1.2;
  const finalTraits = assembleFinalTraits({
    traits: traitManifest.traits || [],
    emotion: emotionSnapshot,
    interactionWeight,
  });

  // ---- 4. SD 配置与状态检查 ----
  const settings = getStorageService().getSettings() as Record<string, any>;
  const sdConfig: Record<string, any> = settings?.sdWebui || {};
  const endpoint: string = sdConfig.endpoint || '';
  if (!endpoint) {
    return fail(characterFilePath, messageId, baseline, 'SD_NOT_CONFIGURED', 'SD WebUI 未配置，请先在桌面端设置中配置端点');
  }

  let sdAvailable = false;
  try {
    const status = await sdGenerationService.checkStatus(endpoint);
    sdAvailable = status?.available === true;
  } catch { /* 视为不可用 */ }
  if (!sdAvailable) {
    return fail(characterFilePath, messageId, baseline, 'SD_UNAVAILABLE', 'SD WebUI 未连接或不可用，请检查服务状态');
  }

  // ---- 5. 组装提示词与选项（复用 general 模板：{traits}, {camera}, high quality, best quality） ----
  const promptTemplate = buildAssetPromptTemplate('general');
  const negativePrompt = sdConfig.negativePrompt || DEFAULT_NEGATIVE_PROMPT;
  const width = typeof cp.image_gen_width === 'number' ? cp.image_gen_width : 1024;
  const height = typeof cp.image_gen_height === 'number' ? cp.image_gen_height : 1024;

  const sdOptions = buildLanSdOptions({
    sdConfig,
    finalTraits,
    allTraits: traitManifest.traits || [],
    loras,
    width,
    height,
  });
  sdOptions.sourceContext = {
    source: 'conversation',
    messageId,
    characterCardId: characterFilePath,
    round: (parentMsg.imageAttachment?.history?.length || 0) + 1,
  };

  // ---- 6. 调用 SD 生成（服务内部含 120s 超时） ----
  const sdResult = await sdGenerationService.generateTxt2Img({
    endpoint,
    prompt: promptTemplate,
    negativePrompt,
    options: sdOptions,
  });

  if (!sdResult?.success || !sdResult.imageBase64) {
    return fail(characterFilePath, messageId, baseline, 'SD_GENERATION_FAILED', sdResult?.error || '图片生成失败');
  }

  // ---- 7. 素材落盘（失败回退 dataUrl 作 assetId，仅当前响应可用） ----
  const PNG_DATA_URI_PREFIX = 'data:image/png;base64,';
  const dataUrl = sdResult.imageBase64.startsWith(PNG_DATA_URI_PREFIX)
    ? sdResult.imageBase64
    : PNG_DATA_URI_PREFIX + sdResult.imageBase64;

  const assetId = `conv_${Date.now()}`;
  let savedAssetId = assetId;
  try {
    const saveResult = await assetService.saveAsset(characterFilePath, 'general', assetId, dataUrl);
    if (!saveResult?.success) {
      savedAssetId = dataUrl;
    }
  } catch {
    savedAssetId = dataUrl;
  }

  // ---- 8. 更新 imageAttachment（history 追加 + 快照） ----
  const historyItem: ImageHistoryItem = {
    assetId: savedAssetId,
    createdAt: Date.now(),
    usedTags: finalTraits,
    usedPrompt: sdResult.finalPrompt,
    usedNegativePrompt: negativePrompt,
    usedLoras: loras.map(l => ({ name: l.name, weight: l.weight })),
  };
  const newHistory = [...baseline.history, historyItem];
  const imageAttachment: ImageAttachment = {
    ...baseline,
    currentAssetId: savedAssetId,
    history: newHistory,
    currentIndex: newHistory.length - 1,
    status: 'idle',
    phase: undefined,
    errorMessage: undefined,
  };

  // ---- 9. 持久化（重新读一次存储避免与对话管线并发写覆盖） ----
  await persistImageAttachment(characterFilePath, messageId, imageAttachment);

  return { ok: true, imageAttachment };
}

/** 失败路径：置 error 状态并持久化（对齐桌面端占位保留重试语义，不损坏既有 history） */
async function fail(
  characterFilePath: string,
  messageId: string,
  baseline: ImageAttachment,
  code: string,
  message: string,
): Promise<ImageGenResult> {
  const imageAttachment: ImageAttachment = {
    ...baseline,
    status: 'error',
    phase: 'error',
    errorMessage: message,
  };
  // 持久化错误状态失败不影响错误响应返回
  try {
    await persistImageAttachment(characterFilePath, messageId, imageAttachment);
  } catch (persistErr) {
    console.warn('[LanImageGen] 错误状态持久化失败（忽略）:', persistErr);
  }
  return { ok: false, code, message, imageAttachment };
}

/** 将 imageAttachment 写回指定消息并保存整个会话 */
async function persistImageAttachment(
  characterFilePath: string,
  messageId: string,
  imageAttachment: ImageAttachment,
): Promise<void> {
  const saved = await chatStorageService.getTestChat(characterFilePath, characterFilePath);
  const messages: LanChatMessage[] = Array.isArray(saved?.messages)
    ? (saved!.messages as LanChatMessage[])
    : [];
  const idx = messages.findIndex(m => m.id === messageId);
  if (idx < 0) {
    // 消息不在存储（如 greeting 特例首次触发）：先补写 greeting 再更新
    if (messageId === 'greeting') {
      const card = await characterService.readCharacter(characterFilePath);
      const firstMes = card?.data?.first_mes;
      if (firstMes && String(firstMes).trim()) {
        messages.push({
          id: 'greeting',
          role: 'assistant',
          content: String(firstMes),
          timestamp: Date.now(),
        });
      } else {
        throw Object.assign(new Error('目标消息不存在'), { code: 'MESSAGE_NOT_FOUND' });
      }
    } else {
      throw Object.assign(new Error('目标消息不存在'), { code: 'MESSAGE_NOT_FOUND' });
    }
  }
  const target = messages.find(m => m.id === messageId)!;
  messages.splice(messages.indexOf(target), 1, { ...target, imageAttachment });

  // characterCardName 决定落盘文件名（sanitizeFileName），必须与 dialogue 管线保存时一致，
  // 否则会产生双文件脑裂；无已存记录时按 dialogue.ts 同样规则取卡名兜底。
  let cardName = saved?.characterCardName;
  if (!cardName) {
    const card = await characterService.readCharacter(characterFilePath);
    cardName = card?.data?.name || path.basename(characterFilePath, path.extname(characterFilePath));
  }

  const now = Date.now();
  await chatStorageService.saveTestChat({
    id: saved?.id || `test-chat-${now}`,
    creativeId: characterFilePath,
    characterCardId: characterFilePath,
    characterCardName: cardName,
    messages: messages as any,
    createdAt: saved?.createdAt || now,
    updatedAt: now,
  });
}
