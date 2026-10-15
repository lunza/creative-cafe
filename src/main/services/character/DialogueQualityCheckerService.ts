/**
 * 【Phase 4 / L4 - conversation-mode-optimization-report】对话质量检查与人设一致性检查服务。
 *
 * 参考实现：PlotCheckerService（buildCheckPrompt → callChatAPI → parseCheckResponse）。
 * 对话模式将「章节」替换为「对话轮次」，「剧情检查」替换为「人设一致性检查」。
 *
 * 检查维度：
 * - character_consistency：人设一致性（OOC 检测）
 * - dialogue_coherence：对话逻辑连贯性
 * - emotion_expressiveness：情感表达合理性
 *
 * 检查历史持久化：{userData}/data/dialogue-quality/{characterCardId}.json
 */
import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../../utils/appPath';
import { aiService, ChatMessage } from '../AIService';
// Spec: settings-feature-optimization-report / H-5（默认值单一来源）
import { DEFAULT_ENGINE_PARAMS } from '../../../shared/settingDefaults';
import { addLog } from '../memory/chatLogService';
import {
  DialogueQualityCheckRequest,
  DialogueQualityReport,
  DialogueQualityDimensionScore,
  DialogueQualityIssue,
  DialogueQualityDimension,
  DialogueQualitySeverity,
  DialogueQualityMessageRef,
  DialogueQualityFixRequest,
  DialogueQualityFixResult,
  DialogueQualityHistoryEntry,
} from '../../../shared/types/dialogueQuality.types';

/** AI 检查超时（毫秒），对齐写作模式 AI_CHECK_TIMEOUT */
const DIALOGUE_CHECK_TIMEOUT = 300000;
/** 送入检查的消息上限（超长对话取最近 N 条，控制 token 与检查精度） */
const MAX_CHECK_MESSAGES = 100;
/** 单条消息送入 prompt 的最大字符数（超长消息截断，避免 token 爆炸） */
const MAX_MESSAGE_CHARS = 2000;

function formatMessageForPrompt(msg: DialogueQualityMessageRef, index: number): string {
  const speaker = msg.role === 'assistant' ? (msg.speakerName || '角色') : msg.role === 'user' ? '用户' : '系统';
  let content = msg.content;
  if (content.length > MAX_MESSAGE_CHARS) {
    content = content.substring(0, MAX_MESSAGE_CHARS) + '…（已截断）';
  }
  return `[轮次 ${index + 1}] ${speaker}（消息ID: ${msg.id}）: ${content}`;
}

export class DialogueQualityCheckerService {
  private getHistoryDir(): string {
    const dataDir = path.join(getUserDataPath(), 'data');
    const dir = path.join(dataDir, 'dialogue-quality');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private historyFile(characterCardId: string): string {
    // characterCardId 可能含文件系统非法字符，做安全转义
    const safe = characterCardId.replace(/[\\/:*?"<>|]/g, '_');
    return path.join(this.getHistoryDir(), `${safe}.json`);
  }

  private loadHistory(characterCardId: string): DialogueQualityHistoryEntry[] {
    try {
      const file = this.historyFile(characterCardId);
      if (!fs.existsSync(file)) return [];
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return Array.isArray(raw) ? raw : [];
    } catch (error) {
      addLog(`[DialogueQuality] 读取检查历史失败: ${error instanceof Error ? error.message : String(error)}`, 'warn');
      return [];
    }
  }

  private appendHistory(entry: DialogueQualityHistoryEntry): void {
    try {
      const history = this.loadHistory(entry.characterCardId);
      history.push(entry);
      // 每角色最多保留 50 条历史
      const trimmed = history.slice(-50);
      fs.writeFileSync(this.historyFile(entry.characterCardId), JSON.stringify(trimmed, null, 2), 'utf-8');
    } catch (error) {
      addLog(`[DialogueQuality] 写入检查历史失败: ${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
  }

  /**
   * 构建检查 prompt：角色卡设定 + 对话轮次 + （可选）记忆表格摘要。
   */
  private buildCheckPrompt(request: DialogueQualityCheckRequest): string {
    const card = request.characterCard;
    const messages = request.messages.slice(-MAX_CHECK_MESSAGES);

    let parts = '';
    parts += '## 角色卡设定（人设一致性检查的唯一基准）\n';
    parts += `- 角色名: ${card.name}\n`;
    if (card.description) {
      parts += `- 角色描述: ${card.description}\n`;
    }
    if (card.personality) {
      parts += `- 性格: ${card.personality}\n`;
    }
    if (card.scenario) {
      parts += `- 场景设定: ${card.scenario}\n`;
    }
    if (card.mesExample) {
      parts += `- 示例对话（语言风格基准）:\n${card.mesExample}\n`;
    }
    parts += '\n';

    if (request.memoryTableText && request.memoryTableText.trim()) {
      parts += '## 记忆表格摘要（剧情状态参考）\n';
      parts += `${request.memoryTableText.trim()}\n\n`;
    }

    parts += '## 对话内容（待检查的对话轮次，quote 的原文摘录必须从此部分复制）\n';
    messages.forEach((msg, i) => {
      parts += formatMessageForPrompt(msg, i) + '\n';
    });

    parts += `
## 输出格式要求
请严格按照以下 JSON 格式返回检查结果（不要包含 markdown 代码块标记，只返回纯 JSON）：
{
  "overallScore": 数字（0-100，综合评分）,
  "dimensions": [
    { "dimension": "character_consistency", "score": 数字（0-100）, "comment": "该维度的简要评价（1-2 句）" },
    { "dimension": "dialogue_coherence", "score": 数字（0-100）, "comment": "该维度的简要评价（1-2 句）" },
    { "dimension": "emotion_expressiveness", "score": 数字（0-100）, "comment": "该维度的简要评价（1-2 句）" }
  ],
  "issues": [
    {
      "dimension": "character_consistency" | "dialogue_coherence" | "emotion_expressiveness",
      "severity": "high" | "medium" | "low",
      "title": "问题标题（10 字以内）",
      "description": "问题详细描述（说明哪里出了问题、为什么与人设/逻辑/情境不符）",
      "messageIds": ["消息ID"],
      "quote": "问题原文摘录（必须从上方对话内容中逐字复制，50 字以内）",
      "suggestion": "修正建议（说明应如何修改）",
      "fixable": 布尔（问题定位到具体消息时 true，全局性问题 false）
    }
  ]
}`;
    return parts;
  }

  /**
   * 解析 AI 检查响应为报告。容错：JSON 解析失败时返回降级报告。
   */
  private parseCheckResponse(rawContent: string, request: DialogueQualityCheckRequest): DialogueQualityReport {
    const fallback: DialogueQualityReport = {
      overallScore: 0,
      dimensions: [],
      issues: [],
      totalIssues: 0,
      highSeverityCount: 0,
      mediumSeverityCount: 0,
      lowSeverityCount: 0,
      checkedAt: Date.now(),
      characterCardName: request.characterCard.name,
      messageCount: request.messages.length,
    };

    let jsonText = rawContent.trim();
    // 剥离可能存在的 markdown 代码块标记
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    }
    // 截取首个 { 到末个 } 之间的内容，容忍前后多余文本
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start === -1 || end <= start) {
      addLog('[DialogueQuality] AI 响应中未找到 JSON 对象，返回降级报告', 'warn');
      return fallback;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText.substring(start, end + 1));
    } catch (error) {
      addLog(`[DialogueQuality] JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`, 'warn');
      addLog(`[DialogueQuality] 原始响应前 500 字符: ${jsonText.substring(0, 500)}`, 'debug');
      return fallback;
    }

    const validDimensions = new Set(Object.values(DialogueQualityDimension));
    const validSeverities: DialogueQualitySeverity[] = ['high', 'medium', 'low'];

    const dimensions: DialogueQualityDimensionScore[] = Array.isArray(parsed.dimensions)
      ? parsed.dimensions
          .filter((d: any) => validDimensions.has(d.dimension) && typeof d.score === 'number')
          .map((d: any) => ({
            dimension: d.dimension,
            score: Math.max(0, Math.min(100, Math.round(d.score))),
            comment: typeof d.comment === 'string' ? d.comment : '',
          }))
      : [];

    const issues: DialogueQualityIssue[] = Array.isArray(parsed.issues)
      ? parsed.issues
          .filter((i: any) => validDimensions.has(i.dimension) && typeof i.title === 'string')
          .map((i: any, idx: number) => ({
            id: `issue_${Date.now()}_${idx}`,
            dimension: i.dimension,
            severity: validSeverities.includes(i.severity) ? i.severity : 'low',
            title: i.title,
            description: typeof i.description === 'string' ? i.description : '',
            messageIds: Array.isArray(i.messageIds) ? i.messageIds.filter((m: any) => typeof m === 'string') : [],
            quote: typeof i.quote === 'string' ? i.quote : '',
            suggestion: typeof i.suggestion === 'string' ? i.suggestion : '',
            fixable: i.fixable === true && Array.isArray(i.messageIds) && i.messageIds.length > 0,
          }))
      : [];

    return {
      overallScore: Math.max(0, Math.min(100, Math.round(typeof parsed.overallScore === 'number' ? parsed.overallScore : 0))),
      dimensions,
      issues,
      totalIssues: issues.length,
      highSeverityCount: issues.filter(i => i.severity === 'high').length,
      mediumSeverityCount: issues.filter(i => i.severity === 'medium').length,
      lowSeverityCount: issues.filter(i => i.severity === 'low').length,
      checkedAt: Date.now(),
      characterCardName: request.characterCard.name,
      messageCount: request.messages.length,
    };
  }

  /**
   * 执行对话质量检查。
   */
  async checkDialogue(request: DialogueQualityCheckRequest): Promise<DialogueQualityReport> {
    addLog('===== 对话质量检查: checkDialogue 开始 =====', 'debug');
    addLog(`角色: ${request.characterCard.name}, 消息数: ${request.messages.length}`, 'debug');

    const config = await aiService.getConfig();
    const engineConfig = await aiService.getEngineConfig();

    const systemPrompt =
      '你是一个专业的角色扮演对话质量检查助手，擅长检测 OOC（角色人设漂移）、对话逻辑矛盾与情感表达失当。请严格以 JSON 格式返回检查结果。';
    const userPrompt = this.buildCheckPrompt(request);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    addLog(`【对话质量检查】提示词总长度: ${systemPrompt.length + userPrompt.length} 字符`, 'debug');

    const rawContent = await aiService.callChatAPI(messages, {
      model: config.model,
      temperature: engineConfig.temperature,
      // EngineConfig.maxTokens 为可选字段，缺省回退默认值（与写作模式 handler 一致）
      maxTokens: engineConfig.maxTokens ?? DEFAULT_ENGINE_PARAMS.maxTokens,
      timeoutMs: DIALOGUE_CHECK_TIMEOUT,
    });

    addLog(`【对话质量检查】AI 原始响应长度: ${rawContent.length}`, 'info');

    const report = this.parseCheckResponse(rawContent, request);

    // 追加检查历史（评分趋势用）
    this.appendHistory({
      id: `check_${Date.now()}`,
      characterCardId: request.characterCardId,
      characterCardName: request.characterCard.name,
      overallScore: report.overallScore,
      totalIssues: report.totalIssues,
      dimensionScores: report.dimensions.map(d => ({ dimension: d.dimension, score: d.score })),
      checkedAt: report.checkedAt,
    });

    addLog(`对话质量检查完成: 综合评分=${report.overallScore}, 问题总数=${report.totalIssues}`, 'info');
    return report;
  }

  /**
   * 对单个问题执行 AI 自动修正：重写目标消息，保持角色语言风格。
   */
  async fixIssue(request: DialogueQualityFixRequest): Promise<DialogueQualityFixResult> {
    addLog('===== 对话质量检查: fixIssue 开始 =====', 'debug');
    addLog(`问题: ${request.issue.title}`, 'debug');

    const config = await aiService.getConfig();
    const engineConfig = await aiService.getEngineConfig();

    const card = request.characterCard;
    const systemPrompt =
      '你是一个专业的角色扮演对话润色助手。请根据修正建议重写指定的角色消息，保持角色原有的语言风格、性格与口癖，只修正问题部分，不要改变消息的整体意图。直接返回重写后的消息全文，不要包含任何解释、前缀或 markdown 标记。';

    let userPrompt = '## 角色卡设定\n';
    userPrompt += `- 角色名: ${card.name}\n`;
    if (card.personality) userPrompt += `- 性格: ${card.personality}\n`;
    if (card.mesExample) userPrompt += `- 示例对话（语言风格基准）:\n${card.mesExample}\n`;
    userPrompt += '\n## 上下文（仅用于理解语境，不需要修正）\n';
    for (const ctx of request.contextMessages) {
      userPrompt += formatMessageForPrompt(ctx, 0) + '\n';
    }
    userPrompt += `
## 待修正消息（角色: ${request.targetMessage.speakerName || '角色'}，消息ID: ${request.targetMessage.id}）
${request.targetMessage.content}

## 问题与修正建议
- 问题: ${request.issue.description}
- 建议: ${request.issue.suggestion}

请重写上述待修正消息，直接输出重写后的全文。`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const rawContent = await aiService.callChatAPI(messages, {
      model: config.model,
      temperature: engineConfig.temperature,
      maxTokens: engineConfig.maxTokens ?? DEFAULT_ENGINE_PARAMS.maxTokens,
      timeoutMs: DIALOGUE_CHECK_TIMEOUT,
    });

    const fixedContent = rawContent.trim();
    if (!fixedContent) {
      return { success: false, fixedContent: request.targetMessage.content, error: 'AI 返回空内容' };
    }

    addLog('===== 对话质量检查: fixIssue 完成 =====', 'debug');
    return { success: true, fixedContent };
  }

  /**
   * 获取检查历史（按时间升序，评分趋势图用）。
   */
  getHistory(characterCardId: string): DialogueQualityHistoryEntry[] {
    return this.loadHistory(characterCardId);
  }

  /**
   * 清空指定角色的检查历史。
   */
  clearHistory(characterCardId: string): boolean {
    try {
      const file = this.historyFile(characterCardId);
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
      return true;
    } catch (error) {
      addLog(`[DialogueQuality] 清空检查历史失败: ${error instanceof Error ? error.message : String(error)}`, 'warn');
      return false;
    }
  }
}

export const dialogueQualityCheckerService = new DialogueQualityCheckerService();
