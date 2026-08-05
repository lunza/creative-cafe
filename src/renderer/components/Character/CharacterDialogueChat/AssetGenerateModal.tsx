// Spec: add-asset-and-trait-management / Task 10
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
  Collapse,
  Select,
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
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  UndoOutlined,
  PlusOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import {
  EMOTION_PRESETS,
  buildAssetPromptTemplate,
  buildExpressionGenerationPrompt,
  buildNLExpressionPrompt,
} from './PromptBuilder';
import { useExpressionStore } from '../../../stores/expressionStore';
import { useAssetStore } from '../../../stores/assetStore';
import { useSettingStore } from '../../../stores/settingStore';
import { useCharacterLoraStore } from '../../../stores/characterLoraStore';
import { useCharacterTraitStore } from '../../../stores/characterTraitStore';
import {
  SYSTEM_TRAIT_CATEGORIES,
  UNCATEGORIZED_CATEGORY,
  genTraitId,
} from '@shared/types';
import type { CategorizedTrait, CharacterTraitItem, TraitCategory } from '@shared/types';
import type { SDWebuiConfig } from '../../../types/setting';
import LoraSelectModal from './LoraSelectModal';
import SizeSelector from './SizeSelector';

/**
 * AI 素材生成弹窗（Spec: add-asset-and-trait-management / Task 10）
 *
 * 职责：
 * - 扩展自 ExpressionGenerateModal，支持四种素材类型生成：
 *   - batch-expression：批量生成 31 个预置情绪表情（沿用原 ExpressionGenerateModal 逻辑）
 *   - single-expression：生成单个情绪表情（沿用原逻辑）
 *   - illustration：生成角色立绘（full body, standing）
 *   - general：生成一般场景图像（场景由动态场景方案下拉选择，Spec: fix-asset-trait-and-scene-defects / Task 6+7）
 *   - three-view：生成三视图（front / side / back，由 targetSlot 指定）
 * - 所有生成都自动携带角色特征（characterTraits），通过 `window.electronAPI.characterTrait.list`
 *   读取后透传到 options.characterTraits（generateExpression 与 generateTxt2Img 均读取）
 * - 生成成功后根据 mode 调用对应 store 保存：
 *   - 表情模式 → expressionStore.saveExpression
 *   - 立绘 / 一般图像 / 三视图 → assetStore.saveAsset
 *
 * 数据流：
 *   打开弹窗 → 加载 SD 设置 / 读取 characterTraits / 检测 SD 状态
 *   → 根据 mode 构建提示词模板（含 {traits} 占位符）
 *   → 用户点击「开始生成」
 *   → 按 mode 分流 IPC：
 *     - single-expression → sd.generateExpression（img2img，提取角色卡基底图变换表情）
 *     - illustration / general / three-view → sd.generateTxt2Img（纯文生图，提示词 + 角色 LoRA）
 *   → 监听 `sd:generationProgress` / `sd:generationComplete` 事件（仅 batch 模式）
 *   → 单次模式：等待 Promise resolve，展示结果预览
 *   → 完成后调用 onGenerated?.() 通知父组件刷新
 *
 * 【重点标记 - 素材生成走 txt2img（prompt + LoRA），不走 img2img】
 * illustration / general / three-view 直接调用 sd.generateTxt2Img，完全由提示词 +
 * 角色 LoRA 驱动，不使用角色卡基底图片作为图像参考（与立绘生成行为一致）。
 * 仅 single-expression 复用 sd.generateExpression（img2img）——表情生成需在已有
 * 角色图基础上变换表情，img2img 才能保持人物一致性。两条路径均由
 * sdGenerationService 内部调用 applyTraitsAndLora 处理 {traits} 占位符 + LoRA 注入。
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
   *  - batch-expression：批量生成 31 个预置情绪表情
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
  /** three-view 模式：目标槽位（含裸体变体，nude 后缀时自动过滤 clothing 分类特征） */
  targetSlot?: 'front' | 'side' | 'back' | 'front-nude' | 'side-nude' | 'back-nude';
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
  sampler: 'DPM++ 3M SDE',
  scheduler: 'Karras',
  clipSkip: 2,
  adetailerEnabled: true,
  positivePromptTemplate:
    'portrait, {traits}, looking at viewer, simple background, {emotion}, high quality, best quality, masterpiece, detailed face',
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
  // NL 模型相关
  modelType: 'sdxl',
  nlPromptTemplate:
    'A portrait of a character. {traits} The character has {emotion}, looking at the viewer. High quality, detailed.',
  txt2imgWidth: 1024,
  txt2imgHeight: 1024,
  // LoRA 模型选择（Spec: add-lora-model-selection / Task 5）
  selectedLoras: [],
  // 【Hires.fix】默认开启修复与放大，Upscaler=Latent，steps=50
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
  // 【img2img 高清模式】默认两步放大（768→1024），细节保留更好
  img2imgHiresMode: 'two-step',
};

/** data URI 前缀（用于在浏览器中展示 base64 图片） */
const PNG_DATA_URI_PREFIX = 'data:image/png;base64,';

// 注：`buildAssetPromptTemplate` 已迁移至 `./PromptBuilder`（Spec: add-dynamic-scene-prompt-generation / Task 7）
// 该函数扩展了 {clothing} / {pose} / {scene} 占位符，由 sdGenerationService.applyTraitsAndLora 替换（Task 8）

/**
 * 三视图槽位的中英文标签映射。
 */
const THREE_VIEW_SLOT_LABELS: Record<'front' | 'side' | 'back' | 'front-nude' | 'side-nude' | 'back-nude', string> = {
  front: '正视图',
  side: '侧视图',
  back: '背视图',
  'front-nude': '正视图（裸体）',
  'side-nude': '侧视图（裸体）',
  'back-nude': '背视图（裸体）',
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

/**
 * 从基础特征推断人物数量约束 tag（Spec: fix-asset-trait-and-scene-defects / Task 2）。
 *
 * 【重点标记 - 高分辨率约束】
 * 高分辨率（≥1024×1024）生成时 SD 模型倾向生成多个角色，需从基础特征推断性别
 * 并注入 `1girl` / `1boy` 约束人物数量为单个。
 *
 * 检测顺序（优先级从高到低）：
 *  1. 直接匹配 `1girl` / `1boy`（已是 SD 标准格式）
 *  2. 匹配 `female` / `male` → 转换为 `1girl` / `1boy`
 *  3. 匹配 `girl` / `boy` → 转换为 `1girl` / `1boy`
 *
 * 仅从 `categoryId='basic'` 的特征中查找，避免误匹配服装/场景中的关键词。
 * 返回 null 表示无法判断性别，调用方应不注入约束。
 *
 * @param traits 角色特征列表（含 enabled / categoryId 字段）
 * @returns `'1girl'` / `'1boy'` / `null`
 */
function detectGenderTag(traits: CharacterTraitItem[]): '1girl' | '1boy' | null {
  const basicTraits = traits.filter((t) => t.categoryId === 'basic' && t.enabled);
  const texts = basicTraits.map((t) => t.text.toLowerCase());

  // 优先级 1: 直接匹配
  if (texts.includes('1girl')) return '1girl';
  if (texts.includes('1boy')) return '1boy';

  // 优先级 2: female/male
  if (texts.includes('female')) return '1girl';
  if (texts.includes('male')) return '1boy';

  // 优先级 3: girl/boy
  if (texts.includes('girl')) return '1girl';
  if (texts.includes('boy')) return '1boy';

  return null;
}

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

  // 【重点标记 - 按角色独立存储 LoRA（2026-07-29 bug 修复）】
  // LoRA 配置不再从全局 setting.sdWebui.selectedLoras 读取，而是按角色卡独立存储，
  // 避免 A 角色选择的 LoRA 污染 B 角色的生成。
  const {
    loras: characterLoras,
    loadLoras: loadCharacterLoras,
    saveLoras: saveCharacterLoras,
  } = useCharacterLoraStore();

  // 【重点标记 - 角色特征缓存 Bug 修复（2026-07-29）】
  // 原实现通过 window.electronAPI.characterTrait.list() 直接 IPC 读取（从磁盘），
  // 导致用户在特征 Tab 中 addTrait/removeTrait/updateTrait 后（仅更新 store 未持久化），
  // 生成弹窗读取到的仍是磁盘旧数据。现改为订阅 characterTraitStore，
  // 与 AssetManagerModal 特征 Tab 共享同一 store state，实时同步未保存的修改。
  // init useEffect 中仅当 store 的 currentCharacterCardId 与当前角色不一致时才 loadTraits，
  // 避免覆盖 AssetManagerModal 中已加载（可能含未保存修改）的 traits。
  //
  // 【重点标记 - 动态场景字段订阅】Spec: add-dynamic-scene-prompt-generation / Task 8
  // 额外订阅 dynamicScenePrompts / activeDynamicScenePromptId，供 buildSdOptions 查找
  // 当前激活动态场景方案并填充 dynamicClothing / dynamicPose / dynamicScene 选项。
  // 【重点标记 - 动态场景下拉 UI】Spec: fix-asset-trait-and-scene-defects / Task 6
  // 额外订阅 applyDynamicScenePrompt action，供生成弹窗内的 <Select> 下拉切换激活方案，
  // 用户无需返回 AssetManagerModal 即可在生成时选择已保存的动态场景方案。
  const {
    traits: characterTraits,
    // 【Bug 修复 - Spec: fix-asset-trait-and-scene-defects §5.7】原订阅 customCategories（旧字段，
    // Task 4 后 store 不再写入新值），导致 renderTraitsPanel 的 allCategories 派生不包含新建的自定义分类。
    // 修复：改订阅 globalCategories（Task 4 引入的全局分类字典 state）。
    globalCategories: traitGlobalCategories,
    currentCharacterCardId: traitStoreCardId,
    dynamicScenePrompts,
    activeDynamicScenePromptId,
    applyDynamicScenePrompt,
    loadTraits: loadStoreTraits,
    setTraits: setStoreTraits,
  } = useCharacterTraitStore();

  // ====== 临时编辑态（不持久化）======
  // editedTraits 是 store characterTraits 的「工作副本」：
  //  - 弹窗打开时从 store 深拷贝初始化（仅复制对象，text 可被用户临时修改）
  //  - 用户在「携带角色特征」面板内修改 text / 切换 enabled / 新增临时标签 / 删除标签
  //    仅影响本次生成，不回写 store
  //  - null 表示尚未初始化（弹窗未打开 / 特征未加载），此时 effectiveTraits 回退为 store 原值
  //  - 关闭弹窗时置 null，下次打开重新从 store 同步（丢弃上次临时编辑 + 临时标签）
  const [editedTraits, setEditedTraits] = useState<CharacterTraitItem[] | null>(null);
  // 当前正在编辑文本的 trait id（进入行内 Input 模式）
  const [editingTraitId, setEditingTraitId] = useState<string | null>(null);
  // 行内 Input 的当前文本（编辑中暂存，Enter 提交 / Esc 取消）
  const [editingText, setEditingText] = useState<string>('');
  // 新增临时标签：正在输入的分类 id（null 表示无分类处于新增模式）
  const [addingCategoryId, setAddingCategoryId] = useState<string | null>(null);
  // 新增临时标签：Input 暂存的文本（Enter 提交 / Esc 取消）
  const [addingText, setAddingText] = useState<string>('');

  // effectiveTraits：实际用于 SD 生成与 UI 展示的特征列表
  //  - editedTraits 非空时使用工作副本（含用户临时编辑）
  //  - 否则回退到 store characterTraits（与原行为一致）
  const effectiveTraits: CharacterTraitItem[] = editedTraits ?? characterTraits;

  // 【Spec: add-trait-category-grouping / Task 6】characterTraits 现已是结构化 CharacterTraitItem[]，
  // 下游 SD 生成仅拼接 enabled=true 项的 text。此处派生 enabled 特征文本数组供
  // buildSdOptions / buildExpressionGenerationPrompt / buildNLExpressionPrompt 共用。
  // 【临时编辑支持】改用 effectiveTraits 派生，使临时修改的 text / enabled 生效于本次生成。
  // 【裸体三视图支持】当 targetSlot 为 *-nude 时，自动过滤 categoryId='clothing' 的特征，
  //   确保裸体版不携带衣物 tag（species / body / head 等基础特征保留）。
  const isNudeSlot = mode === 'three-view' && !!targetSlot?.endsWith('-nude');
  const enabledTraitTexts = useMemo(
    () =>
      effectiveTraits
        .filter((t) => t.enabled && (!isNudeSlot || t.categoryId !== 'clothing'))
        .map((t) => t.text),
    [effectiveTraits, isNudeSlot],
  );

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

  /** 特征读取错误信息（null 表示无错误）— 仅记录 init 阶段的加载错误 */
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
  /**
   * 生成图片历史（base64，含 data URI 前缀，可直接用于 <img src>）。
   * 每次生成成功追加一张，支持上一张/下一张浏览。关闭弹窗时清空。
   */
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  /** 当前预览的图片在 generatedImages 中的索引（-1 = 无图片） */
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(-1);
  /** 当前预览的图片（派生值，兼容旧代码中所有引用 generatedImage 的位置） */
  const generatedImage = generatedImages[currentImageIndex] ?? null;
  /** 单次生成的错误信息 */
  const [singleError, setSingleError] = useState<string | null>(null);
  /** 可编辑的正面提示词（用户可修改后再生） */
  const [positivePrompt, setPositivePrompt] = useState<string>('');
  /** 可编辑的负面提示词（用户可修改后再生） */
  const [negativePrompt, setNegativePrompt] = useState<string>('');
  /**
   * general 模式下用户输入的场景描述。
   *
   * @deprecated Spec: fix-asset-trait-and-scene-defects / Task 7
   *   由动态场景下拉选择替代，不再由用户输入。保留 state 声明（默认空字符串）仅作为
   *   `buildAssetPromptTemplate` 的兼容参数传递，避免破坏调用方签名。state 不再由
   *   用户输入更新（userScene 文本输入框已移除，由动态场景 <Select> 下拉替代）。
   */
  const [userScene, setUserScene] = useState<string>('');
  /** LoRA 选择弹窗开关（Spec: add-lora-model-selection / Task 5） */
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

        // 初始化用户自定义尺寸：从设置默认值读取（2026-07-29 新增）
        setSelectedSize({
          width: config.txt2imgWidth ?? 1024,
          height: config.txt2imgHeight ?? 1024,
        });

        // 2. 读取角色特征（Spec: add-asset-and-trait-management / Task 10）
        // 【重点标记 - 角色特征缓存 Bug 修复（2026-07-29）】
        // 改为订阅 characterTraitStore（与 AssetManagerModal 特征 Tab 共享 state），
        // 仅当 store 未加载当前角色的 traits 时才从磁盘读取，
        // 避免覆盖 AssetManagerModal 中已加载（可能含未保存修改）的 traits。
        try {
          if (traitStoreCardId !== characterCardId) {
            await loadStoreTraits(characterCardId);
          }
          if (cancelled) return;
          setTraitsError(null);
        } catch (e) {
          if (cancelled) return;
          console.warn('[AssetGenerateModal] 读取角色特征失败:', e);
          setTraitsError(
            e instanceof Error ? e.message : '读取角色特征失败',
          );
        }

        // 【重点标记 - 按角色独立存储 LoRA（2026-07-29 bug 修复）】
        // 读取当前角色卡专属的 LoRA 配置，替代全局 setting.sdWebui.selectedLoras。
        // 这是修复"A角色LoRA污染B角色"bug 的关键：每个角色维护独立的 LoRA 列表。
        try {
          await loadCharacterLoras(characterCardId);
        } catch (e) {
          console.warn('[AssetGenerateModal] 读取角色 LoRA 失败:', e);
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
  }, [open, characterCardId, loadCharacterLoras, traitStoreCardId, loadStoreTraits]);

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
            characterTraits: enabledTraitTexts,
            modelType: sdConfig.modelType,
          })
        : buildExpressionGenerationPrompt(
            targetEmotionKey,
            {
              positivePromptTemplate: sdConfig.positivePromptTemplate,
              customNegativePrompt: sdConfig.customNegativePrompt,
              customLabel,
              characterTraits: enabledTraitTexts,
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
    enabledTraitTexts,
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
      setGeneratedImages([]);
      setCurrentImageIndex(-1);
      setSingleError(null);
      setPositivePrompt('');
      setNegativePrompt('');
      setUserScene('');
      // 【角色特征缓存 Bug 修复】不再 reset characterTraits — 改为订阅 characterTraitStore，
      // store state 由 AssetManagerModal 管理，此处不应清空（避免影响其他订阅者）
      setTraitsError(null);
      setAdetailerAvailable(null);
      setImageRecognizing(false);
      // 重置自定义尺寸为默认值（2026-07-29 新增）
      setSelectedSize({ width: 1024, height: 1024 });
      // 【临时编辑态】关闭弹窗时丢弃工作副本与编辑态，下次打开重新从 store 同步
      setEditedTraits(null);
      setEditingTraitId(null);
      setEditingText('');
      setAddingCategoryId(null);
      setAddingText('');
    }
  }, [open]);

  // ====== 临时编辑态：初始化（弹窗打开 + store 特征加载后首次同步） ======
  // 仅在弹窗打开且 editedTraits 尚未初始化（null）时从 store 深拷贝一次。
  // 之后用户在面板内的编辑保留在 editedTraits 中，不随 store 变化覆盖（避免丢失临时修改）。
  // 用户可通过「重置」按钮手动重新同步。
  // 【0 特征支持】用 traitStoreCardId === characterCardId 判断 store 是否已加载当前角色的
  // 特征数据（而非 characterTraits.length > 0），确保即使角色卡 0 特征也能初始化为 []，
  // 允许用户在空分类下新增临时标签。
  useEffect(() => {
    if (open && editedTraits === null && traitStoreCardId === characterCardId) {
      setEditedTraits(
        characterTraits.map((t) => ({ ...t })),
      );
    }
  }, [open, characterTraits, editedTraits, traitStoreCardId, characterCardId]);

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
            characterTraits: enabledTraitTexts,
            modelType: sdConfig.modelType,
          })
        : buildExpressionGenerationPrompt(emotionKey, {
            positivePromptTemplate: sdConfig.positivePromptTemplate,
            customNegativePrompt: sdConfig.customNegativePrompt,
            customLabel: label,
            characterTraits: enabledTraitTexts,
          });
      return { key: emotionKey, prompt, negativePrompt: neg };
    },
    [sdConfig.positivePromptTemplate, sdConfig.customNegativePrompt, sdConfig.modelType, sdConfig.nlPromptTemplate, enabledTraitTexts],
  );

  // ====== 构建 SD 生成选项（传给 IPC 的 options 字段） ======
  // 【重点标记 - 特征携带机制】透传 characterTraits 到 options，
  // 由 sdGenerationService.generateExpression 内部替换 {traits} 占位符
  // 【Spec: add-trait-category-grouping / Task 6】characterTraits 改为传 enabled=true 项的 text 扁平化 string[]
  //
  // 【重点标记 - 动态场景字段透传】Spec: add-dynamic-scene-prompt-generation / Task 8
  // - 从 store 的 dynamicScenePrompts / activeDynamicScenePromptId 查找激活动态场景方案
  // - illustration 模式无激活方案时兜底：dynamicPose='standing' / dynamicScene='simple background'
  //   （保持与原模板 `full body, standing, ..., simple background` 一致的行为）
  // - general 模式无激活方案时：dynamicScene 保持 undefined（{scene} 替换为空字符串）
  //   【重点标记 - 移除 userScene 回退】Spec: fix-asset-trait-and-scene-defects / Task 7
  //   原 Task 8 引入的 `dynamicScene = userScene.trim()` 回退已移除：userScene 文本输入框
  //   已由动态场景下拉选择替代，无激活方案时 {scene} 占位符替换为空字符串（由
  //   applyTraitsAndLora 的字面替换 + 逗号清理处理），不再回退到用户输入的 userScene。
  // - three-view 模式：模板不含 {clothing} / {pose} / {scene} 占位符，三个字段透传 undefined 无副作用
  // - applyTraitsAndLora 仅做字面替换（undefined → 空字符串 + 逗号清理），兜底逻辑集中在此处
  const buildSdOptions = useCallback(() => {
    // 查找当前激活动态场景方案
    const activeDynamicScheme = activeDynamicScenePromptId
      ? dynamicScenePrompts.find((p) => p.id === activeDynamicScenePromptId)
      : undefined;

    // 从激活动态方案读取 clothing / pose / scene（无激活方案时为 undefined）
    let dynamicClothing = activeDynamicScheme?.clothing || undefined;
    let dynamicPose = activeDynamicScheme?.pose || undefined;
    let dynamicScene = activeDynamicScheme?.scene || undefined;

    // 模式特定的兜底逻辑（仅对含 {clothing} / {pose} / {scene} 占位符的模板生效）
    if (mode === 'illustration' && !activeDynamicScheme) {
      // 立绘模式无激活方案：兜底为 standing / simple background（保持原模板行为）
      // Spec MODIFIED Requirements: 「{pose} 兜底为 standing, {scene} 兜底为 simple background」
      if (!dynamicPose) dynamicPose = 'standing';
      if (!dynamicScene) dynamicScene = 'simple background';
    }
    // 【重点标记 - 移除 userScene 回退】Spec: fix-asset-trait-and-scene-defects / Task 7
    // 原 `else if (mode === 'general' && !dynamicScene && userScene.trim())` 分支已移除：
    // general 模式无激活方案时 dynamicScene 保持 undefined，{scene} 替换为空字符串。

    // ===== 高分辨率人物数量约束检测 =====
    // 【重点标记 - 高分辨率约束】Spec: fix-asset-trait-and-scene-defects / Task 2
    // 当分辨率 ≥ 1024×1024 时，SD 模型倾向生成多个角色，需从基础特征推断性别
    // 并注入 `1girl` / `1boy` 约束人物数量为单个。
    // - 使用 effectiveTraits（含用户临时编辑）确保与实际生成特征一致
    // - 基础特征已包含目标 tag 时不重复注入（避免 duplicate）
    // - 无法判断性别时仅记录警告日志，不注入（避免错误约束）
    let characterGenderTag: string | undefined;
    const pixelCount = selectedSize.width * selectedSize.height;
    if (pixelCount >= 1024 * 1024) {
      const genderTag = detectGenderTag(effectiveTraits);
      if (genderTag) {
        // 检查基础特征是否已包含该 tag（避免重复注入）
        const basicTraitTexts = effectiveTraits
          .filter((t) => t.categoryId === 'basic' && t.enabled)
          .map((t) => t.text.toLowerCase());
        if (!basicTraitTexts.includes(genderTag)) {
          characterGenderTag = genderTag;
        }
      } else {
        console.warn(
          '[AssetGenerateModal] 无法从基础特征推断性别，跳过人物数量约束注入',
        );
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
      // 【重点标记 - 特征携带机制】注入启用的角色特征 tag 数组（v2：仅 enabled=true 项的 text）
      characterTraits: enabledTraitTexts,
      // 【重点标记 - 高分辨率约束】Spec: fix-asset-trait-and-scene-defects / Task 2
      // 当分辨率 ≥ 1024×1024 时由上方 detectGenderTag 推断填充，
      // 由 sdGenerationService.applyTraitsAndLora 注入到 prompt 开头（避免重复）。
      characterGenderTag,
      // 【重点标记 - 动态场景字段透传】Spec: add-dynamic-scene-prompt-generation / Task 8
      // - undefined 时由 applyTraitsAndLora 替换为空字符串并清理多余逗号
      // - 已在上方根据 mode 与 activeDynamicScheme 完成兜底填充
      dynamicClothing,
      dynamicPose,
      dynamicScene,
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
      // NL 模型相关（Spec: integrate-nl-driven-sd-models）
      modelType: sdConfig.modelType,
      // 【2026-07-29 新增 - 用户自定义尺寸】使用弹窗内 SizeSelector 选择的尺寸，
      // 替代全局 sdConfig.txt2imgWidth/Height。每次生成独立应用，不写入全局设置。
      txt2imgWidth: selectedSize.width,
      txt2imgHeight: selectedSize.height,
      // img2img 路径尺寸覆盖：传入 width/height 后 calculateImg2ImgDimensions
      // 将跳过宽高比推导，直接使用用户指定尺寸（two-step 模式按比例缩放中间步骤）
      width: selectedSize.width,
      height: selectedSize.height,
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
      // 【img2img 高清模式】透传模式选择（direct / two-step）
      img2imgHiresMode: sdConfig.img2imgHiresMode,
    };
    // 【重点标记 - 动态场景依赖】Spec: add-dynamic-scene-prompt-generation / Task 8
    // 新增 dynamicScenePrompts / activeDynamicScenePromptId / mode 依赖：
    // - 用户在 AssetManagerModal 或本弹窗下拉切换激活动态场景方案 → 此处感知 → buildSdOptions 重算
    // - mode 决定兜底策略（illustration: standing/simple background; general: 无兜底）
    // 【重点标记 - 移除 userScene 依赖】Spec: fix-asset-trait-and-scene-defects / Task 7
    // userScene 不再作为 {scene} fallback 来源，从依赖数组中移除。
  }, [sdConfig, enabledTraitTexts, effectiveTraits, characterLoras, selectedSize, mode, dynamicScenePrompts, activeDynamicScenePromptId]);

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
      slot?: 'front' | 'side' | 'back' | 'front-nude' | 'side-nude' | 'back-nude',
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

    // 1. 为全部 31 个预置情绪构建提示词
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

    // general 模式无激活动态场景方案时仅警告，不阻断生成（{scene} 占位符替换为空字符串）
    // 【重点标记 - 移除 userScene 检查】Spec: fix-asset-trait-and-scene-defects / Task 7
    // 原 userScene.trim() 检查已移除（userScene 已废弃，始终为空字符串），
    // 改为检查 activeDynamicScenePromptId：无激活方案时 {scene} 替换为空字符串。
    if (mode === 'general' && !activeDynamicScenePromptId) {
      console.warn(
        '[AssetGenerateModal] general 模式未激活动态场景方案，{scene} 占位符将替换为空字符串',
      );
    }

    if (sdStatus !== 'available') {
      message.error('SD WebUI 不可用，无法生成');
      return;
    }

    setSingleStage('generating');
    // 不清空图片历史 — 重新生成时保留之前的图片供用户前后浏览
    setSingleError(null);

    try {
      // 根据模式确定 emotionKey（仅用于日志，实际生成由 prompt 控制）
      let promptToUse: string;
      let negativePromptToUse: string;

      if (mode === 'single-expression' && targetEmotionKey) {
        // 表情模式：prompt 复用 buildEmotionPrompt（或用户编辑后的）
        const preset = EMOTION_PRESETS.find((e) => e.key === targetEmotionKey);
        const customLabel = targetEmotionLabel || preset?.label;
        const built = buildEmotionPrompt(targetEmotionKey, customLabel);
        promptToUse = positivePrompt.trim() || built.prompt;
        negativePromptToUse = negativePrompt;
      } else {
        // 素材模式（illustration / general / three-view）：使用用户可编辑的提示词
        promptToUse = positivePrompt;
        negativePromptToUse = negativePrompt;
      }

      // 【重点标记 - 素材生成强制 txt2img（prompt + LoRA）】
      // illustration / general / three-view 三种素材模式直接调用 sd.generateTxt2Img，
      // 明确禁用 img2img 技术路径——不使用角色卡基底图片作为图像参考，完全由
      // 提示词 + 角色特征 tag + 角色 LoRA 驱动生成，与立绘生成行为一致。
      // sdGenerationService.generateTxt2Img 内部调用 applyTraitsAndLora 处理
      // {traits} 占位符替换 + LoRA 标签注入，确保角色特征 tag 和 LoRA 被准确应用。
      // 仅 single-expression 仍走 sd.generateExpression（img2img），因为表情生成
      // 本质是在已有角色图基础上变换表情，img2img 才能保持人物一致性。
      let result: { success: boolean; imageBase64?: string; error?: string; warning?: string };

      if (mode === 'single-expression') {
        // 表情模式：img2img，从角色卡提取基底图后基于表情 prompt 变换
        result = await window.electronAPI.sd.generateExpression({
          characterCardPath,
          emotionKey: mode, // 仅用于日志识别
          prompt: promptToUse,
          negativePrompt: negativePromptToUse,
          options: buildSdOptions(),
        });
      } else {
        // 素材模式（illustration / general / three-view）：纯文生图（prompt + LoRA）
        result = await window.electronAPI.sd.generateTxt2Img({
          endpoint: sdConfig.endpoint,
          prompt: promptToUse,
          negativePrompt: negativePromptToUse,
          options: buildSdOptions(),
        });
      }

      if (result?.success && result.imageBase64) {
        const dataUrl = result.imageBase64.startsWith(PNG_DATA_URI_PREFIX)
          ? result.imageBase64
          : PNG_DATA_URI_PREFIX + result.imageBase64;
        // 追加到图片历史并切换到最新一张
        setGeneratedImages((prev) => [...prev, dataUrl]);
        setCurrentImageIndex((prev) => prev + 1);
        setSingleStage('success');
      } else {
        setSingleError(result?.error || '生成失败');
        setSingleStage('failed');
      }
    } catch (e) {
      console.error('[AssetGenerateModal] generateExpression/txt2Img 异常:', e);
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
    activeDynamicScenePromptId,
    sdStatus,
    sdConfig.endpoint,
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
    // 不清空图片历史 — 新生成的图片会追加到历史末尾，用户可前后浏览
    setSingleError(null);
    setSingleStage('idle');
    // 直接调用生成（复用当前提示词与配置）
    handleSingleGenerate();
  }, [handleSingleGenerate]);

  // ====== 图片历史浏览：上一张 / 下一张 ======
  const handlePrevImage = useCallback(() => {
    setCurrentImageIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNextImage = useCallback(() => {
    setCurrentImageIndex((prev) =>
      Math.min(generatedImages.length - 1, prev + 1),
    );
  }, [generatedImages.length]);

  // ====== AI 图片识别特征提取（Spec: add-model-capability-detection-and-image-recognition / Task 7） ======
  // 调用 ai.recognizeImageTraits 识别角色卡 PNG 图片，提取视觉特征 tag，
  // 追加到现有 characterTraits（大小写不敏感去重）。前置条件：supportsVision=true。
  // 【Spec: add-trait-category-grouping / Task 6】characterTraits 现已是 CharacterTraitItem[]，
  // 此处取出全部 text 用于去重，再通过 setStoreTraits（MERGE 语义）合并新特征。
  // 【重点标记 - AI 自动归类增强】result.traits 现为 CategorizedTrait[]（含 categoryId），
  // setStoreTraits 入参也升级为 CategorizedTrait[]。merged 数组中现有 trait 透传其原 categoryId
  // （MERGE 策略对已分类项原样保留、对未分类项保持原状），新增 trait 携带 AI 的 categoryId 直接入对应分类。
  const handleImageRecognize = useCallback(async () => {
    if (!characterCardId) return;
    setImageRecognizing(true);
    try {
      const result = await window.electronAPI.ai.recognizeImageTraits({
        characterCardPath: characterCardId,
        characterName,
      });
      if (result?.success && result.traits) {
        // 取出现有全部特征的 text（小写），用于大小写不敏感去重
        const existingLower = new Set(
          characterTraits.map((t) => t.text.toLowerCase()),
        );
        // AI 返回中不在现有 text 集合的新特征（按 text 去重，保留 AI 的 categoryId）
        const newTraits: CategorizedTrait[] = result.traits.filter(
          (t) => !existingLower.has(t.text.toLowerCase()),
        );
        // 通过 setStoreTraits 合并：传入「现有 trait (text, categoryId) + 新增 trait (text, categoryId)」
        // store 的 MERGE 策略：
        //  - 现有已分类项（categoryId != uncategorized）→ 原样保留（无论是否在 merged 中）
        //  - 现有未分类项 + 在 merged 中 → 用 merged 中的 categoryId 更新（此处传其自身 categoryId，等价保留原状）
        //  - 现有未分类项不在 merged 中 → 移除（此处全部现有未分类项均在 merged 中，不会被移除）
        //  - merged 中不在现有 text 集合的新特征 → 追加为 { id, text, categoryId: AI's, enabled: true }
        const merged: CategorizedTrait[] = [
          ...characterTraits.map((t) => ({
            text: t.text,
            categoryId: t.categoryId,
          })),
          ...newTraits,
        ];
        setStoreTraits(merged);
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
  }, [characterCardId, characterName, characterTraits, setStoreTraits]);

  // ====== 临时编辑态：操作 handlers（仅修改 editedTraits，不回写 store） ======

  /**
   * 重置工作副本为 store 当前值（丢弃所有临时编辑 + 临时新增/删除）。
   * 用户点击「重置」按钮时调用，从 characterTraits 重新深拷贝。
   */
  const handleResetTraits = useCallback(() => {
    setEditedTraits(characterTraits.map((t) => ({ ...t })));
    setEditingTraitId(null);
    setEditingText('');
    setAddingCategoryId(null);
    setAddingText('');
  }, [characterTraits]);

  /**
   * 进入行内编辑模式：记录目标 trait id，用其当前 text 初始化 Input 暂存值。
   */
  const handleStartEditTrait = useCallback((traitId: string, currentText: string) => {
    setEditingTraitId(traitId);
    setEditingText(currentText);
  }, []);

  /**
   * 确认编辑：将 Input 暂存值写入 editedTraits 对应 trait 的 text 字段。
   * trim 后非空才写入；空串保留原值（避免空 tag 进入 SD 提示词）。
   */
  const handleConfirmEditTrait = useCallback(() => {
    if (!editingTraitId) return;
    const trimmed = editingText.trim();
    if (!trimmed) {
      // 空串不写入，静默退出编辑
      setEditingTraitId(null);
      setEditingText('');
      return;
    }
    setEditedTraits((prev) =>
      prev
        ? prev.map((t) =>
            t.id === editingTraitId ? { ...t, text: trimmed } : t,
          )
        : prev,
    );
    setEditingTraitId(null);
    setEditingText('');
  }, [editingTraitId, editingText]);

  /**
   * 取消编辑：丢弃 Input 暂存值，退出行内编辑模式。
   */
  const handleCancelEditTrait = useCallback(() => {
    setEditingTraitId(null);
    setEditingText('');
  }, []);

  /**
   * 临时切换特征启用状态（仅影响本次生成，不回写 store）。
   * 用户点击特征 Tag 时触发。
   */
  const handleToggleTraitEnabledLocal = useCallback((traitId: string) => {
    setEditedTraits((prev) =>
      prev
        ? prev.map((t) =>
            t.id === traitId ? { ...t, enabled: !t.enabled } : t,
          )
        : prev,
    );
  }, []);

  /**
   * 临时删除特征（仅从 editedTraits 移除，不回写 store）。
   * 对 store 特征：重置后恢复；对临时新增的特征：永久移除（直到重置）。
   */
  const handleDeleteTrait = useCallback((traitId: string) => {
    setEditedTraits((prev) =>
      prev ? prev.filter((t) => t.id !== traitId) : prev,
    );
  }, []);

  /**
   * 进入新增临时标签模式：记录目标分类 id，清空 Input 暂存值。
   */
  const handleStartAddTrait = useCallback((categoryId: string) => {
    setAddingCategoryId(categoryId);
    setAddingText('');
  }, []);

  /**
   * 确认新增：将 Input 暂存值作为新 trait 追加到 editedTraits。
   * trim 后非空才追加；id 用 genTraitId() 生成（与 store 一致，但不会写入磁盘）。
   */
  const handleConfirmAddTrait = useCallback(() => {
    if (!addingCategoryId) return;
    const trimmed = addingText.trim();
    if (!trimmed) {
      // 空串静默退出
      setAddingCategoryId(null);
      setAddingText('');
      return;
    }
    const newTrait: CharacterTraitItem = {
      id: genTraitId(),
      text: trimmed,
      categoryId: addingCategoryId,
      enabled: true,
    };
    setEditedTraits((prev) => (prev ? [...prev, newTrait] : prev));
    setAddingCategoryId(null);
    setAddingText('');
  }, [addingCategoryId, addingText]);

  /**
   * 取消新增：丢弃 Input 暂存值，退出新增模式。
   */
  const handleCancelAddTrait = useCallback(() => {
    setAddingCategoryId(null);
    setAddingText('');
  }, []);

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
            ? '立绘模板: full body, {pose}, {traits}, {clothing}, {scene}, ...'
            : mode === 'general'
            ? '一般图像模板: {traits}, {clothing}, {pose}, {scene}, ...'
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
  // 【Spec: add-trait-category-grouping / Task 6】characterTraits 现已是 CharacterTraitItem[]，
  // 展示时区分 enabled / disabled（disabled 项灰显），并显示启用统计「启用 X/Y」。
  // 【临时编辑支持】改用 effectiveTraits（editedTraits ?? characterTraits）驱动展示与编辑，
  // 用户可临时修改 text（如 sitting → standing）或切换 enabled，仅影响本次生成不回写 store。
  // 特征按分类分组展示（系统分类 + 自定义分类 + 未分类），与素材管理面板一致。
  // 【临时新增/删除支持】每个分类下可新增临时标签（genTraitId 生成，不写入磁盘），
  // 也可临时删除任意标签（store 特征重置后恢复，临时特征永久移除）。
  const renderTraitsPanel = () => {
    const traits = effectiveTraits;
    const enabledCount = traits.filter((t) => t.enabled).length;
    // store 原始数据索引：用于检测临时修改 / 临时新增 / 临时删除
    const storeTextById = new Map(characterTraits.map((t) => [t.id, t.text]));
    const storeIds = new Set(characterTraits.map((t) => t.id));

    // 构建分类列表（系统分类 + 自定义分类 + 未分类），按 order 升序
    // 【Bug 修复 - Spec: fix-asset-trait-and-scene-defects §5.7】原使用 traitCustomCategories
    // （旧字段，Task 4 后不再更新），改用 traitGlobalCategories（全局分类字典 state），
    // 使新建的自定义分类（如「武器」「纹身」）能在折叠面板中正确显示。
    const allCategories: TraitCategory[] = [
      ...SYSTEM_TRAIT_CATEGORIES,
      ...traitGlobalCategories,
      UNCATEGORIZED_CATEGORY,
    ].sort((a, b) => a.order - b.order);

    // 按分类分组特征
    const traitsByCategory = new Map<string, CharacterTraitItem[]>();
    for (const trait of traits) {
      const list = traitsByCategory.get(trait.categoryId);
      if (list) {
        list.push(trait);
      } else {
        traitsByCategory.set(trait.categoryId, [trait]);
      }
    }

    // 检查是否有任何临时修改（text 编辑 / 临时新增 / 临时删除），控制「重置」按钮可用性
    const hasTempAdditions = traits.some((t) => !storeIds.has(t.id));
    const hasTempDeletions = characterTraits.some(
      (st) => !traits.some((t) => t.id === st.id),
    );
    const hasTextEdits = traits.some(
      (t) => storeIds.has(t.id) && storeTextById.get(t.id) !== t.text,
    );
    const hasEdits = hasTempAdditions || hasTempDeletions || hasTextEdits;

    return (
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
          <span>
            携带角色特征（启用 {enabledCount}/{traits.length}）：
          </span>
          <Tooltip title="点击特征可临时启用/禁用；点击编辑图标可临时修改文本（如 sitting → standing）；点击 × 可临时删除；分类下方可新增临时标签。所有修改仅影响本次生成，不保存到角色卡。">
            <Tag color="blue" style={{ margin: 0, fontSize: 11, cursor: 'help' }}>
              可临时编辑
            </Tag>
          </Tooltip>
          {hasEdits && (
            <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>
              有未保存的临时修改
            </Tag>
          )}
          {traitsError && (
            <Tag color="red" style={{ margin: 0, fontSize: 11 }}>
              读取失败
            </Tag>
          )}
          {/* 重置按钮：丢弃所有临时编辑 + 临时新增/删除，从 store 重新同步 */}
          <Button
            size="small"
            icon={<UndoOutlined />}
            onClick={handleResetTraits}
            disabled={!hasEdits}
            style={{
              fontSize: 11,
              borderColor: 'rgba(99, 102, 241, 0.4)',
              color: '#a5b4fc',
            }}
          >
            重置
          </Button>
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
        {editedTraits === null ? (
          <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 11 }}>
            特征加载中...
          </span>
        ) : (
          <Collapse
            size="small"
            defaultActiveKey={allCategories.map((c) => c.id)}
            style={{ marginTop: 4 }}
          >
            {allCategories.map((category) => {
              const catTraits = traitsByCategory.get(category.id) || [];
              const enabledInCat = catTraits.filter((t) => t.enabled).length;
              const isAdding = addingCategoryId === category.id;
              return (
                <Collapse.Panel
                  key={category.id}
                  header={
                    <span style={{ fontSize: 12 }}>
                      {category.name}
                      <span
                        style={{
                          marginLeft: 6,
                          color: 'var(--text-tertiary, #6b7280)',
                          fontSize: 11,
                        }}
                      >
                        {enabledInCat}/{catTraits.length}
                      </span>
                    </span>
                  }
                >
                  <Space size={[4, 4]} wrap>
                    {catTraits.map((trait) => {
                      const isStoreTrait = storeIds.has(trait.id);
                      const isEdited =
                        isStoreTrait &&
                        storeTextById.get(trait.id) !== trait.text;
                      const isEditing = editingTraitId === trait.id;
                      // 颜色策略：
                      //  - 临时新增（非 store）+ enabled → cyan（青色，区分 store 特征）
                      //  - 临时新增 + disabled → default（灰显）
                      //  - store 特征 + enabled + 已修改 → orange
                      //  - store 特征 + enabled + 原始 → purple
                      //  - store 特征 + disabled → default（灰显）
                      const tagColor = !trait.enabled
                        ? 'default'
                        : !isStoreTrait
                          ? 'cyan'
                          : isEdited
                            ? 'orange'
                            : 'purple';

                      if (isEditing) {
                        // 行内编辑模式：Input + 确认/取消按钮
                        return (
                          <span
                            key={trait.id}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 2,
                            }}
                          >
                            <Input
                              size="small"
                              autoFocus
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              onPressEnter={handleConfirmEditTrait}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  handleCancelEditTrait();
                                }
                              }}
                              style={{
                                width: 140,
                                fontSize: 11,
                              }}
                            />
                            <Button
                              size="small"
                              type="text"
                              icon={<CheckOutlined />}
                              onClick={handleConfirmEditTrait}
                              style={{ color: '#22c55e', fontSize: 11 }}
                            />
                            <Button
                              size="small"
                              type="text"
                              icon={<CloseOutlined />}
                              onClick={handleCancelEditTrait}
                              style={{ color: '#ef4444', fontSize: 11 }}
                            />
                          </span>
                        );
                      }

                      return (
                        <Tag
                          key={trait.id}
                          color={tagColor}
                          closable
                          onClose={(e) => {
                            e.preventDefault();
                            handleDeleteTrait(trait.id);
                          }}
                          style={{
                            margin: 0,
                            opacity: trait.enabled ? 1 : 0.45,
                            cursor: 'pointer',
                            userSelect: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                          }}
                          // 点击 Tag 切换启用状态（临时）
                          onClick={() =>
                            handleToggleTraitEnabledLocal(trait.id)
                          }
                        >
                          {trait.text}
                          {/* 编辑图标：点击进入行内编辑（stopPropagation 避免触发 toggle） */}
                          <EditOutlined
                            style={{
                              fontSize: 10,
                              marginLeft: 2,
                              opacity: 0.7,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartEditTrait(trait.id, trait.text);
                            }}
                          />
                        </Tag>
                      );
                    })}
                    {/* 新增临时标签入口 */}
                    {isAdding ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 2,
                        }}
                      >
                        <Input
                          size="small"
                          autoFocus
                          placeholder="输入临时标签"
                          value={addingText}
                          onChange={(e) => setAddingText(e.target.value)}
                          onPressEnter={handleConfirmAddTrait}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              handleCancelAddTrait();
                            }
                          }}
                          style={{ width: 140, fontSize: 11 }}
                        />
                        <Button
                          size="small"
                          type="text"
                          icon={<CheckOutlined />}
                          onClick={handleConfirmAddTrait}
                          style={{ color: '#22c55e', fontSize: 11 }}
                        />
                        <Button
                          size="small"
                          type="text"
                          icon={<CloseOutlined />}
                          onClick={handleCancelAddTrait}
                          style={{ color: '#ef4444', fontSize: 11 }}
                        />
                      </span>
                    ) : (
                      <Tag
                        onClick={() => handleStartAddTrait(category.id)}
                        style={{
                          margin: 0,
                          cursor: 'pointer',
                          borderStyle: 'dashed',
                          background: 'transparent',
                          color: 'var(--text-tertiary, #6b7280)',
                          fontSize: 11,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 2,
                        }}
                      >
                        <PlusOutlined style={{ fontSize: 10 }} />
                        新增临时标签
                      </Tag>
                    )}
                  </Space>
                </Collapse.Panel>
              );
            })}
          </Collapse>
        )}
      </div>
    );
  };

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
        <Tag color="geekblue">尺寸：{selectedSize.width}×{selectedSize.height}</Tag>
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
        <Tag color="purple">特征：启用 {enabledTraitTexts.length}/{effectiveTraits.length}</Tag>
        {isNudeSlot && (
          <Tag color="pink">
            裸体模式：已过滤衣物特征
          </Tag>
        )}
        <Tag
          color="cyan"
          style={{ cursor: 'pointer' }}
          onClick={() => setLoraModalOpen(true)}
        >
          LoRA：{characterLoras.length} 个
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
          message="批量生成 31 个预置情绪表情"
          description={
            <div style={{ fontSize: 12 }}>
              将为该角色生成全部 31 个预置情绪（default / admiration / ... /
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

  /**
   * 单次模式参数面板（左栏内容）
   * 包含 Alert + 动态场景下拉 + 参数概览 + 正/负面提示词 + 生成按钮
   * 由 Modal body 的左栏容器包裹（与 renderHeader / renderTraitsPanel / SizeSelector 等并列）
   */
  const renderParamsColumn = () => {
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
        ? '点击「生成」按钮，将通过 SD 文生图（提示词 + 角色 LoRA）生成角色立绘（full body, standing），不使用图像参考。'
        : mode === 'general'
        ? '在左侧选择动态场景方案（可选），点击「生成」按钮通过 SD 文生图（提示词 + 角色 LoRA）生成一般场景图像，不使用图像参考。'
        : `点击「生成」按钮，将通过 SD 文生图（提示词 + 角色 LoRA）生成${threeViewSlotLabel}三视图（character sheet 风格），不使用图像参考。`;

    const isGenerating = singleStage === 'generating';

    return (
      <>
        <Alert type="info" showIcon message={idleTitle} description={idleDesc} />

        {/* 动态场景方案选择下拉（Spec: fix-asset-trait-and-scene-defects / Task 6）
            * 替代原 userScene 文本输入框（Task 7 已移除）。用户可在生成弹窗内直接选择
            * 已保存的动态场景方案，无需返回 AssetManagerModal 激活。
            * - 选项来自 store.dynamicScenePrompts（与 AssetManagerModal 共享同一 state）
            * - 当前激活方案作为 Select 的 value（activeDynamicScenePromptId）
            * - onChange 调用 applyDynamicScenePrompt(id) 立即激活并持久化
            * - 空状态（无方案）：Select disabled + placeholder 提示去素材管理添加
            * - 允许清除（allowClear）：清除后 activeDynamicScenePromptId 保持原值
            *   （applyDynamicScenePrompt 仅在 id 为非空字符串时调用，清除为 no-op）
            * - 三视图模式：模板不含 {clothing}/{pose}/{scene} 占位符，选择方案无副作用
            * - 表情模式：模板不含动态场景占位符，下拉仅作便捷入口（不阻塞生成）
            * - 生成中（isGenerating）时 Select disabled，避免生成期间切换方案 */}
        <div>
          <div
            style={{
              color: 'var(--text-secondary, #94a3b8)',
              fontSize: 12,
              marginBottom: 6,
            }}
          >
            动态场景方案：
          </div>
          <Select
            value={activeDynamicScenePromptId ?? undefined}
            onChange={(id) => {
              // allowClear 触发时 id 为 undefined，此时不调用 applyDynamicScenePrompt
              // （store 的 activeDynamicScenePromptId 保持原值，用户需在 AssetManagerModal
              //   显式删除方案才会重置为 null；此处清除为 no-op，避免误清空激活状态）
              if (typeof id === 'string' && id) {
                applyDynamicScenePrompt(id);
              }
            }}
            placeholder="选择动态场景方案"
            style={{
              width: '100%',
              background: 'rgba(15, 15, 26, 0.6)',
              color: 'var(--text-primary, #e2e8f0)',
              borderColor: 'rgba(255, 255, 255, 0.1)',
            }}
            allowClear
            disabled={dynamicScenePrompts.length === 0 || isGenerating}
            options={dynamicScenePrompts.map((p) => ({ label: p.name, value: p.id }))}
            notFoundContent={
              dynamicScenePrompts.length === 0
                ? '暂无动态场景方案，请在素材管理中添加'
                : undefined
            }
          />
          <div
            style={{
              color: 'var(--text-secondary, #94a3b8)',
              fontSize: 11,
              marginTop: 4,
            }}
          >
            选择已保存的动态场景方案后，其服装/动作/场景 tag 会自动替换提示词模板中的{' '}
            {'{clothing}'} / {'{pose}'} / {'{scene}'} 占位符。无方案时占位符替换为空字符串。
          </div>
        </div>

        {/* 参数概览 */}
        {renderParamsOverview()}

        {/* 正面提示词（可编辑，生成中 disabled） */}
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
            disabled={isGenerating}
            style={{
              background: 'rgba(15, 15, 26, 0.6)',
              color: 'var(--text-primary, #e2e8f0)',
              borderColor: 'rgba(255, 255, 255, 0.1)',
            }}
          />
        </div>

        {/* 负面提示词（可编辑，生成中 disabled） */}
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
            disabled={isGenerating}
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
            disabled={sdStatus !== 'available' || isGenerating}
            loading={isGenerating || initializing}
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              borderColor: 'transparent',
            }}
          >
            {isGenerating ? '生成中...' : '生成'}
          </Button>
        </div>
      </>
    );
  };

  /**
   * 单次模式状态面板（右栏内容）
   * 根据 singleStage 互斥显示：idle 引导 / generating Spin / success 图片预览 / failed 错误
   * 由 Modal body 的右栏容器包裹
   */
  const renderStatusColumn = () => {
    const successTitle =
      mode === 'single-expression'
        ? `已生成「${singleEmotionLabel}」表情`
        : mode === 'illustration'
        ? '已生成角色立绘'
        : mode === 'general'
        ? '已生成一般图像'
        : `已生成${threeViewSlotLabel}三视图`;

    const generatingTip =
      mode === 'single-expression'
        ? '正在生成表情图片...'
        : mode === 'illustration'
        ? '正在生成角色立绘...'
        : mode === 'general'
        ? '正在生成一般图像...'
        : `正在生成${threeViewSlotLabel}三视图...`;

    const isGenerating = singleStage === 'generating';

    // 生成成功 - 展示结果预览
    if (singleStage === 'success' && generatedImage) {
      return (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: 12,
              background:
                'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
              borderRadius: 8,
            }}
          >
            {/* 上一张按钮：第一张时禁用 */}
            <Button
              shape="circle"
              icon={<LeftOutlined />}
              disabled={currentImageIndex <= 0}
              onClick={handlePrevImage}
              style={{ flexShrink: 0 }}
            />
            <Image
              src={generatedImage}
              alt={successTitle}
              width={384}
              height={384}
              style={{
                objectFit: 'cover',
                borderRadius: 8,
                border: '1px solid var(--primary-color, #6366f1)',
              }}
              preview={{ mask: '点击查看大图' }}
            />
            {/* 下一张按钮：最后一张时禁用 */}
            <Button
              shape="circle"
              icon={<RightOutlined />}
              disabled={currentImageIndex >= generatedImages.length - 1}
              onClick={handleNextImage}
              style={{ flexShrink: 0 }}
            />
          </div>

          {/* 图片计数器：仅有多张时显示 */}
          {generatedImages.length > 1 && (
            <div
              style={{
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--text-secondary, #94a3b8)',
              }}
            >
              {currentImageIndex + 1} / {generatedImages.length}
            </div>
          )}

          <Alert
            type="success"
            showIcon
            message={successTitle}
            description="点击「保存」将当前预览图片写入角色卡素材目录；点击「重新生成」将追加一张新图到历史。可用左右按钮浏览本次会话已生成的所有图片。"
          />

          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
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
        </>
      );
    }

    // 生成失败
    if (singleStage === 'failed') {
      return (
        <>
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
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Button
              type="primary"
              icon={<RobotOutlined />}
              onClick={handleRegenerate}
            >
              重新生成
            </Button>
            <Button onClick={onClose}>关闭</Button>
          </div>
        </>
      );
    }

    // 生成中
    if (isGenerating) {
      return (
        <>
          <Spin
            indicator={<LoadingOutlined style={{ fontSize: 48 }} />}
            tip={generatingTip}
          >
            <div style={{ width: 384, height: 384 }} />
          </Spin>
          <div style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 12, textAlign: 'center' }}>
            {mode === 'single-expression'
              ? 'SD img2img 生成中，请稍候（通常 5-15 秒）...'
              : 'SD 文生图生成中，请稍候（通常 5-15 秒）...'}
          </div>
        </>
      );
    }

    // 待开始：右侧显示提示，等待用户点击左栏的「生成」按钮
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: '24px 12px',
          color: 'var(--text-secondary, #94a3b8)',
          fontSize: 13,
          textAlign: 'center',
          flex: 1,
        }}
      >
        <RobotOutlined style={{ fontSize: 40, opacity: 0.4 }} />
        <div>点击左侧「生成」按钮开始</div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          生成过程中参数面板始终可见，可随时查看与调整
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
      width={1200}
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
        mode === 'batch-expression' ? (
          // 批量生成模式：保持原上下式布局（批量模式无「参数 + 状态」并行需求）
          <>
            {renderHeader()}
            {renderTraitsPanel()}
            {/* 2026-07-29 新增 - 用户自定义输出尺寸选择器（所有生成模式可见） */}
            <SizeSelector
              width={selectedSize.width}
              height={selectedSize.height}
              onChange={(w, h) => setSelectedSize({ width: w, height: h })}
            />
            {renderSdUnavailableAlert()}
            {renderAdetailerWarning()}
            {renderBatchMode()}
          </>
        ) : (
          // 单次生成模式（single-expression / illustration / general / three-view）：
          // 左右两栏布局 — 左栏包含所有参数区域（renderHeader + renderTraitsPanel + SizeSelector
          // + 警告 + 参数面板），永远显示不被遮挡；右栏显示状态/图片（idle 提示 / generating
          // Spin / success 图片预览 / failed 错误），根据 singleStage 互斥切换。
          // 【Spec: fix-asset-trait-and-scene-defects §5.8】
          <div style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
            {/* 左栏：所有参数区域（携带角色特征等永远可见） */}
            <div
              style={{
                flex: '1 1 50%',
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                padding: '0 12px 0 0',
                borderRight: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              {renderHeader()}
              {renderTraitsPanel()}
              <SizeSelector
                width={selectedSize.width}
                height={selectedSize.height}
                onChange={(w, h) => setSelectedSize({ width: w, height: h })}
              />
              {renderSdUnavailableAlert()}
              {renderAdetailerWarning()}
              {renderParamsColumn()}
            </div>
            {/* 右栏：状态/图片（idle/generating/success/failed 互斥显示） */}
            <div
              style={{
                flex: '1 1 50%',
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                padding: '0 0 0 12px',
              }}
            >
              {renderStatusColumn()}
            </div>
          </div>
        )
      )}

      {/* LoRA 模型选择弹窗（Spec: add-lora-model-selection / Task 5） */}
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

export default AssetGenerateModal;
