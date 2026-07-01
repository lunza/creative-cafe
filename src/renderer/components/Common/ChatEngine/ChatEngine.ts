// 聊天引擎核心类 - 采用策略模式封装AI调用逻辑
//
// 重构说明（Task 4.6）：
// 原本 ChatEngine 重复实现了 buildApiUrl/buildRequestBody 等请求构造逻辑，
// 与 renderer 侧 AIService.tsx 形成两套并行实现。
// 现已删除这些重复的私有方法，将 URL/Body 构造直接内联到 sendMessage 中。
// 进一步统一需要迁移 CharacterDialogueChat.hooks.ts 到 AIService.tsx（不在本任务范围）。

import { ChatMessage } from '../../Character/CharacterDialogueChat/CharacterDialogueChat.types';
import {
  IChatEngine,
  AIEngineConfig,
  StreamCallback,
  CompleteCallback,
  ErrorCallback,
  AIResponse
} from './ChatEngine.types';

export class ChatEngine implements IChatEngine {
  private streamCallback: StreamCallback | null = null;
  private completeCallback: CompleteCallback | null = null;
  private errorCallback: ErrorCallback | null = null;
  private removeStreamListener: (() => void) | null = null;
  private removeCompleteListener: (() => void) | null = null;
  private removeErrorListener: (() => void) | null = null;
  private isCancelled: boolean = false;

  onStream(callback: StreamCallback): void {
    this.streamCallback = callback;
  }

  onComplete(callback: CompleteCallback): void {
    this.completeCallback = callback;
  }

  onError(callback: ErrorCallback): void {
    this.errorCallback = callback;
  }

  async sendMessage(
    messages: ChatMessage[],
    systemPrompt: string,
    config: AIEngineConfig
  ): Promise<void> {
    this.isCancelled = false;
    this.cleanupListeners();

    try {
      const chatHistory = messages
        .filter(msg => msg.role !== 'system')
        .map(msg => ({
          role: msg.role,
          content: String(msg.content),
        }));

      // 内联 URL 构造（原 buildApiUrl 方法，已删除以消除与 AIService.tsx 的重复）
      const baseUrl = config.api_url.trim().replace(/\/+$/, '');
      if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
        throw new Error(`Invalid API URL: ${config.api_url}`);
      }
      const apiUrl = baseUrl.endsWith('/v1/chat/completions') || baseUrl.endsWith('/v1/completions')
        ? baseUrl
        : `${baseUrl}/v1/chat/completions`;

      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // 内联请求体构造（原 buildRequestBody 方法，已删除以消除与 AIService.tsx 的重复）
      if (!config.model_name) {
        throw new Error('未配置 AI 模型名称');
      }
      const maxTokens = (typeof config.max_tokens === 'number' && config.max_tokens > 0)
        ? config.max_tokens
        : 10240;
      const temperature = Number(config.temperature) ?? 0.8;
      const apiMode = config.api_mode || 'chat_completion';

      const requestBody: any = {
        model: config.model_name,
        max_tokens: maxTokens,
        temperature,
        stream: true,
      };

      if (apiMode === 'chat_completion') {
        requestBody.messages = [
          { role: 'system', content: systemPrompt },
          ...chatHistory,
        ];
      } else {
        // text_completion 模式：将 systemPrompt + 对话历史拼接为单一 prompt
        let prompt = `${systemPrompt}\n\n`;
        chatHistory.forEach(msg => {
          prompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
        });
        requestBody.prompt = prompt;
      }

      // 可选采样参数（仅当配置中显式提供时才写入请求体）
      if (config.top_p !== undefined) {
        const parsedTopP = Number(config.top_p);
        if (!isNaN(parsedTopP)) requestBody.top_p = parsedTopP;
      }
      if (config.frequency_penalty !== undefined) {
        const parsedFreq = Number(config.frequency_penalty);
        if (!isNaN(parsedFreq)) requestBody.frequency_penalty = parsedFreq;
      }
      if (config.presence_penalty !== undefined) {
        const parsedPresence = Number(config.presence_penalty);
        if (!isNaN(parsedPresence)) requestBody.presence_penalty = parsedPresence;
      }

      // API 密钥注入（header 或 body 两种方式）
      if (config.api_key) {
        const trimmedApiKey = config.api_key.trim();
        if (config.api_key_transmission === 'header') {
          requestHeaders['Authorization'] = trimmedApiKey.startsWith('Bearer ')
            ? trimmedApiKey
            : `Bearer ${trimmedApiKey}`;
        } else {
          requestBody.api_key = config.api_key;
        }
      }

      this.setupEventListeners();

      const result = await (window as any).electronAPI.ai.request({
        url: apiUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody,
        timeout: 120000, // 默认 120 秒超时（AI 生成通常较长）
        streaming: true,
      });

      if (!result.success) {
        throw new Error(result.error || 'AI request failed');
      }
    } catch (error) {
      if (this.isCancelled) return;

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.errorCallback?.({
        message: errorMessage,
        type: this.classifyError(errorMessage),
      });
      this.cleanupListeners();
    }
  }

  cancelRequest(): void {
    this.isCancelled = true;
    this.cleanupListeners();

    // 调用主进程的取消请求 API，真正中止 fetch 请求
    if (window.electronAPI?.ai?.cancel) {
      window.electronAPI.ai.cancel().catch(() => {
        // 忽略取消请求的错误
      });
    }
  }

  private setupEventListeners(): void {
    let tempContent = '';
    let lastProcessedLineCount = 0;
    let lastAccumulatedData = '';

    const handleStream = (data: any) => {
      if (this.isCancelled) return;

      if (data.accumulatedData) {
        lastAccumulatedData = data.accumulatedData;
        // 从完整累积数据中只解析新增的 SSE 行
        const lines = data.accumulatedData.split('\n');
        const dataLines = lines.filter(line => line.trim().startsWith('data: ') && line.trim().substring(6).trim() !== '[DONE]');
        
        // 只处理新增的行
        const newLines = dataLines.slice(lastProcessedLineCount);
        lastProcessedLineCount = dataLines.length;
        
        let extractedFromBatch = '';
        for (const line of newLines) {
          const content = this.parseSSEChunk(line);
          if (content) {
            extractedFromBatch += content;
          }
        }
        
        if (extractedFromBatch) {
          tempContent += extractedFromBatch;
          this.streamCallback?.(extractedFromBatch, false);
        }
      } else if (data.chunk) {
        // 兼容旧格式：直接处理 chunk
        const extractedContent = this.parseSSEChunk(data.chunk);
        if (extractedContent) {
          tempContent += extractedContent;
          this.streamCallback?.(extractedContent, false);
        }
      }
    };

    const handleComplete = (data: any) => {
      if (this.isCancelled) return;

      let finalContent = tempContent;

      // 如果流式累积内容不足，尝试从累积的原始 SSE 数据中重新提取全部内容
      if ((!finalContent || finalContent.length < 100) && lastAccumulatedData) {
        const mergedContent = this.parseSSEChunk(lastAccumulatedData);
        if (mergedContent && mergedContent.length > finalContent.length) {
          finalContent = mergedContent;
        }
      }

      // 如果仍不足，尝试从最终响应的 message.content 获取
      if ((!finalContent || finalContent.length < 100) && data.data) {
        if (data.data.choices?.[0]?.message?.content && data.data.choices[0].message.content.length > finalContent.length) {
          finalContent = data.data.choices[0].message.content;
        } else if (data.data.choices?.[0]?.text && data.data.choices[0].text.length > finalContent.length) {
          finalContent = data.data.choices[0].text;
        }
      }

      if (finalContent) {
        const response: AIResponse = {
          content: finalContent,
          finishReason: data.data?.choices?.[0]?.finish_reason || 'stop',
          usage: data.data?.usage,
          id: data.data?.id || '',
        };
        this.completeCallback?.(response);
      }

      this.streamCallback?.('', true);
      this.cleanupListeners();
    };

    const handleError = (error: any) => {
      if (this.isCancelled) return;

      this.errorCallback?.({
        message: error?.message || 'Stream error',
        type: 'unknown',
      });
      this.cleanupListeners();
    };

    this.removeStreamListener = (window as any).electronAPI?.on?.('ai:stream', handleStream);
    this.removeCompleteListener = (window as any).electronAPI?.on?.('ai:stream:complete', handleComplete);
    this.removeErrorListener = (window as any).electronAPI?.on?.('ai:stream:error', handleError);
  }

  private parseSSEChunk(rawChunk: string): string {
    if (!rawChunk || rawChunk.trim().length === 0) return '';

    try {
      let extractedContent = '';
      const dataLineRegex = /^data:\s+(.+)$/gm;
      let match;
      const regex = new RegExp(dataLineRegex);

      while ((match = regex.exec(rawChunk)) !== null) {
        const jsonStr = match[1].trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.choices?.[0]?.delta?.content) {
            extractedContent += parsed.choices[0].delta.content;
          } else if (parsed.choices?.[0]?.message?.content) {
            extractedContent += parsed.choices[0].message.content;
          }
        } catch {
          // Ignore individual JSON parse errors
        }
      }

      if (extractedContent) return extractedContent;

      // Fallback: try parsing as single JSON
      try {
        const parsed = JSON.parse(rawChunk);
        if (parsed.choices?.[0]?.delta?.content) {
          return parsed.choices[0].delta.content;
        }
        if (parsed.choices?.[0]?.message?.content) {
          return parsed.choices[0].message.content;
        }
      } catch {
        // Not JSON, continue to next method
      }

      // Final fallback: extract content field using regex
      const contentMatch = rawChunk.match(/"content"\s*:\s*"([^"]*)"/);
      if (contentMatch && contentMatch[1]) {
        return contentMatch[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
      }

      return '';
    } catch {
      return '';
    }
  }

  private classifyError(message: string): 'network' | 'server' | 'api' | 'validation' | 'unknown' {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('fetch') || lowerMessage.includes('network') || lowerMessage.includes('connect')) {
      return 'network';
    }
    if (lowerMessage.includes('validation') || lowerMessage.includes('invalid')) {
      return 'validation';
    }
    if (lowerMessage.includes('api') || lowerMessage.includes('key') || lowerMessage.includes('auth')) {
      return 'api';
    }
    if (lowerMessage.includes('server') || lowerMessage.includes('5')) {
      return 'server';
    }
    return 'unknown';
  }

  private cleanupListeners(): void {
    if (this.removeStreamListener) {
      try { this.removeStreamListener(); } catch {}
      this.removeStreamListener = null;
    }
    if (this.removeCompleteListener) {
      try { this.removeCompleteListener(); } catch {}
      this.removeCompleteListener = null;
    }
    if (this.removeErrorListener) {
      try { this.removeErrorListener(); } catch {}
      this.removeErrorListener = null;
    }
  }
}
