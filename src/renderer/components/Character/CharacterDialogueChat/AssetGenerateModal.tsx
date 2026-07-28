// Spec: add-asset-and-trait-management / Task 10
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Progress,
  Button,
  Alert,
  Spin,
  Image,
  Input,
  Tag,
  Space,
  Tooltip,
  message,
} from 'antd';
import {
  ThunderboltOutlined,
  RobotOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  SettingOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import {
  EMOTION_PRESETS,
  buildExpressionGenerationPrompt,
  buildNLExpressionPrompt,
} from './PromptBuilder';
import { useExpressionStore } from '../../../stores/expressionStore';
import { useAssetStore } from '../../../stores/assetStore';
import { useSettingStore } from '../../../stores/settingStore';
import type { SDWebuiConfig } from '../../../types/setting';
import LoraSelectModal from './LoraSelectModal';

/**
 * AI 素材生成弹窗（Spec: add-asset-and-trait-management / Task 10）
 *
 * 职责：
 * - 扩展自 ExpressionGenerateModal，支持四种素材类型生成：
 *   - batch-expression：批量生成 30 个预置情绪表情（沿用原 ExpressionGenerateModal 逻辑）
 *   - single-expression：生成单个情绪表情（沿用原逻辑）
 *   - illustration：生成角色立绘（full body, standing）
 *   - general：生成一般场景图像（userScene 由用户输入）
 *   - three-view：生成三视图（front / side / back，由 targetSlot 指定）
 * - 所有生成都自动携带角色特征（characterTraits），通过 `window.electronAPI.characterTrait.list`
 *   读取后传入 `sd.generateExpression` 的 options.characterTraits 字段
 * - 生成成功后根据 mode 调用对应 store 保存：
 *   - 表情模式 → expressionStore.saveExpression
 *   - 立绘 / 一般图像 / 三视图 → assetStore.saveAsset
 *
 * 数据流：
 *   打开弹窗 → 加载 SD 设置 / 读取 characterTraits / 检测 SD 状态
 *   → 根据 mode 构建提示词模板（含 {traits} 占位符）
 *   → 用户点击「开始生成」
 *   → 调用 `window.electronAPI.sd.generateExpression`（复用表情生成 IPC，
 *     emotionKey 传占位值，实际提示词由 prompt 字段控制）
 *   → 监听 `sd:generationProgress` / `sd:generationComplete` 事件（仅 batch 模式）
 *   → 单次模式：等待 Promise resolve，展示结果预览
 *   → 完成后调用 onGenerated?.() 通知父组件刷新
 *
 * 【重点标记 - 复用 sd.generateExpression IPC】
 * Task 10 实现约束：不新增 IPC。原 `sd:generateExpression` 的 emotionKey 仅用于日志，
 * 实际生成由 prompt 字段控制（sdGenerationService.generateExpression 接收预构建 prompt）。
 * 因此非表情模式（illustration / general / three-view）复用此 IPC，emotionKey 传 'neutral'
 * 占位值，prompt 由本组件按 mode 构建模板。
 *
 * 【重点标记 - 特征携带机制】
 * 组件打开时通过 `window.electronAPI.characterTrait.list(characterCardId)` 读取角色特征，
 * 存入 state。buildSdOptions 时透传到 options.characterTraits，由 sdGenerationService 内部
 * 替换提示词模板中的 {traits} 占位符（与 ExpressionGenerateModal 一致）。
 *
 * UI 风格：暗色主题 + inline styles + 项目 CSS 变量，参照 ExpressionGenerateModal。
 *
 * 【重点标记 - characterCardId vs characterCardPath】
 * 在 ExpressionGenerateModal 中 characterCardId 即角色卡 PNG 文件路径（同时用作 store key
 * 和 SD 提取基底图的源文件路径）。本组件按 Task 10 要求将两者作为独立 prop 声明以语义化区分：
 * - characterCardId：用于 expressionStore / assetStore / characterTrait.list 的 key
 * - characterCardPath：用于 sd.generateExpression 的 characterCardPath 参数
 * 实际调用方（Task 11）传入时两者通常是同一字符串。
 */

// ==================== 类型定义 ====================

export interface AssetGenerateModalProps {
  open: boolean;
  /** 角色卡 ID（= 角色卡 PNG 文件绝对路径，作为 store key 与 characterTrait.list 参数） */
  characterCardId: string;
  /** 角色卡 PNG 文件路径，用于 SD 提取基底图（与 characterCardId 通常是同一字符串） */
  characterCardPath: string;
  /** 角色名（用于标题展示） */
  characterName: string;
  /** 生成模式：
   *  - batch-expression：批量生成 30 个预置情绪表情
   *  - single-expression：生成单个情绪表情
   *  - illustration：生成角色立绘
   *  - general：生成一般场景图像（需用户输入场景描述）
   *  - three-view：生成三视图（需指定 targetSlot） */
  mode:
    | 'batch-expression'
    | 'single-expression'
    | 'illustration'
    | 'general'
    | 'three-view';
  /** single-expression 模式：目标情绪键名 */
  targetEmotionKey?: string;
  /** single-expression 模式：自定义情绪的中文标签（自定义情绪必填，预置情绪可不传） */
  targetEmotionLabel?: string;
  /** three-view 模式：目标槽位 */
  targetSlot?: 'front' | 'side' | 'back';
  onClose: () => void;
  /** 生成成功后的回调（供父组件刷新） */
  onGenerated?: () => void;
}

/** SD WebUI 连接状态 */
type SdStatus = 'unknown' | 'checking' | 'available' | 'unavailable';

/** 批量生成阶段 */
type BatchStage = 'idle' | 'generating' | 'complete' | 'cancelled';

/** 单次生成阶段（适用于 single-expression / illustration / general / three-view） */
type SingleStage = 'idle' | 'generating' | 'success' | 'failed';

/** 批量生成进度数据（来自 sd:generationProgress 事件） */
interface BatchProgress {
  current: number;
  total: number;
  emotionKey: string;
  status: 'success' | 'failed';
  error?: string;
  imageBase64?: string;
}

/** 批量生成完成汇总（来自 sd:generationComplete 事件） */
interface BatchSummary {
  total: number;
  success: number;
  failed: number;
  cancelled: number;
}

/** 默认 SD 配置（与 SDWebuiSettings 中的 DEFAULT_SD_WEBUI_CONFIG 一致，
 * 与 ExpressionGenerateModal 中保持同步）。
 * 【重点标记 - ADetailer-Neo 兼容性 + 参数扩展】需包含全部新增字段，
 * 否则 setting.sdWebui 不存在时 buildSdOptions 读取新字段会得到 undefined。 */
const DEFAULT_SD_CONFIG: SDWebuiConfig = {
  endpoint: 'http://localhost:7860',
  model: '',
  denoisingStrength: 0.55,
  steps: 28,
  cfgScale: 7,
  sampler: 'DPM++ 2M Karras',
  adetailerEnabled: true,
  positivePromptTemplate:
    'portrait, {traits}, looking at viewer, simple background, {emotion}, high quality, best quality, masterpiece, detailed face',
  customNegativePrompt: '',
  // ADetailer 高级参数默认值
  adModel: 'face_yolov8n.pt',
  adConfidence: 0.3,
  adDenoisingStrength: 0.4,
  adMaskBlur: 4,
  adDilateErode: 4,
  adInpaintOnlyMasked: true,
  adInpaintOnlyMaskedPadding: 32,
  adUseInpaintWidthHeight: false,
  adInpaintWidth: 512,
  adInpaintHeight: 512,
  adUseSteps: false,
  adSteps: 20,
  adUseCfgScale: false,
  adCfgScale: 4.0,
  adUseSampler: false,
  adSampler: 'Use same sampler',
  // NL 模型相关
  modelType: 'sdxl',
  nlPromptTemplate:
    'A portrait of a character. {traits} The character has {emotion}, looking at the viewer. High quality, detailed.',
  txt2imgWidth: 1024,
  txt2imgHeight: 1024,
  // LoRA 模型选择（Spec: add-lora-model-selection / Task 5）
  selectedLoras: [],
};

/** data URI 前缀（用于在浏览器中展示 base64 图片） */
const PNG_DATA_URI_PREFIX = 'data:image/png;base64,';

/**
 * 根据 mode 与目标构建素材生成的正面提示词模板（不含表情）。
 *
 * 【重点标记 - 提示词模板】
 * - 立绘（illustration）：`full body, standing, {traits}, simple background, high quality, best quality, masterpiece`
 * - 一般图像（general）：`{traits}, {userScene}, high quality, best quality`（{userScene} 由用户输入替换）
 * - 三视图（three-view）：根据 targetSlot 选择 front / side / back view 模板
 *
 * 注：{traits} 占位符由 sdGenerationService.generateExpression 内部替换为
 * options.characterTraits 拼接后的字符串（与表情模式一致）。
 *
 * @param mode 生成模式
 * @param targetSlot 三视图模式下的目标槽位
 * @param userScene 一般图像模式下的用户场景描述
 * @returns 提示词模板字符串
 */
function buildAssetPromptTemplate(
  mode: 'illustration' | 'general' | 'three-view',
  targetSlot?: 'front' | 'side' | 'back',
  userScene?: string,
): string {
  switch (mode) {
    case 'illustration':
      // 立绘模板：full body + standing + 特征 + 简单背景 + 高质量
      return 'full body, standing, {traits}, simple background, high quality, best quality, masterpiece';
    case 'general': {
      // 一般图像模板：特征 + 用户场景 + 高质量
      // {userScene} 在此处替换为用户输入（已 trim），若为空则使用默认占位 "looking at viewer"
      const scene = (userScene && userScene.trim()) || 'looking at viewer';
      return `{traits}, ${scene}, high quality, best quality`;
    }
    case 'three-view': {
      // 三视图模板：根据 targetSlot 选择 front / side / back
      const viewName = targetSlot || 'front';
      return `${viewName} view, full body, {traits}, character sheet, white background, high quality`;
    }
    default:
      return '{traits}, high quality, best quality';
  }
}

/**
 * 三视图槽位的中英文标签映射。
 */
const THREE_VIEW_SLOT_LABELS: Record<'front' | 'side' | 'back', string> = {
  front: '正视图',
  side: '侧视图',
  back: '背视图',
};

/**
 * 各 mode 的中文标题映射。
 */
const MODE_TITLE_MAP: Record<AssetGenerateModalProps['mode'], string> = {
  'batch-expression': '批量生成表情',
  'single-expression': '生成单个表情',
  illustration: '生成角色立绘',
  general: '生成一般图像',
  'three-view': '生成三视图',
};

// ==================== 组件实现 ====================

const AssetGenerateModal: React.FC<AssetGenerateModalProps> = ({
  open,
  characterCardId,
  characterCardPath,
  characterName,
  mode,
  targetEmotionKey,
  targetEmotionLabel,
  targetSlot,
  onClose,
  onGenerated,
}) => {
  // ====== Store 订阅 ======
  const { saveExpression, loadExpressions } = useExpressionStore();
  const { saveAsset } = useAssetStore();
  // 【Spec: add-model-capability-detection-and-image-recognition / Task 7】
  // 从 settingStore 读取当前激活引擎的 capabilities.supportsVision，
  // 仅当为 true 时展示「AI 图片识别」按钮
  const { setting } = useSettingStore();
  const activeEngine = setting?.aiEngines?.find(
    (e) => e.id === setting?.activeEngineId,
  );
  const supportsVision = activeEngine?.capabilities?.supportsVision === true;

  // ====== 基础状态 ======
  /** SD WebUI 配置（来自 setting.load()） */
  const [sdConfig, setSdConfig] = useState<SDWebuiConfig>(DEFAULT_SD_CONFIG);
  /** SD WebUI 连接状态 */
  const [sdStatus, setSdStatus] = useState<SdStatus>('unknown');
  /** SD WebUI 不可用时的错误信息 */
  const [sdError, setSdError] = useState<string | null>(null);
  /** ADetailer 扩展可用性（checkStatus 返回） */
  const [adetailerAvailable, setAdetailerAvailable] = useState<boolean | null>(
    null,
  );
  /** 初始化加载中（读取设置 / 读取特征 / 检测 SD） */
  const [initializing, setInitializing] = useState<boolean>(false);

  // ====== 角色特征状态 ======
  /** 角色视觉特征 tag 数组（从 characterTrait.list 读取） */
  const [characterTraits, setCharacterTraits] = useState<string[]>([]);
  /** 特征读取错误信息（null 表示无错误） */
  const [traitsError, setTraitsError] = useState<string | null>(null);
  // 【Spec: add-model-capability-detection-and-image-recognition / Task 7】
  // AI 图片识别进行中标记，控制按钮 loading 状态
  const [imageRecognizing, setImageRecognizing] = useState<boolean>(false);

  // ====== 批量模式状态（batch-expression） ======
  const [batchStage, setBatchStage] = useState<BatchStage>('idle');
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(
    null,
  );
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  /** 实时统计（在 progress 事件中累计） */
  const statsRef = useRef<{ success: number; failed: number; skipped: number }>(
    {
      success: 0,
      failed: 0,
      skipped: 0,
    },
  );
  const [stats, setStats] = useState<{
    success: number;
    failed: number;
    skipped: number;
  }>({ success: 0, failed: 0, skipped: 0 });

  // ====== 单次生成状态（single-expression / illustration / general / three-view） ======
  const [singleStage, setSingleStage] = useState<SingleStage>('idle');
  /** 生成的图片 base64（含 data URI 前缀，可直接用于 <img src>） */
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  /** 单次生成的错误信息 */
  const [singleError, setSingleError] = useState<string | null>(null);
  /** 可编辑的正面提示词（用户可修改后再生） */
  const [positivePrompt, setPositivePrompt] = useState<string>('');
  /** 可编辑的负面提示词（用户可修改后再生） */
  const [negativePrompt, setNegativePrompt] = useState<string>('');
  /** general 模式下用户输入的场景描述 */
  const [userScene, setUserScene] = useState<string>('');
  /** LoRA 选择弹窗开关（Spec: add-lora-model-selection / Task 5） */
  const [loraModalOpen, setLoraModalOpen] = useState(false);

  // ====== 初始化加载（open 时拉取 SD 配置 / 读取特征 / 检测 SD 状态） ======
  useEffect(() => {
    if (!open || !characterCardId) return;

    let cancelled = false;
    setInitializing(true);
    setSdStatus('checking');
    setSdError(null);
    setAdetailerAvailable(null);
    setTraitsError(null);

    (async () => {
      try {
        // 1. 加载 SD 设置
        let config: SDWebuiConfig = DEFAULT_SD_CONFIG;
        try {
          const settingResult = await window.electronAPI.setting.load();
          if (settingResult?.success && settingResult.setting?.sdWebui) {
            config = { ...DEFAULT_SD_CONFIG, ...settingResult.setting.sdWebui };
          }
        } catch (e) {
          console.warn(
            '[AssetGenerateModal] 加载 SD 设置失败，使用默认值:',
            e,
          );
        }
        if (cancelled) return;
        setSdConfig(config);

        // 2. 读取角色特征（Spec: add-asset-and-trait-management / Task 10）
        // 通过 IPC 直接读取，不依赖 characterTraitStore（避免父组件未 loadTraits 时取不到值）
        try {
          const traits = await window.electronAPI.characterTrait.list(
            characterCardId,
          );
          if (cancelled) return;
          setCharacterTraits(Array.isArray(traits) ? traits : []);
        } catch (e) {
          if (cancelled) return;
          console.warn('[AssetGenerateModal] 读取角色特征失败:', e);
          setCharacterTraits([]);
          setTraitsError(
            e instanceof Error ? e.message : '读取角色特征失败',
          );
        }

        // 3. 检测 SD WebUI 状态（含 ADetailer 可用性检测）
        try {
          const statusResult = await window.electronAPI.sd.checkStatus(
            config.endpoint,
          );
          if (cancelled) return;
          if (statusResult?.available) {
            setSdStatus('available');
            setAdetailerAvailable(statusResult.adetailerAvailable ?? false);
          } else {
            setSdStatus('unavailable');
            setSdError(statusResult?.error || '未知错误');
          }
        } catch (e) {
          if (cancelled) return;
          setSdStatus('unavailable');
          setSdError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, characterCardId]);

  // ====== 初始化时构建提示词预览 + 可编辑提示词（非 batch 模式） ======
  useEffect(() => {
    if (!open) return;

    // batch-expression 模式不在此处构建（在 handleBatchStart 中按情绪循环构建）
    if (mode === 'batch-expression') {
      setPositivePrompt('');
      setNegativePrompt('');
      return;
    }

    // single-expression 模式：根据 modelType 选择 NL / tag 风格提示词构建器
    if (mode === 'single-expression') {
      if (!targetEmotionKey) {
        setPositivePrompt('');
        setNegativePrompt('');
        return;
      }
      const preset = EMOTION_PRESETS.find((e) => e.key === targetEmotionKey);
      const customLabel = targetEmotionLabel || preset?.label;
      const isNLModel = sdConfig.modelType !== 'sdxl';
      const { prompt, negativePrompt: neg } = isNLModel
        ? buildNLExpressionPrompt(targetEmotionKey, {
            nlPromptTemplate: sdConfig.nlPromptTemplate,
            customNegativePrompt: sdConfig.customNegativePrompt,
            customLabel,
            characterTraits,
            modelType: sdConfig.modelType,
          })
        : buildExpressionGenerationPrompt(
            targetEmotionKey,
            {
              positivePromptTemplate: sdConfig.positivePromptTemplate,
              customNegativePrompt: sdConfig.customNegativePrompt,
              customLabel,
              characterTraits,
            },
          );
      setPositivePrompt(prompt);
      setNegativePrompt(neg);
      return;
    }

    // illustration / general / three-view 模式：构建素材提示词模板
    const template = buildAssetPromptTemplate(
      mode,
      targetSlot,
      userScene,
    );
    // 负面提示词：用户自定义优先；否则使用默认
    const baseNegative =
      'deformed, ugly, bad anatomy, multiple faces, text, watermark, low quality, blurry, mutated hands, extra digits, missing fingers, bad proportions';
    const userNegative = (sdConfig.customNegativePrompt && sdConfig.customNegativePrompt.trim()) || '';
    setPositivePrompt(template);
    setNegativePrompt(userNegative || baseNegative);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    mode,
    targetEmotionKey,
    targetEmotionLabel,
    targetSlot,
    sdConfig.positivePromptTemplate,
    sdConfig.customNegativePrompt,
    sdConfig.modelType,
    sdConfig.nlPromptTemplate,
    characterTraits,
  ]);

  // ====== general 模式：userScene 变化时重新构建提示词 ======
  useEffect(() => {
    if (!open || mode !== 'general') return;
    // 仅在 idle 阶段跟随 userScene 变化更新提示词（生成中/成功后不覆盖用户编辑）
    if (singleStage !== 'idle') return;
    const template = buildAssetPromptTemplate('general', undefined, userScene);
    setPositivePrompt(template);
  }, [userScene, open, mode, singleStage]);

  // ====== 重置状态（关闭时） ======
  useEffect(() => {
    if (!open) {
      setBatchStage('idle');
      setBatchProgress(null);
      setBatchSummary(null);
      setStats({ success: 0, failed: 0, skipped: 0 });
      statsRef.current = { success: 0, failed: 0, skipped: 0 };
      setSingleStage('idle');
      setGeneratedImage(null);
      setSingleError(null);
      setPositivePrompt('');
      setNegativePrompt('');
      setUserScene('');
      setCharacterTraits([]);
      setTraitsError(null);
      setAdetailerAvailable(null);
      setImageRecognizing(false);
    }
  }, [open]);

  // ====== 卸载时清理 IPC 监听器 ======
  useEffect(() => {
    return () => {
      try {
        window.electronAPI?.sd?.removeProgressListeners?.();
      } catch (e) {
        console.warn(
          '[AssetGenerateModal] cleanup removeProgressListeners failed:',
          e,
        );
      }
    };
  }, []);

  // ====== 构建单个情绪的 prompt + negativePrompt（批量模式使用） ======
  const buildEmotionPrompt = useCallback(
    (emotionKey: string, label?: string) => {
      const isNLModel = sdConfig.modelType !== 'sdxl';
      const { prompt, negativePrompt: neg } = isNLModel
        ? buildNLExpressionPrompt(emotionKey, {
            nlPromptTemplate: sdConfig.nlPromptTemplate,
            customNegativePrompt: sdConfig.customNegativePrompt,
            customLabel: label,
            characterTraits,
            modelType: sdConfig.modelType,
          })
        : buildExpressionGenerationPrompt(emotionKey, {
            positivePromptTemplate: sdConfig.positivePromptTemplate,
            customNegativePrompt: sdConfig.customNegativePrompt,
            customLabel: label,
            characterTraits,
          });
      return { key: emotionKey, prompt, negativePrompt: neg };
    },
    [sdConfig.positivePromptTemplate, sdConfig.customNegativePrompt, sdConfig.modelType, sdConfig.nlPromptTemplate, characterTraits],
  );

  // ====== 构建 SD 生成选项（传给 IPC 的 options 字段） ======
  // 【重点标记 - 特征携带机制】透传 characterTraits 到 options，
  // 由 sdGenerationService.generateExpression 内部替换 {traits} 占位符
  const buildSdOptions = useCallback(() => {
    return {
      endpoint: sdConfig.endpoint,
      denoisingStrength: sdConfig.denoisingStrength,
      steps: sdConfig.steps,
      cfgScale: sdConfig.cfgScale,
      sampler: sdConfig.sampler,
      adetailerEnabled: sdConfig.adetailerEnabled,
      model: sdConfig.model || undefined,
      // 【重点标记 - 特征携带机制】注入角色特征 tag 数组
      characterTraits,
      // ADetailer 高级参数（仅当 adetailerEnabled=true 时由 sdGenerationService 读取）
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
      // NL 模型相关（Spec: integrate-nl-driven-sd-models）
      modelType: sdConfig.modelType,
      txt2imgWidth: sdConfig.txt2imgWidth,
      txt2imgHeight: sdConfig.txt2imgHeight,
      // LoRA 模型选择（Spec: add-lora-model-selection / Task 5）
      selectedLoras: sdConfig.selectedLoras,
    };
  }, [sdConfig, characterTraits]);

  // ====== 保存生成的素材（非表情模式） ======
  // 【重点标记 - assetId 生成规则】
  // - illustration: ill_{timestamp}（每次生成独立 ID，允许保存多个立绘）
  // - general: gen_{timestamp}（每次生成独立 ID，允许保存多个一般图像）
  // - three-view: 直接使用 targetSlot（front/side/back）作为 ID 与 slot，
  //   保存时会覆盖同槽位的旧图（与三视图槽位语义一致）
  const handleAssetSave = useCallback(
    async (
      assetType: 'illustration' | 'general' | 'three-view',
      imageBase64: string,
      slot?: 'front' | 'side' | 'back',
    ): Promise<{ success: boolean; error?: string }> => {
      if (!characterCardId) {
        return { success: false, error: '未指定角色卡 ID' };
      }

      let assetId: string;
      if (assetType === 'illustration') {
        assetId = `ill_${Date.now()}`;
      } else if (assetType === 'general') {
        assetId = `gen_${Date.now()}`;
      } else if (assetType === 'three-view') {
        // 三视图以 targetSlot 作为 assetId 与 slot，覆盖式更新
        if (!slot) {
          return { success: false, error: '三视图模式未指定槽位' };
        }
        assetId = slot;
      } else {
        return { success: false, error: `未知素材类型: ${assetType}` };
      }

      const result = await saveAsset({
        characterCardId,
        assetType,
        assetId,
        imageBase64,
        slot,
      });

      return result;
    },
    [characterCardId, saveAsset],
  );

  // ====== 批量生成：开始（batch-expression 模式） ======
  const handleBatchStart = useCallback(async () => {
    if (!characterCardId || !characterCardPath) {
      message.warning('未选择角色卡');
      return;
    }
    if (sdStatus !== 'available') {
      message.error('SD WebUI 不可用，无法开始生成');
      return;
    }

    // 清理旧监听器（避免重复监听）
    try {
      window.electronAPI.sd.removeProgressListeners();
    } catch (e) {
      console.warn('[AssetGenerateModal] removeProgressListeners before batch:', e);
    }

    // 重置统计与状态
    statsRef.current = { success: 0, failed: 0, skipped: 0 };
    setStats({ success: 0, failed: 0, skipped: 0 });
    setBatchProgress(null);
    setBatchSummary(null);
    setBatchStage('generating');

    // 1. 为全部 30 个预置情绪构建提示词
    const emotions = EMOTION_PRESETS.map(({ key, label }) =>
      buildEmotionPrompt(key, label),
    );

    // 2. 注册进度监听
    try {
      window.electronAPI.sd.onGenerationProgress((data: BatchProgress) => {
        setBatchProgress(data);
        if (data.status === 'success') {
          statsRef.current.success += 1;
          // 立即保存（不等全部完成）
          if (data.imageBase64 && data.emotionKey) {
            const dataUrl = data.imageBase64.startsWith(PNG_DATA_URI_PREFIX)
              ? data.imageBase64
              : PNG_DATA_URI_PREFIX + data.imageBase64;
            saveExpression(
              characterCardId,
              data.emotionKey,
              dataUrl,
              false, // 预置情绪 isCustom=false
            ).catch((e) => {
              console.warn(
                '[AssetGenerateModal] 批量生成中保存表情失败:',
                data.emotionKey,
                e,
              );
            });
          }
        } else {
          statsRef.current.failed += 1;
        }
        setStats({ ...statsRef.current });
      });

      window.electronAPI.sd.onGenerationComplete((data: BatchSummary) => {
        setBatchSummary(data);
        setBatchStage(data.cancelled > 0 ? 'cancelled' : 'complete');
        // 刷新 store（确保 imageCache 与磁盘一致）
        loadExpressions(characterCardId).catch((e) => {
          console.warn('[AssetGenerateModal] loadExpressions after batch:', e);
        });
        onGenerated?.();
        // 清理监听器
        try {
          window.electronAPI.sd.removeProgressListeners();
        } catch (e) {
          console.warn(
            '[AssetGenerateModal] removeProgressListeners after complete:',
            e,
          );
        }
      });
    } catch (e) {
      console.error('[AssetGenerateModal] 注册进度监听失败:', e);
      message.error('注册进度监听失败');
      setBatchStage('idle');
      return;
    }

    // 3. 启动生成
    try {
      await window.electronAPI.sd.generateAllExpressions({
        characterCardPath,
        emotions,
        options: buildSdOptions(),
      });
    } catch (e) {
      console.error('[AssetGenerateModal] generateAllExpressions 异常:', e);
      message.error(
        `启动批量生成失败: ${e instanceof Error ? e.message : String(e)}`,
      );
      setBatchStage('idle');
      try {
        window.electronAPI.sd.removeProgressListeners();
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    characterCardId,
    characterCardPath,
    sdStatus,
    buildEmotionPrompt,
    buildSdOptions,
    saveExpression,
    loadExpressions,
    onGenerated,
  ]);

  // ====== 批量生成：取消 ======
  const handleBatchCancel = useCallback(async () => {
    try {
      await window.electronAPI.sd.cancelGeneration();
      message.info('已发送取消请求，正在等待当前生成完成...');
    } catch (e) {
      console.error('[AssetGenerateModal] cancelGeneration 异常:', e);
      message.error('取消失败');
    }
  }, []);

  // ====== 单次生成：开始（single-expression / illustration / general / three-view） ======
  const handleSingleGenerate = useCallback(async () => {
    if (!characterCardId || !characterCardPath) {
      message.warning('未选择角色卡');
      return;
    }

    // single-expression 模式必须指定 targetEmotionKey
    if (mode === 'single-expression' && !targetEmotionKey) {
      message.warning('未指定目标情绪');
      return;
    }

    // three-view 模式必须指定 targetSlot
    if (mode === 'three-view' && !targetSlot) {
      message.warning('未指定三视图槽位');
      return;
    }

    // general 模式应输入场景描述（仅警告，不阻断——使用默认占位）
    if (mode === 'general' && !userScene.trim()) {
      console.warn(
        '[AssetGenerateModal] general 模式未输入场景描述，将使用默认占位 "looking at viewer"',
      );
    }

    if (sdStatus !== 'available') {
      message.error('SD WebUI 不可用，无法生成');
      return;
    }

    setSingleStage('generating');
    setGeneratedImage(null);
    setSingleError(null);

    try {
      // 根据模式确定 emotionKey（仅用于日志，实际生成由 prompt 控制）
      // 【重点标记 - 复用 sd.generateExpression IPC】
      // 非 single-expression 模式下 emotionKey 传占位值，prompt 由本组件构建的模板控制
      let emotionKeyForLog: string;
      let promptToUse: string;
      let negativePromptToUse: string;

      if (mode === 'single-expression' && targetEmotionKey) {
        // 表情模式：emotionKey 用真实值，prompt 复用 buildEmotionPrompt（或用户编辑后的）
        emotionKeyForLog = targetEmotionKey;
        const preset = EMOTION_PRESETS.find((e) => e.key === targetEmotionKey);
        const customLabel = targetEmotionLabel || preset?.label;
        const built = buildEmotionPrompt(targetEmotionKey, customLabel);
        promptToUse = positivePrompt.trim() || built.prompt;
        negativePromptToUse = negativePrompt;
      } else {
        // 素材模式（illustration / general / three-view）：emotionKey 占位，使用用户可编辑的提示词
        emotionKeyForLog = mode; // 'illustration' | 'general' | 'three-view'（仅用于日志识别）
        promptToUse = positivePrompt;
        negativePromptToUse = negativePrompt;
      }

      const result = await window.electronAPI.sd.generateExpression({
        characterCardPath,
        emotionKey: emotionKeyForLog,
        prompt: promptToUse,
        negativePrompt: negativePromptToUse,
        options: buildSdOptions(),
      });

      if (result?.success && result.imageBase64) {
        const dataUrl = result.imageBase64.startsWith(PNG_DATA_URI_PREFIX)
          ? result.imageBase64
          : PNG_DATA_URI_PREFIX + result.imageBase64;
        setGeneratedImage(dataUrl);
        setSingleStage('success');
      } else {
        setSingleError(result?.error || '生成失败');
        setSingleStage('failed');
      }
    } catch (e) {
      console.error('[AssetGenerateModal] generateExpression 异常:', e);
      setSingleError(e instanceof Error ? e.message : String(e));
      setSingleStage('failed');
    }
  }, [
    characterCardId,
    characterCardPath,
    mode,
    targetEmotionKey,
    targetEmotionLabel,
    targetSlot,
    userScene,
    sdStatus,
    positivePrompt,
    negativePrompt,
    buildEmotionPrompt,
    buildSdOptions,
  ]);

  // ====== 单次生成：保存 ======
  const handleSingleSave = useCallback(async () => {
    if (!characterCardId || !generatedImage) {
      message.warning('无生成结果可保存');
      return;
    }

    try {
      if (mode === 'single-expression') {
        // 表情模式：调用 expressionStore.saveExpression
        if (!targetEmotionKey) {
          message.warning('未指定目标情绪');
          return;
        }
        const isCustom = !EMOTION_PRESETS.some(
          (e) => e.key === targetEmotionKey,
        );
        const preset = EMOTION_PRESETS.find((e) => e.key === targetEmotionKey);
        const label = targetEmotionLabel || preset?.label;

        const result = await saveExpression(
          characterCardId,
          targetEmotionKey,
          generatedImage, // 带 data URI 前缀，service 层会剥离
          isCustom,
          label,
        );

        if (result.success) {
          message.success('表情已保存');
          loadExpressions(characterCardId).catch((e) => {
            console.warn(
              '[AssetGenerateModal] loadExpressions after save:',
              e,
            );
          });
          onGenerated?.();
          onClose();
        } else {
          message.error(result.error || '保存表情失败');
        }
      } else if (mode === 'illustration') {
        // 立绘模式：调用 assetStore.saveAsset
        const result = await handleAssetSave(
          'illustration',
          generatedImage,
        );
        if (result.success) {
          message.success('立绘已保存');
          onGenerated?.();
          onClose();
        } else {
          message.error(result.error || '保存立绘失败');
        }
      } else if (mode === 'general') {
        // 一般图像模式：调用 assetStore.saveAsset
        const result = await handleAssetSave(
          'general',
          generatedImage,
        );
        if (result.success) {
          message.success('一般图像已保存');
          onGenerated?.();
          onClose();
        } else {
          message.error(result.error || '保存一般图像失败');
        }
      } else if (mode === 'three-view') {
        // 三视图模式：调用 assetStore.saveAsset，slot=targetSlot
        if (!targetSlot) {
          message.warning('未指定三视图槽位');
          return;
        }
        const result = await handleAssetSave(
          'three-view',
          generatedImage,
          targetSlot,
        );
        if (result.success) {
          message.success(
            `${THREE_VIEW_SLOT_LABELS[targetSlot]}已保存`,
          );
          onGenerated?.();
          onClose();
        } else {
          message.error(result.error || '保存三视图失败');
        }
      }
    } catch (e) {
      console.error('[AssetGenerateModal] 保存失败:', e);
      message.error(
        `保存失败: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [
    characterCardId,
    generatedImage,
    mode,
    targetEmotionKey,
    targetEmotionLabel,
    targetSlot,
    saveExpression,
    loadExpressions,
    handleAssetSave,
    onGenerated,
    onClose,
  ]);

  // ====== 单次生成：重新生成 ======
  const handleRegenerate = useCallback(() => {
    setGeneratedImage(null);
    setSingleError(null);
    setSingleStage('idle');
    // 直接调用生成（复用当前提示词与配置）
    handleSingleGenerate();
  }, [handleSingleGenerate]);

  // ====== AI 图片识别特征提取（Spec: add-model-capability-detection-and-image-recognition / Task 7） ======
  // 调用 ai.recognizeImageTraits 识别角色卡 PNG 图片，提取视觉特征 tag，
  // 追加到现有 characterTraits（大小写不敏感去重）。前置条件：supportsVision=true。
  const handleImageRecognize = useCallback(async () => {
    if (!characterCardId) return;
    setImageRecognizing(true);
    try {
      const result = await window.electronAPI.ai.recognizeImageTraits({
        characterCardPath: characterCardId,
        characterName,
      });
      if (result?.success && result.traits) {
        // 追加到现有特征，大小写不敏感去重
        const existing = new Set(characterTraits.map((t) => t.toLowerCase()));
        const newTraits = result.traits.filter(
          (t) => !existing.has(t.toLowerCase()),
        );
        const updated = [...characterTraits, ...newTraits];
        setCharacterTraits(updated);
        message.success(
          `识别到 ${newTraits.length} 个新特征标签（共 ${result.traits.length} 个）`,
        );
      } else {
        message.error(result?.error || '图片识别失败');
      }
    } catch (e) {
      message.error(
        `图片识别异常: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setImageRecognizing(false);
    }
  }, [characterCardId, characterName, characterTraits]);

  // ====== 渲染辅助 ======

  /** 当前正在生成的情绪标签（从预置列表查找） */
  const currentEmotionLabel = batchProgress
    ? EMOTION_PRESETS.find((e) => e.key === batchProgress.emotionKey)?.label ||
      batchProgress.emotionKey
    : '';

  /** single-expression 模式标题中的情绪标签 */
  const singleEmotionLabel =
    targetEmotionLabel ||
    EMOTION_PRESETS.find((e) => e.key === targetEmotionKey)?.label ||
    targetEmotionKey ||
    '';

  /** 三视图槽位的中文标签 */
  const threeViewSlotLabel = targetSlot
    ? THREE_VIEW_SLOT_LABELS[targetSlot]
    : '';

  /** SD 状态指示器 */
  const renderSdStatusIndicator = () => {
    let color: string = 'default';
    let text: string = '';
    let icon: React.ReactNode = null;

    switch (sdStatus) {
      case 'available':
        color = 'success';
        text = 'SD WebUI 已连接';
        icon = <CheckCircleOutlined />;
        break;
      case 'unavailable':
        color = 'error';
        text = 'SD WebUI 未连接';
        icon = <CloseCircleOutlined />;
        break;
      case 'checking':
        color = 'processing';
        text = '正在检测连接...';
        icon = <LoadingOutlined />;
        break;
      default:
        color = 'default';
        text = '未检测';
        icon = <SettingOutlined />;
    }

    return (
      <Tag color={color} icon={icon} style={{ margin: 0 }}>
        {text}
        {sdStatus === 'available' && sdConfig.model && (
          <span style={{ marginLeft: 6, opacity: 0.7 }}>
            | {sdConfig.model}
          </span>
        )}
      </Tag>
    );
  };

  /** 顶部信息栏：角色名 + SD 状态 */
  const renderHeader = () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        padding: 12,
        background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
        borderRadius: 8,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: 'var(--text-primary, #e2e8f0)',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {characterName}
          <span style={{ marginLeft: 8, opacity: 0.6 }}>
            · {MODE_TITLE_MAP[mode]}
          </span>
        </div>
        <div
          style={{
            color: 'var(--text-secondary, #94a3b8)',
            fontSize: 11,
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {mode === 'batch-expression' || mode === 'single-expression'
            ? sdConfig.positivePromptTemplate
              ? '提示词模板: ' +
                sdConfig.positivePromptTemplate.slice(0, 60) +
                (sdConfig.positivePromptTemplate.length > 60 ? '...' : '')
              : '（使用默认提示词模板）'
            : mode === 'illustration'
            ? '立绘模板: full body, standing, {traits}, ...'
            : mode === 'general'
            ? '一般图像模板: {traits}, {userScene}, high quality'
            : `三视图模板: ${targetSlot || 'front'} view, full body, {traits}, character sheet`}
        </div>
      </div>

      <Tooltip
        title={
          sdStatus === 'unavailable' && sdError
            ? `错误：${sdError}`
            : sdStatus === 'available'
            ? `端点：${sdConfig.endpoint}`
            : ''
        }
      >
        {renderSdStatusIndicator()}
      </Tooltip>
    </div>
  );

  /** 角色特征展示区（让用户知道携带了哪些特征） */
  const renderTraitsPanel = () => (
    <div
      style={{
        marginBottom: 16,
        padding: 10,
        background: 'rgba(99, 102, 241, 0.05)',
        borderRadius: 8,
        border: '1px solid rgba(99, 102, 241, 0.15)',
        fontSize: 12,
      }}
    >
      <div
        style={{
          color: 'var(--text-secondary, #94a3b8)',
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <span>携带角色特征（{characterTraits.length}）：</span>
        {traitsError && (
          <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>
            读取失败
          </Tag>
        )}
        {/* 【Spec: add-model-capability-detection-and-image-recognition / Task 7】
            仅当当前 AI 引擎 supportsVision=true 时显示「AI 图片识别」按钮；
            不支持时显示提示文案引导用户切换模型 */}
        {supportsVision ? (
          <Button
            size="small"
            icon={<EyeOutlined />}
            loading={imageRecognizing}
            onClick={handleImageRecognize}
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              borderColor: 'rgba(99, 102, 241, 0.4)',
              color: '#a5b4fc',
            }}
          >
            AI 图片识别
          </Button>
        ) : (
          <Tooltip title="当前 AI 模型不支持图片识别，请在设置中切换到多模态模型">
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary, #6b7280)' }}>
              图片识别不可用
            </span>
          </Tooltip>
        )}
      </div>
      {characterTraits.length === 0 ? (
        <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 11 }}>
          （未配置角色特征，可在角色卡编辑界面添加）
        </span>
      ) : (
        <Space size={[4, 4]} wrap>
          {characterTraits.map((trait, idx) => (
            <Tag key={`${trait}-${idx}`} color="purple" style={{ margin: 0 }}>
              {trait}
            </Tag>
          ))}
        </Space>
      )}
    </div>
  );

  /** SD 不可用警告 */
  const renderSdUnavailableAlert = () => {
    if (sdStatus !== 'unavailable') return null;
    return (
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 16 }}
        message="无法连接 SD WebUI"
        description={
          <div style={{ fontSize: 12 }}>
            <p style={{ margin: '4px 0' }}>
              请先启动 Stable Diffusion WebUI（推荐 Forge Neo），并以{' '}
              <code
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                --api
              </code>{' '}
              参数开启 API。
            </p>
            <p style={{ margin: '4px 0' }}>
              默认端点：
              <code
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                {sdConfig.endpoint}
              </code>
            </p>
            {sdError && (
              <p
                style={{
                  margin: '4px 0',
                  color: '#fca5a5',
                  whiteSpace: 'pre-line',
                }}
              >
                详细错误：{sdError}
              </p>
            )}
            <p style={{ margin: '4px 0' }}>
              可在「设置 → Stable Diffusion」中修改端点 URL 与生成参数。
            </p>
          </div>
        }
      />
    );
  };

  /** ADetailer 未安装警告 */
  const renderAdetailerWarning = () => {
    if (sdStatus !== 'available') return null;
    if (!sdConfig.adetailerEnabled) return null;
    if (adetailerAvailable !== false) return null;
    return (
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="ADetailer 扩展未检测到"
        description={
          <div style={{ fontSize: 12 }}>
            <p style={{ margin: '4px 0' }}>
              已开启 ADetailer 面部修复，但 SD WebUI 中未检测到 ADetailer 扩展。
              生成将正常进行，但不会进行面部二次修复，角色一致性可能降低。
            </p>
            <p style={{ margin: '4px 0' }}>
              安装方法：在 SD WebUI 的 Extensions → Install from URL 中输入
              <code
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  padding: '2px 6px',
                  borderRadius: 4,
                  margin: '0 4px',
                }}
              >
                https://github.com/Bing-su/adetailer
              </code>
              然后重启 SD WebUI。或在设置中关闭 ADetailer 开关以隐藏此警告。
            </p>
          </div>
        }
      />
    );
  };

  /** 参数概览 Tag 组（端点/步数/CFG/采样器/去噪/ADetailer/特征） */
  const renderParamsOverview = () => (
    <div
      style={{
        padding: 12,
        background: 'rgba(99, 102, 241, 0.08)',
        borderRadius: 8,
        border: '1px solid rgba(99, 102, 241, 0.2)',
        fontSize: 12,
        color: 'var(--text-secondary, #94a3b8)',
        marginBottom: 16,
      }}
    >
      <Space size={[16, 4]} wrap>
        <Tag>端点：{sdConfig.endpoint}</Tag>
        <Tag>步数：{sdConfig.steps}</Tag>
        <Tag>CFG：{sdConfig.cfgScale}</Tag>
        <Tag>采样器：{sdConfig.sampler || 'DPM++ 2M Karras'}</Tag>
        <Tag>去噪：{sdConfig.denoisingStrength}</Tag>
        <Tag
          color={
            !sdConfig.adetailerEnabled
              ? 'default'
              : adetailerAvailable === false
                ? 'orange'
                : 'green'
          }
        >
          ADetailer：{sdConfig.adetailerEnabled ? '开' : '关'}
          {sdConfig.adetailerEnabled && adetailerAvailable === false && '（未检测到）'}
          {sdConfig.adetailerEnabled && adetailerAvailable === true && '（已就绪）'}
          {sdConfig.adetailerEnabled && ` · ${sdConfig.adModel}`}
          {sdConfig.adetailerEnabled && ` · 去噪${sdConfig.adDenoisingStrength}`}
        </Tag>
        <Tag color="purple">特征：{characterTraits.length} 项</Tag>
        <Tag
          color="cyan"
          style={{ cursor: 'pointer' }}
          onClick={() => setLoraModalOpen(true)}
        >
          LoRA：{sdConfig.selectedLoras?.length || 0} 个
        </Tag>
        {sdConfig.model && <Tag>模型：{sdConfig.model}</Tag>}
      </Space>
    </div>
  );

  /** 批量模式主体 UI（batch-expression） */
  const renderBatchMode = () => {
    // 生成完成（或取消）后的汇总
    if (batchStage === 'complete' || batchStage === 'cancelled') {
      const summary = batchSummary || {
        total: EMOTION_PRESETS.length,
        success: stats.success,
        failed: stats.failed,
        cancelled:
          batchStage === 'cancelled'
            ? EMOTION_PRESETS.length - stats.success - stats.failed
            : 0,
      };
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: '24px 12px',
            alignItems: 'center',
          }}
        >
          <CheckCircleOutlined
            style={{ fontSize: 48, color: 'var(--primary-color, #6366f1)' }}
          />
          <div
            style={{
              color: 'var(--text-primary, #e2e8f0)',
              fontSize: 16,
              fontWeight: 500,
            }}
          >
            {batchStage === 'cancelled' ? '生成已取消' : '生成完成'}
          </div>
          <div
            style={{
              color: 'var(--text-secondary, #94a3b8)',
              fontSize: 13,
            }}
          >
            成功 <strong style={{ color: '#34d399' }}>{summary.success}</strong>{' '}
            张 ｜ 失败 <strong style={{ color: '#f87171' }}>{summary.failed}</strong>{' '}
            张
            {summary.cancelled > 0 && (
              <>
                {' '}
                ｜ 跳过{' '}
                <strong style={{ color: '#fbbf24' }}>{summary.cancelled}</strong>{' '}
                张
              </>
            )}
            ｜ 共 {summary.total} 个
          </div>
          <Button type="primary" onClick={onClose}>
            关闭
          </Button>
        </div>
      );
    }

    // 生成中
    if (batchStage === 'generating') {
      const percent = batchProgress
        ? Math.round((batchProgress.current / batchProgress.total) * 100)
        : 0;
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: '12px 0',
          }}
        >
          <Progress
            percent={percent}
            status="active"
            strokeColor={{ from: '#6366f1', to: '#8b5cf6' }}
          />

          <div
            style={{
              textAlign: 'center',
              color: 'var(--text-primary, #e2e8f0)',
              fontSize: 13,
            }}
          >
            {batchProgress
              ? `正在生成：${currentEmotionLabel}（${batchProgress.current}/${batchProgress.total}）`
              : '准备中...'}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 16,
              color: 'var(--text-secondary, #94a3b8)',
              fontSize: 12,
            }}
          >
            <span>
              成功：<strong style={{ color: '#34d399' }}>{stats.success}</strong>
            </span>
            <span>
              失败：<strong style={{ color: '#f87171' }}>{stats.failed}</strong>
            </span>
            <span>
              跳过：<strong style={{ color: '#fbbf24' }}>{stats.skipped}</strong>
            </span>
          </div>

          <div style={{ textAlign: 'center' }}>
            <Button danger onClick={handleBatchCancel} icon={<CloseCircleOutlined />}>
              取消生成
            </Button>
          </div>
        </div>
      );
    }

    // 待开始
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: '12px 0',
        }}
      >
        <Alert
          type="info"
          showIcon
          message="批量生成 30 个预置情绪表情"
          description={
            <div style={{ fontSize: 12 }}>
              将为该角色生成全部 30 个预置情绪（default / admiration / ... /
              cheerfulness）的表情图片，每张生成成功后会立即保存到角色卡表情目录。
              <br />
              预计耗时取决于 SD 速度，通常每张约 5-15 秒。
            </div>
          }
        />

        {renderParamsOverview()}

        <div style={{ textAlign: 'center' }}>
          <Button
            type="primary"
            size="large"
            icon={<ThunderboltOutlined />}
            onClick={handleBatchStart}
            disabled={sdStatus !== 'available'}
            loading={initializing}
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              borderColor: 'transparent',
            }}
          >
            开始生成
          </Button>
        </div>
      </div>
    );
  };

  /** 单次生成模式主体 UI（single-expression / illustration / general / three-view） */
  const renderSingleMode = () => {
    // 生成成功 - 展示结果预览
    if (singleStage === 'success' && generatedImage) {
      const successTitle =
        mode === 'single-expression'
          ? `已生成「${singleEmotionLabel}」表情`
          : mode === 'illustration'
          ? '已生成角色立绘'
          : mode === 'general'
          ? '已生成一般图像'
          : `已生成${threeViewSlotLabel}三视图`;

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: '12px 0',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: 12,
              background:
                'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
              borderRadius: 8,
            }}
          >
            <Image
              src={generatedImage}
              alt={successTitle}
              width={256}
              height={256}
              style={{
                objectFit: 'cover',
                borderRadius: 8,
                border: '1px solid var(--primary-color, #6366f1)',
              }}
              preview={{ mask: '点击查看大图' }}
            />
          </div>

          <Alert
            type="success"
            showIcon
            message={successTitle}
            description="点击「保存」将图片写入角色卡素材目录；点击「重新生成」将丢弃当前结果重新生成。"
          />

          <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={handleSingleSave}
              style={{
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                borderColor: 'transparent',
              }}
            >
              保存
            </Button>
            <Button icon={<RobotOutlined />} onClick={handleRegenerate}>
              重新生成
            </Button>
            <Button onClick={onClose}>关闭</Button>
          </div>
        </div>
      );
    }

    // 生成失败
    if (singleStage === 'failed') {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: '12px 0',
          }}
        >
          <Alert
            type="error"
            showIcon
            message="生成失败"
            description={
              <div style={{ whiteSpace: 'pre-line' }}>
                {singleError || '未知错误'}
              </div>
            }
          />
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
            <Button
              type="primary"
              icon={<RobotOutlined />}
              onClick={handleRegenerate}
            >
              重新生成
            </Button>
            <Button onClick={onClose}>关闭</Button>
          </div>
        </div>
      );
    }

    // 生成中
    if (singleStage === 'generating') {
      const generatingTip =
        mode === 'single-expression'
          ? '正在生成表情图片...'
          : mode === 'illustration'
          ? '正在生成角色立绘...'
          : mode === 'general'
          ? '正在生成一般图像...'
          : `正在生成${threeViewSlotLabel}三视图...`;

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            padding: '40px 0',
          }}
        >
          <Spin
            indicator={<LoadingOutlined style={{ fontSize: 40 }} />}
            tip={generatingTip}
          >
            <div style={{ width: 256, height: 256 }} />
          </Spin>
          <div style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 12 }}>
            SD img2img 生成中，请稍候（通常 5-15 秒）...
          </div>
        </div>
      );
    }

    // 待开始：展示提示词预览 + 生成按钮
    const idleTitle =
      mode === 'single-expression'
        ? `生成「${singleEmotionLabel}」表情`
        : mode === 'illustration'
        ? '生成角色立绘'
        : mode === 'general'
        ? '生成一般图像'
        : `生成${threeViewSlotLabel}三视图`;

    const idleDesc =
      mode === 'single-expression'
        ? '点击「生成」按钮，将通过 SD img2img 基于角色卡基底图片生成该情绪表情。'
        : mode === 'illustration'
        ? '点击「生成」按钮，将通过 SD img2img 基于角色卡基底图片生成角色立绘（full body, standing）。'
        : mode === 'general'
        ? '在下方输入场景描述（userScene），点击「生成」按钮通过 SD img2img 生成一般场景图像。'
        : `点击「生成」按钮，将通过 SD img2img 生成${threeViewSlotLabel}三视图（character sheet 风格）。`;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: '12px 0',
        }}
      >
        <Alert type="info" showIcon message={idleTitle} description={idleDesc} />

        {/* general 模式：用户输入场景描述 */}
        {mode === 'general' && (
          <div>
            <div
              style={{
                color: 'var(--text-secondary, #94a3b8)',
                fontSize: 12,
                marginBottom: 6,
              }}
            >
              场景描述（userScene）：
            </div>
            <Input
              value={userScene}
              onChange={(e) => setUserScene(e.target.value)}
              placeholder="例如：sitting on a chair, reading a book, indoor"
              style={{
                background: 'rgba(15, 15, 26, 0.6)',
                color: 'var(--text-primary, #e2e8f0)',
                borderColor: 'rgba(255, 255, 255, 0.1)',
              }}
            />
            <div
              style={{
                color: 'var(--text-secondary, #94a3b8)',
                fontSize: 11,
                marginTop: 4,
              }}
            >
              场景描述会拼接到提示词模板的 {userScene} 位置，与角色特征共同构成完整提示词。
            </div>
          </div>
        )}

        {/* 参数概览 */}
        {renderParamsOverview()}

        {/* 正面提示词（可编辑） */}
        <div>
          <div
            style={{
              color: 'var(--text-secondary, #94a3b8)',
              fontSize: 12,
              marginBottom: 6,
            }}
          >
            正面提示词（可编辑）：
          </div>
          <Input.TextArea
            value={positivePrompt}
            onChange={(e) => setPositivePrompt(e.target.value)}
            autoSize={{ minRows: 3, maxRows: 6 }}
            style={{
              background: 'rgba(15, 15, 26, 0.6)',
              color: 'var(--text-primary, #e2e8f0)',
              borderColor: 'rgba(255, 255, 255, 0.1)',
            }}
          />
        </div>

        {/* 负面提示词（可编辑） */}
        <div>
          <div
            style={{
              color: 'var(--text-secondary, #94a3b8)',
              fontSize: 12,
              marginBottom: 6,
            }}
          >
            负面提示词（可编辑）：
          </div>
          <Input.TextArea
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 4 }}
            style={{
              background: 'rgba(15, 15, 26, 0.6)',
              color: 'var(--text-primary, #e2e8f0)',
              borderColor: 'rgba(255, 255, 255, 0.1)',
            }}
          />
        </div>

        <div style={{ textAlign: 'center' }}>
          <Button
            type="primary"
            size="large"
            icon={<ThunderboltOutlined />}
            onClick={handleSingleGenerate}
            disabled={sdStatus !== 'available'}
            loading={initializing}
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              borderColor: 'transparent',
            }}
          >
            生成
          </Button>
        </div>
      </div>
    );
  };

  // ====== 主渲染 ======
  const modalTitle = `AI 素材生成 - ${characterName} · ${MODE_TITLE_MAP[mode]}`;

  return (
    <Modal
      title={modalTitle}
      open={open}
      onCancel={onClose}
      width={620}
      style={{ top: 20 }}
      styles={{
        body: {
          maxHeight: 'calc(100vh - 160px)',
          overflowY: 'auto',
          paddingRight: 8,
        },
      }}
      footer={
        // 批量生成中或单次生成中由内部按钮控制关闭；其他状态下提供「关闭」按钮
        batchStage === 'generating' || singleStage === 'generating' ? (
          <Button onClick={onClose} disabled>
            关闭
          </Button>
        ) : (
          <Button onClick={onClose}>关闭</Button>
        )
      }
    >
      {/* 初始化加载中 */}
      {initializing && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: '40px 0',
          }}
        >
          <Spin size="large" />
          <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 13 }}>
            正在加载设置 / 读取角色特征 / 检测 SD WebUI 状态...
          </span>
        </div>
      )}

      {/* 主体内容 */}
      {!initializing && (
        <>
          {renderHeader()}
          {renderTraitsPanel()}
          {renderSdUnavailableAlert()}
          {renderAdetailerWarning()}
          {mode === 'batch-expression'
            ? renderBatchMode()
            : renderSingleMode()}
        </>
      )}

      {/* LoRA 模型选择弹窗（Spec: add-lora-model-selection / Task 5） */}
      <LoraSelectModal
        open={loraModalOpen}
        endpoint={sdConfig.endpoint}
        selectedLoras={sdConfig.selectedLoras || []}
        onConfirm={(loras) => {
          setSdConfig((prev) => ({ ...prev, selectedLoras: loras }));
          setLoraModalOpen(false);
        }}
        onCancel={() => setLoraModalOpen(false)}
      />
    </Modal>
  );
};

export default AssetGenerateModal;
