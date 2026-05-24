import fs from 'fs';
import path from 'path';
import { BrowserWindow } from 'electron';
import { getUserDataPath } from '../utils/appPath';
import { getStorageService } from './storageService';
import { textSplitterService } from './TextSplitterService';
import {
  WritingStyleResource,
  WritingStyleAnalysis,
  WritingStyleProgress,
  WritingStyleStatus,
  WritingStylePhase,
  WritingStyleChunkAnalysis,
  WritingStyleLearningRequest
} from '../../shared/types/writing.types';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.txt'];

export class WritingStyleLearningService {
  private activeLearningTasks: Map<string, AbortController> = new Map();
  private currentProgress: WritingStyleProgress | null = null;

  private getWritingStylesDir(): string {
    const dataDir = path.join(getUserDataPath(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const writingDir = path.join(dataDir, 'writing');
    if (!fs.existsSync(writingDir)) {
      fs.mkdirSync(writingDir, { recursive: true });
    }
    return path.join(writingDir, 'writing-styles');
  }

  private async getBaseUrl(): Promise<string | undefined> {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      
      const engines = settings?.aiEngines || [];
      if (engines.length > 0) {
        const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
        return activeEngine?.api_url;
      }
      
      return settings?.ai?.baseUrl || settings?.ai?.apiBaseUrl || settings?.baseUrl;
    } catch (error) {
      console.error('[WritingStyleLearningService] getBaseUrl error:', error);
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
        return activeEngine?.api_key;
      }
      
      return settings?.ai?.apiKey || settings?.ai?.apiToken || settings?.apiKey;
    } catch (error) {
      console.error('[WritingStyleLearningService] getApiKey error:', error);
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
        return activeEngine?.api_key_transmission || 'body';
      }
      
      return 'body';
    } catch (error) {
      console.error('[WritingStyleLearningService] getApiKeyTransmission error:', error);
      return 'body';
    }
  }

  private async getModelName(): Promise<string> {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      
      const engines = settings?.aiEngines || [];
      if (engines.length > 0) {
        const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
        const engineModel = activeEngine?.model_name;
        if (engineModel) return engineModel;
      }
      
      throw new Error('未配置 AI 模型名称，请在设置中配置 AI 引擎');
    } catch (error) {
      if (error instanceof Error && error.message.includes('未配置 AI 模型名称')) {
        throw error;
      }
      console.error('[WritingStyleLearningService] getModelName error:', error);
      throw new Error('未配置 AI 模型名称，请在设置中配置 AI 引擎');
    }
  }

  private async getTemperature(): Promise<number> {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      
      const engines = settings?.aiEngines || [];
      if (engines.length > 0) {
        const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
        if (activeEngine?.temperature !== undefined && activeEngine?.temperature !== null) {
          return activeEngine.temperature;
        }
      }
      
      throw new Error('未配置 AI 温度参数，请在设置中配置 AI 引擎');
    } catch (error) {
      if (error instanceof Error && error.message.includes('未配置 AI 温度参数')) {
        throw error;
      }
      console.error('[WritingStyleLearningService] getTemperature error:', error);
      throw new Error('未配置 AI 温度参数，请在设置中配置 AI 引擎');
    }
  }

  private async getMaxTokens(): Promise<number> {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      
      const engines = settings?.aiEngines || [];
      if (engines.length > 0) {
        const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
        if (activeEngine?.max_tokens !== undefined && activeEngine?.max_tokens !== null) {
          return activeEngine.max_tokens;
        }
      }
      
      throw new Error('未配置 AI 最大令牌数，请在设置中配置 AI 引擎');
    } catch (error) {
      if (error instanceof Error && error.message.includes('未配置 AI 最大令牌数')) {
        throw error;
      }
      console.error('[WritingStyleLearningService] getMaxTokens error:', error);
      throw new Error('未配置 AI 最大令牌数，请在设置中配置 AI 引擎');
    }
  }

  private async getEngineSystemPrompt(): Promise<string> {
    try {
      const storageService = getStorageService();
      const settings = storageService.getSettings();
      
      const engines = settings?.aiEngines || [];
      if (engines.length > 0) {
        const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];
        return activeEngine?.system_prompt || '';
      }
      
      return '';
    } catch (error) {
      console.error('[WritingStyleLearningService] getEngineSystemPrompt error:', error);
      return '';
    }
  }

  private enrichSystemPrompt(messages: { role: string; content: string }[], engineSystemPrompt: string): { role: string; content: string }[] {
    if (!engineSystemPrompt || !engineSystemPrompt.trim()) {
      return messages;
    }
    
    return messages.map((msg, index) => {
      if (index === 0 && msg.role === 'system') {
        return {
          role: 'system',
          content: engineSystemPrompt.trim() + '\n\n' + msg.content
        };
      }
      return msg;
    });
  }

  private createError(code: string, message: string, details?: string) {
    return {
      code,
      message,
      details: details || '',
      recoverable: false
    };
  }

  validateFile(filePath: string, fileName: string): { valid: boolean; error?: string } {
    const ext = path.extname(fileName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return {
        valid: false,
        error: `不支持的文件格式: ${ext}，仅支持 ${ALLOWED_EXTENSIONS.join(', ')}`
      };
    }

    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        error: '文件不存在'
      };
    }

    const stats = fs.statSync(filePath);
    if (stats.size > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `文件大小超过限制 (${MAX_FILE_SIZE / (1024 * 1024)}MB)`
      };
    }

    return { valid: true };
  }

  readFile(filePath: string): string {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content;
  }

  sendProgress(taskId: string, progress: WritingStyleProgress): void {
    this.currentProgress = progress;
    
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send('writing:style:progress', { taskId, progress });
    }
    
    console.log(`[WritingStyleLearningService] 进度 [${taskId}]:`, progress.phase, progress.status, progress.message);
  }

  async analyzeChunk(text: string, chunkIndex: number, abortSignal?: AbortSignal): Promise<WritingStyleChunkAnalysis> {
    const baseUrl = await this.getBaseUrl();
    const apiKey = await this.getApiKey();
    const apiKeyTransmission = await this.getApiKeyTransmission();
    const modelName = await this.getModelName();
    const temperature = await this.getTemperature();
    const maxTokens = await this.getMaxTokens();
    const engineSystemPrompt = await this.getEngineSystemPrompt();

    if (!baseUrl) {
      throw this.createError('AI_SERVICE_UNAVAILABLE', '未配置 AI 服务地址');
    }

    const systemPrompt = `你是一位专业的文学分析师，擅长分析各种文本的写作风格。请仔细分析以下文本片段，并从以下几个维度进行详细分析：

1. 风格概述 (styleOverview): 整体写作风格的描述，包括语言风格、情感基调等
2. 核心技巧 (coreTechniques): 作者使用的主要写作技巧
3. 语言特征 (languageFeatures): 用词习惯、句式特点、修辞手法等
4. 叙事结构 (narrativeStructure): 叙事方式、段落组织、节奏控制等
5. 可模仿元素 (imitableElements): 可以被学习和模仿的具体写作元素`;

    const userPrompt = `请分析以下文本片段的写作风格：

---
${text}
---

请以 JSON 格式返回分析结果，包含以下字段：
- styleOverview: 对象，包含 overall_style(整体风格描述), tone(情感基调), pacing(节奏特点)
- coreTechniques: 字符串数组，列出核心写作技巧
- languageFeatures: 对象，包含 vocabulary(用词特点), sentence_structure(句式特点), rhetoric(修辞手法), dialogue_style(对话风格)
- narrativeStructure: 对象，包含 perspective(叙事视角), paragraph_organization(段落组织), rhythm_control(节奏控制), transition_method(过渡方式)
- imitableElements: 对象，包含 learnable_techniques(可学习技巧), pattern_examples(模式示例), application_scenarios(适用场景)
- partialReport: 字符串，该片段的详细分析报告`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const enrichedMessages = this.enrichSystemPrompt(messages, engineSystemPrompt);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const requestBody: Record<string, any> = {
      model: modelName,
      messages: enrichedMessages,
      temperature: temperature,
      max_tokens: maxTokens,
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
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(
        'ANALYSIS_FAILED',
        `AI 请求失败: ${response.status} ${response.statusText}`,
        errorText
      );
    }

    const rawContent = await this.readStreamResponse(response, abortSignal);

    if (!rawContent && !abortSignal?.aborted) {
      throw this.createError('ANALYSIS_FAILED', 'AI 返回内容为空');
    }

    return this.parseChunkAnalysis(rawContent, chunkIndex);
  }

  private async readStreamResponse(response: Response, abortSignal?: AbortSignal): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Stream reader not available');
    }

    const decoder = new TextDecoder();
    let accumulatedData = '';
    let fullContent = '';

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

        const completeDataLines = dataLines.length > 0 ? dataLines.slice(0, -1) : [];

        for (const line of completeDataLines) {
          const parsed = this.parseSSELine(line);
          if (parsed) {
            fullContent += parsed;
          }
        }
      }

      if (accumulatedData.length > 0) {
        const lines = accumulatedData.split('\n');
        const dataLines = lines.filter(line => {
          const trimmed = line.trim();
          return trimmed.startsWith('data: ') && trimmed.substring(6).trim() !== '[DONE]';
        });

        for (const line of dataLines) {
          const parsed = this.parseSSELine(line);
          if (parsed) {
            fullContent += parsed;
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return fullContent;
      }
      throw error;
    } finally {
      reader.releaseLock();
    }

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
    } catch {
      return null;
    }
  }

  private parseChunkAnalysis(rawContent: string, chunkIndex: number): WritingStyleChunkAnalysis {
    let jsonStr = rawContent.trim();

    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/;
    const match = jsonStr.match(codeBlockRegex);
    if (match && match[1]) {
      jsonStr = match[1].trim();
    }

    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        chunkIndex,
        styleOverview: parsed.styleOverview || {},
        coreTechniques: parsed.coreTechniques || [],
        languageFeatures: parsed.languageFeatures || {},
        narrativeStructure: parsed.narrativeStructure || {},
        imitableElements: parsed.imitableElements || {},
        partialReport: parsed.partialReport || rawContent
      };
    } catch {
      return {
        chunkIndex,
        styleOverview: {},
        coreTechniques: [],
        languageFeatures: {},
        narrativeStructure: {},
        imitableElements: {},
        partialReport: rawContent
      };
    }
  }

  async integrateResults(chunkAnalyses: WritingStyleChunkAnalysis[], abortSignal?: AbortSignal): Promise<WritingStyleAnalysis> {
    const baseUrl = await this.getBaseUrl();
    const apiKey = await this.getApiKey();
    const apiKeyTransmission = await this.getApiKeyTransmission();
    const modelName = await this.getModelName();
    const temperature = await this.getTemperature();
    const maxTokens = await this.getMaxTokens();
    const engineSystemPrompt = await this.getEngineSystemPrompt();

    if (!baseUrl) {
      throw this.createError('AI_SERVICE_UNAVAILABLE', '未配置 AI 服务地址');
    }

    const summaries = chunkAnalyses.map((a, i) => 
      `片段 ${i + 1} 分析摘要:\n${a.partialReport}`
    ).join('\n\n---\n\n');

    const systemPrompt = `你是一位资深的文学风格分析专家。你的任务是根据多个文本片段的分析结果，生成一份全面的写作风格综合报告。

请整合以下信息，生成一份连贯、完整的写作风格分析报告。报告应该：
1. 识别所有片段中的共同风格特征
2. 总结作者的核心写作技巧
3. 提炼出可模仿的关键元素
4. 提供详细的学习建议`;

    const userPrompt = `以下是 ${chunkAnalyses.length} 个文本片段的分析结果，请综合生成一份完整的写作风格报告：

${summaries}

请以 JSON 格式返回综合分析报告，包含以下字段：
- styleOverview: 对象，包含 overall_style(整体风格), tone(情感基调), pacing(节奏特点), emotional_expression(情感表达方式), descriptive_style(描写风格)
- coreTechniques: 字符串数组，列出核心写作技巧（至少5项）
- languageFeatures: 对象，包含 vocabulary(用词特点), sentence_structure(句式特点), rhetoric(修辞手法), dialogue_style(对话风格), descriptive_language(描写语言)
- narrativeStructure: 对象，包含 perspective(叙事视角), paragraph_organization(段落组织), rhythm_control(节奏控制), transition_method(过渡方式), plot_arrangement(情节安排)
- imitableElements: 对象，包含 learnable_techniques(可学习技巧), pattern_examples(模式示例), application_scenarios(适用场景), practice_suggestions(练习建议)
- fullReport: 字符串，完整的写作风格分析报告（Markdown格式）`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const enrichedMessages = this.enrichSystemPrompt(messages, engineSystemPrompt);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const requestBody: Record<string, any> = {
      model: modelName,
      messages: enrichedMessages,
      temperature: temperature,
      max_tokens: maxTokens,
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
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(
        'INTEGRATION_FAILED',
        `AI 请求失败: ${response.status} ${response.statusText}`,
        errorText
      );
    }

    const rawContent = await this.readStreamResponse(response, abortSignal);

    if (!rawContent && !abortSignal?.aborted) {
      throw this.createError('INTEGRATION_FAILED', 'AI 返回内容为空');
    }

    return this.parseIntegrationResult(rawContent);
  }

  private parseIntegrationResult(rawContent: string): WritingStyleAnalysis {
    let jsonStr = rawContent.trim();

    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/;
    const match = jsonStr.match(codeBlockRegex);
    if (match && match[1]) {
      jsonStr = match[1].trim();
    }

    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        styleOverview: parsed.styleOverview || {},
        coreTechniques: parsed.coreTechniques || [],
        languageFeatures: parsed.languageFeatures || {},
        narrativeStructure: parsed.narrativeStructure || {},
        imitableElements: parsed.imitableElements || {},
        fullReport: parsed.fullReport || rawContent
      };
    } catch {
      return {
        styleOverview: {},
        coreTechniques: [],
        languageFeatures: {},
        narrativeStructure: {},
        imitableElements: {},
        fullReport: rawContent
      };
    }
  }

  async startLearning(request: WritingStyleLearningRequest, taskId: string): Promise<WritingStyleResource> {
    const abortController = new AbortController();
    this.activeLearningTasks.set(taskId, abortController);

    try {
      const validation = this.validateFile(request.filePath, request.fileName);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      this.sendProgress(taskId, {
        phase: WritingStylePhase.FILE_READING,
        currentChunk: 0,
        totalChunks: 0,
        status: WritingStyleStatus.PROCESSING,
        message: `正在读取文件: ${request.fileName}`
      });

      const fileContent = this.readFile(request.filePath);

      this.sendProgress(taskId, {
        phase: WritingStylePhase.TEXT_SPLITTING,
        currentChunk: 0,
        totalChunks: 0,
        status: WritingStyleStatus.PROCESSING,
        message: '正在分割文本...'
      });

      const chunks = textSplitterService.splitText(fileContent);
      const totalChunks = chunks.length;

      this.sendProgress(taskId, {
        phase: WritingStylePhase.TEXT_SPLITTING,
        currentChunk: 0,
        totalChunks,
        status: WritingStyleStatus.PROCESSING,
        message: `文本已分割为 ${totalChunks} 个片段`
      });

      const chunkAnalyses: WritingStyleChunkAnalysis[] = [];

      this.sendProgress(taskId, {
        phase: WritingStylePhase.BATCH_ANALYSIS,
        currentChunk: 0,
        totalChunks,
        status: WritingStyleStatus.ANALYZING,
        message: `开始分析片段 0/${totalChunks}`
      });

      for (let i = 0; i < totalChunks; i++) {
        if (abortController.signal.aborted) {
          console.log(`[WritingStyleLearningService] 任务 ${taskId} 已被取消`);
          throw new Error('任务已取消');
        }

        this.sendProgress(taskId, {
          phase: WritingStylePhase.BATCH_ANALYSIS,
          currentChunk: i + 1,
          totalChunks,
          status: WritingStyleStatus.ANALYZING,
          message: `正在分析片段 ${i + 1}/${totalChunks}`
        });

        const chunkAnalysis = await this.analyzeChunk(
          chunks[i].content,
          i,
          abortController.signal
        );

        chunkAnalyses.push(chunkAnalysis);
      }

      this.sendProgress(taskId, {
        phase: WritingStylePhase.RESULT_INTEGRATION,
        currentChunk: totalChunks,
        totalChunks,
        status: WritingStyleStatus.INTEGRATING,
        message: '正在整合分析结果...'
      });

      const integratedAnalysis = await this.integrateResults(
        chunkAnalyses,
        abortController.signal
      );

      const resourceId = `style_${Date.now()}`;
      const resource: WritingStyleResource = {
        id: resourceId,
        name: request.fileName.replace(/\.txt$/i, ''),
        sourceFile: request.filePath,
        fileSize: request.fileSize,
        analysis: integratedAnalysis,
        createdAt: Date.now(),
        status: WritingStyleStatus.COMPLETED,
        progress: {
          phase: WritingStylePhase.COMPLETED,
          currentChunk: totalChunks,
          totalChunks,
          status: WritingStyleStatus.COMPLETED,
          message: '分析完成'
        }
      };

      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        win.webContents.send('writing:style:complete', { taskId, resource });
      }

      await this.saveResource(resource);

      this.activeLearningTasks.delete(taskId);
      
      return resource;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[WritingStyleLearningService] 任务 ${taskId} 失败:`, errorMessage);

      const errorResource: WritingStyleResource = {
        id: `style_${Date.now()}`,
        name: request.fileName.replace(/\.txt$/i, ''),
        sourceFile: request.filePath,
        fileSize: request.fileSize,
        analysis: null,
        createdAt: Date.now(),
        status: WritingStyleStatus.FAILED,
        progress: {
          phase: WritingStylePhase.COMPLETED,
          currentChunk: 0,
          totalChunks: 0,
          status: WritingStyleStatus.FAILED,
          message: errorMessage
        }
      };

      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        win.webContents.send('writing:style:error', { taskId, error: errorMessage });
      }

      this.activeLearningTasks.delete(taskId);
      
      throw error;
    }
  }

  private async saveResource(resource: WritingStyleResource): Promise<void> {
    try {
      const stylesDir = this.getWritingStylesDir();
      if (!fs.existsSync(stylesDir)) {
        fs.mkdirSync(stylesDir, { recursive: true });
      }

      const resourcePath = path.join(stylesDir, `${resource.id}.json`);
      fs.writeFileSync(resourcePath, JSON.stringify(resource, null, 2), 'utf-8');

      const indexPath = path.join(stylesDir, 'writing-styles-index.json');
      let index: any = { version: '1.0', styles: [] };
      
      if (fs.existsSync(indexPath)) {
        try {
          index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        } catch {
          index = { version: '1.0', styles: [] };
        }
      }

      const existingIndex = index.styles.findIndex((s: any) => s.id === resource.id);
      if (existingIndex >= 0) {
        index.styles[existingIndex] = {
          id: resource.id,
          name: resource.name,
          createdAt: resource.createdAt,
          status: resource.status
        };
      } else {
        index.styles.push({
          id: resource.id,
          name: resource.name,
          createdAt: resource.createdAt,
          status: resource.status
        });
      }

      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
      
      console.log(`[WritingStyleLearningService] 资源已保存: ${resource.name}`);
    } catch (error) {
      console.error('[WritingStyleLearningService] 保存资源失败:', error);
    }
  }

  cancelLearning(taskId: string): boolean {
    const controller = this.activeLearningTasks.get(taskId);
    if (controller) {
      controller.abort();
      this.activeLearningTasks.delete(taskId);
      console.log(`[WritingStyleLearningService] 任务已取消: ${taskId}`);
      return true;
    }
    return false;
  }

  getActiveTaskIds(): string[] {
    return Array.from(this.activeLearningTasks.keys());
  }
}

export const writingStyleLearningService = new WritingStyleLearningService();
