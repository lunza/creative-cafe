import {
  ContentGenerationRequest,
  GeneratedContent,
  WritingError,
  WritingErrorCode
} from '../../../shared/types/writing.types';
import { promptBuilder } from './PromptBuilder';

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

    if (!baseUrl) {
      throw this.createError(WritingErrorCode.AI_SERVICE_UNAVAILABLE, '未配置 AI 服务地址');
    }

    const messages = this.buildPrompt(request);
    let fullContent = '';
    const startTime = Date.now();

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelConfig.model,
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
              const content = chunkData.choices[0].delta?.content || '';
              if (content) {
                fullContent += content;
                onStream(content);
              }
            }
          } catch {
            // Ignore parse errors for individual chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

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

  private getNovelTypeFromRequest(request: ContentGenerationRequest): any {
    return request.generationParams.novelType || 'web_novel';
  }

  private getStyleFromRequest(request: ContentGenerationRequest): any {
    return request.generationParams.style || 'serious';
  }

  private getPerspectiveFromRequest(request: ContentGenerationRequest): any {
    const perspective = request.generationParams.perspective || 'third_person';
    const perspectiveMap: Record<string, string> = {
      first_person: 'first_person',
      third_person: 'third_person',
      omniscient: 'omniscient',
      first: 'first_person',
      third: 'third_person'
    };
    return perspectiveMap[perspective] || 'third_person';
  }

  private async getBaseUrl(): Promise<string | undefined> {
    try {
      const { getStorageService } = require('../storageService');
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      return settings?.ai?.baseUrl || settings?.ai?.apiBaseUrl || settings?.baseUrl;
    } catch {
      return undefined;
    }
  }

  private async getApiKey(): Promise<string | undefined> {
    try {
      const { getStorageService } = require('../storageService');
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      return settings?.ai?.apiKey || settings?.ai?.apiToken || settings?.apiKey;
    } catch {
      return undefined;
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
