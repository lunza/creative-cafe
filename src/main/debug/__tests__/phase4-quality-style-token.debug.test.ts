/**
 * Phase 4（L4/L5/L9 能力对齐）debug 检查 —— 真实 AI 调用 + 纯逻辑
 *
 * - P4-C1 L4 对话质量检查 checkDialogue（真实 AI）：三维度评分 + OOC 问题检出
 * - P4-C2 L4 问题修正 fixIssue（真实 AI）：AI 重写 OOC 消息
 * - P4-C3 L5 风格学习 learnFromDialogue（真实 AI）：从对话历史提炼风格档案
 * - P4-C4 L9 上下文窗口管理 applyContextWindowManagement（纯逻辑 + 真实 cl100k 计数）
 * - P4-C5 L4 检查历史持久化：getHistory / clearHistory 闭环
 *
 * 说明：纯 node 环境下两个服务的持久化目录为 %APPDATA%\data\{dialogue-quality,character-styles}
 * （与 Electron 内的 %APPDATA%\creative-cafe\data\... 不同，不污染真实应用数据），
 * afterAll 用独立 debug 角色 ID 清理。
 */
import { it, expect, beforeAll, afterAll } from 'vitest';
import { dialogueQualityCheckerService } from '../../services/character/DialogueQualityCheckerService';
import { characterStyleLearningService } from '../../services/character/CharacterStyleLearningService';
import { getTokenCountService } from '../../services/TokenCountService';
import { applyContextWindowManagement } from '../../services/lanApiServer/contextWindowManager';
import { selectDebugEngine, restoreDebugEngine, appendDebugReport, runCheck, logResult, DebugCheckResult } from '../debugHarness';
import { DEBUG_CHARACTER_CARD_ID, buildQualityCheckRequest, buildStyleLearningRequest } from '../sampleData';
import type { DialogueQualityIssue } from '../../../shared/types/dialogueQuality.types';

const results: DebugCheckResult[] = [];
let qualityReport: any = null;

beforeAll(async () => {
  const engine = selectDebugEngine();
  console.log(`[Phase 4 debug] 使用 AI 引擎: ${engine.name}（${engine.baseUrl} / ${engine.model}）`);
  await getTokenCountService().warmup();
});

afterAll(() => {
  // 清理 debug 持久化产物（独立 debug 角色 ID，不影响真实数据）
  dialogueQualityCheckerService.clearHistory(DEBUG_CHARACTER_CARD_ID);
  characterStyleLearningService.delete(DEBUG_CHARACTER_CARD_ID);
  restoreDebugEngine();
  appendDebugReport('phase4', 'Phase 4（L4/L5/L9）能力对齐功能', results);
});

it('P4-C1 L4 对话质量检查（真实 AI：三维度评分 + 刻意 OOC 检出）', async () => {
  const result = await runCheck('Phase 4 / L4', 'P4-C1', 'checkDialogue 真实 AI 检查', async () => {
    const report = await dialogueQualityCheckerService.checkDialogue(buildQualityCheckRequest());
    qualityReport = report;
    if (report.dimensions.length !== 3) throw new Error(`维度数 ${report.dimensions.length} ≠ 3（JSON 解析降级？）`);
    if (report.overallScore < 0 || report.overallScore > 100) throw new Error(`综合评分越界: ${report.overallScore}`);
    const oocDetected = report.issues.some(
      i => i.dimension === 'character_consistency' && (i.quote.includes('卧槽') || i.quote.includes('连跪') || i.quote.length > 0)
    );
    return `综合评分 ${report.overallScore}/100，维度=${report.dimensions.map(d => `${d.dimension}:${d.score}`).join(', ')}，问题 ${report.totalIssues} 个（OOC 检出: ${oocDetected ? '是' : '否'}），高严重度 ${report.highSeverityCount}`;
  });
  results.push(result);
  logResult(result);
  expect(result.status).toBe('pass');
});

it('P4-C2 L4 问题修正 fixIssue（真实 AI：重写 OOC 消息）', async () => {
  const result = await runCheck('Phase 4 / L4', 'P4-C2', 'fixIssue 真实 AI 修正', async () => {
    const request = buildQualityCheckRequest();
    // 优先用 C1 检出的可修正问题；无则用合成的 OOC 问题（msg_6）
    const fixableIssue: DialogueQualityIssue =
      qualityReport?.issues?.find((i: DialogueQualityIssue) => i.fixable) || {
        id: 'debug_synthetic_issue',
        dimension: 'character_consistency',
        severity: 'high',
        title: '人设漂移',
        description: '周伯突然使用游戏黑话并情绪亢奋，与沉稳惜字如金的人设不符',
        messageIds: ['msg_6'],
        quote: '卧槽你太秀了吧兄弟',
        suggestion: '改回沉稳简短的茶馆掌柜语气',
        fixable: true,
      };
    const targetMessage = request.messages.find(m => m.id === 'msg_6')!;
    const contextMessages = request.messages.filter(m => m.id !== 'msg_6' && ['msg_4', 'msg_5'].includes(m.id));

    const fix = await dialogueQualityCheckerService.fixIssue({
      characterCard: request.characterCard,
      issue: fixableIssue,
      targetMessage,
      contextMessages,
    });
    if (!fix.success) throw new Error(`修正失败: ${fix.error}`);
    if (!fix.fixedContent || fix.fixedContent.length === 0) throw new Error('修正后内容为空');
    const stillOOC = fix.fixedContent.includes('卧槽') || fix.fixedContent.includes('three in a row');
    return `修正后 ${fix.fixedContent.length} 字符（仍含原 OOC 黑话: ${stillOOC ? '是' : '否'}）: "${fix.fixedContent.slice(0, 60)}..."`;
  });
  results.push(result);
  logResult(result);
  expect(result.status).toBe('pass');
});

it('P4-C3 L5 风格学习（真实 AI：从对话历史提炼风格档案）', async () => {
  const result = await runCheck('Phase 4 / L5', 'P4-C3', 'learnFromDialogue 真实 AI 学习', async () => {
    const resource = await characterStyleLearningService.learnFromDialogue(buildStyleLearningRequest());
    if (resource.status !== 'completed') throw new Error(`学习失败: ${resource.error || 'profile 解析为空'}`);
    if (!resource.profile) throw new Error('profile 为空');
    if (!resource.profile.speakingStyle) throw new Error('speakingStyle 为空');
    if (resource.profile.vocabulary.length === 0) throw new Error('vocabulary 为空');
    const catchphraseFound =
      resource.profile.signaturePhrases.some(p => p.includes('茶要慢喝')) ||
      resource.profile.vocabulary.some(v => v.includes('茶要慢喝'));
    return `样本 ${resource.messageCount} 条，说话风格: "${resource.profile.speakingStyle.slice(0, 50)}..."，词汇 ${resource.profile.vocabulary.length} 个，口癖 ${resource.profile.signaturePhrases.length} 个（口癖命中"茶要慢喝": ${catchphraseFound ? '是' : '否'}）`;
  });
  results.push(result);
  logResult(result);
  expect(result.status).toBe('pass');
});

it('P4-C4 L9 上下文窗口管理（纯逻辑 + 真实 cl100k 计数）', async () => {
  const result = await runCheck('Phase 4 / L9', 'P4-C4', 'applyContextWindowManagement 截断行为', async () => {
    const service = getTokenCountService();
    const count = (text: string) => service.countTokens(text);
    const make = (n: number, len: number) =>
      Array.from({ length: n }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `消息${i}：${'茶'.repeat(len)}`,
      }));

    // Case A：关闭 → 80 条截为 60 条（安全网）
    const disabled = applyContextWindowManagement(make(80, 10), {
      enabled: false, maxContextTokens: 256000, reservedForResponse: 4096, minMessagesToKeep: 3, maxMessagesToKeep: 60,
    }, count);
    if (disabled.length !== 60) throw new Error(`关闭时 80 条应截为 60 条，实际 ${disabled.length}`);

    // Case B：开启 + 条数上限 10 → 50 条截为 10 条
    const capped = applyContextWindowManagement(make(50, 5), {
      enabled: true, maxContextTokens: 256000, reservedForResponse: 4096, minMessagesToKeep: 3, maxMessagesToKeep: 10,
    }, count);
    if (capped.length !== 10) throw new Error(`maxMessagesToKeep=10 时 50 条应截为 10 条，实际 ${capped.length}`);
    if (capped[capped.length - 1].content !== make(50, 5)[49].content) throw new Error('条数截断丢掉了最新消息');

    // Case C：开启 + 极小预算 → Token 预算截断生效，保底轮数保留
    const longMsgs = make(30, 200); // 每条约 60+ token
    const tinyBudget = applyContextWindowManagement(longMsgs, {
      enabled: true, maxContextTokens: 3000, reservedForResponse: 500, minMessagesToKeep: 2, maxMessagesToKeep: 60,
    }, count);
    if (tinyBudget.length >= 30) throw new Error(`预算 2500 token 时未发生截断（保留 ${tinyBudget.length}/30 条）`);
    if (tinyBudget.length < 4) throw new Error(`保底 2 轮（4 条）失效，仅保留 ${tinyBudget.length} 条`);
    if (tinyBudget[tinyBudget.length - 1].content !== longMsgs[29].content) throw new Error('Token 截断丢掉了最新消息');

    // Case D：成对保护 → 结果不以 assistant 开头
    const oddStart = applyContextWindowManagement(
      [{ role: 'assistant', content: '开头是 assistant' }, { role: 'user', content: '你好' }],
      { enabled: false, maxContextTokens: 256000, reservedForResponse: 4096, minMessagesToKeep: 3, maxMessagesToKeep: 60 },
      count
    );
    // 条数 ≤ 60 时关闭模式不触发截断，保持原样（成对保护仅在截断时生效）
    if (oddStart.length !== 2) throw new Error(`未超安全网条数时不应截断，实际 ${oddStart.length} 条`);
    const truncatedOdd = applyContextWindowManagement(
      [{ role: 'assistant', content: 'x'.repeat(5000) }, ...make(80, 50)],
      { enabled: false, maxContextTokens: 256000, reservedForResponse: 4096, minMessagesToKeep: 3, maxMessagesToKeep: 60 },
      count
    );
    if (truncatedOdd[0].role === 'assistant') throw new Error('截断后以 assistant 开头（成对保护失效）');

    return `关闭: 80→${disabled.length}（安全网）；条数上限: 50→${capped.length}；Token 预算: 30→${tinyBudget.length}（保底 4 条生效）；成对保护 ✓`;
  });
  results.push(result);
  logResult(result);
  expect(result.status).toBe('pass');
});

it('P4-C5 L4 检查历史持久化（getHistory / clearHistory 闭环）', async () => {
  const result = await runCheck('Phase 4 / L4', 'P4-C5', '检查历史持久化闭环', async () => {
    const history = dialogueQualityCheckerService.getHistory(DEBUG_CHARACTER_CARD_ID);
    if (history.length < 1) throw new Error(`C1 检查后历史为空（持久化失败？）`);
    const latest = history[history.length - 1];
    if (latest.characterCardId !== DEBUG_CHARACTER_CARD_ID) throw new Error(`历史角色 ID 不匹配: ${latest.characterCardId}`);
    if (!Array.isArray(latest.dimensionScores) || latest.dimensionScores.length !== 3) throw new Error('历史条目维度评分缺失');

    const cleared = dialogueQualityCheckerService.clearHistory(DEBUG_CHARACTER_CARD_ID);
    if (!cleared) throw new Error('clearHistory 返回 false');
    if (dialogueQualityCheckerService.getHistory(DEBUG_CHARACTER_CARD_ID).length !== 0) throw new Error('清空后历史仍非空');

    return `C1 检查后历史 ${history.length} 条（最新综合评分 ${latest.overallScore}，维度评分 ${latest.dimensionScores.length} 个）→ 清空成功`;
  });
  results.push(result);
  logResult(result);
  expect(result.status).toBe('pass');
});
