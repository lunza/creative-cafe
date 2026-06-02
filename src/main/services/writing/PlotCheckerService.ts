import {
  PlotCheckDimension,
  PlotCheckIssue,
  PlotCheckReport,
  DimensionScore,
  IssueSeverity,
  PLOT_CHECK_DIMENSION_LABELS,
  NovelType,
  WritingStyle,
  WritingError,
  WritingErrorCode,
  GeneratedOutline,
  WritingResourceConfig,
  LogicContradictionType,
  LogicCheckIssue,
  LogicCheckResult,
  LOGIC_CONTRADICTION_TYPE_LABELS,
  AutoFixDiff,
  AutoFixResult,
  QuickFixSuggestion
} from '../../../shared/types/writing.types';
import { AI_CHECK_TIMEOUT } from '../../../shared/constants/writing.constants';
import { getStorageService } from '../storageService';
import { writingResourceManager } from '../WritingResourceManager';
import { WorldBookContext, CharacterCardContext } from '../../../shared/types/writing.types';
import { addLog } from '../memory/chatLogService';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface PlotCheckRequestData {
  projectId: string;
  chapterIndex: number;
  content: string;
  outline: GeneratedOutline | null;
  resources: WritingResourceConfig;
  novelType?: NovelType;
  writingStyle?: WritingStyle;
  modelConfig?: ModelConfig;
  previousChapters?: {
    index: number;
    title: string;
    content: string;
  }[];
  writingTableData?: {
    tableConfig?: {
      associatedTemplateId: string;
      associatedTemplateName: string;
    };
    sheets?: string[];
    headers?: Record<string, string[]>;
    data?: Record<string, Record<string, any>[]>;
    sheetDescriptions?: Record<string, string>;
  };
}

const AI_CHECK_TIMEOUT = 0; // 0 = 无超时限制

export class PlotCheckerService {
  private async getConfig(): Promise<{ baseUrl: string; apiKey: string; apiKeyTransmission: string; model: string }> {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    const engines = settings?.aiEngines || [];
    const activeEngine = engines.find((e: any) => e.id === settings?.activeEngineId) || engines[0];

    if (!activeEngine?.model_name) {
      throw new Error('未配置 AI 模型名称，请在设置中配置 AI 引擎');
    }

    return {
      baseUrl: activeEngine?.api_url || settings?.ai?.baseUrl || '',
      apiKey: activeEngine?.api_key || settings?.ai?.apiKey || '',
      apiKeyTransmission: activeEngine?.api_key_transmission || 'header',
      model: activeEngine.model_name
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

  private buildCheckPrompt(request: PlotCheckRequestData): string {
    const chapterOutline = request.outline?.chapters?.find(ch => ch.index === request.chapterIndex);
    
    let contextParts = '';
    
    if (chapterOutline) {
      contextParts += `## 本章大纲\n- 标题: ${chapterOutline.title}\n- 摘要: ${chapterOutline.summary}\n`;
      if (chapterOutline.keyPlotPoints && chapterOutline.keyPlotPoints.length > 0) {
        contextParts += `- 关键情节: ${chapterOutline.keyPlotPoints.join('、')}\n`;
      }
      contextParts += '\n';
    }

    if (request.previousChapters && request.previousChapters.length > 0) {
      contextParts += '## 前文章节\n';
      for (const prev of request.previousChapters.slice(-2)) {
        contextParts += `### ${prev.title}\n${prev.content}\n\n`;
      }
    }

    const tableContext = this.buildTableContextForPrompt(request);
    if (tableContext) {
      contextParts += tableContext + '\n';
    }

    const unifiedPrompt = `你是一个专业的小说编辑和质量检查助手。请对以下章节内容进行多维度检查，识别可能的设定不一致、情节矛盾（吃书）、设定遗漏（吞设定）、逻辑矛盾等问题。

## 剧情多维度检测
请从以下维度检查章节内容：
1. 大纲一致性（outline_consistency）：章节内容是否与大纲规划一致，关键情节是否覆盖
2. 世界书合规性（worldbook_compliance）：是否遵循已建立的世界观设定和规则
3. 角色一致性（character_consistency）：角色性格、行为、身份是否与设定一致
4. 写作风格（writing_style）：文笔、节奏、表达是否符合要求的写作风格
5. 剧情连续性（plot_continuity）：与前文章节的情节、设定是否连贯

## 逻辑矛盾检测
请同时检测以下类型的逻辑矛盾：
1. 物品状态矛盾：已被消耗/使用的物品在后续情节中无合理解释地再次出现；如角色有两个面包，吃掉了一个，后续仍旧是两个面包，这是不合理的逻辑
2. 经济系统矛盾：已明确花费或损失的金钱/资源在无合理来源情况下重新出现；如角色一共有20元，花费了5元，后面又拿出20元，这是不合理的逻辑
3. 角色状态矛盾：已确认死亡/重伤/受伤的角色在无合理解释情况下突然复活或恢复；如角色摔了一跤导致腿骨折，后续又能自由行动，这是不合理的逻辑
4. 物理规律矛盾：明显违背基本物理定律的情节发展；如起风时硬币应掉落在地上，而不是在空中飞舞；纸币应该飞舞在空中而不是掉在地上
5. 剧情设定矛盾：与已建立的世界观设定或规则相冲突的情节
6. 数学逻辑矛盾：包含明显数学计算错误或数量关系矛盾的情节；如20-4.85=15.15，10+3.2=13.2，而不是其他数字

## 待检测文章内容
${contextParts}

## 输出格式要求
请严格按照以下 JSON 格式返回检查结果（不要包含markdown代码块标记）：
{
  "overall_score": 80,
  "dimension_scores": {
    "outline_consistency": { "score": 85, "issues": [...] },
    "worldbook_compliance": { "score": 90, "issues": [...] },
    "character_consistency": { "score": 80, "issues": [...] },
    "writing_style": { "score": 85, "issues": [...] },
    "plot_continuity": { "score": 75, "issues": [...] }
  },
  "logic_issues": [
    {
      "title": "简短问题标题",
      "type": "item_state",
      "severity": "medium",
      "description": "...",
      "analysis": "...",
      "suggestion": "...",
      "quickFixSuggestion": {
        "originalText": "需要替换的原文片段",
        "fixedText": "修改后的文本",
        "reason": "修正理由"
      }
    }
  ]
}

对于每个识别出的问题（包括剧情维度和逻辑矛盾），请同时提供 quickFixSuggestion 字段，包含：
- originalText: 需要被替换的原文片段（必须是章节内容中一字不差的原文，**必须包含所有标点符号、换行符、特殊符号**，与原文完全一致才能执行替换）
- fixedText: 修改后的文本（可以比原文长或短）
- reason: 修正理由（说明语法、逻辑、表达等方面的改进原因）

注意：quickFixSuggestion中的originalText必须是章节内容中一字不差的原文，否则无法执行替换。如果问题不涉及具体文本修改，可以将quickFixSuggestion设为null。

每个 issue（dimension_scores 中的 issues 数组元素和 logic_issues 数组元素）都必须包含 title 字段：
- title: 简短问题标题（不超过20字），是问题摘要，如"大纲伏笔描绘单薄"、"物品数量前后矛盾"、"角色行为与设定不符"、"前文事件遗漏"等

评分标准：
- 90-100: 优秀，无问题
- 70-89: 良好，有少量小问题
- 50-69: 一般，存在需要注意的问题
- 0-49: 较差，存在严重问题

严重程度：high（高）、medium（中）、low（低）
逻辑矛盾类型：item_state（物品状态）/ economic（经济系统）/ character_state（角色状态）/ physical_law（物理规律）/ plot_setting（剧情设定）/ mathematical（数学逻辑）`;

    return unifiedPrompt;
  }

  private async callAIService(
    messages: ChatMessage[],
    modelConfig: ModelConfig,
    timeoutMs: number
  ): Promise<string> {
    const config = await this.getConfig();

    if (!config.baseUrl) {
      throw new Error('未配置 AI 服务地址，请在设置中配置');
    }

    addLog(`【剧情检查】AI 请求配置: baseUrl=${config.baseUrl}, model=${modelConfig.model}, temperature=${modelConfig.temperature}, maxTokens=${modelConfig.maxTokens}`, 'debug');
    addLog(`【剧情检查】消息数量: ${messages.length}`, 'debug');
    
    addLog(`===== 【剧情检查】System Prompt 开始 =====`, 'debug');
    addLog(messages[0]?.content || '(无System Prompt)', 'debug');
    addLog(`===== 【剧情检查】System Prompt 结束 =====`, 'debug');
    
    addLog(`===== 【剧情检查】User Prompt 开始 =====`, 'debug');
    addLog(messages[1]?.content || '(无User Prompt)', 'debug');
    addLog(`===== 【剧情检查】User Prompt 结束 =====`, 'debug');

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
        addLog(`【剧情检查】API Key 传输方式: header (Bearer)`, 'debug');
      } else {
        requestBody.api_key = config.apiKey;
        addLog(`【剧情检查】API Key 传输方式: body`, 'debug');
      }
    }

    addLog(`【剧情检查】请求体: model=${requestBody.model}, temperature=${requestBody.temperature}, max_tokens=${requestBody.max_tokens}`, 'debug');
    addLog(`【剧情检查】请求 URL: ${config.baseUrl}/v1/chat/completions`, 'debug');

    const controller = new AbortController();
    const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      addLog(`【剧情检查】开始发送 AI 请求${timeoutMs > 0 ? ` (超时: ${timeoutMs / 1000}秒)` : ' (无超时限制)'}...`, 'info');
      const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        addLog(`【剧情检查】AI 请求失败: ${response.status} ${response.statusText}`, 'error');
        addLog(`【剧情检查】错误详情: ${errorText}`, 'error');
        addLog(`【剧情检查】请求 URL: ${config.baseUrl}/v1/chat/completions`, 'debug');
        addLog(`【剧情检查】请求体: ${JSON.stringify({ model: requestBody.model, temperature: requestBody.temperature, max_tokens: requestBody.max_tokens })}`, 'debug');
        throw new Error(`AI 请求失败: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      addLog(`===== 【剧情检查】AI 完整响应开始 =====`, 'debug');
      addLog(JSON.stringify(data, null, 2), 'debug');
      addLog(`===== 【剧情检查】AI 完整响应结束 =====`, 'debug');

      if (!content) {
        addLog(`【剧情检查】AI 返回内容为空`, 'error');
        throw new Error('AI 返回内容为空');
      }

      addLog(`===== 【剧情检查】AI 返回内容原文 开始 =====`, 'debug');
      addLog(content, 'debug');
      addLog(`===== 【剧情检查】AI 返回内容原文 结束 =====`, 'debug');
      return content;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        addLog(`【剧情检查】AI 请求超时（${timeoutMs / 1000}秒）`, 'error');
        throw new Error(`AI 请求超时（${timeoutMs / 1000}秒），请稍后重试`);
      }
      throw error;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  private parseCheckResponse(rawContent: string, chapterIndex: number, chapterContent?: string): PlotCheckReport {
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

    // 修复 AI 返回的中文引号问题：将中文引号替换为英文引号
    jsonStr = this.fixChineseQuotes(jsonStr);

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('[PlotChecker] JSON 解析失败:', parseError);
      console.error('[PlotChecker] 原始 JSON:', jsonStr);
      return this.createFallbackReport(chapterIndex);
    }

    const dimensions: DimensionScore[] = [];
    let totalIssues = 0;
    let highSeverityCount = 0;
    let mediumSeverityCount = 0;
    let lowSeverityCount = 0;
    let totalScore = 0;

    // 支持新格式（dimension_scores）和旧格式（顶层维度键）
    const dimensionData = parsed.dimension_scores || parsed;

    const dimensionKeys: { key: string; enum: PlotCheckDimension }[] = [
      { key: 'outline_consistency', enum: PlotCheckDimension.OUTLINE_CONSISTENCY },
      { key: 'worldbook_compliance', enum: PlotCheckDimension.WORLDBOOK_COMPLIANCE },
      { key: 'character_consistency', enum: PlotCheckDimension.CHARACTER_CONSISTENCY },
      { key: 'writing_style', enum: PlotCheckDimension.WRITING_STYLE },
      { key: 'plot_continuity', enum: PlotCheckDimension.PLOT_CONTINUITY }
    ];

    for (const { key, enum: dim } of dimensionKeys) {
      const data = dimensionData[key] || { score: 50, issues: [] };
      const issues: PlotCheckIssue[] = (data.issues || []).map((issue: any) => {
        let issueTitle = issue.title;
        if (!issueTitle || issueTitle.trim() === '') {
          const desc = issue.description || '';
          issueTitle = desc.substring(0, 20).replace(/[。！？,.!?…]+$/, '') || '未知问题';
          if (issueTitle.length < 2) {
            issueTitle = '未知问题';
          }
        }

        const origTextEntries: { snippet: string; start: number; end: number }[] = [];
        const refs: { type: string; name: string; summary: string }[] = [];

        if (chapterContent) {
          if (issue.position && issue.position.startIndex !== undefined && issue.position.endIndex !== undefined) {
            const posStart = Math.max(0, issue.position.startIndex);
            const posEnd = Math.min(chapterContent.length, issue.position.endIndex);
            if (posStart < posEnd && posStart < chapterContent.length) {
              const ctx = 40;
              const start = Math.max(0, posStart - ctx);
              const end = Math.min(chapterContent.length, posEnd + ctx);
              origTextEntries.push({
                snippet: chapterContent.substring(start, end),
                start,
                end
              });
            }
          }

          if (origTextEntries.length === 0) {
            const keywords = this.extractKeywords(issue.description, 3);
            for (const kw of keywords) {
              const matchIdx = chapterContent.indexOf(kw);
              if (matchIdx !== -1) {
                const ctx = 80;
                const start = Math.max(0, matchIdx - ctx);
                const end = Math.min(chapterContent.length, matchIdx + kw.length + ctx);
                const snippet = chapterContent.substring(start, end);
                const alreadyExists = origTextEntries.some(e =>
                  Math.abs(e.start - start) < 20
                );
                if (!alreadyExists) {
                  origTextEntries.push({ snippet, start, end });
                }
                if (origTextEntries.length >= 2) break;
              }
            }
          }
        }

        if (issue.references && Array.isArray(issue.references)) {
          for (const ref of issue.references) {
            refs.push({
              type: ref.type || 'unknown',
              name: ref.name || '未知来源',
              summary: ref.summary || ''
            });
          }
        }

        return {
          dimension: dim,
          severity: issue.severity || 'low',
          title: issueTitle,
          description: issue.description || '',
          suggestion: issue.suggestion || '',
          position: issue.position || undefined,
          originalText: origTextEntries.length > 0 ? origTextEntries : undefined,
          references: refs.length > 0 ? refs : undefined,
          quickFixable: !!issue.quickFixSuggestion,
          quickFixSuggestion: issue.quickFixSuggestion ? this.validateQuickFixSuggestion(issue.quickFixSuggestion, chapterContent) : undefined
        };
      });

      dimensions.push({
        dimension: dim,
        score: data.score || 50,
        maxScore: 100,
        issues,
        passed: (data.score || 0) >= 70
      });

      for (const issue of issues) {
        totalIssues++;
        if (issue.severity === 'high') highSeverityCount++;
        else if (issue.severity === 'medium') mediumSeverityCount++;
        else lowSeverityCount++;
      }

      totalScore += data.score || 50;
    }

    // 优先使用 AI 返回的 overall_score，否则计算平均值
    const overallScore = parsed.overall_score || Math.round(totalScore / dimensions.length);

    const logicIssuesRaw = parsed.logic_check_result?.logic_issues || parsed.logic_issues || [];
    const logicIssues: LogicCheckIssue[] = logicIssuesRaw.map((issue: any) => {
      let issueTitle = issue.title;
      if (!issueTitle || issueTitle.trim() === '') {
        const desc = issue.description || '';
        issueTitle = desc.substring(0, 20).replace(/[。！？,.!?…]+$/, '') || '未知问题';
        if (issueTitle.length < 2) {
          issueTitle = '未知问题';
        }
      }

      return {
        title: issueTitle,
        type: issue.type || 'plot_setting',
        severity: issue.severity || 'low',
        description: issue.description || '',
        analysis: issue.analysis || '',
        suggestion: issue.suggestion || '',
        chapterIndex: chapterIndex
      };
    });

    let logicHighCount = 0;
    let logicMediumCount = 0;
    let logicLowCount = 0;
    for (const issue of logicIssues) {
      if (issue.severity === 'high') logicHighCount++;
      else if (issue.severity === 'medium') logicMediumCount++;
      else logicLowCount++;
    }

    return {
      overallScore,
      dimensions,
      totalIssues,
      highSeverityCount,
      mediumSeverityCount,
      lowSeverityCount,
      logicCheckResult: {
        issues: logicIssues,
        totalIssues: logicIssues.length,
        highSeverityCount: logicHighCount,
        mediumSeverityCount: logicMediumCount,
        lowSeverityCount: logicLowCount
      },
      checkedAt: Date.now(),
      chapterIndex: chapterIndex
    };
  }

  private validateQuickFixSuggestion(suggestion: any, chapterContent: string): QuickFixSuggestion | undefined {
    if (!suggestion || !suggestion.originalText || !suggestion.fixedText) {
      return undefined;
    }
    if (typeof suggestion.originalText !== 'string' || typeof suggestion.fixedText !== 'string') {
      return undefined;
    }
    if (!chapterContent || typeof chapterContent !== 'string') {
      return undefined;
    }

    const validated: QuickFixSuggestion = {
      originalText: suggestion.originalText,
      fixedText: suggestion.fixedText,
      reason: suggestion.reason || '无'
    };

    // 首先尝试精确匹配
    let matchIndex = chapterContent.indexOf(validated.originalText);
    if (matchIndex !== -1) {
      validated.position = {
        startIndex: matchIndex,
        endIndex: matchIndex + validated.originalText.length
      };
      return validated;
    }

    // 如果精确匹配失败，尝试模糊匹配（去除首尾空白）
    const trimmedOriginalText = validated.originalText.trim();
    if (trimmedOriginalText && trimmedOriginalText !== validated.originalText) {
      matchIndex = chapterContent.indexOf(trimmedOriginalText);
      if (matchIndex !== -1) {
        validated.originalText = trimmedOriginalText; // 使用清理后的文本
        validated.position = {
          startIndex: matchIndex,
          endIndex: matchIndex + trimmedOriginalText.length
        };
        return validated;
      }
    }

    // 最后尝试部分匹配（取originalText的前缀和后缀进行搜索）
    if (validated.originalText.length > 20) { // 只对较长的文本尝试部分匹配
      const prefix = validated.originalText.substring(0, 10).trim();
      const suffix = validated.originalText.substring(validated.originalText.length - 10).trim();
      
      const prefixIndex = chapterContent.indexOf(prefix);
      if (prefixIndex !== -1) {
        // 在前缀位置之后寻找后缀
        const suffixIndex = chapterContent.indexOf(suffix, prefixIndex + prefix.length);
        if (suffixIndex !== -1 && suffixIndex > prefixIndex) {
          // 提取两个位置之间的文本作为匹配内容
          const matchedText = chapterContent.substring(prefixIndex, suffixIndex + suffix.length);
          if (matchedText.includes(validated.originalText) || 
              validated.originalText.includes(matchedText.substring(0, matchedText.length))) {
            validated.position = {
              startIndex: prefixIndex,
              endIndex: suffixIndex + suffix.length
            };
            return validated;
          }
        }
      }
    }

    // 原文本未找到，标记为不可快速修正
    return undefined;
  }

  private extractKeywords(description: string, maxCount: number): string[] {
    const keywords: string[] = [];
    if (!description || typeof description !== 'string') {
      return keywords;
    }
    const chinesePhrases = description.match(/[\u4e00-\u9fff]{2,6}/g);
    if (chinesePhrases) {
      const filtered = chinesePhrases.filter(p =>
        p.length >= 2 && !['问题', '描述', '情节', '建议', '出现', '存在', '可能', '一个', '这种', '需要'].includes(p)
      );
      const seen = new Set<string>();
      for (const phrase of filtered) {
        if (!seen.has(phrase) && keywords.length < maxCount) {
          seen.add(phrase);
          keywords.push(phrase);
        }
      }
    }
    return keywords;
  }

  private createFallbackReport(chapterIndex: number): PlotCheckReport {
    return {
      overallScore: 0,
      dimensions: [],
      totalIssues: 0,
      highSeverityCount: 0,
      mediumSeverityCount: 0,
      lowSeverityCount: 0,
      logicCheckResult: {
        issues: [],
        totalIssues: 0,
        highSeverityCount: 0,
        mediumSeverityCount: 0,
        lowSeverityCount: 0
      },
      checkedAt: Date.now(),
      chapterIndex: chapterIndex,
      error: 'AI 返回格式无效，无法解析检查结果'
    };
  }

  // 将 JSON 字符串中的中文引号替换为英文引号，以修复 AI 返回非标准 JSON 的问题
  private fixChineseQuotes(jsonStr: string): string {
    let result = jsonStr;
    // 替换中文双引号（左引号和右引号都替换为英文双引号）
    result = result.replace(/"/g, '"');
    result = result.replace(/"/g, '"');
    return result;
  }

  private buildTableContextForPrompt(request: PlotCheckRequestData): string {
    if (!request.writingTableData) {
      return '';
    }

    const { writingTableData } = request;
    const sheets = writingTableData.sheets || [];
    if (sheets.length === 0) {
      return '';
    }

    let context = `## 历史剧情表格数据（重要参考资料）\n`;
    context += `以下表格记录了之前章节中已建立的角色、物品、事件、地点等关键信息，请在检查当前章节时作为参考，确保剧情走向和细节与前文一致。\n\n`;

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

      sheetData.forEach((row: any, rowIndex: number) => {
        const rowDisplay = rowIndex + 1;
        const uniqueId = row['唯一id'];

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

  private performRuleBasedValidation(content: string, previousContent?: string): LogicCheckIssue[] {
    const issues: LogicCheckIssue[] = [];
    
    // 1. 检测可能的角色状态矛盾（死亡后再次出现）
    const deathKeywords = ['死了', '死亡', '死去', '去世', '丧命', '身亡', '毙命', '断气'];
    const reviveKeywords = ['复活', '重新站起', '又出现了', '再次出现', '活了过来', '苏醒了'];
    
    let deadEntities: string[] = [];
    for (const keyword of deathKeywords) {
      const regex = new RegExp(`([^，。、,\\.\\n]{1,10})${keyword}`, 'g');
      let match;
      while ((match = regex.exec(content)) !== null) {
        const entity = match[1].trim();
        if (entity && entity.length > 1 && entity.length < 20) {
          deadEntities.push(entity);
        }
      }
    }
    
    for (const entity of deadEntities) {
      for (const reviveKeyword of reviveKeywords) {
        const reviveRegex = new RegExp(`${entity}.*?${reviveKeyword}|${reviveKeyword}.*?${entity}`, 'gi');
        if (reviveRegex.test(content)) {
          const posIndex = content.indexOf(entity);
          const ctx = 40;
          const snippetStart = Math.max(0, posIndex - ctx);
          const snippetEnd = Math.min(content.length, posIndex + entity.length + ctx);

          issues.push({
            type: 'character_state',
            severity: 'high',
            description: `角色"${entity}"可能存在状态矛盾：前文已确认死亡，但后续又出现复活相关描述`,
            analysis: `检测到"${entity}"与死亡关键词和复活关键词同时出现在文本中，需要确认是否为合理的情节发展（如复活设定、梦境、回忆等）`,
            suggestion: `如果"${entity}"确实已死亡且无复活设定，请移除或修改复活相关描述；如有复活设定，请确保在前文中明确说明`,
            chapterIndex: 0,
            originalText: [{
              snippet: content.substring(snippetStart, snippetEnd),
              start: snippetStart,
              end: snippetEnd
            }]
          });
        }
      }
    }

    // 2. 检测可能的物品状态矛盾（已使用后再次出现）
    const consumeKeywords = ['吃掉', '喝掉', '用完', '消耗', '用尽', '烧毁', '打碎', '破坏', '丢弃'];
    const reappearKeywords = ['又拿出', '再次出现', '重新', '又找到', '还在', '依然存在'];
    
    let consumedItems: string[] = [];
    for (const keyword of consumeKeywords) {
      const regex = new RegExp(`([^，。、,\\.\\n]{1,10})${keyword}`, 'g');
      let match;
      while ((match = regex.exec(content)) !== null) {
        const item = match[1].trim();
        if (item && item.length > 1 && item.length < 20) {
          consumedItems.push(item);
        }
      }
    }

    for (const item of consumedItems) {
      for (const reappearKeyword of reappearKeywords) {
        const reappearRegex = new RegExp(`${item}.*?${reappearKeyword}|${reappearKeyword}.*?${item}`, 'gi');
        if (reappearRegex.test(content)) {
          const posIndex = content.indexOf(item);
          const ctx = 40;
          const snippetStart = Math.max(0, posIndex - ctx);
          const snippetEnd = Math.min(content.length, posIndex + item.length + ctx);

          issues.push({
            type: 'item_state',
            severity: 'medium',
            description: `物品"${item}"可能存在状态矛盾：前文已被消耗/使用，但后续又出现`,
            analysis: `检测到"${item}"与消耗关键词和重现关键词同时出现在文本中，需要确认物品是否真的被完全消耗`,
            suggestion: `如果"${item}"确实已被消耗，请移除重现相关描述；如未完全消耗，请明确说明剩余量或状态`,
            chapterIndex: 0,
            originalText: [{
              snippet: content.substring(snippetStart, snippetEnd),
              start: snippetStart,
              end: snippetEnd
            }]
          });
        }
      }
    }

    // 3. 检测数量关系矛盾（数字前后不一致）
    const numberPattern = /(\d+)\s*(个|只|条|件|把|张|块|颗|枚|根|支|瓶|杯|碗|盘|盒|袋|包|箱|桶|车|艘|架|门|面|幅|卷|册|本|篇|章|节|页|行|列|排|组|套|对|双|副|顶|件|条|个)/g;
    const numberedEntities: Map<string, number> = new Map();
    let numMatch;
    while ((numMatch = numberPattern.exec(content)) !== null) {
      const entity = content.substring(Math.max(0, numMatch.index - 15), numMatch.index).trim().replace(/[，。、,\.]/g, '');
      if (entity && entity.length > 1 && entity.length < 20) {
        numberedEntities.set(entity, parseInt(numMatch[1], 10));
      }
    }

    // 检查同一实体的数量是否有矛盾
    const entityCounts: Map<string, number[]> = new Map();
    for (const [entity, count] of numberedEntities) {
      if (!entityCounts.has(entity)) entityCounts.set(entity, []);
      entityCounts.get(entity)!.push(count);
    }
    
    for (const [entity, counts] of entityCounts) {
      if (counts.length > 1 && new Set(counts).size > 1) {
        const posIndex = content.indexOf(entity);
        const ctx = 40;
        const snippetStart = Math.max(0, posIndex - ctx);
        const snippetEnd = Math.min(content.length, posIndex + entity.length + ctx);

        issues.push({
          type: 'mathematical',
          severity: 'medium',
          description: `实体"${entity}"的数量存在矛盾：前文为 ${counts[0]}，后文为 ${counts[counts.length - 1]}`,
          analysis: `同一实体在文本中被赋予了不同的数量值，可能存在数量关系矛盾`,
          suggestion: `请统一"${entity}"的数量描述，确保前后一致`,
          chapterIndex: 0,
          originalText: [{
            snippet: content.substring(snippetStart, snippetEnd),
            start: snippetStart,
            end: snippetEnd
          }]
        });
      }
    }

    return issues;
  }

  async checkChapter(request: PlotCheckRequestData): Promise<PlotCheckReport> {
    addLog('===== 剧情检查: checkChapter 开始 =====', 'debug');
    addLog(`章节索引: ${request.chapterIndex}, 内容长度: ${request.content?.length || 0}`, 'debug');

    const config = await this.getConfig();
    addLog(`AI 配置: baseUrl=${config.baseUrl}, model=${config.model}`, 'debug');

    const systemPrompt = `你是一个专业的小说编辑和质量检查助手。请以JSON格式返回检查结果。`;
    const userPrompt = this.buildCheckPrompt(request);

    addLog(`【剧情检查】当前章节内容完整长度: ${request.content.length} 字符`, 'debug');
    if (request.previousChapters) {
      request.previousChapters.forEach((prev, idx) => {
        addLog(`【剧情检查】前文章节 ${prev.title} 内容长度: ${prev.content.length} 字符`, 'debug');
      });
    }

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

    const totalPromptLength = systemPrompt.length + userPrompt.length;
    addLog(`【剧情检查】完整提示词总长度: ${totalPromptLength} 字符`, 'debug');
    addLog(`模型配置: ${JSON.stringify(modelConfig)}`, 'debug');

    try {
      // 执行基于规则的逻辑验证
      const ruleBasedIssues = this.performRuleBasedValidation(request.content);
      addLog(`规则验证发现 ${ruleBasedIssues.length} 个潜在问题`, 'debug');

      const rawContent = await this.callAIService(messages, modelConfig, AI_CHECK_TIMEOUT);
      const report = this.parseCheckResponse(rawContent, request.chapterIndex, request.content);

      // 合并规则验证结果
      if (ruleBasedIssues.length > 0 && report.logicCheckResult) {
        const existingDescs = new Set(report.logicCheckResult.issues.map(i => i.description));
        for (const ruleIssue of ruleBasedIssues) {
          if (!existingDescs.has(ruleIssue.description)) {
            report.logicCheckResult.issues.push(ruleIssue);
            report.logicCheckResult.totalIssues++;
            if (ruleIssue.severity === 'high') report.logicCheckResult.highSeverityCount++;
            else if (ruleIssue.severity === 'medium') report.logicCheckResult.mediumSeverityCount++;
            else report.logicCheckResult.lowSeverityCount++;
          }
        }
        addLog(`合并后逻辑问题总数: ${report.logicCheckResult.totalIssues}`, 'debug');
      }

      report.chapterIndex = request.chapterIndex;
      addLog(`剧情检查完成: 综合评分=${report.overallScore}, 问题总数=${report.totalIssues}`, 'info');
      return report;
    } catch (error) {
      addLog(`剧情检查失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
      if (error instanceof Error && error.stack) {
        addLog(`错误堆栈: ${error.stack}`, 'debug');
      }
      throw error;
    }
  }

  private computeDiffs(original: string, fixed: string): AutoFixDiff[] {
    const diffs: AutoFixDiff[] = [];
    
    const origLines = original.split('\n');
    const fixedLines = fixed.split('\n');
    
    let diffStart = -1;
    let diffOrigLines: string[] = [];
    let diffFixedLines: string[] = [];
    
    for (let i = 0; i < Math.max(origLines.length, fixedLines.length); i++) {
      const origLine = origLines[i] || '';
      const fixedLine = fixedLines[i] || '';
      
      if (origLine !== fixedLine) {
        if (diffStart === -1) {
          diffStart = i;
          diffOrigLines = [origLine];
          diffFixedLines = [fixedLine];
        } else {
          diffOrigLines.push(origLine);
          diffFixedLines.push(fixedLine);
        }
      } else {
        if (diffStart !== -1) {
          diffs.push({
            originalText: diffOrigLines.join('\n'),
            fixedText: diffFixedLines.join('\n'),
            position: {
              startIndex: origLines.slice(0, diffStart).reduce((sum, l) => sum + l.length + 1, 0),
              endIndex: origLines.slice(0, diffStart + diffOrigLines.length).reduce((sum, l) => sum + l.length + 1, 0)
            }
          });
          diffStart = -1;
          diffOrigLines = [];
          diffFixedLines = [];
        }
      }
    }
    
    if (diffStart !== -1) {
      diffs.push({
        originalText: diffOrigLines.join('\n'),
        fixedText: diffFixedLines.join('\n'),
        position: {
          startIndex: origLines.slice(0, diffStart).reduce((sum, l) => sum + l.length + 1, 0),
          endIndex: origLines.slice(0, diffStart + diffOrigLines.length).reduce((sum, l) => sum + l.length + 1, 0)
        }
      });
    }
    
    return diffs;
  }

  async autoFixIssue(
    projectId: string,
    chapterIndex: number,
    content: string,
    issue: PlotCheckIssue | LogicCheckIssue,
    issueType: 'dimension' | 'logic' = 'dimension',
    modelConfig?: ModelConfig
  ): Promise<AutoFixResult> {
    addLog('===== 剧情检查: 自动修正开始 =====', 'debug');
    addLog(`章节索引: ${chapterIndex}`, 'debug');

    // 根据问题类型构建不同的问题描述
    const dimensionLabel = issueType === 'dimension' && (issue as PlotCheckIssue).dimension
      ? PLOT_CHECK_DIMENSION_LABELS[(issue as PlotCheckIssue).dimension] || (issue as PlotCheckIssue).dimension
      : null;
    const typeLabel = issueType === 'logic' && (issue as LogicCheckIssue).type
      ? LOGIC_CONTRADICTION_TYPE_LABELS[(issue as LogicCheckIssue).type] || (issue as LogicCheckIssue).type
      : null;
    const title = (issue as PlotCheckIssue).title || null;
    const description = issue.description;
    const suggestion = issue.suggestion || '';
    const analysis = (issue as LogicCheckIssue).analysis || null;
    const position = issue.position;

    if (issueType === 'dimension') {
      addLog(`维度: ${dimensionLabel}, 问题标题: ${title}`, 'debug');
    } else {
      addLog(`类型: ${typeLabel}, 问题描述: ${description}`, 'debug');
    }
    addLog(`问题描述: ${description}`, 'debug');

    const config = await this.getConfig();

    const systemPrompt = `你是一个专业的小说编辑和修订助手。你的任务是根据指出的问题，对章节内容进行定向修正。

要求：
1. 仅修正指出的问题，保持其他内容完全不变
2. 保持原有的写作风格、语气和叙事方式
3. 确保修正后的内容上下文连贯
4. 返回修正后的完整章节内容
5. 不要包含任何解释性文字，直接返回修正后的内容`;

    let problemInfo = '';
    if (dimensionLabel) {
      problemInfo += `- 维度: ${dimensionLabel}\n`;
    }
    if (typeLabel) {
      problemInfo += `- 类型: ${typeLabel}\n`;
    }
    problemInfo += `- 严重程度: ${issue.severity}\n`;
    if (title) problemInfo += `- 问题标题: ${title}\n`;
    problemInfo += `- 问题描述: ${description}\n`;
    if (analysis) problemInfo += `- 矛盾点分析: ${analysis}\n`;
    problemInfo += `- 改进建议: ${suggestion}\n`;
    if (position) {
      problemInfo += `- 问题位置: 第 ${position.startIndex} 到 ${position.endIndex} 字符\n`;
    }

    const userPrompt = `请对以下章节内容进行修正：

## 问题信息
${problemInfo}
## 当前章节内容
${content}

请根据上述问题和建议，对章节内容进行定向修正。返回修正后的完整章节内容，不要包含任何解释或标记。`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const engineConfig = await this.getEngineConfig();

    const effectiveModelConfig: ModelConfig = modelConfig || {
      model: config.model,
      temperature: engineConfig.temperature,
      maxTokens: engineConfig.maxTokens
    };

    addLog(`【自动修正】模型配置: ${JSON.stringify(effectiveModelConfig)}`, 'debug');

    try {
      const rawContent = await this.callAIService(messages, effectiveModelConfig, AI_CHECK_TIMEOUT);
      const fixedContent = rawContent.trim();
      
      addLog(`【自动修正】成功, 修正后内容长度: ${fixedContent.length}`, 'info');
      
      // 计算差异
      const diffs = this.computeDiffs(content, fixedContent);
      addLog(`修正差异数: ${diffs.length}`, 'debug');
      for (let i = 0; i < diffs.length; i++) {
        addLog(`  差异 ${i + 1}: "${diffs[i].originalText.substring(0, 50)}..." -> "${diffs[i].fixedText.substring(0, 50)}..."`, 'debug');
      }

      addLog('===== 剧情检查: 自动修正完成 =====', 'debug');
      addLog(`修正成功: true, 差异数: ${diffs.length}`, 'debug');

      return {
        success: true,
        fixedContent,
        diffs
      };
    } catch (error) {
      addLog(`【自动修正】失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
      return {
        success: false,
        fixedContent: content,
        diffs: [],
        error: error instanceof Error ? error.message : '修正失败'
      };
    }
  }

  async batchFixIssues(
    projectId: string,
    chapterIndex: number,
    content: string,
    issues: any[],
    modelConfig?: ModelConfig
  ): Promise<{ success: boolean; fixedContent: string; results: { index: number; success: boolean; error?: string }[]; error?: string }> {
    addLog('===== 剧情检查: 批量修正开始 =====', 'debug');
    addLog(`章节索引: ${chapterIndex}, 问题数量: ${issues.length}`, 'debug');

    if (!issues || issues.length === 0) {
      return { success: true, fixedContent: content, results: [] };
    }

    const config = await this.getConfig();

    const systemPrompt = `你是一个专业的小说编辑和修订助手。你的任务是根据列出的一组问题，对章节内容进行精准的批量修正。

重要规则：
1. 仅修正列出的问题，保持其他内容完全不变
2. 保持原有的写作风格、语气和叙事方式
3. 确保修正后的内容上下文连贯
4. 保持章节的段落结构和格式不变
5. 直接返回修正后的完整章节内容，不要包含任何解释、标记或注释

对于每个问题，请按照描述和建议进行修正。如果一个问题涉及原文片段，请精确替换该片段。`;

    const issuesDescription = issues.map((issue: any, idx: number) => {
      let desc = `### 问题 ${idx + 1}\n`;
      if (issue.dimension) {
        desc += `- 维度: ${PLOT_CHECK_DIMENSION_LABELS[issue.dimension] || issue.dimension}\n`;
      }
      if (issue.type) {
        desc += `- 类型: ${LOGIC_CONTRADICTION_TYPE_LABELS[issue.type] || issue.type}\n`;
      }
      desc += `- 严重程度: ${issue.severity}\n`;
      if (issue.title) desc += `- 标题: ${issue.title}\n`;
      desc += `- 描述: ${issue.description}\n`;
      if (issue.analysis) desc += `- 分析: ${issue.analysis}\n`;
      desc += `- 建议: ${issue.suggestion}\n`;

      if (issue.originalText && issue.originalText.length > 0) {
        desc += `- 相关原文:\n`;
        for (const ot of issue.originalText) {
          desc += `  \`\`\`\n  ${ot.snippet}\n  \`\`\`\n`;
        }
      }
      if (issue.references && issue.references.length > 0) {
        desc += `- 参考资料:\n`;
        for (const ref of issue.references) {
          desc += `  - [${ref.type}] ${ref.name}: ${ref.summary}\n`;
        }
      }
      if (issue.position) {
        desc += `- 位置: 第 ${issue.position.startIndex} 到 ${issue.position.endIndex} 字符\n`;
      }
      return desc;
    }).join('\n\n');

    const userPrompt = `请对以下章节内容进行批量修正：

## 问题列表（共 ${issues.length} 个）
${issuesDescription}

## 当前章节内容
${content}

请根据上述问题列表，对章节内容进行批量修正。返回修正后的完整章节内容，不要包含任何解释或标记。`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const engineConfig = await this.getEngineConfig();

    const effectiveModelConfig: ModelConfig = modelConfig || {
      model: config.model,
      temperature: engineConfig.temperature,
      maxTokens: Math.min(engineConfig.maxTokens * 2, 8000)
    };

    addLog(`【批量修正】模型配置: ${JSON.stringify(effectiveModelConfig)}`, 'debug');

    try {
      const rawContent = await this.callAIService(messages, effectiveModelConfig, AI_CHECK_TIMEOUT * 2);
      const fixedContent = rawContent.trim();

      addLog(`【批量修正】成功, 修正后内容长度: ${fixedContent.length}`, 'info');

      const diffs = this.computeDiffs(content, fixedContent);
      addLog(`修正差异数: ${diffs.length}`, 'debug');

      const results = issues.map((_, idx) => ({
        index: idx,
        success: true
      }));

      addLog('===== 剧情检查: 批量修正完成 =====', 'debug');
      addLog(`修正成功: true, 问题数: ${issues.length}`, 'debug');

      return {
        success: true,
        fixedContent,
        results
      };
    } catch (error) {
      addLog(`【批量修正】失败: ${error instanceof Error ? error.message : String(error)}`, 'error');
      return {
        success: false,
        fixedContent: content,
        results: issues.map((_, idx) => ({ index: idx, success: false, error: error instanceof Error ? error.message : '修正失败' })),
        error: error instanceof Error ? error.message : '批量修正失败'
      };
    }
  }

}

export const plotCheckerService = new PlotCheckerService();
