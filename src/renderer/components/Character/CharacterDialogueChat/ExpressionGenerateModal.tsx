// Spec: add-ai-expression-generation / Task 4
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from '@ant-design/icons';
import {
  EMOTION_PRESETS,
  buildExpressionGenerationPrompt,
  buildNLExpressionPrompt,
} from './PromptBuilder';
import { useExpressionStore } from '../../../stores/expressionStore';
import { useCharacterLoraStore } from '../../../stores/characterLoraStore';
import { useCharacterTraitStore } from '../../../stores/characterTraitStore';
import type { SDWebuiConfig } from '../../../types/setting';
import LoraSelectModal from './LoraSelectModal';
import SizeSelector from './SizeSelector';

/**
 * AI 表情生成弹窗（Spec: add-ai-expression-generation / Task 4）
 *
 * 职责：
 * - 通过 Stable Diffusion WebUI img2img 自动生成角色卡表情图片
 * - 支持两种模式：
 *   - batch：一次性生成全部 31 个预置情绪表情，带进度条与统计
 *   - single：生成单个情绪表情，支持预览 / 保存 / 重新生成
 * - 复用 `expressionStore.saveExpression` 将生成结果持久化到角色卡表情目录
 * - 复用 `PromptBuilder.buildExpressionGenerationPrompt` 构建情绪提示词
 *
 * 数据流：
 *   打开弹窗 → 加载 SD 设置 / 角色卡描述 / 检测 SD 状态
 *   → 用户点击「开始生成」
 *   → 调用 `window.electronAPI.sd.generateAllExpressions` 或 `generateExpression`
 *   → 批量模式：监听 `sd:generationProgress` / `sd:generationComplete` 事件实时更新 UI
 *     并在每个表情生成成功后立即调用 `expressionStore.saveExpression` 保存
 *   → 单个模式：等待 `generateExpression` Promise resolve，展示结果预览
 *   → 完成后调用 `onGenerated?.()` 通知父组件刷新（store 也会被刷新）
 *
 * UI 风格：暗色主题 + inline styles + 项目 CSS 变量，参照 ExpressionManagerModal。
 *
 * 【重点标记 - characterCardId 即文件路径】
 * `characterCardId` prop 实际是角色卡 PNG 文件的绝对路径字符串，
 * 既是表情 manifest 的 key（经 sha256 哈希后作为目录名），也是 SD 生成时
 * 提取基底图片的源文件路径。本组件直接将其作为 `characterCardPath` 传给 SD IPC。
 *
 * 【重点标记 - SD 返回的 base64 不含 data URI 前缀】
 * `sdGenerationService.generateExpression` 返回的 `imageBase64` 是裸 base64
 * 字符串（不含 `data:image/png;base64,` 前缀）。在 `<img src>` / antd `<Image src>`
 * 中展示时必须手动拼接前缀；而 `expressionStore.saveExpression` 内部会自动
 * 剥离前缀（`expressionService.saveImage` 已实现），所以保存时两种格式均可。
 * 为统一处理，本组件在收到 base64 后立即拼接前缀存入 state，
 * 保存时直接传入带前缀的 data URL，由 service 层剥离。
 */

// ==================== 类型定义 ====================

export interface ExpressionGenerateModalProps {
  open: boolean;
  /** 角色卡 ID（= 角色卡 PNG 文件绝对路径） */
  characterCardId: string;
  /** 角色名（用于标题展示） */
  characterName: string;
  /** 默认头像路径（用于预览） */
  avatarPath?: string;
  /** 生成模式：batch=批量生成 31 个预置情绪 / single=生成单个情绪 */
  mode: 'batch' | 'single';
  /** 单个模式必需：目标情绪键名 */
  targetEmotionKey?: string;
  /** 单个模式可选：自定义情绪的中文标签（自定义情绪必填，预置情绪可不传） */
  targetEmotionLabel?: string;
  onClose: () => void;
  /** 生成完成后的回调（父组件可用来刷新 store 或 UI） */
  onGenerated?: () => void;
}

/** SD WebUI 连接状态 */
type SdStatus = 'unknown' | 'checking' | 'available' | 'unavailable';

/** 批量生成阶段 */
type BatchStage = 'idle' | 'generating' | 'complete' | 'cancelled';

/** 单个生成阶段 */
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

/** 默认 SD 配置（与 SDWebuiSettings 中的 DEFAULT_SD_WEBUI_CONFIG 一致）。
 * 【重点标记 - ADetailer-Neo 兼容性 + 参数扩展】需包含全部新增字段，
 * 否则 setting.sdWebui 不存在时 buildSdOptions 读取新字段会得到 undefined。
 * 【重点标记 - 特征携带机制（Spec: add-asset-and-trait-management / Task 5）】
 * 默认模板含 {traits} 与 {emotion} 两个占位符；与 settings.ts / SDWebuiSettings.tsx 同步。 */
const DEFAULT_SD_CONFIG: SDWebuiConfig = {
  endpoint: 'http://localhost:7860',
  model: '',
  denoisingStrength: 0.55,
  steps: 28,
  cfgScale: 7,
  sampler: 'DPM++ 3M SDE',
  scheduler: 'Karras',
  clipSkip: 2,
  adetailerEnabled: true,
  positivePromptTemplate: 'portrait, {traits}, looking at viewer, simple background, {emotion}, high quality, best quality, masterpiece, detailed face',
  customNegativePrompt: '',
  // ADetailer 高级参数默认值
  // 【重点标记 - ADetailer 参数优化（2026-07-29）】表情图模糊修复：
  // 降低降噪强度、增大蒙版模糊/膨胀、提高修复分辨率
  adModel: 'face_yolov8n.pt',
  adConfidence: 0.3,
  adDenoisingStrength: 0.3,
  adMaskBlur: 8,
  adDilateErode: 8,
  adInpaintOnlyMasked: true,
  adInpaintOnlyMaskedPadding: 64,
  adUseInpaintWidthHeight: true,
  adInpaintWidth: 1024,
  adInpaintHeight: 1024,
  adUseSteps: true,
  adSteps: 30,
  adUseCfgScale: true,
  adCfgScale: 5.0,
  adUseSampler: true,
  adSampler: 'DPM++ 2M SDE',
  adScheduler: 'Use same scheduler',
  // 【重点标记 - ADetailer 面部修复专用参数（2026-07-29 源码核验）】
  adNegativePrompt: '',
  adUseNoiseMultiplier: true,
  adNoiseMultiplier: 1.0,
  // 【重点标记 - Furry/拟人生物面部识别扩展（2026-08-07）】
  // 仅 YOLO-World 系列模型生效，空字符串=使用模型默认 COCO 80 类。
  adModelClasses: '',
  // NL 模型相关（Spec: integrate-nl-driven-sd-models / Task 6.5）
  // 【重点标记 - DEFAULT_SD_CONFIG 字段同步】需与 SDWebuiConfig 接口及
  // settings.ts 的 defaultSetting.sdWebui 同步，否则旧配置缺失新字段时为 undefined。
  modelType: 'sdxl' as const,
  nlPromptTemplate: 'A portrait of a character. {traits} The character has {emotion}, looking at the viewer. High quality, detailed.',
  txt2imgWidth: 1024,
  txt2imgHeight: 1024,
  selectedLoras: [],
  // 【Hires.fix】默认开启修复与放大
  hrFixEnabled: true,
  hrUpscaler: '4x-AnimeSharp',
  hrSteps: 50,
  hrScale: 2.0,
  hrDenoisingStrength: 0.55,
  hrPrompt: '',
  hrNegativePrompt: '',
  hrCfg: 5.0,
  hrSamplerName: 'DPM++ 2M SDE',
  hrScheduler: 'Karras',
  img2imgExtraNoise: 0.05,
  initialNoiseMultiplier: 1.0,
  // 【img2img 高清模式】默认两步放大（768→1024）
  img2imgHiresMode: 'two-step',
};

/** data URI 前缀（用于在浏览器中展示 base64 图片） */
const PNG_DATA_URI_PREFIX = 'data:image/png;base64,';

/**
 * 模型类型 → 展示标签 + Tag 颜色映射（Spec: integrate-nl-driven-sd-models / Task 6.1）。
 * - sdxl → "SDXL"，蓝色
 * - qwen-image-edit → "Qwen-Image-Edit"，绿色（推荐）
 * - qwen-image / flux2 → 橙色
 */
const MODEL_TYPE_DISPLAY: Record<string, { label: string; color: string }> = {
  'sdxl': { label: 'SDXL', color: 'blue' },
  'qwen-image': { label: 'Qwen-Image', color: 'orange' },
  'qwen-image-edit': { label: 'Qwen-Image-Edit', color: 'green' },
  'flux2': { label: 'Flux2', color: 'orange' },
};

// ==================== 组件实现 ====================

const ExpressionGenerateModal: React.FC<ExpressionGenerateModalProps> = ({
  open,
  characterCardId,
  characterName,
  avatarPath,
  mode,
  targetEmotionKey,
  targetEmotionLabel,
  onClose,
  onGenerated,
}) => {
  // ====== Store 订阅 ======
  const saveExpression = useExpressionStore(s => s.saveExpression);
  const loadExpressions = useExpressionStore(s => s.loadExpressions);
  // 订阅 manifest 以获取自定义情绪及其 AI 生成提示词（Spec: enhance-custom-emotion-system）
  const manifest = useExpressionStore(s => s.manifest);

  // 【重点标记 - 按角色独立存储 LoRA（2026-07-29 bug 修复）】
  // LoRA 配置不再从全局 setting.sdWebui.selectedLoras 读取，而是按角色卡独立存储，
  // 避免 A 角色选择的 LoRA 污染 B 角色的生成。
  const characterLoras = useCharacterLoraStore(s => s.loras);
  const loadCharacterLoras = useCharacterLoraStore(s => s.loadLoras);
  const saveCharacterLoras = useCharacterLoraStore(s => s.saveLoras);

  // 【重点标记 - 角色特征缓存 Bug 修复（2026-07-29）】
  // 原实现 characterTraits 始终传 undefined（遗留 TODO），导致表情生成不携带角色特征。
  // 现订阅 characterTraitStore，与 AssetManagerModal 特征 Tab 共享 state，
  // init 时仅当 store 未加载当前角色 traits 时才 loadTraits。
  const characterTraits = useCharacterTraitStore(s => s.traits);
  const traitStoreCardId = useCharacterTraitStore(s => s.currentCharacterCardId);
  const loadStoreTraits = useCharacterTraitStore(s => s.loadTraits);

  // 【Spec: add-trait-category-grouping / Task 6 下游适配】
  // store.traits 升级为 CharacterTraitItem[] 后，下游 PromptBuilder / sdGenerationService
  // 接收 Array<{ text: string; weight?: number }>。这里派生「启用特征的结构化数组」，
  // 与 AssetGenerateModal 一致，覆盖表情生成（single-expression / batch-expression）两条路径。
  // 仅 enabled=true 的特征被拼接为 SD 提示词，实现跨分类组合选择。
  // 【Spec: add-sdxl-prompt-weight-support / Task 3.4】透传 weight 到下游 SD 生成管线。
  const enabledTraitTexts: Array<{ text: string; weight?: number }> = useMemo(
    () =>
      characterTraits
        .filter((t) => t.enabled)
        .map((t) => ({ text: t.text, weight: t.weight })),
    [characterTraits],
  );

  // ====== 基础状态 ======
  /** SD WebUI 配置（来自 setting.load()） */
  const [sdConfig, setSdConfig] = useState<SDWebuiConfig>(DEFAULT_SD_CONFIG);
  /** SD WebUI 连接状态 */
  const [sdStatus, setSdStatus] = useState<SdStatus>('unknown');
  /** SD WebUI 不可用时的错误信息 */
  const [sdError, setSdError] = useState<string | null>(null);
  /** ADetailer 扩展可用性（checkStatus 返回） */
  const [adetailerAvailable, setAdetailerAvailable] = useState<boolean | null>(null);
  /** 初始化加载中（读取设置 / 检测 SD） */
  const [initializing, setInitializing] = useState<boolean>(false);

  // ====== 批量模式状态 ======
  const [batchStage, setBatchStage] = useState<BatchStage>('idle');
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  /** 实时统计（在 progress 事件中累计） */
  const statsRef = useRef<{ success: number; failed: number; skipped: number }>({
    success: 0,
    failed: 0,
    skipped: 0,
  });
  const [stats, setStats] = useState<{ success: number; failed: number; skipped: number }>({
    success: 0,
    failed: 0,
    skipped: 0,
  });

  // ====== 单个模式状态 ======
  const [singleStage, setSingleStage] = useState<SingleStage>('idle');
  /** 生成的图片 base64（含 data URI 前缀，可直接用于 <img src>） */
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  /** 单个生成的错误信息 */
  const [singleError, setSingleError] = useState<string | null>(null);
  /** 单个生成的警告信息（成功时可能附带，如 qwen-image-edit denoising 偏低提示） */
  const [singleWarning, setSingleWarning] = useState<string | null>(null);
  /** 单个模式：可编辑的正面提示词（用户可修改后再生） */
  const [singlePositivePrompt, setSinglePositivePrompt] = useState<string>('');
  /** 单个模式：可编辑的负面提示词（用户可修改后再生） */
  const [singleNegativePrompt, setSingleNegativePrompt] = useState<string>('');
  /** LoRA 选择弹窗开关（Spec: add-lora-model-selection / Task 6） */
  const [loraModalOpen, setLoraModalOpen] = useState(false);

  /**
   * 用户自定义输出尺寸（2026-07-29 新增）
   *
   * 每次生成独立应用，不写入全局设置。初始值从 sdConfig.txt2imgWidth/Height 读取（默认 1024×1024），
   * 弹窗关闭时重置为默认值。buildSdOptions 时同时传递 txt2imgWidth/Height（txt2img 路径）
   * 和 width/height（img2img 路径覆盖宽高比推导）。
   */
  const [selectedSize, setSelectedSize] = useState<{ width: number; height: number }>({
    width: 1024,
    height: 1024,
  });

  // ====== 初始化加载（open 时拉取 SD 配置 / 检测 SD 状态） ======
  useEffect(() => {
    if (!open || !characterCardId) return;

    let cancelled = false;
    setInitializing(true);
    setSdStatus('checking');
    setSdError(null);
    setAdetailerAvailable(null);

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
          console.warn('[ExpressionGenerateModal] 加载 SD 设置失败，使用默认值:', e);
        }
        if (cancelled) return;
        setSdConfig(config);

        // 初始化用户自定义尺寸：从设置默认值读取（2026-07-29 新增）
        setSelectedSize({
          width: config.txt2imgWidth ?? 1024,
          height: config.txt2imgHeight ?? 1024,
        });

        // 【重点标记 - 按角色独立存储 LoRA（2026-07-29 bug 修复）】
        // 读取当前角色卡专属的 LoRA 配置，替代全局 setting.sdWebui.selectedLoras。
        // 这是修复"A角色LoRA污染B角色"bug 的关键：每个角色维护独立的 LoRA 列表。
        try {
          await loadCharacterLoras(characterCardId);
        } catch (e) {
          console.warn('[ExpressionGenerateModal] 读取角色 LoRA 失败:', e);
        }

        // 【角色特征缓存 Bug 修复（2026-07-29）】
        // 加载角色特征到 characterTraitStore，仅当 store 未加载当前角色时才读取磁盘。
        // 与 AssetManagerModal 特征 Tab 共享 store state，实时同步未保存的修改。
        try {
          if (traitStoreCardId !== characterCardId) {
            await loadStoreTraits(characterCardId);
          }
        } catch (e) {
          console.warn('[ExpressionGenerateModal] 读取角色特征失败:', e);
        }

        // 2. 检测 SD WebUI 状态（含 ADetailer 可用性检测）
        try {
          const statusResult = await window.electronAPI.sd.checkStatus(config.endpoint);
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
  }, [open, characterCardId, loadCharacterLoras, traitStoreCardId, loadStoreTraits]);

  // ====== 单个模式：初始化时构建提示词预览 + 可编辑提示词 ======
  // 【重点标记 - 多模型类型提示词分流（Spec: integrate-nl-driven-sd-models / Task 6.2/6.5）】
  // 与 buildEmotionPrompt 一致，根据 modelType 选择 NL / tag 风格提示词构建器。
  useEffect(() => {
    if (!open || mode !== 'single' || !targetEmotionKey) {
      setSinglePositivePrompt('');
      setSingleNegativePrompt('');
      return;
    }
    // 找到预置情绪标签（若 targetEmotionKey 在预置列表中）
    const preset = EMOTION_PRESETS.find((e) => e.key === targetEmotionKey);
    const customLabel = targetEmotionLabel || preset?.label;
    // 查找自定义情绪的 AI 生成提示词（Spec: enhance-custom-emotion-system）
    const customEmotion = manifest?.customEmotions?.find((e) => e.key === targetEmotionKey);
    const customPrompts = customEmotion?.prompts;
    // 【角色特征缓存 Bug 修复（2026-07-29）】传入实际角色特征（原为 undefined 遗留 TODO）
    const isNLModel = sdConfig.modelType !== 'sdxl';
    const { prompt, negativePrompt } = isNLModel
      ? buildNLExpressionPrompt(targetEmotionKey, {
          nlPromptTemplate: sdConfig.nlPromptTemplate,
          customNegativePrompt: sdConfig.customNegativePrompt,
          customLabel,
          customNlPrompt: customPrompts?.nlPrompt,
          characterTraits: enabledTraitTexts,
          modelType: sdConfig.modelType,
        })
      : buildExpressionGenerationPrompt(targetEmotionKey, {
          positivePromptTemplate: sdConfig.positivePromptTemplate,
          customNegativePrompt: sdConfig.customNegativePrompt,
          customLabel,
          customPrompts: customPrompts
            ? { positive: customPrompts.positive, negative: customPrompts.negative }
            : undefined,
          characterTraits: enabledTraitTexts,
        });
    // 初始化可编辑提示词（用户可在此基础上修改后再生）
    setSinglePositivePrompt(prompt);
    setSingleNegativePrompt(negativePrompt);
  }, [
    open,
    mode,
    targetEmotionKey,
    targetEmotionLabel,
    sdConfig.modelType,
    sdConfig.nlPromptTemplate,
    sdConfig.positivePromptTemplate,
    sdConfig.customNegativePrompt,
    enabledTraitTexts,
    manifest,
  ]);

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
      setSingleWarning(null);
      setSinglePositivePrompt('');
      setSingleNegativePrompt('');
      setAdetailerAvailable(null);
      // 重置自定义尺寸为默认值（2026-07-29 新增）
      setSelectedSize({ width: 1024, height: 1024 });
    }
  }, [open]);

  // ====== 卸载时清理 IPC 监听器 ======
  useEffect(() => {
    return () => {
      try {
        window.electronAPI?.sd?.removeProgressListeners?.();
      } catch (e) {
        console.warn('[ExpressionGenerateModal] cleanup removeProgressListeners failed:', e);
      }
    };
  }, []);

  // ====== 构建单个情绪的 prompt + negativePrompt（批量模式使用） ======
  // 【重点标记 - 多模型类型提示词分流（Spec: integrate-nl-driven-sd-models / Task 6.2）】
  // 根据 sdConfig.modelType 选择提示词构建器：
  //   - sdxl → buildExpressionGenerationPrompt（tag 风格）
  //   - qwen-image / qwen-image-edit / flux2 → buildNLExpressionPrompt（自然语言风格）
  const buildEmotionPrompt = useCallback(
    (emotionKey: string, label?: string) => {
      // 【角色特征缓存 Bug 修复（2026-07-29）】传入实际角色特征（原为 undefined 遗留 TODO）
      // 查找自定义情绪的 AI 生成提示词（Spec: enhance-custom-emotion-system）
      const customEmotion = manifest?.customEmotions?.find((e) => e.key === emotionKey);
      const customPrompts = customEmotion?.prompts;
      const isNLModel = sdConfig.modelType !== 'sdxl';
      const { prompt, negativePrompt } = isNLModel
        ? buildNLExpressionPrompt(emotionKey, {
            nlPromptTemplate: sdConfig.nlPromptTemplate,
            customNegativePrompt: sdConfig.customNegativePrompt,
            customLabel: label,
            customNlPrompt: customPrompts?.nlPrompt,
            characterTraits: enabledTraitTexts,
            modelType: sdConfig.modelType,
          })
        : buildExpressionGenerationPrompt(emotionKey, {
            positivePromptTemplate: sdConfig.positivePromptTemplate,
            customNegativePrompt: sdConfig.customNegativePrompt,
            customLabel: label,
            customPrompts: customPrompts
              ? { positive: customPrompts.positive, negative: customPrompts.negative }
              : undefined,
            characterTraits: enabledTraitTexts,
          });
      return { key: emotionKey, prompt, negativePrompt };
    },
    [
      sdConfig.modelType,
      sdConfig.nlPromptTemplate,
      sdConfig.positivePromptTemplate,
      sdConfig.customNegativePrompt,
      enabledTraitTexts,
      manifest,
    ],
  );

  // ====== 构建 SD 生成选项（传给 IPC 的 options 字段） ======
  // 【重点标记 - ADetailer-Neo 兼容性 + 参数扩展（2026-07-27）】
  // 早期版本仅传 denoisingStrength/steps/cfgScale/adetailerEnabled/model，
  // 缺少 sampler 与 ADetailer 高级参数，导致采样器固定 + ADetailer args 字段名错误报错。
  // 现透传全部 SDWebuiConfig 字段，由 sdGenerationService 读取并构建 img2img 请求体。
  const buildSdOptions = useCallback(() => {
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
      adScheduler: sdConfig.adScheduler,
      adNegativePrompt: sdConfig.adNegativePrompt,
      adUseNoiseMultiplier: sdConfig.adUseNoiseMultiplier,
      adNoiseMultiplier: sdConfig.adNoiseMultiplier,
      // 【重点标记 - Furry/拟人生物面部识别扩展（2026-08-07）】
      // 仅 YOLO-World 系列模型生效，透传到 sdGenerationService 条件写入 ad_model_classes
      adModelClasses: sdConfig.adModelClasses,
      // NL 模型相关（Spec: integrate-nl-driven-sd-models / Task 6.4）
      // modelType 由 sdGenerationService.generateExpression 读取以分流生成路径；
      // txt2imgWidth/txt2imgHeight 供 qwen-image / flux2 txt2img 路径使用。
      modelType: sdConfig.modelType,
      // 【2026-07-29 新增 - 用户自定义尺寸】使用弹窗内 SizeSelector 选择的尺寸，
      // 替代全局 sdConfig.txt2imgWidth/Height。每次生成独立应用，不写入全局设置。
      txt2imgWidth: selectedSize.width,
      txt2imgHeight: selectedSize.height,
      // img2img 路径尺寸覆盖：传入 width/height 后 calculateImg2ImgDimensions
      // 将跳过宽高比推导，直接使用用户指定尺寸（two-step 模式按比例缩放中间步骤）
      width: selectedSize.width,
      height: selectedSize.height,
      // 【角色特征缓存 Bug 修复（2026-07-29）】
      // 原为 undefined（遗留 TODO），导致表情生成不携带角色特征。
      // 现从 characterTraitStore 读取，与 AssetManagerModal 特征 Tab 共享 state。
      characterTraits: enabledTraitTexts,
      // LoRA 模型选择（Spec: add-lora-model-selection / Task 6）
      // 【重点标记 - 按角色独立存储 LoRA（2026-07-29 bug 修复）】
      // 使用角色卡专属的 LoRA 列表，而非全局 setting.sdWebui.selectedLoras，
      // 确保每个角色使用各自的 LoRA 模型，杜绝跨角色污染。
      selectedLoras: characterLoras,
      // 【Hires.fix 修复与放大】透传高分辨率修复参数
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
      // 【img2img 高清模式】透传模式选择
      img2imgHiresMode: sdConfig.img2imgHiresMode,
    };
  }, [sdConfig, characterLoras, selectedSize, enabledTraitTexts]);

  // ====== 批量生成：开始 ======
  const handleBatchStart = useCallback(async () => {
    if (!characterCardId) {
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
      console.warn('[ExpressionGenerateModal] removeProgressListeners before batch:', e);
    }

    // 重置统计与状态
    statsRef.current = { success: 0, failed: 0, skipped: 0 };
    setStats({ success: 0, failed: 0, skipped: 0 });
    setBatchProgress(null);
    setBatchSummary(null);
    setBatchStage('generating');

    // 1. 为全部预置情绪 + 自定义情绪构建提示词（Spec: enhance-custom-emotion-system）
    const customEmotions = manifest?.customEmotions ?? [];
    const emotions = [
      ...EMOTION_PRESETS.map(({ key, label }) =>
        buildEmotionPrompt(key, label),
      ),
      ...customEmotions.map(({ key, label }) =>
        buildEmotionPrompt(key, label),
      ),
    ];

    // 2. 注册进度监听
    try {
      window.electronAPI.sd.onGenerationProgress((data: BatchProgress) => {
        setBatchProgress(data);
        // 累计统计
        if (data.status === 'success') {
          statsRef.current.success += 1;
          // 立即保存（不等全部完成）
          if (data.imageBase64 && data.emotionKey) {
            const dataUrl = data.imageBase64.startsWith(PNG_DATA_URI_PREFIX)
              ? data.imageBase64
              : PNG_DATA_URI_PREFIX + data.imageBase64;
            // 判断是否为自定义情绪（Spec: enhance-custom-emotion-system）
            const isCustom = !EMOTION_PRESETS.some((e) => e.key === data.emotionKey);
            const customEmotion = customEmotions.find((e) => e.key === data.emotionKey);
            saveExpression(
              characterCardId,
              data.emotionKey,
              dataUrl,
              isCustom,
              customEmotion?.label,
            ).catch((e) => {
              console.warn(
                '[ExpressionGenerateModal] 批量生成中保存表情失败:',
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
          console.warn('[ExpressionGenerateModal] loadExpressions after batch:', e);
        });
        onGenerated?.();
        // 清理监听器
        try {
          window.electronAPI.sd.removeProgressListeners();
        } catch (e) {
          console.warn('[ExpressionGenerateModal] removeProgressListeners after complete:', e);
        }
      });
    } catch (e) {
      console.error('[ExpressionGenerateModal] 注册进度监听失败:', e);
      message.error('注册进度监听失败');
      setBatchStage('idle');
      return;
    }

    // 3. 启动生成
    // 注意：onGenerationProgress / onGenerationComplete 监听器在上方已注册，
    // generateAllExpressions 的 Promise resolve 时，进度事件通常已全部推送完毕；
    // 此处仅 await 以捕获启动异常（如 IPC 通道未注册等），无需处理返回值——
    // 完成汇总由 onGenerationComplete 闭包处理。
    try {
      await window.electronAPI.sd.generateAllExpressions({
        characterCardPath: characterCardId,
        emotions,
        options: buildSdOptions(),
      });
    } catch (e) {
      console.error('[ExpressionGenerateModal] generateAllExpressions 异常:', e);
      message.error(`启动批量生成失败: ${e instanceof Error ? e.message : String(e)}`);
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
    sdStatus,
    buildEmotionPrompt,
    buildSdOptions,
    saveExpression,
    loadExpressions,
    onGenerated,
    manifest,
  ]);

  // ====== 批量生成：取消 ======
  const handleBatchCancel = useCallback(async () => {
    try {
      await window.electronAPI.sd.cancelGeneration();
      message.info('已发送取消请求，正在等待当前生成完成...');
    } catch (e) {
      console.error('[ExpressionGenerateModal] cancelGeneration 异常:', e);
      message.error('取消失败');
    }
  }, []);

  // ====== 单个生成：开始 ======
  const handleSingleGenerate = useCallback(async () => {
    if (!characterCardId || !targetEmotionKey) {
      message.warning('未指定目标情绪');
      return;
    }
    if (sdStatus !== 'available') {
      message.error('SD WebUI 不可用，无法生成');
      return;
    }

    setSingleStage('generating');
    setGeneratedImage(null);
    setSingleError(null);
    setSingleWarning(null);

    try {
      const preset = EMOTION_PRESETS.find((e) => e.key === targetEmotionKey);
      const customLabel = targetEmotionLabel || preset?.label;

      // 【重点标记 - 提示词可编辑】使用用户编辑后的提示词，而非自动构建的
      const prompt = singlePositivePrompt.trim() || buildEmotionPrompt(targetEmotionKey, customLabel).prompt;
      const negativePrompt = singleNegativePrompt;

      const result = await window.electronAPI.sd.generateExpression({
        characterCardPath: characterCardId,
        emotionKey: targetEmotionKey,
        prompt,
        negativePrompt,
        options: buildSdOptions(),
      });

      if (result?.success && result.imageBase64) {
        const dataUrl = result.imageBase64.startsWith(PNG_DATA_URI_PREFIX)
          ? result.imageBase64
          : PNG_DATA_URI_PREFIX + result.imageBase64;
        setGeneratedImage(dataUrl);
        // 【重点标记 - 生成结果警告（Spec: integrate-nl-driven-sd-models / Task 6.6）】
        // SDGenerationResult 可能附带 warning（如 qwen-image-edit denoising < 0.9），
        // 生成成功时展示为 Alert 提示用户参数可能需要调整。
        if (result.warning) {
          setSingleWarning(result.warning);
        }
        setSingleStage('success');
      } else {
        setSingleError(result?.error || '生成失败');
        setSingleStage('failed');
      }
    } catch (e) {
      console.error('[ExpressionGenerateModal] generateExpression 异常:', e);
      setSingleError(e instanceof Error ? e.message : String(e));
      setSingleStage('failed');
    }
  }, [
    characterCardId,
    targetEmotionKey,
    targetEmotionLabel,
    sdStatus,
    singlePositivePrompt,
    singleNegativePrompt,
    buildEmotionPrompt,
    buildSdOptions,
  ]);

  // ====== 单个生成：保存 ======
  const handleSingleSave = useCallback(async () => {
    if (!characterCardId || !targetEmotionKey || !generatedImage) {
      message.warning('无生成结果可保存');
      return;
    }

    // 判断是否为自定义情绪（不在预置列表中）
    const isCustom = !EMOTION_PRESETS.some((e) => e.key === targetEmotionKey);
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
      // 刷新 store
      loadExpressions(characterCardId).catch((e) => {
        console.warn('[ExpressionGenerateModal] loadExpressions after save:', e);
      });
      onGenerated?.();
      onClose();
    } else {
      message.error(result.error || '保存表情失败');
    }
  }, [
    characterCardId,
    targetEmotionKey,
    targetEmotionLabel,
    generatedImage,
    saveExpression,
    loadExpressions,
    onGenerated,
    onClose,
  ]);

  // ====== 单个生成：重新生成 ======
  const handleRegenerate = useCallback(() => {
    setGeneratedImage(null);
    setSingleError(null);
    setSingleWarning(null);
    setSingleStage('idle');
    // 直接调用生成
    handleSingleGenerate();
  }, [handleSingleGenerate]);

  // ====== 渲染辅助 ======

  /** 当前正在生成的情绪标签（从预置/自定义列表查找） */
  const currentEmotionLabel = batchProgress
    ? EMOTION_PRESETS.find((e) => e.key === batchProgress.emotionKey)?.label ||
      manifest?.customEmotions?.find((e) => e.key === batchProgress.emotionKey)?.label ||
      batchProgress.emotionKey
    : '';

  /** 单个模式标题中的情绪标签 */
  const singleEmotionLabel =
    targetEmotionLabel ||
    EMOTION_PRESETS.find((e) => e.key === targetEmotionKey)?.label ||
    manifest?.customEmotions?.find((e) => e.key === targetEmotionKey)?.label ||
    targetEmotionKey ||
    '';

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
          <span style={{ marginLeft: 6, opacity: 0.7 }}>| {sdConfig.model}</span>
        )}
      </Tag>
    );
  };

  /** 顶部信息栏：头像 + 角色名 + SD 状态 */
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
      {/* 默认头像预览 */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          overflow: 'hidden',
          flexShrink: 0,
          border: '1px solid var(--primary-color, #6366f1)',
          background: '#0f0f1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {avatarPath ? (
          <img
            src={avatarPath}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ color: '#cbd5e1', fontSize: 16, fontWeight: 600 }}>
            {characterName.charAt(0).toUpperCase() || '?'}
          </span>
        )}
      </div>

      {/* 角色名 + 描述摘要 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: 'var(--text-primary, #e2e8f0)', fontSize: 13, fontWeight: 500 }}>
          {characterName}
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
          {(() => {
            const isNL = sdConfig.modelType !== 'sdxl';
            const tmpl = isNL ? sdConfig.nlPromptTemplate : sdConfig.positivePromptTemplate;
            return tmpl
              ? (isNL ? 'NL提示词模板: ' : '提示词模板: ') + tmpl.slice(0, 60) + (tmpl.length > 60 ? '...' : '')
              : '（使用默认提示词模板）';
          })()}
        </div>
      </div>

      {/* SD 状态指示器 */}
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
              <p style={{ margin: '4px 0', color: '#fca5a5', whiteSpace: 'pre-line' }}>详细错误：{sdError}</p>
            )}
            <p style={{ margin: '4px 0' }}>
              可在「设置 → Stable Diffusion」中修改端点 URL 与生成参数。
            </p>
          </div>
        }
      />
    );
  };

  /** ADetailer 未安装警告（SD 可用但 ADetailer 扩展未检测到时显示） */
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

  /**
   * 模型类型相关提示（Spec: integrate-nl-driven-sd-models / Task 6.3）。
   * - qwen-image-edit：denoising < 0.9 时显示警告（编辑效果可能不佳）
   * - qwen-image：文生图模式，提示不需要基底图片
   * 仅在 SD 可用时展示，对 batch / single 两种模式均生效。
   */
  const renderModelTypeAlerts = () => {
    if (sdStatus !== 'available') return null;

    // qwen-image-edit：denoising 偏低警告
    if (
      sdConfig.modelType === 'qwen-image-edit' &&
      typeof sdConfig.denoisingStrength === 'number' &&
      sdConfig.denoisingStrength < 0.9
    ) {
      return (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="去噪强度偏低"
          description={
            <div style={{ fontSize: 12 }}>
              <p style={{ margin: '4px 0' }}>
                qwen-image-edit 模型推荐 denoising ≥ 0.9（当前 {sdConfig.denoisingStrength}），
                过低可能导致编辑效果不佳、表情变化不明显。请在「设置 → Stable Diffusion」中调高去噪强度。
              </p>
            </div>
          }
        />
      );
    }

    // qwen-image：文生图模式提示
    if (sdConfig.modelType === 'qwen-image') {
      return (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="此模型为文生图模式，不需要基底图片"
          description={
            <div style={{ fontSize: 12 }}>
              <p style={{ margin: '4px 0' }}>
                qwen-image 为文生图（txt2img）模型，生成时不会使用角色卡基底图片，
                而是根据提示词从零生成。角色一致性主要依赖提示词中的特征描述。
              </p>
            </div>
          }
        />
      );
    }

    return null;
  };

  /** 批量模式主体 UI */
  const renderBatchMode = () => {
    // 生成完成（或取消）后的汇总
    if (batchStage === 'complete' || batchStage === 'cancelled') {
      const totalEmotions = EMOTION_PRESETS.length + (manifest?.customEmotions?.length ?? 0);
      const summary = batchSummary || {
        total: totalEmotions,
        success: stats.success,
        failed: stats.failed,
        cancelled: batchStage === 'cancelled' ? totalEmotions - stats.success - stats.failed : 0,
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
          <div style={{ color: 'var(--text-primary, #e2e8f0)', fontSize: 16, fontWeight: 500 }}>
            {batchStage === 'cancelled' ? '生成已取消' : '生成完成'}
          </div>
          <div style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 13 }}>
            成功 <strong style={{ color: '#34d399' }}>{summary.success}</strong> 张 ｜
            失败 <strong style={{ color: '#f87171' }}>{summary.failed}</strong> 张
            {summary.cancelled > 0 && (
              <>
                ｜ 跳过 <strong style={{ color: '#fbbf24' }}>{summary.cancelled}</strong> 张
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '12px 0' }}>
          {/* 进度条 */}
          <Progress
            percent={percent}
            status="active"
            strokeColor={{ from: '#6366f1', to: '#8b5cf6' }}
          />

          {/* 当前生成情绪 */}
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

          {/* 统计 */}
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

          {/* 取消按钮 */}
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '12px 0' }}>
        <Alert
          type="info"
          showIcon
          message="批量生成 31 个预置情绪表情"
          description={
            <div style={{ fontSize: 12 }}>
              将为该角色生成全部 31 个预置情绪（default / admiration / ... / cheerfulness）的表情图片，
              每张生成成功后会立即保存到角色卡表情目录。
              <br />
              预计耗时取决于 SD 速度，通常每张约 5-15 秒。
            </div>
          }
        />

        {/* 参数概览 */}
        <div
          style={{
            padding: 12,
            background: 'rgba(99, 102, 241, 0.08)',
            borderRadius: 8,
            border: '1px solid rgba(99, 102, 241, 0.2)',
            fontSize: 12,
            color: 'var(--text-secondary, #94a3b8)',
          }}
        >
          <Space size={[16, 4]} wrap>
            {/* 模型类型（Spec: integrate-nl-driven-sd-models / Task 6.1） */}
            <Tag color={(MODEL_TYPE_DISPLAY[sdConfig.modelType] || MODEL_TYPE_DISPLAY['sdxl']).color}>
              模型类型：{(MODEL_TYPE_DISPLAY[sdConfig.modelType] || MODEL_TYPE_DISPLAY['sdxl']).label}
            </Tag>
            <Tag>端点：{sdConfig.endpoint}</Tag>
            <Tag>步数：{sdConfig.steps}</Tag>
            <Tag>CFG：{sdConfig.cfgScale}</Tag>
            <Tag>采样器：{sdConfig.sampler || 'DPM++ 2M Karras'}</Tag>
            <Tag>去噪：{sdConfig.denoisingStrength}</Tag>
            <Tag color="geekblue">尺寸：{selectedSize.width}×{selectedSize.height}</Tag>
            {/* ADetailer 参数仅 SDXL 模型显示（NL 模型不使用 ADetailer，Task 6.3） */}
            {sdConfig.modelType === 'sdxl' && (
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
            )}
            <Tag
              color="cyan"
              style={{ cursor: 'pointer' }}
              onClick={() => setLoraModalOpen(true)}
            >
              LoRA：{characterLoras.length} 个
            </Tag>
            <Tag color="purple">特征：{characterTraits.length} 项</Tag>
            {sdConfig.model && <Tag>模型：{sdConfig.model}</Tag>}
          </Space>
        </div>

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

  /** 单个模式主体 UI */
  const renderSingleMode = () => {
    // 生成成功 - 展示结果预览
    if (singleStage === 'success' && generatedImage) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '12px 0' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: 12,
              background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
              borderRadius: 8,
            }}
          >
            <Image
              src={generatedImage}
              alt={singleEmotionLabel}
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
            message={`已生成「${singleEmotionLabel}」表情`}
            description="点击「保存」将图片写入角色卡表情目录；点击「重新生成」将丢弃当前结果重新生成。"
          />

          {/* 生成结果警告（Spec: integrate-nl-driven-sd-models / Task 6.6） */}
          {singleWarning && (
            <Alert
              type="warning"
              showIcon
              message="生成参数提示"
              description={singleWarning}
            />
          )}

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '12px 0' }}>
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
            tip="正在生成表情图片..."
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
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '12px 0' }}>
        <Alert
          type="info"
          showIcon
          message={`生成「${singleEmotionLabel}」表情`}
          description={sdConfig.modelType === 'qwen-image'
            ? '点击「生成」按钮，将通过 SD txt2img 文生图生成该情绪表情（不需要基底图片）。'
            : sdConfig.modelType === 'qwen-image-edit'
            ? '点击「生成」按钮，将通过 qwen-image-edit img2img 基于角色卡基底图片生成该情绪表情，模型视觉编码保证人物一致性。'
            : '点击「生成」按钮，将通过 SD img2img 基于角色卡基底图片生成该情绪表情。'}
        />

        {/* LoRA 模型选择入口（Spec: add-lora-model-selection / Task 6） */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Tag
            color="cyan"
            style={{ cursor: 'pointer' }}
            onClick={() => setLoraModalOpen(true)}
          >
            LoRA：{characterLoras.length} 个
          </Tag>
        </div>

        {/* 提示词预览 */}
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
            value={singlePositivePrompt}
            onChange={(e) => setSinglePositivePrompt(e.target.value)}
            autoSize={{ minRows: 3, maxRows: 6 }}
            style={{
              background: 'rgba(15, 15, 26, 0.6)',
              color: 'var(--text-primary, #e2e8f0)',
              borderColor: 'rgba(255, 255, 255, 0.1)',
            }}
          />
        </div>

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
            value={singleNegativePrompt}
            onChange={(e) => setSingleNegativePrompt(e.target.value)}
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
  const modalTitle =
    mode === 'batch'
      ? `AI 生成表情 - ${characterName}`
      : `AI 生成 - ${singleEmotionLabel}`;

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
        // 批量生成完成或单个生成成功/失败时由内部按钮控制关闭；
        // 其他状态下提供「关闭」按钮
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
            正在加载设置与检测 SD WebUI 状态...
          </span>
        </div>
      )}

      {/* 主体内容 */}
      {!initializing && (
        <>
          {renderHeader()}
          {/* 2026-07-29 新增 - 用户自定义输出尺寸选择器（batch / single 模式均可见） */}
          <SizeSelector
            width={selectedSize.width}
            height={selectedSize.height}
            onChange={(w, h) => setSelectedSize({ width: w, height: h })}
          />
          {renderSdUnavailableAlert()}
          {renderAdetailerWarning()}
          {renderModelTypeAlerts()}
          {mode === 'batch' ? renderBatchMode() : renderSingleMode()}
        </>
      )}

      {/* LoRA 模型选择弹窗（Spec: add-lora-model-selection / Task 6） */}
      {/* 【重点标记 - 按角色独立存储 LoRA（2026-07-29 bug 修复）】
          选择结果保存到当前角色卡专属存储，而非全局 setting.sdWebui.selectedLoras，
          确保不同角色使用各自的 LoRA 模型。 */}
      <LoraSelectModal
        open={loraModalOpen}
        endpoint={sdConfig.endpoint}
        selectedLoras={characterLoras}
        onConfirm={(loras) => {
          saveCharacterLoras(characterCardId, loras);
          setLoraModalOpen(false);
        }}
        onCancel={() => setLoraModalOpen(false)}
      />
    </Modal>
  );
};

export default ExpressionGenerateModal;
