import {
  OutlineGenerationRequest,
  OutlineGenerationResult,
  GeneratedOutline,
  ChapterOutline,
  WritingError,
  WritingErrorCode,
  ChainOfThought,
  CustomNovelTypeTemplate,
  CustomWritingStyleTemplate
} from '../../../shared/types/writing.types';
import { promptBuilder } from './PromptBuilder';
import { fixChineseQuotes, tryParseJsonWithRepair } from './jsonRepair';
import { writingResourceManager } from '../WritingResourceManager';
import { aiConfigProvider } from '../ai/AIConfigProvider';
import { SSEStreamParser } from '../ai/SSEStreamParser';

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

export class OutlineGenerator {
  private streamChunkCallback: ((chunk: string) => void) | null = null;
  /**
   * SSE 流式响应解析器（统一复用，避免本类重复实现 parseSSELine/extractContentFromRawData）
   */
  private readonly streamParser: SSEStreamParser = new SSEStreamParser();

  onStreamChunk(callback: (chunk: string) => void): void {
    this.streamChunkCallback = callback;
  }

  buildPrompt(request: OutlineGenerationRequest & { 
    _resourceContext?: string; 
    _writingStyleContext?: string;
    _customNovelTypeTemplate?: CustomNovelTypeTemplate;
    _customWritingStyleTemplate?: CustomWritingStyleTemplate;
  }): ChatMessage[] {
    const writingStyleContext = request._writingStyleContext || '';
    const systemPrompt = promptBuilder.buildSystemPrompt(
      request.parameters.novelType,
      request.parameters.writingStyle || this.getDefaultStyle(request.parameters.novelType),
      request.parameters.narrativePerspective,
      writingStyleContext,
      request._customNovelTypeTemplate,
      request._customWritingStyleTemplate
    );

    const resourceContext = request._resourceContext || '';
    const userPrompt = promptBuilder.buildOutlinePrompt(
      request.parameters.creativeDescription,
      request.resources,
      request.parameters,
      resourceContext,
      writingStyleContext,
      request._customNovelTypeTemplate,
      request._customWritingStyleTemplate
    );

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
  }

  async generate(
    messages: ChatMessage[],
    modelConfig: ModelConfig,
    abortSignal?: AbortSignal
  ): Promise<OutlineGenerationResult> {
    const aiConfig = aiConfigProvider.getAIConfig();
    const baseUrl = aiConfig.baseUrl;
    const apiKey = aiConfig.apiKey;
    const apiKeyTransmission = aiConfig.apiKeyTransmission;
    const engineSystemPrompt = aiConfig.systemPrompt;
    const modelName = aiConfig.modelName || modelConfig.model;

    if (!baseUrl) {
      throw this.createError(WritingErrorCode.AI_SERVICE_UNAVAILABLE, '未配置 AI 服务地址');
    }

    const enrichedMessages = this.enrichSystemPrompt(messages, engineSystemPrompt);

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

    console.log('[OutlineGenerator] Full request debug:', {
      baseUrl,
      fullUrl: `${baseUrl}/v1/chat/completions`,
      apiKeyTransmission,
      apiKeyLength: apiKey?.length || 0,
      apiKeyPreview: apiKey ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}` : 'none',
      modelName,
      requestBodyModel: requestBody.model,
      hasApiKeyInBody: 'api_key' in requestBody,
    });
    console.log('[OutlineGenerator] Request body keys:', Object.keys(requestBody));

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OutlineGenerator] API error response:', errorText);
      throw this.createError(
        WritingErrorCode.OUTLINE_GENERATION_FAILED,
        `AI 请求失败: ${response.status} ${response.statusText}`,
        errorText
      );
    }

    console.log('[OutlineGenerator] Starting stream read...');
    const rawContent = await this.readStreamResponse(response, abortSignal);
    console.log('[OutlineGenerator] Raw AI response (length):', rawContent.length);
    console.log('[OutlineGenerator] Raw AI response (preview):', rawContent.substring(0, 500));

    if (!rawContent && !abortSignal?.aborted) {
      throw this.createError(
        WritingErrorCode.OUTLINE_GENERATION_FAILED,
        'AI 返回内容为空'
      );
    }

    // Extract CoT data before parsing the outline
    const { textWithoutCoT, chainOfThought } = this.extractChainOfThought(rawContent, modelName);

    try {
      const outline = this.parseOutlineResponse(textWithoutCoT);
      return { outline, rawContent, chainOfThought };
    } catch (parseError) {
      console.error('[OutlineGenerator] Parse failed but raw content preserved, length:', rawContent.length);
      const error = parseError instanceof Error ? parseError : new Error(String(parseError));
      (error as any).rawContent = rawContent;
      (error as any).chainOfThought = chainOfThought;
      throw error;
    }
  }

  /**
   * Extract Chain of Thought data from AI response.
   * Supports two formats:
   * 1. Wrapped in <RichMediaReference>...</RichMediaReference> tags
   * 2. Contained in a `thinking_process` key in the JSON response
   */
  private extractChainOfThought(rawContent: string, model: string): { textWithoutCoT: string; chainOfThought?: ChainOfThought } {
    let textWithoutCoT = rawContent;
    let cotRawData = '';

    // Strategy 1: Extract <RichMediaReference>...</RichMediaReference> tags
    const richMediaRegex = /<RichMediaReference>([\s\S]*?)<\/RichMediaReference>/gi;
    const richMediaMatches = rawContent.match(richMediaRegex);
    if (richMediaMatches && richMediaMatches.length > 0) {
      // Extract content between tags
      for (const match of richMediaMatches) {
        const contentMatch = match.match(/<RichMediaReference>([\s\S]*?)<\/RichMediaReference>/i);
        if (contentMatch && contentMatch[1]) {
          cotRawData += contentMatch[1].trim() + '\n';
        }
      }
      // Remove RichMediaReference tags from the text
      textWithoutCoT = rawContent.replace(richMediaRegex, '').trim();
      console.log('[OutlineGenerator] Extracted CoT from RichMediaReference tags, length:', cotRawData.length);
    }

    // Strategy 2: Try to parse JSON and check for thinking_process field
    let jsonStr = textWithoutCoT.trim();
    // Strip code fences if present
    const codeFenceRegex = /```(?:json)?\s*([\s\S]*?)```/;
    const codeFenceMatch = jsonStr.match(codeFenceRegex);
    if (codeFenceMatch && codeFenceMatch[1]) {
      jsonStr = codeFenceMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.thinking_process) {
        const thinkingProcess = typeof parsed.thinking_process === 'string'
          ? parsed.thinking_process
          : JSON.stringify(parsed.thinking_process, null, 2);
        cotRawData += (cotRawData ? '\n' : '') + thinkingProcess;
        // Remove thinking_process from the JSON to avoid interference with outline parsing
        delete parsed.thinking_process;
        textWithoutCoT = '```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
        console.log('[OutlineGenerator] Extracted CoT from thinking_process field, length:', thinkingProcess.length);
      }
    } catch {
      // Not valid JSON, skip this strategy
    }

    if (!cotRawData.trim()) {
      return { textWithoutCoT: rawContent };
    }

    const chainOfThought: ChainOfThought = {
      rawData: cotRawData.trim(),
      formattedData: cotRawData.trim(),
      timestamp: Date.now(),
      model
    };

    return { textWithoutCoT, chainOfThought };
  }

  /**
   * 读取流式响应并累积完整内容
   *
   * 实现说明：
   * - SSE 行解析、buffer 拼接、`[DONE]` 跳过、容错回退等逻辑全部委托给 `SSEStreamParser`
   * - 本方法仅负责将 `streamChunkCallback` 桥接到 parser 的 onChunk 回调
   * - 行为与原 readStreamResponse 一致：实时回调 + 返回完整内容
   */
  private async readStreamResponse(response: Response, abortSignal?: AbortSignal): Promise<string> {
    const onChunk = (chunk: string) => {
      if (this.streamChunkCallback) {
        this.streamChunkCallback(chunk);
      }
    };

    const result = await this.streamParser.parseStream(response, onChunk, abortSignal);

    console.log('[OutlineGenerator] Stream complete:', {
      extractedContentLength: result.content.length,
      generationTime: result.generationTime,
      preview: result.content.substring(0, 200)
    });

    return result.content;
  }

  parseOutlineResponse(response: string): GeneratedOutline {
    let jsonStr = response.trim();
    
    const patterns = [
      /```(?:json)?\s*([\s\S]*?)```/,
      /```\s*([\s\S]*?)```/,
      /^```([\s\S]*?)```$/m,
    ];
    
    for (const pattern of patterns) {
      const match = jsonStr.match(pattern);
      if (match && match[1]) {
        jsonStr = match[1].trim();
        console.log('[OutlineGenerator] Extracted JSON from code fence, length:', jsonStr.length);
        break;
      }
    }
    
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    // 修复 AI 返回的中文引号问题
    jsonStr = fixChineseQuotes(jsonStr);

    console.log('[OutlineGenerator] Parsing JSON (length:', jsonStr.length, ')');
    console.log('[OutlineGenerator] JSON preview:', jsonStr.substring(0, 200));

    // 直接 parse + 6 种本地 LLM 输出修复策略（共享模块 jsonRepair，与分片大纲解析复用同一套）
    const parsed = tryParseJsonWithRepair(jsonStr);
    if (parsed !== null) {
      this.normalizeChapters(parsed);
      return this.validateOutline(parsed);
    }

    // 所有 JSON 修复策略失败：内容可能是非 JSON 的结构化大纲
    //（如漫画解析模式的「生成故事大纲」产出 Markdown 大纲），回退按标题解析
    try {
      const mdData = this.parseMarkdownOutline(response);
      if (mdData) {
        console.log('[OutlineGenerator] Markdown fallback parse succeeded, chapters:', mdData.chapters.length);
        return this.validateOutline(mdData);
      }
    } catch (mdError) {
      console.log('[OutlineGenerator] Markdown fallback parse failed:', mdError instanceof Error ? mdError.message : String(mdError));
    }

    // All fixes failed, throw with raw content attached
    console.error('[OutlineGenerator] All JSON fix strategies failed');
    const error = this.createError(
      WritingErrorCode.OUTLINE_GENERATION_FAILED,
      '大纲解析失败，AI 返回的内容格式不正确',
      `JSON parsing failed. Response length: ${response.length}`
    );
    (error as any).rawContent = response;
    throw error;
  }

  /**
   * Markdown 格式大纲的兜底解析（非 JSON 内容）
   *
   * 适用场景：漫画解析模式的「生成故事大纲」产出 Markdown 大纲，
   * 而非 V2 管线的 JSON 大纲。
   *
   * ⚠️ 关键区分（v2 修复「章节解析出 33 个章节」）：AI 大纲常是结构化格式，
   * 含「故事背景 / 主要角色 / 剧情发展」等元信息小节——这些不能当章节。
   * 分类规则（按优先级）：
   * 1. 首个单 # 标题 → 作品名（suggestedTitle）
   * 2. 强章节模式（第X章/节/回/卷/集/幕、Chapter N、情节X）→ 剧情章节
   * 3. 元信息关键词（背景/世界观/角色/人物/剧情/主题/梗概等）→ 元信息区，
   *    其正文按「角色类」或「故事类」归桶（不丢内容，但不进章节列表）；
   *    元信息区下的嵌套子标题（级别更深，如角色名）继承该区归类
   * 4. 其余标题（编号项「1./一、」或语义化标题）→ 剧情章节
   * 未识别出任何章节时返回 null（由调用方保留原错误）。
   * 解析结果经 validateOutline 统一规范化后返回。
   */
  private parseMarkdownOutline(text: string): {
    workInfo: Record<string, unknown>;
    storyLine: Record<string, unknown>;
    chapters: Array<Record<string, unknown>>;
  } | null {
    const lines = text.split(/\r?\n/);
    const chapters: Array<{ title: string; summary: string }> = [];
    let suggestedTitle = '';
    const prefaceLines: string[] = [];
    // 元信息区归桶：characters（角色/人物类）与 story（背景/主题/主线类）
    const metaText: { characters: string[]; story: string[] } = { characters: [], story: [] };
    let current: { title: string; body: string[] } | null = null;
    // 当前元信息区上下文（遇到剧情章节或更高层级标题时重置）
    let metaBucket: 'characters' | 'story' | null = null;
    let metaLevel = 0;

    const flush = () => {
      if (current) {
        chapters.push({ title: current.title, summary: current.body.join('\n').trim() });
        current = null;
      }
    };

    // 强章节模式：明确的章节编号样式（优先级高于元信息关键词，
    // 避免「第二章：背景揭露」这类含元信息词的章节被误判）
    const STRONG_CHAPTER = /第[0-9一二三四五六七八九十百千]+[章节回卷集幕]|chapter\s*[0-9一二三四五六七八九十]+|情节\s*[0-9一二三四五六七八九十百千]+/i;
    // 元信息关键词：背景/设定/角色/剧情框架等非剧情章节的小节
    const META_KEYWORDS = /背景|世界观|设定|主题|梗概|简介|概述|主线|基调|题材|风格|类型|角色|人物|主角|配角|资料|档案|总结|结语|说明|剧情|情节|大纲/;
    const META_CHARACTERS = /角色|人物|主角|配角/;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // 标题识别：Markdown 标题 / 「第X章」样式独立行（兼容加粗包裹）
      let headingTitle: string | null = null;
      let headingLevel = 0;
      const mdHeading = line.match(/^(#{1,6})\s+(.+)$/);
      if (mdHeading) {
        headingTitle = mdHeading[2].trim();
        headingLevel = mdHeading[1].length;
      } else {
        const bold = line.match(/^\*\*(.+?)\*\*$/);
        const candidate = (bold ? bold[1] : line).trim();
        if (/^第[0-9一二三四五六七八九十百千]+[章节回卷]/.test(candidate)) {
          headingTitle = candidate;
        }
      }

      if (headingTitle !== null) {
        flush();
        if (headingLevel === 1 && !suggestedTitle && chapters.length === 0) {
          // 首个单 # 标题视为作品标题而非章节
          suggestedTitle = headingTitle;
          metaBucket = null;
          metaLevel = 0;
          continue;
        }
        const isStrongChapter = STRONG_CHAPTER.test(headingTitle);
        const isMetaKeyword = !isStrongChapter && META_KEYWORDS.test(headingTitle);
        // 元信息区下的嵌套子标题（级别更深）继承该区归类（如「## 主要角色」下的「### 角色名」）
        const isMetaChild = metaBucket !== null && headingLevel > metaLevel;
        if (isStrongChapter || (!isMetaKeyword && !isMetaChild)) {
          // 剧情章节（强编号 / 弱编号 / 语义化标题）
          current = { title: headingTitle, body: [] };
          metaBucket = null;
          metaLevel = 0;
        } else {
          // 元信息区：标题与后续正文归入对应桶
          const bucket: 'characters' | 'story' = META_CHARACTERS.test(headingTitle)
            ? 'characters'
            : metaBucket ?? 'story';
          if (isMetaKeyword && !isMetaChild) {
            metaBucket = bucket;
            metaLevel = headingLevel;
          }
          metaText[bucket].push(headingTitle);
          current = null;
        }
      } else if (current) {
        current.body.push(line);
      } else if (metaBucket) {
        metaText[metaBucket].push(line);
      } else {
        prefaceLines.push(line);
      }
    }
    flush();

    if (chapters.length === 0) return null;

    const join = (arr: string[]) => arr.join('\n').trim();
    const preface = join(prefaceLines);
    const storyMeta = join(metaText.story);
    const characterMeta = join(metaText.characters);
    return {
      workInfo: {
        suggestedTitle: suggestedTitle || prefaceLines[0] || '',
        chapterCount: chapters.length,
      },
      storyLine: {
        // 前言 + 背景/主题/角色类元信息 → 故事主线说明（元信息保留不丢失，但不进章节列表）
        coreConflict: [preface, storyMeta, characterMeta].filter(Boolean).join('\n'),
      },
      chapters: chapters.map((ch) => ({ title: ch.title, summary: ch.summary })),
    };
  }

  /**
   * 规范化 chapters 字段：如果 AI 返回的是单个对象而非数组，则包装为数组
   * 这是为了处理当 chapterCount=1 时，AI 可能返回 "chapters": {...} 而非 "chapters": [{...}] 的情况
   */
  private normalizeChapters(data: any): void {
    if (data.chapters && !Array.isArray(data.chapters)) {
      console.log('[OutlineGenerator] chapters is not an array, wrapping in array');
      data.chapters = [data.chapters];
    }
  }

  private validateOutline(data: any): GeneratedOutline {
    if (!data.workInfo || !data.storyLine || !data.chapters) {
      throw new Error('大纲缺少必要字段');
    }

    if (!Array.isArray(data.chapters) || data.chapters.length === 0) {
      throw new Error('大纲中未定义章节');
    }

    // Generate unique indices to prevent duplicates
    // If chapters already have indices, we'll ensure they're unique and sequential
    const assignedIndices = new Set<number>();
    const uniqueChapters = data.chapters.map((ch: any, idx: number) => {
      let index = ch.index || idx + 1;
      
      // If the proposed index is already taken, find the next available one
      while (assignedIndices.has(index)) {
        index++;
      }
      
      assignedIndices.add(index);
      
      return {
        index,
        title: ch.title || `第${index}章`,
        summary: ch.summary || '',
        keyPlotPoints: ch.keyPlotPoints || [],
        characters: ch.characters || [],
        scenes: ch.scenes || [],
        suspensePoints: ch.suspensePoints || [],
        targetWordCount: ch.targetWordCount || 3000
      };
    });

    const outline: GeneratedOutline = {
      workInfo: {
        suggestedTitle: data.workInfo.suggestedTitle || '未命名',
        novelType: data.workInfo.novelType || 'web_novel',
        estimatedWordCount: data.workInfo.estimatedWordCount || 10000,
        chapterCount: data.workInfo.chapterCount || 10,
        isComplete: data.workInfo.isComplete === false ? false : true
      },
      storyLine: {
        coreConflict: data.storyLine.coreConflict || '',
        storyArc: {
          beginning: data.storyLine.storyArc?.beginning || '',
          development: data.storyLine.storyArc?.development || '',
          climax: data.storyLine.storyArc?.climax || '',
          resolution: data.storyLine.storyArc?.resolution || ''
        },
        theme: data.storyLine.theme || ''
      },
      chapters: uniqueChapters,
      characterRelationships: data.characterRelationships || [],
      worldbuildingNotes: data.worldbuildingNotes || []
    };

    return outline;
  }

  // Validates JSON structure integrity before parsing
  private validateJsonStructure(jsonStr: string): boolean {
    // Check if the JSON has balanced braces and brackets
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let escape = false;
    
    for (let i = 0; i < jsonStr.length; i++) {
      const ch = jsonStr[i];
      
      if (escape) {
        escape = false;
        continue;
      }
      
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      
      if (ch === '"' && !escape) {
        inString = !inString;
        continue;
      }
      
      if (inString) continue;
      
      if (ch === '{') {
        braceDepth++;
      } else if (ch === '}') {
        braceDepth--;
        if (braceDepth < 0) return false; // Unbalanced: more closing than opening
      } else if (ch === '[') {
        bracketDepth++;
      } else if (ch === ']') {
        bracketDepth--;
        if (bracketDepth < 0) return false; // Unbalanced: more closing than opening
      }
    }
    
    // Valid if all braces and brackets are balanced
    return braceDepth === 0 && bracketDepth === 0;
  }
  
  // Validates string value completeness in JSON
  private validateStringValues(jsonStr: string): boolean {
    let inString = false;
    let escape = false;
    
    for (let i = 0; i < jsonStr.length; i++) {
      const ch = jsonStr[i];
      
      if (escape) {
        escape = false;
        continue;
      }
      
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      
      if (ch === '"' && !escape) {
        inString = !inString;
        continue;
      }
    }
    
    // Valid if we're not left in an unclosed string
    return !inString;
  }

  async generateContinuation(
    outline: GeneratedOutline,
    chapterCount: number,
    instructions: string,
    modelConfig: ModelConfig,
    abortSignal?: AbortSignal
  ): Promise<ChapterOutline[]> {
    const aiConfig = aiConfigProvider.getAIConfig();
    const baseUrl = aiConfig.baseUrl;
    const apiKey = aiConfig.apiKey;
    const apiKeyTransmission = aiConfig.apiKeyTransmission;
    const engineSystemPrompt = aiConfig.systemPrompt;
    const modelName = aiConfig.modelName || modelConfig.model;

    if (!baseUrl) {
      throw this.createError(WritingErrorCode.OUTLINE_GENERATION_FAILED, '未配置 AI 服务地址');
    }

    const systemPrompt = this.buildContinuationSystemPrompt(outline);
    const userPrompt = this.buildContinuationUserPrompt(outline, chapterCount, instructions);

    const enrichedSystemPrompt = engineSystemPrompt
      ? engineSystemPrompt.trim() + '\n\n' + systemPrompt
      : systemPrompt;

    const messages: ChatMessage[] = [
      { role: 'system', content: enrichedSystemPrompt },
      { role: 'user', content: userPrompt },
    ];

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

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(
        WritingErrorCode.OUTLINE_GENERATION_FAILED,
        `AI 请求失败: ${response.status} ${response.statusText}`,
        errorText,
      );
    }

    const rawContent = await this.readStreamResponse(response, abortSignal);

    if (!rawContent && !abortSignal?.aborted) {
      throw this.createError(WritingErrorCode.OUTLINE_GENERATION_FAILED, 'AI 返回内容为空');
    }

    return this.parseContinuationResponse(rawContent, outline);
  }

  private buildContinuationSystemPrompt(outline: GeneratedOutline): string {
    const novelType = outline.workInfo.novelType;
    const template = NovelTypeTemplates[novelType as keyof typeof NovelTypeTemplates];

    return `你是一位专业的小说大纲续写助手。你的任务是基于已有大纲续写后续章节。

## 创作原则
1. 保持与已有大纲的风格、基调一致
2. 剧情递进合理，前后连贯
3. 角色行为符合已建立的性格特征
4. 新章节的索引从已有章节的最大索引+1开始递增
5. 每章目标字数参考已有章节的平均值

## 输出要求
1. 只输出 JSON 格式的章节数组，不要输出任何解释性文字
2. JSON 必须是合法格式
3. 每个章节必须包含: index, title, summary, keyPlotPoints, characters, scenes, targetWordCount
4. 数组格式: [{...}, {...}, ...]`;
  }

  private buildContinuationUserPrompt(
    outline: GeneratedOutline,
    chapterCount: number,
    instructions: string,
  ): string {
    const lastChapters = outline.chapters.slice(-3);
    const lastChapterIndex = Math.max(...outline.chapters.map(ch => ch.index));
    const avgWordCount = Math.round(
      outline.chapters.reduce((sum, ch) => sum + (ch.targetWordCount || 3000), 0) / outline.chapters.length,
    );

    return `# 大纲续写任务

## 已有大纲信息
作品标题: ${outline.workInfo.suggestedTitle}
已有章节数: ${outline.chapters.length}
最后章节索引: ${lastChapterIndex}
平均每章字数: ${avgWordCount}

## 最近章节（参考上下文）
${lastChapters.map(ch => `第 ${ch.index} 章: ${ch.title}\n摘要: ${ch.summary}\n关键情节: ${ch.keyPlotPoints.join('、')}\n`).join('\n---\n')}

## 续写要求
请续写 ${chapterCount} 个章节，章节索引从 ${lastChapterIndex + 1} 开始递增。
${instructions ? `\n## 额外指令\n${instructions}` : ''}

## 输出格式
请输出如下格式的 JSON 数组:

[
  {
    "index": ${lastChapterIndex + 1},
    "title": "章节标题",
    "summary": "章节概要",
    "keyPlotPoints": ["关键情节点1", "关键情节点2"],
    "characters": ["出场角色"],
    "scenes": ["场景描述"],
    "suspensePoints": ["悬念点"],
    "targetWordCount": ${avgWordCount}
  }
]

## 重要提示
1. 只输出 JSON 数组，不要任何前后缀
2. 被包裹在 \`\`\`json 和 \`\`\` 代码块中
3. 所有章节索引必须从 ${lastChapterIndex + 1} 开始递增
4. 确保剧情连贯，承接最后一章的内容`;
  }

  private parseContinuationResponse(response: string, existingOutline: GeneratedOutline): ChapterOutline[] {
    let jsonStr = response.trim();

    const patterns = [
      /```(?:json)?\s*([\s\S]*?)```/,
      /```\s*([\s\S]*?)```/,
      /^```([\s\S]*?)```$/m,
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

    try {
      const parsed = JSON.parse(jsonStr);
      const chapters: any[] = Array.isArray(parsed) ? parsed : parsed.chapters || [];

      const lastChapterIndex = existingOutline.chapters.length > 0
        ? Math.max(...existingOutline.chapters.map(ch => ch.index))
        : 0;
      const avgWordCount = existingOutline.chapters.length > 0
        ? Math.round(existingOutline.chapters.reduce((sum, ch) => sum + (ch.targetWordCount || 3000), 0) / existingOutline.chapters.length)
        : 3000;

      return chapters.map((ch: any, idx: number) => ({
        index: ch.index || lastChapterIndex + idx + 1,
        title: ch.title || `第${lastChapterIndex + idx + 1}章`,
        summary: ch.summary || '',
        keyPlotPoints: ch.keyPlotPoints || [],
        characters: ch.characters || [],
        scenes: ch.scenes || [],
        suspensePoints: ch.suspensePoints || [],
        targetWordCount: ch.targetWordCount || avgWordCount,
      }));
    } catch (e) {
      console.error('[OutlineGenerator] Parse continuation response failed:', e);
      throw new Error('续写内容解析失败');
    }
  }

  private getDefaultStyle(novelType: string): any {
    const styleMap: Record<string, any> = {
      web_novel: 'relaxed',
      romance: 'romantic',
      martial_arts: 'serious',
      fantasy: 'epic',
      fantasy_magic: 'epic',
      mystery: 'suspenseful',
      sci_fi: 'serious',
      historical: 'serious',
      urban: 'relaxed',
      documentary: 'serious',
      erotic: 'romantic',
      other: 'serious'
    };
    return styleMap[novelType] || 'serious';
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

export const outlineGenerator = new OutlineGenerator();
