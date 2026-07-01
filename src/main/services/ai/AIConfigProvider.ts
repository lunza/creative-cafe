import { getStorageService } from '../storageService';
import type { ModelConfig } from '../../../shared/types/writing.types';

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
 */
export class AIConfigProvider {
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
   * 构建表格整理 AI 调用所需的端点信息。
   * 与原 buildApiEndpoint 行为完全一致：
   * - apiUrl 根据 api_mode 自动追加 /v1/completions 或 /v1/chat/completions
   * - apiMode 默认 'chat_completion'
   * - apiUrl 默认 'http://127.0.0.1:5000'
   *
   * 注意：getApiKey/getModelName 在缺失配置时会抛错，
   * 与原行为一致——调用方需在 try/catch 中处理。
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

    const apiKey = this.getApiKey();
    const apiKeyTransmission = this.getApiKeyTransmission();
    const modelName = this.getModelName();

    let apiUrl = activeEngine?.api_url || 'http://127.0.0.1:5000';
    const apiMode = activeEngine?.api_mode || 'chat_completion';

    if (apiMode === 'text_completion') {
      if (!apiUrl.endsWith('/v1/completions')) {
        apiUrl += '/v1/completions';
      }
    } else {
      if (!apiUrl.endsWith('/v1/chat/completions')) {
        apiUrl += '/v1/chat/completions';
      }
    }

    return { apiUrl, apiMode, apiKey, apiKeyTransmission, modelName };
  }
}

/**
 * 单例。保持与原 WritingStorageService 单例调用方式一致。
 */
export const aiConfigProvider = new AIConfigProvider();
