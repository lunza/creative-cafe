/**
 * ContextTruncator 测试
 *
 * 验证目标（spec Task 2.5）：
 * 1. 100 轮对话（每轮约 200 token）+ maxContextTokens=8000：必填项必须全部注入，
 *    裁剪后对话历史 token ≤ 8000 - 4096（剩余预算）
 * 2. 短对话（5 轮）+ 大 maxContextTokens：所有消息保留
 * 3. minMessagesToKeep 软下限：预算紧张时仍尽量保留最近 N 条（不强制挤占必填项）
 *
 * 实现说明：
 * - 通过 vi.spyOn(TokenCounter, 'countMessageTokens') mock 返回受控 token 数，
 *   使断言精确且不依赖 IPC / 字节估算（测试环境无 electronAPI）。
 * - TokenBudget 单元行为单独验证。
 *
 * Spec: optimize-chat-ai-intelligence / Task 2
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ContextTruncator, TokenBudget } from '../ContextTruncator';
import { TokenCounter } from '../TokenCounter';
import { ChatMessage } from '../../CharacterDialogueChat.types';
import { TruncationConfig } from '../types';
import {
  STOP_SEQUENCE_RESERVE,
  ARRAY_PADDING_TOKENS,
  DEFAULT_MAX_TOKENS,
} from '../constants';

// ============================================================
// 测试工具
// ============================================================

let messageIdCounter = 0;
function makeMessage(role: 'user' | 'assistant', content: string, id?: string): ChatMessage {
  messageIdCounter += 1;
  return {
    id: id ?? `msg-${messageIdCounter}`,
    role,
    content,
    timestamp: Date.now(),
  };
}

/**
 * 构造 n 轮对话（user + assistant 成对），每条消息 token 数由 mock 控制。
 */
function makeDialogue(rounds: number): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (let i = 0; i < rounds; i++) {
    msgs.push(makeMessage('user', `用户第${i + 1}轮消息`));
    msgs.push(makeMessage('assistant', `助手第${i + 1}轮回复`));
  }
  return msgs;
}

function defaultConfig(overrides: Partial<TruncationConfig> = {}): TruncationConfig {
  return {
    enabled: true,
    maxContextTokens: 8000,
    reservedForResponse: 4096,
    minMessagesToKeep: 3,
    maxMessagesToKeep: 60,
    ...overrides,
  };
}

describe('TokenBudget', () => {
  it('should initialize with total = remaining, reserved = 0', () => {
    const b = new TokenBudget(1000);
    expect(b.total).toBe(1000);
    expect(b.remaining).toBe(1000);
    expect(b.reserved).toBe(0);
  });

  it('reserve should deduct and return true when within budget', () => {
    const b = new TokenBudget(1000);
    expect(b.reserve('a', 300)).toBe(true);
    expect(b.remaining).toBe(700);
    expect(b.reserved).toBe(300);
    expect(b.canAfford(700)).toBe(true);
    expect(b.canAfford(701)).toBe(false);
  });

  it('reserve should clamp at 0 and return false when over budget (forced reserve)', () => {
    const b = new TokenBudget(1000);
    expect(b.reserve('a', 600)).toBe(true);
    expect(b.reserve('b', 600)).toBe(false); // 600 > 400 remaining
    expect(b.remaining).toBe(0);
    expect(b.reserved).toBe(1200); // still recorded
  });

  it('free should restore remaining (clamped at total)', () => {
    const b = new TokenBudget(1000);
    b.reserve('a', 300);
    b.free('a');
    expect(b.remaining).toBe(1000);
    expect(b.reserved).toBe(0);
  });

  it('free on unknown key should be a no-op', () => {
    const b = new TokenBudget(1000);
    b.free('nonexistent');
    expect(b.remaining).toBe(1000);
  });

  it('reserve should accumulate same key across calls', () => {
    const b = new TokenBudget(1000);
    b.reserve('a', 200);
    b.reserve('a', 300);
    expect(b.reserved).toBe(500);
    expect(b.remaining).toBe(500);
    b.free('a');
    expect(b.remaining).toBe(1000);
  });

  it('should floor and treat negative tokens as 0', () => {
    const b = new TokenBudget(1000);
    expect(b.reserve('a', -50)).toBe(true);
    expect(b.reserved).toBe(0);
    expect(b.canAfford(-10)).toBe(true);
  });

  it('should handle zero total budget', () => {
    const b = new TokenBudget(0);
    expect(b.reserve('a', 100)).toBe(false);
    expect(b.remaining).toBe(0);
    expect(b.canAfford(1)).toBe(false);
  });
});

describe('ContextTruncator.truncateMessages', () => {
  let countMessageTokensSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    messageIdCounter = 0;
    // 默认 mock：每条消息 200 tokens（模拟"每轮约 200 token"场景）
    countMessageTokensSpy = vi.spyOn(TokenCounter, 'countMessageTokens').mockReturnValue(200);
  });

  afterEach(() => {
    countMessageTokensSpy.mockRestore();
  });

  // ============================================================
  // 场景 1：100 轮对话 + maxContextTokens=8000，必填项全部注入，历史不超剩余预算
  // ============================================================
  describe('Scenario 1: 100 rounds + maxContextTokens=8000 (budget tight)', () => {
    it('should inject all required items and keep history within remaining budget', () => {
      const messages = makeDialogue(100); // 200 条消息
      const systemPromptTokens = 500;
      const config = defaultConfig({ maxContextTokens: 8000, reservedForResponse: 4096 });

      const result = ContextTruncator.truncateMessages(messages, systemPromptTokens, config);

      // 必填项已 reserve：systemPrompt(500) + roleAnchor(0) + stopSeq(512) + exampleMsg(0) + response(4096) = 5108
      // 数组填充 3 -> 历史预算 = 8000 - 5108 - 3 = 2889
      // 每条 200 token -> 最多 14 条历史
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(60); // maxMessagesToKeep

      // 裁剪后历史 token ≤ 剩余预算（2889）
      const historyTokens = result.reduce((sum, _m) => sum + 200, 0);
      const historyBudget = 8000 - 5108 - ARRAY_PADDING_TOKENS;
      expect(historyTokens).toBeLessThanOrEqual(historyBudget);

      // 必填项"已注入"体现为：历史预算正确扣减，裁剪后历史 token 不超过剩余预算
      // （systemPrompt / responseReserve 本身不进入 messages 列表，由调用方注入请求体）
      expect(historyBudget).toBe(8000 - 500 - 0 - STOP_SEQUENCE_RESERVE - 0 - 4096 - ARRAY_PADDING_TOKENS);

      // 软下限：minMessagesToKeep=3 -> 最近 6 条应被保留（预算允许时）
      // 6 条 * 200 = 1200 ≤ 2889，软下限成立
      expect(result.length).toBeGreaterThanOrEqual(6);
    });

    it('should respect maxMessagesToKeep cap', () => {
      const messages = makeDialogue(100);
      const config = defaultConfig({
        maxContextTokens: 8000,
        maxMessagesToKeep: 10,
      });

      const result = ContextTruncator.truncateMessages(messages, 500, config);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it('should accept explicit requiredItems overriding defaults', () => {
      const messages = makeDialogue(50);
      const config = defaultConfig({ maxContextTokens: 8000 });

      // 显式传入 roleAnchor=300（模拟 Task 4 注入）
      const requiredItems = [
        { key: 'systemPrompt', tokens: 500 },
        { key: 'roleAnchor', tokens: 300 },
        { key: 'stopSequenceReserve', tokens: STOP_SEQUENCE_RESERVE },
        { key: 'exampleMessages', tokens: 0 },
        { key: 'responseReserve', tokens: 4096 },
      ];

      const result = ContextTruncator.truncateMessages(messages, 500, config, requiredItems);
      // 必填项 = 500+300+512+0+4096 = 5408；数组填充 3；历史预算 = 8000-5408-3 = 2589
      // 软下限 6*200=1200 ≤ 2589 -> 保留最近 6 条；剩余 2589-1200=1389 -> 再加 6 条(1200) -> 共 12 条
      expect(result.length).toBeGreaterThan(0);
      const historyTokens = result.length * 200;
      expect(historyTokens).toBeLessThanOrEqual(8000 - 5408 - ARRAY_PADDING_TOKENS);
    });
  });

  // ============================================================
  // 场景 2：短对话（5 轮）+ 大 maxContextTokens，所有消息保留
  // ============================================================
  describe('Scenario 2: 5 rounds + large maxContextTokens (no truncation)', () => {
    it('should keep all messages when within budget', () => {
      const messages = makeDialogue(5); // 10 条
      const config = defaultConfig({ maxContextTokens: 32000 });

      const result = ContextTruncator.truncateMessages(messages, 1000, config);
      expect(result.length).toBe(10); // 全部保留
      expect(result[0].role).toBe('user');
    });

    it('should preserve message order', () => {
      const messages = makeDialogue(3);
      const config = defaultConfig({ maxContextTokens: 32000 });

      const result = ContextTruncator.truncateMessages(messages, 1000, config);
      expect(result.map(m => m.id)).toEqual(messages.map(m => m.id));
    });
  });

  // ============================================================
  // 场景 3：minMessagesToKeep 软下限
  // ============================================================
  describe('Scenario 3: minMessagesToKeep soft lower bound', () => {
    it('should keep at least minMessagesToKeep*2 recent messages when budget allows', () => {
      const messages = makeDialogue(50); // 100 条
      const config = defaultConfig({
        maxContextTokens: 8000,
        minMessagesToKeep: 3, // 期望最近 6 条
      });

      const result = ContextTruncator.truncateMessages(messages, 500, config);
      // 历史预算 2889，6*200=1200 <= 2889 -> 软下限成立
      expect(result.length).toBeGreaterThanOrEqual(6);
      // 结果末尾应包含最近 6 条原始消息
      const lastSix = messages.slice(-6);
      expect(result.slice(-6).map(m => m.id)).toEqual(lastSix.map(m => m.id));
    });

    it('should NOT force recent messages when budget exhausted by required items (soft, not hard)', () => {
      // 必填项几乎占满预算：systemPrompt=3000 + response=4096 + stopSeq=512 = 7608
      // maxContextTokens=8000 -> 历史预算 = 8000-7608-3 = 389
      // 每条 200 token -> 软下限 6*200=1200 > 389 -> 软下限不成立
      // 不强制保留 6 条；只保留能装下的最近消息（1 条强制）
      const messages = makeDialogue(30);
      const config = defaultConfig({
        maxContextTokens: 8000,
        reservedForResponse: 4096,
        minMessagesToKeep: 3,
      });

      const result = ContextTruncator.truncateMessages(messages, 3000, config);
      // 历史预算仅 389，每条 200 -> 最多 1 条（强制保留最近 1 条避免空上下文）
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.length).toBeLessThanOrEqual(2); // 389 / 200 ≈ 1.9
    });

    it('should force-keep at least 1 message even when budget is 0 for history', () => {
      const messages = makeDialogue(10);
      // 必填项 = 1000 + 0 + 512 + 0 + 4096 = 5608 > maxContextTokens=5000 -> 历史预算为 0
      const config = defaultConfig({ maxContextTokens: 5000 });

      const result = ContextTruncator.truncateMessages(messages, 1000, config);
      // 至少保留最近 1 条（避免空上下文）
      expect(result.length).toBeGreaterThanOrEqual(1);
      // 最后一应是原始消息的最后一条
      expect(result[result.length - 1].id).toBe(messages[messages.length - 1].id);
    });

    it('should keep recent messages even when they are larger than older ones', () => {
      // 前 20 条小消息（50 token），最近 6 条大消息（500 token）
      const messages = makeDialogue(13); // 26 条
      const tokensByIndex = new Map<string, number>();
      messages.forEach((m, i) => {
        tokensByIndex.set(m.id, i < 20 ? 50 : 500);
      });
      countMessageTokensSpy.mockRestore();
      countMessageTokensSpy = vi.spyOn(TokenCounter, 'countMessageTokens').mockImplementation(
        (msg: ChatMessage) => tokensByIndex.get(msg.id) ?? 100
      );

      const config = defaultConfig({
        maxContextTokens: 4000,
        minMessagesToKeep: 3, // 期望最近 6 条（共 3000 token）
      });
      // 必填项 = 500 + 512 + 4096 = 5108 > 4000... 调整 reservedForResponse
      config.reservedForResponse = 500;
      // 必填项 = 500 + 512 + 500 = 1512；数组 3；历史预算 = 4000-1512-3 = 2485
      // 软下限 6*500=3000 > 2485 -> 软下限不成立，倒序填充
      const result = ContextTruncator.truncateMessages(messages, 500, config);
      // 倒序：最近 1 条 500 -> 余 1985；第 2 条 500 -> 余 1485；第 3 条 500 -> 余 985；
      // 第 4 条 500 -> 余 485；第 5 条 500 -> 不够，但 result.length=4 < 1? 不，result.length=4 时下一条不够 -> break
      // 实际：500*4=2000 <= 2485, 500*5=2500 > 2485 -> 保留 4 条大消息
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.length).toBeLessThanOrEqual(5);
    });
  });

  // ============================================================
  // 边界场景
  // ============================================================
  describe('Edge cases', () => {
    it('should return empty array for empty messages', () => {
      const result = ContextTruncator.truncateMessages([], 500, defaultConfig());
      expect(result).toEqual([]);
    });

    it('should handle single message', () => {
      const messages = [makeMessage('user', 'hello')];
      const result = ContextTruncator.truncateMessages(messages, 500, defaultConfig());
      expect(result.length).toBe(1);
    });

    it('should drop leading assistant message to keep pairs (ensureMessagePairs)', () => {
      // 构造 assistant 开头的历史（模拟截断后首条为 assistant）
      const messages: ChatMessage[] = [
        makeMessage('assistant', 'first assistant'),
        makeMessage('user', 'user1'),
        makeMessage('assistant', 'assistant1'),
        makeMessage('user', 'user2'),
        makeMessage('assistant', 'assistant2'),
      ];
      // 大预算，全部保留，但 ensureMessagePairs 应丢弃开头的 assistant
      const config = defaultConfig({ maxContextTokens: 32000 });
      const result = ContextTruncator.truncateMessages(messages, 100, config);
      expect(result[0].role).toBe('user');
      expect(result.length).toBe(4); // 丢弃了开头 assistant
    });

    it('requiredItems over-budget should still be force-reserved (warned) and history minimal', () => {
      const messages = makeDialogue(20);
      const config = defaultConfig({ maxContextTokens: 3000 });
      // systemPrompt 2000 + response 4096 = 6096 > 3000 -> 必填项超限，历史预算为 0
      const result = ContextTruncator.truncateMessages(messages, 2000, config);
      expect(result.length).toBeGreaterThanOrEqual(1); // 强制保留最近 1 条
    });
  });
});

// ============================================================
// DEFAULT_MAX_TOKENS 常量验证（Task 2.4）
// ============================================================
describe('DEFAULT_MAX_TOKENS (Task 2.4)', () => {
  it('should be 8192 (unified fallback)', () => {
    expect(DEFAULT_MAX_TOKENS).toBe(8192);
  });
});
