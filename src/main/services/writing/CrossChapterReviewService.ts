/**
 * 跨章节连贯性审查服务（混合路线编排）
 * Spec: add-cross-chapter-coherence-review
 *
 * 两条审查链路：
 * 1. 本地文本雷同扫描（CrossChapterTextScanner，恒执行，零 token）→ text_repetition
 * 2. AI 语义审查（重复剧情 + 情节矛盾，可开关）→ plot_repetition / plot_contradiction
 *    - 章节正文按 0 基位置编号标注（与 PlotCheckerService/TableOrganizeService 同一契约）
 *    - 历史表格（角色/事件/伏笔）为次要参考
 *    - 流式可视化（SSEStreamParser）+ AbortController 中止（cancelled 标记契约）
 *    - withCustomPrompt 注入（最高优先级）
 *
 * 两路结果合并：AI 问题与本地问题命中同一章节对且引文前缀一致时，
 * 本地问题 source 升级为 'local+ai'（AI 说明附在描述后），避免重复展示。
 */
import { writingStorageService } from '../WritingStorageService';
import { aiConfigProvider } from '../ai/AIConfigProvider';
import { SSEStreamParser } from '../ai/SSEStreamParser';
import { addLog } from '../memory/chatLogService';
import { fixChineseQuotes, tryParseJsonWithRepair } from './jsonRepair';
import { scanTextRepetition, type ScannerChapter } from './CrossChapterTextScanner';
import { withCustomPrompt } from '../../../shared/prompts/customPrompt';
import { withHumanizerNovelRules } from '../../../shared/prompts/humanizerPolish';
import {
  CrossCheckFixSuggestion,
  CrossCheckIssue,
  CrossCheckParams,
  CrossCheckReport,
  CrossCheckSeverity,
} from '../../../shared/types/cross-chapter-review.types';

interface ModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface CrossCheckRequestData {
  projectId: string;
  params: CrossCheckParams;
  modelConfig?: ModelConfig;
}

export interface CrossCheckProgressEvent {
  /** 阶段（local=本地扫描 / ai=AI 语义审查），缺省按调用上下文由 handler 兜底 */
  phase?: 'local' | 'ai';
  chunk?: string;
  reasoning?: string;
  message?: string;
}

interface TableSheetData {
  sheets: string[];
  headers: Record<string, string[]>;
  data: Record<string, Record<string, string | number>[]>;
}

function stripThinkTags(content: string): string {
  if (!content) return content;
  let stripped = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
  stripped = stripped.replace(/\n{3,}/g, '\n\n');
  return stripped.trim();
}

export class CrossChapterReviewService {
  /** 进行中的 AI 审查（writing:crossCheckCancel 可中止） */
  private activeController: AbortController | null = null;

  private readonly streamParser = new SSEStreamParser();

  /** 中止当前审查（与 ContentGenerator.cancelDeAiCheck 同一模式） */
  cancel(): void {
    if (this.activeController) {
      this.activeController.abort();
      this.activeController = null;
    }
  }

  async reviewCrossChapters(
    request: CrossCheckRequestData,
    onProgress?: (p: CrossCheckProgressEvent) => void
  ): Promise<CrossCheckReport> {
    const startedAt = Date.now();
    const { params } = request;
    addLog(`[跨章审查] 开始 - 项目: ${request.projectId}, 起始: ${params.startPos}, 章数: ${params.count}`, 'debug');

    const project = await writingStorageService.loadProject(request.projectId);
    if (!project) {
      throw new Error('项目不存在');
    }
    const allChapters = project.outline?.chapters ?? [];

    // 位置切片（0 基），跳过无正文章节
    const group = allChapters
      .map((c, pos) => ({ c, pos }))
      .filter(({ pos }) => pos >= params.startPos && pos < params.startPos + params.count)
      .filter(({ c }) => typeof c.content === 'string' && c.content.trim().length > 0);

    if (group.length < 2) {
      throw new Error(`所选范围内有正文的章节不足 2 章（仅 ${group.length} 章），无法进行跨章审查`);
    }

    const scannerChapters: ScannerChapter[] = group.map(({ c, pos }) => ({
      position: pos,
      title: c.title || `第${pos + 1}章`,
      content: c.content as string,
    }));
    const positionOf = (pos: number) => group.find((g) => g.pos === pos);
    const titleOf = (pos: number) =>
      positionOf(pos)?.c.title || allChapters[pos]?.title || `第${pos + 1}章`;
    const contentOf = (pos: number): string => positionOf(pos)?.c.content as string || '';

    // ===== 1. 本地文本雷同扫描（恒执行） =====
    onProgress?.({ phase: 'local', message: '正在执行本地文本雷同扫描…' });
    const localIssues = scanTextRepetition(scannerChapters, {
      distance: params.distance,
      similarityThreshold: params.similarityThreshold,
    });
    addLog(`[跨章审查] 本地扫描完成: ${localIssues.length} 条文本重复`, 'info');
    onProgress?.({ phase: 'local', message: `本地扫描完成：发现 ${localIssues.length} 处文本重复` });

    let issues: CrossCheckIssue[] = [...localIssues];
    let aiCount = 0;
    let cancelled = false;
    let cancelledPhase: 'local' | 'ai' | undefined;
    let aiError: string | undefined;

    // ===== 2. AI 语义审查（可开关） =====
    if (params.enableAiReview) {
      const abortController = new AbortController();
      this.activeController = abortController;
      try {
        onProgress?.({ phase: 'ai', message: 'AI 语义审查进行中…' });
        const aiIssues = await this.runAiReview({
          request,
          group,
          titleOf,
          contentOf,
          signal: abortController.signal,
          onProgress,
        });
        aiCount = aiIssues.length;

        // 合并去重：AI 问题命中本地已有问题（同章节对 + 引文前缀一致）→ 本地问题升级为 local+ai
        for (const aiIssue of aiIssues) {
          const merged = issues.find((loc) => {
            if (loc.source !== 'local') return false;
            const pairMatch =
              (loc.chapterA.index === aiIssue.chapterA.index && loc.chapterB.index === aiIssue.chapterB.index) ||
              (loc.chapterA.index === aiIssue.chapterB.index && loc.chapterB.index === aiIssue.chapterA.index);
            if (!pairMatch) return false;
            const prefix = (s: string) => s.replace(/\s+/g, '').substring(0, 10);
            const aiQuotes = [aiIssue.chapterA.quote, aiIssue.chapterB.quote].map(prefix);
            const locQuotes = [loc.chapterA.quote, loc.chapterB.quote].map(prefix);
            return aiQuotes.some((q) => q && locQuotes.includes(q));
          });
          if (merged) {
            merged.source = 'local+ai';
            merged.description += `；AI 语义审查同样标记：${aiIssue.description}`;
          } else {
            issues.push(aiIssue);
          }
        }
      } catch (error) {
        const aborted =
          error instanceof DOMException && error.name === 'AbortError'
            ? true
            : (error as Error)?.name === 'AbortError' || (error as any)?.cancelled === true;
        if (aborted) {
          cancelled = true;
          cancelledPhase = 'ai';
          addLog('[跨章审查] 用户中止 AI 审查', 'info');
        } else {
          aiError = error instanceof Error ? error.message : String(error);
          addLog(`[跨章审查] AI 语义审查失败: ${aiError}`, 'error');
        }
      } finally {
        if (this.activeController === abortController) {
          this.activeController = null;
        }
      }
    }

    // 严重度排序：high > medium > low
    const severityOrder: Record<CrossCheckSeverity, number> = { high: 0, medium: 1, low: 2 };
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    const report: CrossCheckReport = {
      issues,
      stats: {
        chapters: group.length,
        pairs: this.countComparedPairs(group.length, params.distance),
        localCount: localIssues.length,
        aiCount,
        durationMs: Date.now() - startedAt,
      },
      checkedPositions: group.map((g) => g.pos),
      cancelled,
      cancelledPhase,
      aiError,
    };
    addLog(`[跨章审查] 完成: 共 ${issues.length} 条问题（本地 ${localIssues.length} / AI ${aiCount}），耗时 ${report.stats.durationMs}ms`, 'info');
    return report;
  }

  /** 比较的章节对数量（含章内，|i-j| ≤ distance） */
  private countComparedPairs(n: number, distance: number): number {
    let count = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n && j - i <= distance; j++) {
        count++;
      }
    }
    return count;
  }

  /** AI 语义审查：构建提示词 → 流式请求 → JSON 解析 → 引文逐字校验 */
  private async runAiReview(args: {
    request: CrossCheckRequestData;
    group: { pos: number }[];
    titleOf: (pos: number) => string;
    contentOf: (pos: number) => string;
    signal: AbortSignal;
    onProgress?: (p: CrossCheckProgressEvent) => void;
  }): Promise<CrossCheckIssue[]> {
    const { request, group, titleOf, contentOf, signal, onProgress } = args;
    const { params } = request;

    const aiConfig = aiConfigProvider.getAIConfig();
    const baseUrl = aiConfig.baseUrl;
    if (!baseUrl) {
      throw new Error('未配置 AI 服务地址');
    }
    const modelName = request.modelConfig?.model || aiConfig.modelName;
    if (!modelName) {
      throw new Error('未配置 AI 模型名称');
    }

    const tableData = await writingStorageService.getTableData(request.projectId);

    const systemPrompt = withCustomPrompt(
      `${aiConfig.systemPrompt ? aiConfig.systemPrompt + '\n\n' : ''}你是一位资深小说连贯性审校。用户提供了连续多个章节的正文，请你逐章对照审查两类问题，并输出严格 JSON。

## 审查维度（仅两类）
1. plot_repetition（重复剧情）：同一场景/同一动作序列/同一情节节拍在不同章节中重复上演。第二次出现本应推进剧情（变化、递进、新信息），而不是原样或近乎原样重演。例如：前章已完成"卧室戏+高潮+彻底沦陷"，后章又从"被扔到床上+第一次插入"重头开始。
2. plot_contradiction（情节矛盾）：前后章节之间的事实/状态/时间线互相冲突。例如：前章角色已赤裸，后章又穿裤子；前章已完成两次性事，后章仍按"第一次（无润滑/处女般紧致）"描写；前章"彻底沦陷顺从"，后章又"惊慌反抗"。

## 判据（${this.strictnessLabel(params.aiStrictness)}）
${this.strictnessCriteria(params.aiStrictness)}

## 报告规则
- 只报上述两类问题；措辞/句子层面的雷同由本地扫描负责，不要报 text_repetition
- 重点审查章节编号距离 ≤ ${params.distance} 的章节对；组内相距更远的章节对，只有明显问题才报
- 每处问题必须给出双侧原文逐字引文（quote 必须是正文中逐字存在的原句片段，不得改写、不得省略号）
- severity：直接影响剧情逻辑的矛盾/重复=high，影响阅读体验=medium，轻微=low
- 没有问题时返回空数组

## 输出要求
只返回如下 JSON（不要输出任何其他文字、不要代码块包裹）：
{
  "issues": [
    {
      "type": "plot_repetition 或 plot_contradiction",
      "severity": "high 或 medium 或 low",
      "chapterA": { "index": 章节编号(0基), "title": "章节标题", "quote": "第A章原文逐字引文" },
      "chapterB": { "index": 章节编号(0基), "title": "章节标题", "quote": "第B章原文逐字引文" },
      "description": "问题说明：指出矛盾/重复的具体点，并建议修改哪一章的哪段"
    }
  ]
}`,
      params.customPrompt
    );

    // 章节正文按 0 基位置编号标注（位置优先契约：编号 = 数组下标，与请求/返回的 index 一致）
    const chapterSections = group
      .map(({ pos }) => `## 第${pos}章（编号 ${pos}，标题：${titleOf(pos)}）\n${contentOf(pos)}`)
      .join('\n\n');

    const tableContext = this.buildTableContext(tableData);

    const userPrompt = `以下是需要审查的连续章节正文（章节编号为 0 基数组下标，返回 JSON 时 index 字段必须使用这个编号）：

${chapterSections}
${tableContext}
请按审查维度逐条对照上述章节，输出 JSON 审查结果。`;

    addLog(`[跨章审查-AI] 章节数: ${group.length}, 提示词总长: ${systemPrompt.length + userPrompt.length}`, 'debug');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const requestBody: Record<string, any> = {
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      stream: true,
    };
    if (aiConfig.apiKey) {
      if (aiConfig.apiKeyTransmission === 'header') {
        const authValue = aiConfig.apiKey.trim().startsWith('Bearer ')
          ? aiConfig.apiKey
          : `Bearer ${aiConfig.apiKey}`;
        headers['Authorization'] = authValue;
      } else {
        requestBody.api_key = aiConfig.apiKey;
      }
    }

    const controller = new AbortController();
    // 外部中止信号联动
    const onOuterAbort = () => controller.abort();
    signal.addEventListener('abort', onOuterAbort, { once: true });

    let rawContent = '';
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI 请求失败: ${response.status} ${response.statusText} ${errorText.substring(0, 200)}`);
      }
      const result = await this.streamParser.parseStream(
        response,
        (chunk) => onProgress?.({ phase: 'ai', chunk }),
        controller.signal,
        (reasoning) => onProgress?.({ phase: 'ai', reasoning })
      );
      rawContent = result.content;
    } finally {
      signal.removeEventListener('abort', onOuterAbort);
    }

    const jsonStr = stripThinkTags(rawContent).trim();
    if (!jsonStr) {
      throw new Error('AI 审查返回为空（思考流可能占满输出长度），请重试');
    }
    const parsed = tryParseJsonWithRepair(fixChineseQuotes(jsonStr));
    if (!parsed) {
      addLog(`[跨章审查-AI] JSON 解析失败，原始响应前500: ${jsonStr.substring(0, 500)}`, 'warn');
      throw new Error('AI 审查结果解析失败，请重试');
    }
    const rawIssues: any[] = Array.isArray(parsed?.issues) ? parsed.issues : [];

    const issues: CrossCheckIssue[] = [];
    for (const raw of rawIssues) {
      const issue = this.validateAiIssue(raw, group, titleOf, contentOf);
      if (issue) issues.push(issue);
    }
    addLog(`[跨章审查-AI] 有效问题 ${issues.length}/${rawIssues.length} 条`, 'info');
    return issues;
  }

  private strictnessLabel(v: CrossCheckParams['aiStrictness']): string {
    return v === 'strict' ? '严格档' : v === 'lenient' ? '宽松档' : '标准档';
  }

  private strictnessCriteria(v: CrossCheckParams['aiStrictness']): string {
    switch (v) {
      case 'strict':
        return '严格档：除明显重复/矛盾外，"合理但影响阅读体验"的也要报——同一比喻/句式在相邻章节复现、高潮/亲密戏模板化复现、角色状态描写原地踏步，均视为问题。';
      case 'lenient':
        return '宽松档：只报"明显"的问题——同一场景几乎原样重演、前后事实/状态明确互相冲突。措辞层面雷同、轻微的状态不一致、合理的剧情呼应与递进一律不报。';
      case 'standard':
      default:
        return '标准档：报告影响阅读体验的重复与矛盾——同一场景/动作序列重演、前后状态/事实不一致。合理的情节呼应、递进式重复（有变化、有新信息）不报。';
    }
  }

  /** 历史表格上下文（次要参考；行存储约定与 TableOrganizeService 同一契约） */
  private buildTableContext(tableData: TableSheetData | null | undefined): string {
    if (!tableData || !Array.isArray(tableData.sheets) || tableData.sheets.length === 0) {
      return '';
    }
    const focusSheets = tableData.sheets.filter((s) =>
      ['角色表', '事件表', '伏笔表'].includes(s)
    );
    if (focusSheets.length === 0) return '';

    const parts: string[] = ['## 历史剧情表格数据（次要参考：用于核对人物状态/事件因果，不是检查基准）'];
    for (const sheet of focusSheets) {
      const headers = tableData.headers?.[sheet] || [];
      const rows: any[] = tableData.data?.[sheet] || [];
      if (rows.length === 0) continue;
      parts.push(`### ${sheet}`);
      rows.forEach((row: any, rowIndex: number) => {
        const fields: string[] = [];
        for (let ci = 0; ci < headers.length; ci++) {
          const value = row[String(ci + 2)];
          if (value === undefined || value === null || String(value) === '') continue;
          fields.push(`${headers[ci]}=${value}`);
        }
        if (fields.length > 0) {
          parts.push(`  行${rowIndex + 1}: ${fields.join(', ')}`);
        }
      });
    }
    return parts.join('\n');
  }

  /** AI 问题校验：类型/引文逐字定位（失败标 located:false，不静默丢弃） */
  private validateAiIssue(
    raw: any,
    group: { pos: number }[],
    titleOf: (pos: number) => string,
    contentOf: (pos: number) => string
  ): CrossCheckIssue | null {
    if (!raw || typeof raw !== 'object') return null;
    const type = raw.type === 'plot_repetition' || raw.type === 'plot_contradiction' ? raw.type : null;
    if (!type) return null;
    const severity: CrossCheckSeverity =
      raw.severity === 'high' || raw.severity === 'low' ? raw.severity : 'medium';
    const ca = raw.chapterA;
    const cb = raw.chapterB;
    if (!ca || !cb) return null;

    const validPositions = new Set(group.map((g) => g.pos));
    const norm = (s: string) => String(s ?? '').replace(/\s+/g, '');
    const locate = (ref: any, pos: number): { index: number; title: string; quote: string; located: boolean } => {
      const content = contentOf(pos);
      const quote = String(ref?.quote ?? '').trim();
      // 逐字定位；失败时去空白后再试一次（容忍引文换行差异），仍失败标 located:false
      const located =
        content.includes(quote) ||
        (norm(quote).length > 0 && norm(content).includes(norm(quote)));
      return { index: pos, title: titleOf(pos), quote, located };
    };

    const posA = Number.isInteger(ca.index) && validPositions.has(ca.index) ? (ca.index as number) : group[0].pos;
    const posB = Number.isInteger(cb.index) && validPositions.has(cb.index) ? (cb.index as number) : group[group.length - 1].pos;

    return {
      id: `ai-${posA}-${posB}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      severity,
      description: String(raw.description ?? '').trim() || '（AI 未给出说明）',
      chapterA: locate(ca, posA),
      chapterB: locate(cb, posB),
      source: 'ai',
    };
  }

  /**
   * 一键修复建议：AI 基于问题 + 目标章全文生成 { chapterIndex, originalText, replacementText, explanation }
   * 校验：chapterIndex 在分组内 + originalText 在目标章逐字存在（失败重试 1 次）
   */
  async suggestFix(request: {
    projectId: string;
    issue: CrossCheckIssue;
    /** 分组内的章节位置（0 基） */
    checkedPositions: number[];
    customPrompt?: string;
  }): Promise<{ success: boolean; suggestion?: CrossCheckFixSuggestion; error?: string }> {
    const { issue, checkedPositions } = request;
    addLog(`[跨章审查-修复] 开始 - 问题: ${issue.id}, 类型: ${issue.type}`, 'debug');

    const project = await writingStorageService.loadProject(request.projectId);
    if (!project) {
      return { success: false, error: '项目不存在' };
    }
    const allChapters = project.outline?.chapters ?? [];
    const positionSet = new Set(checkedPositions);
    const titleOf = (pos: number) => allChapters[pos]?.title || `第${pos + 1}章`;
    const contentOf = (pos: number): string => (allChapters[pos]?.content as string) || '';

    const aiConfig = aiConfigProvider.getAIConfig();
    const baseUrl = aiConfig.baseUrl;
    if (!baseUrl) return { success: false, error: '未配置 AI 服务地址' };
    const modelName = aiConfig.modelName;
    if (!modelName) return { success: false, error: '未配置 AI 模型名称' };

    const posA = issue.chapterA.index;
    const posB = issue.chapterB.index;
    // 默认目标章 = 靠后的一章（重复/矛盾通常在后者修正）
    const defaultTarget = Math.max(posA, posB);

    const issueDetail = [
      `问题类型: ${issue.type === 'plot_repetition' ? '重复剧情' : issue.type === 'plot_contradiction' ? '情节矛盾' : '文本重复'}`,
      `问题描述: ${issue.description}`,
      `第${posA + 1}章引文: ${issue.chapterA.quote}`,
      `第${posB + 1}章引文: ${issue.chapterB.quote}`,
    ].join('\n');

    const systemPrompt = withCustomPrompt(
      withHumanizerNovelRules(
        `${aiConfig.systemPrompt ? aiConfig.systemPrompt + '\n\n' : ''}你是一位资深小说编辑。用户发现跨章节连贯性问题（重复剧情/情节矛盾/文本重复），请给出具体可落地的修改建议：选择其中一章中的一段原文，改写为消除问题的文本。改写要求：只改动必要的部分，保持原文风格、信息量与剧情走向不变，改写后的句子要自然、具体、有人味。

## 输出要求
只返回如下 JSON（不要输出任何其他文字、不要代码块包裹）：
{
  "chapterIndex": 目标章节编号(0基，从给定的候选编号中选),
  "originalText": "目标章节中要替换的原文（必须逐字存在，含标点，长度 10-300 字）",
  "replacementText": "替换后的文本（与原文功能对应，自然通顺）",
  "explanation": "修改理由（50字内，说明这样改如何消除该问题）"
}`
      ),
      request.customPrompt
    );

    const userPrompt = `## 问题详情
${issueDetail}

## 候选章节编号（0 基，chapterIndex 必须从中选择）
${checkedPositions.map((p) => `${p}（${titleOf(p)}）`).join('、')}
（建议优先修改靠后的章节：${defaultTarget}（${titleOf(defaultTarget)}））

## 候选章节全文
${checkedPositions
  .map((p) => `### 第${p}章（编号 ${p}）\n${contentOf(p)}`)
  .join('\n\n')}

请给出修改建议 JSON。`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const bodyBase: Record<string, any> = {
      model: modelName,
      temperature: 0.3,
      stream: false,
    };
    if (aiConfig.apiKey) {
      if (aiConfig.apiKeyTransmission === 'header') {
        const authValue = aiConfig.apiKey.trim().startsWith('Bearer ')
          ? aiConfig.apiKey
          : `Bearer ${aiConfig.apiKey}`;
        headers['Authorization'] = authValue;
      } else {
        bodyBase.api_key = aiConfig.apiKey;
      }
    }

    let lastError = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      let messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];
      if (attempt === 2 && lastError) {
        // 重试：把上次失败原因反馈给模型
        messages = [
          ...messages,
          { role: 'assistant', content: lastError },
          { role: 'user', content: `上次输出不合格：${lastError}。请重新输出，originalText 必须逐字来自目标章节全文。` },
        ];
      }

      try {
        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...bodyBase, messages }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) {
          const errorText = await response.text();
          return { success: false, error: `AI 请求失败: ${response.status} ${errorText.substring(0, 200)}` };
        }
        const data: any = await response.json();
        const rawContent: string = data?.choices?.[0]?.message?.content ?? '';
        const jsonStr = stripThinkTags(rawContent).trim();
        const parsed = tryParseJsonWithRepair(fixChineseQuotes(jsonStr));
        if (!parsed) {
          lastError = '返回不是有效 JSON';
          continue;
        }
        const chapterIndex = Number(parsed.chapterIndex);
        if (!Number.isInteger(chapterIndex) || !positionSet.has(chapterIndex)) {
          lastError = `chapterIndex=${parsed.chapterIndex} 不在候选章节编号中`;
          continue;
        }
        const originalText = String(parsed.originalText ?? '').trim();
        const replacementText = String(parsed.replacementText ?? '').trim();
        if (!originalText || !replacementText) {
          lastError = 'originalText 或 replacementText 为空';
          continue;
        }
        if (!contentOf(chapterIndex).includes(originalText)) {
          lastError = 'originalText 未能在目标章节中逐字定位';
          continue;
        }
        if (originalText === replacementText) {
          lastError = 'originalText 与 replacementText 相同（无实际修改）';
          continue;
        }

        const suggestion: CrossCheckFixSuggestion = {
          chapterIndex,
          chapterTitle: titleOf(chapterIndex),
          originalText,
          replacementText,
          explanation: String(parsed.explanation ?? '').trim() || '（AI 未给出说明）',
        };
        addLog(`[跨章审查-修复] 建议生成成功 - 目标章: ${chapterIndex}, 原文长度: ${originalText.length}`, 'info');
        return { success: true, suggestion };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    addLog(`[跨章审查-修复] 失败: ${lastError}`, 'warn');
    return { success: false, error: lastError || '原文定位失败，请重试' };
  }
}

export const crossChapterReviewService = new CrossChapterReviewService();
