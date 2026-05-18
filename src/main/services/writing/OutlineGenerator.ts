import {
  OutlineGenerationRequest,
  GeneratedOutline,
  WritingError,
  WritingErrorCode
} from '../../../shared/types/writing.types';
import { promptBuilder } from './PromptBuilder';
import { writingResourceManager } from '../WritingResourceManager';

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
  buildPrompt(request: OutlineGenerationRequest): ChatMessage[] {
    const systemPrompt = promptBuilder.buildSystemPrompt(
      request.parameters.novelType,
      request.parameters.writingStyle || this.getDefaultStyle(request.parameters.novelType),
      request.parameters.narrativePerspective
    );

    const userPrompt = promptBuilder.buildOutlinePrompt(
      request.parameters.creativeDescription,
      request.resources,
      request.parameters
    );

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
  }

  async generate(
    messages: ChatMessage[],
    modelConfig: ModelConfig
  ): Promise<GeneratedOutline> {
    const baseUrl = await this.getBaseUrl();
    const apiKey = await this.getApiKey();

    if (!baseUrl) {
      throw this.createError(WritingErrorCode.AI_SERVICE_UNAVAILABLE, '未配置 AI 服务地址');
    }

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
        max_tokens: modelConfig.maxTokens
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(
        WritingErrorCode.OUTLINE_GENERATION_FAILED,
        `AI 请求失败: ${response.status} ${response.statusText}`,
        errorText
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    if (!content) {
      throw this.createError(
        WritingErrorCode.OUTLINE_GENERATION_FAILED,
        'AI 返回内容为空'
      );
    }

    return this.parseOutlineResponse(content);
  }

  parseOutlineResponse(response: string): GeneratedOutline {
    try {
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();

      try {
        const parsed = JSON.parse(jsonStr);
        return this.validateOutline(parsed);
      } catch (parseError) {
        const fixed = this.fixJsonFormat(jsonStr);
        const parsed = JSON.parse(fixed);
        return this.validateOutline(parsed);
      }
    } catch (error) {
      console.error('[OutlineGenerator] Failed to parse outline:', error);
      throw this.createError(
        WritingErrorCode.OUTLINE_GENERATION_FAILED,
        '大纲解析失败，AI 返回的内容格式不正确',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private validateOutline(data: any): GeneratedOutline {
    if (!data.workInfo || !data.storyLine || !data.chapters) {
      throw new Error('大纲缺少必要字段');
    }

    if (!Array.isArray(data.chapters) || data.chapters.length === 0) {
      throw new Error('大纲中未定义章节');
    }

    const outline: GeneratedOutline = {
      workInfo: {
        suggestedTitle: data.workInfo.suggestedTitle || '未命名',
        novelType: data.workInfo.novelType || 'web_novel',
        estimatedWordCount: data.workInfo.estimatedWordCount || 10000,
        chapterCount: data.workInfo.chapterCount || 10
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
      chapters: data.chapters.map((ch: any, idx: number) => ({
        index: ch.index || idx + 1,
        title: ch.title || `第${idx + 1}章`,
        summary: ch.summary || '',
        keyPlotPoints: ch.keyPlotPoints || [],
        characters: ch.characters || [],
        scenes: ch.scenes || [],
        suspensePoints: ch.suspensePoints || [],
        targetWordCount: ch.targetWordCount || 3000
      })),
      characterRelationships: data.characterRelationships || [],
      worldbuildingNotes: data.worldbuildingNotes || []
    };

    return outline;
  }

  private fixJsonFormat(jsonStr: string): string {
    let fixed = jsonStr;

    fixed = fixed.replace(/,\s*([}\]])/g, '$1');
    fixed = fixed.replace(/([{,])\s*([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
    fixed = fixed.replace(/:\s*'([^']*)'/g, ':"$1"');
    fixed = fixed.replace(/\\\\n/g, '\\\\n');
    fixed = fixed.replace(/\\\\t/g, '\\\\t');

    const depthStack: number[] = [];
    let result = '';
    for (let i = 0; i < fixed.length; i++) {
      const char = fixed[i];
      const prevChar = i > 0 ? fixed[i - 1] : '';
      
      if (char === '"' && prevChar !== '\\') {
        result += char;
      } else if ((char === '{' || char === '[') && result.endsWith('"') || (char === '{' || char === '[') && result.endsWith(':')) {
        depthStack.push(depthStack.length);
        result += char;
      } else if ((char === '}' || char === ']') && depthStack.length > 0) {
        depthStack.pop();
        result += char;
      } else if (char === '\n' && depthStack.length === 0) {
        continue;
      } else {
        result += char;
      }
    }

    return result;
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
      other: 'serious'
    };
    return styleMap[novelType] || 'serious';
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

export const outlineGenerator = new OutlineGenerator();
