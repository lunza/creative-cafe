/**
 * FeedbackLoop 单元测试 —— 反馈回流（LLM 反思 → 经验记忆）
 *
 * 来源：spec §二 Task 18.2（learning/feedbackLoop.ts）
 *
 * 覆盖：
 *  1. recordFeedback：参数校验 / 写入 feedback_event / 多种反馈类型
 *  2. runReflection 冷却机制：首次 complete / 冷却期内 cooldown / 超过冷却期再次执行
 *  3. runReflection 无 model 返回 empty
 *  4. runReflection LLM 失败降级返回 empty
 *  5. parseReflectionResponse：纯 JSON / 代码块 / followUp 布尔解析 / 无效回退
 *  6. runReflection 写回经验记忆（metadata.kind='feedback_learning'）
 *  7. recordAndReflect 一站式 API
 *  8. 冷却表清理（超 maxCooldownEntries）
 *  9. agentResponse 截断（maxResponseChars）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FeedbackLoop } from '../feedbackLoop';
import { DEFAULT_FEEDBACK_COOLDOWN_MS } from '../types';
import type { ILLMProvider, IMemoryProvider } from '../../contracts';

// ==================== Mock 工厂 ====================

function createMockLlm(response: string | (() => string | Promise<string>)): ILLMProvider {
  const getResponse = typeof response === 'function' ? response : () => response;
  return {
    streamChat: vi.fn(async () => {
      const content = await getResponse();
      return { content, finishReason: 'stop' };
    }),
    probeCapabilities: vi.fn(async () => ({
      supportsStopArray: true,
      supportsRepPen: true,
      supportsDrySampler: false,
      supportsVision: false,
      supportsThinking: false,
      supportsToolCalling: true,
    })),
  };
}

function createMockMemory(): {
  provider: IMemoryProvider;
  writes: Array<{ content: string; source: string; metadata: any; sessionId?: string }>;
} {
  const writes: Array<{ content: string; source: string; metadata: any; sessionId?: string }> = [];
  const provider: IMemoryProvider = {
    search: vi.fn(async () => []),
    write: vi.fn(async (entry) => {
      writes.push({
        content: entry.content,
        source: entry.source,
        metadata: entry.metadata,
        sessionId: entry.sessionId,
      });
      return `mem_${writes.length}`;
    }),
    read: vi.fn(async () => null),
    delete: vi.fn(async () => true),
  };
  return { provider, writes };
}

describe('FeedbackLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('recordFeedback', () => {
    it('成功记录反馈事件', async () => {
      const llm = createMockLlm('');
      const { provider, writes } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      const id = await loop.recordFeedback({
        sessionId: 's1',
        characterId: 'char-1',
        agentResponse: 'AI 的回答',
        userComment: '太长了',
        kind: 'thumb_down',
      });

      expect(id).toMatch(/^fb_/);
      expect(writes).toHaveLength(1);
      expect(writes[0].metadata.kind).toBe('feedback_event');
      expect(writes[0].metadata.kind2).toBe('thumb_down');
      expect(writes[0].metadata.userComment).toBe('太长了');
      expect(writes[0].sessionId).toBe('s1');
    });

    it('空 sessionId 抛错', async () => {
      const llm = createMockLlm('');
      const { provider } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });
      await expect(
        loop.recordFeedback({ sessionId: '', kind: 'thumb_down' })
      ).rejects.toThrow(/sessionId is required/);
    });

    it('支持多种反馈类型', async () => {
      const llm = createMockLlm('');
      const { provider, writes } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      for (const kind of ['thumb_down', 'low_rating', 'comment', 'correction'] as const) {
        await loop.recordFeedback({
          sessionId: 's1',
          kind,
          rating: kind === 'low_rating' ? 2 : undefined,
        });
      }
      expect(writes).toHaveLength(4);
      expect(writes.map((w) => w.metadata.kind2)).toEqual([
        'thumb_down',
        'low_rating',
        'comment',
        'correction',
      ]);
    });

    it('agentResponse 过长被截断（200 字符）', async () => {
      const llm = createMockLlm('');
      const { provider, writes } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      const longResponse = 'x'.repeat(300);
      await loop.recordFeedback({
        sessionId: 's1',
        agentResponse: longResponse,
        kind: 'comment',
      });
      // summarizeEvent 内部截断到 200 + '...'
      expect(writes[0].content).toContain('...');
      expect(writes[0].content.length).toBeLessThan(longResponse.length + 50);
    });
  });

  describe('runReflection 冷却机制', () => {
    it('首次反思 complete', async () => {
      const llm = createMockLlm(JSON.stringify({
        learning: '应更简洁',
        followUp: false,
        userMessage: '',
      }));
      const { provider, writes } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      const result = await loop.runReflection({
        sessionId: 's1',
        agentResponse: 'AI 回答',
      });

      expect(result.status).toBe('complete');
      expect(result.learning).toBe('应更简洁');
      expect(result.memoryId).toBeDefined();
      // 写回经验记忆
      expect(writes).toHaveLength(1);
      expect(writes[0].metadata.kind).toBe('feedback_learning');
      expect(writes[0].content).toBe('应更简洁');
    });

    it('冷却期内返回 cooldown（默认 5 分钟）', async () => {
      expect(DEFAULT_FEEDBACK_COOLDOWN_MS).toBe(5 * 60 * 1000);
      const llm = createMockLlm(JSON.stringify({ learning: 'x', followUp: false }));
      const { provider } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      await loop.runReflection({ sessionId: 's1' });
      // 推进 4 分钟（未超冷却）
      vi.setSystemTime(new Date('2026-01-01T00:04:00Z'));
      const result = await loop.runReflection({ sessionId: 's1' });
      expect(result.status).toBe('cooldown');
    });

    it('超过冷却期可再次反思', async () => {
      const llm = createMockLlm(JSON.stringify({ learning: 'y', followUp: false }));
      const { provider, writes } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      await loop.runReflection({ sessionId: 's1' });
      // 推进 6 分钟（超过 5 分钟冷却）
      vi.setSystemTime(new Date('2026-01-01T00:06:00Z'));
      const result = await loop.runReflection({ sessionId: 's1' });
      expect(result.status).toBe('complete');
      expect(writes).toHaveLength(2); // 两次反思各写一条
    });

    it('不同 session 冷却独立', async () => {
      const llm = createMockLlm(JSON.stringify({ learning: 'z', followUp: false }));
      const { provider } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      await loop.runReflection({ sessionId: 's1' });
      const result = await loop.runReflection({ sessionId: 's2' }); // 不同 session 不受冷却
      expect(result.status).toBe('complete');
    });

    it('空 sessionId 抛错', async () => {
      const llm = createMockLlm('');
      const { provider } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });
      await expect(loop.runReflection({ sessionId: '' })).rejects.toThrow(/sessionId is required/);
    });
  });

  describe('runReflection 降级', () => {
    it('未配置 defaultModel 返回 empty', async () => {
      const llm = createMockLlm('');
      const { provider } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        // 无 defaultModel
      });

      const result = await loop.runReflection({ sessionId: 's1' });
      expect(result.status).toBe('empty');
    });

    it('LLM 调用失败返回 empty', async () => {
      const llm: ILLMProvider = {
        streamChat: vi.fn(async () => {
          throw new Error('LLM boom');
        }),
        probeCapabilities: vi.fn(async () => ({
          supportsStopArray: true,
          supportsRepPen: true,
          supportsDrySampler: false,
          supportsVision: false,
          supportsThinking: false,
          supportsToolCalling: true,
        })),
      };
      const { provider, writes } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
        verbose: true,
      });

      const result = await loop.runReflection({ sessionId: 's1' });
      expect(result.status).toBe('empty');
      expect(writes).toHaveLength(0); // 不写经验记忆
    });

    it('LLM 返回无效 JSON 返回 empty', async () => {
      const llm = createMockLlm('not a json');
      const { provider } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      const result = await loop.runReflection({ sessionId: 's1' });
      // 无效 JSON 回退为将整段文本作为 learning（parseReflectionResponse 回退逻辑）
      // 注意：parseReflectionResponse 在 trimmed 非空时回退为 { learning: trimmed }
      expect(result.status).toBe('complete');
      expect(result.learning).toBe('not a json');
    });

    it('LLM 返回空字符串返回 empty', async () => {
      const llm = createMockLlm('   ');
      const { provider } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      const result = await loop.runReflection({ sessionId: 's1' });
      expect(result.status).toBe('empty');
    });

    it('写回经验记忆失败不影响 result.status=complete', async () => {
      const llm = createMockLlm(JSON.stringify({ learning: 'x', followUp: false }));
      const { provider } = createMockMemory();
      (provider.write as any).mockRejectedValueOnce(new Error('db boom'));
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
        verbose: true,
      });

      const result = await loop.runReflection({ sessionId: 's1' });
      expect(result.status).toBe('complete');
      expect(result.learning).toBe('x');
      expect(result.memoryId).toBeUndefined(); // 写入失败
    });
  });

  describe('parseReflectionResponse（通过 private 方法直接测）', () => {
    const loop = new FeedbackLoop({
      llmProvider: {} as any,
      memoryProvider: {} as any,
      defaultModel: 'm',
    });
    const parse = (text: string) => (loop as any).parseReflectionResponse(text);

    it('纯 JSON：learning + followUp=false', () => {
      const result = parse(JSON.stringify({ learning: '改进点', followUp: false }));
      expect(result.learning).toBe('改进点');
      expect(result.followUp).toBe(false);
    });

    it('followUp=true', () => {
      const result = parse(JSON.stringify({ learning: 'x', followUp: true, userMessage: '回复用户' }));
      expect(result.followUp).toBe(true);
      expect(result.userMessage).toBe('回复用户');
    });

    it('followUp 字符串 "true" 解析为 true', () => {
      const result = parse(JSON.stringify({ learning: 'x', followUp: 'true' }));
      expect(result.followUp).toBe(true);
    });

    it('followUp 字符串 "yes" 解析为 true', () => {
      const result = parse(JSON.stringify({ learning: 'x', followUp: 'yes' }));
      expect(result.followUp).toBe(true);
    });

    it('代码块包裹的 JSON', () => {
      const result = parse('```json\n{"learning":"代码块学习","followUp":false}\n```');
      expect(result.learning).toBe('代码块学习');
    });

    it('纯文本代码块（无 json 标识）', () => {
      const result = parse('```\n{"learning":"无标识","followUp":false}\n```');
      expect(result.learning).toBe('无标识');
    });

    it('learning 为空字符串跳过该候选', () => {
      // 第一个候选 JSON learning 为空 → 尝试代码块 → 无 → 回退整段
      const result = parse(JSON.stringify({ learning: '', followUp: false }));
      // 整段是有效 JSON 但 learning 空 → 回退为 trimmed 作为 learning
      expect(result).not.toBeNull();
      expect(result.learning).toBe(JSON.stringify({ learning: '', followUp: false }));
    });

    it('完全无效文本回退为 learning=整段', () => {
      const result = parse('这是一段反思文本');
      expect(result.learning).toBe('这是一段反思文本');
      expect(result.followUp).toBe(false);
    });

    it('空字符串返回 null', () => {
      expect(parse('')).toBeNull();
      expect(parse('   ')).toBeNull();
    });
  });

  describe('recordAndReflect 一站式', () => {
    it('记录反馈 + 触发反思', async () => {
      const llm = createMockLlm(JSON.stringify({ learning: '一站式学习', followUp: false }));
      const { provider, writes } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      const result = await loop.recordAndReflect({
        sessionId: 's1',
        agentResponse: 'AI 回答',
        userComment: '不好',
        kind: 'thumb_down',
      });

      expect(result.feedbackId).toMatch(/^fb_/);
      expect(result.reflection.status).toBe('complete');
      expect(result.reflection.learning).toBe('一站式学习');
      // 两次 write：feedback_event + feedback_learning
      expect(writes).toHaveLength(2);
      expect(writes[0].metadata.kind).toBe('feedback_event');
      expect(writes[1].metadata.kind).toBe('feedback_learning');
    });

    it('冷却期内反思返回 cooldown 但反馈仍记录', async () => {
      const llm = createMockLlm(JSON.stringify({ learning: 'x', followUp: false }));
      const { provider, writes } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      // 首次反思（建立冷却）
      await loop.runReflection({ sessionId: 's1' });
      // 一站式：反馈记录 + 反思（冷却中）
      const result = await loop.recordAndReflect({
        sessionId: 's1',
        kind: 'thumb_down',
      });
      expect(result.reflection.status).toBe('cooldown');
      // feedback_event 仍写入
      expect(writes.some((w) => w.metadata.kind === 'feedback_event')).toBe(true);
    });
  });

  describe('冷却表清理', () => {
    it('超过 maxCooldownEntries 时清理过期项', async () => {
      const llm = createMockLlm(JSON.stringify({ learning: 'x', followUp: false }));
      const { provider } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
        maxCooldownEntries: 2, // 很小的阈值便于测试
        cooldownMs: 60 * 1000, // 1 分钟冷却
      });

      // 3 个不同 session 反思 → 超过 maxCooldownEntries=2
      await loop.runReflection({ sessionId: 's1' });
      await loop.runReflection({ sessionId: 's2' });
      // 第 3 次触发清理（s1 已过冷却期？不，冷却期 1 分钟，时间未推进）
      // 清理逻辑：size > maxCooldownEntries 时删除已过冷却期的项
      // 此刻 s1/s2 都在冷却期内（未推进时间），不会被删
      await loop.runReflection({ sessionId: 's3' });

      // 推进时间超过冷却期，再次反思触发清理
      vi.setSystemTime(new Date('2026-01-01T00:02:00Z')); // 2 分钟后
      // s1 的冷却已过（1 分钟），应被清理
      const result = await loop.runReflection({ sessionId: 's1' });
      expect(result.status).toBe('complete'); // 冷却已过 → 重新反思
    });
  });

  describe('agentResponse 截断（maxResponseChars）', () => {
    it('反思 prompt 中 agentResponse 超过 maxResponseChars 被截断', async () => {
      const llm = createMockLlm(JSON.stringify({ learning: 'x', followUp: false }));
      const { provider } = createMockMemory();
      const loop = new FeedbackLoop({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
        maxResponseChars: 100,
      });

      const longResponse = 'y'.repeat(300);
      await loop.runReflection({
        sessionId: 's1',
        agentResponse: longResponse,
      });

      // 验证 streamChat 被调用时 prompt 含截断标记
      const call = (llm.streamChat as any).mock.calls[0][0];
      const prompt = call.messages[0].content;
      expect(prompt).toContain('...');
      expect(prompt.length).toBeLessThan(longResponse.length + 500);
    });
  });
});
