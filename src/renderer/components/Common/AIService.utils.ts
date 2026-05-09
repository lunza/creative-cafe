// AI 服务工具函数

import { AIError, AIRequestOptions, AIServiceConfig } from './AIService.types';

function ensurePositiveInteger(value: any, defaultValue: number): number {
  const num = Number(value);
  if (isNaN(num) || num <= 0) {
    return defaultValue;
  }
  return Math.max(1, Math.floor(num));
}

// 错误处理工具
export class AIErrorHandler {
  // 创建网络错误
  static createNetworkError(message: string, details?: any): AIError {
    return {
      message,
      type: 'network',
      details
    };
  }

  // 创建服务器错误
  static createServerError(message: string, code?: string, details?: any): AIError {
    return {
      message,
      type: 'server',
      code,
      details
    };
  }

  // 创建 API 错误
  static createApiError(message: string, code?: string, details?: any): AIError {
    return {
      message,
      type: 'api',
      code,
      details
    };
  }

  // 创建验证错误
  static createValidationError(message: string, details?: any): AIError {
    return {
      message,
      type: 'validation',
      details
    };
  }

  // 创建未知错误
  static createUnknownError(message: string, details?: any): AIError {
    return {
      message,
      type: 'unknown',
      details
    };
  }

  // 从原始错误创建 AI 错误
  static fromError(error: any): AIError {
    if (!error) {
      return this.createUnknownError('未知错误');
    }

    if (error.message) {
      // 网络错误
      if (error.message.includes('Network') || error.message.includes('network') || error.message.includes('connect')) {
        return this.createNetworkError(error.message, error);
      }

      // 服务器错误
      if (error.status >= 500) {
        return this.createServerError(error.message, error.status.toString(), error);
      }

      // API 错误
      if (error.status >= 400 && error.status < 500) {
        return this.createApiError(error.message, error.status.toString(), error);
      }

      // 验证错误
      if (error.name === 'ValidationError' || error.message.includes('validation')) {
        return this.createValidationError(error.message, error);
      }

      // 未知错误
      return this.createUnknownError(error.message, error);
    }

    return this.createUnknownError('未知错误', error);
  }
}

// 数据转换工具
export class AIUtils {
  // 格式化请求参数
  static formatRequestOptions(options: AIRequestOptions, config: AIServiceConfig): AIRequestOptions {
    // 处理消息：如果配置了 systemPrompt，自动添加到消息开头
    let processedMessages = options.messages || [];
    
    // 如果有全局 systemPrompt，检查是否需要添加
    if (config.systemPrompt && config.systemPrompt.trim()) {
      // 检查是否已经有 system 消息
      const hasExistingSystemMessage = processedMessages.some(msg => msg.role === 'system');
      
      if (!hasExistingSystemMessage) {
        // 如果没有 system 消息，在开头添加
        processedMessages = [
          {
            role: 'system',
            content: config.systemPrompt
          },
          ...processedMessages
        ];
      }
    }
    
    // 先处理 options 中的其他属性
    const { model, baseUrl, apiKey, temperature, max_tokens, maxTokens, messages, ...restOptions } = options;
    
    const apiKeyTransmission = options.apiKeyTransmission || config.defaultApiKeyTransmission || 'header';
    
    return {
      ...restOptions, // 先处理其他属性，这样我们可以在后面覆盖它们
      model: model || config.defaultModel,
      baseUrl: baseUrl || config.defaultBaseUrl,
      apiKey: apiKey || config.defaultApiKey,
      apiKeyTransmission,
      messages: processedMessages,
      temperature: temperature ?? config.defaultTemperature ?? 0.7,
      max_tokens: ensurePositiveInteger(max_tokens ?? maxTokens ?? config.defaultMaxTokens, 1000),
    };
  }

  // 验证请求参数
  static validateRequestOptions(options: AIRequestOptions): { valid: boolean; error?: AIError } {
    // 验证模型
    if (!options.model || typeof options.model !== 'string') {
      return {
        valid: false,
        error: AIErrorHandler.createValidationError('模型名称必须是字符串')
      };
    }

    // 验证消息
    if (!options.messages || !Array.isArray(options.messages)) {
      return {
        valid: false,
        error: AIErrorHandler.createValidationError('消息必须是数组')
      };
    }

    // 验证消息格式
    for (const message of options.messages) {
      if (!message.role || !message.content) {
        return {
          valid: false,
          error: AIErrorHandler.createValidationError('消息必须包含角色和内容')
        };
      }

      if (!['user', 'assistant', 'system'].includes(message.role)) {
        return {
          valid: false,
          error: AIErrorHandler.createValidationError('角色必须是 user、assistant 或 system')
        };
      }
    }

    // 验证温度参数
    if (options.temperature !== undefined && (typeof options.temperature !== 'number' || options.temperature < 0 || options.temperature > 2)) {
      return {
        valid: false,
        error: AIErrorHandler.createValidationError('温度参数必须是 0 到 2 之间的数字')
      };
    }

    // 验证最大 tokens
    if (options.maxTokens !== undefined && (typeof options.maxTokens !== 'number' || options.maxTokens <= 0)) {
      return {
        valid: false,
        error: AIErrorHandler.createValidationError('最大 tokens 必须是正数')
      };
    }

    return { valid: true };
  }

  // 计算响应时间
  static calculateResponseTime(startTime: number): number {
    return Date.now() - startTime;
  }

  // 延迟函数
  static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 重试函数
  static async retry<T>(
    fn: () => Promise<T>,
    attempts: number = 3,
    delay: number = 1000
  ): Promise<T> {
    let lastError: any;

    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (i < attempts - 1) {
          await this.delay(delay * (i + 1));
        }
      }
    }

    throw lastError;
  }
}

// 配置验证工具
export class AIConfigValidator {
  // 验证配置
  static validateConfig(config: AIServiceConfig): { valid: boolean; error?: string } {
    if (!config) {
      return { valid: false, error: '配置不能为空' };
    }

    if (!config.defaultModel || typeof config.defaultModel !== 'string') {
      return { valid: false, error: '默认模型必须是字符串' };
    }

    if (!config.defaultBaseUrl || typeof config.defaultBaseUrl !== 'string') {
      return { valid: false, error: 'API 基础 URL 不能为空' };
    }

    if (config.defaultTemperature !== undefined && (typeof config.defaultTemperature !== 'number' || config.defaultTemperature < 0 || config.defaultTemperature > 2)) {
      return { valid: false, error: '默认温度参数必须是 0 到 2 之间的数字' };
    }

    if (config.defaultMaxTokens !== undefined && (typeof config.defaultMaxTokens !== 'number' || config.defaultMaxTokens <= 0)) {
      return { valid: false, error: '默认最大 tokens 必须是正数' };
    }

    if (config.retryAttempts !== undefined && (typeof config.retryAttempts !== 'number' || config.retryAttempts < 0)) {
      return { valid: false, error: '重试次数必须是非负数' };
    }

    if (config.retryDelay !== undefined && (typeof config.retryDelay !== 'number' || config.retryDelay < 0)) {
      return { valid: false, error: '重试延迟必须是非负数' };
    }

    if (config.timeout !== undefined && (typeof config.timeout !== 'number' || config.timeout <= 0)) {
      return { valid: false, error: '请求超时必须是正数' };
    }

    return { valid: true };
  }

  static createDefaultConfig(): AIServiceConfig {
    return {
      defaultModel: 'gpt-3.5-turbo',
      defaultBaseUrl: 'http://127.0.0.1:5000',
      defaultApiKey: '',
      defaultTemperature: 0.7,
      defaultMaxTokens: 4096,
      retryAttempts: 3,
      retryDelay: 1000,
      timeout: 600000,
      systemPrompt: undefined,
    };
  }
}
