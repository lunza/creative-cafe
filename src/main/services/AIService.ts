/**
 * AI Service - 统一的 AI 服务调用抽象层
 * 
 * 封装所有 AI 调用的通用逻辑：
 * - 配置获取和管理
 * - 请求构建和执行
 * - 流式响应解析
 * - 错误处理和重试
 */

import { getStorageService } from './storageService';

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

export type StreamChunkCallback = (chunk: string) => void;

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

// ==================== SSEStreamParser ====================

/**
 * SSE 流式响应解析器
 * 统一处理 Server-Sent Events 格式的流式响应解析
 * 消除 ContentGenerator 和 OutlineGenerator 中重复的流式处理逻辑
 */
export class SSEStreamParser {
  /**
   * 解析 SSE 单行数据，提取 content 字段
   */
  parseSSELine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return null;

    const jsonStr = trimmed.substring(6).trim();
    if (!jsonStr || jsonStr === '[DONE]') return null;

    try {
      const parsed = JSON.parse(jsonStr);
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) return delta;

      const message = parsed.choices?.[0]?.message?.content;
      if (message) return message;

      return null;
    } catch {
      return null;
    }
  }

  /**
   * 从原始 SSE 数据中提取 content
   * 支持多种格式的容错解析
   */
  extractContentFromRawData(rawData: string): string {
    let extracted = '';

    // Strategy 1: 匹配所有 data: 行
    const dataLineRegex = /^data:\s+(.+)$/gm;
    let match;
    while ((match = dataLineRegex.exec(rawData)) !== null) {
      const jsonStr = match[1].trim();
      if (jsonStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) extracted += delta;
        else if (parsed.choices?.[0]?.message?.content) {
          extracted += parsed.choices[0].message.content;
        }
      } catch {
        // Skip malformed JSON
      }
    }

    // Strategy 2: 直接正则提取 content 字段
    if (!extracted) {
      const contentRegex = /"content"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/g;
      let contentMatch;
      while ((contentMatch = contentRegex.exec(rawData)) !== null) {
        const rawContent = contentMatch[1];
        extracted += rawContent.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
      }
    }

    return extracted;
  }

  /**
   * 解析 Response 流式响应体，实时调用回调
   */
  async parseStream(
    response: Response,
    onChunk: StreamChunkCallback,
    abortSignal?: AbortSignal
  ): Promise<{ content: string; generationTime: number }> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法获取响应流');
    }

    const decoder = new TextDecoder('utf-8');
    let fullContent = '';
    let buffer = '';
    const startTime = Date.now();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // 处理 buffer 中残留的不完整 SSE 数据行
          if (buffer.trim()) {
            buffer = buffer.trim();
            if (buffer.startsWith('data:') && !buffer.includes('[DONE]')) {
              const jsonStr = buffer.substring(6).trim();
              if (jsonStr) {
                try {
                  const chunkData = JSON.parse(jsonStr);
                  if (chunkData.choices?.[0]) {
                    const content = chunkData.choices[0].delta?.content || chunkData.choices[0].message?.content || '';
                    if (content) {
                      fullContent += content;
                      onChunk(content);
                    }
                  }
                } catch {
                  // 忽略解析错误
                }
              }
            }
          }
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // 按行分割，保留最后一个不完整的行在 buffer 中
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const parsed = this.parseSSELine(line);
          if (parsed) {
            fullContent += parsed;
            onChunk(parsed);
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { content: fullContent, generationTime: Date.now() - startTime };
      }
      throw error;
    } finally {
      reader.releaseLock();
    }

    // 回退提取
    if (fullContent.length < 100 && buffer.length > 0) {
      const fallbackContent = this.extractContentFromRawData(buffer);
      if (fallbackContent.length > fullContent.length) {
        fullContent = fallbackContent;
      }
    }

    return { content: fullContent, generationTime: Date.now() - startTime };
  }
}

// ==================== AIService ====================

/**
 * 统一的 AI 服务调用类
 * 封装所有 AI 调用的通用逻辑，供 PlotCheckerService、ContentGenerator、OutlineGenerator 复用
 */
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
