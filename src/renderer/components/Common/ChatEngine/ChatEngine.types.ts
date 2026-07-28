// 聊天引擎类型定义

import { ChatMessage } from '../Character/CharacterDialogueChat/CharacterDialogueChat.types';

/**
 * AI 后端能力探测字段。
 *
 * Spec: optimize-chat-ai-intelligence / Task 3.3 / Task 6.2
 * 按 engine type / api_mode 预设，用于决定请求体字段格式：
 *   - supportsStopArray: 是否接受 `stop` 字段为数组（false 时取首元素作字符串）
 *   - supportsRepPen: 是否支持 repetition_penalty（Task 6 完整实现）
 *   - supportsDrySampler: 是否支持 DRY 采样参数（Task 6 完整实现）
 */
export interface EngineCapabilities {
  supportsStopArray?: boolean;
  supportsRepPen?: boolean;
  supportsDrySampler?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
  supportsToolCalling?: boolean;
}

// AI引擎配置接口
export interface AIEngineConfig {
  id: string;
  name: string;
  api_url: string;
  api_key?: string;
  model_name: string;
  api_key_transmission?: 'header' | 'body';
  api_mode?: 'chat_completion' | 'text_completion';
  max_tokens?: number;
  temperature?: number;
  system_prompt?: string;
  // 自定义AI参数（用于覆盖默认配置）
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  /**
   * Stop sequences 防抢话停止序列数组。
   *
   * Spec: optimize-chat-ai-intelligence / Task 3.2
   * 由调用方（hooks.ts）通过 PromptBuilder.buildStopSequences 构建后注入。
   * ChatEngine 在请求体中将其写入 `stop` 字段：
   *   - supportsStopArray=true（默认）→ 传数组
   *   - supportsStopArray=false → 取首元素作字符串并记录日志
   * 为可选字段，未提供时不注入 stop（保持向后兼容）。
   */
  stopSequences?: string[];
  /**
   * 后端能力探测结果，决定 stop 字段格式等行为。缺省时按"大多数后端兼容"取默认值。
   */
  capabilities?: EngineCapabilities;
  /**
   * 用户是否启用思维链/推理（来自 AIEngineSetting.enable_chain_of_thought）。
   *
   * Spec: upgrade-ai-handler-multimodal-compatibility / Task 3.2
   * 能力感知逻辑：此开关仅在模型 `supportsThinking === true` 时才生效。
   *   - enable_chain_of_thought=true  且 supportsThinking=true  → 注入思维链参数（enable_thinking: true）
   *   - enable_chain_of_thought=true  但 supportsThinking!=true → 不注入（模型不支持，降级为纯文本聊天）
   *   - enable_chain_of_thought!=true                              → 不注入（用户未启用）
   * 触发条件：双条件判断（用户配置 + 模型能力），缺一不可。
   * 兼容性考量：不支持的模型注入思维链参数可能导致 4xx 错误或被忽略，故必须由 capabilities 守卫。
   */
  enable_chain_of_thought?: boolean;
  /**
   * 用户是否启用函数/工具调用（来自 AIEngineSetting.use_function_calling）。
   *
   * Spec: upgrade-ai-handler-multimodal-compatibility / Task 3.4
   * 一致性要求：此开关仅在模型 `supportsToolCalling === true` 时才生效。
   *   - use_function_calling=true  且 supportsToolCalling=true  → 工具调用生效
   *   - use_function_calling=true  但 supportsToolCalling!=true → 禁用工具调用（模型不支持，降级为纯文本聊天）
   *   - use_function_calling!=true                              → 不启用工具调用
   * 当前 ChatEngine 走纯文本聊天流程（不构造 tools 数组），此处仅做能力一致性守卫与注释，
   * 为后续接入 tools 字段预留正确的双条件判断点。
   */
  use_function_calling?: boolean;
  /**
   * Repetition penalty（仅 supportsRepPen=true 后端生效）。
   *
   * Spec: optimize-chat-ai-intelligence / Task 6.1 / Task 6.5
   * 借鉴 SillyTavern textgen/Default.json (rep_pen=1.1~1.2)；默认 1.1。
   * ChatEngine.buildRequestBody 在 supportsRepPen=true 时将其注入请求体。
   */
  repetition_penalty?: number;
  /**
   * DRY 采样参数组（仅 supportsDrySampler=true 后端生效）。
   *
   * Spec: optimize-chat-ai-intelligence / Task 6.4 / Task 6.5
   * 借鉴 SillyTavern textgen-settings.js:143 作为防重复采样层第二道防线。
   * 默认值：dry_multiplier=0.8, dry_base=1.75, dry_allowed_length=2,
   * no_repeat_ngram_size=0（关闭，避免影响中文流畅性）。
   */
  dry_multiplier?: number;
  dry_base?: number;
  dry_allowed_length?: number;
  no_repeat_ngram_size?: number;
}

// 流式回调函数类型
export type StreamCallback = (chunk: string, isDone: boolean) => void;

// 完成回调函数类型
export type CompleteCallback = (response: AIResponse) => void;

// 错误回调函数类型
export type ErrorCallback = (error: AIError) => void;

// AI响应接口
export interface AIResponse {
  content: string;
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  id: string;
}

// AI错误接口
export interface AIError {
  message: string;
  type: 'network' | 'server' | 'api' | 'validation' | 'unknown';
  code?: string;
  details?: any;
}

// 聊天引擎接口（策略模式）
export interface IChatEngine {
  sendMessage(
    messages: ChatMessage[],
    systemPrompt: string,
    config: AIEngineConfig
  ): Promise<void>;

  cancelRequest(): void;

  onStream(callback: StreamCallback): void;
  onComplete(callback: CompleteCallback): void;
  onError(callback: ErrorCallback): void;
}

/**
 * 按引擎 api_mode 推断默认后端能力。
 *
 * Spec: optimize-chat-ai-intelligence / Task 3.3 / Task 6.2
 * 按 engine type / api_mode 预设默认 capabilities：
 *   - chat_completion（OpenAI-compatible / Anthropic 等）：
 *       supportsStopArray=true, supportsRepPen=false, supportsDrySampler=false
 *   - text_completion（textgen-webui / koboldcpp / aphrodite 等）：
 *       supportsStopArray=true, supportsRepPen=true, supportsDrySampler=true
 *   - 未知 / 缺省：默认 supportsStopArray=true，其余 false
 *     （spec 明确"若不确定默认传数组"，rep_pen / DRY 保守关闭避免向后端发送不支持字段）
 *
 * 注意：此为基于 api_mode 的启发式推断；用户可在设置 UI 中通过引擎
 * `capabilities` 字段显式覆盖（Task 6.2 在 shared/settings.ts 默认引擎已注入）。
 */
export function getDefaultEngineCapabilities(apiMode?: string): EngineCapabilities {
  // 当前所有已知 api_mode（chat_completion / text_completion）均支持 stop 数组；
  // 未知 api_mode 也默认 true（spec 明确"若不确定默认传数组"）。
  const supportsStopArray = true;
  // text_completion 模式后端（textgen-webui / koboldcpp / aphrodite）通常支持
  // repetition_penalty 与 DRY 采样；chat_completion 模式（OpenAI / Anthropic）不支持。
  const isTextCompletion = apiMode === 'text_completion';
  const supportsRepPen = isTextCompletion;
  const supportsDrySampler = isTextCompletion;
  return { supportsStopArray, supportsRepPen, supportsDrySampler, supportsVision: false, supportsThinking: false, supportsToolCalling: false };
}

/**
 * DRY 采样参数键名与默认值（Spec: optimize-chat-ai-intelligence / Task 6.4）。
 *
 * 借鉴 SillyTavern textgen-settings.js:143：
 *   - dry_multiplier: 0.8（控制惩罚强度，0=禁用）
 *   - dry_base: 1.75（惩罚基数）
 *   - dry_allowed_length: 2（允许重复的最短 token 长度）
 *   - no_repeat_ngram_size: 0（默认关闭，避免影响中文流畅性）
 */
export const DRY_SAMPLER_DEFAULTS = {
  dry_multiplier: 0.8,
  dry_base: 1.75,
  dry_allowed_length: 2,
  no_repeat_ngram_size: 0,
} as const;

/**
 * Repetition penalty 默认值（Spec: optimize-chat-ai-intelligence / Task 6.1）。
 *
 * 借鉴 SillyTavern textgen/Default.json (rep_pen=1.1~1.2)。
 */
export const REP_PEN_DEFAULT = 1.1;

/**
 * 根据 config 与 capabilities 构建需注入请求体的额外采样参数。
 *
 * Spec: optimize-chat-ai-intelligence / Task 6.5
 * - supportsRepPen=true → 注入 `repetition_penalty`（config 缺省时使用 REP_PEN_DEFAULT）
 * - supportsDrySampler=true → 注入 `dry_multiplier/dry_base/dry_allowed_length/no_repeat_ngram_size`
 *   （config 缺省时使用 DRY_SAMPLER_DEFAULTS）
 * - 为 false 时省略对应字段，避免向后端发送不支持参数导致 4xx 错误
 *
 * 抽取为纯函数便于单元测试（ChatEngine.sendMessage 依赖 electronAPI，难以直接测试）。
 *
 * @param config AIEngineConfig，包含用户自定义的采样参数
 * @param capabilities 后端能力探测结果（缺省时按 getDefaultEngineCapabilities 推断）
 * @returns 需合并到 requestBody 的采样参数对象（可能为空对象）
 */
export function buildSamplingExtras(
  config: Pick<AIEngineConfig,
    | 'repetition_penalty'
    | 'dry_multiplier'
    | 'dry_base'
    | 'dry_allowed_length'
    | 'no_repeat_ngram_size'
    | 'capabilities'
    | 'api_mode'>,
  capabilities?: EngineCapabilities
): Record<string, number> {
  const caps = capabilities || config.capabilities || getDefaultEngineCapabilities(config.api_mode);
  const extras: Record<string, number> = {};

  if (caps.supportsRepPen === true) {
    const repPen = typeof config.repetition_penalty === 'number' && !isNaN(config.repetition_penalty)
      ? config.repetition_penalty
      : REP_PEN_DEFAULT;
    extras.repetition_penalty = repPen;
  }

  if (caps.supportsDrySampler === true) {
    extras.dry_multiplier = typeof config.dry_multiplier === 'number' && !isNaN(config.dry_multiplier)
      ? config.dry_multiplier
      : DRY_SAMPLER_DEFAULTS.dry_multiplier;
    extras.dry_base = typeof config.dry_base === 'number' && !isNaN(config.dry_base)
      ? config.dry_base
      : DRY_SAMPLER_DEFAULTS.dry_base;
    extras.dry_allowed_length = typeof config.dry_allowed_length === 'number' && !isNaN(config.dry_allowed_length)
      ? config.dry_allowed_length
      : DRY_SAMPLER_DEFAULTS.dry_allowed_length;
    extras.no_repeat_ngram_size = typeof config.no_repeat_ngram_size === 'number' && !isNaN(config.no_repeat_ngram_size)
      ? config.no_repeat_ngram_size
      : DRY_SAMPLER_DEFAULTS.no_repeat_ngram_size;
  }

  return extras;
}

/**
 * 根据 stopSequences 与后端能力解析最终写入请求体 `stop` 字段的值。
 *
 * Spec: optimize-chat-ai-intelligence / Task 3.3 / Scenario "后端兼容"
 * - stopSequences 为空 / 缺省 → 返回 undefined（不注入 stop 字段，保持向后兼容）
 * - supportsStopArray=true（默认）→ 返回数组
 * - supportsStopArray=false → 返回首元素字符串（其余丢弃；调用方负责记录日志）
 *
 * 抽取为纯函数便于单元测试（ChatEngine.sendMessage 依赖 electronAPI，难以直接测试）。
 *
 * @param stopSequences 由 buildStopSequences 构建的停止序列数组
 * @param capabilities 后端能力探测结果
 * @returns 写入 requestBody.stop 的值（数组 / 字符串 / undefined）
 */
export function resolveStopForRequestBody(
  stopSequences?: string[],
  capabilities?: EngineCapabilities
): string[] | string | undefined {
  if (!Array.isArray(stopSequences) || stopSequences.length === 0) {
    return undefined;
  }
  const supportsStopArray = capabilities?.supportsStopArray !== false; // 默认 true
  if (supportsStopArray) {
    return stopSequences;
  }
  // 后端仅支持字符串：取首元素
  return stopSequences[0];
}

// 引擎工厂配置接口
export interface EngineFactoryConfig {
  engineType: 'default' | 'vercel' | 'custom';
  config: AIEngineConfig;
}
