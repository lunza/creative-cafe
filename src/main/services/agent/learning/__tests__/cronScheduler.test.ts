/**
 * cronScheduler 单元测试 —— 轻量自研 cron + pacing/stagger 防失控
 *
 * 来源：spec §二 Task 18.1（learning/cronScheduler.ts）
 *
 * 覆盖：
 *  1. parseCronExpression：5 字段解析（星号/步长/范围/逗号/单数字/无效）
 *  2. getNextCronRunMs：下一匹配时间计算（分钟级搜索 / 跨小时 / 无匹配抛错）
 *  3. CronScheduler.schedule：注册落库 + getPendingTasks
 *  4. CronScheduler.cancel：删除任务
 *  5. pacing 钳位：minIntervalMs 作为下界
 *  6. stagger 抖动：top-of-hour 自动 5 分钟 / 显式 staggerMs
 *  7. tick 触发任务执行（start + 短轮询间隔）
 *  8. allowConcurrent=false 时跳过仍在执行的任务
 *  9. dreamNow 委托 dreaming 回调
 * 10. LLM 提议 nextDelayMs 被 pacing 钳位
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CronScheduler,
  parseCronExpression,
  getNextCronRunMs,
} from '../cronScheduler';
import { InMemoryAgentBackend } from './fakeBackend';

describe('parseCronExpression', () => {
  it('星号全部匹配', () => {
    const parsed = parseCronExpression('* * * * *');
    expect(parsed.minute.size).toBe(60);
    expect(parsed.hour.size).toBe(24);
    expect(parsed.dayOfMonth.size).toBe(31);
    expect(parsed.month.size).toBe(12);
    expect(parsed.dayOfWeek.size).toBe(7);
  });

  it('单数字字段', () => {
    const parsed = parseCronExpression('0 3 * * *');
    expect(parsed.minute.has(0)).toBe(true);
    expect(parsed.minute.size).toBe(1);
    expect(parsed.hour.has(3)).toBe(true);
    expect(parsed.hour.size).toBe(1);
  });

  it('逗号列表', () => {
    const parsed = parseCronExpression('1,5,10 * * * *');
    expect(parsed.minute.size).toBe(3);
    expect(parsed.minute.has(1)).toBe(true);
    expect(parsed.minute.has(5)).toBe(true);
    expect(parsed.minute.has(10)).toBe(true);
  });

  it('范围', () => {
    const parsed = parseCronExpression('1-5 * * * *');
    expect(parsed.minute.size).toBe(5);
    for (let i = 1; i <= 5; i++) expect(parsed.minute.has(i)).toBe(true);
  });

  it('步长：星号/5（每 5 分钟）', () => {
    const parsed = parseCronExpression('*/5 * * * *');
    expect(parsed.minute.has(0)).toBe(true);
    expect(parsed.minute.has(5)).toBe(true);
    expect(parsed.minute.has(55)).toBe(true);
    expect(parsed.minute.has(3)).toBe(false);
  });

  it('范围 + 步长：1-10/2', () => {
    const parsed = parseCronExpression('1-10/2 * * * *');
    expect(parsed.minute.has(1)).toBe(true);
    expect(parsed.minute.has(3)).toBe(true);
    expect(parsed.minute.has(9)).toBe(true);
    expect(parsed.minute.has(2)).toBe(false);
  });

  it('问号 ? 等同于星号', () => {
    const parsed = parseCronExpression('? ? ? ? ?');
    expect(parsed.minute.size).toBe(60);
  });

  it('字段数不对抛错', () => {
    expect(() => parseCronExpression('* * * *')).toThrow(/5 fields/);
    expect(() => parseCronExpression('* * * * * *')).toThrow(/5 fields/);
  });

  it('非法值抛错', () => {
    expect(() => parseCronExpression('60 * * * *')).toThrow(/invalid cron field/);
    expect(() => parseCronExpression('* 24 * * *')).toThrow(/invalid cron field/);
    expect(() => parseCronExpression('abc * * * *')).toThrow(/invalid cron field/);
  });
});

describe('getNextCronRunMs', () => {
  it('找到下一匹配分钟', () => {
    // 2026-01-01 00:00:00 UTC → 下一分钟 00:01
    const from = Date.UTC(2026, 0, 1, 0, 0, 0);
    const parsed = parseCronExpression('* * * * *');
    const next = getNextCronRunMs(parsed, from);
    expect(next).toBe(Date.UTC(2026, 0, 1, 0, 1, 0));
  });

  it('0 3 * * *：下一凌晨 3 点', () => {
    // 注意：getNextCronRunMs 基于本地时区（getHours 等返回本地时间），
    // 因此 from 与期望值都用本地时间构造，保证测试在任何时区下一致。
    // 本地 2026-01-01 10:00 → 下一本地 03:00 = 本地 2026-01-02 03:00
    const from = new Date(2026, 0, 1, 10, 0, 0).getTime();
    const parsed = parseCronExpression('0 3 * * *');
    const next = getNextCronRunMs(parsed, from);
    expect(next).toBe(new Date(2026, 0, 2, 3, 0, 0).getTime());
  });

  it('同一天未到 3 点 → 当天 3 点', () => {
    // 本地 2026-01-01 01:00 → 当天本地 03:00
    const from = new Date(2026, 0, 1, 1, 0, 0).getTime();
    const parsed = parseCronExpression('0 3 * * *');
    const next = getNextCronRunMs(parsed, from);
    expect(next).toBe(new Date(2026, 0, 1, 3, 0, 0).getTime());
  });

  it('从下一分钟开始搜索（秒清零）', () => {
    // 2026-01-01 00:00:30 → 下一分钟 00:01:00
    const from = Date.UTC(2026, 0, 1, 0, 0, 30);
    const parsed = parseCronExpression('* * * * *');
    const next = getNextCronRunMs(parsed, from);
    expect(next).toBe(Date.UTC(2026, 0, 1, 0, 1, 0));
  });

  it('每 30 分钟：00 和 30', () => {
    const from = Date.UTC(2026, 0, 1, 0, 15, 0);
    const parsed = parseCronExpression('0,30 * * * *');
    const next = getNextCronRunMs(parsed, from);
    expect(next).toBe(Date.UTC(2026, 0, 1, 0, 30, 0));
  });
});

describe('CronScheduler', () => {
  let backend: InMemoryAgentBackend;
  let nowMs: number;
  let scheduler: CronScheduler;

  beforeEach(() => {
    backend = new InMemoryAgentBackend();
    nowMs = 1_000_000_000_000; // 固定基准
    scheduler = new CronScheduler({
      backend: backend as any,
      pollIntervalMs: 10,
      nowFn: () => nowMs,
    });
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe('schedule / getPendingTasks / cancel', () => {
    it('schedule 注册任务并落库', () => {
      const id = scheduler.schedule('0 3 * * *', async () => {}, { label: 'daily' });
      expect(id).toMatch(/^cron_/);
      const pending = scheduler.getPendingTasks();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(id);
      expect(pending[0].label).toBe('daily');
      expect(pending[0].nextRun).toBeGreaterThan(nowMs);
    });

    it('cancel 删除任务', () => {
      const id = scheduler.schedule('0 3 * * *', async () => {});
      expect(scheduler.getPendingTasks()).toHaveLength(1);
      scheduler.cancel(id);
      expect(scheduler.getPendingTasks()).toHaveLength(0);
      expect(backend.cronJobs.size).toBe(0);
    });

    it('getPendingTasks 按 nextRun 升序', () => {
      scheduler.schedule('0 5 * * *', async () => {}, { label: 'later' });
      scheduler.schedule('0 3 * * *', async () => {}, { label: 'earlier' });
      const pending = scheduler.getPendingTasks();
      expect(pending[0].label).toBe('earlier');
      expect(pending[1].label).toBe('later');
    });
  });

  describe('pacing 钳位（minIntervalMs）', () => {
    it('minIntervalMs 作为下次执行下界', () => {
      // cron `0 3 * * *` 下次可能很远，但这里我们手动设置一个近的未来 cron
      // 用 `* * * * *`（每分钟），nextRun ≈ now+1min，但 minIntervalMs=1h → 钳位到 now+1h
      scheduler.schedule('* * * * *', async () => {}, { minIntervalMs: 60 * 60 * 1000 });
      const pending = scheduler.getPendingTasks();
      expect(pending[0].nextRun).toBeGreaterThanOrEqual(nowMs + 60 * 60 * 1000);
    });

    it('LLM 提议的 nextDelayMs 被 minIntervalMs 钳位', async () => {
      // 通过 tick 触发回调，回调返回 nextDelayMs=1000（1 秒），但 minIntervalMs=1h
      const callback = vi.fn(async () => ({ nextDelayMs: 1000 }));
      scheduler.schedule('* * * * *', callback, { minIntervalMs: 60 * 60 * 1000 });

      // 手动把 nextRun 设为过去，触发 tick 执行
      const jobId = scheduler.getPendingTasks()[0].id;
      backend.cronJobs.get(jobId)!.next_run = nowMs - 1000;

      // 启动调度器触发 tick
      scheduler.start();
      await new Promise((r) => setTimeout(r, 50));
      nowMs += 100; // 推进时间用于 computeNextRun

      expect(callback).toHaveBeenCalledTimes(1);
      // 执行后 nextRun 应被钳位到 now + 1h（而非 now + 1s）
      const updatedJob = backend.cronJobs.get(jobId)!;
      expect(updatedJob.next_run).toBeGreaterThanOrEqual(nowMs + 60 * 60 * 1000 - 1000);
    });
  });

  describe('stagger 抖动', () => {
    it('top-of-hour recurring 自动应用 5 分钟 stagger', () => {
      scheduler.schedule('0 * * * *', async () => {});
      const pending = scheduler.getPendingTasks();
      // nextRun 应在 [原始nextRun, 原始nextRun + 5min) 区间
      // 原始 nextRun（0 * * * *）= 下一个整点
      const originalNext = (() => {
        const parsed = parseCronExpression('0 * * * *');
        return getNextCronRunMs(parsed, nowMs);
      })();
      expect(pending[0].nextRun).toBeGreaterThanOrEqual(originalNext);
      expect(pending[0].nextRun).toBeLessThan(originalNext + 5 * 60 * 1000);
    });

    it('显式 staggerMs=0 精确执行', () => {
      scheduler.schedule('0 * * * *', async () => {}, { staggerMs: 0 });
      const pending = scheduler.getPendingTasks();
      const originalNext = (() => {
        const parsed = parseCronExpression('0 * * * *');
        return getNextCronRunMs(parsed, nowMs);
      })();
      expect(pending[0].nextRun).toBe(originalNext);
    });

    it('非 top-of-hour cron 不应用默认 stagger', () => {
      scheduler.schedule('0 3 * * *', async () => {});
      const pending = scheduler.getPendingTasks();
      const originalNext = (() => {
        const parsed = parseCronExpression('0 3 * * *');
        return getNextCronRunMs(parsed, nowMs);
      })();
      expect(pending[0].nextRun).toBe(originalNext);
    });
  });

  describe('tick 任务执行', () => {
    it('到点任务触发回调', async () => {
      const callback = vi.fn(async () => {});
      scheduler.schedule('* * * * *', callback);
      // 手动把 nextRun 设为过去
      const jobId = scheduler.getPendingTasks()[0].id;
      backend.cronJobs.get(jobId)!.next_run = nowMs - 1000;

      scheduler.start();
      await new Promise((r) => setTimeout(r, 50));

      expect(callback).toHaveBeenCalledTimes(1);
      // 执行后 nextRun 应被更新为未来时间
      const updatedJob = backend.cronJobs.get(jobId)!;
      expect(updatedJob.next_run).toBeGreaterThan(nowMs);
      expect(updatedJob.last_status).toBe('success');
      expect(updatedJob.last_run).toBe(nowMs);
    });

    it('回调失败标记 failed 状态', async () => {
      const callback = vi.fn(async () => {
        throw new Error('task boom');
      });
      scheduler.schedule('* * * * *', callback);
      const jobId = scheduler.getPendingTasks()[0].id;
      backend.cronJobs.get(jobId)!.next_run = nowMs - 1000;

      scheduler.start();
      await new Promise((r) => setTimeout(r, 50));

      expect(callback).toHaveBeenCalledTimes(1);
      const updatedJob = backend.cronJobs.get(jobId)!;
      expect(updatedJob.last_status).toBe('failed');
      expect(updatedJob.last_error).toBe('task boom');
    });

    it('allowConcurrent=false 跳过仍在执行的任务', async () => {
      let resolveTask: () => void = () => {};
      const taskPromise = new Promise<void>((r) => (resolveTask = r));
      const callback = vi.fn(async () => {
        await taskPromise;
      });

      scheduler.schedule('* * * * *', callback, { allowConcurrent: false });
      const jobId = scheduler.getPendingTasks()[0].id;
      backend.cronJobs.get(jobId)!.next_run = nowMs - 1000;

      scheduler.start();
      await new Promise((r) => setTimeout(r, 50)); // 第一次触发，任务开始执行（未 resolve）
      expect(callback).toHaveBeenCalledTimes(1);

      // 推进时间，但任务仍在执行；下次 tick 应跳过
      nowMs += 60 * 1000;
      await new Promise((r) => setTimeout(r, 50));
      expect(callback).toHaveBeenCalledTimes(1); // 仍未再次调用

      // 完成任务
      resolveTask();
      await new Promise((r) => setTimeout(r, 30));
    });

    it('内存中无回调的任务被清理（进程重启模拟）', () => {
      // 直接在 backend 插入一条任务记录，但不通过 schedule 注册（无回调）
      backend.cronJobs.set('orphan-job', {
        id: 'orphan-job',
        label: null,
        cron_expr: '* * * * *',
        next_run: nowMs - 1000,
        last_run: null,
        last_status: null,
        last_error: null,
        min_interval_ms: null,
        stagger_ms: null,
        allow_concurrent: 0,
        payload: null,
        created_at: nowMs,
        updated_at: nowMs,
      });
      expect(backend.cronJobs.size).toBe(1);
      // start 后 tick 发现无回调 → 删除该记录
      scheduler.start();
      // 同步验证：tick 是 async，需短暂等待
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(backend.cronJobs.has('orphan-job')).toBe(false);
          resolve();
        }, 50);
      });
    });
  });

  describe('dreamNow', () => {
    it('委托注入的 dreaming 回调', async () => {
      const dreamingCb = vi.fn(async () => {});
      scheduler.setDreamingCallback(dreamingCb);
      await scheduler.dreamNow('session-1');
      expect(dreamingCb).toHaveBeenCalledWith('session-1');
    });

    it('dreaming 回调失败不抛错（降级）', async () => {
      const dreamingCb = vi.fn(async () => {
        throw new Error('dream boom');
      });
      scheduler.setDreamingCallback(dreamingCb);
      await expect(scheduler.dreamNow()).resolves.toBeUndefined();
    });

    it('未注入回调时 dreamNow 静默无操作', async () => {
      await expect(scheduler.dreamNow()).resolves.toBeUndefined();
    });
  });

  describe('生命周期', () => {
    it('start/stop 幂等', () => {
      scheduler.start();
      scheduler.start(); // 重复 start 无副作用
      scheduler.stop();
      scheduler.stop(); // 重复 stop 无副作用
    });
  });
});
