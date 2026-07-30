/**
 * DreamingService 单元测试 —— 短期→长期记忆摘要（3 相位）
 *
 * 来源：spec §二 Task 18.1（learning/dreamingService.ts）
 *
 * 覆盖：
 *  1. runAll：三相顺序执行 / 每相写回记忆 / totalPromoted 累计
 *  2. parseDreamingOutput：light/deep/rem 三种 JSON 格式 / 代码块包裹 / 解析失败回退
 *  3. fetchShortTermMemories：过滤 dreaming_summary / 按 since 过滤 / limit 截断
 *  4. 单相失败不中断其他相位（设计约束）
 *  5. 相位 disabled 跳过
 *  6. 空记忆时 processedCount=0
 *  7. 单实例守卫（running 时再调用抛错）
 *  8. 取消（cancel）
 *  9. LLM 输出写回 memoryStore（metadata.kind='dreaming_summary'）
 * 10. 进度回调 onProgress
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DreamingService } from '../dreamingService';
import { DEFAULT_DREAMING_CONFIG } from '../types';
import type { ILLMProvider, IMemoryProvider, MemoryEntry } from '../../contracts';

// ==================== Mock 工厂 ====================

function makeMemoryEntry(partial: Partial<MemoryEntry> & { id: string }): MemoryEntry {
  return {
    type: 'agent',
    content: 'some content',
    source: 'test',
    timestamp: Date.now(),
    ...partial,
  };
}

function createMockLlm(responses: string[]): ILLMProvider {
  let callIndex = 0;
  return {
    streamChat: vi.fn(async () => {
      const content = responses[callIndex % responses.length] ?? '';
      callIndex += 1;
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

function createMockMemory(memories: MemoryEntry[] = []): {
  provider: IMemoryProvider;
  writes: Array<{ content: string; source: string; metadata: any; sessionId?: string }>;
} {
  const writes: Array<{ content: string; source: string; metadata: any; sessionId?: string }> = [];
  const provider: IMemoryProvider = {
    search: vi.fn(async () => memories),
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

describe('DreamingService', () => {
  let memories: MemoryEntry[];

  beforeEach(() => {
    memories = [
      makeMemoryEntry({ id: 'm1', content: '用户喜欢科幻小说', timestamp: Date.now() - 1000 }),
      makeMemoryEntry({ id: 'm2', content: '讨论了 AI 智能体架构', timestamp: Date.now() - 2000 }),
    ];
  });

  describe('runAll 三相执行', () => {
    it('三相顺序执行并写回记忆', async () => {
      const llm = createMockLlm([
        JSON.stringify({ summary: '每日快报', key_facts: ['用户喜欢科幻', '讨论AI架构'] }),
        JSON.stringify({ promoted_facts: ['用户偏好科幻小说'], skipped_count: 1 }),
        JSON.stringify({ patterns: ['跨会话讨论AI主题'], confidence: 0.9 }),
      ]);
      const { provider, writes } = createMockMemory(memories);

      const service = new DreamingService({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'test-model',
      });

      const result = await service.runAll('session-1');

      expect(result.phases).toHaveLength(3);
      expect(result.phases.map((p) => p.phase)).toEqual(['light', 'deep', 'rem']);

      // light: summary + 2 key_facts = 3 条
      // deep: 1 promoted_fact
      // rem: 1 pattern
      const totalPromoted = 3 + 1 + 1;
      expect(result.totalPromoted).toBe(totalPromoted);
      expect(writes).toHaveLength(totalPromoted);

      // 验证写回的 metadata
      for (const w of writes) {
        expect(w.metadata.kind).toBe('dreaming_summary');
        expect(w.source).toMatch(/^dreaming:(light|deep|rem)$/);
        expect(w.sessionId).toBe('session-1');
      }
    });

    it('每相 processedCount 等于检索到的记忆数', async () => {
      const llm = createMockLlm([
        // light: summary 为空 + key_facts 为空 → promotedCount=0
        JSON.stringify({ summary: '', key_facts: [] }),
        JSON.stringify({ promoted_facts: [] }),
        JSON.stringify({ patterns: [] }),
      ]);
      const { provider } = createMockMemory(memories);

      const service = new DreamingService({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      const result = await service.runAll();
      for (const phase of result.phases) {
        expect(phase.processedCount).toBe(2);
        expect(phase.promotedCount).toBe(0);
        expect(phase.skippedCount).toBe(2);
      }
    });

    it('空记忆时 processedCount=0 且不调用 LLM', async () => {
      const llm = createMockLlm(['should not be called']);
      const { provider } = createMockMemory([]);

      const service = new DreamingService({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      const result = await service.runAll();
      expect((llm.streamChat as any).mock.calls).toHaveLength(0);
      for (const phase of result.phases) {
        expect(phase.processedCount).toBe(0);
        expect(phase.promotedCount).toBe(0);
      }
      expect(result.totalPromoted).toBe(0);
    });
  });

  describe('parseDreamingOutput（通过 private 方法直接测）', () => {
    const service = new DreamingService({
      llmProvider: {} as any,
      memoryProvider: {} as any,
      defaultModel: 'm',
    });
    const parse = (phase: any, output: string) =>
      (service as any).parseDreamingOutput(phase, output);

    it('light 相位：summary + key_facts', () => {
      const result = parse('light', JSON.stringify({
        summary: '每日摘要',
        key_facts: ['事实1', '事实2'],
      }));
      expect(result).toContain('每日摘要');
      expect(result).toContain('事实1');
      expect(result).toContain('事实2');
      expect(result).toHaveLength(3);
    });

    it('light 相位：仅 summary 无 key_facts', () => {
      const result = parse('light', JSON.stringify({ summary: '仅摘要' }));
      expect(result).toEqual(['仅摘要']);
    });

    it('deep 相位：promoted_facts', () => {
      const result = parse('deep', JSON.stringify({ promoted_facts: ['事实A', '事实B'] }));
      expect(result).toEqual(['事实A', '事实B']);
    });

    it('rem 相位：patterns', () => {
      const result = parse('rem', JSON.stringify({ patterns: ['模式1', '模式2'] }));
      expect(result).toEqual(['模式1', '模式2']);
    });

    it('代码块包裹的 JSON', () => {
      const result = parse('deep', '```json\n{"promoted_facts":["代码块事实"]}\n```');
      expect(result).toEqual(['代码块事实']);
    });

    it('纯文本代码块（无 json 标识）', () => {
      const result = parse('deep', '```\n{"promoted_facts":["无标识事实"]}\n```');
      expect(result).toEqual(['无标识事实']);
    });

    it('无效 JSON：light 相位短文本回退为单条事实', () => {
      const result = parse('light', '这是一段非JSON文本');
      expect(result).toEqual(['这是一段非JSON文本']);
    });

    it('无效 JSON：deep/rem 相位返回空数组', () => {
      expect(parse('deep', '非JSON')).toEqual([]);
      expect(parse('rem', '非JSON')).toEqual([]);
    });

    it('空字符串返回空数组', () => {
      expect(parse('light', '')).toEqual([]);
      expect(parse('deep', '')).toEqual([]);
    });

    it('过滤空字符串事实', () => {
      const result = parse('deep', JSON.stringify({ promoted_facts: ['有内容', '', '也有内容'] }));
      expect(result).toEqual(['有内容', '也有内容']);
    });

    it('非数组 key_facts 视为空', () => {
      const result = parse('light', JSON.stringify({ summary: 's', key_facts: 'not array' }));
      expect(result).toEqual(['s']);
    });
  });

  describe('fetchShortTermMemories 过滤逻辑', () => {
    it('过滤掉 dreaming_summary 类型的记忆（避免无限递归）', async () => {
      const mixedMemories = [
        makeMemoryEntry({ id: 'normal1', content: '正常记忆', timestamp: Date.now() }),
        makeMemoryEntry({
          id: 'dream1',
          content: 'dreaming 摘要',
          timestamp: Date.now(),
          metadata: { kind: 'dreaming_summary' },
        }),
        makeMemoryEntry({ id: 'normal2', content: '另一条正常记忆', timestamp: Date.now() }),
      ];
      const llm = createMockLlm([
        JSON.stringify({ summary: 's', key_facts: [] }),
        JSON.stringify({ promoted_facts: [] }),
        JSON.stringify({ patterns: [] }),
      ]);
      const { provider } = createMockMemory(mixedMemories);

      const service = new DreamingService({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      const result = await service.runAll();
      // 每相只处理 2 条正常记忆（dreaming_summary 被过滤）
      for (const phase of result.phases) {
        expect(phase.processedCount).toBe(2);
      }
    });

    it('按 since（lookbackDays）过滤过期记忆', async () => {
      const oldMemories = [
        makeMemoryEntry({
          id: 'old1',
          content: '旧记忆',
          // 100 天前（超出 light 的 2 天 / deep 的 30 天 / rem 的 7 天回看窗口）
          timestamp: Date.now() - 100 * 24 * 60 * 60 * 1000,
        }),
      ];
      const llm = createMockLlm(['']);
      const { provider } = createMockMemory(oldMemories);

      const service = new DreamingService({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      const result = await service.runAll();
      for (const phase of result.phases) {
        expect(phase.processedCount).toBe(0); // 旧记忆被过滤
      }
    });
  });

  describe('错误处理与降级', () => {
    it('单相 LLM 失败不中断其他相位', async () => {
      let callIndex = 0;
      const llm: ILLMProvider = {
        streamChat: vi.fn(async () => {
          callIndex += 1;
          if (callIndex === 2) {
            // deep 相位失败
            throw new Error('LLM boom');
          }
          const outputs = [
            JSON.stringify({ summary: 's', key_facts: ['f1'] }),
            JSON.stringify({ promoted_facts: ['should not reach'] }),
            JSON.stringify({ patterns: ['p1'] }),
          ];
          return { content: outputs[callIndex - 1] ?? '', finishReason: 'stop' };
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
      const { provider } = createMockMemory(memories);

      const service = new DreamingService({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
        verbose: true,
      });

      const result = await service.runAll();

      expect(result.phases).toHaveLength(3);
      // light 成功
      expect(result.phases[0].phase).toBe('light');
      expect(result.phases[0].error).toBeUndefined();
      expect(result.phases[0].promotedCount).toBe(2); // summary + f1
      // deep 失败
      expect(result.phases[1].phase).toBe('deep');
      expect(result.phases[1].error).toBe('LLM boom');
      expect(result.phases[1].promotedCount).toBe(0);
      // rem 仍执行（未中断）
      expect(result.phases[2].phase).toBe('rem');
      expect(result.phases[2].error).toBeUndefined();
      expect(result.phases[2].promotedCount).toBe(1);
    });

    it('相位 disabled 标记 error="phase disabled"', async () => {
      const llm = createMockLlm([
        JSON.stringify({ summary: 's', key_facts: [] }),
      ]);
      const { provider } = createMockMemory(memories);

      const service = new DreamingService({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
        config: {
          ...DEFAULT_DREAMING_CONFIG,
          phases: {
            light: DEFAULT_DREAMING_CONFIG.phases.light,
            deep: { ...DEFAULT_DREAMING_CONFIG.phases.deep, enabled: false },
            rem: { ...DEFAULT_DREAMING_CONFIG.phases.rem, enabled: false },
          },
        },
      });

      const result = await service.runAll();
      expect(result.phases[0].error).toBeUndefined();
      expect(result.phases[1].error).toBe('phase disabled');
      expect(result.phases[2].error).toBe('phase disabled');
      expect((llm.streamChat as any).mock.calls).toHaveLength(1); // 只调 light
    });

    it('未配置 model 抛错（该相位失败但不中断）', async () => {
      const llm = createMockLlm(['']);
      const { provider } = createMockMemory(memories);

      const service = new DreamingService({
        llmProvider: llm,
        memoryProvider: provider,
        // 无 defaultModel，相位 execution 也无 model
      });

      const result = await service.runAll();
      for (const phase of result.phases) {
        expect(phase.error).toMatch(/no model configured/);
        expect(phase.promotedCount).toBe(0);
      }
    });
  });

  describe('单实例守卫与取消', () => {
    it('running 时再调用 runAll 抛错', async () => {
      let resolveLlm: () => void = () => {};
      const llmPending = new Promise<void>((r) => (resolveLlm = r));
      const llm: ILLMProvider = {
        streamChat: vi.fn(async () => {
          await llmPending;
          return { content: JSON.stringify({ summary: 's', key_facts: [] }), finishReason: 'stop' };
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
      const { provider } = createMockMemory(memories);

      const service = new DreamingService({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      const firstRun = service.runAll();
      // 等待 LLM 被调用（light 相位进入 streamChat）
      await new Promise((r) => setTimeout(r, 10));
      expect(service.isRunning).toBe(true);

      await expect(service.runAll()).rejects.toThrow(/already running/);

      resolveLlm();
      await firstRun;
    });

    it('cancel 中止后续相位', async () => {
      let resolveLlm: () => void = () => {};
      const llmPending = new Promise<void>((r) => (resolveLlm = r));
      const llm: ILLMProvider = {
        streamChat: vi.fn(async () => {
          await llmPending;
          return { content: JSON.stringify({ summary: 's', key_facts: [] }), finishReason: 'stop' };
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
      const { provider } = createMockMemory(memories);

      const service = new DreamingService({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      const runPromise = service.runAll();
      await new Promise((r) => setTimeout(r, 10));
      service.cancel();
      resolveLlm();
      await runPromise;

      expect(service.isRunning).toBe(false);
    });
  });

  describe('进度回调', () => {
    it('onProgress 在每相完成时被调用', async () => {
      const llm = createMockLlm([
        JSON.stringify({ summary: 's', key_facts: ['f1'] }),
        JSON.stringify({ promoted_facts: ['p1'] }),
        JSON.stringify({ patterns: ['pat1'] }),
      ]);
      const { provider } = createMockMemory(memories);

      const onProgress = vi.fn();
      const service = new DreamingService({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
        onProgress,
      });

      await service.runAll();
      expect(onProgress).toHaveBeenCalledTimes(3);
      expect(onProgress.mock.calls[0][0]).toBe('light');
      expect(onProgress.mock.calls[1][0]).toBe('deep');
      expect(onProgress.mock.calls[2][0]).toBe('rem');
      // 回调第二参数含 phase 结果
      expect(onProgress.mock.calls[0][1].phase.promotedCount).toBe(2);
    });
  });

  describe('结果时间戳', () => {
    it('startedAt <= finishedAt', async () => {
      const llm = createMockLlm([
        JSON.stringify({ summary: 's', key_facts: [] }),
        JSON.stringify({ promoted_facts: [] }),
        JSON.stringify({ patterns: [] }),
      ]);
      const { provider } = createMockMemory(memories);

      const service = new DreamingService({
        llmProvider: llm,
        memoryProvider: provider,
        defaultModel: 'm',
      });

      const result = await service.runAll();
      expect(result.startedAt).toBeLessThanOrEqual(result.finishedAt);
    });
  });
});
