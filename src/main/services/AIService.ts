/**
 * AI Service - 统一的 AI 服务调用抽象层
 *
 * 封装所有 AI 调用的通用逻辑：
 * - 配置获取和管理
 * - 请求构建和执行
 * - 流式响应解析（通过 SSEStreamParser）
 * - 错误处理和重试
 *
 * 注意：SSEStreamParser 已提取为独立工具，位于 `./ai/SSEStreamParser.ts`。
 * 本文件 re-export 之，保持向后兼容的导入路径。
 */

import { getStorageService } from './storageService';
import { SSEStreamParser, type StreamChunkCallback } from './ai/SSEStreamParser';

// ==================== Types ====================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  apiKeyTransmission: 'header' | 'body';
  model: string;
  systemPrompt?: string;
}

export interface EngineConfig {
  temperature: number;
  maxTokens: number;
}

export interface CallOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  abortSignal?: AbortSignal;
}

export interface ChatResponse {
  content: string;
  model: string;
  finishReason?: string;
}

export interface StreamResponse {
  content: string;
  generationTime: number;
  model: string;
}

// Re-export 以保持向后兼容（其他模块从 AIService 导入 StreamChunkCallback 仍可工作）
export type { StreamChunkCallback } from './ai/SSEStreamParser';

// ==================== AIConfigProvider ====================

/**
 * 统一的 AI 配置提供者
 * 从设置服务中读取 AI 引擎配置，消除多处重复的配置读取逻辑
 */
export class AIConfigProvider {
  private static instance: AIConfigProvider;

  static getInstance(): AIConfigProvider {
    if (!AIConfigProvider.instance) {
      AIConfigProvider.instance = new AIConfigProvider();
    }
    return AIConfigProvider.instance;
  }

  /**
   * 获取当前活跃的 AI 引擎原始配置
   */
  getActiveEngine(): any {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    const engines = settings?.aiEngines || [];
    return engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
  }

  /**
   * 获取完整的 AI 配置
   */
  async getConfig(): Promise<AIConfig> {
    const engine = this.getActiveEngine();

    if (!engine?.model_name) {
      throw new Error('未配置 AI 模型名称，请在设置中配置 AI 引擎');
    }

    const settings = getStorageService().getSettings();

    return {
      baseUrl: engine?.api_url || settings?.ai?.baseUrl || '',
      apiKey: engine?.api_key || settings?.ai?.apiKey || '',
      apiKeyTransmission: engine?.api_key_transmission || 'header',
      model: engine.model_name,
      systemPrompt: engine?.system_prompt || ''
    };
  }

  /**
   * 获取引擎运行时配置（温度、最大 token 等）
   */
  async getEngineConfig(): Promise<EngineConfig> {
    const engine = this.getActiveEngine();

    if (engine?.temperature === undefined || engine?.temperature === null) {
      throw new Error('未配置 AI 温度参数，请在设置中配置 AI 引擎');
    }

    if (engine?.max_tokens === undefined || engine?.max_tokens === null) {
      throw new Error('未配置 AI 最大令牌数，请在设置中配置 AI 引擎');
    }

    return {
      temperature: engine.temperature,
      maxTokens: engine.max_tokens
    };
  }

  /**
   * 仅获取 baseUrl（向后兼容）
   */
  async getBaseUrl(): Promise<string | undefined> {
    const config = await this.getConfig();
    return config.baseUrl || undefined;
  }

  /**
   * 仅获取 apiKey（向后兼容）
   */
  async getApiKey(): Promise<string | undefined> {
    const config = await this.getConfig();
    return config.apiKey || undefined;
  }

  /**
   * 仅获取 apiKey 传输方式（向后兼容）
   */
  async getApiKeyTransmission(): Promise<string> {
    const config = await this.getConfig();
    return config.apiKeyTransmission;
  }

  /**
   * 仅获取模型名称（向后兼容）
   */
  async getModelName(fallbackModel: string): Promise<string> {
    const config = await this.getConfig();
    return config.model || fallbackModel;
  }

  /**
   * 仅获取引擎系统提示词（向后兼容）
   */
  async getEngineSystemPrompt(): Promise<string> {
    const config = await this.getConfig();
    return config.systemPrompt || '';
  }
}

// ==================== AIService ====================

/**
 * 统一的 AI 服务调用类
 * 封装所有 AI 调用的通用逻辑，供 PlotCheckerService、ContentGenerator、OutlineGenerator 复用
 *
 * SSE 流式响应解析由独立的 `SSEStreamParser`（位于 `./ai/SSEStreamParser.ts`）负责。
 * 此处 re-export 以保持向后兼容（其他模块从 AIService 导入 SSEStreamParser 仍可工作）。
 */
export { SSEStreamParser } from './ai/SSEStreamParser';

export class AIService {
  private configProvider: AIConfigProvider;
  private streamParser: SSEStreamParser;

  constructor() {
    this.configProvider = AIConfigProvider.getInstance();
    this.streamParser = new SSEStreamParser();
  }

  // ==================== Config Accessors ====================

  async getConfig(): Promise<AIConfig> {
    return this.configProvider.getConfig();
  }

  async getEngineConfig(): Promise<EngineConfig> {
    return this.configProvider.getEngineConfig();
  }

  async getBaseUrl(): Promise<string | undefined> {
    return this.configProvider.getBaseUrl();
  }

  async getApiKey(): Promise<string | undefined> {
    return this.configProvider.getApiKey();
  }

  async getApiKeyTransmission(): Promise<string> {
    return this.configProvider.getApiKeyTransmission();
  }

  async getModelName(fallbackModel: string): Promise<string> {
    return this.configProvider.getModelName(fallbackModel);
  }

  async getEngineSystemPrompt(): Promise<string> {
    return this.configProvider.getEngineSystemPrompt();
  }

  // ==================== Request Building ====================

  /**
   * 构建请求头和请求体
   */
  buildRequest(options: {
    messages: ChatMessage[];
    model: string;
    temperature: number;
    maxTokens: number;
    stream: boolean;
    config: AIConfig;
  }): { headers: Record<string, string>; requestBody: Record<string, any> } {
    const { messages, model, temperature, maxTokens, stream, config } = options;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const requestBody: Record<string, any> = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream,
    };

    if (config.apiKey) {
      if (config.apiKeyTransmission === 'header') {
        const authValue = config.apiKey.trim().startsWith('Bearer ') ? config.apiKey : `Bearer ${config.apiKey}`;
        headers['Authorization'] = authValue;
      } else {
        requestBody.api_key = config.apiKey;
      }
    }

    return { headers, requestBody };
  }

  /**
   * 将引擎系统提示词注入到 system message 中
   */
  enrichSystemPrompt(messages: ChatMessage[], engineSystemPrompt: string): ChatMessage[] {
    if (!engineSystemPrompt || !engineSystemPrompt.trim()) {
      return messages;
    }

    return messages.map((msg, index) => {
      if (index === 0 && msg.role === 'system') {
        return {
          role: 'system' as const,
          content: engineSystemPrompt.trim() + '\n\n' + msg.content
        };
      }
      return msg;
    });
  }

  // ==================== Non-Stream Call ====================

  /**
   * 执行非流式 AI 调用
   */
  async callChatAPI(
    messages: ChatMessage[],
    options: CallOptions & {
      model: string;
      temperature: number;
      maxTokens: number;
    }
  ): Promise<string> {
    const config = await this.getConfig();
    const { model, temperature, maxTokens, timeoutMs } = options;

    if (!config.baseUrl) {
      throw new Error('未配置 AI 服务地址，请在设置中配置');
    }

    const { headers, requestBody } = this.buildRequest({
      messages,
      model,
      temperature,
      maxTokens,
      stream: false,
      config
    });

    const controller = new AbortController();
    const timeoutId = timeoutMs && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI 请求失败: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('AI 返回内容为空');
      }

      return content;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`AI 请求超时（${(timeoutMs || 0) / 1000}秒），请稍后重试`);
      }
      throw error;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  // ==================== Stream Call ====================

  /**
   * 执行流式 AI 调用
   */
  async streamChatAPI(
    messages: ChatMessage[],
    options: CallOptions & {
      model: string;
      temperature: number;
      maxTokens: number;
      maxRetries?: number;
    },
    onChunk: StreamChunkCallback
  ): Promise<StreamResponse> {
    const config = await this.getConfig();
    const { model, temperature, maxTokens, abortSignal, maxRetries = 2 } = options;

    if (!config.baseUrl) {
      throw new Error('未配置 AI 服务地址，请在设置中配置');
    }

    const enrichedMessages = this.enrichSystemPrompt(messages, config.systemPrompt || '');

    const { headers, requestBody } = this.buildRequest({
      messages: enrichedMessages,
      model,
      temperature,
      maxTokens,
      stream: true,
      config
    });

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const backoffMs = Math.pow(2, attempt - 1) * 1000;
        await new Promise<void>(resolve => setTimeout(resolve, backoffMs));

        if (abortSignal?.aborted) {
          throw new Error('操作已被取消');
        }
      }

      try {
        const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: abortSignal
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`AI 请求失败: ${response.status} ${response.statusText}`);
        }

        const result = await this.streamParser.parseStream(response, onChunk, abortSignal);
        return {
          content: result.content,
          generationTime: result.generationTime,
          model
        };
      } catch (error) {
        lastError = error as Error;

        const isAbortError = (error instanceof DOMException && error.name === 'AbortError')
          || (typeof (error as Error).message === 'string' && (error as Error).message.toLowerCase().includes('abort'));

        if (isAbortError) {
          throw new Error('请求被中止');
        }

        const isTransient = this.isTransientError(error as Error);
        if (!isTransient || attempt === maxRetries) {
          throw error;
        }
      }
    }

    throw new Error(`AI 流请求最终失败: ${lastError?.message ?? '未知错误'}`);
  }

  // ==================== Error Classification ====================

  private isTransientError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('network') ||
      msg.includes('fetch') ||
      msg.includes('connection') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('timeout') ||
      msg.includes('socket') ||
      msg.includes('stream')
    );
  }

  classifyError(error: Error): 'timeout' | 'network' | 'service' | 'unknown' {
    const msg = error.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return 'timeout';
    }
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('connection') ||
        msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('socket') ||
        msg.includes('enotfound') || msg.includes('eai_again')) {
      return 'network';
    }
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('unavailable') ||
        msg.includes('503') || msg.includes('502') || msg.includes('500') ||
        msg.includes('service') || msg.includes('model')) {
      return 'service';
    }
    return 'unknown';
  }

  // ==================== Stream Parser Access ====================

  getStreamParser(): SSEStreamParser {
    return this.streamParser;
  }
}

// 单例导出
export const aiService = new AIService();
