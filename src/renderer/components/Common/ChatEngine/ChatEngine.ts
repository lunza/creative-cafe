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
  AIResponse,
  resolveStopForRequestBody,
  buildSamplingExtras
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
      // max_tokens=0 表示不限制最大 token 数，此时不发送 max_tokens 字段，由后端/模型决定
      const maxTokens = (typeof config.max_tokens === 'number' && config.max_tokens > 0)
        ? config.max_tokens
        : undefined;
      const temperature = Number(config.temperature) ?? 0.8;
      const apiMode = config.api_mode || 'chat_completion';

      const requestBody: any = {
        model: config.model_name,
        temperature,
        stream: true,
      };
      // 仅当 max_tokens 有有效值时才注入请求体；为 0/undefined 时不发送，让后端使用默认行为
      if (maxTokens !== undefined) {
        requestBody.max_tokens = maxTokens;
      }

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

      // DRY 采样 + repetition_penalty 注入（Spec: optimize-chat-ai-intelligence / Task 6.5）
      // 借鉴 SillyTavern textgen-settings.js:143 作为防重复采样层第二道防线。
      // buildSamplingExtras 根据 capabilities.supportsRepPen / supportsDrySampler 决定是否注入：
      //   - supportsRepPen=true → 注入 repetition_penalty（缺省 1.1）
      //   - supportsDrySampler=true → 注入 dry_multiplier/dry_base/dry_allowed_length/no_repeat_ngram_size
      //   - 为 false 时省略对应字段，避免向后端发送不支持参数导致 4xx 错误
      const samplingExtras = buildSamplingExtras(config, config.capabilities);
      for (const [key, value] of Object.entries(samplingExtras)) {
        requestBody[key] = value;
      }

      // ============================================================
      // 能力感知：思维链参数注入（Spec: upgrade-ai-handler-multimodal-compatibility / Task 3.2）
      // ============================================================
      // 能力感知逻辑：思维链参数仅在"双条件"同时满足时才注入请求体：
      //   1. enable_chain_of_thought === true（用户在引擎设置中启用了思维链）
      //   2. capabilities.supportsThinking === true（模型探测支持思维链/推理）
      // 触发条件：双条件判断（用户配置 + 模型能力），缺一不可。
      // 兼容性考量（降级策略）：
      //   - 若 enable_chain_of_thought=true 但 supportsThinking!==true：模型不支持思维链，
      //     此时【不注入】任何思维链参数，保持纯文本聊天，避免向后端发送不支持字段导致 4xx 错误。
      //   - 若 enable_chain_of_thought 未启用：用户未开启，自然不注入。
      // 注入字段 `enable_thinking: true` 为 OpenAI 兼容后端常见思维链开关（如 Qwen3 系列）；
      // 具体字段名取决于模型 API，supportsThinking 探测成功即认为后端可识别该参数。
      const thinkingEnabled =
        config.enable_chain_of_thought === true &&
        config.capabilities?.supportsThinking === true;
      if (thinkingEnabled) {
        requestBody.enable_thinking = true;
      }

      // ============================================================
      // 能力感知：工具/函数调用一致性守卫（Spec: upgrade-ai-handler-multimodal-compatibility / Task 3.4）
      // ============================================================
      // 一致性要求：use_function_calling 必须与 supportsToolCalling 保持一致。
      //   - use_function_calling=true 且 supportsToolCalling=true  → 工具调用生效
      //   - use_function_calling=true 但 supportsToolCalling!==true → 禁用工具调用（模型不支持，降级为纯文本聊天）
      //   - use_function_calling 未启用                            → 不启用工具调用
      // 当前 ChatEngine 走纯文本聊天流程，不构造 OpenAI tools 数组，因此此处不向请求体注入 tools 字段；
      // 仅在此处记录能力一致性判断结果，为后续接入 tools 字段预留正确的双条件判断点。
      // 当用户开启 use_function_calling 但模型不支持时，应静默降级而非报错，保证聊天功能正常运行。
      const toolCallingEnabled =
        config.use_function_calling === true &&
        config.capabilities?.supportsToolCalling === true;
      // 注：toolCallingEnabled 当前不直接驱动请求体字段（纯文本聊天无 tools）；
      // 若后续接入 tools 数组，必须在此处用同样的双条件守卫，未满足时跳过 tools 注入。
      void toolCallingEnabled;

      // Stop sequences 防抢话（Spec: optimize-chat-ai-intelligence / Task 3.2 + 3.3）
      // 借鉴 SillyTavern names_as_stop_strings 机制，注入用户名变体停止序列，
      // 防止 AI 代替用户发言（生成 "\n用户: ..." 等下一条用户消息）。
      // resolveStopForRequestBody 根据 supportsStopArray 决定传数组或字符串。
      const stopFieldValue = resolveStopForRequestBody(config.stopSequences, config.capabilities);
      if (stopFieldValue !== undefined) {
        requestBody.stop = stopFieldValue;
        // 后端仅支持字符串时记录日志（取首元素，其余丢弃）
        if (
          Array.isArray(config.stopSequences) &&
          config.stopSequences.length > 1 &&
          config.capabilities?.supportsStopArray === false
        ) {
          console.warn(
            `[ChatEngine] Backend does not support stop array; using first stop string only: ${JSON.stringify(config.stopSequences[0])}`
          );
        }
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
        timeout: 300000, // 默认 300 秒超时（AI 生成通常较长）
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

      // 【重点标记】修复：即使 finalContent 为空也必须调用 completeCallback，
      // 否则 hooks.ts 的 onComplete 永远不会触发，消息状态停留在 "sending"，
      // UI 永远显示"正在生成中"。
      if (!finalContent) {
        console.warn('[ChatEngine] handleComplete: finalContent is empty, calling completeCallback with empty content to prevent UI stuck');
      }

      const response: AIResponse = {
        content: finalContent || '',
        finishReason: data.data?.choices?.[0]?.finish_reason || 'stop',
        usage: data.data?.usage,
        id: data.data?.id || '',
      };
      this.completeCallback?.(response);

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
