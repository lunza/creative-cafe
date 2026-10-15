/**
 * AI 后端能力探测字段。
 * Spec: optimize-chat-ai-intelligence / Task 3.3 / Task 6.2
 */
import type { ForbiddenWordsConfig } from '@shared/types/forbiddenWords';

export interface AIEngineCapabilities {
  supportsStopArray?: boolean;
  supportsRepPen?: boolean;
  supportsDrySampler?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
  supportsToolCalling?: boolean;
}

/**
 * Stable Diffusion WebUI 配置（Spec: add-ai-expression-generation / Task 6）
 *
 * 用于角色卡 AI 表情生成（img2img）的 SD WebUI 连接参数与生成参数。
 * 配置由 Settings 页面 SDWebuiSettings 组件编辑，主进程 sdGenerationService 读取。
 *
 * 【重点标记 - ADetailer-Neo 兼容性 + 参数扩展（2026-07-27）】
 * 早期版本仅暴露 endpoint/model/denoisingStrength/steps/cfgScale/adetailerEnabled，
 * 缺少采样器选择与 ADetailer 高级参数，导致用户报告「步数/Sampling Method/cfg 固定无法更改」
 * 且 ADetailer-Neo 因字段名错误（ad_inpaint_full_res / ad_dilation）抛 pydantic 校验异常。
 * 本次扩展新增 sampler 字段与全套 ADetailer 高级参数，字段名严格对齐
 * `extensions/ADetailer-Neo/lib_adetailer/args.py` 的 `ADetailerArgs` 定义。
 */
export interface SDWebuiConfig {
  /** SD WebUI API 端点，默认 http://localhost:7860（Forge Neo 需以 --api 启动） */
  endpoint: string;
  /** 模型 checkpoint 标题；空字符串表示使用 SD WebUI 当前已加载模型 */
  model: string;
  /** 去噪强度（0=不变，1=完全重绘），默认 0.55 */
  denoisingStrength: number;
  /** 采样步数，默认 28（SDXL 推荐） */
  steps: number;
  /** 提示词遵循度（CFG Scale），默认 7 */
  cfgScale: number;
  /**
   * 采样器名称，默认 "DPM++ 2M Karras"。
   * 【重点标记 - 采样器可配置】早期版本 SDWebuiConfig 缺少此字段，UI 无采样器选择控件，
   * 导致用户报告「Sampling Method 固定无法更改」。新增字段后用户可在设置页下拉选择
   * 常用采样器或手动输入自定义采样器名。
   */
  sampler: string;
  /**
   * 调度器名称（2026-07-29 新增），默认 "Karras"。
   * Forge Neo 将采样器与调度器分离，sampler_name 控制采样算法，
   * scheduler 控制 sigma 调度曲线（Karras/Exponential/Auto 等）。
   */
  scheduler: string;
  /**
   * CLIP Skip 层数（2026-07-29 新增），默认 2。
   * 通过 override_settings.CLIP_stop_at_last_layers 注入。
   * SD1.5 推荐 2，SDXL 推荐 1~2。
   */
  clipSkip: number;
  /** 是否启用 ADetailer 面部一致性修复，默认 true */
  adetailerEnabled: boolean;
  /**
   * 正面提示词模板，支持 `{emotion}` 与 `{traits}` 两个占位符。
   *
   * 【重点标记 - 提示词可编辑】用户可在此输入角色外观 tag（如 "1girl, silver hair"），
   * 不再自动注入角色卡 description 长文本（自然语言不适合 SD tag 格式）。
   *
   * 【重点标记 - 特征携带机制（Spec: add-asset-and-trait-management / Task 5）】
   * - `{traits}` 占位符：由 `PromptBuilder.buildExpressionGenerationPrompt` 替换为角色视觉特征 tag 字符串
   *   （来自 `characterTraitStore`，如 `white fur, dog girl`）；特征为空时替换为空字符串并清理多余逗号
   * - `{emotion}` 占位符：替换为情绪专用提示词（来自 `EMOTION_PROMPT_MAP`）
   * - 旧配置兼容：若用户模板不含 `{traits}` 占位符，特征 tag 会在 prompt 开头追加（不破坏旧模板）
   *
   * 默认值：'portrait, {traits}, looking at viewer, simple background, {emotion}, high quality, best quality, masterpiece, detailed face'
   * （{traits} 放在 portrait 之后，确保角色特征优先；{emotion} 位置保留）
   */
  positivePromptTemplate: string;
  /** 自定义负面提示词；空字符串表示使用 PromptBuilder 默认负面提示词 */
  customNegativePrompt: string;

  // ===== ADetailer 高级参数（2026-07-27 新增）=====
  // 字段名与 ADetailer-Neo 的 ADetailerArgs 严格对齐，避免 pydantic extra="forbid" 报错。
  /** ADetailer 检测模型，默认 "face_yolov8n.pt"（2D/真实人脸，速度快） */
  adModel: string;
  /**
   * ADetailer 检测类别（2026-08-07 新增，仅 YOLO-World 模型生效）。
   *
   * 【重点标记 - Furry/拟人生物面部识别扩展】
   * 源码位置：ADetailer-Neo args.py `ad_model_classes`。
   * 仅当 adModel 为 YOLO-World 系列（文件名含 "world"）时生效，
   * 透传给 ultralytics_predict 的 classes 参数实现零样本开放词汇检测。
   * 空字符串=使用模型默认 COCO 80 类；填入文本提示如
   * "furry face, anthro head, animal head, kemono face" 可检测任意类别。
   * 非 YOLO-World 模型此字段被忽略。
   */
  adModelClasses?: string;
  /** 检测置信度阈值（0.0-1.0），默认 0.3 */
  adConfidence: number;
  /** ADetailer 面部修复去噪强度（0.0-1.0），默认 0.4 */
  adDenoisingStrength: number;
  /** mask 边缘模糊（像素，0-20），默认 4 */
  adMaskBlur: number;
  /** mask 膨胀/腐蚀（像素，正值膨胀/负值腐蚀），默认 4 */
  adDilateErode: number;
  /** 仅修复 mask 区域（true=局部高分辨率修复，false=全图重绘），默认 true */
  adInpaintOnlyMasked: boolean;
  /** mask padding（像素，仅 adInpaintOnlyMasked=true 时生效），默认 32 */
  adInpaintOnlyMaskedPadding: number;
  /** 使用独立的修复尺寸（开启后 adInpaintWidth/adInpaintHeight 生效），默认 false */
  adUseInpaintWidthHeight: boolean;
  /** ADetailer 修复宽度（像素），默认 512 */
  adInpaintWidth: number;
  /** ADetailer 修复高度（像素），默认 512 */
  adInpaintHeight: number;
  /** 使用独立的步数（开启后 adSteps 生效），默认 false */
  adUseSteps: boolean;
  /** ADetailer 独立步数（1-150），默认 20 */
  adSteps: number;
  /** 使用独立的 CFG（开启后 adCfgScale 生效），默认 false */
  adUseCfgScale: boolean;
  /** ADetailer 独立 CFG（1.0-24.0），默认 4.0 */
  adCfgScale: number;
  /** 使用独立的采样器（开启后 adSampler 生效），默认 false */
  adUseSampler: boolean;
  /** ADetailer 独立采样器名称，默认 "Use same sampler"（沿用主采样器） */
  adSampler: string;
  /** ADetailer 独立调度器，默认 "Use same scheduler"（沿用主调度器） */
  adScheduler: string;
  /**
   * ADetailer 独立负面提示词（2026-07-29 源码核验新增）。
   * 空字符串=沿用主负面提示词。可针对性优化面部修复质量。
   * 源码：ADetailer-Neo args.py:50 ad_negative_prompt
   */
  adNegativePrompt: string;
  /** 是否启用 ADetailer 独立噪声倍率（2026-07-29 源码核验新增），默认 true */
  adUseNoiseMultiplier: boolean;
  /** ADetailer 独立噪声倍率（0.5-1.5），默认 1.0。源码：args.py:79 ad_noise_multiplier */
  adNoiseMultiplier: number;

  // NL 模型相关
  modelType: 'sdxl' | 'qwen-image' | 'qwen-image-edit' | 'flux2';
  nlPromptTemplate: string;
  txt2imgWidth: number;
  txt2imgHeight: number;

  /** 选中的 LoRA 模型列表（含名称和权重），生成时注入 <lora:name:weight> 到 prompt */
  selectedLoras?: Array<{ name: string; weight: number }>;

  // ===== Hires.fix 高分辨率修复参数（2026-07-29 新增）=====
  // 【重点标记 - Hires.fix 修复与放大】默认开启，Upscaler=Latent，Hires steps=50，
  // 其他参数沿用 webui-forge-neo 默认值。仅在 img2img（sdxl）和 txt2img 流程中生效。
  /** 是否启用 Hires.fix 高分辨率修复，默认 true */
  hrFixEnabled: boolean;
  /** Hires.fix 放大器，默认 "Latent" */
  hrUpscaler: string;
  /** Hires.fix 步数，默认 50 */
  hrSteps: number;
  /** Hires.fix 放大倍数，默认 2.0 */
  hrScale: number;
  /** Hires.fix 去噪强度（0-1），默认 0.55 */
  hrDenoisingStrength: number;
  /** Hires.fix 第二轮提示词，默认空字符串表示沿用第一轮 prompt */
  hrPrompt: string;
  /** Hires.fix 第二轮负面提示词，默认空字符串表示沿用第一轮 */
  hrNegativePrompt: string;
  /**
   * Hires.fix 第二轮 CFG（2026-07-29 新增），默认 5.0。
   * 【重点标记 - hr_cfg 默认 1.0 陷阱】Forge Neo 的 hr_cfg 默认值为 1.0，
   * 意味着 Hires 第二阶段不使用负提示，导致细节大幅丢失。
   * 显式设为 5.0 恢复负提示引导，显著提升细节锐度。
   */
  hrCfg: number;
  /** Hires.fix 独立采样器（2026-07-29 新增），默认 "DPM++ 2M SDE" */
  hrSamplerName: string;
  /** Hires.fix 独立调度器（2026-07-29 新增），默认 "Karras" */
  hrScheduler: string;
  /**
   * img2img 额外噪声（2026-07-29 新增），默认 0.05。
   * 通过 override_settings.img2img_extra_noise 注入。
   * >0 在 img2img 降采样后添加微量噪声，增加细节丰富度。
   */
  img2imgExtraNoise: number;
  /**
   * img2img 初始噪声倍率（2026-07-29 新增），默认 1.0。
   * 控制添加到 init_images 的噪声量（0~1.5），略 >1 可增加细节。
   */
  initialNoiseMultiplier: number;

  // ===== img2img 高清模式（2026-07-29 新增）=====
  // Forge Neo 的 img2img API 不支持 Hires.fix（StableDiffusionProcessingImg2Img 类
  // 无 enable_hr 等字段），因此通过以下两种替代方案实现高清修复效果：
  // - 'direct'：直接在目标分辨率（1024）下一步 img2img 生成，速度快
  // - 'two-step'：先 768 生成 → 再 1024 低降噪放大修复，细节保留更好，接近 Hires.fix 效果
  img2imgHiresMode: 'direct' | 'two-step';
}

/**
 * AI 引擎设置组
 *
 * 【M-15/S-5 孤儿键批量删除（Phase 3）】原 130+ 字段中 ~95 个 SillyTavern 遗留
 * 采样/提示词/模式字段全仓无消费（仅类型与默认值种子残留），已删除并经
 * settingMigrations v3 迁移钩子从磁盘剥离。现存 31 个字段均有真实消费链路：
 * - 请求构造：parameterResolver.resolveEngineParams（temperature/max_tokens/top_p/
 *   top_k/min_p/rep_pen/frequency_penalty/presence_penalty/no_repeat_ngram_size/
 *   dry 采样组）+ ChatEngine/AIService（api 连接与 streaming/system_prompt 等）
 * - Agent 链路：use_function_calling/useAgent/agentModeOverride
 * - 连接：connection_timeout/request_timeout/api_key_transmission
 * 保留 continue_nudge_prompt（报告 S-5 裁定：续写去重机制消费）。
 */
export interface AIEngineSetting {
  id: string;
  name: string;
  // API 连接配置
  api_url: string;
  api_key: string;
  model_name: string;
  api_mode: string;
  /**
   * 模型系列参数模板 id（Spec: analyze-llamacpp-model-compatibility）。
   * 用户在引擎表单手动选择的系列，用于"应用官方推荐参数"；缺省未选择。
   * 取值见 src/shared/modelParameterPresets.ts MODEL_SERIES_PRESETS。
   */
  model_series?: string;
  /**
   * 思考模式联动（Spec: analyze-llamacpp-model-compatibility）。
   * 保存引擎时由 model_series 对应模板的 thinking 字段推导：
   * - 'off'：请求体显式 enable_thinking=false（Qwen 非思考）
   * - 'on' ：请求体显式 enable_thinking=true（Qwen 思考）
   * - 缺省：不干预（沿用 enable_chain_of_thought + supportsThinking 旧逻辑）
   */
  thinking_mode?: 'on' | 'off' | 'auto';
  /**
   * 后端能力探测（Spec: optimize-chat-ai-intelligence / Task 3.3）。
   * 缺省时由调用方通过 getDefaultEngineCapabilities() 推断默认值。
   * Task 6 将在设置 UI 中允许用户按 engine type 显式配置。
   */
  capabilities?: AIEngineCapabilities;

  // 聊天补全模式配置
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  streaming: boolean;
  enable_chain_of_thought: boolean;

  // 采样参数（parameterResolver 消费，会话级可覆盖）
  // top_p/frequency_penalty/presence_penalty 缺省 undefined = 请求体不注入
  // （预存缺陷修复：原声明为必填 number 但默认值即 undefined，strict 下 TS2322）
  top_p?: number;
  top_k: number;
  min_p: number;
  rep_pen: number;
  no_repeat_ngram_size: number;
  dry_multiplier: number;
  dry_base: number;
  dry_allowed_length: number;
  /**
   * 续写去重提示词（SillyTavern continue_nudge_prompt 机制）。
   * 报告 S-5 裁定保留：续写去重重试时注入 system 消息。
   */
  continue_nudge_prompt: string;

  // 高级参数（缺省 undefined = 请求体不注入，与 top_p 同语义）
  frequency_penalty?: number;
  presence_penalty?: number;
  use_function_calling: boolean;
  /**
   * 智能体模式开关（Task 16.2）。
   * 默认 false（灰度）。开启后对话走 AgentCore + 对话组工具。
   * 仅在模型 supportsToolCalling=true 时生效，否则降级为纯文本聊天。
   * @deprecated 已被 agentModeOverride 三态开关替代，保留为只读兼容快照
   */
  useAgent: boolean;
  /**
   * 智能体模式覆盖（三态开关）。
   *
   * Spec: add-agent-mode-management-and-center / Task 1
   * - 'auto'：根据引擎能力自动判定（默认）
   * - 'force-on'：强制启用智能体模式
   * - 'force-off'：强制关闭智能体模式
   * 由 agentModeService 读取并计算最终 active 状态，
   * 替代旧 useAgent 布尔开关。
   */
  agentModeOverride?: 'auto' | 'force-on' | 'force-off';

  // 请求超时设置（毫秒）
  /**
   * 连接超时：等待响应头到达的最大时间（TTFB）。
   * 流式请求在响应头到达后立即清除；非流式请求在响应头到达后清除。
   * 兼容深度思考模型首字延迟较长的情况。
   * 默认 120000ms（120秒），0 表示不限制。
   */
  connection_timeout?: number;
  /**
   * 请求超时：完整 AI 请求的最大时长。
   * 调用方可通过 requestConfig.timeout 覆盖此值；传 0 表示无限制。
   * 默认 300000ms（300秒）。
   */
  request_timeout?: number;

  // API 密钥传输方式
  api_key_transmission: 'header' | 'body';
}

/**
 * 网络搜索配置（对应 AppSetting.webSearch）
 * 与 src/main/services/webSearchProviders/types.ts 中 WebSearchConfig 保持一致。
 * 由 Settings 页面 WebSearchSettings 组件编辑，主进程 webSearchService 读取。
 */
export interface WebSearchConfig {
  /** 全局开关 */
  enabled: boolean;
  /** 搜索引擎提供商 */
  provider: 'duckduckgo' | 'tavily' | 'searxng' | 'custom';
  /** API 密钥（Tavily 等 provider 用） */
  apiKey: string;
  /** 端点 URL（SearXNG / Custom 用） */
  endpoint: string;
  /** 默认结果数 */
  maxResults: number;
  /** 请求超时（ms） */
  timeout: number;
  /** 域名白名单 */
  allowedDomains: string[];
  /** 世界书编写智能体集成开关 */
  enableInAuthoring: boolean;
}

/**
 * 标签自动推荐配置（Spec: implement-local-tag-autocomplete / Task 4）
 *
 * 用于 TagAutocomplete 组件的本地标签库推荐功能。配置由 Settings 页面
 * TagAutocompleteSettings 组件（Task 6 实现）编辑，主进程 TagAutocompleteService 读取。
 *
 * 设计要点：
 * - 采用嵌套对象模式，与 webSearch / sdWebui 配置块保持一致
 * - enabled=false 时 TagAutocomplete 组件降级为普通 Input（Task 5 实现）
 *
 * 【M-15/S-10 csvPath 移除（Phase 3）】CSV 路径的真实生效路径是
 * tag:setCsvPath IPC（主进程 TagAutocompleteService 持有 this.csvPath），
 * settings 侧 csvPath 为冗余持久化，已删除并经 v3 迁移钩子从磁盘剥离。
 * 设置面板的路径显示/选择直接走 tag:getLoadStatus / tag:setCsvPath IPC。
 */
export interface TagAutocompleteConfig {
  /** 是否启用标签自动推荐（关闭时 TagAutocomplete 组件降级为普通 Input） */
  enabled: boolean;
  /** 默认排序规则：relevance=按匹配相关度 / count=按使用次数降序 / alphabetical=按字母升序 */
  sortBy: 'relevance' | 'count' | 'alphabetical';
}

/**
 * RAG 标签库配置（Spec: rag-tag-library-for-ai-trait-generation / Task 3）。
 *
 * 与 TagAutocompleteConfig（子串匹配查询）正交，本配置控制「向量化 + 语义检索」：
 *  - 将 31.7 万标签向量化存储到 sqlite-vec
 *  - AI 生成特征时用角色描述检索 top-K 相关标签注入 prompt
 *  - 引导 LLM 使用 Danbooru/e621 标签库内的有效 tag（下划线格式）
 *
 * 持久化策略：作为 AppSetting 嵌套字段随整体 setting.save / setting.load IPC 自动持久化到
 * electron-store（settings.json），与 tagAutocomplete 一致。
 * 旧配置兼容：可选字段，旧 settings.json 缺失此字段时 TagRagService 使用代码内默认值。
 */
export interface TagRagConfig {
  /** 是否启用 RAG 标签库注入（关闭时 characterTraitAIService 完全跳过 RAG 检索） */
  enabled: boolean;
  /** 检索返回的标签数量（默认 40；增大可提供更多参考但增加 prompt 长度） */
  topK: number;
  /** 最低相似度阈值（0-1，cosine similarity；低于此分数的标签被过滤） */
  minScore: number;
  /** CSV 文件变更时自动标记索引为 stale（下次启动后提示重新向量化） */
  autoRevectorizeOnCsvChange: boolean;
  /** embedding 维度变更时自动标记索引为 stale */
  autoRevectorizeOnDimensionChange: boolean;
  /** 远程 API 向量化批大小（默认 500，受 API 单次输入限制，OpenAI 支持最高 2048） */
  batchSize: number;
  /** 本地 ONNX 向量化批大小（默认 32，受 CPU/GPU 推理速度影响） */
  localBatchSize: number;
  /** 远程 API 并发请求数（默认 3，提高可显著加快向量化速度，受 API 速率限制约束） */
  concurrency: number;
  /** 单批 embedding 失败时的重试次数（线性退避） */
  retryMaxAttempts: number;
  /** 重试间隔基础延迟（ms，乘以 attempt 次数） */
  retryDelayMs: number;
}

/**
 * 设置类型定义
 */
export interface AppSetting {
  // 预设配置
  preset_name: string;
  
  // AI 引擎设置组
  aiEngines: AIEngineSetting[];
  activeEngineId: string;
  defaultEngineId: string;
  
  // 外观设置
  dashboardBackgroundImage: string;

  // 【M-13/S-12】animationEnabled / compactMode 已删除：uiStore（localStorage）
  // 是唯一真相源，所有 UI 消费方（App/Dashboard/GeneralSettingsPanel/PageTransition）
  // 均读 useUIStore，settings.json 侧两键只写不读，经 v3 迁移钩子从磁盘剥离。

  // 日志设置
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  
  // 调试模式设置
  debugMode: boolean;

  // 向量化设置
  vector?: {
    embeddingMode?: 'remote' | 'local' | 'disabled';
    remoteModel?: string;
    remoteApiKey?: string;
    remoteApiUrl?: string;
    localModel?: string;
    /** 向量维度（磁盘实存键，EmbeddingService 消费；UI 按本地模型联动推导） */
    dimension?: number;
    /** API Key 传输方式（header/body，连接测试消费） */
    remoteApiKeyTransmission?: 'header' | 'body';
    autoVectorizeWorldBook?: boolean;
    contextWindowTokens?: number;
    cacheEnabled?: boolean;
    cacheL1Size?: number;
    cacheL1TTL?: number;
    cacheL2TTL?: number;
    defaultTopK?: number;
    minSimilarityScore?: number;
    autoVectorizeKnowledge?: boolean;
  };

  // Stable Diffusion WebUI 设置（Spec: add-ai-expression-generation / Task 6）
  // 用于角色卡 AI 表情生成（img2img），由主进程 sdGenerationService 读取
  sdWebui?: SDWebuiConfig;

  /** 网络搜索配置（Spec: add-agent-web-search-tool） */
  webSearch?: WebSearchConfig;

  /**
   * 标签自动推荐配置（Spec: implement-local-tag-autocomplete / Task 4）。
   *
   * 持久化策略：作为 AppSetting 嵌套字段随整体 setting.save / setting.load IPC 自动持久化到
   * electron-store（settings.json），无需独立 store 或独立 IPC 通道。
   * 旧配置兼容：可选字段，旧 settings.json 缺失此字段时 TagAutocomplete 组件降级处理。
   */
  tagAutocomplete?: TagAutocompleteConfig;

  /**
   * RAG 标签库配置（Spec: rag-tag-library-for-ai-trait-generation / Task 3）。
   *
   * 持久化策略：与 tagAutocomplete 一致，随整体 setting.save / setting.load 自动持久化。
   * 旧配置兼容：可选字段，缺失时 TagRagService 使用代码内默认值。
   */
  tagRag?: TagRagConfig;

  /**
   * 禁词提示词注入配置（Spec: add-forbidden-words-prompt / Task 2）。
   *
   * 持久化策略：与 tagAutocomplete 一致，随整体 setting.save / setting.load 自动持久化。
   * 旧配置兼容：可选字段，缺失时 ForbiddenWordsPromptProvider 使用 DEFAULT_FORBIDDEN_WORDS_CONFIG。
   */
  forbiddenWords?: ForbiddenWordsConfig;

  /**
   * 对话自然度配置（Spec: enforce-forbidden-words-and-dialogue-naturalness / Task 2）。
   *
   * 持久化策略：与 forbiddenWords 一致，随整体 setting 持久化。
   * 可选字段：缺失时 deAiEnabled=true / samplingPresetEnabled=false。
   */
  dialogueNaturalness?: DialogueNaturalnessConfig;

  /**
   * settings.json schema 版本号（Spec: settings-feature-optimization-report / H-12）。
   * 由主进程读取链路（settingMigrations.ts）自动补写/升级，渲染层只读。
   * 旧 settings.json 无此键，视为 v1。
   */
  _settingsSchema?: number;

  /**
   * 设置版本快照历史（Spec: settings-feature-optimization-report / H-11, N1）。
   *
   * 每次保存前自动对「保存前状态」留档，滚动上限 20 条。content 已剥离 versions
   * 字段（避免嵌套递归）。回滚时以快照 content 覆盖当前设置。旧 settings.json
   * 无此键，视为空历史。
   */
  versions?: SettingVersion[];
}

/**
 * 设置版本快照（Spec: settings-feature-optimization-report / H-11, N1）。
 * 对标写作模式 2.0 ChapterVersion { id, content, timestamp, note?, isAutoGenerated }。
 */
export interface SettingVersion {
  /** 快照唯一 id（时间戳 + 随机后缀） */
  id: string;
  /** 快照时的完整设置内容（已剥离 versions 字段，防嵌套递归） */
  content: AppSetting;
  /** 快照时间戳（毫秒） */
  timestamp: number;
  /** 备注（自动保存为「自动保存」，回滚/手动为对应说明） */
  note?: string;
  /** 是否自动保存快照 */
  isAutoGenerated: boolean;
}

/**
 * 对话自然度配置 — 控制对话请求的去AI味词表注入与采样预设覆盖。
 */
export interface DialogueNaturalnessConfig {
  /** 对话去AI味词表注入开关（humanizerPolish 对话变体），默认 true */
  deAiEnabled?: boolean;
  /** 对话采样预设开关（按模型系列覆盖采样参数，对齐 llamacpp 兼容文档 5.1），默认 false */
  samplingPresetEnabled?: boolean;
}

export type AIEngine = AIEngineSetting;