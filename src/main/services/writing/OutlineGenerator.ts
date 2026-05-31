import {
  OutlineGenerationRequest,
  GeneratedOutline,
  ChapterOutline,
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

  buildPrompt(request: OutlineGenerationRequest & { _resourceContext?: string; _writingStyleContext?: string }): ChatMessage[] {
    const writingStyleContext = request._writingStyleContext || '';
    const systemPrompt = promptBuilder.buildSystemPrompt(
      request.parameters.novelType,
      request.parameters.writingStyle || this.getDefaultStyle(request.parameters.novelType),
      request.parameters.narrativePerspective,
      writingStyleContext
    );

    const resourceContext = request._resourceContext || '';
    const userPrompt = promptBuilder.buildOutlinePrompt(
      request.parameters.creativeDescription,
      request.resources,
      request.parameters,
      resourceContext,
      writingStyleContext
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
    const baseUrl = await this.getBaseUrl();
    const apiKey = await this.getApiKey();
    const apiKeyTransmission = await this.getApiKeyTransmission();
    const modelName = await this.getModelName(modelConfig.model);
    const engineSystemPrompt = await this.getEngineSystemPrompt();

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

  private async readStreamResponse(response: Response, abortSignal?: AbortSignal): Promise<string> {
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

        const lines = accumulatedData.split('\n');
        const dataLines = lines.filter(line => {
          const trimmed = line.trim();
          return trimmed.startsWith('data: ') && trimmed.substring(6).trim() !== '[DONE]';
        });

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
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.log('[OutlineGenerator] Stream aborted, returning accumulated content (length:', fullContent.length, ')');
        return fullContent;
      }
      throw error;
    } finally {
      reader.releaseLock();
    }

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

    // 修复 AI 返回的中文引号问题
    jsonStr = this.fixChineseQuotes(jsonStr);

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
      { name: 'stripMarkdown', strategy: () => this.stripMarkdownFromValues(jsonStr) },
      { name: 'unescapeControl', strategy: () => this.fixUnescapedCharacters(jsonStr) },
      { name: 'truncateTrailing', strategy: () => this.fixTrailingGarbage(jsonStr) },
      { name: 'errorPositionFix', strategy: () => this.fixByErrorPosition(jsonStr) },
      { name: 'commonJsonFix', strategy: () => this.fixCommonJsonIssues(jsonStr) },
      { name: 'validateAndBalanceBraces', strategy: () => this.validateAndBalanceBraces(jsonStr) },
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

  // 将 JSON 字符串中的中文引号替换为英文引号
  private fixChineseQuotes(jsonStr: string): string {
    let result = jsonStr;
    result = result.replace(/"/g, '"');
    result = result.replace(/"/g, '"');
    return result;
  }

  // 移除 JSON 字符串值中的 Markdown 格式标记（如 **bold**, *italic*, __bold__ 等）
  private stripMarkdownFromValues(jsonStr: string): string {
    let result = jsonStr;
    // 移除字符串值内部的 **bold** 或 __bold__
    result = result.replace(/\*\*(.+?)\*\*/g, '$1');
    result = result.replace(/__(.+?)__/g, '$1');
    // 移除 *italic* 或 _italic_
    result = result.replace(/\*(.+?)\*/g, '$1');
    result = result.replace(/_(.+?)_/g, '$1');
    // 移除 ~~strikethrough~~
    result = result.replace(/~~(.+?)~~/g, '$1');
    return result;
  }
  
  // Validates and balances braces/brackets in JSON to ensure proper structure
  private validateAndBalanceBraces(jsonStr: string): string {
    let result = jsonStr;
    
    // First, try to find the complete JSON structure by counting braces
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let escape = false;
    let lastValidEnd = -1;
    let lastStructuralChar = -1;
    
    for (let i = 0; i < result.length; i++) {
      const ch = result[i];
      
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
        lastStructuralChar = i;
      } else if (ch === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          lastValidEnd = i;
        }
      } else if (ch === '[') {
        bracketDepth++;
        lastStructuralChar = i;
      } else if (ch === ']') {
        bracketDepth--;
        if (bracketDepth === 0 && braceDepth === 0) {
          lastValidEnd = i;
        }
      }
    }
    
    // If we found a valid complete structure, truncate to that point
    if (lastValidEnd > 0) {
      result = result.substring(0, lastValidEnd + 1);
    } else if (lastStructuralChar > 0) {
      // If we have unclosed structures, try to close them
      result = result.substring(0, lastStructuralChar + 1);
      const openBraces: string[] = [];
      
      // Re-count to see what's open
      braceDepth = 0;
      bracketDepth = 0;
      inString = false;
      escape = false;
      
      for (let i = 0; i < result.length; i++) {
        const ch = result[i];
        
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
          openBraces.push('{');
        } else if (ch === '}') {
          if (braceDepth > 0) {
            braceDepth--;
            openBraces.pop();
          }
        } else if (ch === '[') {
          bracketDepth++;
          openBraces.push('[');
        } else if (ch === ']') {
          if (bracketDepth > 0) {
            bracketDepth--;
            openBraces.pop();
          }
        }
      }
      
      // Close any remaining open braces/brackets
      while (openBraces.length > 0) {
        const open = openBraces.pop()!;
        result += open === '{' ? '}' : ']';
      }
    }
    
    return result;
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
    const baseUrl = await this.getBaseUrl();
    const apiKey = await this.getApiKey();
    const apiKeyTransmission = await this.getApiKeyTransmission();
    const modelName = await this.getModelName(modelConfig.model);
    const engineSystemPrompt = await this.getEngineSystemPrompt();

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

    jsonStr = this.fixChineseQuotes(jsonStr);

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

  private async getBaseUrl(): Promise<string | undefined> {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      
      console.log('[OutlineGenerator] getBaseUrl - raw settings type:', typeof settings);
      console.log('[OutlineGenerator] getBaseUrl - has aiEngines:', Array.isArray(settings?.aiEngines));
      console.log('[OutlineGenerator] getBaseUrl - aiEngines count:', settings?.aiEngines?.length || 0);
      console.log('[OutlineGenerator] getBaseUrl - activeEngineId:', settings?.activeEngineId);
      
      if (Array.isArray(settings?.aiEngines)) {
        settings.aiEngines.forEach((e: any, i: number) => {
          console.log(`[OutlineGenerator] Engine[${i}]:`, {
            id: e.id,
            name: e.name,
            api_url: e.api_url,
            api_key_len: e.api_key?.length || 0,
            api_key_tx: e.api_key_transmission
          });
        });
      }
      
      const engines = settings?.aiEngines || [];
      if (engines.length > 0) {
        const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
        const url = activeEngine?.api_url;
        console.log('[OutlineGenerator] getBaseUrl - SELECTED engine:', activeEngine?.name, 'url:', url);
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
        console.log('[OutlineGenerator] getApiKey - engine name:', activeEngine?.name, 'hasKey:', !!key, 'keyLen:', key?.length || 0);
        if (key && key.length > 20) {
          console.log('[OutlineGenerator] getApiKey - key preview:', `${key.substring(0, 10)}...${key.substring(key.length - 4)}`);
        }
        return key;
      }
      
      console.warn('[OutlineGenerator] getApiKey - no aiEngines, fallback to legacy');
      return settings?.ai?.apiKey || settings?.ai?.apiToken || settings?.apiKey;
    } catch (error) {
      console.error('[OutlineGenerator] getApiKey error:', error);
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
        console.log('[OutlineGenerator] getApiKeyTransmission - using:', transmission);
        return transmission;
      }
      
      return 'body';
    } catch (error) {
      console.error('[OutlineGenerator] getApiKeyTransmission error:', error);
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
