import {
  ContentGenerationRequest,
  GeneratedContent,
  WritingError,
  WritingErrorCode,
  NovelType,
  WritingStyle,
  NarrativePerspective
} from '../../../shared/types/writing.types';
import { promptBuilder } from './PromptBuilder';
import { getStorageService } from '../storageService';
import { addLog, generateNewRequestId, getCurrentRequestId } from '../memory/chatLogService';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

export class ContentGenerator {
  buildPrompt(request: ContentGenerationRequest): ChatMessage[] {
    const systemPrompt = promptBuilder.buildSystemPrompt(
      this.getNovelTypeFromRequest(request),
      this.getStyleFromRequest(request),
      this.getPerspectiveFromRequest(request),
      request.generationParams?.writingStyleContext
    );

    const resourceContext = this.buildResourceContext(request);
    const chapterSummaries = this.buildChapterSummaries(request);
    const longTermContext = this.buildLongTermContext(request);
    const continuityConstraints = this.buildContinuityConstraints(request);
    const tableContext = this.buildTableContextForPrompt(request);

    const userPrompt = promptBuilder.buildContentPrompt(
      request.chapterInfo,
      {
        resourceContext,
        recentChapters: '',
        chapterSummaries,
        longTermContext,
        continuityConstraints,
        tableContext
      },
      request.generationParams
    );

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
  }

  async generateStream(
    request: ContentGenerationRequest,
    modelConfig: ModelConfig,
    onStream: (chunk: string) => void,
    abortSignal: AbortSignal
  ): Promise<GeneratedContent> {
    const requestId = generateNewRequestId();
    const chapterTitle = request.chapterInfo?.title || 'unknown';
    const chapterIndex = request.chapterInfo?.index ?? -1;

    addLog(`[Stage 1/6] 接收请求 - 章节${chapterIndex}: ${chapterTitle}`, 'debug');
    addLog(`  项目ID: ${request.projectId || 'N/A'}`, 'debug');
    addLog(`  章节索引: ${chapterIndex}`, 'debug');
    addLog(`  章节标题: ${chapterTitle}`, 'debug');
    addLog(`  前序章节数量: ${request.previousChapters?.length || 0}`, 'debug');
    addLog(`  角色卡数量: ${request.characterContext?.length || 0}`, 'debug');
    addLog(`  世界书数量: ${request.worldBookContext?.length || 0}`, 'debug');
    addLog(`  用户人设数量: ${(request as any).userPersonaContext?.length || 0}`, 'debug');
    addLog(`  知识库数量: ${(request as any).knowledgeContext?.length || 0}`, 'debug');

    const baseUrl = await this.getBaseUrl();
    const apiKey = await this.getApiKey();
    const apiKeyTransmission = await this.getApiKeyTransmission();
    const modelName = await this.getModelName(modelConfig.model);
    const engineSystemPrompt = await this.getEngineSystemPrompt();

    addLog(`[Stage 2/6] 参数验证`, 'debug');
    addLog(`  baseUrl: ${baseUrl || '(未配置)'}`, 'debug');
    addLog(`  apiKey: ${apiKey ? '***已配置***' : '(未配置)'}`, 'debug');
    addLog(`  apiKey传输方式: ${apiKeyTransmission}`, 'debug');
    addLog(`  modelName: ${modelName}`, 'debug');
    addLog(`  temperature: ${modelConfig.temperature}`, 'debug');
    addLog(`  maxTokens: ${modelConfig.maxTokens}`, 'debug');
    console.log('[ContentGenerator] max_tokens parameter in request body:', modelConfig.maxTokens);

    if (!baseUrl) {
      addLog(`[Stage 2/6] 参数验证失败: 未配置AI服务地址`, 'error');
      throw this.createError(WritingErrorCode.AI_SERVICE_UNAVAILABLE, '未配置 AI 服务地址');
    }

    const messages = this.enrichSystemPrompt(this.buildPrompt(request), engineSystemPrompt);
    const promptString = messages.map(m => `[${m.role}]\n${m.content}`).join('\n\n---\n\n');

    addLog(`[Stage 3/6] 提示词生成`, 'debug');
    addLog(`  消息数量: ${messages.length} (system + user)`, 'debug');
    addLog(`  system prompt长度: ${messages[0]?.content?.length || 0}字符`, 'debug');
    addLog(`  user prompt长度: ${messages[1]?.content?.length || 0}字符`, 'debug');
    addLog(`  完整提示词:`, 'debug');
    addLog(promptString, 'debug');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const requestBody: Record<string, any> = {
      model: modelName,
      messages,
      temperature: modelConfig.temperature,
      max_tokens: modelConfig.maxTokens,
      stream: true,
    };

    if (apiKey) {
      if (apiKeyTransmission === 'header') {
        const authValue = apiKey.trim().startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
        headers['Authorization'] = authValue;
      } else {
        requestBody.api_key = apiKey;
      }
    }

    addLog(`[Stage 4/6] AI调用 - 开始请求`, 'debug');
    addLog(`  端点: ${baseUrl}/v1/chat/completions`, 'debug');
    addLog(`  请求体(model, temperature, max_tokens, stream, messages count): ${JSON.stringify({
      model: modelName,
      temperature: modelConfig.temperature,
      max_tokens: modelConfig.maxTokens,
      stream: true,
      messages_count: messages.length
    })}`, 'debug');

    let fullContent = '';
    const startTime = Date.now();

    // 动态超时: >8192 token 使用 300s, 否则 120s
    const timeoutMs = modelConfig.maxTokens > 8192 ? 300_000 : 120_000;

    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const backoffMs = Math.pow(2, attempt - 1) * 1000;
        addLog(`  第 ${attempt} 次重试，等待 ${backoffMs}ms...`, 'debug');
        await new Promise<void>(resolve => setTimeout(resolve, backoffMs));

        if (abortSignal.aborted) {
          addLog(`  请求已取消`, 'warn');
          throw this.createError(WritingErrorCode.CONTENT_GENERATION_FAILED, '操作已被取消');
        }
      }

      try {
        fullContent = '';
        const result = await this.executeStreamRequest(
          baseUrl, headers, requestBody, timeoutMs,
          abortSignal, onStream
        );
        fullContent = result.content;

        const generationTime = Date.now() - startTime;

        addLog(`[Stage 5/6] 结果处理 - AI响应成功`, 'debug');
        addLog(`  章节: ${chapterIndex} - ${chapterTitle}`, 'debug');
        addLog(`  生成内容(完整): ${fullContent}`, 'debug');
        addLog(`  生成内容长度: ${fullContent.length}字符`, 'debug');
        addLog(`  生成耗时: ${generationTime}ms`, 'debug');
        addLog(`  估算token: ${Math.round(fullContent.length * 0.25)}`, 'debug');
        addLog(`  模型: ${modelName}`, 'debug');

        return {
          chapter: {
            index: request.chapterInfo.index,
            title: request.chapterInfo.title,
            wordCount: fullContent.length
          },
          content: fullContent,
          metadata: {
            model: modelConfig.model,
            temperature: modelConfig.temperature,
            tokensUsed: Math.round(fullContent.length * 0.25),
            generationTime,
            finishReason: 'stop'
          },
          continuity: {
            foreshadowing: [],
            plotThreads: [],
            characterDevelopment: []
          }
        };
      } catch (error) {
        lastError = error as Error;

        if (error instanceof DOMException && error.name === 'AbortError') {
          addLog(`  请求超时或被取消`, 'error');
          throw this.createError(WritingErrorCode.CONTENT_GENERATION_FAILED, '请求超时或被取消');
        }

        const isTransient = this.isTransientError(error as Error);
        if (!isTransient || attempt === maxRetries) {
          addLog(`[Stage 5/6] 结果处理 - AI请求失败: ${(error as Error).message}`, 'error');
          if (error instanceof this.WritingError) throw error;
          throw this.createError(
            WritingErrorCode.CONTENT_GENERATION_FAILED,
            `AI 流请求失败: ${(error as Error).message}`,
            (error as Error).stack
          );
        }

        addLog(`  流中断 (${isTransient ? '可重试' : '不可重试'}) - 第 ${attempt + 1}/${maxRetries + 1} 次: ${(error as Error).message}`, 'warn');
      }
    }

    addLog(`[Stage 5/6] 结果处理 - 最终失败: ${lastError?.message}`, 'error');
    throw this.createError(
      WritingErrorCode.CONTENT_GENERATION_FAILED,
      `AI 流请求最终失败: ${lastError?.message ?? '未知错误'}`
    );
  }

  private async executeStreamRequest(
    baseUrl: string,
    headers: Record<string, string>,
    requestBody: Record<string, any>,
    timeoutMs: number,
    abortSignal: AbortSignal,
    onStream: (chunk: string) => void
  ): Promise<{ content: string; generationTime: number }> {
    const startTime = Date.now();

    // 合并用户取消信号与超时信号
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = AbortSignal.any([abortSignal, timeoutSignal]);

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: combinedSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(
        WritingErrorCode.CONTENT_GENERATION_FAILED,
        `AI 请求失败: ${response.status} ${response.statusText}`,
        errorText
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw this.createError(
        WritingErrorCode.CONTENT_GENERATION_FAILED,
        '无法获取响应流'
      );
    }

    const decoder = new TextDecoder('utf-8');
    let fullContent = '';
    let buffer = '';
    let lastProcessedLineCount = 0;

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
                      onStream(content);
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
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:') || trimmed.substring(6).trim() === '[DONE]') {
            continue;
          }

          const jsonStr = trimmed.substring(6).trim();
          if (!jsonStr) continue;

          try {
            const chunkData = JSON.parse(jsonStr);
            if (chunkData.choices?.[0]) {
              const content = chunkData.choices[0].delta?.content || chunkData.choices[0].message?.content || '';
              if (content) {
                fullContent += content;
                onStream(content);
              }
            }
          } catch {
            // 忽略不完整行的解析错误
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // 回退提取: 仅记录日志，不再调用 onStream 避免重复
    if (fullContent.length < 100 && buffer.length > 0) {
      const fallbackContent = this.extractContentFromRawData(buffer);
      if (fallbackContent.length > fullContent.length) {
        console.log('[ContentGenerator] Using fallback content extraction (length:', fallbackContent.length, ')');
        fullContent = fallbackContent;
      }
    }

    const generationTime = Date.now() - startTime;

    console.log('[ContentGenerator] Stream complete:', {
      totalContentLength: fullContent.length,
      preview: fullContent.substring(0, 200)
    });

    return { content: fullContent, generationTime };
  }

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

  private WritingError = class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'WritingError';
    }
  };

  private buildResourceContext(request: ContentGenerationRequest): string {
    const hasWorldBooks = request.worldBookContext && request.worldBookContext.length > 0;
    const hasCharacters = request.characterContext && request.characterContext.length > 0;
    const hasPersonas = request.userPersonaContext && request.userPersonaContext.length > 0;
    const hasKnowledge = request.knowledgeContext && request.knowledgeContext.length > 0;

    if (!hasWorldBooks && !hasCharacters && !hasPersonas && !hasKnowledge) {
      return '';
    }

    const parts: string[] = [];

    if (hasCharacters) {
      parts.push('## 角色信息');
      for (const char of request.characterContext) {
        parts.push(`### ${char.name}`);
        if (char.description) parts.push(`描述: ${char.description}`);
        if (char.personality) parts.push(`性格: ${char.personality}`);
        if (char.mesExample) parts.push(`对话示例:\n${char.mesExample}`);
      }
    }

    if (hasWorldBooks) {
      parts.push('## 世界观设定');
      for (const wb of request.worldBookContext) {
        parts.push(`### ${wb.entryName}`);
        if (wb.keywords && wb.keywords.length > 0) {
          parts.push(`关键词: ${wb.keywords.join('、')}`);
        }
        if (wb.content) {
          parts.push(wb.content);
        }
      }
    }

    if (hasPersonas) {
      parts.push('## 用户人设');
      for (const persona of request.userPersonaContext!) {
        parts.push(`### ${persona.name}`);
        if (persona.description) parts.push(`描述: ${persona.description}`);
        if (persona.traits && persona.traits.length > 0) {
          parts.push(`特征: ${persona.traits.join('、')}`);
        }
      }
    }

    if (hasKnowledge) {
      parts.push('## 知识库参考');
      for (const item of request.knowledgeContext!) {
        parts.push(`### ${item.title}`);
        parts.push(item.content);
      }
    }

    return parts.join('\n');
  }

  private buildChapterSummaries(request: ContentGenerationRequest): string {
    const summaries = request.previousChapters.filter(ch => ch.summary);
    if (summaries.length === 0) return '';

    const parts: string[] = ['## 所有章节概要'];
    for (const ch of summaries) {
      parts.push(`- 第${ch.index + 1}章 ${ch.title}: ${ch.summary}`);
    }

    return parts.join('\n');
  }

  private buildLongTermContext(_request: ContentGenerationRequest): string {
    return '';
  }

  private buildContinuityConstraints(request: ContentGenerationRequest): string {
    const constraints = request.generationParams.constraints || [];
    if (constraints.length === 0) return '';

    return `## 连贯性约束\n${constraints.join('\n')}`;
  }

  private buildTableContextForPrompt(request: ContentGenerationRequest): string {
    if (!request.writingTableData) {
      return '';
    }

    const { writingTableData } = request;
    const sheets = writingTableData.sheets || [];
    if (sheets.length === 0) {
      return '';
    }

    let context = `## 历史剧情表格数据（重要参考资料）\n`;
    context += `以下表格记录了之前章节中已建立的角色、物品、事件、地点等关键信息，请在创作时作为参考，确保剧情走向和细节与前文一致。\n\n`;

    sheets.forEach((sheetName: string, sheetIndex: number) => {
      const tableIndex = sheetIndex + 1;
      context += `=== ${sheetName} (表格索引: ${tableIndex}) ===\n`;
      context += `表格用途：${writingTableData.sheetDescriptions?.[sheetName] || '暂无描述'}\n`;

      const sheetData = writingTableData.data?.[sheetName] || [];
      if (sheetData.length === 0) {
        context += `当前数据：暂无数据\n\n`;
        return;
      }

      context += `当前已有数据（共${sheetData.length}条）：\n`;

      const uniqueIdIndex: Map<string, number> = new Map();

      sheetData.forEach((row: Record<string, unknown>, rowIndex: number) => {
        const rowDisplay = rowIndex + 1;
        const uniqueId = row['唯一id'] as string | undefined;

        if (uniqueId) {
          uniqueIdIndex.set(uniqueId, rowDisplay);
        }

        const fields = Object.entries(row)
          .filter(([key]) => key !== '0')
          .map(([key, value]) => {
            const headerIndex = parseInt(key) + 1;
            const headerName = writingTableData.headers?.[sheetName]?.[parseInt(key) - 2] || `字段${headerIndex}`;
            return `${headerName}=${value}`;
          })
          .join(', ');
        context += `  行${rowDisplay}: ${fields}\n`;
      });

      if (uniqueIdIndex.size > 0) {
        context += `\n【唯一ID快速查找索引】\n`;
        uniqueIdIndex.forEach((rowNum, uniqueId) => {
          context += `  ${uniqueId} → 行${rowNum}\n`;
        });
      }

      context += '\n';
    });

    return context;
  }

  private getNovelTypeFromRequest(request: ContentGenerationRequest): NovelType {
    const novelType = request.generationParams.novelType || 'web_novel';
    return NovelType[novelType.toUpperCase().replace(/-/g, '_') as keyof typeof NovelType] || NovelType.WEB_NOVEL;
  }

  private getStyleFromRequest(request: ContentGenerationRequest): WritingStyle {
    const style = request.generationParams.style || 'serious';
    return WritingStyle[style.toUpperCase() as keyof typeof WritingStyle] || WritingStyle.SERIOUS;
  }

  private getPerspectiveFromRequest(request: ContentGenerationRequest): NarrativePerspective {
    const perspective = request.generationParams.perspective || 'third_person';
    const perspectiveMap: Record<string, NarrativePerspective> = {
      first_person: NarrativePerspective.FIRST_PERSON,
      third_person: NarrativePerspective.THIRD_PERSON,
      omniscient: NarrativePerspective.OMNISCIENT,
      first: NarrativePerspective.FIRST_PERSON,
      third: NarrativePerspective.THIRD_PERSON
    };
    return perspectiveMap[perspective] || NarrativePerspective.THIRD_PERSON;
  }

  private async getBaseUrl(): Promise<string | undefined> {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      
      console.log('[ContentGenerator] getBaseUrl - settings structure:', {
        hasAiEngines: !!settings?.aiEngines,
        aiEnginesCount: settings?.aiEngines?.length || 0,
        aiBaseUrl: settings?.ai?.baseUrl,
        rawBaseUrl: settings?.baseUrl
      });
      
      const engines = settings?.aiEngines || [];
      if (engines.length > 0) {
        const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
        const url = activeEngine?.api_url;
        console.log('[ContentGenerator] getBaseUrl - using engine:', activeEngine?.name, 'url:', url);
        return url;
      }
      
      return settings?.ai?.baseUrl || settings?.ai?.apiBaseUrl || settings?.baseUrl;
    } catch (error) {
      console.error('[ContentGenerator] getBaseUrl error:', error);
      return undefined;
    }
  }

  private async getApiKey(): Promise<string | undefined> {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      
      const engines = settings?.aiEngines || [];
      if (engines.length > 0) {
        const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
        const key = activeEngine?.api_key;
        console.log('[ContentGenerator] getApiKey - using engine:', activeEngine?.name, 'hasKey:', !!key);
        return key;
      }
      
      return settings?.ai?.apiKey || settings?.ai?.apiToken || settings?.apiKey;
    } catch (error) {
      console.error('[ContentGenerator] getApiKey error:', error);
      return undefined;
    }
  }

  private async getApiKeyTransmission(): Promise<string> {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      
      const engines = settings?.aiEngines || [];
      if (engines.length > 0) {
        const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
        const transmission = activeEngine?.api_key_transmission || 'body';
        console.log('[ContentGenerator] getApiKeyTransmission - using:', transmission);
        return transmission;
      }
      
      return 'body';
    } catch (error) {
      console.error('[ContentGenerator] getApiKeyTransmission error:', error);
      return 'body';
    }
  }

  private async getEngineSystemPrompt(): Promise<string> {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      
      const engines = settings?.aiEngines || [];
      if (engines.length > 0) {
        const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
        const prompt = activeEngine?.system_prompt || '';
        if (prompt) {
          console.log('[ContentGenerator] getEngineSystemPrompt - using engine system prompt, length:', prompt.length);
        }
        return prompt;
      }
      
      return '';
    } catch (error) {
      console.error('[ContentGenerator] getEngineSystemPrompt error:', error);
      return '';
    }
  }

  private enrichSystemPrompt(messages: ChatMessage[], engineSystemPrompt: string): ChatMessage[] {
    if (!engineSystemPrompt || !engineSystemPrompt.trim()) {
      return messages;
    }
    
    const enriched = messages.map((msg, index) => {
      if (index === 0 && msg.role === 'system') {
        return {
          role: 'system' as const,
          content: engineSystemPrompt.trim() + '\n\n' + msg.content
        };
      }
      return msg;
    });
    
    return enriched;
  }

  private extractContentFromRawData(rawData: string): string {
    let extracted = '';

    // Strategy 1: Regex match all data: lines
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

    // Strategy 2: If still no content, try regex extraction of content field
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

  private async getModelName(fallbackModel: string): Promise<string> {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      
      const engines = settings?.aiEngines || [];
      if (engines.length > 0) {
        const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
        const engineModel = activeEngine?.model_name;
        if (engineModel) {
          console.log('[ContentGenerator] getModelName - using engine model:', engineModel, '(fallback was:', fallbackModel, ')');
          return engineModel;
        }
      }
      
      console.log('[ContentGenerator] getModelName - no engine model found, using fallback:', fallbackModel);
      return fallbackModel;
    } catch (error) {
      console.error('[ContentGenerator] getModelName error:', error);
      return fallbackModel;
    }
  }

  private createError(
    code: WritingErrorCode,
    message: string,
    details?: string
  ): WritingError {
    return {
      code,
      message,
      details,
      recoverable: code !== WritingErrorCode.AI_SERVICE_UNAVAILABLE
    };
  }
}

export const contentGenerator = new ContentGenerator();
