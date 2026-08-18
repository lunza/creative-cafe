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
  // 【Spec: add-sdxl-prompt-weight-support / Task 7】Popover / InputNumber / Slider 用于权重编辑器
  Popover,
  InputNumber,
  Slider,
} from 'antd';
import {
  ThunderboltOutlined,
  RobotOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  SettingOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  UndoOutlined,
  PlusOutlined,
  LeftOutlined,
  RightOutlined,
  // 【Spec: optimize-trait-translation-and-temp-scheme / Task 4+5+6】
  // SplitCellsOutlined：拆分标签 UI 标识；SaveOutlined/DeleteOutlined：组合方案保存/删除按钮
  SplitCellsOutlined,
  SaveOutlined,
  DeleteOutlined,
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
import CameraAngleSelector from './CameraAngleSelector';
// Spec: implement-local-tag-autocomplete / Task 7 — 替换「输入临时标签」位置的 Input，
// 提供基于本地标签库的实时推荐。降级开关由组件内部读取 settingStore.tagAutocomplete.enabled 处理。
import { TagAutocomplete } from '../../Common';
// Spec: add-prompt-generation-in-asset-modal — 提示词生成结果审计质检报告
// 与 AssetManagerModal 一致，复用 RagQualityReport 组件以只读模式展示 L0-L5 审计结果
import RagQualityReport from './RagQualityReport';
import { buildSdOptionsFromConfig } from './buildSdOptions';

/**
 * AI 素材生成弹窗（Spec: add-asset-and-trait-management / Task 10）
 *
 * 职责：
 * - 扩展自 ExpressionGenerateModal，支持四种素材类型生成：
 *   - batch-expression：批量生成 31 个预置情绪表情（沿用原 ExpressionGenerateModal 逻辑）
 *   - single-expression：生成单个情绪表情（沿用原逻辑）
 *   - illustration：生成角色立绘（full body, standing）
 *   - general：生成一般场景图像（Spec: fix-asset-trait-and-scene-defects / Task 6+7）
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
  /** three-view 模式：目标槽位（含裸体变体，nude 后缀时自动过滤上装/下装/内衣分类特征，配饰保留） */
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
    'portrait, {traits}, looking_at_viewer, simple_background, {emotion}, high quality, best quality, masterpiece, detailed face',
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

// 注：`buildAssetPromptTemplate` 已迁移至 `./PromptBuilder`
// 模板仅含 {camera} / {traits} 占位符，由 sdGenerationService.applyTraitsAndLora 替换

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

// ==================== 子组件：WeightEditorContent（权重编辑器 Popover 内容） ====================

/**
 * 权重编辑器 Popover 内容（Spec: add-sdxl-prompt-weight-support / Task 7.2）。
 *
 * 受控组件：接收当前 weight + onChange/onReset 回调，内部维护 InputNumber/Slider 同步状态。
 * - InputNumber 与 Slider 双向同步（改变一个更新另一个，范围 0.1-10.0，步长 0.1）
 * - 「重置为 1.0」按钮调用 onReset（清空 weight 字段，等价于 1.0）
 * - 快捷预设按钮（0.5 / 0.8 / 1.0 / 1.3 / 1.5）快速选择
 *
 * 与 AssetManagerModal 中的权重编辑器结构一致（Task 8 复用模式，复制实现避免跨文件重构）。
 *
 * 【关键差异】AssetGenerateModal 的工作副本模式：onChange/onReset 由外层传入
 * handleUpdateTraitWeight，后者更新 editedTraits 本地 state（不直接调 store action），
 * 编辑在用户点击「应用/生成」前不会落盘。
 *
 * UI 风格：暗色主题 + inline styles（与外层 Modal 一致）。
 * Popover 内容由 antd 注入 document.body，背景使用 antd 默认浮层（已适配暗色主题）。
 */
const WeightEditorContent: React.FC<{
  weight: number | undefined;
  onChange: (weight: number) => void;
  onReset: () => void;
}> = ({ weight, onChange, onReset }) => {
  // 初始值：weight 为 undefined 时回退到 1.0（UI 显示用，不写回 editedTraits）
  const initialValue = weight ?? 1.0;
  const [localValue, setLocalValue] = useState<number>(initialValue);

  // 同步外部 weight 变化（如用户重置后 editedTraits 更新触发 props 变化）
  useEffect(() => {
    setLocalValue(weight ?? 1.0);
  }, [weight]);

  // InputNumber / Slider / 预设按钮共用：更新本地 + 通知外层 handleUpdateTraitWeight
  const handleChange = useCallback(
    (val: number | null) => {
      if (val === null || Number.isNaN(val)) return;
      setLocalValue(val);
      onChange(val);
    },
    [onChange],
  );

  return (
    <div style={{ width: 220, padding: 4 }}>
      {/* InputNumber + Slider 同一行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <InputNumber
          size="small"
          min={0.1}
          max={10}
          step={0.1}
          precision={1}
          value={localValue}
          onChange={handleChange}
          style={{ width: 80 }}
        />
        <Slider
          min={0.1}
          max={10}
          step={0.1}
          value={localValue}
          onChange={handleChange}
          style={{ flex: 1, margin: 0 }}
        />
      </div>
      {/* 快捷预设按钮 */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {[0.5, 0.8, 1.0, 1.3, 1.5].map((preset) => (
          <Button
            key={preset}
            size="small"
            onClick={() => handleChange(preset)}
            style={{ fontSize: 11, padding: '0 6px' }}
          >
            ×{preset.toFixed(1)}
          </Button>
        ))}
      </div>
      {/* 重置按钮：清空 weight 字段（等价于 1.0） */}
      <Button size="small" block onClick={onReset} style={{ fontSize: 11 }}>
        重置为 1.0
      </Button>
    </div>
  );
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
  const saveExpression = useExpressionStore(s => s.saveExpression);
  const loadExpressions = useExpressionStore(s => s.loadExpressions);
  // 订阅 manifest 以获取自定义情绪及其 AI 生成提示词（Spec: enhance-custom-emotion-system）
  const manifest = useExpressionStore(s => s.manifest);
  const saveAsset = useAssetStore(s => s.saveAsset);
  // 【Spec: add-model-capability-detection-and-image-recognition / Task 7】
  // 从 settingStore 读取当前激活引擎的 capabilities.supportsVision，
  // 仅当为 true 时展示「AI 图片识别」按钮
  const setting = useSettingStore(s => s.setting);
  const activeEngine = setting?.aiEngines?.find(
    (e) => e.id === setting?.activeEngineId,
  );
  const supportsVision = activeEngine?.capabilities?.supportsVision === true;

  // 【重点标记 - 按角色独立存储 LoRA（2026-07-29 bug 修复）】
  // LoRA 配置不再从全局 setting.sdWebui.selectedLoras 读取，而是按角色卡独立存储，
  // 避免 A 角色选择的 LoRA 污染 B 角色的生成。
  const characterLoras = useCharacterLoraStore(s => s.loras);
  const loadCharacterLoras = useCharacterLoraStore(s => s.loadLoras);
  const saveCharacterLoras = useCharacterLoraStore(s => s.saveLoras);

  // 【重点标记 - 角色特征缓存 Bug 修复（2026-07-29）】
  // 原实现通过 window.electronAPI.characterTrait.list() 直接 IPC 读取（从磁盘），
  // 导致用户在特征 Tab 中 addTrait/removeTrait/updateTrait 后（仅更新 store 未持久化），
  // 生成弹窗读取到的仍是磁盘旧数据。现改为订阅 characterTraitStore，
  // 与 AssetManagerModal 特征 Tab 共享同一 store state，实时同步未保存的修改。
  // init useEffect 中仅当 store 的 currentCharacterCardId 与当前角色不一致时才 loadTraits，
  // 避免覆盖 AssetManagerModal 中已加载（可能含未保存修改）的 traits。
  const {
    traits: characterTraits,
    // 【Bug 修复 - Spec: fix-asset-trait-and-scene-defects §5.7】原订阅 customCategories（旧字段，
    // Task 4 后 store 不再写入新值），导致 renderTraitsPanel 的 allCategories 派生不包含新建的自定义分类。
    // 修复：改订阅 globalCategories（Task 4 引入的全局分类字典 state）。
    globalCategories: traitGlobalCategories,
    currentCharacterCardId: traitStoreCardId,
    // 【Spec: optimize-trait-translation-and-temp-scheme / Task 5+6】组合方案 CRUD 订阅：
    // - combinations / activeCombinationId：驱动「组合方案」下拉显示与当前激活态
    // - saveCombination：handleSaveTempScheme 调用，传入 editedTraits 快照
    // - overwriteCombination：重名时覆盖已有方案
    // - applyCombination / deleteCombination：下拉切换与「删方案」按钮调用
    combinations,
    activeCombinationId,
    saveCombination,
    overwriteCombination,
    applyCombination,
    deleteCombination,
    loadTraits: loadStoreTraits,
    setTraits: setStoreTraits,
  } = useCharacterTraitStore();
  // TODO(perf): 整体订阅，待拆分为 selector（10 字段，>5 暂缓）

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

  // ====== 提示词生成面板状态（Spec: add-prompt-generation-in-asset-modal） ======
  // 用户在「携带角色特征」区域正上方输入提示词 → 调用 AI 生成分类 tag → 应用追加到 editedTraits
  // 视觉风格：紫色边框 + ThunderboltOutlined 图标
  // 审计流程复用 generateTraitPrompts（主进程内部走 L0-L5 完整审计链 + RAG 标签库参考注入）
  /** 用户输入的提示词文本（如 "red hair, blue dress, forest background"） */
  const [promptGenInput, setPromptGenInput] = useState<string>('');
  /** AI 生成的分类特征（CategorizedTrait[]，应用前暂存，不直接写入 editedTraits） */
  const [promptGenResult, setPromptGenResult] = useState<CategorizedTrait[] | null>(null);
  /** AI 调用 loading（控制生成按钮 disabled + loading 图标） */
  const [promptGenLoading, setPromptGenLoading] = useState<boolean>(false);
  /** RAG 质检报告 */
  const [promptGenRagDebug, setPromptGenRagDebug] = useState<{
    enabled: boolean;
    status: string;
    retrievedTags: Array<{ name: string; category: number; count: number; score: number }>;
    tagValidation: Array<{
      tag: string;
      isValid: boolean;
      canonicalName?: string;
      category?: number;
      count?: number;
      skipReason?: 'rating' | 'no_suggestion';
      suggestions: Array<{ name: string; category: number; count: number; score: number }>;
      replacedBy?: string;
      splitTags?: { colorPartTag: string; featureTag: string };
      source?: 'user-map' | 'name' | 'alias' | 'color-split' | 'negation-strip' | 'knn' | 'ai-fallback';
      manuallyReplaced?: boolean;
      manualReplacement?: string;
      aiFallbackAttempted?: boolean;
      aiFallbackCandidates?: string[];
    }>;
  } | null>(null);
  /** RAG 质检面板可见性（用户可折叠/展开，默认展开） */
  const [promptGenRagVisible, setPromptGenRagVisible] = useState<boolean>(true);
  /**
   * 已应用的提示词生成特征 ID 集合（用于视觉标识新追加的 tag）。
   * 应用后这些 id 进入 editedTraits，但在 UI 渲染时若 id 在集合内则显示「✨ 新增」徽标。
   * 关闭弹窗 / 重置特征时清空。
   */
  const [appliedPromptTraitIds, setAppliedPromptTraitIds] = useState<Set<string>>(new Set());

  // effectiveTraits：实际用于 SD 生成与 UI 展示的特征列表
  //  - editedTraits 非空时使用工作副本（含用户临时编辑）
  //  - 否则回退到 store characterTraits（与原行为一致）
  const effectiveTraits: CharacterTraitItem[] = editedTraits ?? characterTraits;

  // 【Spec: add-trait-category-grouping / Task 6】characterTraits 现已是结构化 CharacterTraitItem[]，
  // 下游 SD 生成仅拼接 enabled=true 项的 text。此处派生 enabled 特征文本数组供
  // buildSdOptions / buildExpressionGenerationPrompt / buildNLExpressionPrompt 共用。
  // 【临时编辑支持】改用 effectiveTraits 派生，使临时修改的 text / enabled 生效于本次生成。
  // 【裸体三视图支持】当 targetSlot 为 *-nude 时，自动过滤上装/下装/内衣分类特征，
  //   确保裸体版不携带衣物 tag（species / body / head 等基础特征保留；配饰如眼镜/首饰保留）。
  // 【重点标记 - 衣物分类拆分】原 clothing 分类已拆分为 top/bottom/accessories/underwear，
  //   裸体过滤仅覆盖 top/bottom/underwear（保留 accessories，配饰在裸体图中保留）。
  const isNudeSlot = mode === 'three-view' && !!targetSlot?.endsWith('-nude');
  // 裸体三视图过滤的衣物分类集合（上装/下装/内衣）；配饰（眼镜/首饰等）保留
  const NUDE_FILTER_CATEGORY_IDS = new Set(['top', 'bottom', 'underwear']);
  // 【Spec: optimize-expression-preset-prompts / Task 7】
  // 表情模式（single-expression / batch-expression）下过滤 expression 分类特征，
  // 避免与 {emotion} 占位符注入的 EMOTION_PROMPT_MAP 表情 tag 重复/冲突。
  // illustration / general / three-view 模式不受影响，expression 分类特征正常携带。
  // 注：enabledTraitTexts 为 buildSdOptions / buildEmotionPrompt / single-expression
  // 提示词构建器共用派生值，在此处统一过滤可确保所有下游消费者一致地不携带 expression 分类 tag。
  const isExpressionMode = mode === 'single-expression' || mode === 'batch-expression';
  // 【Spec: add-sdxl-prompt-weight-support / Task 3.1】enabledTraitTexts 升级为
  // Array<{ text: string; weight?: number }>，透传 weight 到下游 SD 生成管线
  // （sdGenerationService.applyTraitsAndLora 会按 weight 格式化为 (text:weight) 语法）。
  const enabledTraitTexts: Array<{ text: string; weight?: number }> = useMemo(
    () =>
      effectiveTraits
        .filter(
          (t) =>
            t.enabled &&
            (!isNudeSlot || !NUDE_FILTER_CATEGORY_IDS.has(t.categoryId)) &&
            !(isExpressionMode && t.categoryId === 'expression'),
        )
        .map((t) => ({ text: t.text, weight: t.weight }))
        // ⚠️ 【重点标记 - SD 生成前去重】2026-08-07 用户反馈：
        // 若特征列表存在重复 tag（如两个 dog_girl），未去重直接拼接会导致 SD 对该 tag
        // 多次加权，影响生成质量。此处对 text 做大小写不敏感去重（保留首次出现的项，
        // 维持原有顺序），与 handleApplyGeneratedTraits 的去重 key 策略一致。
        // 同时让 baseTraits（传给 generateTraitPrompts 的 LLM 上下文）也去重，
        // 避免 LLM 因看到重复上下文而生成重复 tag。
        // 【Spec: add-sdxl-prompt-weight-support / Task 3.1】去重 key 仍为 text
        // （不带权重语法），权重不影响去重；保留首次出现项的 weight。
        .filter((item, _index, arr) => {
          const key = item.text.trim().toLowerCase();
          return arr.findIndex((t) => t.text.trim().toLowerCase() === key) === _index;
        }),
    [effectiveTraits, isNudeSlot, isExpressionMode],
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

  /**
   * 视角镜头选择（2026-08-06 新增，2026-08-06 重构为按模式默认值）
   *
   * 用户通过 CameraAngleSelector 下拉选择 SDXL/Pony 视角镜头标签（如 from above / wide shot /
   * dutch angle），选中后通过 {camera} 占位符注入到正面提示词模板（由 applyTraitsAndLora 替换）。
   *
   * 【2026-08-06 重构 - 模式默认值注入】
   * 立绘 / 表情模板已移除写死的视角 tag（full body / portrait / looking at viewer），
   * 改为弹窗打开时按模式初始化默认值（getCameraDefaultForMode），用户可改选/加选/清空。
   * 这样避免「写死 tag + 用户选同类 tag」的冲突（如 full body + close-up 自相矛盾）。
   *
   * - 空字符串表示未选择，{camera} 占位符替换为空串并清理多余逗号
   * - 立绘 / 表情（SDXL）/ 一般图像模板含 {camera} 占位符；三视图不含（视角程序化，不渲染下拉）
   * - NL 表情模板（buildNLExpressionPrompt）不含 {camera}，选择后为 no-op
   * - 每次生成独立应用，不写入全局设置；弹窗关闭时重置为空字符串；模式切换时重置为新模式默认值
   */
  const [selectedCameraAngle, setSelectedCameraAngle] = useState<string>('');

  /**
   * 按生成模式返回视角镜头默认值（2026-08-06 重构新增）。
   *
   * 立绘 / 表情模板已移除写死的视角 tag，改为由此函数提供模式默认值，
   * 弹窗打开 / 模式切换时初始化 selectedCameraAngle。
   *
   * - illustration（立绘）：'full body'（立绘语义核心，用户可改 upper body 等）
   * - single-expression / batch-expression（表情）：'portrait, looking at viewer'
   *   （表情默认面部特写 + 看镜头，用户可加选 from above 等）
   * - general（一般图像）：'' 无默认（用户自由选）
   * - three-view（三视图）：'' 无默认（视角程序化，下拉不渲染）
   *
   * 注意：NL 表情模型（buildNLExpressionPrompt）模板不含 {camera}，默认值透传后为 no-op。
   */
  const getCameraDefaultForMode = (m: typeof mode): string => {
    switch (m) {
      case 'illustration':
        return 'full_body';
      case 'single-expression':
      case 'batch-expression':
        return 'portrait, looking_at_viewer';
      case 'general':
      case 'three-view':
      default:
        return '';
    }
  };

  // ====== 视角镜头默认值初始化（弹窗打开 + 模式切换时重置为模式默认值） ======
  // 【2026-08-06 重构】立绘/表情模板移除写死视角 tag 后，需在弹窗打开/模式切换时
  // 自动初始化 selectedCameraAngle 为模式默认值，确保不调整时行为等价于原写死 tag。
  // 用户可手动改选/加选/清空；模式切换时重置（各模式视角语义不同，不跨模式保留）。
  useEffect(() => {
    if (!open) return;
    setSelectedCameraAngle(getCameraDefaultForMode(mode));
    // 仅依赖 open / mode：弹窗打开或模式切换时触发，用户手动调整不触发
  }, [open, mode]);

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
      // 查找自定义情绪的 AI 生成提示词（Spec: enhance-custom-emotion-system）
      const customEmotion = manifest?.customEmotions?.find((e) => e.key === targetEmotionKey);
      const customPrompts = customEmotion?.prompts;
      const isNLModel = sdConfig.modelType !== 'sdxl';
      const { prompt, negativePrompt: neg } = isNLModel
        ? buildNLExpressionPrompt(targetEmotionKey, {
            nlPromptTemplate: sdConfig.nlPromptTemplate,
            customNegativePrompt: sdConfig.customNegativePrompt,
            customLabel,
            customNlPrompt: customPrompts?.nlPrompt,
            characterTraits: enabledTraitTexts,
            modelType: sdConfig.modelType,
          })
        : buildExpressionGenerationPrompt(
            targetEmotionKey,
            {
              positivePromptTemplate: sdConfig.positivePromptTemplate,
              customNegativePrompt: sdConfig.customNegativePrompt,
              customLabel,
              customPrompts: customPrompts
                ? { positive: customPrompts.positive, negative: customPrompts.negative }
                : undefined,
              characterTraits: enabledTraitTexts,
            },
          );
      setPositivePrompt(prompt);
      setNegativePrompt(neg);
      return;
    }

    // illustration / general / three-view 模式：构建素材提示词模板
    const template = buildAssetPromptTemplate(mode, targetSlot);
    // 负面提示词：用户自定义优先；否则使用默认
    // 【2026-08-06 标签库审计】多词 tag 改为下划线版本（与 PromptBuilder.baseNegative 同步）
    const baseNegative =
      'deformed, ugly, bad_anatomy, multiple_faces, text, watermark, low quality, blurry, mutated_hands, extra_digits, missing_fingers, bad_proportions';
    const userNegative = (sdConfig.customNegativePrompt && sdConfig.customNegativePrompt.trim()) || '';
    // 【2026-08-06 三视图多角色 bug 修复】三视图专属负面约束
    // 原正面模板含 `character sheet` 导致模型生成多视角/多服装 collage（主视图+上半身+特写，或穿衣/不穿衣左右布局）。
    // 已从正面模板移除 character sheet 并加 solo，此处再追加负面约束强化单角色单视角：
    // multiple views / multiple characters / split screen / collage / character sheet / 2girls / 3girls
    // 无论用户是否自定义负面，三视图模式都追加此约束（bug 修复优先于用户配置的完全自由）。
    // 【2026-08-06 标签库审计】多词 tag 改下划线 + character sheet → model_sheet（Danbooru 标准名）
    // 删除 multiple characters（不在标签库，已有 multiple_girls/boys 替代）
    const threeViewExtraNegative =
      'multiple_views, multiple_girls, multiple_boys, split_screen, collage, model_sheet, 2girls, 3girls';
    let finalNegative = userNegative || baseNegative;
    if (mode === 'three-view') {
      finalNegative = `${finalNegative}, ${threeViewExtraNegative}`;
    }
    setPositivePrompt(template);
    setNegativePrompt(finalNegative);
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
      setGeneratedImages([]);
      setCurrentImageIndex(-1);
      setSingleError(null);
      setPositivePrompt('');
      setNegativePrompt('');
      // 【角色特征缓存 Bug 修复】不再 reset characterTraits — 改为订阅 characterTraitStore，
      // store state 由 AssetManagerModal 管理，此处不应清空（避免影响其他订阅者）
      setTraitsError(null);
      setAdetailerAvailable(null);
      setImageRecognizing(false);
      // 重置自定义尺寸为默认值（2026-07-29 新增）
      setSelectedSize({ width: 1024, height: 1024 });
      // 重置视角镜头选择为空（2026-08-06 新增）
      setSelectedCameraAngle('');
      // 【临时编辑态】关闭弹窗时丢弃工作副本与编辑态，下次打开重新从 store 同步
      setEditedTraits(null);
      setEditingTraitId(null);
      setEditingText('');
      setAddingCategoryId(null);
      setAddingText('');
      // 【Spec: add-prompt-generation-in-asset-modal】关闭弹窗时清理提示词生成面板状态
      // 避免下次打开时残留上次的生成结果 / 输入文本 / RAG 报告 / 新增徽标
      setPromptGenInput('');
      setPromptGenResult(null);
      setPromptGenLoading(false);
      setPromptGenRagDebug(null);
      setPromptGenRagVisible(true);
      setAppliedPromptTraitIds(new Set());
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
      // 查找自定义情绪的 AI 生成提示词（Spec: enhance-custom-emotion-system）
      const customEmotion = manifest?.customEmotions?.find((e) => e.key === emotionKey);
      const customPrompts = customEmotion?.prompts;
      const isNLModel = sdConfig.modelType !== 'sdxl';
      const { prompt, negativePrompt: neg } = isNLModel
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
      return { key: emotionKey, prompt, negativePrompt: neg };
    },
    [sdConfig.positivePromptTemplate, sdConfig.customNegativePrompt, sdConfig.modelType, sdConfig.nlPromptTemplate, enabledTraitTexts, manifest],
  );

  // ====== 构建 SD 生成选项（传给 IPC 的 options 字段） ======
  // 【重点标记 - 特征携带机制】透传 characterTraits 到 options，
  // 由 sdGenerationService.generateExpression 内部替换 {traits} 占位符
  // 【Spec: add-trait-category-grouping / Task 6】characterTraits 改为传 enabled=true 项的 text 扁平化 string[]
  //





  const buildSdOptions = useCallback(() => {
    return buildSdOptionsFromConfig({
      sdConfig,
      enabledTraitTexts,
      effectiveTraits,
      characterLoras,
      selectedSize,
      selectedCameraAngle,
    });
  }, [sdConfig, enabledTraitTexts, effectiveTraits, characterLoras, selectedSize, selectedCameraAngle]);

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
    manifest,
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
          // 【Spec: enhance-conversation-image-auditability / Task 3】来源标识，落盘日志可据此区分素材管理图片
          options: {
            ...buildSdOptions(),
            sourceContext: { source: 'asset-manager' as const },
          },
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
    sdStatus,
    sdConfig.endpoint,
    positivePrompt,
    negativePrompt,
    buildEmotionPrompt,
    buildSdOptions,
  ]);

  // ====== 单次生成：保存 ======
  // ⚠️ 2026-08-07 行为变更：保存成功后不再调用 onClose() 关闭弹窗，
  // 让用户可连续生成多张图像（立绘/一般图像场景常见需求）。
  // 用户可点击「重新生成」追加新图，或点击「关闭」主动退出。
  // 表情/三视图模式保存为覆盖语义（同 key/slot 幂等），重复保存无副作用。
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
          // ⚠️ 2026-08-07：不再 onClose()，允许用户继续生成/保存（详见 handleSingleSave 顶部注释）
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
          // ⚠️ 2026-08-07：不再 onClose()，允许用户继续生成/保存（详见 handleSingleSave 顶部注释）
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
          // ⚠️ 2026-08-07：不再 onClose()，允许用户继续生成/保存（详见 handleSingleSave 顶部注释）
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
          // ⚠️ 2026-08-07：不再 onClose()，允许用户继续生成/保存（详见 handleSingleSave 顶部注释）
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
    // 【Spec: add-prompt-generation-in-asset-modal】重置时同步清除「新增」徽标
    // （提示词生成结果本身保留，用户仍可重新应用；仅清除已应用标记）
    setAppliedPromptTraitIds(new Set());
  }, [characterTraits]);

  // ====== 提示词生成 handlers（Spec: add-prompt-generation-in-asset-modal） ======
  // 流程：用户输入提示词 → 调用 ai:generateTraitPrompts IPC → 主进程 L0-L5 审计 →
  //       返回 CategorizedTrait[] + ragDebug → 用户确认「应用」追加到 editedTraits
  // 视觉风格：紫色边框 + ThunderboltOutlined

  /**
   * 触发 AI 提示词生成。
   *
   * 入参：promptGenInput（用户输入的提示词文本）
   * 上下文：enabledTraitTexts（当前已启用的特征文本，逗号拼接为 baseTraits 避免重复生成）
   *
   * 错误兜底：
   *  - 空输入：message.warning 提示，不调用 IPC
   *  - IPC 失败：message.error 展示后端返回的 error 字段
   *  - 网络异常：try/catch 兜底，message.error 展示异常 message
   *
   * 成功后：暂存 promptGenResult（CategorizedTrait[]，应用前不写入 editedTraits）+
   *        ragDebug（用于展示 L0-L5 审计质检报告）
   */
  const handleGenerateTraitPrompts = useCallback(async () => {
    const trimmed = promptGenInput.trim();
    if (!trimmed) {
      message.warning('请输入提示词');
      return;
    }
    setPromptGenLoading(true);
    setPromptGenRagDebug(null);
    try {
      // baseTraits = 当前已启用的特征文本（避免 LLM 重复生成已有 tag）
      // 【Spec: add-sdxl-prompt-weight-support / Task 3.3】仅取 .text 拼接，不带权重语法，
      // 避免 LLM 看到 (blue_eyes:1.5) 等权重语法产生混淆。
      const baseTraits = enabledTraitTexts.map((t) => t.text).join(', ');
      const result = await window.electronAPI.ai.generateTraitPrompts({
        prompt: trimmed,
        baseTraits: baseTraits || undefined,
      });
      if (result?.success) {
        const traits = result.traits || [];
        if (traits.length === 0) {
          message.info('AI 未从提示词中提取到任何特征，请尝试更具体的描述');
        } else {
          message.success(`AI 生成 ${traits.length} 条特征，请确认后应用`);
        }
        setPromptGenResult(traits);
        if (result.ragDebug) {
          setPromptGenRagDebug(result.ragDebug);
          setPromptGenRagVisible(true);
        }
      } else {
        message.error(result?.error || 'AI 提示词生成失败');
        setPromptGenResult(null);
      }
    } catch (error) {
      console.error('[AssetGenerateModal] AI 提示词生成失败:', error);
      message.error(error instanceof Error ? error.message : 'AI 提示词生成失败');
      setPromptGenResult(null);
    } finally {
      setPromptGenLoading(false);
    }
  }, [promptGenInput, enabledTraitTexts]);

  /**
   * 应用生成的特征到 editedTraits（按分类追加到末尾，保留原有顺序与结构）。
   *
   * 策略：
   *  - 为每个 CategorizedTrait 生成新 id（genTraitId）+ enabled=true
   *  - 透传 translation / originalText（AI 审计后保留的有效翻译 + 拆分溯源）
   *  - 追加到 editedTraits 末尾（按生成顺序，不重新排序）
   *  - 记录新 id 到 appliedPromptTraitIds（UI 渲染时显示「✨ 新增」徽标）
   *  - 清空 promptGenResult（应用后不允许重复应用，避免重复追加）
   *
   * ⚠️ 去重处理（2026-08-07 修复，详见 docs/FIX_RECORDS.md §7.23）：
   *  - 与已有特征去重：text（忽略大小写 + trim）已存在于 editedTraits 时跳过
   *  - 生成结果内部去重：AI 可能生成多条相同 tag（如两个 dog_girl），仅保留首条
   *  - 去重 key 为「text 小写 + trim」，与项目 SD 标签去重语义一致
   *    （text-only key，非 category+text 组合，详见 project_memory 教训记录）
   *  - 跳过条数通过 message 告知用户，避免静默丢弃
   *
   * 边界情况：
   *  - editedTraits === null（特征未加载）：兜底为 [...]，但因 traitStoreCardId 校验
   *    通常已加载，此处仅做防御性处理
   *  - 生成结果为空数组：直接清空 promptGenResult，无操作
   *  - 全部重复（skipCount === promptGenResult.length）：提示用户无新增，保留生成结果供参考
   */
  const handleApplyGeneratedTraits = useCallback(() => {
    if (!promptGenResult || promptGenResult.length === 0) {
      return;
    }
    // 构建已有特征的 text 集合（小写 + trim），用于与生成结果去重
    // 使用 effectiveTraits（editedTraits ?? characterTraits）获取当前工作副本
    const existingTextKeys = new Set(
      effectiveTraits.map((t) => t.text.trim().toLowerCase())
    );
    // 生成结果内部也需要去重（AI 可能返回多条相同 tag）
    const seenInBatch = new Set<string>();
    const newItems: CharacterTraitItem[] = [];
    let skipCount = 0;
    for (const trait of promptGenResult) {
      const key = trait.text.trim().toLowerCase();
      if (existingTextKeys.has(key) || seenInBatch.has(key)) {
        skipCount++;
        continue;
      }
      seenInBatch.add(key);
      newItems.push({
        id: genTraitId(),
        text: trait.text,
        categoryId: trait.categoryId,
        enabled: true,
        translation: trait.translation,
        originalText: trait.originalText,
        // 【Spec: add-sdxl-prompt-weight-support / Task 9.2】透传 CategorizedTrait.weight，
        // AI 生成的权重应用到 editedTraits 后由 renderTraitsPanel 显示可编辑徽标。
        weight: trait.weight,
      });
    }
    // 全部重复：提示用户无新增，保留生成结果供用户参考（不清空 promptGenResult）
    if (newItems.length === 0) {
      message.info(`生成的 ${promptGenResult.length} 条特征均已存在于当前列表，未追加重复项`);
      return;
    }
    setEditedTraits((prev) => {
      const base = prev ?? [];
      return [...base, ...newItems];
    });
    // 记录新 id 用于 UI 视觉标识「✨ 新增」徽标
    setAppliedPromptTraitIds((prev) => {
      const next = new Set(prev);
      for (const item of newItems) {
        next.add(item.id);
      }
      return next;
    });
    // 应用后清空生成结果（避免重复应用导致重复追加）
    setPromptGenResult(null);
    setPromptGenRagDebug(null);
    setPromptGenInput('');
    // 有跳过时告知用户跳过条数，避免静默丢弃
    if (skipCount > 0) {
      message.success(`已追加 ${newItems.length} 条特征，跳过 ${skipCount} 条重复项`);
    } else {
      message.success(`已追加 ${newItems.length} 条 AI 生成特征到下方列表`);
    }
  }, [promptGenResult, effectiveTraits]);

  /**
   * 放弃生成的特征（清空生成结果与 RAG 报告，保留输入文本以便用户修改后重试）。
   */
  const handleDiscardGeneratedTraits = useCallback(() => {
    setPromptGenResult(null);
    setPromptGenRagDebug(null);
  }, []);

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
   *
   * 【Spec: add-ai-tag-chinese-translation / Task 4】保存新 text 时同步清空 translation，
   * 避免旧翻译与新 tag 不符（手动编辑后的 tag 视为用户自定义，不再携带 AI 翻译）。
   *
   * 【Spec: optimize-trait-translation-and-temp-scheme / Task 4】同步清空 originalText，
   * 编辑后的标签不再是「L3 颜色拆分生成」，与 translation 清空语义一致（避免前端继续显示
   * SplitCellsOutlined 拆分图标 + 拆分溯源 Tooltip，但 text 已与 originalText 不对应）。
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
            t.id === editingTraitId
              ? { ...t, text: trimmed, translation: undefined, originalText: undefined }
              : t,
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
   * 【Spec: add-sdxl-prompt-weight-support / Task 7.3】临时更新特征权重。
   *
   * 与 handleToggleTraitEnabledLocal / handleDeleteTrait 同模式：仅修改 editedTraits 本地副本，
   * 不调用 useCharacterTraitStore.updateTraitWeight（与 AssetManagerModal 的关键差异）。
   * 编辑在用户关闭弹窗 / 重置前保留在工作副本，应用生成时由 effectiveTraits 派生消费。
   *
   * 使用 setEditedTraits(prev => ...) 函数式更新，避免 stale closure（项目内存规则）。
   * weight 为 undefined 时清空字段（等价于默认 1.0，不进入 SDXL 加权语法）。
   * 不显示成功 message：权重变化通过徽标视觉反馈，与其他行内编辑 handler 一致。
   */
  const handleUpdateTraitWeight = useCallback(
    (traitId: string, weight: number | undefined) => {
      setEditedTraits((prev) =>
        prev
          ? prev.map((t) =>
              t.id === traitId
                ? {
                    ...t,
                    weight:
                      typeof weight === 'number' && !isNaN(weight)
                        ? weight
                        : undefined,
                  }
                : t,
            )
          : prev,
      );
    },
    [],
  );

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

  // ====== 组合方案 handlers（Spec: optimize-trait-translation-and-temp-scheme / Task 5+6） ======
  //
  // 三个 handler 共同支撑「组合方案」下拉 UI（renderTraitsPanel 头部）：
  // - handleSaveTempScheme：将当前 editedTraits 工作副本（含临时新增/编辑/启用状态/translation/
  //   originalText）作为 traitSnapshot 保存为命名方案，跨会话保留。原「AI 图片识别」按钮位置由
  //   下拉 + 「存方案」按钮替代（不再单独放「临时方案保存」按钮，避免重复入口）。
  // - handleApplyCombination：下拉切换方案时调用。traitSnapshot 方案用快照完整替换 editedTraits
  //   （解决「保存方案后编辑特征 → 应用方案时特征丢失」问题）；traitIds 方案（旧）仅切换 enabled。
  //   两者均同步 store.activeCombinationId（applyCombination），让下拉显示当前激活方案。
  // - handleDeleteCombination：删除当前激活方案，二确后调 deleteCombination。

  /**
   * 保存临时方案：弹出 Modal.confirm 输入方案名，校验非空后调 saveCombination。
   *
   * - traitSnapshot 入参为 editedTraits 深拷贝（saveCombination 内部还会再深拷贝一次，双重保险
   *   避免后续 editedTraits 编辑污染快照）
   * - saveCombination 内部已 fire-and-forget 调 saveTraits 持久化，调用方无需 await
   * - 重名时弹出二次确认框，用户可选择「覆盖」或「取消」；覆盖走 overwriteCombination
   */
  const handleSaveTempScheme = useCallback(() => {
    if (!editedTraits) return;
    // 弹出输入框获取方案名
    let schemeName = '';
    const doSave = (trimmed: string) => {
      // 保存方案（传入 editedTraits 快照，含临时新增/编辑/启用状态/translation/originalText）
      const result = saveCombination(trimmed, editedTraits.map((t) => ({ ...t })));
      if (result.success) {
        message.success(`方案「${trimmed}」已保存`);
      } else {
        message.error(result.error || '保存方案失败');
      }
    };
    const doOverwrite = (trimmed: string) => {
      const result = overwriteCombination(trimmed, editedTraits.map((t) => ({ ...t })));
      if (result.success) {
        message.success(`方案「${trimmed}」已覆盖`);
      } else {
        message.error(result.error || '覆盖方案失败');
      }
    };
    Modal.confirm({
      title: '保存临时方案',
      content: (
        <Input
          placeholder="请输入方案名称"
          onChange={(e) => { schemeName = e.target.value; }}
          autoFocus
        />
      ),
      onOk: () => {
        const trimmed = schemeName.trim();
        if (!trimmed) {
          message.error('方案名称不能为空');
          return Promise.reject();
        }
        // 检查重名：重名时弹二次确认框让用户选择覆盖或取消
        const existing = combinations.some((c) => c.name === trimmed);
        if (existing) {
          Modal.confirm({
            title: '覆盖已有方案',
            content: `已存在同名方案「${trimmed}」，是否覆盖其内容？`,
            okText: '覆盖',
            okButtonProps: { danger: true },
            cancelText: '取消',
            onOk: () => doOverwrite(trimmed),
          });
          return; // 不 reject，让外层 confirm 关闭，由内层 confirm 接管
        }
        doSave(trimmed);
      },
    });
  }, [editedTraits, combinations, saveCombination, overwriteCombination]);

  /**
   * 应用组合方案到 editedTraits（下拉 onChange）。
   *
   * - combinationId === '__manual__'：取消激活（applyCombination(null)），editedTraits 保持不变
   *   （用户手动编辑的状态不被覆盖，仅 store.activeCombinationId 重置为 null）
   * - traitSnapshot 方案：用快照完整替换 editedTraits（深拷贝，保留 text/categoryId/enabled/id/
   *   translation/originalText 全部字段），解决「保存方案后编辑特征 → 应用方案时特征丢失」问题
   * - traitIds 方案（旧）：仅切换 editedTraits 的 enabled 状态，trait 本身不变（向后兼容）
   *
   * 两者均调 applyCombination(combinationId) 同步 store.activeCombinationId，让下拉显示当前激活方案。
   * applyCombination 内部不持久化（仅切换 state），与 store.saveCombination/deleteCombination 的
   * 即时持久化策略不同。
   */
  const handleApplyCombination = useCallback((combinationId: string) => {
    if (combinationId === '__manual__') {
      applyCombination(null);
      // applyCombination(null) 已同步从 preCombinationTraits 备份恢复 store.traits，
      // 此处需同步 editedTraits 到恢复后的 traits，否则本地 editedTraits 仍停留在上一个方案的快照
      const restoredTraits = useCharacterTraitStore.getState().traits;
      setEditedTraits(restoredTraits.map((t) => ({ ...t })));
      return;
    }
    const combination = combinations.find((c) => c.id === combinationId);
    if (!combination) return;

    if (combination.traitSnapshot && combination.traitSnapshot.length > 0) {
      // traitSnapshot 方案：用快照替换 editedTraits（深拷贝，避免后续编辑污染快照）
      setEditedTraits(combination.traitSnapshot.map((t) => ({ ...t })));
      applyCombination(combinationId);  // 同步 store 状态（store 内部会备份 traits）
    } else {
      // traitIds 方案（旧）：切换 editedTraits 的 enabled 状态
      const traitIds = new Set(combination.traitIds);
      setEditedTraits((prev) =>
        prev ? prev.map((t) => ({ ...t, enabled: traitIds.has(t.id) })) : prev,
      );
      applyCombination(combinationId);  // 同步 store 状态
    }
  }, [combinations, applyCombination]);

  /**
   * 删除当前激活方案（二确后调 deleteCombination）。
   *
   * - 无 activeCombinationId 时 no-op（按钮已 disabled，此处二次防御）
   * - deleteCombination 内部会 fire-and-forget 调 saveTraits 持久化
   * - 删除激活方案时 store 会重置 activeCombinationId = null（进入手动模式），下拉自动回到「手动模式」
   */
  const handleDeleteCombination = useCallback(() => {
    if (!activeCombinationId) return;
    Modal.confirm({
      title: '删除方案',
      content: '确定删除当前方案？此操作不可撤销。',
      onOk: () => {
        const result = deleteCombination(activeCombinationId);
        if (result.success) {
          message.success('方案已删除');
          // 删除激活的 traitSnapshot 方案时，store 已从备份恢复 traits，
          // 此处同步 editedTraits 到恢复后的 traits
          const restoredTraits = useCharacterTraitStore.getState().traits;
          setEditedTraits(restoredTraits.map((t) => ({ ...t })));
        } else {
          message.error(result.error || '删除方案失败');
        }
      },
    });
  }, [activeCombinationId, deleteCombination]);

  // ====== 渲染辅助 ======

  /** 当前正在生成的情绪标签（从预置/自定义列表查找） */
  const currentEmotionLabel = batchProgress
    ? EMOTION_PRESETS.find((e) => e.key === batchProgress.emotionKey)?.label ||
      manifest?.customEmotions?.find((e) => e.key === batchProgress.emotionKey)?.label ||
      batchProgress.emotionKey
    : '';

  /** single-expression 模式标题中的情绪标签 */
  const singleEmotionLabel =
    targetEmotionLabel ||
    EMOTION_PRESETS.find((e) => e.key === targetEmotionKey)?.label ||
    manifest?.customEmotions?.find((e) => e.key === targetEmotionKey)?.label ||
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
            ? '立绘模板: {camera}, {traits}, ... （{camera} 默认 full body）'
            : mode === 'general'
            ? '一般图像模板: {traits}, {camera}, ...'
            : `三视图模板: ${targetSlot || 'front'} view, full body, solo, {traits}, white background`}
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

  /**
   * 提示词生成面板（Spec: add-prompt-generation-in-asset-modal）。
   *
   * 位置：「携带角色特征」区域正上方（renderTraitsPanel 之前）。
   * 视觉风格：紫色渐变边框 + ThunderboltOutlined 图标 + Input.TextArea + 主按钮。
   *
   * 交互流程：
   *  1. 用户在 TextArea 输入提示词（如 "red hair, blue dress, forest background"）
   *  2. 点击「生成提示词」按钮 → handleGenerateTraitPrompts 调用 ai:generateTraitPrompts IPC
   *  3. 主进程内部走 L0-L5 完整审计链 + RAG 标签库参考注入，返回 CategorizedTrait[] + ragDebug
   *  4. 结果按分类分组展示（Tag + 翻译 Tooltip），下方显示「应用」/「放弃」按钮
   *  5. 用户点击「应用」→ handleApplyGeneratedTraits 追加到 editedTraits 末尾，
   *     新增项在下方 renderTraitsPanel 中显示「✨ 新增」徽标
   *  6. RAG 质检报告（RagQualityReport 组件，只读模式）展示 L0-L5 审计命中情况
   *
   * 错误处理：
   *  - 空输入：按钮禁用（disabled），点击触发 message.warning
   *  - IPC 失败 / 网络异常：message.error 展示错误信息，结果区不显示
   *  - AI 返回空特征：message.info 提示，结果区显示「未提取到特征」
   */
  const renderPromptGenPanel = () => {
    // 构建分类列表（系统分类 + 自定义分类 + 未分类），用于结果分组展示
    const allCategories: TraitCategory[] = [
      ...SYSTEM_TRAIT_CATEGORIES,
      ...traitGlobalCategories,
      UNCATEGORIZED_CATEGORY,
    ].sort((a, b) => a.order - b.order);

    // 按分类分组生成结果（仅展示有特征的分类）
    const traitsByCategory = new Map<string, CategorizedTrait[]>();
    if (promptGenResult) {
      for (const trait of promptGenResult) {
        const list = traitsByCategory.get(trait.categoryId);
        if (list) {
          list.push(trait);
        } else {
          traitsByCategory.set(trait.categoryId, [trait]);
        }
      }
    }
    const groupedCategories = allCategories.filter((c) => traitsByCategory.has(c.id));

    return (
      <div
        style={{
          marginBottom: 12,
          padding: 10,
          background: 'rgba(139, 92, 246, 0.05)',
          borderRadius: 8,
          border: '1px solid rgba(139, 92, 246, 0.2)',
          fontSize: 12,
        }}
      >
        {/* 标题行 */}
        <div
          style={{
            color: 'var(--text-primary, #e2e8f0)',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
            fontWeight: 600,
          }}
        >
          <ThunderboltOutlined style={{ color: '#a78bfa' }} />
          <span>提示词生成</span>
          <span
            style={{
              color: 'var(--text-tertiary, #6b7280)',
              fontSize: 11,
              fontWeight: 400,
            }}
          >
            （AI 解析自然语言为分类特征 tag，应用后追加到下方「携带角色特征」列表）
          </span>
        </div>

        {/* 输入区：TextArea + 生成按钮 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Input.TextArea
            value={promptGenInput}
            onChange={(e) => setPromptGenInput(e.target.value)}
            placeholder="输入提示词，如：red hair, blue dress, forest background；或自然语言：穿着哥特风服装站在森林里"
            autoSize={{ minRows: 2, maxRows: 4 }}
            disabled={promptGenLoading}
            style={{
              flex: 1,
              background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
              color: 'var(--text-primary, #e2e8f0)',
              borderColor: 'rgba(139, 92, 246, 0.2)',
            }}
          />
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={promptGenLoading}
            onClick={handleGenerateTraitPrompts}
            disabled={promptGenLoading || !promptGenInput.trim()}
            style={{
              background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
              borderColor: 'transparent',
            }}
          >
            生成提示词
          </Button>
        </div>

        {/* 结果展示区：仅当 promptGenResult 非空时渲染 */}
        {promptGenResult && (
          <div style={{ marginTop: 10 }}>
            {promptGenResult.length === 0 ? (
              <div
                style={{
                  color: 'var(--text-tertiary, #6b7280)',
                  fontSize: 12,
                  padding: '8px 0',
                }}
              >
                AI 未从提示词中提取到任何特征，请尝试更具体的描述
              </div>
            ) : (
              <>
                <div
                  style={{
                    color: 'var(--text-secondary, #94a3b8)',
                    fontSize: 12,
                    marginBottom: 6,
                  }}
                >
                  AI 生成结果（共 {promptGenResult.length} 条，按分类展示，确认后点击「应用」追加到下方特征列表）：
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {groupedCategories.map((category) => {
                    const catTraits = traitsByCategory.get(category.id) || [];
                    return (
                      <div key={`prompt-gen-cat-${category.id}`}>
                        <div
                          style={{
                            color: 'var(--text-secondary, #94a3b8)',
                            fontSize: 11,
                            marginBottom: 4,
                          }}
                        >
                          {category.name}（{catTraits.length}）
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 4,
                            alignItems: 'center',
                            minHeight: 28,
                            padding: '4px 8px',
                            background: 'var(--chat-bubble-assistant-bg, rgba(30, 30, 46, 0.5))',
                            border: '1px solid rgba(139, 92, 246, 0.15)',
                            borderRadius: 4,
                          }}
                        >
                          {catTraits.map((trait, index) => {
                            // 【Spec: add-sdxl-prompt-weight-support / Task 9.1】AI 生成结果
                            // 仅显示只读权重徽标（无 Popover 编辑器，应用后可在 renderTraitsPanel 编辑）。
                            // 显示条件：weight 非 undefined 且非 1.0（与 renderTraitsPanel 的 hasWeight 一致）。
                            const hasWeight =
                              trait.weight !== undefined && trait.weight !== 1.0;
                            return (
                            <Tooltip
                              key={`prompt-gen-tag-${category.id}-${index}`}
                              title={
                                trait.translation
                                  ? `翻译：${trait.translation}${trait.originalText ? `（来源：${trait.originalText}）` : ''}${hasWeight ? `（权重 ×${trait.weight!.toFixed(1)}）` : ''}`
                                  : trait.originalText
                                    ? `来源：${trait.originalText}${hasWeight ? `（权重 ×${trait.weight!.toFixed(1)}）` : ''}`
                                    : hasWeight
                                      ? `权重 ×${trait.weight!.toFixed(1)}`
                                      : ''
                              }
                            >
                              <Tag
                                color="purple"
                                style={{
                                  margin: 0,
                                  fontSize: 11,
                                  cursor: 'help',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                }}
                              >
                                {trait.text}
                                {/* 【Spec: add-sdxl-prompt-weight-support / Task 9.1】只读权重徽标：
                                    >1.0 暖橙（强化）/ <1.0 冷蓝（弱化），与 renderTraitsPanel 配色一致。
                                    cursor: default（非 pointer）— 此处为 AI 生成结果展示，不可点击编辑；
                                    应用后可在 renderTraitsPanel 通过 Popover 编辑。 */}
                                {hasWeight && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      padding: '0 4px',
                                      borderRadius: 4,
                                      marginLeft: 4,
                                      cursor: 'default',
                                      lineHeight: '16px',
                                      color: trait.weight! > 1.0 ? '#fa8c16' : '#1677ff',
                                      background:
                                        trait.weight! > 1.0
                                          ? 'rgba(250, 140, 22, 0.15)'
                                          : 'rgba(22, 119, 255, 0.15)',
                                      border: `1px solid ${
                                        trait.weight! > 1.0
                                          ? 'rgba(250, 140, 22, 0.4)'
                                          : 'rgba(22, 119, 255, 0.4)'
                                      }`,
                                      flexShrink: 0,
                                      userSelect: 'none',
                                    }}
                                  >
                                    ×{trait.weight!.toFixed(1)}
                                  </span>
                                )}
                              </Tag>
                            </Tooltip>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 应用 / 放弃按钮 */}
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    marginTop: 8,
                  }}
                >
                  <Button
                    size="small"
                    type="primary"
                    icon={<CheckOutlined />}
                    onClick={handleApplyGeneratedTraits}
                    style={{
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                      borderColor: 'transparent',
                      fontSize: 11,
                    }}
                  >
                    应用到特征列表
                  </Button>
                  <Button
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={handleDiscardGeneratedTraits}
                    style={{ fontSize: 11 }}
                  >
                    放弃
                  </Button>
                  <span
                    style={{
                      color: 'var(--text-tertiary, #6b7280)',
                      fontSize: 11,
                    }}
                  >
                    应用后将追加到下方「携带角色特征」列表末尾，并标记为「✨ 新增」
                  </span>
                </div>

                {/* RAG 质检报告（只读模式，不传 onRevert/onManualReplace 回调） */}
                {promptGenRagDebug && (
                  <div style={{ marginTop: 10 }}>
                    <RagQualityReport
                      ragDebug={promptGenRagDebug}
                      visible={promptGenRagVisible}
                      onToggle={() => setPromptGenRagVisible(!promptGenRagVisible)}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

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
    // 【Spec: optimize-expression-preset-prompts】表情模式下 expression 分类特征自动过滤，
    // UI 层也需反映：enabledCount 与 enabledInCat 均排除 expression 分类（表情模式下）
    const isTraitAutoFiltered = (t: CharacterTraitItem) =>
      isExpressionMode && t.categoryId === 'expression';
    const enabledCount = traits.filter(
      (t) => t.enabled && !isTraitAutoFiltered(t),
    ).length;
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
          {isExpressionMode && (
            <Tooltip title="表情模式下，「人物表情」分类特征已自动清空（由情绪预设 EMOTION_PROMPT_MAP 提供表情 tag），避免与预置提示词冲突。其他模式不受影响。">
              <Tag color="orange" style={{ margin: 0, fontSize: 11, cursor: 'help' }}>
                表情特征已自动清空
              </Tag>
            </Tooltip>
          )}
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
          {/* 【Spec: optimize-trait-translation-and-temp-scheme / Task 5】
              原「AI 图片识别」按钮（supportsVision ? Button : Tooltip「图片识别不可用」）已移除，
              替换为下方的「组合方案」下拉 + 存方案/删方案按钮组合。
              - handleImageRecognize 函数定义保留（不删除），仅移除按钮渲染入口
              - supportsVision / imageRecognizing 状态变量保留（不删除），避免破坏其他潜在引用
              - 「存方案」按钮整合到下方下拉行（Task 6），不再单独放「临时方案保存」按钮（避免重复入口） */}
        </div>
        {/* 【Spec: optimize-trait-translation-and-temp-scheme / Task 5+6】组合方案下拉 + 存方案/删方案按钮
            * 替代原「AI 图片识别」按钮位置（已移除）。用户可在生成弹窗内直接：
            * - 切换已保存的组合方案（applyCombination）：traitSnapshot 方案用快照完整替换 editedTraits，
            *   traitIds 方案仅切换 enabled
            * - 将当前 editedTraits 工作副本（含临时新增/编辑/启用状态/translation/originalText）保存为
            *   命名方案（saveCombination + traitSnapshot），跨会话保留
            * - 删除当前激活方案（deleteCombination）
            * - 「手动模式」选项（value='__manual__'）：applyCombination(null)，editedTraits 保持不变
            * - 方案名后 📋 emoji 标识 traitSnapshot 方案（与 traitIds 方案区分，让用户知道该方案会完整替换特征）
            */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          <span style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 11 }}>组合方案</span>
          <Select
            size="small"
            value={activeCombinationId ?? '__manual__'}
            onChange={handleApplyCombination}
            style={{ width: 140, fontSize: 11 }}
            options={[
              { value: '__manual__', label: '手动模式' },
              ...combinations.map((c) => ({
                value: c.id,
                label: c.traitSnapshot ? `${c.name} 📋` : c.name,
              })),
            ]}
          />
          <Tooltip title="将当前编辑的特征保存为方案">
            <Button size="small" icon={<SaveOutlined />} onClick={handleSaveTempScheme} style={{ fontSize: 11 }}>
              存方案
            </Button>
          </Tooltip>
          <Tooltip title="删除当前方案">
            <Button
              size="small"
              icon={<DeleteOutlined />}
              disabled={!activeCombinationId}
              onClick={handleDeleteCombination}
              style={{ fontSize: 11 }}
            >
              删方案
            </Button>
          </Tooltip>
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
              const enabledInCat = catTraits.filter(
                (t) => t.enabled && !isTraitAutoFiltered(t),
              ).length;
              const isAdding = addingCategoryId === category.id;
              // 【Spec: optimize-expression-preset-prompts】表情模式下 expression 分类自动过滤
              const isCatAutoFiltered =
                isExpressionMode && category.id === 'expression';
              return (
                <Collapse.Panel
                  key={category.id}
                  header={
                    <span style={{ fontSize: 12 }}>
                      {category.name}
                      {isCatAutoFiltered && (
                        <Tag
                          color="orange"
                          style={{ marginLeft: 6, marginInlineEnd: 0, fontSize: 10, lineHeight: '16px' }}
                        >
                          已自动清空
                        </Tag>
                      )}
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
                      // 【Spec: add-prompt-generation-in-asset-modal】标识通过「提示词生成」面板
                      // 应用追加的 trait（在 appliedPromptTraitIds 集合中），UI 显示 ✨ 前缀徽标
                      // 让用户直观区分「AI 生成追加」与「手动临时新增」（两者都是 cyan，但前者多一个 ✨）
                      const isPromptGenerated = appliedPromptTraitIds.has(trait.id);
                      // 【Spec: optimize-expression-preset-prompts】表情模式下 expression 分类自动过滤
                      // UI 层将该分类下的所有特征显示为「已清空」灰态（置灰 + 删除线 + 不可点击），
                      // 与 enabledTraitTexts 的过滤行为保持一致，让用户直观看到特征已被清空。
                      const isAutoFiltered = isTraitAutoFiltered(trait);
                      // 【Spec: add-sdxl-prompt-weight-support / Task 7】权重徽标显示逻辑：
                      // 始终显示权重徽标（包括默认 1.0），让用户能直观看到并点击修改每个 tag 的权重。
                      // - weightValue：用于展示的权重值（undefined 兜底为 1.0）
                      // - isDefaultWeight：是否为默认权重（1.0 或 undefined），决定徽标视觉弱化
                      // - hasWeight：是否为非默认权重，决定是否使用彩色高亮（仅用于颜色逻辑）
                      // - isAutoFiltered 时权重无意义（特征已被表情模式清空），不显示徽标。
                      const weightValue = trait.weight ?? 1.0;
                      const isDefaultWeight =
                        trait.weight === undefined || trait.weight === 1.0;
                      const hasWeight = !isAutoFiltered && !isDefaultWeight;
                      // 颜色策略：
                      //  - 自动过滤（表情模式下 expression 分类）→ default（灰显 + 删除线）
                      //  - 临时新增（非 store）+ enabled → cyan（青色，区分 store 特征）
                      //  - 临时新增 + disabled → default（灰显）
                      //  - store 特征 + enabled + 已修改 → orange
                      //  - store 特征 + enabled + 原始 → purple
                      //  - store 特征 + disabled → default（灰显）
                      const tagColor = isAutoFiltered
                        ? 'default'
                        : !trait.enabled
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
                        // 【Spec: add-ai-tag-chinese-translation / Task 6】用 Tooltip 包裹 Tag，
                        // translation 存在时 hover 显示中文翻译；空字符串 title 不弹出（不影响点击切换启用）。
                        // 【Spec: optimize-expression-preset-prompts】自动过滤的特征 Tooltip 改为
                        // 提示「表情模式下已自动清空」，覆盖 translation 显示。
                        // 【Spec: optimize-trait-translation-and-temp-scheme / Task 4】当 trait.originalText
                        // 存在（L3 颜色拆分生成）且非 isAutoFiltered 时，Tooltip 改为多行展示
                        // 「原标签 / 拆分为 / 翻译」，让用户直观看到拆分溯源信息。
                        // 【Spec: add-sdxl-prompt-weight-support / Task 7.1 + 7.4】外层改为 <span> 包裹
                        // Tooltip + 权重徽标 Popover（徽标为 Tooltip 的兄弟节点，与 AssetManagerModal 一致）。
                        // key 从 Tooltip 移到外层 span（React 列表 key 必须在最外层元素）。
                        <span
                          key={`tip-${trait.id}`}
                          style={{ display: 'inline-flex', alignItems: 'center' }}
                        >
                        <Tooltip
                          title={
                            isAutoFiltered
                              ? '表情模式下已自动清空（由情绪预设提供表情 tag），其他模式恢复正常'
                              : trait.originalText || trait.translation || hasWeight
                                ? (
                                  <div style={{ lineHeight: 1.6 }}>
                                    {trait.originalText && <div>原标签：{trait.originalText}</div>}
                                    {trait.originalText && <div>拆分为：{trait.text}</div>}
                                    {trait.translation && <div>翻译：{trait.translation}</div>}
                                    {/* 【Spec: add-sdxl-prompt-weight-support / Task 7.4】权重行始终展示：
                                        - 非默认权重：>1.0 暖橙（强化）/ <1.0 冷蓝（弱化），与徽标配色一致
                                        - 默认权重 1.0：使用次级文本色（弱化），让用户在 Tooltip 中也能看到当前权重值 */}
                                    <div
                                      style={{
                                        color: isDefaultWeight
                                          ? 'var(--text-secondary, #94a3b8)'
                                          : weightValue > 1.0
                                            ? '#fa8c16'
                                            : '#1677ff',
                                      }}
                                    >
                                      权重：{weightValue.toFixed(1)}
                                    </div>
                                  </div>
                                )
                                : trait.translation || ''
                          }
                        >
                          <Tag
                            key={trait.id}
                            color={tagColor}
                            closable={!isAutoFiltered}
                            onClose={(e) => {
                              e.preventDefault();
                              handleDeleteTrait(trait.id);
                            }}
                            style={{
                              margin: 0,
                              opacity: isAutoFiltered ? 0.35 : trait.enabled ? 1 : 0.45,
                              cursor: isAutoFiltered ? 'not-allowed' : 'pointer',
                              userSelect: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 2,
                              textDecoration: isAutoFiltered ? 'line-through' : 'none',
                            }}
                            // 点击 Tag 切换启用状态（临时）；自动过滤的特征不响应点击
                            onClick={() => {
                              if (isAutoFiltered) return;
                              handleToggleTraitEnabledLocal(trait.id);
                            }}
                          >
                            {/* 【Spec: optimize-trait-translation-and-temp-scheme / Task 4】
                                拆分标签视觉标识：trait.originalText 存在（L3 颜色拆分生成）且
                                非 isAutoFiltered 时在文字前显示 SplitCellsOutlined 图标，让用户
                                一眼看出该 tag 是从复合标签拆分而来。 */}
                            {trait.originalText && !isAutoFiltered && (
                              <SplitCellsOutlined style={{ fontSize: 10, marginRight: 2, opacity: 0.7 }} />
                            )}
                            {/* 【Spec: add-prompt-generation-in-asset-modal】AI 生成追加标识：
                                isPromptGenerated=true 时在文字前显示 ✨ 徽标，让用户直观区分
                                「AI 提示词生成应用」与「手动临时新增」（两者 Tag 颜色均为 cyan） */}
                            {isPromptGenerated && (
                              <span style={{ fontSize: 10, marginRight: 2 }} title="AI 提示词生成追加">
                                ✨
                              </span>
                            )}
                            {trait.text}
                            {/* 编辑图标：点击进入行内编辑（stopPropagation 避免触发 toggle） */}
                            <EditOutlined
                              style={{
                                fontSize: 10,
                                marginLeft: 2,
                                opacity: 0.7,
                                display: isAutoFiltered ? 'none' : undefined,
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartEditTrait(trait.id, trait.text);
                              }}
                            />
                          </Tag>
                        </Tooltip>
                        {/* 权重徽标 + 编辑器 Popover（Spec: add-sdxl-prompt-weight-support / Task 7.1 + 7.2）
                            - 始终渲染（包括默认权重 1.0），让用户能随时点击修改任意 tag 的权重
                            - 默认权重（1.0/undefined）：灰色弱化 + 虚线边框，提示「可点击调整」
                            - 非默认权重：>1.0 暖橙色（#fa8c16 强化）/ <1.0 冷蓝色（#1677ff 弱化），半透明背景
                            - 点击徽标弹出 Popover 编辑器（InputNumber + Slider + 预设 + 重置）
                            - stopPropagation 避免冒泡触发 Tag 的 onClick（切换启用状态）
                            - isAutoFiltered 时不渲染（表情模式下 expression 分类已清空，权重无意义）
                            - 与 AssetManagerModal 视觉设计完全一致（Task 8 复用模式） */}
                        {!isAutoFiltered && (
                          <Popover
                            trigger="click"
                            placement="top"
                            title={`权重编辑（${trait.text}）`}
                            content={
                              <WeightEditorContent
                                weight={trait.weight}
                                onChange={(val) => handleUpdateTraitWeight(trait.id, val)}
                                onReset={() => handleUpdateTraitWeight(trait.id, undefined)}
                              />
                            }
                          >
                            <span
                              title={`权重 ×${weightValue.toFixed(1)}，点击修改`}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                fontSize: 10,
                                padding: '0 4px',
                                borderRadius: 4,
                                marginLeft: 4,
                                cursor: 'pointer',
                                lineHeight: '16px',
                                // 默认权重：灰色弱化 + 虚线边框（提示可点击调整）
                                // 非默认权重：橙色（>1.0 强化）/ 蓝色（<1.0 弱化）+ 半透明背景
                                color: isDefaultWeight
                                  ? 'var(--text-tertiary, #8c8c8c)'
                                  : weightValue > 1.0
                                    ? '#fa8c16'
                                    : '#1677ff',
                                background: isDefaultWeight
                                  ? 'transparent'
                                  : weightValue > 1.0
                                    ? 'rgba(250, 140, 22, 0.15)'
                                    : 'rgba(22, 119, 255, 0.15)',
                                border: isDefaultWeight
                                  ? '1px dashed rgba(255, 255, 255, 0.2)'
                                  : `1px solid ${
                                      weightValue > 1.0
                                        ? 'rgba(250, 140, 22, 0.4)'
                                        : 'rgba(22, 119, 255, 0.4)'
                                    }`,
                                opacity: isDefaultWeight ? 0.7 : 1,
                                flexShrink: 0,
                                userSelect: 'none',
                              }}
                            >
                              ×{weightValue.toFixed(1)}
                            </span>
                          </Popover>
                        )}
                        </span>
                      );
                    })}
                    {/* 新增临时标签入口 */}
                    {/* 【Spec: implement-local-tag-autocomplete / Task 7】原 Input 替换为 TagAutocomplete，
                        提供基于本地标签库的实时推荐。onTagSelect 选中推荐 tag 后追加到 editedTraits
                        并清空输入框（不退出新增模式，允许连续添加多个 tag）；onPressEnter 仍走原
                        handleConfirmAddTrait（输入自定义 tag 后按 Enter 添加并退出新增模式）；
                        Escape 仍走 handleCancelAddTrait 退出新增模式。降级开关关闭时由
                        TagAutocomplete 内部回退为普通 Input（onPressEnter / onKeyDown 已透传）。 */}
                    {isAdding ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 2,
                        }}
                      >
                        <TagAutocomplete
                          size="small"
                          autoFocus
                          placeholder="输入临时标签"
                          value={addingText}
                          onChange={setAddingText}
                          onTagSelect={(tag) => {
                            // 选中推荐 tag 后：直接添加到 editedTraits 并清空输入框。
                            // 不退出新增模式（不调用 handleConfirmAddTrait，避免 setAddingCategoryId(null)），
                            // 允许用户连续添加多个推荐 tag。Escape 键仍可退出，旁边 ✓ 按钮也可主动退出。
                            // addingCategoryId 在 isAdding=true 时必然非空（isAdding = addingCategoryId === category.id）。
                            if (!addingCategoryId) return;
                            const newTrait: CharacterTraitItem = {
                              id: genTraitId(),
                              text: tag.name,
                              categoryId: addingCategoryId,
                              enabled: true,
                            };
                            setEditedTraits((prev) =>
                              prev ? [...prev, newTrait] : prev,
                            );
                            setAddingText('');
                          }}
                          onPressEnter={handleConfirmAddTrait}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              handleCancelAddTrait();
                            }
                          }}
                          showSortButton={false}
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
      const totalEmotions = EMOTION_PRESETS.length + (manifest?.customEmotions?.length ?? 0);
      const summary = batchSummary || {
        total: totalEmotions,
        success: stats.success,
        failed: stats.failed,
        cancelled:
          batchStage === 'cancelled'
            ? totalEmotions - stats.success - stats.failed
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
   * 包含 Alert + 参数概览 + 正/负面提示词 + 生成按钮
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
    ? '点击「生成」按钮，将通过 SD 文生图（提示词 + 角色 LoRA）生成角色立绘（{camera} 默认 full body，可在上方视角镜头下拉调整），不使用图像参考。'
        : mode === 'general'
        ? '点击「生成」按钮，将通过 SD 文生图（提示词 + 角色 LoRA）生成一般场景图像，不使用图像参考。'
        : `点击「生成」按钮，将通过 SD 文生图（提示词 + 角色 LoRA）生成${threeViewSlotLabel}三视图（solo 单角色 + white background），不使用图像参考。`;

    const isGenerating = singleStage === 'generating';

    return (
      <>
        <Alert type="info" showIcon message={idleTitle} description={idleDesc} />

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
            description="点击「保存」将当前预览图片写入角色卡素材目录（保存后弹窗保持打开，可继续生成更多图像）；点击「重新生成」将追加一张新图到历史。可用左右按钮浏览本次会话已生成的所有图片。"
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

  // 【Spec: optimize-trait-translation-and-temp-scheme / Task 5】
  // 原「AI 图片识别」按钮渲染入口已移除（替换为「组合方案」下拉 + 存方案/删方案按钮），
  // 但保留 supportsVision / imageRecognizing / handleImageRecognize 定义（spec 要求不删除），
  // 以便未来恢复按钮渲染入口时可直接复用。void 引用避免 noUnusedLocals 报错（TS6133）。
  void supportsVision;
  void imageRecognizing;
  void handleImageRecognize;

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
            {/* 【Spec: add-prompt-generation-in-asset-modal】提示词生成面板（携带角色特征区域正上方） */}
            {renderPromptGenPanel()}
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
              {/* 【Spec: add-prompt-generation-in-asset-modal】提示词生成面板（携带角色特征区域正上方） */}
              {renderPromptGenPanel()}
              {renderTraitsPanel()}
              <SizeSelector
                width={selectedSize.width}
                height={selectedSize.height}
                onChange={(w, h) => setSelectedSize({ width: w, height: h })}
              />
              {/* 视角镜头选择（2026-08-06 新增，2026-08-06 重构为按模式默认值）
                  * 三视图模式不渲染（视角由 targetSlot 程序化决定 front/side/back，不可用户选择）
                  * 立绘/表情（SDXL）/一般图像模板含 {camera} 占位符，选中 tag 由 applyTraitsAndLora 替换
                  * 弹窗打开/模式切换时自动初始化为模式默认值（立绘=full body，表情=portrait, looking at viewer）
                  * 生成中禁用，避免切换 */ }
              {mode !== 'three-view' && (
                <CameraAngleSelector
                  value={selectedCameraAngle}
                  onChange={setSelectedCameraAngle}
                  disabled={singleStage === 'generating'}
                />
              )}
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
