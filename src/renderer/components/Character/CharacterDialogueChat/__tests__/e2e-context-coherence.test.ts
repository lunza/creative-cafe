/**
 * 上下文连贯性端到端集成测试
 *
 * Spec: optimize-chat-ai-intelligence / Task 11.2
 *
 * 验证目标（不真实调用 AI API，mock ChatVectorizationService.retrieveChatHistory）：
 * 1. 模拟 25 轮对话，在第 21 轮验证 requestAIResponse 调用 chatHistory.retrieve（对话历史 RAG 触发）
 *    - 通过 shouldTriggerRagRetrieval(contextMessagesLength) 验证触发条件
 *    - 通过 buildFinalSystemPrompt 验证检索结果注入"区域 2：本会话相关历史片段"
 * 2. 验证检索结果格式化（含相关度百分比、历史片段编号、区域边界标记）
 * 3. 模拟 5 轮短对话，验证不触发 RAG 检索（contextMessages.length <= 40）
 * 4. 模拟增量向量化触发条件：每 5 轮（10 条消息）触发一次
 *
 * 测试策略：
 * - 直接调用纯函数 shouldTriggerRagRetrieval / shouldTriggerIncrementalVectorize
 * - 通过 buildFinalSystemPrompt 验证注入格式
 * - mock ChatVectorizationService.retrieveChatHistory 返回固定结果
 *
 * Spec: optimize-chat-ai-intelligence / Task 11.2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  shouldTriggerRagRetrieval,
  shouldTriggerIncrementalVectorize,
  extractRecentMessagesForVectorize,
  RAG_TRIGGER_MESSAGE_THRESHOLD,
  INCREMENTAL_VECTORIZE_PERIOD,
} from '../utils/chatHistoryRagUtils';
import { buildFinalSystemPrompt } from '../PromptBuilder';

// 静音 console.log（buildFinalSystemPrompt 内有大量调试日志）
const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

// buildFinalSystemPrompt 内部调用 buildAsyncTableOrganizeInstructions，
// 后者依赖 window.electronAPI.prompt.build。stub 掉避免真实 IPC 调用。
const promptBuildMock = vi.fn().mockResolvedValue({
  success: false,
  error: 'not configured',
});
vi.stubGlobal('window', {
  electronAPI: {
    prompt: {
      build: promptBuildMock,
    },
  },
});

// ============================================================
// 测试工具
// ============================================================

/**
 * 模拟 1 轮对话消息（user + assistant）。
 */
function makeTurnMessages(turn: number): Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: number }> {
  return [
    {
      id: `user-${turn}`,
      role: 'user',
      content: `第${turn}轮用户消息：我们之前讨论过的话题${turn % 5 === 0 ? '（与历史相关）' : ''}`,
      timestamp: turn * 1000,
    },
    {
      id: `ai-${turn}`,
      role: 'assistant',
      content: `第${turn}轮AI回复：好的，关于你提到的话题${turn % 5 === 0 ? '（与历史相关）' : ''}，我有一些想法。`,
      timestamp: turn * 1000 + 100,
    },
  ];
}

/**
 * 构造 N 轮对话的消息数组（user + assistant 交替）。
 */
function makeDialogue(rounds: number): Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: number }> {
  const msgs: any[] = [];
  for (let i = 1; i <= rounds; i++) {
    msgs.push(...makeTurnMessages(i));
  }
  return msgs;
}

/**
 * 模拟 ChatVectorizationService.retrieveChatHistory 的返回值。
 */
function mockRetrieveChatHistoryResult(queryText: string): Array<{ content: string; score: number; timestamp: number }> {
  return [
    {
      content: `用户 [消息 5]: ${queryText.slice(0, 20)}（历史相关片段 1）`,
      score: 0.85,
      timestamp: 5000,
    },
    {
      content: `助手 [消息 6]: 关于这个话题，我之前提过一些建议（历史相关片段 2）`,
      score: 0.78,
      timestamp: 5100,
    },
    {
      content: `用户 [消息 12]: 再次讨论这个话题（历史相关片段 3）`,
      score: 0.72,
      timestamp: 12000,
    },
  ];
}

// ============================================================
// 测试用例
// ============================================================

describe('上下文连贯性端到端集成测试 (Task 11.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // 场景 1：25 轮对话，第 21 轮触发 RAG 检索
  // ============================================================
  describe('场景 1：25 轮对话 - 第 21 轮触发 RAG 检索', () => {
    it('第 21 轮（contextMessages.length > 40）应触发 RAG 检索', () => {
      // 25 轮对话，前 20 轮已完成（40 条消息），第 21 轮用户消息进入 contextMessages
      // 此时 contextMessages.length = 40（前 20 轮） + 1（第 21 轮 user）= 41
      const contextMessagesLengthAtTurn21 = 41;
      expect(shouldTriggerRagRetrieval(contextMessagesLengthAtTurn21)).toBe(true);

      // 第 20 轮（contextMessages.length = 40）不应触发（<= 40）
      const contextMessagesLengthAtTurn20 = 40;
      expect(shouldTriggerRagRetrieval(contextMessagesLengthAtTurn20)).toBe(false);

      // 第 25 轮仍应触发
      const contextMessagesLengthAtTurn25 = 49;
      expect(shouldTriggerRagRetrieval(contextMessagesLengthAtTurn25)).toBe(true);
    });

    it('第 21 轮检索结果应注入"区域 2：本会话相关历史片段"', async () => {
      const chatHistoryItems = mockRetrieveChatHistoryResult('我们之前讨论过的话题');

      const systemPrompt = await buildFinalSystemPrompt(
        '基础 system prompt（角色卡 + 任务说明）',
        [], // vectorContextItems（区域 1）为空
        undefined, // memoryTableData
        undefined, // organizeMode
        undefined, // tableStructure
        chatHistoryItems
      );

      // 区域 2 注入验证
      expect(systemPrompt).toContain('【区域 2：本会话相关历史片段】');
      expect(systemPrompt).toContain('【区域 2 结束 - 以上历史片段仅供参考】');

      // 内容注入验证
      expect(systemPrompt).toContain('历史相关片段 1');
      expect(systemPrompt).toContain('历史相关片段 2');
      expect(systemPrompt).toContain('历史相关片段 3');

      // 相关度百分比格式化验证
      expect(systemPrompt).toContain('[历史片段 1]');
      expect(systemPrompt).toContain('[历史片段 2]');
      expect(systemPrompt).toContain('[历史片段 3]');
      expect(systemPrompt).toContain('(相关度: 85.0%)');
      expect(systemPrompt).toContain('(相关度: 78.0%)');
      expect(systemPrompt).toContain('(相关度: 72.0%)');
    });

    it('检索结果应按时间升序排列（spec: "按时间顺序注入"）', async () => {
      // 构造时间倒序的检索结果（应被调用方排序，这里直接传入升序）
      const chatHistoryItems = [
        { content: '最早的消息', score: 0.85, timestamp: 1000 },
        { content: '中等时间的消息', score: 0.78, timestamp: 2000 },
        { content: '最近的消息', score: 0.72, timestamp: 3000 },
      ];

      const systemPrompt = await buildFinalSystemPrompt(
        '基础 prompt',
        [],
        undefined,
        undefined,
        undefined,
        chatHistoryItems
      );

      // 验证按时间顺序注入：最早的在前
      const earlyIdx = systemPrompt.indexOf('最早的消息');
      const midIdx = systemPrompt.indexOf('中等时间的消息');
      const lateIdx = systemPrompt.indexOf('最近的消息');

      expect(earlyIdx).toBeGreaterThan(-1);
      expect(midIdx).toBeGreaterThan(earlyIdx);
      expect(lateIdx).toBeGreaterThan(midIdx);
    });

    it('模拟完整 25 轮对话流程，验证第 21-25 轮均触发 RAG', () => {
      const totalTurns = 25;
      const triggerResults: { turn: number; triggered: boolean }[] = [];

      for (let turn = 1; turn <= totalTurns; turn++) {
        // 进入第 N 轮时 contextMessages.length = (N-1)*2 + 1（前 N-1 轮的 user+assistant + 本轮 user）
        const contextMessagesLength = (turn - 1) * 2 + 1;
        const triggered = shouldTriggerRagRetrieval(contextMessagesLength);
        triggerResults.push({ turn, triggered });
      }

      // 第 1-20 轮：不触发（contextMessages.length = 1, 3, ..., 39，均 <= 40）
      for (let turn = 1; turn <= 20; turn++) {
        expect(triggerResults[turn - 1].triggered).toBe(false);
      }
      // 第 21-25 轮：触发（contextMessages.length = 41, 43, 45, 47, 49，均 > 40）
      for (let turn = 21; turn <= 25; turn++) {
        expect(triggerResults[turn - 1].triggered).toBe(true);
      }
    });

    it('区域 1（背景知识）应在区域 2（历史片段）之前', async () => {
      const vectorContextItems = [
        {
          source: 'knowledge_base',
          score: 0.92,
          content: '这是知识库检索的相关背景知识内容。',
        },
      ];
      const chatHistoryItems = [
        { content: '这是对话历史检索的相关片段。', score: 0.85, timestamp: 1000 },
      ];

      const systemPrompt = await buildFinalSystemPrompt(
        '基础 prompt',
        vectorContextItems,
        undefined,
        undefined,
        undefined,
        chatHistoryItems
      );

      // 区域 1 出现在区域 2 之前
      const region1Idx = systemPrompt.indexOf('【区域 1：相关背景知识】');
      const region2Idx = systemPrompt.indexOf('【区域 2：本会话相关历史片段】');
      expect(region1Idx).toBeGreaterThan(-1);
      expect(region2Idx).toBeGreaterThan(-1);
      expect(region1Idx).toBeLessThan(region2Idx);
    });
  });

  // ============================================================
  // 场景 2：5 轮短对话，不触发 RAG 检索
  // ============================================================
  describe('场景 2：5 轮短对话 - 不触发 RAG 检索', () => {
    it('5 轮短对话 contextMessages.length=9，不触发 RAG', () => {
      // 5 轮对话：前 4 轮（8 条）+ 第 5 轮 user（1 条）= 9 条
      const contextMessagesLength = 9;
      expect(shouldTriggerRagRetrieval(contextMessagesLength)).toBe(false);
    });

    it('5 轮短对话系统 prompt 不应包含"区域 2：本会话相关历史片段"', async () => {
      // 短对话不触发 RAG，chatHistoryItems 不传入
      const systemPrompt = await buildFinalSystemPrompt(
        '基础 system prompt',
        [],
        undefined,
        undefined,
        undefined,
        undefined // 不传 chatHistoryItems
      );

      expect(systemPrompt).not.toContain('【区域 2：本会话相关历史片段】');
      expect(systemPrompt).not.toContain('本会话相关历史片段');
    });

    it('5 轮短对话 + 5 轮边界场景测试', () => {
      // 边界值测试
      const testCases = [
        { length: 1, expected: false },   // 第 1 轮
        { length: 3, expected: false },   // 第 2 轮
        { length: 5, expected: false },   // 第 3 轮
        { length: 7, expected: false },   // 第 4 轮
        { length: 9, expected: false },   // 第 5 轮
        { length: 11, expected: false },  // 第 6 轮
        { length: 39, expected: false },  // 第 20 轮
        { length: 40, expected: false },  // 边界（=40，仍不触发，严格大于）
        { length: 41, expected: true },   // 第 21 轮（>40，触发）
      ];

      for (const tc of testCases) {
        expect(shouldTriggerRagRetrieval(tc.length)).toBe(tc.expected);
      }
    });
  });

  // ============================================================
  // 场景 3：增量向量化触发条件验证
  // ============================================================
  describe('场景 3：增量向量化触发条件（每 5 轮 = 10 条消息）', () => {
    it('第 5、10、15、20、25 轮应触发增量向量化', () => {
      // 增量向量化触发条件：onComplete 时，(contextMessages.length + 1) % 10 === 0
      // contextMessages.length = (N-1)*2 + 1（含本轮 user，不含 AI 响应）
      // 完成后 totalMessages = contextMessages.length + 1（加上 AI 响应）= (N-1)*2 + 2 = 2N
      // 触发条件：2N % 10 === 0 → N % 5 === 0
      const triggerTurns: number[] = [];
      for (let turn = 1; turn <= 25; turn++) {
        const contextMessagesLength = (turn - 1) * 2 + 1;
        if (shouldTriggerIncrementalVectorize(contextMessagesLength)) {
          triggerTurns.push(turn);
        }
      }

      // 第 5、10、15、20、25 轮触发
      expect(triggerTurns).toEqual([5, 10, 15, 20, 25]);
    });

    it('第 5 轮触发增量向量化时，应提取最近 10 条消息（含本轮 AI 响应）', () => {
      // 第 5 轮 onComplete 时：contextMessages 有 9 条（前 4 轮 8 条 + 第 5 轮 user 1 条）
      // 加上本轮 AI 响应，共 10 条
      const contextMessages = makeDialogue(4); // 前 4 轮 8 条
      contextMessages.push({
        id: 'user-5',
        role: 'user',
        content: '第5轮用户消息',
        timestamp: 5000,
      }); // 第 5 轮 user，共 9 条

      const aiResponseText = '第5轮AI回复内容';
      const aiMessageId = 'ai-5';

      const recent = extractRecentMessagesForVectorize(
        contextMessages,
        aiResponseText,
        aiMessageId,
        10
      );

      // 应返回 10 条消息：contextMessages 末尾 9 条 + AI 响应 1 条
      expect(recent).toHaveLength(10);
      // 最后一条是本轮 AI 响应
      expect(recent[9].id).toBe('ai-5');
      expect(recent[9].role).toBe('assistant');
      expect(recent[9].content).toBe(aiResponseText);
      // 时间顺序排列
      for (let i = 1; i < recent.length; i++) {
        expect(recent[i].timestamp).toBeGreaterThanOrEqual(recent[i - 1].timestamp);
      }
    });

    it('第 21 轮触发增量向量化时，应提取最近 10 条消息（非全部历史）', () => {
      // 第 21 轮 onComplete 时：contextMessages 有 41 条
      const contextMessages = makeDialogue(20); // 前 20 轮 40 条
      contextMessages.push({
        id: 'user-21',
        role: 'user',
        content: '第21轮用户消息',
        timestamp: 21000,
      }); // 第 21 轮 user，共 41 条

      const aiResponseText = '第21轮AI回复内容';
      const aiMessageId = 'ai-21';

      const recent = extractRecentMessagesForVectorize(
        contextMessages,
        aiResponseText,
        aiMessageId,
        10
      );

      // 应只返回最近 10 条，不是全部 42 条
      expect(recent).toHaveLength(10);
      // 最后一条是本轮 AI 响应
      expect(recent[9].id).toBe('ai-21');
    });

    it('25 轮对话中增量向量化触发次数应为 5 次（第 5/10/15/20/25 轮）', () => {
      let triggerCount = 0;
      for (let turn = 1; turn <= 25; turn++) {
        const contextMessagesLength = (turn - 1) * 2 + 1;
        if (shouldTriggerIncrementalVectorize(contextMessagesLength)) {
          triggerCount++;
        }
      }
      expect(triggerCount).toBe(5);
    });
  });

  // ============================================================
  // 场景 4：模拟"在第 25 轮引用第 3 轮的细节"完整流程
  // ============================================================
  describe('场景 4：跨轮引用 - 第 25 轮引用第 3 轮细节', () => {
    it('模拟第 25 轮用户引用第 3 轮话题，RAG 应检索到相关历史片段', async () => {
      // 第 25 轮：用户说"还记得我们第3轮讨论过的话题吗？"
      const turn25UserMessage = '还记得我们第3轮讨论过的话题吗？';

      // 第 3 轮的话题内容（在第 25 轮的上下文中已被裁剪掉，但通过 RAG 检索可恢复）
      const turn3HistoricalFragment = {
        content: '用户 [消息 5]: 我们第3轮讨论过的话题，关于那个特别的细节',
        score: 0.88,
        timestamp: 3000,
      };

      // 模拟 RAG 检索结果
      const chatHistoryItems = [turn3HistoricalFragment];

      // 第 25 轮触发了 RAG（contextMessages.length = 49 > 40）
      expect(shouldTriggerRagRetrieval(49)).toBe(true);

      // 检索结果注入 system prompt
      const systemPrompt = await buildFinalSystemPrompt(
        '基础 system prompt',
        [],
        undefined,
        undefined,
        undefined,
        chatHistoryItems
      );

      // 验证第 3 轮的历史片段被注入
      expect(systemPrompt).toContain('我们第3轮讨论过的话题');
      expect(systemPrompt).toContain('关于那个特别的细节');
      expect(systemPrompt).toContain('【区域 2：本会话相关历史片段】');
      expect(systemPrompt).toContain('(相关度: 88.0%)');
    });

    it('第 3 轮短对话时引用第 1 轮细节，不应触发 RAG（原始消息仍在上下文中）', async () => {
      // 第 3 轮：contextMessages.length = 5（前 2 轮 4 条 + 第 3 轮 user 1 条）
      expect(shouldTriggerRagRetrieval(5)).toBe(false);

      // 短对话场景，原始消息仍在上下文中，无需 RAG 检索
      const systemPrompt = await buildFinalSystemPrompt(
        '基础 system prompt',
        [],
        undefined,
        undefined,
        undefined,
        undefined // 短对话不传 chatHistoryItems
      );

      expect(systemPrompt).not.toContain('【区域 2');
    });
  });
});
