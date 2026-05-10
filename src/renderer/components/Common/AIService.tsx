// AI 服务组件

import React, { useState, useCallback, useMemo } from 'react';
import { openai as createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { AIRequestOptions, AIResult, AIError, AIRequestStatus, AIServiceConfig, AIStreamOptions } from './AIService.types';
import { AIErrorHandler, AIUtils, AIConfigValidator } from './AIService.utils';

// AI 服务组件
export class AIService {
  private config: AIServiceConfig;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(config: AIServiceConfig) {
    // 确保配置安全，如果无效则使用默认值修复
    const safeConfig = this.ensureSafeConfig(config);
    this.config = safeConfig;
  }

  // 确保配置是安全的，仅校验范围，不注入硬编码默认值
  private ensureSafeConfig(config: AIServiceConfig): AIServiceConfig {
    const safeMaxTokens = this.sanitizeNumber(config.defaultMaxTokens, 4096, 1);
    const safeTemperature = this.sanitizeNumber(config.defaultTemperature, 0.7, 0, 2);
    const safeRetryAttempts = this.sanitizeNumber(config.retryAttempts, 0, 0);
    const safeRetryDelay = this.sanitizeNumber(config.retryDelay, 1000, 0);
    const safeTimeout = this.sanitizeNumber(config.timeout, 0, 0); // 默认无超时限制
    
    const safeConfig: AIServiceConfig = {
      defaultModel: config.defaultModel,
      defaultBaseUrl: config.defaultBaseUrl,
      defaultApiKey: config.defaultApiKey,
      defaultTemperature: safeTemperature,
      defaultMaxTokens: safeMaxTokens,
      retryAttempts: safeRetryAttempts,
      retryDelay: safeRetryDelay,
      timeout: safeTimeout,
      systemPrompt: config.systemPrompt,
    };

    const validation = AIConfigValidator.validateConfig(safeConfig);
    if (!validation.valid) {
      throw new Error(`Invalid AIService config: ${validation.error}`);
    }

    return safeConfig;
  }

  // 安全地清理数值参数，仅在值超出范围时修正为边界值
  private sanitizeNumber(
    value: number | undefined, 
    defaultValue: number, 
    min: number = 0, 
    max?: number
  ): number {
    if (value === undefined || value === null) {
      return defaultValue;
    }
    
    const num = Number(value);
    
    if (isNaN(num) || !isFinite(num)) {
      return defaultValue;
    }
    
    if (num < min) {
      return min;
    }
    
    if (max !== undefined && num > max) {
      return max;
    }
    
    return num;
  }

  // ==========================================
  // 公共方法 - 配置管理
  // ==========================================

  getConfig(): AIServiceConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<AIServiceConfig>): void {
    const newConfig = { ...this.config, ...config };
    const validation = AIConfigValidator.validateConfig(newConfig);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    this.config = newConfig;
  }

  cancelRequest(requestId: string): void {
    const controller = this.abortControllers.get(requestId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(requestId);
    }
  }

  cancelAllRequests(): void {
    for (const [, controller] of this.abortControllers) {
      controller.abort();
    }
    this.abortControllers.clear();
  }

  // ==========================================
  // 私有辅助方法
  // ==========================================

  private createRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private buildRequestBody(options: AIRequestOptions, stream: boolean = false): Record<string, any> {
    const body: Record<string, any> = {
      model: options.model,
      messages: options.messages
    };

    if (options.temperature !== undefined && options.temperature !== null) {
      body.temperature = Number(options.temperature);
    }

    if (options.max_tokens !== undefined && options.max_tokens !== null) {
      body.max_tokens = Number(options.max_tokens);
    } else if (options.maxTokens !== undefined && options.maxTokens !== null) {
      body.max_tokens = Number(options.maxTokens);
    }

    const transmission = (options as any).apiKeyTransmission || this.config.defaultApiKeyTransmission || 'header';
    if (transmission === 'body' && options.apiKey) {
      body.api_key = options.apiKey;
    }

    if (stream) {
      body.stream = true;
    }

    return body;
  }

  private buildHeaders(options: AIRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (options.apiKey) {
      const transmission = (options as any).apiKeyTransmission || this.config.defaultApiKeyTransmission || 'header';
      if (transmission === 'header') {
        const trimmedKey = options.apiKey.trim();
        headers['Authorization'] = trimmedKey.startsWith('Bearer ') ? trimmedKey : `Bearer ${trimmedKey}`;
      }
    }

    return headers;
  }

  private validateBaseUrl(baseUrl: string | undefined): string {
    if (!baseUrl || typeof baseUrl !== 'string' || baseUrl.trim() === '') {
      throw new Error('API 基础 URL 未配置。请在设置中配置 AI 引擎的 API 地址。');
    }

    let trimmedUrl = baseUrl.trim().replace(/\/+$/, '');

    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      throw new Error(`API 基础 URL 格式无效: "${baseUrl}"。URL 必须以 http:// 或 https:// 开头。`);
    }

    try {
      new URL(trimmedUrl);
    } catch {
      throw new Error(`API 基础 URL 格式无效: "${baseUrl}"。请检查 URL 格式是否正确。`);
    }

    // 如果 URL 已经包含 /v1/chat/completions 或 /v1/completions，提取基础 URL
    // 这样可以兼容用户填写完整路径的情况
    if (trimmedUrl.endsWith('/v1/chat/completions')) {
      return trimmedUrl.replace(/\/v1\/chat\/completions$/, '');
    }
    if (trimmedUrl.endsWith('/v1/completions')) {
      return trimmedUrl.replace(/\/v1\/completions$/, '');
    }

    return trimmedUrl;
  }

  private async sendRequestWithRetry<T>(
    requestFn: () => Promise<T>,
    retryAttempts: number = 3,
    retryDelay: number = 1000
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt < retryAttempts; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;
        
        // 只对网络错误和5xx错误进行重试
        const isRetryable = error.name === 'TypeError' || 
                            (error.status && error.status >= 500);
        
        if (!isRetryable || attempt === retryAttempts - 1) {
          throw error;
        }
        
        await AIUtils.delay(retryDelay * (attempt + 1));
      }
    }

    throw lastError;
  }

  private async processStreamResponse(
    response: Response,
    streamOptions: AIStreamOptions
  ): Promise<void> {
    if (!response.body) {
      throw new Error('无法获取响应流');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullContent = '';
    let finishReason: string | undefined;
    let usage: any;
    let id: string | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          const data = line.substring(6);
          if (data === '[DONE]') continue;

          try {
            const chunkData = JSON.parse(data);
            
            if (chunkData.choices?.[0]) {
              const choice = chunkData.choices[0];
              const content = choice.delta?.content || '';
              
              if (content) {
                fullContent += content;
                streamOptions.onStream(content, false);
              }
              
              if (choice.finish_reason) {
                finishReason = choice.finish_reason;
              }
              
              if (chunkData.id) {
                id = chunkData.id;
              }
            }
            
            if (chunkData.usage) {
              usage = chunkData.usage;
            }
          } catch (parseError) {
            console.debug('流式响应片段解析失败:', parseError);
            // 继续处理下一行，不中断整个请求
          }
        }
      }

      if (streamOptions.onComplete) {
        const responseData = {
          content: fullContent,
          finishReason: finishReason || 'unknown',
          usage,
          id: id || ''
        };
        streamOptions.onComplete(responseData);
      }

      streamOptions.onStream('', true);
    } finally {
      reader.releaseLock();
    }
  }

  // ==========================================
  // 原生实现方法（通过 IPC 转发到主进程，避免 CORS 问题）
  // ==========================================

  async sendChatRequest(options: AIRequestOptions): Promise<AIResult> {
    const startTime = Date.now();
    
    try {
      const validation = AIUtils.validateRequestOptions(options);
      if (!validation.valid) {
        return {
          error: validation.error,
          status: 'error',
          responseTime: AIUtils.calculateResponseTime(startTime)
        };
      }

      const formattedOptions = AIUtils.formatRequestOptions(options, this.config);
      const validBaseUrl = this.validateBaseUrl(formattedOptions.baseUrl);
      const url = `${validBaseUrl}/v1/chat/completions`;

      // 通过 IPC 转发到主进程，避免渲染进程的 CORS 限制
      const result = await (window as any).electronAPI.ai.request({
        url,
        method: 'POST',
        headers: this.buildHeaders(formattedOptions),
        body: this.buildRequestBody(formattedOptions, false),
        timeout: (this.config as any).timeout || 0, // 无超时限制
        streaming: false
      });

      if (!result.success) {
        throw new Error(result.error || 'AI 请求失败');
      }

      const responseData = {
        content: result.data?.choices?.[0]?.message?.content || '',
        finishReason: result.data?.choices?.[0]?.finish_reason || 'unknown',
        usage: result.data?.usage,
        id: result.data?.id
      };

      return {
        response: responseData,
        status: 'success',
        responseTime: AIUtils.calculateResponseTime(startTime)
      };
    } catch (error) {
      let aiError: AIError;
      
      if (error instanceof Error) {
        const errMsg = error.message.toLowerCase();
        if (errMsg.includes('fetch') || errMsg.includes('network') || errMsg.includes('connect')) {
          aiError = AIErrorHandler.createNetworkError(
            '无法连接到 AI 服务。请检查：\n1. API 地址是否正确\n2. 网络连接是否正常\n3. 防火墙是否阻止了请求'
          );
        } else {
          aiError = AIErrorHandler.fromError(error);
        }
      } else {
        aiError = AIErrorHandler.fromError(error);
      }
      
      return {
        error: aiError,
        status: 'error',
        responseTime: AIUtils.calculateResponseTime(startTime)
      };
    }
  }

  async sendStreamChatRequest(options: AIRequestOptions, streamOptions: AIStreamOptions): Promise<void> {
    try {
      const validation = AIUtils.validateRequestOptions(options);
      if (!validation.valid) {
        if (streamOptions.onError) {
          streamOptions.onError(validation.error!);
        }
        return;
      }

      const formattedOptions = AIUtils.formatRequestOptions(options, this.config);
      const validBaseUrl = this.validateBaseUrl(formattedOptions.baseUrl);
      const url = `${validBaseUrl}/v1/chat/completions`;

      // 设置流式响应事件监听
      let receivedChunkCount = 0;
      let totalReceivedChars = 0;
      const streamListenerStartTime = Date.now();
      
      // 修复：添加 SSE 解析函数，从原始 chunk 中提取 delta.content
      const parseSSEChunk = (rawChunk: string): string => {
        if (!rawChunk || rawChunk.trim().length === 0) {
          return '';
        }
        
        try {
          // SSE 格式可能是多行的，每行以 "data: " 开头
          // 例如: "data: {...}\n\ndata: {...}\n\n"
          // 需要提取所有 data: 行中的 delta.content 并拼接
          
          let extractedContent = '';
          
          // 方法 1: 使用正则表达式匹配所有 data: 行
          const dataLineRegex = /^data:\s+(.+)$/gm;
          let match;
          const regex = new RegExp(dataLineRegex);
          
          while ((match = regex.exec(rawChunk)) !== null) {
            const jsonStr = match[1].trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(jsonStr);
              // 优先提取 delta.content（流式响应）
              if (parsed.choices?.[0]?.delta?.content) {
                extractedContent += parsed.choices[0].delta.content;
              }
              // 备用：提取 message.content（完整响应）
              else if (parsed.choices?.[0]?.message?.content) {
                extractedContent += parsed.choices[0].message.content;
              }
            } catch (e) {
              // 忽略单个 JSON 解析错误
            }
          }
          
          // 如果提取到了内容，返回
          if (extractedContent) {
            return extractedContent;
          }
          
          // 方法 2: 尝试将原始 chunk 按行分割，查找 data: 行
          const lines = rawChunk.split('\n');
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data:') && !trimmedLine.includes('[DONE]')) {
              const jsonStr = trimmedLine.replace(/^data:\s*/, '').trim();
              if (!jsonStr) continue;
              
              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.choices?.[0]?.delta?.content) {
                  extractedContent += parsed.choices[0].delta.content;
                } else if (parsed.choices?.[0]?.message?.content) {
                  extractedContent += parsed.choices[0].message.content;
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
          
          if (extractedContent) {
            return extractedContent;
          }
          
          // 方法 3: 尝试直接解析整个 chunk 为 JSON（非 SSE 格式）
          try {
            const parsed = JSON.parse(rawChunk);
            if (parsed.choices?.[0]?.delta?.content) {
              return parsed.choices[0].delta.content;
            }
            if (parsed.choices?.[0]?.message?.content) {
              return parsed.choices[0].message.content;
            }
          } catch (e) {
            // 不是 JSON，继续下一个方法
          }
          
          // 方法 4: 尝试从原始文本中提取 content 字段（降级方案）
          const contentMatch = rawChunk.match(/"content"\s*:\s*"([^"]*)"/);
          if (contentMatch && contentMatch[1]) {
            return contentMatch[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
          }
          
          // 如果所有方法都失败，返回空字符串（而不是原始 SSE 数据）
          console.debug(`[AIService] 【SSE 解析】无法从 chunk 中提取内容，chunk 前 150 字符:`, rawChunk.substring(0, 150));
          return '';
        } catch (e) {
          console.warn('[AIService] SSE 解析失败:', e);
          return '';
        }
      };

      // 修复：preload 中的 on 方法会剥离 event 参数，只传递 data
      // 所以监听器应该只接收一个参数：data
      const streamListener = (data: { chunk: string; chunkIndex?: number; chunkSize?: number; accumulatedData: string }) => {
        // 防御性检查
        if (!data) {
          console.warn(`[AIService] 【流式监听】收到空数据对象`);
          return;
        }
        
        // 解析 SSE 数据，提取实际的文本内容
        const parsedContent = parseSSEChunk(data.chunk);
        
        if (receivedChunkCount === 0) {
          // 只在第一个 chunk 时打印原始数据，避免日志过多
          console.debug(`[AIService] 首个 chunk 原始数据:`, data.chunk?.substring(0, 200));
          console.debug(`[AIService] 首个 chunk 解析结果: "${parsedContent.substring(0, 100)}" (长度: ${parsedContent.length})`);
        }
        
        if (parsedContent && streamOptions.onStream) {
          receivedChunkCount++;
          totalReceivedChars = data.accumulatedData?.length || 0;
          streamOptions.onStream(parsedContent, false);
          
          // 每 10 个 chunk 记录一次日志
          if (receivedChunkCount % 10 === 0) {
            const elapsed = ((Date.now() - streamListenerStartTime) / 1000).toFixed(2);
            console.debug(`[AIService] 流式响应进度: 已接收 ${receivedChunkCount} 个 chunk, 解析后内容 ${parsedContent.length} 字符, 耗时 ${elapsed}s`);
          }
        } else if (!parsedContent && data.chunk) {
          console.warn(`[AIService] 收到 chunk 但解析后为空，chunkIndex: ${data.chunkIndex}, chunkSize: ${data.chunkSize}, 原始内容: ${data.chunk.substring(0, 150)}`);
        }
      };

      const completeListener = (data: { data: any }) => {
        const totalElapsed = ((Date.now() - streamListenerStartTime) / 1000).toFixed(2);
        console.debug(`[AIService] 流式响应完成回调触发`);
        console.debug(`[AIService] 【流式响应】总计接收 ${receivedChunkCount} 个 chunk`);
        console.debug(`[AIService] 【流式响应】最终内容长度: ${totalReceivedChars} 字符`);
        console.debug(`[AIService] 【流式响应】总耗时: ${totalElapsed}s`);
        console.debug(`[AIService] 【流式响应】响应数据:`, data);

        // 清理监听器
        (window as any).electronAPI?.off?.('ai:stream', streamListener);
        (window as any).electronAPI?.off?.('ai:stream:complete', completeListener);

        // 解析完整内容 - 修复：仅当有实际内容时才使用，避免空字符串覆盖已累积内容
        let fullContent = '';
        if (data?.data) {
          // 尝试从 choices[0].message.content 获取
          if (data.data.choices?.[0]?.message?.content && data.data.choices[0].message.content.trim().length > 0) {
            fullContent = data.data.choices[0].message.content;
            console.debug(`[AIService] 【内容提取】从 message.content 获取，长度: ${fullContent.length}`);
          }
          // 备用：尝试从 choices[0].delta.content 获取
          else if (data.data.choices?.[0]?.delta?.content && data.data.choices[0].delta.content.trim().length > 0) {
            fullContent = data.data.choices[0].delta.content;
            console.debug(`[AIService] 【内容提取】从 delta.content 获取，长度: ${fullContent.length}`);
          }
          // 备用：如果完整响应包含 content 字段
          else if (data.data.content && typeof data.data.content === 'string' && data.data.content.trim().length > 0) {
            fullContent = data.data.content;
            console.debug(`[AIService] 【内容提取】从 data.content 获取，长度: ${fullContent.length}`);
          }
          else {
            console.debug(`[AIService] 【内容提取】响应数据中未找到有效内容，使用流式累积内容`);
            console.debug(`[AIService] 【响应数据结构】`, JSON.stringify(data.data, null, 2).substring(0, 500));
          }
        } else {
          console.debug(`[AIService] 【内容提取】响应数据为空`);
        }

        if (streamOptions.onComplete) {
          const responseData = {
            content: fullContent,
            finishReason: data?.data?.choices?.[0]?.finish_reason || 'unknown',
            usage: data?.data?.usage,
            id: data?.data?.id || ''
          };
          // 修复：仅当 content 有实际内容时才传递，避免空字符串覆盖已累积内容
          if (fullContent && fullContent.trim().length > 0) {
            console.debug(`[AIService] 【onComplete】传递内容长度: ${fullContent.length}`);
            streamOptions.onComplete(responseData);
          } else {
            console.debug(`[AIService] 【onComplete】无有效内容，跳过覆盖`);
          }
        }

        if (streamOptions.onStream) {
          streamOptions.onStream('', true);
        }
      };

      const errorListener = (error: { message: string; errorType: string }) => {
        // 清理监听器
        (window as any).electronAPI?.off?.('ai:stream', streamListener);
        (window as any).electronAPI?.off?.('ai:stream:complete', completeListener);

        if (streamOptions.onError) {
          const aiError = AIErrorHandler.fromError(new Error(error?.message || 'AI 流式请求失败'));
          streamOptions.onError(aiError);
        }
      };

      // 注册事件监听
      (window as any).electronAPI?.on?.('ai:stream', streamListener);
      (window as any).electronAPI?.on?.('ai:stream:complete', completeListener);
      (window as any).electronAPI?.on?.('ai:stream:error', errorListener);

      // 通过 IPC 转发到主进程，避免渲染进程的 CORS 限制
      const result = await (window as any).electronAPI.ai.request({
        url,
        method: 'POST',
        headers: this.buildHeaders(formattedOptions),
        body: this.buildRequestBody(formattedOptions, true),
        timeout: (this.config as any).timeout || 0, // 无超时限制
        streaming: true
      });

      if (!result.success) {
        // 清理监听器
        (window as any).electronAPI?.off?.('ai:stream', streamListener);
        (window as any).electronAPI?.off?.('ai:stream:complete', completeListener);
        (window as any).electronAPI?.off?.('ai:stream:error', errorListener);

        if (streamOptions.onError) {
          const aiError = AIErrorHandler.fromError(new Error(result.error || 'AI 流式请求失败'));
          streamOptions.onError(aiError);
        }
      }
    } catch (error) {
      let aiError: AIError;
      
      if (error instanceof Error) {
        const errMsg = error.message.toLowerCase();
        if (errMsg.includes('fetch') || errMsg.includes('network') || errMsg.includes('connect')) {
          aiError = AIErrorHandler.createNetworkError(
            '无法连接到 AI 服务。请检查：\n1. API 地址是否正确\n2. 网络连接是否正常\n3. 防火墙是否阻止了请求'
          );
        } else {
          aiError = AIErrorHandler.fromError(error);
        }
      } else {
        aiError = AIErrorHandler.fromError(error);
      }
      
      if (streamOptions.onError) {
        streamOptions.onError(aiError);
      }
    }
  }

  async sendCompletionRequest(options: AIRequestOptions): Promise<AIResult> {
    return this.sendChatRequest(options);
  }

  async sendStreamCompletionRequest(options: AIRequestOptions, streamOptions: AIStreamOptions): Promise<void> {
    return this.sendStreamChatRequest(options, streamOptions);
  }

  // ==========================================
  // Vercel AI SDK 方法（完整实现）
  // ==========================================

  async sendChatRequestVercel(options: AIRequestOptions): Promise<AIResult> {
    const startTime = Date.now();
    
    try {
      const validation = AIUtils.validateRequestOptions(options);
      if (!validation.valid) {
        return {
          error: validation.error,
          status: 'error',
          responseTime: AIUtils.calculateResponseTime(startTime)
        };
      }

      const formattedOptions = AIUtils.formatRequestOptions(options, this.config);
      const requestId = this.createRequestId();
      const abortController = new AbortController();
      this.abortControllers.set(requestId, abortController);

      try {
        const openaiClient = createOpenAI({
          baseURL: formattedOptions.baseUrl,
          apiKey: formattedOptions.apiKey
        });

        const result = await this.sendRequestWithRetry(async () => {
          return await streamText({
            model: openaiClient(formattedOptions.model),
            messages: formattedOptions.messages,
            temperature: formattedOptions.temperature,
            maxTokens: formattedOptions.max_tokens,
            abortSignal: abortController.signal
          });
        }, this.config.retryAttempts || 3, this.config.retryDelay || 1000);

        const text = await result.text;
        const usage = await result.usage;

        const responseData = {
          content: text,
          finishReason: 'stop',
          usage: usage ? {
            promptTokens: usage.promptTokens || 0,
            completionTokens: usage.completionTokens || 0,
            totalTokens: usage.totalTokens || 0
          } : undefined,
          id: ''
        };

        return {
          response: responseData,
          status: 'success',
          responseTime: AIUtils.calculateResponseTime(startTime)
        };
      } finally {
        this.abortControllers.delete(requestId);
      }
    } catch (error) {
      return {
        error: AIErrorHandler.fromError(error),
        status: 'error',
        responseTime: AIUtils.calculateResponseTime(startTime)
      };
    }
  }

  async sendStreamChatRequestVercel(options: AIRequestOptions, streamOptions: AIStreamOptions): Promise<void> {
    try {
      const validation = AIUtils.validateRequestOptions(options);
      if (!validation.valid) {
        if (streamOptions.onError) {
          streamOptions.onError(validation.error!);
        }
        return;
      }

      const formattedOptions = AIUtils.formatRequestOptions(options, this.config);
      const requestId = this.createRequestId();
      const abortController = new AbortController();
      this.abortControllers.set(requestId, abortController);

      try {
        const openaiClient = createOpenAI({
          baseURL: formattedOptions.baseUrl,
          apiKey: formattedOptions.apiKey
        });

        const result = await streamText({
          model: openaiClient(formattedOptions.model),
          messages: formattedOptions.messages,
          temperature: formattedOptions.temperature,
          maxTokens: formattedOptions.max_tokens,
          abortSignal: abortController.signal
        });

        let fullContent = '';
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            fullContent += part.textDelta;
            streamOptions.onStream(part.textDelta, false);
          }
        }

        const usage = await result.usage;

        if (streamOptions.onComplete) {
          const responseData = {
            content: fullContent,
            finishReason: 'stop',
            usage: usage ? {
              promptTokens: usage.promptTokens || 0,
              completionTokens: usage.completionTokens || 0,
              totalTokens: usage.totalTokens || 0
            } : undefined,
            id: ''
          };
          streamOptions.onComplete(responseData);
        }

        streamOptions.onStream('', true);
      } finally {
        this.abortControllers.delete(requestId);
      }
    } catch (error) {
      const aiError = AIErrorHandler.fromError(error);
      if (streamOptions.onError) {
        streamOptions.onError(aiError);
      }
    }
  }
}

// 自定义 Hook：使用 AI 服务
export function useAIService(config: AIServiceConfig) {
  const [status, setStatus] = useState<AIRequestStatus>('idle');
  const [response, setResponse] = useState<any>(null);
  const [error, setError] = useState<AIError | null>(null);
  const [responseTime, setResponseTime] = useState<number | null>(null);

  const aiService = useMemo(() => {
    return new AIService(config);
  }, [config]);

  const createRequestHandler = useCallback((
    requestFn: (options: AIRequestOptions) => Promise<AIResult>
  ) => {
    return async (options: AIRequestOptions) => {
      setStatus('loading');
      setError(null);
      setResponse(null);
      setResponseTime(null);

      const result = await requestFn(options);
      setStatus(result.status);
      setResponse(result.response);
      setError(result.error || null);
      setResponseTime(result.responseTime || null);

      return result;
    };
  }, []);

  const createStreamHandler = useCallback((
    streamFn: (options: AIRequestOptions, streamOptions: AIStreamOptions) => Promise<void>
  ) => {
    return async (options: AIRequestOptions, streamOptions: AIStreamOptions) => {
      setStatus('loading');
      setError(null);

      await streamFn(options, {
        ...streamOptions,
        onError: (err) => {
          setStatus('error');
          setError(err);
          if (streamOptions.onError) {
            streamOptions.onError(err);
          }
        },
        onComplete: (res) => {
          setStatus('success');
          setResponse(res);
          if (streamOptions.onComplete) {
            streamOptions.onComplete(res);
          }
        }
      });
    };
  }, []);

  const sendChatRequest = useMemo(() => 
    createRequestHandler(aiService.sendChatRequest.bind(aiService)),
    [createRequestHandler, aiService]
  );

  const sendStreamChatRequest = useMemo(() => 
    createStreamHandler(aiService.sendStreamChatRequest.bind(aiService)),
    [createStreamHandler, aiService]
  );

  const sendCompletionRequest = useMemo(() => 
    createRequestHandler(aiService.sendCompletionRequest.bind(aiService)),
    [createRequestHandler, aiService]
  );

  const sendStreamCompletionRequest = useMemo(() => 
    createStreamHandler(aiService.sendStreamCompletionRequest.bind(aiService)),
    [createStreamHandler, aiService]
  );

  const sendChatRequestVercel = useMemo(() => 
    createRequestHandler(aiService.sendChatRequestVercel.bind(aiService)),
    [createRequestHandler, aiService]
  );

  const sendStreamChatRequestVercel = useMemo(() => 
    createStreamHandler(aiService.sendStreamChatRequestVercel.bind(aiService)),
    [createStreamHandler, aiService]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setResponse(null);
    setError(null);
    setResponseTime(null);
  }, []);

  return {
    aiService,
    status,
    response,
    error,
    responseTime,
    sendChatRequest,
    sendStreamChatRequest,
    sendCompletionRequest,
    sendStreamCompletionRequest,
    sendChatRequestVercel,
    sendStreamChatRequestVercel,
    reset
  };
}

export const defaultAIServiceConfig = AIConfigValidator.createDefaultConfig();
export const defaultAIService = new AIService(defaultAIServiceConfig);
export { AIConfigValidator, AIErrorHandler, AIUtils } from './AIService.utils';
