/**
 * GoalTracker 单元测试 —— 会话目标追踪（阻塞计数器）
 *
 * 来源：spec §二 Task 18.2（learning/goalTracker.ts）
 *
 * 覆盖：
 *  1. createGoal：成功创建 / 参数校验 / 已有未完成目标拒绝
 *  2. getGoal：无目标返回 null / 返回最新未完成 / 已完成返回 null
 *  3. updateStatus complete：标记完成
 *  4. updateStatus blocked 阈值：连续 3 次同 blocker 才 blocked / 前 2 次保持 in_progress
 *  5. blocker 不同重置计数
 *  6. token 超额自动 blocked
 *  7. clearGoal：标记 complete（保留审计）
 *  8. 追加日志：每次状态变更写新记忆条目
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoalTracker } from '../goalTracker';
import { GOAL_BLOCKER_THRESHOLD } from '../types';
import type { IMemoryProvider, MemoryEntry } from '../../contracts';

// ==================== 有状态 Mock ====================

/**
 * 创建有状态的 memoryProvider mock。
 *
 * goalTracker 通过 search 检索 goal 记忆 + write 追加新状态。
 * 此 mock 维护内部 goals 数组，write 追加后 search 可检索到。
 *
 * 关键点：
 *  1. search 按 query.sessionId 过滤（对齐 IMemoryProvider 契约，实现会话隔离）
 *  2. write 用递增计数器覆盖 metadata.updatedAt，保证 getGoal 排序稳定
 *     （避免快速调用时 Date.now() 相同导致 sort 不稳定）
 */
function createStatefulMemory() {
  const goals: MemoryEntry[] = [];
  let writeCounter = 0;
  const provider: IMemoryProvider = {
    search: vi.fn(async (query) => {
      let result = [...goals];
      if (query.sessionId) {
        result = result.filter((g) => g.sessionId === query.sessionId);
      }
      return result;
    }),
    write: vi.fn(async (entry) => {
      writeCounter += 1;
      const id = `goal_mem_${writeCounter}`;
      // 用递增计数器覆盖 updatedAt，保证 getGoal 按 updatedAt 降序排序时最新记录始终排第一
      const metadata = { ...(entry.metadata as any), updatedAt: writeCounter };
      goals.push({
        id,
        type: 'agent',
        content: entry.content,
        source: entry.source,
        timestamp: writeCounter,
        metadata,
        sessionId: entry.sessionId,
        characterId: entry.characterId,
      });
      return id;
    }),
    read: vi.fn(async () => null),
    delete: vi.fn(async () => true),
  };
  return { provider, goals };
}

describe('GoalTracker', () => {
  let tracker: GoalTracker;
  let memory: ReturnType<typeof createStatefulMemory>;

  beforeEach(() => {
    memory = createStatefulMemory();
    tracker = new GoalTracker({ memoryProvider: memory.provider });
  });

  describe('createGoal', () => {
    it('成功创建目标（status=pending）', async () => {
      const goal = await tracker.createGoal({
        sessionId: 's1',
        objective: '完成小说第一章',
      });
      expect(goal.sessionId).toBe('s1');
      expect(goal.objective).toBe('完成小说第一章');
      expect(goal.status).toBe('pending');
      expect(goal.tokensUsed).toBe(0);
      expect(goal.id).toMatch(/^goal_/);
      // 落库一次
      expect(memory.provider.write).toHaveBeenCalledTimes(1);
    });

    it('带 characterId 和 tokenBudget', async () => {
      const goal = await tracker.createGoal({
        sessionId: 's1',
        characterId: 'char-1',
        objective: '目标',
        tokenBudget: 10000,
      });
      expect(goal.characterId).toBe('char-1');
      expect(goal.tokenBudget).toBe(10000);
    });

    it('空 sessionId 抛错', async () => {
      await expect(tracker.createGoal({ sessionId: '', objective: 'x' })).rejects.toThrow(
        /sessionId is required/
      );
    });

    it('空 objective 抛错', async () => {
      await expect(tracker.createGoal({ sessionId: 's1', objective: '' })).rejects.toThrow(
        /objective is required/
      );
      await expect(tracker.createGoal({ sessionId: 's1', objective: '   ' })).rejects.toThrow(
        /objective is required/
      );
    });

    it('已有未完成目标时拒绝创建', async () => {
      await tracker.createGoal({ sessionId: 's1', objective: '目标1' });
      await expect(tracker.createGoal({ sessionId: 's1', objective: '目标2' })).rejects.toThrow(
        /already has an active goal/
      );
    });

    it('已完成目标后可创建新目标', async () => {
      await tracker.createGoal({ sessionId: 's1', objective: '目标1' });
      await tracker.updateStatus({ sessionId: 's1', status: 'complete' });
      // 已完成 → 可创建新目标
      const newGoal = await tracker.createGoal({ sessionId: 's1', objective: '目标2' });
      expect(newGoal.objective).toBe('目标2');
      expect(newGoal.status).toBe('pending');
    });

    it('objective 两端空格被 trim', async () => {
      const goal = await tracker.createGoal({ sessionId: 's1', objective: '  带空格  ' });
      expect(goal.objective).toBe('带空格');
    });
  });

  describe('getGoal', () => {
    it('无目标返回 null', async () => {
      expect(await tracker.getGoal('s1')).toBeNull();
    });

    it('返回最新未完成目标', async () => {
      await tracker.createGoal({ sessionId: 's1', objective: '目标A' });
      const goal = await tracker.getGoal('s1');
      expect(goal).not.toBeNull();
      expect(goal!.objective).toBe('目标A');
      expect(goal!.status).toBe('pending');
    });

    it('空 sessionId 返回 null', async () => {
      expect(await tracker.getGoal('')).toBeNull();
    });

    it('search 抛错时返回 null（降级）', async () => {
      (memory.provider.search as any).mockRejectedValueOnce(new Error('db boom'));
      expect(await tracker.getGoal('s1')).toBeNull();
    });

    it('按会话隔离（不同 sessionId 互不影响）', async () => {
      await tracker.createGoal({ sessionId: 's1', objective: '目标1' });
      expect(await tracker.getGoal('s2')).toBeNull();
    });
  });

  describe('updateStatus - complete', () => {
    it('标记目标为 complete', async () => {
      await tracker.createGoal({ sessionId: 's1', objective: '目标' });
      const updated = await tracker.updateStatus({
        sessionId: 's1',
        status: 'complete',
        note: '已完成',
      });
      expect(updated.status).toBe('complete');
      expect(updated.note).toBe('已完成');
      expect(updated.blocker).toBeUndefined();
      expect(updated.consecutiveBlockerCount).toBe(0);
    });

    it('complete 后再 update 抛错（getGoal 返回 null → No active goal）', async () => {
      await tracker.createGoal({ sessionId: 's1', objective: '目标' });
      await tracker.updateStatus({ sessionId: 's1', status: 'complete' });
      // 修复 getGoal bug 后：目标 complete 时 getGoal 返回 null，
      // updateStatus 检测到无 active goal → 抛 'No active goal'
      await expect(
        tracker.updateStatus({ sessionId: 's1', status: 'complete' })
      ).rejects.toThrow(/No active goal/);
    });

    it('tokensDelta 累计到 tokensUsed', async () => {
      await tracker.createGoal({ sessionId: 's1', objective: '目标' });
      const updated = await tracker.updateStatus({
        sessionId: 's1',
        status: 'complete',
        tokensDelta: 500,
      });
      expect(updated.tokensUsed).toBe(500);
    });
  });

  describe('updateStatus - blocked 阈值', () => {
    it('连续 3 次同 blocker 才置为 blocked（阈值=3）', async () => {
      expect(GOAL_BLOCKER_THRESHOLD).toBe(3);
      await tracker.createGoal({ sessionId: 's1', objective: '目标' });

      // 第 1 次：计数 1，仍 in_progress
      let updated = await tracker.updateStatus({
        sessionId: 's1',
        status: 'blocked',
        blocker: '权限不足',
      });
      expect(updated.status).toBe('in_progress');
      expect(updated.consecutiveBlockerCount).toBe(1);
      expect(updated.blocker).toBe('权限不足');

      // 第 2 次：计数 2，仍 in_progress
      updated = await tracker.updateStatus({
        sessionId: 's1',
        status: 'blocked',
        blocker: '权限不足',
      });
      expect(updated.status).toBe('in_progress');
      expect(updated.consecutiveBlockerCount).toBe(2);

      // 第 3 次：计数 3，置为 blocked
      updated = await tracker.updateStatus({
        sessionId: 's1',
        status: 'blocked',
        blocker: '权限不足',
      });
      expect(updated.status).toBe('blocked');
      expect(updated.consecutiveBlockerCount).toBe(3);
    });

    it('不同 blocker 重置计数为 1', async () => {
      await tracker.createGoal({ sessionId: 's1', objective: '目标' });

      await tracker.updateStatus({ sessionId: 's1', status: 'blocked', blocker: 'blockerA' });
      await tracker.updateStatus({ sessionId: 's1', status: 'blocked', blocker: 'blockerA' });
      // 切换 blocker → 重置
      const updated = await tracker.updateStatus({
        sessionId: 's1',
        status: 'blocked',
        blocker: 'blockerB',
      });
      expect(updated.consecutiveBlockerCount).toBe(1);
      expect(updated.status).toBe('in_progress');
      expect(updated.blocker).toBe('blockerB');
    });

    it('complete 后阻塞计数器重置为 0', async () => {
      await tracker.createGoal({ sessionId: 's1', objective: '目标' });
      await tracker.updateStatus({ sessionId: 's1', status: 'blocked', blocker: 'b1' });
      await tracker.updateStatus({ sessionId: 's1', status: 'blocked', blocker: 'b1' });

      const completed = await tracker.updateStatus({
        sessionId: 's1',
        status: 'complete',
      });
      expect(completed.consecutiveBlockerCount).toBe(0);
    });
  });

  describe('updateStatus - token 超额', () => {
    it('tokensUsed 超过 tokenBudget 自动 blocked', async () => {
      await tracker.createGoal({
        sessionId: 's1',
        objective: '目标',
        tokenBudget: 1000,
      });

      const updated = await tracker.updateStatus({
        sessionId: 's1',
        status: 'complete', // 即使请求 complete，超额也强制 blocked
        tokensDelta: 1500,
      });
      expect(updated.status).toBe('blocked');
      expect(updated.blocker).toBe('token_budget_exceeded');
      expect(updated.tokensUsed).toBe(1500);
      expect(updated.consecutiveBlockerCount).toBe(GOAL_BLOCKER_THRESHOLD);
    });

    it('tokenBudget 未设置时不触发超额 blocked', async () => {
      await tracker.createGoal({ sessionId: 's1', objective: '目标' }); // 无 tokenBudget
      const updated = await tracker.updateStatus({
        sessionId: 's1',
        status: 'complete',
        tokensDelta: 999999,
      });
      expect(updated.status).toBe('complete');
    });

    it('tokensUsed 恰好等于 tokenBudget 不触发超额', async () => {
      await tracker.createGoal({
        sessionId: 's1',
        objective: '目标',
        tokenBudget: 1000,
      });
      const updated = await tracker.updateStatus({
        sessionId: 's1',
        status: 'complete',
        tokensDelta: 1000,
      });
      expect(updated.status).toBe('complete'); // 等于不算超额
    });
  });

  describe('updateStatus - 参数校验', () => {
    it('空 sessionId 抛错', async () => {
      await expect(
        tracker.updateStatus({ sessionId: '', status: 'complete' })
      ).rejects.toThrow(/sessionId is required/);
    });

    it('无目标时抛错', async () => {
      await expect(
        tracker.updateStatus({ sessionId: 's1', status: 'complete' })
      ).rejects.toThrow(/No active goal/);
    });
  });

  describe('clearGoal', () => {
    it('标记目标为 complete（note=cleared by user）', async () => {
      await tracker.createGoal({ sessionId: 's1', objective: '目标' });
      await tracker.clearGoal('s1');
      const goal = await tracker.getGoal('s1');
      expect(goal).toBeNull(); // 已完成 → getGoal 返回 null
    });

    it('无目标时 clearGoal 静默无操作', async () => {
      await expect(tracker.clearGoal('s1')).resolves.toBeUndefined();
    });
  });

  describe('追加日志（审计）', () => {
    it('每次状态变更写新记忆条目', async () => {
      await tracker.createGoal({ sessionId: 's1', objective: '目标' });
      // create: 1 次 write
      expect(memory.provider.write).toHaveBeenCalledTimes(1);

      await tracker.updateStatus({ sessionId: 's1', status: 'blocked', blocker: 'b1' });
      // +1 次 write
      expect(memory.provider.write).toHaveBeenCalledTimes(2);

      await tracker.updateStatus({ sessionId: 's1', status: 'complete' });
      // +1 次 write
      expect(memory.provider.write).toHaveBeenCalledTimes(3);

      // 验证最后一条记忆的 action
      const lastWrite = (memory.provider.write as any).mock.calls[2][0];
      expect(lastWrite.metadata.action).toBe('update:complete');
    });

    it('persistGoal 写入 metadata.kind=goal', async () => {
      await tracker.createGoal({ sessionId: 's1', objective: '目标' });
      const writeCall = (memory.provider.write as any).mock.calls[0][0];
      expect(writeCall.metadata.kind).toBe('goal');
      expect(writeCall.metadata.objective).toBe('目标');
      expect(writeCall.metadata.status).toBe('pending');
      expect(writeCall.metadata.action).toBe('create');
    });
  });
});
