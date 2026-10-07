import {
  ContentGenerationRequest,
  GeneratedContent,
  WritingError,
  WritingErrorCode,
  NovelType,
  WritingStyle,
  NarrativePerspective,
  ChapterOutline,
  ChapterChunk,
  ChunkStatus,
  GenerationProgress,
  ShardOutline,
  ShardOutlineGenerationRequest,
  ShardOutlineGenerationResult,
  ShardContentGenerationRequest,
  WritingResourceConfig,
  CustomNovelTypeTemplate,
  CustomWritingStyleTemplate
} from '../../../shared/types/writing.types';
import { promptBuilder } from './PromptBuilder';
import { fixChineseQuotes, tryParseJsonWithRepair } from './jsonRepair';
import { HUMANIZER_POLISH_RULES, withHumanizerNovelRules } from '../../../shared/prompts/humanizerPolish';
import { withCustomPrompt } from '../../../shared/prompts/customPrompt';
import { writingResourceManager } from '../WritingResourceManager';
import { aiConfigProvider } from '../ai/AIConfigProvider';
import { addLog, generateNewRequestId } from '../memory/chatLogService';
import { chapterChunkService } from './ChapterChunkService';
import { SSEStreamParser } from '../ai/SSEStreamParser';
import { writingTemplateRepository } from './WritingTemplateRepository';

// 【多模态兼容性审计】本服务使用本地 ChatMessage 类型（content: string），
// 不导入 AIService.ts 的联合类型 ChatMessage，不受多模态 content 扩展影响。
// 所有消息 content 均为纯文本字符串，适用于文本生成/润色等非视觉任务。
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
  /**
   * SSE 流式响应解析器（统一复用，避免本类重复实现 parseSSELine/extractContentFromRawData）
   */
  private readonly streamParser: SSEStreamParser = new SSEStreamParser();

  /** 进行中的章节 AI 味审核（Spec: add-ai-custom-prompt-and-interrupt，writing:cancelDeAiCheck 可中止） */
  private activeDeAiCheckController: AbortController | null = null;

  /** 中止进行中的章节 AI 味审核；返回是否有请求被中止 */
  cancelDeAiCheck(): boolean {
    if (this.activeDeAiCheckController) {
      this.activeDeAiCheckController.abort();
      this.activeDeAiCheckController = null;
      addLog('[章节AI味审核] 用户中止请求', 'warn');
      return true;
    }
    return false;
  }

  buildPrompt(request: ContentGenerationRequest, customNovelTypeTemplate?: CustomNovelTypeTemplate, customWritingStyleTemplate?: CustomWritingStyleTemplate): ChatMessage[] {
    // 去AI味：约束正文行文（默认开启无开关，引擎全局提示词仍由 enrichSystemPrompt 前置拼接）
    const systemPrompt = withHumanizerNovelRules(
      promptBuilder.buildSystemPrompt(
        this.getNovelTypeFromRequest(request),
        this.getStyleFromRequest(request),
        this.getPerspectiveFromRequest(request),
        request.generationParams?.writingStyleContext,
        customNovelTypeTemplate,
        customWritingStyleTemplate
      )
    );

    const resourceContext = this.buildResourceContext(request);
    const chapterSummaries = this.buildChapterSummaries(request);
    const longTermContext = this.buildLongTermContext(request);
    const continuityConstraints = this.buildContinuityConstraints(request);
    const tableContext = this.buildTableContextForPrompt(request);

    // Build user prompt with optional suggestion extensions
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

    // Build base user prompt, then append optional guidance/suggestions
    let finalUserPrompt = userPrompt;

    // Append chunk context for chunked generation
    if (request.previousChunkContent) {
      finalUserPrompt += `\n\n## 前文衔接\n${request.previousChunkContent}`;
    }

    if (request.chunkContext) {
      const { chunkIndex, totalChunks, isLastChunk } = request.chunkContext;
      finalUserPrompt += `\n\n## 分片信息\n`;
      finalUserPrompt += `当前是第 ${chunkIndex + 1}/${totalChunks} 个分片`;
      if (isLastChunk) {
        finalUserPrompt += `（最后一个分片，请确保章节完整收尾）`;
      }
    }

    // Append generationGuidance (persistent) if provided
    if (request.generationGuidance) {
      finalUserPrompt += `\n\n## 章节创作指导\n${request.generationGuidance}`;
    }

    // Append user suggestion if provided (generation mode)
    if (request.userSuggestion) {
      finalUserPrompt += `\n\n## 附加指令\n${request.userSuggestion}`;
    }

    // Append regeneration suggestion if provided (regeneration mode)
    if (request.regenerationSuggestion) {
      const s = request.regenerationSuggestion;
      const parts: string[] = ['\n\n## 重新生成指令'];

      if (request.previousChapterContent) {
        parts.push('\n### 上次生成内容（参考）\n');
        parts.push(this.stripThinkTags(request.previousChapterContent));
      }

      if (s.keepContent) {
        parts.push(`\n### 需保留内容\n${s.keepContent}`);
      }
      if (s.discardContent) {
        parts.push(`\n### 需舍弃内容\n${s.discardContent}`);
      }
      if (s.adjustContent) {
        parts.push(`\n### 需调整内容\n${s.adjustContent}`);
      }
      if (s.addContent) {
        parts.push(`\n### 需新增内容\n${s.addContent}`);
      }

      if (parts.length > 1) {
        finalUserPrompt += parts.join('');
      }
    }

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: finalUserPrompt }
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

    const aiConfig = aiConfigProvider.getAIConfig();
    const baseUrl = aiConfig.baseUrl;
    const apiKey = aiConfig.apiKey;
    const apiKeyTransmission = aiConfig.apiKeyTransmission;
    const engineSystemPrompt = aiConfig.systemPrompt;
    const modelName = aiConfig.modelName || modelConfig.model;

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

    // 加载自定义模板（如有）
    let customNovelTypeTemplate: CustomNovelTypeTemplate | undefined;
    let customWritingStyleTemplate: CustomWritingStyleTemplate | undefined;
    if (request.customNovelTypeId) {
      customNovelTypeTemplate = await writingTemplateRepository.getCustomNovelTypeTemplate(request.customNovelTypeId) || undefined;
    }
    if (request.customWritingStyleId) {
      customWritingStyleTemplate = await writingTemplateRepository.getCustomWritingStyleTemplate(request.customWritingStyleId) || undefined;
    }

    const messages = this.enrichSystemPrompt(this.buildPrompt(request, customNovelTypeTemplate, customWritingStyleTemplate), engineSystemPrompt);
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
          baseUrl, headers, requestBody, abortSignal, onStream
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

        // Handle abort errors - check both DOMException and non-DOMException forms
        const isAbortError = (error instanceof DOMException && error.name === 'AbortError')
          || (typeof (error as Error).message === 'string' && (error as Error).message.toLowerCase().includes('abort'));

        if (isAbortError) {
          addLog(`  请求被中止`, 'warn');
          throw this.createError(WritingErrorCode.CONTENT_GENERATION_FAILED, '请求被中止');
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
    const errorType = lastError ? this.classifyError(lastError) : 'unknown';
    throw this.createError(
      WritingErrorCode.CONTENT_GENERATION_FAILED,
      `AI 流请求最终失败: ${lastError?.message ?? '未知错误'}`,
      (lastError as Error | undefined)?.stack,
      errorType
    );
  }

  private async executeStreamRequest(
    baseUrl: string,
    headers: Record<string, string>,
    requestBody: Record<string, any>,
    abortSignal: AbortSignal,
    onStream: (chunk: string) => void,
    onReasoning?: (chunk: string) => void
  ): Promise<{ content: string; generationTime: number }> {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(
        WritingErrorCode.CONTENT_GENERATION_FAILED,
        `AI 请求失败: ${response.status} ${response.statusText}`,
        errorText
      );
    }

    // SSE 行解析、buffer 拼接、`[DONE]` 跳过、容错回退等逻辑全部委托给 SSEStreamParser
    // 本方法仅负责 fetch + 错误转换 + 将 onStream/onReasoning 桥接到 parser 回调
    const result = await this.streamParser.parseStream(response, onStream, abortSignal, onReasoning);

    console.log('[ContentGenerator] Stream complete:', {
      totalContentLength: result.content.length,
      generationTime: result.generationTime,
      preview: result.content.substring(0, 200)
    });

    // 保持原返回结构（generationTime 由 SSEStreamParser 内部计时返回）
    return { content: result.content, generationTime: result.generationTime };
  }

  /**
   * 分类错误类型
   * @returns 'timeout' | 'network' | 'service' | 'unknown'
   */
  private classifyError(error: Error): 'timeout' | 'network' | 'service' | 'unknown' {
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

  private buildTableContextForPrompt(request: { writingTableData?: ContentGenerationRequest['writingTableData'] }): string {
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

      const headers = writingTableData.headers?.[sheetName] || [];
      const uniqueIdIndex: Map<string, number> = new Map();

      sheetData.forEach((row: Record<string, unknown>, rowIndex: number) => {
        const rowDisplay = rowIndex + 1;
        // 存储约定：key "1" = 唯一id，key k(k≥2) = 表头第 k-1 列，key "0" = 流水号（不展示）
        const uniqueId = row['1'] as string | undefined;

        if (uniqueId) {
          uniqueIdIndex.set(uniqueId, rowDisplay);
        }

        const fields: string[] = [];
        if (uniqueId) {
          fields.push(`唯一id=${uniqueId}`);
        }
        for (let i = 0; i < headers.length; i++) {
          const value = row[String(i + 2)];
          if (value !== undefined && value !== null && String(value) !== '') {
            fields.push(`${headers[i]}=${value}`);
          }
        }
        context += `  行${rowDisplay}: ${fields.join(', ')}\n`;
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

  private createError(
    code: WritingErrorCode,
    message: string,
    details?: string,
    errorType?: 'timeout' | 'network' | 'service' | 'unknown'
  ): WritingError {
    return {
      code,
      message,
      details,
      recoverable: code !== WritingErrorCode.AI_SERVICE_UNAVAILABLE,
      errorType
    };
  }

  /**
   * 剥离内容中的 <think> 标签及其之间的内容
   * 用于重新生成时处理上次生成内容，避免模型复制思考过程
   */
  private stripThinkTags(content: string): string {
    if (!content) return content;
    // 移除所有 <think>...</think> 标签及其之间的内容（支持多行匹配）
    let stripped = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
    // 清理多余的空行（连续两个以上的换行符缩减为两个）
    stripped = stripped.replace(/\n{3,}/g, '\n\n');
    // 去除首尾空白
    stripped = stripped.trim();
    return stripped;
  }

  /**
   * 分片流式生成章节内容
   * 将长章节拆分为多个分片，依次生成并拼接
   * @param outline 章节大纲
   * @param request 生成请求
   * @param modelConfig 模型配置
   * @param onStream 流式回调（每个分片的内容）
   * @param onProgress 进度回调
   * @param abortSignal 中止信号
   */
  async generateChunkStream(
    outline: ChapterOutline,
    request: ContentGenerationRequest,
    modelConfig: ModelConfig,
    onStream: (chunk: string, chunkIndex: number) => void,
    onProgress: (progress: GenerationProgress) => void,
    abortSignal: AbortSignal
  ): Promise<{
    content: string;
    chunks: ChapterChunk[];
    metadata: any;
  }> {
    const startTime = Date.now();
    const targetWords = outline.targetWordCount || request.generationParams.targetWordCount;

    addLog(`[分片生成] 开始 - 目标字数: ${targetWords}`, 'info');

    // 1. 计算分片策略
    const strategy = chapterChunkService.calculateChunkStrategy(targetWords, modelConfig.maxTokens);
    addLog(`[分片生成] 策略: 分片大小=${strategy.chunkSize}, 最大分片数=${strategy.maxChunks}`, 'info');

    // 2. 初始化分片列表
    const chunks: ChapterChunk[] = [];
    for (let i = 0; i < strategy.maxChunks; i++) {
      chunks.push({
        id: `chunk_${Date.now()}_${i}`,
        index: i,
        status: ChunkStatus.PENDING,
        targetWordCount: strategy.chunkSize,
        actualWordCount: 0,
        content: '',
        summary: '',
        checkpoint: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }

    // 3. 依次生成每个分片
    let fullContent = '';
    let completedWords = 0;
    let completedChunks = 0;

    for (let i = 0; i < strategy.maxChunks; i++) {
      if (abortSignal.aborted) {
        addLog(`[分片生成] 用户取消`, 'warn');
        break;
      }

      const chunk = chunks[i];
      chunk.status = ChunkStatus.GENERATING;
      chunk.updatedAt = Date.now();

      addLog(`[分片生成] 生成分片 ${i + 1}/${strategy.maxChunks}`, 'info');

      // 构建当前分片的 prompt
      const chunkPrompt = chapterChunkService.generateChunkPrompt(outline, chunks.slice(0, i), i);

      // 构造分片生成请求
      const chunkRequest: ContentGenerationRequest = {
        ...request,
        chapterInfo: {
          ...request.chapterInfo,
          outline: chunkPrompt
        },
        generationParams: {
          ...request.generationParams,
          targetWordCount: strategy.chunkSize
        }
      };

      // 生成当前分片
      let chunkContent = '';
      const onChunkStream = (text: string) => {
        chunkContent += text;
        onStream(text, i);
      };

      try {
        const result = await this.generateStream(
          chunkRequest,
          modelConfig,
          onChunkStream,
          abortSignal
        );

        // 检测是否被截断
        const truncationCheck = chapterChunkService.detectTruncation(result.content);
        if (truncationCheck.isTruncated) {
          addLog(`[分片生成] 分片 ${i + 1} 被截断，截取到最后一个完整句子`, 'warn');
          chunkContent = result.content.substring(0, truncationCheck.lastSentenceEnd);
        } else {
          chunkContent = result.content;
        }

        // 更新分片状态
        chunk.content = chunkContent;
        chunk.actualWordCount = chunkContent.length;
        chunk.status = ChunkStatus.COMPLETED;
        chunk.updatedAt = Date.now();

        // 生成检查点（最后 200 字）
        chunk.checkpoint = chunkContent.length > 200
          ? chunkContent.substring(chunkContent.length - 200)
          : chunkContent;

        // 注意：摘要生成由前端通过 generateChunkSummary IPC 处理，避免重复生成

        // 更新进度
        fullContent += chunkContent;
        completedWords += chunkContent.length;
        completedChunks++;

        const progress: GenerationProgress = {
          totalWords: targetWords,
          completedWords,
          currentChunkIndex: i,
          totalChunks: strategy.maxChunks,
          completedChunks,
          estimatedTimeRemaining: this.estimateTimeRemaining(startTime, completedWords, targetWords)
        };
        onProgress(progress);

        addLog(`[分片生成] 分片 ${i + 1} 完成 - 字数: ${chunkContent.length}`, 'info');
      } catch (error) {
        addLog(`[分片生成] 分片 ${i + 1} 失败: ${(error as Error).message}`, 'error');
        chunk.status = ChunkStatus.FAILED;
        chunk.updatedAt = Date.now();
        throw error;
      }
    }

    // 4. 返回完整结果
    const generationTime = Date.now() - startTime;
    addLog(`[分片生成] 全部完成 - 总字数: ${fullContent.length}, 耗时: ${generationTime}ms`, 'info');

    return {
      content: fullContent,
      chunks: chunks.filter(c => c.status === ChunkStatus.COMPLETED),
      metadata: {
        model: modelConfig.model,
        temperature: modelConfig.temperature,
        tokensUsed: Math.round(fullContent.length * 0.25),
        generationTime,
        finishReason: 'stop',
        chunkCount: completedChunks
      }
    };
  }

  /**
   * 估算剩余生成时间
   */
  private estimateTimeRemaining(startTime: number, completedWords: number, targetWords: number): number {
    const elapsed = Date.now() - startTime;
    if (completedWords === 0) return 0;

    const wordsPerMs = completedWords / elapsed;
    const remainingWords = targetWords - completedWords;
    return Math.max(0, remainingWords / wordsPerMs);
  }

  /**
   * 根据 WritingResourceConfig 加载参考素材并拼接成 resourceContext
   * 复用 WritingResourceManager 的加载/拼接逻辑。
   * - includeWritingStylesInContext=true: 将写作风格并入 resourceContext（用于分片大纲，无独立 writingStyleContext 入参）
   * - includeWritingStylesInContext=false: 写作风格单独返回 writingStyleContext，resourceContext 仅含世界书/角色卡/用户人设（用于分片内容，与 buildContentPrompt 流程一致）
   */
  private async loadResourceContext(
    resources: WritingResourceConfig,
    includeWritingStylesInContext: boolean
  ): Promise<{ resourceContext: string; writingStyleContext: string }> {
    const worldBookIds = resources.worldBookIds || [];
    const characterCardIds = resources.characterCardIds || [];
    const userPersonaIds = resources.userPersonaIds || [];
    const writingStyleIds = resources.writingStyleIds || [];

    const [worldBooks, characters, userPersonas, writingStyles] = await Promise.all([
      worldBookIds.length > 0 ? writingResourceManager.loadWorldBooks(worldBookIds) : Promise.resolve([]),
      characterCardIds.length > 0 ? writingResourceManager.loadCharacterCards(characterCardIds) : Promise.resolve([]),
      userPersonaIds.length > 0 ? writingResourceManager.loadUserPersonas(userPersonaIds) : Promise.resolve([]),
      writingStyleIds.length > 0 ? writingResourceManager.loadWritingStyles(writingStyleIds) : Promise.resolve([])
    ]);

    const resourceContext = includeWritingStylesInContext
      ? writingResourceManager.buildResourceContextSummary(worldBooks, characters, userPersonas, writingStyles)
      : writingResourceManager.buildResourceContextSummary(worldBooks, characters, userPersonas);

    const writingStyleContext = includeWritingStylesInContext
      ? ''
      : promptBuilder.buildWritingStylePrompt(writingStyles);

    return { resourceContext, writingStyleContext };
  }

  private getNovelTypeFromParams(params: { novelType?: string }): NovelType {
    const novelType = params.novelType || 'web_novel';
    return NovelType[novelType.toUpperCase().replace(/-/g, '_') as keyof typeof NovelType] || NovelType.WEB_NOVEL;
  }

  private getStyleFromParams(params: { style?: string }): WritingStyle {
    const style = params.style || 'serious';
    return WritingStyle[style.toUpperCase() as keyof typeof WritingStyle] || WritingStyle.SERIOUS;
  }

  private getPerspectiveFromParams(params: { perspective?: string }): NarrativePerspective {
    const perspective = params.perspective || 'third_person';
    const perspectiveMap: Record<string, NarrativePerspective> = {
      first_person: NarrativePerspective.FIRST_PERSON,
      third_person: NarrativePerspective.THIRD_PERSON,
      omniscient: NarrativePerspective.OMNISCIENT,
      first: NarrativePerspective.FIRST_PERSON,
      third: NarrativePerspective.THIRD_PERSON
    };
    return perspectiveMap[perspective] || NarrativePerspective.THIRD_PERSON;
  }

  /**
   * 解析分片大纲响应：剥离 think 标签 → 提取 ```json 代码块 → 修复中文引号 →
   * 鲁棒 JSON 解析（直接 parse + 6 种本地 LLM 输出修复策略，见 jsonRepair.ts）。
   * 本地模型输出的 JSON 常带未转义换行/引号/尾逗号，直接 parse 频繁失败，必须走修复链。
   */
  private parseShardOutlines(rawContent: string): ShardOutline[] {
    let jsonStr = this.stripThinkTags(rawContent).trim();

    const patterns = [
      /```(?:json)?\s*([\s\S]*?)```/,
      /```\s*([\s\S]*?)```/,
    ];
    for (const pattern of patterns) {
      const match = jsonStr.match(pattern);
      if (match && match[1]) {
        jsonStr = match[1].trim();
        break;
      }
    }

    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    jsonStr = fixChineseQuotes(jsonStr);

    const parsed = tryParseJsonWithRepair(jsonStr);
    if (parsed === null) {
      throw new Error('分片大纲JSON解析失败：AI 返回格式不正确（已尝试 6 种修复策略），请重试');
    }

    if (!Array.isArray(parsed)) {
      throw new Error('分片大纲应为JSON数组');
    }

    const shards: ShardOutline[] = parsed.map((item: any, idx: number) => ({
      index: typeof item.index === 'number' ? item.index : idx,
      title: String(item.title || `分片${idx + 1}`),
      summary: String(item.summary || ''),
      targetWordCount: typeof item.targetWordCount === 'number' ? item.targetWordCount : 0
    }));

    return shards;
  }

  /**
   * 生成分片大纲（非流式，返回完整 JSON）
   * 复用 executeStreamRequest 收集完整响应，再解析为 ShardOutline[]。
   */
  async generateShardOutline(
    request: ShardOutlineGenerationRequest,
    modelConfig: ModelConfig,
    abortSignal?: AbortSignal
  ): Promise<ShardOutlineGenerationResult> {
    const chapterTitle = request.chapterInfo?.title || 'unknown';
    const chapterIndex = request.chapterInfo?.index ?? request.chapterIndex;

    addLog(`[分片大纲生成] 接收请求 - 章节${chapterIndex}: ${chapterTitle}, 分片数: ${request.shardCount}`, 'debug');

    try {
      const { resourceContext } = await this.loadResourceContext(request.resources, true);
      const tableContext = this.buildTableContextForPrompt(request);
      // 漫画源素材（与角色卡/世界书同级）并入资源上下文
      const fullResourceContext = [
        tableContext
          ? (resourceContext ? resourceContext + '\n\n' + tableContext : tableContext)
          : resourceContext,
        request.mangaReferenceContext,
      ]
        .filter(Boolean)
        .join('\n\n');

      // 末尾追加用户自定义提示词（最高优先级；引擎全局提示词仍由 enrichSystemPrompt 前置拼接）
      const systemPrompt = withCustomPrompt(
        promptBuilder.buildSystemPrompt(
          this.getNovelTypeFromParams(request.generationParams),
          this.getStyleFromParams(request.generationParams),
          this.getPerspectiveFromParams(request.generationParams)
        ),
        request.customPrompt
      );
      const userPrompt = promptBuilder.buildShardOutlinePrompt(
        request.chapterInfo,
        request.shardCount,
        request.generationParams.targetWordCount,
        fullResourceContext,
        request.userSuggestion,
        request.generationGuidance
      );

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      const aiConfig = aiConfigProvider.getAIConfig();
      const baseUrl = aiConfig.baseUrl;
      const apiKey = aiConfig.apiKey;
      const apiKeyTransmission = aiConfig.apiKeyTransmission;
      const engineSystemPrompt = aiConfig.systemPrompt;
      const modelName = aiConfig.modelName || modelConfig.model;

      if (!baseUrl) {
        addLog(`[分片大纲生成] 参数验证失败: 未配置AI服务地址`, 'error');
        return { shards: [], success: false, error: '未配置 AI 服务地址' };
      }

      const enrichedMessages = this.enrichSystemPrompt(messages, engineSystemPrompt);

      addLog(`[分片大纲生成] system prompt长度: ${enrichedMessages[0]?.content?.length || 0}字符`, 'debug');
      addLog(`[分片大纲生成] user prompt长度: ${enrichedMessages[1]?.content?.length || 0}字符`, 'debug');

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const requestBody: Record<string, any> = {
        model: modelName,
        messages: enrichedMessages,
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

      addLog(`[分片大纲生成] AI调用 - 端点: ${baseUrl}/v1/chat/completions, 模型: ${modelName}`, 'debug');

      // 非流式：复用 executeStreamRequest 收集完整响应（onStream 留空）
      const controller = abortSignal ? null : new AbortController();
      const signal = abortSignal || controller!.signal;

      const { content: rawContent } = await this.executeStreamRequest(
        baseUrl, headers, requestBody, signal, () => {}
      );

      addLog(`[分片大纲生成] AI响应完成 - 长度: ${rawContent.length}`, 'debug');

      const shards = this.parseShardOutlines(rawContent);
      addLog(`[分片大纲生成] 解析成功 - 分片数: ${shards.length}`, 'info');

      return { shards, success: true };
    } catch (error) {
      const message = (error as Error).message || '分片大纲生成失败';
      addLog(`[分片大纲生成] 失败: ${message}`, 'error');
      return { shards: [], success: false, error: message };
    }
  }

  /**
   * 流式生成分片内容
   * 携带本章节已生成的所有前置分片完整内容作为上下文，通过 onStream 回调流式输出。
   * 复用 executeStreamRequest 的流式读取逻辑，最终返回内容经过 stripThinkTags 处理。
   */
  async generateShardContent(
    request: ShardContentGenerationRequest,
    modelConfig: ModelConfig,
    onStream: (chunk: string) => void,
    abortSignal: AbortSignal,
    onReasoning?: (chunk: string) => void
  ): Promise<{ content: string; metadata?: any }> {
    const startTime = Date.now();
    const chapterTitle = request.chapterInfo?.title || 'unknown';
    const chapterIndex = request.chapterInfo?.index ?? request.chapterIndex;
    const shardIndex = request.shardIndex;
    const totalShards = request.totalShards;

    addLog(`[分片内容生成] 接收请求 - 章节${chapterIndex}: ${chapterTitle}, 分片 ${shardIndex + 1}/${totalShards}`, 'debug');

    try {
      const { resourceContext, writingStyleContext } = await this.loadResourceContext(request.resources, false);
      const tableContext = this.buildTableContextForPrompt(request);
      // 漫画源素材（与角色卡/世界书同级）并入资源上下文
      const resourceContextWithManga = request.mangaReferenceContext
        ? (resourceContext ? resourceContext + '\n\n' + request.mangaReferenceContext : request.mangaReferenceContext)
        : resourceContext;

      // 去AI味：约束分片正文行文（默认开启无开关，引擎全局提示词仍由 enrichSystemPrompt 前置拼接）
      // 末尾追加用户自定义提示词（最高优先级）
      const systemPrompt = withCustomPrompt(
        withHumanizerNovelRules(
          promptBuilder.buildSystemPrompt(
            this.getNovelTypeFromParams(request.generationParams),
            this.getStyleFromParams(request.generationParams),
            this.getPerspectiveFromParams(request.generationParams),
            writingStyleContext
          )
        ),
        request.customPrompt
      );

      const previousShardContents = request.previousShardContents || '';

      const userPrompt = promptBuilder.buildShardContentPrompt(
        request.shardOutline,
        shardIndex,
        totalShards,
        previousShardContents,
        request.chapterInfo,
        {
          targetWordCount: request.generationParams.targetWordCount,
          style: request.generationParams.style,
          perspective: request.generationParams.perspective,
          writingStyleContext
        },
        { resourceContext: resourceContextWithManga, tableContext },
        request.userSuggestion,
        request.generationGuidance
      );

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      const aiConfig = aiConfigProvider.getAIConfig();
      const baseUrl = aiConfig.baseUrl;
      const apiKey = aiConfig.apiKey;
      const apiKeyTransmission = aiConfig.apiKeyTransmission;
      const engineSystemPrompt = aiConfig.systemPrompt;
      const modelName = aiConfig.modelName || modelConfig.model;

      if (!baseUrl) {
        addLog(`[分片内容生成] 参数验证失败: 未配置AI服务地址`, 'error');
        throw this.createError(WritingErrorCode.AI_SERVICE_UNAVAILABLE, '未配置 AI 服务地址');
      }

      const enrichedMessages = this.enrichSystemPrompt(messages, engineSystemPrompt);

      addLog(`[分片内容生成] system prompt长度: ${enrichedMessages[0]?.content?.length || 0}字符`, 'debug');
      addLog(`[分片内容生成] user prompt长度: ${enrichedMessages[1]?.content?.length || 0}字符`, 'debug');

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const requestBody: Record<string, any> = {
        model: modelName,
        messages: enrichedMessages,
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

      addLog(`[分片内容生成] AI调用 - 端点: ${baseUrl}/v1/chat/completions, 模型: ${modelName}`, 'debug');

      const { content: rawContent } = await this.executeStreamRequest(
        baseUrl, headers, requestBody, abortSignal, onStream, onReasoning
      );

      const strippedContent = this.stripThinkTags(rawContent);
      const generationTime = Date.now() - startTime;

      addLog(`[分片内容生成] AI响应完成 - 长度: ${strippedContent.length}, 耗时: ${generationTime}ms`, 'debug');

      return {
        content: strippedContent,
        metadata: {
          model: modelConfig.model,
          temperature: modelConfig.temperature,
          tokensUsed: Math.round(strippedContent.length * 0.25),
          generationTime,
          finishReason: 'stop',
          shardIndex,
          totalShards
        }
      };
    } catch (error) {
      const isAbortError = (error instanceof DOMException && error.name === 'AbortError')
        || (typeof (error as Error).message === 'string' && (error as Error).message.toLowerCase().includes('abort'));
      if (isAbortError) {
        addLog(`[分片内容生成] 请求被中止`, 'warn');
        throw this.createError(WritingErrorCode.CONTENT_GENERATION_FAILED, '请求被中止');
      }
      addLog(`[分片内容生成] 失败: ${(error as Error).message}`, 'error');
      if (error instanceof this.WritingError) throw error;
      throw this.createError(
        WritingErrorCode.CONTENT_GENERATION_FAILED,
        `分片内容生成失败: ${(error as Error).message}`,
        (error as Error).stack
      );
    }
  }

  /**
   * 章节内容 AI 味审核（与世界书 AI 审核 / 漫画大纲 AI 审核同一交互模式）：
   * 用 humanizer 完整规则集（27 种 AI 写作模式 + RP AI 腔词表）审读章节正文，
   * 输出严格 JSON：是否通过 + 审核说明（引用原句定位）+ 问题清单 + 修订后全文。
   */
  async checkChapterDeAi(
    params: {
      chapterTitle: string;
      content: string;
      modelConfig: ModelConfig;
      /** 用户自定义审核要求（可选），注入 system prompt 末尾（最高优先级） */
      customPrompt?: string;
    },
    /** 过程流式增量（chunk=正文增量，reasoning=思考流增量），供前端弹窗实时展示 */
    onProgress?: (chunk: string, reasoning: string) => void
  ): Promise<{ passed: boolean; comment: string; issues: string[]; revisedContent: string }> {
    const { chapterTitle, content, modelConfig, customPrompt } = params;

    // 注册中止句柄（writing:cancelDeAiCheck 可中止，含空正文重试的两次请求）
    const abortController = new AbortController();
    this.activeDeAiCheckController = abortController;
    const cleanupDeAiAbort = () => {
      if (this.activeDeAiCheckController === abortController) {
        this.activeDeAiCheckController = null;
      }
    };
    const aiConfig = aiConfigProvider.getAIConfig();
    const baseUrl = aiConfig.baseUrl;
    const apiKey = aiConfig.apiKey;
    const apiKeyTransmission = aiConfig.apiKeyTransmission;
    const engineSystemPrompt = aiConfig.systemPrompt;
    const modelName = aiConfig.modelName || modelConfig.model;

    if (!baseUrl) {
      throw this.createError(WritingErrorCode.AI_SERVICE_UNAVAILABLE, '未配置 AI 服务地址');
    }

    // 引擎全局提示词前置拼接（与所有 AI 功能一致的全局约定）
    const systemPrompt = `${engineSystemPrompt ? engineSystemPrompt + '\n\n' : ''}你是一位资深中文网文编辑，擅长识别 AI 生成文本的痕迹并将其改写为自然的人味文字。请严格按照以下规则审读章节内容，并输出严格的 JSON 审核结果。
${HUMANIZER_POLISH_RULES}

## 审核维度
1. AI 味（重点）：对照规则逐条扫描——公式化结构、三段式、浮夸空话、模板情绪、陈词滥调比喻、"X说"堆砌、散文化叙述等
2. 小说性：是否以剧情/动作/对话驱动（而非散文式铺陈）
3. 内容完整性：修订时不得丢失原有剧情信息与人物设定

## 输出要求
只返回如下 JSON（不要输出任何其他文字、不要代码块包裹）：
{
  "passed": true 或 false,
  "comment": "审核说明：引用原文具体句子指出 AI 味位置与问题（通过时简要说明通过理由，不超过100字）",
  "issues": ["问题1", "问题2"],
  "revisedContent": "修订后完整文本（passed 为 true 时原样返回原文；为 false 时返回去 AI 味后的完整修订版，保持剧情信息不丢失）"
}`;
    // 末尾追加用户自定义审核要求（最高优先级）
    const systemPromptFinal = withCustomPrompt(systemPrompt, customPrompt);

    const userPrompt = `## 章节标题
${chapterTitle}

## 章节内容
${content}

请按审核维度逐条审读上述章节内容，输出 JSON 审核结果。`;

    addLog(`[章节AI味审核] 开始 - 章节: ${chapterTitle}, 内容长度: ${content.length}`, 'debug');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // 不写 max_tokens（由服务端按模型上限取最大值）：思考模型的思考流 + 正文共享预算，
    // 手动估算容易不够导致正文被截断为空
    const requestBody: Record<string, any> = {
      model: modelName,
      messages: [
        { role: 'system', content: systemPromptFinal },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
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

    // 思考模型偶发把 max_tokens 全部耗在思考流上导致正文为空：最多重试 1 次
    // 共享同一个 AbortController（writing:cancelDeAiCheck 可中止任意一次尝试）
    let rawContent = '';
    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const res = await this.executeStreamRequest(
          baseUrl,
          headers,
          requestBody,
          abortController.signal,
          (chunk) => onProgress?.(chunk, ''),
          (reasoning) => onProgress?.('', reasoning)
        );
        rawContent = res.content;
        if (rawContent.trim()) break;
        addLog(`[章节AI味审核] 正文为空（思考流占满输出长度），第 ${attempt}/2 次`, 'warn');
        if (attempt === 1) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        throw this.createError(
          WritingErrorCode.CONTENT_GENERATION_FAILED,
          'AI 思考流占满了输出长度，审核正文为空，请重试'
        );
      }
    } catch (error) {
      // 用户中止：抛出带 cancelled 标记的错误，由 handler 转成 { success:false, cancelled:true }
      if (abortController.signal.aborted) {
        const cancelError = new Error('用户已停止');
        (cancelError as any).cancelled = true;
        throw cancelError;
      }
      throw error;
    } finally {
      cleanupDeAiAbort();
    }

    // 解析：剥离 think 标签 → 提取代码块 → 修复中文引号 → 鲁棒 JSON 解析
    let jsonStr = this.stripThinkTags(rawContent).trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      jsonStr = codeBlockMatch[1].trim();
    }
    jsonStr = fixChineseQuotes(jsonStr);

    const parsed = tryParseJsonWithRepair(jsonStr);
    if (parsed === null || typeof parsed !== 'object') {
      throw this.createError(
        WritingErrorCode.CONTENT_GENERATION_FAILED,
        'AI 味审核结果解析失败，请重试'
      );
    }

    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map((i: any) => String(i)).filter(Boolean)
      : [];
    const result = {
      passed: parsed.passed === true,
      comment: String(parsed.comment || ''),
      issues,
      revisedContent: String(parsed.revisedContent || content),
    };

    addLog(`[章节AI味审核] 完成 - passed: ${result.passed}, issues: ${issues.length}`, 'debug');
    return result;
  }
}

export const contentGenerator = new ContentGenerator();
