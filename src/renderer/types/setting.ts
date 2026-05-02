/**
 * AI 引擎设置组
 */
export interface AIEngineSetting {
  id: string;
  name: string;
  // API 连接配置
  api_url: string;
  api_key: string;
  model_name: string;
  api_mode: string;
  
  // 文本补全模式配置
  prompt_template: string;
  stop_words: string;
  max_generation_length: number;
  custom_optimization_prompt: string;
  
  // 聊天补全模式配置
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  streaming: boolean;
  enable_chain_of_thought: boolean;
  
  // 聊天补全模式特有参数
  freq_pen: number;
  presence_pen: number;
  top_p: number;
  top_k: number;
  top_a: number;
  min_p: number;
  rep_pen: number;
  openai_max_context: number;
  names_behavior: number;
  send_if_empty: string;
  impersonation_prompt: string;
  new_chat_prompt: string;
  new_group_chat_prompt: string;
  new_example_chat_prompt: string;
  continue_nudge_prompt: string;
  bias_preset_selected: string;
  max_context_unlocked: boolean;
  wi_format: string;
  scenario_format: string;
  personality_format: string;
  group_nudge_prompt: string;
  assistant_prefill: string;
  assistant_impersonation: string;
  use_sysprompt: boolean;
  squash_system_messages: boolean;
  media_inlining: boolean;
  continue_prefill: boolean;
  continue_postfix: string;
  seed: number;
  n: number;
  
  // NovelAI 模式配置
  novelai_api_key: string;
  novelai_model: string;
  novelai_sampler: string;
  novelai_cfg_scale: number;
  
  // AI Horde 模式配置
  ai_horde_api_key: string;
  ai_horde_model: string;
  ai_horde_max_wait: number;
  ai_horde_priority: number;
  
  // 模型参数 - SillyTavern 官方预设
  temp: number;
  temperature_last: boolean;
  top_p: number;
  top_k: number;
  top_a: number;
  tfs: number;
  epsilon_cutoff: number;
  eta_cutoff: number;
  typical_p: number;
  min_p: number;
  rep_pen: number;
  rep_pen_range: number;
  rep_pen_decay: number;
  rep_pen_slope: number;
  no_repeat_ngram_size: number;
  penalty_alpha: number;
  num_beams: number;
  length_penalty: number;
  min_length: number;
  encoder_rep_pen: number;
  freq_pen: number;
  presence_pen: number;
  skew: number;
  do_sample: boolean;
  early_stopping: boolean;
  dynatemp: boolean;
  min_temp: number;
  max_temp: number;
  dynatemp_exponent: number;
  smoothing_factor: number;
  smoothing_curve: number;
  dry_allowed_length: number;
  dry_multiplier: number;
  dry_base: number;
  dry_sequence_breakers: string;
  dry_penalty_last_n: number;
  add_bos_token: boolean;
  ban_eos_token: boolean;
  skip_special_tokens: boolean;
  mirostat_mode: number;
  mirostat_tau: number;
  mirostat_eta: number;
  guidance_scale: number;
  negative_prompt: string;
  grammar_string: string;
  json_schema: any;
  json_schema_allow_empty: boolean;
  banned_tokens: string;
  sampler_priority: string[];
  samplers: string[];
  samplers_priorities: string[];
  ignore_eos_token: boolean;
  spaces_between_special_tokens: boolean;
  speculative_ngram: boolean;
  sampler_order: number[];
  logit_bias: any[];
  xtc_threshold: number;
  xtc_probability: number;
  nsigma: number;
  min_keep: number;
  extensions: any;
  adaptive_target: number;
  adaptive_decay: number;
  rep_pen_size: number;
  genamt: number;
  max_length: number;
  
  // 高级参数
  frequency_penalty: number;
  presence_penalty: number;
  enable_chain_of_thought: boolean;
  use_function_calling: boolean;
  
  // 连接设置
  auto_connect: boolean;
  skip_status_check: boolean;
  use_proxy: boolean;
  proxy_url: string;
  proxy_port: number;
  
  // 安全设置
  encrypt_api_key: boolean;
  enable_access_control: boolean;
  
  // API 密钥传输方式
  api_key_transmission: 'header' | 'body';
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
  
  // 路径设置
  characterPath: string;
  worldBookPath: string;
  avatarPath: string;
  creativePath: string;
  memoryPath: string;
  pluginPath: string;
  
  // 外观设置
  dashboardBackgroundImage: string;
  
  // UI 设置
  animationEnabled: boolean;
  compactMode: boolean;
  
  // 日志设置
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  
  // 调试模式设置
  debugMode: boolean;

  // 向量化设置
  vector?: {
    embeddingMode?: 'remote' | 'local';
    remoteModel?: string;
    remoteApiKey?: string;
    remoteApiUrl?: string;
    localModel?: string;
    vectorStoreMode?: 'vecstore' | 'json';
    autoVectorizeWorldBook?: boolean;
    autoRetrieveContext?: boolean;
    contextTopK?: number;
    contextMinScore?: number;
    contextWindowTokens?: number;
    cacheEnabled?: boolean;
    cacheL1Size?: number;
    cacheL1TTL?: number;
    cacheL2TTL?: number;
    defaultTopK?: number;
    minSimilarityScore?: number;
    autoVectorizeKnowledge?: boolean;
  };
}