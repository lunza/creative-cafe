import {
  OutlineGenerationRequest,
  GeneratedOutline,
  WritingError,
  WritingErrorCode
} from '../../../shared/types/writing.types';
import { promptBuilder } from './PromptBuilder';
import { writingResourceManager } from '../WritingResourceManager';
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

export interface OutlineGenerationResult {
  outline: GeneratedOutline;
  rawContent: string;
}

export class OutlineGenerator {
  private streamChunkCallback: ((chunk: string) => void) | null = null;

  onStreamChunk(callback: (chunk: string) => void): void {
    this.streamChunkCallback = callback;
  }

  buildPrompt(request: OutlineGenerationRequest & { _resourceContext?: string }): ChatMessage[] {
    const systemPrompt = promptBuilder.buildSystemPrompt(
      request.parameters.novelType,
      request.parameters.writingStyle || this.getDefaultStyle(request.parameters.novelType),
      request.parameters.narrativePerspective
    );

    const resourceContext = request._resourceContext || '';
    const userPrompt = promptBuilder.buildOutlinePrompt(
      request.parameters.creativeDescription,
      request.resources,
      request.parameters,
      resourceContext
    );

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];
  }

  async generate(
    messages: ChatMessage[],
    modelConfig: ModelConfig
  ): Promise<OutlineGenerationResult> {
    const baseUrl = await this.getBaseUrl();
    const apiKey = await this.getApiKey();
    const modelName = await this.getModelName(modelConfig.model);
    const engineSystemPrompt = await this.getEngineSystemPrompt();

    if (!baseUrl) {
      throw this.createError(WritingErrorCode.AI_SERVICE_UNAVAILABLE, '未配置 AI 服务地址');
    }

    const enrichedMessages = this.enrichSystemPrompt(messages, engineSystemPrompt);
    
    console.log('[OutlineGenerator] Request messages:', JSON.stringify(enrichedMessages.map(m => ({
      role: m.role,
      contentPreview: m.content.substring(0, 200) + '...'
    }))));

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: enrichedMessages,
        temperature: modelConfig.temperature,
        max_tokens: modelConfig.maxTokens,
        stream: true
      })
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
    const rawContent = await this.readStreamResponse(response);
    console.log('[OutlineGenerator] Raw AI response (length):', rawContent.length);
    console.log('[OutlineGenerator] Raw AI response (preview):', rawContent.substring(0, 500));

    if (!rawContent) {
      throw this.createError(
        WritingErrorCode.OUTLINE_GENERATION_FAILED,
        'AI 返回内容为空'
      );
    }

    try {
      const outline = this.parseOutlineResponse(rawContent);
      return { outline, rawContent };
    } catch (parseError) {
      console.error('[OutlineGenerator] Parse failed but raw content preserved, length:', rawContent.length);
      const error = parseError instanceof Error ? parseError : new Error(String(parseError));
      (error as any).rawContent = rawContent;
      throw error;
    }
  }

  private async readStreamResponse(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Stream reader not available');
    }

    const decoder = new TextDecoder();
    let accumulatedData = '';
    let fullContent = '';
    let lastProcessedLineCount = 0;
    let parsedLineCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Process any remaining data in accumulated buffer after stream ends
          if (accumulatedData.length > 0) {
            const lines = accumulatedData.split('\n');
            const remainingLines = lines.slice(lastProcessedLineCount);
            for (const line of remainingLines) {
              const parsed = this.parseSSELine(line);
              if (parsed) {
                fullContent += parsed;
                parsedLineCount++;
                if (this.streamChunkCallback) {
                  this.streamChunkCallback(parsed);
                }
              }
            }
          }
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        accumulatedData += chunk;

        // Split accumulated data into lines and filter data: lines
        const lines = accumulatedData.split('\n');
        const dataLines = lines.filter(line => {
          const trimmed = line.trim();
          return trimmed.startsWith('data: ') && trimmed.substring(6).trim() !== '[DONE]';
        });

        // Only process complete lines (skip the last one which may be partial)
        const completeDataLines = dataLines.length > 0 ? dataLines.slice(0, -1) : [];
        const newLines = completeDataLines.slice(lastProcessedLineCount);
        lastProcessedLineCount = dataLines.length - 1;

        for (const line of newLines) {
          const parsed = this.parseSSELine(line);
          if (parsed) {
            fullContent += parsed;
            parsedLineCount++;
            if (this.streamChunkCallback) {
              this.streamChunkCallback(parsed);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Fallback: if parsed content is too short, try extracting from full accumulated data
    if (fullContent.length < 100 && accumulatedData.length > 0) {
      const fallbackContent = this.extractContentFromRawData(accumulatedData);
      if (fallbackContent.length > fullContent.length) {
        console.log('[OutlineGenerator] Using fallback content extraction (length:', fallbackContent.length, ')');
        fullContent = fallbackContent;
      }
    }

    console.log('[OutlineGenerator] Stream complete:', {
      accumulatedDataLength: accumulatedData.length,
      totalDataLines: lastProcessedLineCount,
      parsedLines: parsedLineCount,
      extractedContentLength: fullContent.length,
      preview: fullContent.substring(0, 200)
    });

    return fullContent;
  }

  private parseSSELine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) return null;

    const jsonStr = trimmed.substring(6).trim();
    if (!jsonStr || jsonStr === '[DONE]') return null;

    try {
      const parsed = JSON.parse(jsonStr);
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) return delta;
      
      const message = parsed.choices?.[0]?.message?.content;
      if (message) return message;
      
      return null;
    } catch (e) {
      // Silently ignore parse failures for incomplete lines
      return null;
    }
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

    console.log('[OutlineGenerator] Parsing JSON (length:', jsonStr.length, ')');
    console.log('[OutlineGenerator] JSON preview:', jsonStr.substring(0, 200));

    // Try direct parse first
    try {
      const parsed = JSON.parse(jsonStr);
      console.log('[OutlineGenerator] JSON parsed successfully');
      return this.validateOutline(parsed);
    } catch {
      console.log('[OutlineGenerator] Initial parse failed, attempting fix...');
    }

    // Try multiple fix strategies in order of robustness
    const fixStrategies = [
      { name: 'unescapeControl', strategy: () => this.fixUnescapedCharacters(jsonStr) },
      { name: 'truncateTrailing', strategy: () => this.fixTrailingGarbage(jsonStr) },
      { name: 'errorPositionFix', strategy: () => this.fixByErrorPosition(jsonStr) },
      { name: 'commonJsonFix', strategy: () => this.fixCommonJsonIssues(jsonStr) },
    ];

    for (const { name, strategy } of fixStrategies) {
      try {
        const fixed = strategy();
        if (!fixed || fixed.length < 50) {
          console.log(`[OutlineGenerator] Fix ${name} produced too short output, skipping`);
          continue;
        }
        const parsed = JSON.parse(fixed);
        console.log(`[OutlineGenerator] Fix ${name} succeeded, length:`, fixed.length);
        return this.validateOutline(parsed);
      } catch (fixError) {
        console.log(`[OutlineGenerator] Fix ${name} failed:`, fixError instanceof Error ? fixError.message : String(fixError));
      }
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

  private fixTrailingGarbage(jsonStr: string): string {
    // Strategy: find the last complete JSON structure by tracking brace depth
    // This handles the common case where the response was truncated at the end
    let depth = 0;
    let inString = false;
    let escape = false;
    let lastValidEnd = -1;

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
      
      if (ch === '{' || ch === '[') {
        depth++;
        lastValidEnd = i;
      } else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          lastValidEnd = i;
        }
      }
    }

    if (lastValidEnd >= 0 && lastValidEnd < jsonStr.length - 1) {
      const truncated = jsonStr.substring(0, lastValidEnd + 1);
      console.log('[OutlineGenerator] Trailing garbage fix: truncating from', jsonStr.length, 'to', truncated.length);
      return truncated;
    }

    return jsonStr;
  }

  private fixUnescapedCharacters(jsonStr: string): string {
    // Strategy: parse JSON character by character, properly handling:
    // 1. Unescaped newlines/tabs in string values
    // 2. Unescaped quotes inside string values (the main cause of failure)
    // 3. Control characters below 0x20
    let result = '';
    let inString = false;
    let escape = false;
    let i = 0;

    while (i < jsonStr.length) {
      const ch = jsonStr[i];
      
      if (escape) {
        result += ch;
        escape = false;
        i++;
        continue;
      }
      
      if (ch === '\\') {
        result += ch;
        escape = true;
        i++;
        continue;
      }
      
      if (ch === '"') {
        // Check if this is an unescaped quote inside a string value
        if (inString) {
          // Check if the next non-whitespace character is a structural character
          // that would indicate this is a real closing quote vs an unescaped internal quote
          const nextChars = jsonStr.substring(i + 1).trimStart().substring(0, 3);
          if (nextChars.startsWith(',') || nextChars.startsWith('}') || nextChars.startsWith(']') || nextChars.startsWith(':')) {
            // This looks like a legitimate closing quote
            inString = false;
            result += ch;
            i++;
            continue;
          }
          // This is likely an unescaped internal quote - escape it
          result += '\\"';
          i++;
          continue;
        } else {
          inString = true;
          result += ch;
          i++;
          continue;
        }
      }
      
      if (inString) {
        // Inside a string value, escape special characters
        if (ch === '\n') {
          result += '\\n';
        } else if (ch === '\r') {
          result += '\\r';
        } else if (ch === '\t') {
          result += '\\t';
        } else if (ch.charCodeAt(0) < 0x20) {
          result += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
        } else {
          result += ch;
        }
      } else {
        result += ch;
      }
      
      i++;
    }

    return result;
  }

  private fixByErrorPosition(jsonStr: string): string {
    // Strategy: handle truncated JSON by removing incomplete strings and closing braces
    // This is the LAST resort - we work on the RAW jsonStr, not after unescape
    let fixed = jsonStr;

    // Remove trailing commas
    fixed = fixed.replace(/,\s*([}\]])/g, '$1');

    // Add quotes to unquoted keys
    fixed = fixed.replace(/([{,])\s*([a-zA-Z_]\w*)\s*:/g, '$1"$2":');

    // Replace single quotes with double quotes for string values
    fixed = fixed.replace(/:\s*'([^']*)'/g, ':"$1"');

    // Find and handle unclosed strings - truncate to BEFORE the incomplete string value
    let inString = false;
    let escape = false;
    let lastStringStart = -1;

    for (let i = 0; i < fixed.length; i++) {
      const ch = fixed[i];
      
      if (escape) {
        escape = false;
        continue;
      }
      
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      
      if (ch === '"') {
        if (inString) {
          inString = false;
        } else {
          inString = true;
          lastStringStart = i;
        }
      }
    }

    // If still in a string, truncate to just before the incomplete string starts
    if (inString && lastStringStart >= 0) {
      let cutPos = lastStringStart;
      while (cutPos > 0) {
        const ch = fixed[cutPos - 1];
        if (ch === ':' || ch === ',' || ch === '{' || ch === '[') {
          break;
        }
        cutPos--;
      }
      fixed = fixed.substring(0, cutPos);
      
      const trimmed = fixed.trimEnd();
      if (trimmed.endsWith(':') || trimmed.endsWith(',')) {
        let endPos = trimmed.length - 1;
        while (endPos > 0 && (fixed[endPos - 1] === ' ' || fixed[endPos - 1] === '\n' || fixed[endPos - 1] === '\t')) {
          endPos--;
        }
        if (endPos > 0 && (fixed[endPos - 1] === ':' || fixed[endPos - 1] === ',')) {
          fixed = fixed.substring(0, endPos - 1);
        }
      }
    }

    // Now close any remaining open braces/brackets
    let depth = 0;
    let lastStructuralChar = -1;
    let openBrackets: ('{' | '[')[] = [];
    inString = false;
    escape = false;

    for (let i = 0; i < fixed.length; i++) {
      const ch = fixed[i];
      
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
      
      if (ch === '{' || ch === '[') {
        openBrackets.push(ch);
        depth++;
        lastStructuralChar = i;
      } else if (ch === '}' || ch === ']') {
        if (openBrackets.length > 0) openBrackets.pop();
        depth--;
        if (depth === 0) {
          lastStructuralChar = i;
        }
      }
    }

    // If depth > 0, we have unclosed braces/brackets - truncate and close
    if (depth > 0 && lastStructuralChar >= 0) {
      fixed = fixed.substring(0, lastStructuralChar + 1);
      // Close any remaining open braces/brackets in reverse order
      while (openBrackets.length > 0) {
        const open = openBrackets.pop()!;
        fixed += open === '{' ? '}' : ']';
        depth--;
      }
      console.log('[OutlineGenerator] fixByErrorPosition: closed remaining braces/brackets');
    }

    return fixed;
  }

  private fixCommonJsonIssues(jsonStr: string): string {
    let fixed = jsonStr;

    // Remove trailing commas before } or ]
    fixed = fixed.replace(/,\s*([}\]])/g, '$1');

    // Add quotes to unquoted keys
    fixed = fixed.replace(/([{,])\s*([a-zA-Z_]\w*)\s*:/g, '$1"$2":');

    // Replace single quotes with double quotes for string values
    fixed = fixed.replace(/:\s*'([^']*)'/g, ':"$1"');

    return fixed;
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
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      
      console.log('[OutlineGenerator] getBaseUrl - full settings:', JSON.stringify({
        hasSettings: !!settings,
        hasAiEngines: !!settings?.aiEngines,
        aiEnginesCount: settings?.aiEngines?.length || 0,
        aiEngines: settings?.aiEngines?.map((e: any) => ({ id: e.id, name: e.name, url: e.api_url })),
        activeEngineId: settings?.activeEngineId,
        aiObject: settings?.ai ? Object.keys(settings.ai) : null,
        rawBaseUrl: settings?.baseUrl
      }, null, 2));
      
      const engines = settings?.aiEngines || [];
      if (engines.length > 0) {
        const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
        const url = activeEngine?.api_url;
        console.log('[OutlineGenerator] getBaseUrl - using engine:', activeEngine?.name, 'url:', url);
        return url;
      }
      
      console.warn('[OutlineGenerator] getBaseUrl - no aiEngines found, falling back to legacy path');
      return settings?.ai?.baseUrl || settings?.ai?.apiBaseUrl || settings?.baseUrl;
    } catch (error) {
      console.error('[OutlineGenerator] getBaseUrl error:', error);
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
        console.log('[OutlineGenerator] getApiKey - using engine:', activeEngine?.name, 'hasKey:', !!key);
        return key;
      }
      
      return settings?.ai?.apiKey || settings?.ai?.apiToken || settings?.apiKey;
    } catch (error) {
      console.error('[OutlineGenerator] getApiKey error:', error);
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
          console.log('[OutlineGenerator] getEngineSystemPrompt - using engine system prompt, length:', prompt.length);
        }
        return prompt;
      }
      
      return '';
    } catch (error) {
      console.error('[OutlineGenerator] getEngineSystemPrompt error:', error);
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

  private async getModelName(fallbackModel: string): Promise<string> {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      
      const engines = settings?.aiEngines || [];
      if (engines.length > 0) {
        const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
        const engineModel = activeEngine?.model_name;
        if (engineModel) {
          console.log('[OutlineGenerator] getModelName - using engine model:', engineModel, '(fallback was:', fallbackModel, ')');
          return engineModel;
        }
      }
      
      console.log('[OutlineGenerator] getModelName - no engine model found, using fallback:', fallbackModel);
      return fallbackModel;
    } catch (error) {
      console.error('[OutlineGenerator] getModelName error:', error);
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

export const outlineGenerator = new OutlineGenerator();
