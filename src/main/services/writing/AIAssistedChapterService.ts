import {
  AISplitSuggestion,
  AIMergeSuggestion,
  ChapterOutline,
  GeneratedOutline,
  NovelType,
  WritingStyle,
  NarrativePerspective,
  WritingError,
  WritingErrorCode
} from '../../../shared/types/writing.types';
import { AI_SPLIT_TIMEOUT, AI_MERGE_TIMEOUT } from '../../../shared/constants/writing.constants';
import { outlineGenerator } from './OutlineGenerator';
import { addLog } from '../memory/chatLogService';
import { aiConfigProvider } from '../ai/AIConfigProvider';
import { getStorageService } from '../storageService';

// 【多模态兼容性审计】本服务使用本地 ChatMessage 类型（content: string），
// 不导入 AIService.ts 的联合类型 ChatMessage，不受多模态 content 扩展影响。
// 所有消息 content 均为纯文本字符串，适用于章节拆分/合并等非视觉任务。
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface AISplitRequest {
  chapterTitle: string;
  chapterSummary: string;
  chapterContent: string;
  splitCount: number;
  outline: GeneratedOutline;
  novelType?: NovelType;
  writingStyle?: WritingStyle;
  narrativePerspective?: NarrativePerspective;
  modelConfig?: ModelConfig;
}

export interface AIMergeRequest {
  chapters: ChapterOutline[];
  chapterContents: Record<number, string>;
  outline: GeneratedOutline;
  novelType?: NovelType;
  writingStyle?: WritingStyle;
  narrativePerspective?: NarrativePerspective;
  modelConfig?: ModelConfig;
}

export class AIAssistedChapterService {
  /**
   * 通过 aiConfigProvider 获取 AI 调用所需的全部 5 个字段。
   *
   * 与原 getConfig 行为对齐：
   * - `apiKeyTransmission` 默认 'header'（区别于其他 writing 服务的 'body'）
   * - `model` 缺失时抛错（与原 `if (!activeEngine?.model_name) throw` 一致）
   * - `baseUrl` / `apiKey` / `systemPrompt` 缺失时退化为空字符串（与原 fallback 一致）
   */
  private getConfig(): { baseUrl: string; apiKey: string; apiKeyTransmission: string; model: string; systemPrompt: string } {
    const aiConfig = aiConfigProvider.getAIConfig({ defaultTransmission: 'header' });
    const model = aiConfig.modelName;
    if (!model) {
      throw new Error('未配置 AI 模型名称，请在设置中配置 AI 引擎');
    }
    return {
      baseUrl: aiConfig.baseUrl || '',
      apiKey: aiConfig.apiKey || '',
      apiKeyTransmission: aiConfig.apiKeyTransmission,
      model,
      systemPrompt: aiConfig.systemPrompt || ''
    };
  }

  private async getEngineConfig(): Promise<{ temperature: number; maxTokens: number }> {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    const engines = settings?.aiEngines || [];
    const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];

    if (activeEngine?.temperature === undefined || activeEngine?.temperature === null) {
      throw new Error('未配置 AI 温度参数，请在设置中配置 AI 引擎');
    }

    if (activeEngine?.max_tokens === undefined || activeEngine?.max_tokens === null) {
      throw new Error('未配置 AI 最大令牌数，请在设置中配置 AI 引擎');
    }

    return {
      temperature: activeEngine.temperature,
      maxTokens: activeEngine.max_tokens
    };
  }

  private getDefaultStyle(novelType: NovelType): WritingStyle {
    const styleMap: Record<string, WritingStyle> = {
      web_novel: WritingStyle.RELAXED,
      romance: WritingStyle.ROMANTIC,
      martial_arts: WritingStyle.SERIOUS,
      fantasy: WritingStyle.EPIC,
      fantasy_magic: WritingStyle.EPIC,
      mystery: WritingStyle.SUSPENSEFUL,
      sci_fi: WritingStyle.SERIOUS,
      historical: WritingStyle.SERIOUS,
      urban: WritingStyle.RELAXED,
      documentary: WritingStyle.SERIOUS,
      erotic: WritingStyle.ROMANTIC,
      other: WritingStyle.SERIOUS
    };
    return styleMap[novelType] || WritingStyle.SERIOUS;
  }

  private buildSplitPrompt(request: AISplitRequest): string {
    const outlineSummary = request.outline.chapters
      .slice(0, 5)
      .map(ch => `- 第${ch.index}章 ${ch.title}: ${ch.summary?.substring(0, 100)}`)
      .join('\n');

    const contentPreview = request.chapterContent.length > 2000
      ? request.chapterContent.substring(0, 2000) + '...'
      : request.chapterContent;

    return `你是一个专业的小说编辑助手。请根据以下章节信息，将其拆分为${request.splitCount}个子章节。

## 作品大纲（前5章）
${outlineSummary}

## 当前章节
- 标题：${request.chapterTitle}
- 摘要：${request.chapterSummary}
- 内容预览：
${contentPreview}

请以JSON格式返回拆分方案（不要包含markdown代码块标记）：
{
  "titles": ["子章节1标题", "子章节2标题", ...],
  "summaries": ["子章节1摘要", "子章节2摘要", ...],
  "targetWordCounts": [3000, 3000, ...],
  "keyPlotPoints": [["情节1", "情节2"], ["情节1"], ...],
  "confidence": 0.85
}

要求：
1. 子章节标题要有连贯性和吸引力
2. 每个子章节的摘要要体现该部分的核心情节
3. 关键情节要点要具体明确，每个子章节2-4个要点
4. 保持故事逻辑的连贯性
5. confidence字段表示AI对此拆分方案的信心度（0-1之间）`;
  }

  private buildMergePrompt(request: AIMergeRequest): string {
    const outlineSummary = request.outline.chapters
      .slice(0, 5)
      .map(ch => `- 第${ch.index}章 ${ch.title}: ${ch.summary?.substring(0, 100)}`)
      .join('\n');

    const chaptersInfo = request.chapters.map((ch, i) => {
      const content = request.chapterContents[ch.index] || '';
      const contentPreview = content.length > 500 ? content.substring(0, 500) + '...' : content;
      return `### 章节${i + 1}: ${ch.title}
- 摘要: ${ch.summary}
- 内容预览: ${contentPreview || '(无内容)'}`;
    }).join('\n\n');

    return `你是一个专业的小说编辑助手。请将以下${request.chapters.length}个章节合并为一个新章节。

## 作品大纲（前5章）
${outlineSummary}

## 待合并章节
${chaptersInfo}

请以JSON格式返回合并方案（不要包含markdown代码块标记）：
{
  "mergedTitle": "合并后的章节标题",
  "mergedSummary": "合并后的章节摘要（整合所有章节的关键情节）",
  "mergedTargetWordCount": 6000,
  "mergedKeyPlotPoints": ["情节1", "情节2", "情节3", ...],
  "confidence": 0.85
}

要求：
1. 合并后的标题要能概括所有章节的核心内容
2. 摘要要整合所有章节的关键情节，保持连贯性
3. 关键情节要点要按逻辑顺序排列，6-10个要点
4. 保持故事连贯性和风格一致性
5. confidence字段表示AI对此合并方案的信心度（0-1之间）`;
  }

  private buildSystemPrompt(novelType?: NovelType, writingStyle?: WritingStyle, perspective?: NarrativePerspective): string {
    const typeLabels: Record<string, string> = {
      web_novel: '网络小说',
      romance: '言情小说',
      martial_arts: '武侠小说',
      fantasy: '玄幻小说',
      fantasy_magic: '奇幻小说',
      mystery: '悬疑小说',
      sci_fi: '科幻小说',
      historical: '历史小说',
      urban: '都市小说',
      documentary: '纪实文学',
      erotic: '色情文学',
      other: '小说'
    };

    const styleLabels: Record<string, string> = {
      relaxed: '轻松',
      serious: '严肃',
      humorous: '幽默',
      suspenseful: '悬疑',
      romantic: '浪漫',
      epic: '史诗',
      detailed: '细节'
    };

    const perspectiveLabels: Record<string, string> = {
      first_person: '第一人称',
      third_person: '第三人称',
      omniscient: '全知视角'
    };

    const novelTypeLabel = novelType ? typeLabels[novelType] || '小说' : '小说';
    const writingStyleLabel = writingStyle ? styleLabels[writingStyle] || '标准' : '标准';
    const perspectiveLabel = perspective ? perspectiveLabels[perspective] || '第三人称' : '第三人称';

    return `你是一个专业的${novelTypeLabel}编辑助手，擅长${writingStyleLabel}风格的${perspectiveLabel}叙事。
你的任务是帮助作者进行章节的拆分和合并工作，确保拆分/合并后的章节保持故事逻辑的连贯性和风格的一致性。
请以JSON格式返回结果，确保格式正确且内容专业。`;
  }

  async suggestSplit(request: AISplitRequest): Promise<AISplitSuggestion> {
    addLog('===== 写作模式: AI拆分建议请求 =====', 'debug');
    addLog(`章节标题: ${request.chapterTitle}`, 'debug');
    addLog(`拆分数量: ${request.splitCount}`, 'debug');
    addLog('===== 请求入参结束 =====', 'debug');

    const config = await this.getConfig();
    const systemPrompt = this.buildSystemPrompt(request.novelType, request.writingStyle, request.narrativePerspective);
    const userPrompt = this.buildSplitPrompt(request);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const engineConfig = await this.getEngineConfig();

    const modelConfig: ModelConfig = request.modelConfig || {
      model: config.model,
      temperature: engineConfig.temperature,
      maxTokens: engineConfig.maxTokens
    };

    try {
      const rawContent = await this.callAIService(messages, modelConfig, AI_SPLIT_TIMEOUT);
      const result = this.parseSplitResponse(rawContent);
      result.rawResponse = rawContent;

      addLog('===== 写作模式: AI拆分建议成功 =====', 'debug');
      addLog(`拆分数量: ${result.splitCount}`, 'debug');
      addLog(`信心度: ${result.confidence}`, 'debug');
      addLog('===== 响应结束 =====', 'debug');

      return result;
    } catch (error) {
      addLog('===== 写作模式: AI拆分建议错误 =====', 'error');
      addLog(`章节标题: ${request.chapterTitle}`, 'error');
      addLog(`拆分数量: ${request.splitCount}`, 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      throw error;
    }
  }

  async suggestMerge(request: AIMergeRequest): Promise<AIMergeSuggestion> {
    addLog('===== 写作模式: AI合并建议请求 =====', 'debug');
    addLog(`章节数量: ${request.chapters.length}`, 'debug');
    addLog(`章节索引: ${JSON.stringify(request.chapters.map(ch => ch.index))}`, 'debug');
    addLog('===== 请求入参结束 =====', 'debug');

    const config = await this.getConfig();
    const systemPrompt = this.buildSystemPrompt(request.novelType, request.writingStyle, request.narrativePerspective);
    const userPrompt = this.buildMergePrompt(request);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const engineConfig = await this.getEngineConfig();

    const modelConfig: ModelConfig = request.modelConfig || {
      model: config.model,
      temperature: engineConfig.temperature,
      maxTokens: engineConfig.maxTokens
    };

    try {
      const rawContent = await this.callAIService(messages, modelConfig, AI_MERGE_TIMEOUT);
      const result = this.parseMergeResponse(rawContent);
      result.rawResponse = rawContent;

      addLog('===== 写作模式: AI合并建议成功 =====', 'debug');
      addLog(`合并标题: ${result.mergedTitle}`, 'debug');
      addLog(`信心度: ${result.confidence}`, 'debug');
      addLog('===== 响应结束 =====', 'debug');

      return result;
    } catch (error) {
      addLog('===== 写作模式: AI合并建议错误 =====', 'error');
      addLog(`章节数量: ${request.chapters.length}`, 'error');
      addLog(`错误信息: ${error instanceof Error ? error.message : String(error)}`, 'error');
      addLog('===== 错误详情结束 =====', 'error');
      throw error;
    }
  }

  private async callAIService(
    messages: ChatMessage[],
    modelConfig: ModelConfig,
    timeoutMs: number
  ): Promise<string> {
    const config = await this.getConfig();

    if (!config.baseUrl) {
      throw this.createError(WritingErrorCode.AI_SERVICE_UNAVAILABLE, '未配置 AI 服务地址，请在设置中配置');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const requestBody: Record<string, any> = {
      model: modelConfig.model,
      messages,
      temperature: modelConfig.temperature,
      max_tokens: modelConfig.maxTokens,
      stream: false
    };

    if (config.apiKey) {
      if (config.apiKeyTransmission === 'header') {
        const authValue = config.apiKey.trim().startsWith('Bearer ') ? config.apiKey : `Bearer ${config.apiKey}`;
        headers['Authorization'] = authValue;
      } else {
        requestBody.api_key = config.apiKey;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw this.createError(
          WritingErrorCode.CONTENT_GENERATION_FAILED,
          `AI 请求失败: ${response.status} ${response.statusText}`,
          errorText
        );
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw this.createError(
          WritingErrorCode.CONTENT_GENERATION_FAILED,
          'AI 返回内容为空'
        );
      }

      return content;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw this.createError(
          WritingErrorCode.TIMEOUT,
          `AI 请求超时（${timeoutMs / 1000}秒），请稍后重试`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseSplitResponse(rawContent: string): AISplitSuggestion {
    let jsonStr = rawContent.trim();

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

    // 修复 AI 返回的中文引号问题
    jsonStr = this.fixChineseQuotes(jsonStr);

    try {
      const parsed = JSON.parse(jsonStr);

      if (!parsed.titles || !Array.isArray(parsed.titles) || parsed.titles.length === 0) {
        throw new Error('AI返回的拆分方案缺少titles字段');
      }

      const splitCount = parsed.titles.length;

      return {
        splitCount,
        titles: parsed.titles,
        summaries: parsed.summaries || Array(splitCount).fill(''),
        targetWordCounts: parsed.targetWordCounts || Array(splitCount).fill(3000),
        keyPlotPoints: parsed.keyPlotPoints || Array(splitCount).fill([]),
        confidence: parsed.confidence || 0.7
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw this.createError(
          WritingErrorCode.CONTENT_GENERATION_FAILED,
          'AI返回的拆分方案格式不正确，请重试'
        );
      }
      throw error;
    }
  }

  private parseMergeResponse(rawContent: string): AIMergeSuggestion {
    let jsonStr = rawContent.trim();

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

    // 修复 AI 返回的中文引号问题
    jsonStr = this.fixChineseQuotes(jsonStr);

    try {
      const parsed = JSON.parse(jsonStr);

      if (!parsed.mergedTitle || typeof parsed.mergedTitle !== 'string') {
        throw new Error('AI返回的合并方案缺少mergedTitle字段');
      }

      return {
        mergedTitle: parsed.mergedTitle,
        mergedSummary: parsed.mergedSummary || '',
        mergedTargetWordCount: parsed.mergedTargetWordCount || 6000,
        mergedKeyPlotPoints: parsed.mergedKeyPlotPoints || [],
        chapterIndices: [],
        confidence: parsed.confidence || 0.7
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw this.createError(
          WritingErrorCode.CONTENT_GENERATION_FAILED,
          'AI返回的合并方案格式不正确，请重试'
        );
      }
      throw error;
    }
  }

  // 将 JSON 字符串中的中文引号替换为英文引号
  private fixChineseQuotes(jsonStr: string): string {
    let result = jsonStr;
    result = result.replace(/"/g, '"');
    result = result.replace(/"/g, '"');
    return result;
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

export const aiAssistedChapterService = new AIAssistedChapterService();
