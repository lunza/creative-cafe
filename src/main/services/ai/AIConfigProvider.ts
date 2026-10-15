import { getStorageService } from '../storageService';
import { createLogger } from '../logger';
import type { ModelConfig } from '../../../shared/types/writing.types';
import type { FallbackProvider } from '../agent/failoverPolicy';
// Spec: settings-feature-optimization-report / H-5（默认值单一来源）
import { DEFAULT_ENGINE_PARAMS } from '../../../shared/settingDefaults';
// Spec: settings-feature-optimization-report / M-18/N7（统一参数解析，三级合并）
import { resolveEngineParams } from '../../../shared/parameterResolver';

/**
 * AIConfigProvider 返回的 AI 调用配置视图。
 *
 * 字段语义：
 * - `baseUrl` / `apiKey` / `modelName`：未配置时为 `undefined`（不抛错，调用方决定如何处理）
 * - `apiKeyTransmission`：始终为非空字符串（默认 'body'，可由调用方通过
 *   `defaultTransmission` 覆盖）
 * - `systemPrompt`：始终为非空字符串（默认 ''）
 *
 * 设计原因：原 ContentGenerator/OutlineGenerator/WritingStyleLearningService
 * 的私有方法均返回 `string | undefined` 并由调用方判断；此处保留该语义以
 * 最小化行为变更。
 */
export interface AIConfig {
  baseUrl?: string;
  apiKey?: string;
  /** API key 传输方式：'header' | 'body' | 'query' 等 */
  apiKeyTransmission: string;
  /** 引擎级 system prompt，未配置时为空字符串 */
  systemPrompt: string;
  /** 引擎配置的模型名，未配置时为 undefined（调用方可使用 fallback） */
  modelName?: string;
}

export interface GetAIConfigOptions {
  /**
   * 当引擎未配置 `api_key_transmission` 时使用的默认值。
   *
   * 历史差异：
   * - ContentGenerator / OutlineGenerator / WritingStyleLearningService 默认 'body'
   * - AIAssistedChapterService 默认 'header'
   *
   * 此参数让调用方保留各自的默认值，避免行为变更。
   */
  defaultTransmission?: string;
}

/**
 * AIService 聊天/探测链路使用的完整 AI 配置视图（含采样参数）。
 *
 * 【M-14/S-11】原 AIService.ts 内嵌 AIConfigProvider 的 `AIConfig` 接口，
 * 因与本文件 `AIConfig`（writing 链路非抛错视图）同名且字段集不同而改名。
 * AIService.ts 继续 `export type { AIConfig }`（别名转发）保持旧 import 兼容。
 */
export interface AIServiceConfig {
  baseUrl: string;
  apiKey: string;
  apiKeyTransmission: 'header' | 'body';
  model: string;
  systemPrompt?: string;
  /** 引擎配置的采样温度 */
  temperature?: number;
  /** 引擎配置的最大输出 token 数 */
  maxTokens?: number;
  /** 引擎配置的 top_p（核采样） */
  topP?: number;
  /** 引擎配置的 frequency_penalty */
  frequencyPenalty?: number;
  /** 引擎配置的 presence_penalty */
  presencePenalty?: number;
  /** 引擎配置的 enable_chain_of_thought */
  enableChainOfThought?: boolean;
}

/** 引擎运行时配置（温度、最大 token 等） */
export interface EngineConfig {
  temperature: number;
  maxTokens?: number;
}

/**
 * AIConfigProvider
 *
 * 从全局设置（settings.json）中读取当前激活的 AI 引擎配置，作为所有
 * writing 服务（ContentGenerator / OutlineGenerator / DescriptionPolisher /
 * WritingStyleLearningService / AIAssistedChapterService / TableOrganizeService）
 * 的统一配置入口。
 *
 * 设计原则：
 * - 不缓存任何状态，每次调用实时读取 settings
 * - 既有"抛错型"方法（getApiKey / getBaseUrl / getModelName）保留给
 *   TableOrganizeService 使用（其原行为依赖抛错）
 * - 新增 `getAIConfig()` 返回可选字段视图，供上述 5 个 writing 服务
 *   替换各自的重复 `getXxx()` 私有方法
 * - `apiKeyTransmission` 的默认值由调用方通过 `defaultTransmission` 传入，
 *   以保留各服务原始行为差异
 * - `__USER_DATA__` 占位符：AI 引擎字段（api_url / api_key / system_prompt /
 *   model_name）通常不含路径，故不做替换；如未来扩展到含路径字段，可在此处
 *   统一处理
 *
 * 【M-14/S-11 单实例合并】原 AIService.ts 内嵌的同名 AIConfigProvider 已并入
 * 本类（全局唯一实例 `aiConfigProvider`，AIService 构造器直接持有本实例）：
 * - `getConfig()` / `getEngineConfig()`：AIService 聊天/探测链路的抛错型完整
 *   配置（含采样参数，maxTokens 走 resolveEngineParams 三级合并）
 * - `getModelName(fallbackModel)`：带 fallback 的非抛错模型名解析
 *   （worldbookPlanningService 消费），与无参抛错版 `getModelName()` 并存——
 *   两者调用方零重叠，无行为变更
 * - 内嵌版的 async 包装方法（getBaseUrl/getApiKey/getApiKeyTransmission/
 *   getEngineSystemPrompt）已删除：全仓无消费方，AIService 的对应 accessor
 *   改走 `getAIConfig()` 等价实现
 */
export class AIConfigProvider {
  private logger = createLogger('ai-config-provider');

  /**
   * 获取当前激活的 AI 引擎对象（只读视图）。
   * 与原 getActiveEngine 行为一致：找不到时返回 null（不抛错）。
   */
  getActiveEngine(): any {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    const engines = settings?.aiEngines || [];
    if (engines.length > 0) {
      return engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
    }
    return null;
  }

  /**
   * 一次性获取 AI 调用所需的全部 5 个字段（baseUrl / apiKey /
   * apiKeyTransmission / systemPrompt / modelName）。
   *
   * 行为对齐（Task 13 抽取前各 writing 服务的私有 `getXxx()` 方法）：
   * - 优先使用激活引擎的字段
   * - 引擎缺失时回退到 legacy `settings.ai.*` 字段（保留原 fallback 链）
   * - 不抛错：缺失字段返回 `undefined`，由调用方判断
   * - `apiKeyTransmission` 默认值由调用方通过 `defaultTransmission` 指定，
   *   默认 'body'（与多数 writing 服务对齐）
   */
  getAIConfig(options?: GetAIConfigOptions): AIConfig {
    const defaultTransmission = options?.defaultTransmission ?? 'body';
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    const engine = this.getActiveEngine();

    if (!engine) {
      // 无引擎配置：回退到 legacy settings.ai.* 字段（与原 ContentGenerator
      // 等私有方法行为一致）
      return {
        baseUrl: settings?.ai?.baseUrl || settings?.ai?.apiBaseUrl || settings?.baseUrl,
        apiKey: settings?.ai?.apiKey || settings?.ai?.apiToken || settings?.apiKey,
        apiKeyTransmission: defaultTransmission,
        systemPrompt: '',
        modelName: undefined
      };
    }

    return {
      baseUrl: engine.api_url || settings?.ai?.baseUrl || settings?.ai?.apiBaseUrl || settings?.baseUrl,
      apiKey: engine.api_key || settings?.ai?.apiKey || settings?.ai?.apiToken || settings?.apiKey,
      apiKeyTransmission: engine.api_key_transmission || defaultTransmission,
      systemPrompt: engine.system_prompt || '',
      modelName: engine.model_name
    };
  }

  /**
   * 获取完整的 AI 配置（含采样参数），供 AIService 聊天/探测链路使用。
   *
   * 【M-14/S-11】自 AIService.ts 内嵌 AIConfigProvider 并入（行为逐字保留）。
   * 引擎 model_name 缺失时抛错。
   */
  async getConfig(): Promise<AIServiceConfig> {
    const engine = this.getActiveEngine();

    if (!engine?.model_name) {
      throw new Error('未配置 AI 模型名称，请在设置中配置 AI 引擎');
    }

    const settings = getStorageService().getSettings();

    return {
      // CR-1 ③：api_url 异质回退对齐默认值单一来源（原回退空串导致下游拿到无意义 URL）
      baseUrl: engine?.api_url || settings?.ai?.baseUrl || DEFAULT_ENGINE_PARAMS.apiBaseUrl,
      apiKey: engine?.api_key || settings?.ai?.apiKey || '',
      apiKeyTransmission: engine?.api_key_transmission || 'header',
      model: engine.model_name,
      systemPrompt: engine?.system_prompt || '',
      temperature: engine?.temperature,
      // 【重点标记 - FL-2 分链路失效修复 + M-18/N7 统一参数解析】此前硬编码 undefined
      // 使探测请求永不带 max_tokens（「测试连接」与真实对话不一致）。现走
      // resolveEngineParams 三级合并：消费引擎 max_tokens，缺省回退
      // DEFAULT_ENGINE_PARAMS.maxTokens。
      maxTokens: resolveEngineParams(engine).max_tokens,
      topP: engine?.top_p,
      frequencyPenalty: engine?.frequency_penalty,
      presencePenalty: engine?.presence_penalty,
      enableChainOfThought: engine?.enable_chain_of_thought
    };
  }

  /**
   * 获取引擎运行时配置（温度、最大 token 等）。
   *
   * 【M-14/S-11】自 AIService.ts 内嵌 AIConfigProvider 并入（行为逐字保留）。
   */
  async getEngineConfig(): Promise<EngineConfig> {
    const engine = this.getActiveEngine();

    if (engine?.temperature === undefined || engine?.temperature === null) {
      throw new Error('未配置 AI 温度参数，请在设置中配置 AI 引擎');
    }

    return {
      temperature: engine.temperature,
      // 【重点标记 - FL-2 分链路失效修复 + M-18/N7】resolveEngineParams 三级合并，
      // 缺省回退 DEFAULT_ENGINE_PARAMS.maxTokens。
      maxTokens: resolveEngineParams(engine).max_tokens
    };
  }

  /**
   * 带 fallback 的模型名解析（非抛错），供 worldbookPlanningService 等
   * 允许缺省模型的调用方使用。
   *
   * 【M-14/S-11】自 AIService.ts 内嵌 AIConfigProvider.getModelName(fallback)
   * 并入。与无参抛错版 getModelName() 并存：调用方零重叠，无行为变更。
   */
  async getModelNameWithFallback(fallbackModel: string): Promise<string> {
    const config = await this.getConfig();
    return config.model || fallbackModel;
  }

  /**
   * 获取 API Key，未配置时抛错（与原 getApiKey 行为一致）。
   */
  getApiKey(): string {
    const engine = this.getActiveEngine();
    const apiKey = engine?.api_key;
    if (!apiKey) {
      throw new Error('未配置 API Key，请在设置 → AI引擎设置中配置');
    }
    return apiKey;
  }

  /**
   * 获取 API Key 传输方式（header / payload），默认 header。
   */
  getApiKeyTransmission(): string {
    const engine = this.getActiveEngine();
    return engine?.api_key_transmission || 'header';
  }

  /**
   * 获取已剔除后缀的 Base URL，未配置时抛错。
   * 与原 getBaseUrl 行为一致：去除 /v1/chat/completions 与 /v1/completions 后缀。
   */
  getBaseUrl(): string {
    const engine = this.getActiveEngine();
    if (!engine?.api_url) {
      throw new Error('未配置 AI 服务地址，请在设置 → AI引擎设置中配置');
    }
    return engine.api_url.replace(/\/v1\/chat\/completions$/, '').replace(/\/v1\/completions$/, '');
  }

  /**
   * 获取模型名称，未配置时抛错。
   */
  getModelName(): string {
    const engine = this.getActiveEngine();
    if (!engine?.model_name) {
      throw new Error('未配置模型名称，请在设置 → AI引擎设置中配置');
    }
    return engine.model_name;
  }

  /**
   * 获取激活引擎的 system prompt（如有）。
   * 原 WritingStorageService 内未使用 system prompt，此方法预留以便 Task 13 扩展。
   */
  getEngineSystemPrompt(): string | undefined {
    const engine = this.getActiveEngine();
    return engine?.system_prompt;
  }

  /**
   * 获取备用 Provider 列表（Task 10.4：故障转移配置）。
   *
   * 从 settings.fallbackProviders 读取，未配置时返回空数组。
   * 当主 provider 发生非瞬态错误时，从此列表中选择下一个 provider 切换。
   */
  getFallbackProviders(): FallbackProvider[] {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    return settings?.fallbackProviders ?? [];
  }

  /**
   * 设置备用 Provider 列表（Task 10.4：故障转移配置）。
   *
   * 持久化到 storageService 的 settings.fallbackProviders 字段。
   */
  setFallbackProviders(providers: FallbackProvider[]): void {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    settings.fallbackProviders = providers;
    storageService.setSettings(settings);
  }

  /**
   * 构建表格整理 AI 调用所需的端点信息。
   * - apiMode 根据引擎 api_mode 解析（默认 'chat_completion'），
   *   目前仅使用 chat_completion，text_completion 分支保留备用
   * - apiUrl 若未包含 /v1/chat/completions 或 /v1/completions 后缀，
   *   则按 apiMode 自动追加对应后缀；已包含则直接使用（避免重复拼接）
   * - apiUrl 默认 DEFAULT_ENGINE_PARAMS.apiBaseUrl（默认值单一来源）
   *
   * 注意：apiKey/modelName 采用与 getAIConfig 一致的非抛错语义——
   * 缺失时返回空字符串，由调用方按需在缺少 apiUrl/modelName 时报错。
   * 这样无 API Key 的本地 LLM 引擎（local-llm）也能走表格整理，
   * 与内容生成 / 剧情检查 / 单条修正链路（均经 getAIConfig，不强制 apiKey）对齐。
   * 【Bug 修复】此前 buildApiEndpoint 调用 getApiKey()/getModelName()，
   * 在本地引擎无 api_key 时直接抛错，导致表格整理在本地引擎下不可用。
   */
  buildApiEndpoint(_modelConfig: ModelConfig): {
    apiUrl: string;
    apiMode: string;
    apiKey: string;
    apiKeyTransmission: string;
    modelName: string;
  } {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    const engines = settings?.aiEngines || [];
    const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];

    // 非抛错读取：无 API Key（如本地 LLM 引擎）时返回空字符串
    const apiKey = activeEngine?.api_key || settings?.ai?.apiKey || settings?.ai?.apiToken || settings?.apiKey || '';
    const apiKeyTransmission = this.getApiKeyTransmission();
    const modelName = activeEngine?.model_name || '';

    let apiUrl = activeEngine?.api_url || DEFAULT_ENGINE_PARAMS.apiBaseUrl;
    const apiMode = activeEngine?.api_mode || 'chat_completion';
    // 目前仅使用 chat_completion；text_completion 分支保留备用
    const suffix = apiMode === 'text_completion' ? '/v1/completions' : '/v1/chat/completions';

    if (apiUrl.endsWith('/v1/chat/completions') || apiUrl.endsWith('/v1/completions')) {
      // api_url 已包含 API 路径后缀，直接使用，避免重复拼接
      this.logger.info(`[buildApiEndpoint] api_url 已包含 API 路径后缀，直接使用: ${apiUrl}`);
    } else {
      apiUrl += suffix;
      this.logger.info(`[buildApiEndpoint] api_url 未包含 API 路径后缀，按 apiMode=${apiMode} 追加 "${suffix}": ${apiUrl}`);
    }

    return { apiUrl, apiMode, apiKey, apiKeyTransmission, modelName };
  }
}

/**
 * 单例。保持与原 WritingStorageService 单例调用方式一致。
 */
export const aiConfigProvider = new AIConfigProvider();
