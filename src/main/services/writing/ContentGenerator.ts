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
      this.getPerspectiveFromRequest(request)
    );

    const resourceContext = this.buildResourceContext(request);
    const recentChapters = this.buildRecentChapters(request);
    const chapterSummaries = this.buildChapterSummaries(request);
    const longTermContext = this.buildLongTermContext(request);
    const continuityConstraints = this.buildContinuityConstraints(request);

    const userPrompt = promptBuilder.buildContentPrompt(
      request.chapterInfo,
      {
        resourceContext,
        recentChapters,
        chapterSummaries,
        longTermContext,
        continuityConstraints
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
    const baseUrl = await this.getBaseUrl();
    const apiKey = await this.getApiKey();
    const modelName = await this.getModelName(modelConfig.model);
    const engineSystemPrompt = await this.getEngineSystemPrompt();

    if (!baseUrl) {
      throw this.createError(WritingErrorCode.AI_SERVICE_UNAVAILABLE, '未配置 AI 服务地址');
    }

    const messages = this.enrichSystemPrompt(this.buildPrompt(request), engineSystemPrompt);
    let fullContent = '';
    const startTime = Date.now();

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        temperature: modelConfig.temperature,
        max_tokens: modelConfig.maxTokens,
        stream: true
      }),
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

    const reader = response.body?.getReader();
    if (!reader) {
      throw this.createError(
        WritingErrorCode.CONTENT_GENERATION_FAILED,
        '无法获取响应流'
      );
    }

    const decoder = new TextDecoder('utf-8');
    let accumulatedData = '';
    let lastProcessedLineCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        accumulatedData += chunk;

        const lines = accumulatedData.split('\n');
        const dataLines = lines.filter(line => {
          const trimmed = line.trim();
          return trimmed.startsWith('data: ') && trimmed.substring(6).trim() !== '[DONE]';
        });

        const newLines = dataLines.slice(lastProcessedLineCount);
        lastProcessedLineCount = dataLines.length;

        for (const line of newLines) {
          const trimmed = line.trim();
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
            // Ignore parse errors for incomplete lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Fallback extraction if content is too short
    if (fullContent.length < 100 && accumulatedData.length > 0) {
      const fallbackContent = this.extractContentFromRawData(accumulatedData);
      if (fallbackContent.length > fullContent.length) {
        console.log('[ContentGenerator] Using fallback content extraction (length:', fallbackContent.length, ')');
        fullContent = fallbackContent;
        onStream(fullContent);
      }
    }

    console.log('[ContentGenerator] Stream complete:', {
      accumulatedDataLength: accumulatedData.length,
      totalDataLines: lastProcessedLineCount,
      extractedContentLength: fullContent.length,
      preview: fullContent.substring(0, 200)
    });

    const generationTime = Date.now() - startTime;

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
  }

  private buildResourceContext(request: ContentGenerationRequest): string {
    if (request.worldBookContext.length === 0 && request.characterContext.length === 0) {
      return '';
    }

    const parts: string[] = [];

    if (request.characterContext.length > 0) {
      parts.push('## 角色信息');
      for (const char of request.characterContext) {
        parts.push(`### ${char.name}`);
        if (char.description) parts.push(`描述: ${char.description}`);
        if (char.personality) parts.push(`性格: ${char.personality}`);
      }
    }

    if (request.worldBookContext.length > 0) {
      parts.push('## 世界观设定');
      for (const wb of request.worldBookContext) {
        parts.push(`### ${wb.entryName}`);
        parts.push(wb.content);
      }
    }

    return parts.join('\n');
  }

  private buildRecentChapters(request: ContentGenerationRequest): string {
    const recentChapters = request.previousChapters.slice(-3);
    if (recentChapters.length === 0) return '';

    const parts: string[] = ['## 前序章节'];
    for (const ch of recentChapters) {
      parts.push(`### 第${ch.index + 1}章 ${ch.title}`);
      if (ch.fullContent) {
        parts.push(ch.fullContent);
      } else {
        parts.push(ch.summary);
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
