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
      // 【F2 修复 - 消息序号/完整性校验】
      // 原实现仅过滤 system 角色，未校验内容完整性、状态与角色合法性，
      // 导致 error 状态消息、空内容消息、非法 role 会被一并送入后端，
      // 引发 4xx 或模型行为漂移。此处统一清洗：
      //   1. 剔除 system（systemPrompt 单独注入，不进 chatHistory）
      //   2. 剔除 status='error' 的失败消息（避免把错误内容回灌给模型）
      //   3. 剔除空内容（trim 后为空）的消息
      //   4. 仅保留 role ∈ {user, assistant}，其余角色跳过并警告
      //   5. content 强制 String 化，防止 undefined/null/对象传入后端
      const chatHistory = this.sanitizeChatHistory(messages);

      // ============================================================
      // Task 16.2: 智能体模式（agentModeActive）运行时开关
      // ============================================================
      // 当 agentModeActive=true && supportsToolCalling=true 时，对话走 AgentCore.run()
      // （通过 agent:run IPC），AI 可自主调用对话组工具：
      //   - searchWorldbook：向量检索世界书
      //   - searchHistory：搜索对话历史
      //   - updateStateTable：更新状态表
      //   - addMemoryNote：记录记忆笔记
      //
      // 降级保护：
      //   1. agentModeActive 未启用 → 旧路径（streamChatAPI）
      //   2. supportsToolCalling !== true → 旧路径（模型不支持工具调用）
      //   3. AgentCore 异常 → 自动回退旧路径（catch 中继续执行旧逻辑）
      const useAgentEnabled =
        config.agentModeActive === true &&
        config.capabilities?.supportsToolCalling === true;

      if (useAgentEnabled) {
        try {
          await this.runViaAgentCore(chatHistory, systemPrompt, config);
          return; // AgentCore 路径成功完成，直接返回
        } catch (agentErr) {
          // 降级：AgentCore 失败时回退到旧 streamChatAPI 路径
          const agentErrMsg = agentErr instanceof Error ? agentErr.message : String(agentErr);
          console.warn('[ChatEngine] Agent mode failed, falling back to direct streamChatAPI:', agentErrMsg);
          if (this.isCancelled) return;
          // 继续执行下方的旧路径（不 return）
        }
      }

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
      // max_tokens 配置值表示上下文窗口大小，非 API 输出限制，不发送给 API
      // 让 API 自行使用模型默认的最大输出长度
      const maxTokens = undefined;
      const temperature = Number(config.temperature) ?? 0.8;

      const requestBody: any = {
        model: config.model_name,
        temperature,
        stream: true,
      };
      // 仅当 max_tokens 有有效值时才注入请求体；为 0/undefined 时不发送，让后端使用默认行为
      if (maxTokens !== undefined) {
        requestBody.max_tokens = maxTokens;
      }

      requestBody.messages = [
        { role: 'system', content: systemPrompt },
        ...chatHistory,
      ];

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
      if (config.top_k !== undefined) {
        const parsedTopK = Number(config.top_k);
        if (!isNaN(parsedTopK)) requestBody.top_k = parsedTopK;
      }
      if (config.min_p !== undefined) {
        const parsedMinP = Number(config.min_p);
        if (!isNaN(parsedMinP)) requestBody.min_p = parsedMinP;
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
      // 当用户开启 use_function_calling 但模型不支持时，应静默降级而非报错，保证聊天功能正常运行。
      const toolCallingEnabled =
        config.use_function_calling === true &&
        config.capabilities?.supportsToolCalling === true;

      // 【F1 修复 - 工具调用全链路注入】
      // toolCallingEnabled 现已真正驱动 tools 字段注入。三条件守卫：
      //   1. toolCallingEnabled（use_function_calling && supportsToolCalling）
      //   2. config.tools 为非空数组
      // 满足时注入 tools / tool_choice='auto' / parallel_tool_calls=false（默认禁用并行，
      // 简化后续 agentLoop 处理）。任一条件不满足则跳过，请求体与修复前完全一致（降级保护）。
      //
      // 当前阶段工具集来源：config.tools 由调用方（CharacterDialogueChat.hooks）透传，
      // 底座尚未落地时为 undefined → 跳过注入，保持纯文本聊天。
      // 后续 agent 底座接入时只需在调用方填充 config.tools 即可打通完整链路：
      //   supportsToolCalling 探测 → toolCallingEnabled 判定 → tools 注入请求体
      //   → 流式响应 tool_calls 解析 → handleComplete 回传 toolCalls → agentLoop 执行
      const availableTools = Array.isArray(config.tools) ? config.tools : [];
      if (toolCallingEnabled && availableTools.length > 0) {
        requestBody.tools = availableTools;
        requestBody.tool_choice = 'auto';
        // 默认禁用并行工具调用：简化后续 agentLoop 顺序执行，避免并发状态同步问题
        requestBody.parallel_tool_calls = false;
      }

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
        timeout: undefined, // 由主进程读取用户设置的 request_timeout
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

    // 【F6 修复 - 取消失败时回传前端错误】
    // 原实现 .catch(() => {}) 静默吞掉取消失败，导致前端无法感知
    // "取消操作本身失败"的异常（如主进程 IPC 通道断开），用户会以为
    // 已取消但请求仍在后台跑。现改为：取消失败时通过 errorCallback 回传，
    // 让 UI 能提示"取消失败，请稍后重试或检查应用状态"。
    // 注：electronAPI.ai 类型未声明 cancel（动态注入），用 as any 绕过类型检查，
    // 运行时守卫 window.electronAPI?.ai?.cancel 已保证安全。
    const aiCancel = (window as any).electronAPI?.ai?.cancel;
    if (aiCancel) {
      Promise.resolve(aiCancel()).catch((cancelErr: unknown) => {
        const errMsg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
        console.warn('[ChatEngine] Cancel request failed:', errMsg);
        this.errorCallback?.({
          message: `取消请求失败: ${errMsg}`,
          type: 'network',
        });
      });
    }

    // Task 16.2: 智能体模式取消（agent:cancel IPC）
    const agentCancel = (window as any).electronAPI?.agent?.cancel;
    if (agentCancel) {
      Promise.resolve(agentCancel()).catch((cancelErr: unknown) => {
        const errMsg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
        console.warn('[ChatEngine] Agent cancel failed:', errMsg);
      });
    }
  }

  // ============================================================
  // Task 16.2: 智能体模式（AgentCore）路径
  // ============================================================

  /** agent:token 事件取消订阅函数 */
  private removeAgentTokenListener: (() => void) | null = null;
  /** agent:done 事件取消订阅函数 */
  private removeAgentDoneListener: (() => void) | null = null;

  /**
   * 通过 AgentCore 运行对话（智能体模式）。
   *
   * 流程：
   *  1. 订阅 agent:token / agent:done 事件
   *  2. 调用 agent:run IPC（传入 systemPrompt + messages + context）
   *  3. agent:token 事件 → streamCallback（边生成边推送 UI）
   *  4. agent:run 返回 → completeCallback（最终结果）
   *
   * 降级保护：此方法抛出的异常由调用方（sendMessage）捕获并回退旧路径。
   */
  private async runViaAgentCore(
    chatHistory: Array<{ role: string; content: string }>,
    systemPrompt: string,
    config: AIEngineConfig
  ): Promise<void> {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.agent?.run) {
      throw new Error('Agent API not available in electronAPI');
    }

    // 构建对话上下文（供工具使用）
    const context = {
      mode: 'dialogue' as const,
      characterId: (config as any).characterId,
      sessionId: (config as any).sessionId,
    };

    // 订阅 token 流
    let accumulatedContent = '';
    this.removeAgentTokenListener = electronAPI.agent.onToken(
      (data: { chunk: string; timestamp: number }) => {
        if (this.isCancelled) return;
        accumulatedContent += data.chunk;
        this.streamCallback?.(data.chunk, false);
      }
    );

    // 订阅完成事件（用于日志与异常检测，主要完成逻辑在 agent:run 返回后处理）
    this.removeAgentDoneListener = electronAPI.agent.onDone(
      (data: { finishReason: string; iterations: number; error?: string; timestamp: number }) => {
        if (data.error) {
          console.warn('[ChatEngine] Agent done with error:', data.error);
        }
      }
    );

    try {
      // 调用 agent:run
      const result = await electronAPI.agent.run({
        systemPrompt,
        messages: chatHistory.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
        context,
        maxIterations: 8,
        timeoutMs: 300000,
      });

      if (this.isCancelled) return;

      if (!result.success) {
        throw new Error(result.error || 'Agent run failed');
      }

      // 推送最终内容（若 token 流未完整覆盖）
      const finalContent = result.result?.content || accumulatedContent;
      if (finalContent && !accumulatedContent) {
        // token 流为空时直接推送完整内容（非流式降级）
        this.streamCallback?.(finalContent, false);
      }

      // 回调完成
      this.completeCallback?.({
        content: finalContent,
        finishReason: result.result?.finishReason || 'stop',
        usage: result.result?.usage as any,
        id: `agent-${Date.now()}`,
        toolCalls: undefined, // agent 模式工具调用已在主进程执行，无需回传
      });
    } finally {
      // 清理事件订阅
      this.removeAgentTokenListener?.();
      this.removeAgentDoneListener?.();
      this.removeAgentTokenListener = null;
      this.removeAgentDoneListener = null;
    }
  }

  /**
   * 清洗对话历史，剔除非法/不完整消息（F2 修复）。
   *
   * 校验规则：
   *  1. 剔除 system 角色（systemPrompt 单独注入请求体）
   *  2. 剔除 status='error' 的失败消息（避免错误内容污染模型上下文）
   *  3. 剔除空内容（trim 后为空）的消息
   *  4. 仅保留 role ∈ {user, assistant}，其余角色跳过并警告
   *  5. content 强制 String 化
   *
   * @param messages 原始消息数组
   * @returns 清洗后的 chatHistory（{role, content}）
   */
  private sanitizeChatHistory(
    messages: ChatMessage[]
  ): Array<{ role: string; content: string }> {
    const history: Array<{ role: string; content: string }> = [];

    for (const msg of messages) {
      // 1. 剔除 system
      if (msg.role === 'system') continue;

      // 2. 剔除 error 状态消息
      if (msg.status === 'error') {
        console.warn('[ChatEngine] F2: Dropping message with error status:', msg.id);
        continue;
      }

      // 3. 剔除空内容
      const content = String(msg.content ?? '');
      if (content.trim().length === 0) {
        console.warn('[ChatEngine] F2: Dropping message with empty content:', msg.id);
        continue;
      }

      // 4. 仅保留 user / assistant
      if (msg.role !== 'user' && msg.role !== 'assistant') {
        console.warn(`[ChatEngine] F2: Dropping message with invalid role '${msg.role}':`, msg.id);
        continue;
      }

      // 5. 加入清洗后历史
      history.push({ role: msg.role, content });
    }

    return history;
  }

  private setupEventListeners(): void {
    let tempContent = '';
    let lastProcessedLineCount = 0;
    let lastAccumulatedData = '';
    // 【F1 修复 - 工具调用全链路注入】
    // 累积流式 tool_calls delta 分片。OpenAI 协议中 tool_calls 跨多个 chunk 到达：
    //   - 首个分片含 id / type / function.name，arguments 为空串或起始片段
    //   - 后续分片仅含 function.arguments 字符串片段（按 index 对齐）
    //   - 末尾分片可能伴随 finish_reason='tool_calls'
    // 由 mergeToolCallDelta 按 index 合并，handleComplete 时回传到 AIResponse.toolCalls。
    const accumulatedToolCalls: any[] = [];

    const handleStream = (data: any) => {
      if (this.isCancelled) return;

      if (data.accumulatedData) {
        lastAccumulatedData = data.accumulatedData;
        // 从完整累积数据中只解析新增的 SSE 行
        const lines: string[] = String(data.accumulatedData).split('\n');
        const dataLines = lines.filter((line: string) => line.trim().startsWith('data: ') && line.trim().substring(6).trim() !== '[DONE]');

        // 只处理新增的行
        const newLines = dataLines.slice(lastProcessedLineCount);
        lastProcessedLineCount = dataLines.length;

        let extractedFromBatch = '';
        for (const line of newLines) {
          const content = this.parseSSEChunk(line);
          if (content) {
            extractedFromBatch += content;
          }
          // 【F1 修复】累积 tool_calls delta（与 content 解析并行，互不影响）
          const toolCallsDelta = this.parseSSELineToolCalls(line);
          if (toolCallsDelta) {
            this.mergeToolCallDelta(accumulatedToolCalls, toolCallsDelta);
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
        // 【F1 修复】旧格式 chunk 也需累积 tool_calls
        const toolCallsDelta = this.parseSSELineToolCalls(data.chunk);
        if (toolCallsDelta) {
          this.mergeToolCallDelta(accumulatedToolCalls, toolCallsDelta);
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

      // 【F1 修复 - 工具调用全链路注入】
      // 回传累积的 tool_calls 到 AIResponse。当 finishReason='tool_calls' 时调用方应消费此字段。
      // 当前阶段仅记录日志，不执行工具（执行循环是后续 agentLoop 的事，见 spec 阶段 5）。
      // 优先取流式累积结果；若流式未捕获到但最终 data.data 含 message.tool_calls（部分后端
      // 在非流式回包中提供完整 tool_calls），则回退到 data.data。
      const finalToolCalls = accumulatedToolCalls.length > 0
        ? accumulatedToolCalls
        : (data.data?.choices?.[0]?.message?.tool_calls ?? undefined);
      if (finalToolCalls && finalToolCalls.length > 0) {
        console.info(
          '[ChatEngine] Received tool_calls (execution deferred to agentLoop):',
          JSON.stringify(finalToolCalls, null, 2)
        );
      }

      const response: AIResponse = {
        content: finalContent || '',
        finishReason: data.data?.choices?.[0]?.finish_reason || 'stop',
        usage: data.data?.usage,
        id: data.data?.id || '',
        toolCalls: finalToolCalls,
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

  /**
   * 解析 SSE 单行数据，提取 tool_calls delta 数组。
   *
   * 【F1 修复 - 工具调用全链路注入】
   * parseSSEChunk 仅返回 content 字符串，无法承载 tool_calls。本方法为 tool_calls 专用解析，
   * 与 parseSSEChunk 并行调用（接受同一 SSE 行）。每个 delta 形如：
   *   { index: 0, id?: 'call_xxx', type?: 'function', function: { name?: 'foo', arguments?: '{"a":' } }
   *
   * @param line 单行 SSE 数据或原始 chunk
   * @returns tool_calls delta 数组；非 data 行 / 无 tool_calls / 解析失败返回 null
   */
  private parseSSELineToolCalls(line: string): any[] | null {
    if (!line || line.trim().length === 0) return null;
    try {
      // 复用 parseSSEChunk 的 data: 行提取逻辑，但解析目标为 tool_calls
      const dataLineRegex = /^data:\s+(.+)$/gm;
      let match;
      let accumulated: any[] | null = null;
      const regex = new RegExp(dataLineRegex);

      while ((match = regex.exec(line)) !== null) {
        const jsonStr = match[1].trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta?.tool_calls;
          if (delta && Array.isArray(delta)) {
            accumulated = accumulated ? accumulated.concat(delta) : delta.slice();
          }
        } catch {
          // 忽略单行 JSON 解析错误
        }
      }

      if (accumulated) return accumulated;

      // Fallback: 直接 JSON 解析（非 SSE 格式的 chunk）
      try {
        const parsed = JSON.parse(line);
        const delta = parsed.choices?.[0]?.delta?.tool_calls;
        if (delta && Array.isArray(delta)) return delta;
      } catch {
        // 非 JSON，忽略
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * 将 tool_calls delta 分片合并到累积数组中（按 index 对齐）。
   *
   * 【F1 修复 - 工具调用全链路注入】
   * OpenAI 流式协议中 tool_calls 跨多个 chunk 到达，需按 delta.index 累积：
   *   - id / type / function.name 取首个非空值（通常在第一个分片到达）
   *   - function.arguments 字符串拼接（分片逐步到达，最终为完整 JSON 字符串）
   * 完成后累积数组结构：[{ id, type: 'function', function: { name, arguments } }]
   *
   * @param accumulator 累积数组（按 delta.index 对齐）
   * @param delta 当前分片的 tool_calls 数组
   */
  private mergeToolCallDelta(accumulator: any[], delta: any[]): void {
    for (const tc of delta) {
      const idx = typeof tc.index === 'number' ? tc.index : accumulator.length;
      if (!accumulator[idx]) {
        accumulator[idx] = {
          id: '',
          type: tc.type || 'function',
          function: { name: '', arguments: '' },
        };
      }
      if (tc.id) accumulator[idx].id = tc.id;
      if (tc.type) accumulator[idx].type = tc.type;
      if (tc.function?.name) accumulator[idx].function.name += tc.function.name;
      if (tc.function?.arguments) accumulator[idx].function.arguments += tc.function.arguments;
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
    // Task 16.2: 清理 agent 模式事件订阅
    if (this.removeAgentTokenListener) {
      try { this.removeAgentTokenListener(); } catch {}
      this.removeAgentTokenListener = null;
    }
    if (this.removeAgentDoneListener) {
      try { this.removeAgentDoneListener(); } catch {}
      this.removeAgentDoneListener = null;
    }
  }
}
