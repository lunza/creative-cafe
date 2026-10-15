/**
 * 引擎默认值单一来源（Spec: settings-feature-optimization-report / H-5, CR-1 + M-6/FL-7）
 *
 * 背景：0.7/10240 等引擎默认值在权威源 shared/settings.ts 中为 undefined，
 * UI 层（Settings.tsx/useAIEngineSettings.ts/AIEngineSettingsPanel.tsx）、
 * 保存映射层（?? 兜底）、服务消费层（WorldBook/writing/character 等 30+ 处）
 * 各自硬编码，且主进程 storageService.initializeDefaultData 还有一份
 * 与渲染侧不一致的引擎默认定义（FL-7）。
 *
 * 本模块是全仓设置默认值的唯一定义处：
 * - DEFAULT_ENGINE_PARAMS：引擎级默认参数常量
 * - buildDefaultEngine()：默认引擎对象的唯一构造
 * - DEFAULT_SD_WEBUI_CONFIG / DEFAULT_WEB_SEARCH_CONFIG /
 *   DEFAULT_TAG_AUTOCOMPLETE_CONFIG / DEFAULT_TAG_RAG_CONFIG /
 *   DEFAULT_VECTOR_CONFIGS：6 个设置面板的域默认值（M-2/CR-2，
 *   从各面板文件迁入，消除与 defaultSetting 的双份定义）
 * - buildDefaultSetting()：完整默认设置的唯一构造（M-6/FL-7，渲染侧
 *   shared/settings.ts 与主进程 initializeDefaultData 必须都引用它）
 *
 * 纯常量 + 纯函数，无依赖，主进程/渲染进程均可用。
 * （配置域类型仅 type-only 导入，编译期擦除，不产生运行时跨层依赖。）
 */
import type {
  SDWebuiConfig,
  WebSearchConfig,
  TagAutocompleteConfig,
  TagRagConfig,
  AppSetting,
  AIEngineSetting,
} from '../renderer/types/setting';
import type { VectorDefaults } from '../renderer/types/vectorConfig';
import type { ForbiddenWordsConfig } from './types/forbiddenWords';
import { DEFAULT_FORBIDDEN_WORDS_CONFIG, DEFAULT_ENFORCEMENT, DEFAULT_REPLACEMENT_TEXT, DEFAULT_MAX_RETRIES } from './types/forbiddenWords';

/** 引擎级默认参数（全仓唯一定义，所有 UI 层/保存映射层/服务消费层引用必须指向这里） */
export const DEFAULT_ENGINE_PARAMS = {
  /** 默认最大输出 token 数 */
  maxTokens: 10240,
  /** 默认温度（0-2） */
  temperature: 0.7,
  /** 连接超时（毫秒）：等待响应头到达 */
  connectionTimeout: 120000,
  /** 请求超时（毫秒）：整体请求完成 */
  requestTimeout: 300000,
  /** 默认 api_url（本地 llama.cpp 服务） */
  apiBaseUrl: 'http://127.0.0.1:5000',
} as const;

/**
 * 构造默认引擎对象（唯一来源）。
 *
 * 【重点标记 - FL-7 双默认设置合一】此前渲染侧 shared/settings.ts 与主进程
 * storageService.initializeDefaultData 各维护一份引擎默认定义且已漂移
 * （主进程缺 capabilities/connection_timeout/request_timeout，max_generation_length
 * 1024 vs undefined）。现在两边都调用本函数，字段级一致。
 */
export function buildDefaultEngine(): AIEngineSetting {
  return {
    id: 'default',
    name: '默认引擎',
    api_url: DEFAULT_ENGINE_PARAMS.apiBaseUrl,
    api_key: '',
    model_name: 'llmfan46/Qwen3.5-27B-heretic-v3-no-think',
    api_mode: 'chat_completion',
    // 后端能力探测（Spec: optimize-chat-ai-intelligence / Task 6.2）
    // 仅支持 chat_completion 模式。
    // 用户可在设置 UI 中按 engine type 显式覆盖此字段。
    capabilities: {
      supportsStopArray: true,
      supportsRepPen: false,
      supportsDrySampler: false,
      supportsVision: false,
      supportsThinking: false,
      supportsToolCalling: false,
    },
    // 聊天补全模式配置
    system_prompt: '',
    temperature: DEFAULT_ENGINE_PARAMS.temperature,
    max_tokens: DEFAULT_ENGINE_PARAMS.maxTokens,
    streaming: true,
    enable_chain_of_thought: false,
    // 采样参数（parameterResolver 消费；top_p 缺省 undefined = 不注入）
    top_p: undefined,
    top_k: 0,
    min_p: 0.1,
    rep_pen: 1,
    no_repeat_ngram_size: 0,
    dry_multiplier: 0,
    dry_base: 1.75,
    dry_allowed_length: 2,
    // 续写去重提示词（SillyTavern continue_nudge_prompt 机制，报告 S-5 裁定保留）
    continue_nudge_prompt: "[Continue your last message without repeating its original content.]",
    // 高级参数
    frequency_penalty: undefined,
    presence_penalty: undefined,
    use_function_calling: false,
    useAgent: false,
    connection_timeout: DEFAULT_ENGINE_PARAMS.connectionTimeout,
    request_timeout: DEFAULT_ENGINE_PARAMS.requestTimeout,
    api_key_transmission: 'header'
  };
}

// ============================================================================
// 配置域默认值（Spec: settings-feature-optimization-report / M-2, CR-2）
//
// 此前各面板文件（SDWebuiSettings.tsx / WebSearchSettings.tsx 等）各自内联
// DEFAULT_*_CONFIG 常量，与 shared/settings.ts defaultSetting 同域字段构成
// 双份定义（合计 ~123 行重复）。现统一收敛到本模块，面板与 buildDefaultSetting
// 均从这里导入，任何域默认值修改只改这一处。
// ============================================================================

/**
 * SD WebUI 默认配置（原 SDWebuiSettings.tsx DEFAULT_SD_WEBUI_CONFIG 迁入）。
 * 当 setting.sdWebui 不存在时（旧配置迁移场景）用于初始化表单。
 * 端点对应 Forge Neo 默认端口；model 留空表示使用 SD WebUI 当前已加载模型。
 */
export const DEFAULT_SD_WEBUI_CONFIG: SDWebuiConfig = {
  endpoint: 'http://localhost:7860',
  model: '',
  denoisingStrength: 0.55,
  steps: 28,
  cfgScale: 7,
  sampler: 'DPM++ 3M SDE',
  scheduler: 'Karras',
  clipSkip: 2,
  adetailerEnabled: true,
  // 【重点标记 - 特征携带机制（Spec: add-asset-and-trait-management / Task 5）】
  // 默认模板含 {traits} 与 {emotion} 两个占位符
  positivePromptTemplate: 'portrait, {traits}, looking at viewer, simple background, {emotion}, high quality, best quality, masterpiece, detailed face',
  customNegativePrompt: '',
  // ADetailer 高级参数默认值（与 sdGenerationService ADETAILER_* 常量一致）
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
  // NL 模型相关（Spec: integrate-nl-driven-sd-models / Task 2）
  modelType: 'sdxl',
  nlPromptTemplate: 'A portrait of a character. {traits} The character has {emotion}, looking at the viewer. High quality, detailed.',
  txt2imgWidth: 1024,
  txt2imgHeight: 1024,
  selectedLoras: [],
  // 【Hires.fix】默认开启修复与放大，4x-AnimeSharp 放大器
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
  // 【重点标记 - img2img 高清模式（2026-07-29）】
  // Forge Neo img2img 不支持 Hires.fix，通过两种替代方案实现高清修复
  img2imgHiresMode: 'two-step',
};

/**
 * 网络搜索默认配置（原 WebSearchSettings.tsx DEFAULT_WEB_SEARCH_CONFIG 迁入）。
 * 注意：此前 shared/settings.ts defaultSetting 漏定义 webSearch 域（双定义漂移），
 * buildDefaultSetting() 已补齐，以本常量为唯一来源。
 */
export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = {
  enabled: false,
  provider: 'duckduckgo',
  apiKey: '',
  endpoint: '',
  maxResults: 5,
  timeout: 10000,
  allowedDomains: [],
  enableInAuthoring: false,
};

/**
 * 标签自动推荐默认配置（原 TagAutocompleteSettings.tsx DEFAULT_TAG_AUTOCOMPLETE_CONFIG 迁入）。
 * sortBy='relevance' 默认按匹配相关度排序。
 * 【M-15/S-10】csvPath 不再走 settings 持久化（真实路径为 tag:setCsvPath IPC，
 * 主进程 TagAutocompleteService 持有），已从本默认值与类型中移除。
 */
export const DEFAULT_TAG_AUTOCOMPLETE_CONFIG: TagAutocompleteConfig = {
  enabled: true,
  sortBy: 'relevance',
};

/**
 * RAG 标签库默认配置（原 TagRagSettings.tsx DEFAULT_TAG_RAG_CONFIG 迁入）。
 * enabled=false 默认关闭，用户向量标签库后手动开启。
 */
export const DEFAULT_TAG_RAG_CONFIG: TagRagConfig = {
  enabled: false,
  topK: 40,
  minScore: 0.15,
  autoRevectorizeOnCsvChange: true,
  autoRevectorizeOnDimensionChange: true,
  batchSize: 500,
  localBatchSize: 32,
  concurrency: 3,
  retryMaxAttempts: 3,
  retryDelayMs: 1000,
};

/**
 * 向量配置域默认值（原 VectorConfigPanel.tsx DEFAULT_CONFIGS 迁入）。
 * 按 embeddingMode 区分 remote/local 两套参数。
 */
export const DEFAULT_VECTOR_CONFIGS: Record<'remote' | 'local', VectorDefaults> = {
  remote: {
    remoteModel: 'text-embedding-3-small',
    remoteApiUrl: 'https://api.openai.com/v1/embeddings',
    remoteApiKey: '',
    cacheEnabled: true,
    cacheL1Size: 1000,
    cacheL1TTL: 300,
    cacheL2TTL: 3600,
    defaultTopK: 5,
    minSimilarityScore: 0.7,
    contextWindowTokens: 4096,
    autoVectorizeWorldBook: true,
    autoVectorizeKnowledge: true,
    dimension: 4096,
  },
  local: {
    localModel: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
    cacheEnabled: true,
    cacheL1Size: 2000,
    cacheL1TTL: 600,
    cacheL2TTL: 7200,
    defaultTopK: 8,
    minSimilarityScore: 0.6,
    contextWindowTokens: 8192,
    autoVectorizeWorldBook: true,
    autoVectorizeKnowledge: true,
    dimension: 1024,
  },
};

/**
 * 备用 Provider 条目（与主进程 failoverPolicy.ts FallbackProvider 字段对齐；
 * shared 层不依赖 main，此处独立声明同构类型）。
 */
export interface DefaultFallbackProvider {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
}

/**
 * 完整默认设置类型（M-6/FL-7）。
 * 在渲染层 AppSetting 之外补充主进程实存键：
 * - *Path 五键：__USER_DATA__ 占位符路径，消费方（characterHandlers/memoryHandlers）
 *   读取时经 resolveUserDataPlaceholder 解析，磁盘存占位符本身；
 * - fallbackProviders：AIConfigProvider 备用引擎列表（主进程消费）。
 */
export type DefaultSetting = AppSetting & {
  characterPath: string;
  worldBookPath: string;
  avatarPath: string;
  creativePath: string;
  memoryPath: string;
  fallbackProviders: DefaultFallbackProvider[];
};

/**
 * 构造完整默认设置对象（M-6/FL-7 唯一来源）。
 *
 * 【重点标记 - 双默认合一】此前渲染侧 shared/settings.ts defaultSetting 与主进程
 * storageService.initializeDefaultData 各维护一份顶层默认定义且已漂移：
 * 主进程侧含 *Path/fallbackProviders 而无 vector/sdWebui 等配置域，渲染侧反之，
 * 且 webSearch 域两边都缺。现在两边都调用本函数，字段级一致。
 *
 * 键集以磁盘实存键为准（报告 5.4 风险提示 6）：*Path 五键与 fallbackProviders
 * 为首次启动行为所依赖，保留；sillyTavernRoot/pluginPath/autoOptimize 等零消费
 * 孤儿键不进入默认定义，由 M-5/M-15 迁移钩子从磁盘剥离。
 */
export function buildDefaultSetting(): DefaultSetting {
  return {
    preset_name: 'Default',
    aiEngines: [buildDefaultEngine()],
    activeEngineId: 'default',
    defaultEngineId: 'default',
    logLevel: 'info',
    dashboardBackgroundImage: '',
    // 【M-13/S-12】animationEnabled / compactMode 已删除：uiStore 是唯一真相源，
    // 磁盘侧死键由 settingMigrations v3 剥离。
    debugMode: false,
    vector: {
      embeddingMode: 'remote',
      remoteModel: DEFAULT_VECTOR_CONFIGS.remote.remoteModel,
      remoteApiUrl: DEFAULT_VECTOR_CONFIGS.remote.remoteApiUrl,
      remoteApiKey: '',
      cacheEnabled: true,
      cacheL1Size: 1000,
      cacheL1TTL: 300,
      cacheL2TTL: 3600,
      defaultTopK: 5,
      minSimilarityScore: 0.7,
      contextWindowTokens: 4096,
      autoVectorizeWorldBook: true,
      autoVectorizeKnowledge: true,
    },
    sdWebui: { ...DEFAULT_SD_WEBUI_CONFIG, selectedLoras: [] },
    tagAutocomplete: { ...DEFAULT_TAG_AUTOCOMPLETE_CONFIG },
    tagRag: { ...DEFAULT_TAG_RAG_CONFIG },
    // 禁词域默认值引用 shared/types/forbiddenWords 的权威常量（消除 settings.ts
    // 此前对 categories 示例数据的内联复制）。enforcement 三字段显式写出，
    // 保证新装用户的 settings.json 中可见（原 settings.ts 同款语义）。
    forbiddenWords: {
      ...DEFAULT_FORBIDDEN_WORDS_CONFIG,
      enforcement: DEFAULT_ENFORCEMENT,
      replacementText: DEFAULT_REPLACEMENT_TEXT,
      maxRetries: DEFAULT_MAX_RETRIES,
    } as ForbiddenWordsConfig,
    dialogueNaturalness: {
      deAiEnabled: true,
      samplingPresetEnabled: false,
    },
    webSearch: { ...DEFAULT_WEB_SEARCH_CONFIG },
    // 主进程实存键：__USER_DATA__ 占位符（消费方读取时解析）
    characterPath: '__USER_DATA__/data/characters',
    worldBookPath: '__USER_DATA__/data/worldbooks',
    avatarPath: '__USER_DATA__/data/avatars',
    creativePath: '__USER_DATA__/data/creatives',
    memoryPath: '__USER_DATA__/data/memories',
    fallbackProviders: [],
  };
}
