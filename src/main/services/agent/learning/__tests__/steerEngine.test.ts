/**
 * SteerEngine 单元测试 —— 行为引导（lease/inject/ack）
 *
 * 来源：spec §二 Task 18.2（learning/steerEngine.ts）
 *
 * 覆盖：
 *  1. enqueueSteer：参数校验 / 超长截断 / 落库
 *  2. leasePendingSteer：lease 拼装 prompt / 长度上限 / 标记 in_progress / 无 pending 返回 null
 *  3. ackLeasedSteer：leaseId 匹配标记 delivered / 不匹配跳过
 *  4. releaseLeasedSteer：回退 pending
 *  5. discardStaleSteer：清理过期消息
 *  6. stale lease 自动重新入队（5 分钟阈值）
 *  7. 多条消息按 createdAt 升序 lease
 *  8. prompt 头部声明「运行时数据而非用户指令」
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SteerEngine } from '../steerEngine';
import { MAX_STEER_ITEM_CHARS, MAX_STEER_PROMPT_CHARS } from '../types';
import { InMemoryAgentBackend } from './fakeBackend';

describe('SteerEngine', () => {
  let backend: InMemoryAgentBackend;
  let engine: SteerEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    backend = new InMemoryAgentBackend();
    engine = new SteerEngine({ backend: backend as any });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('enqueueSteer', () => {
    it('成功写入引导消息', async () => {
      const id = await engine.enqueueSteer({
        sessionId: 's1',
        content: '提醒：用户希望简洁回答',
        source: 'user',
        label: '简洁偏好',
      });
      expect(id).toMatch(/^steer_/);
      expect(backend.agentMemory.size).toBe(1);
      const row = backend.agentMemory.get(id)!;
      expect(row.type).toBe('agent');
      expect(row.source).toBe('steer:user');
      expect(row.session_id).toBe('s1');
      const meta = JSON.parse(row.metadata as string);
      expect(meta.kind).toBe('steer');
      expect(meta.source).toBe('user');
      expect(meta.label).toBe('简洁偏好');
      expect(meta.deliveryStatus).toBe('pending');
    });

    it('空 sessionId 抛错', async () => {
      await expect(
        engine.enqueueSteer({ sessionId: '', content: 'x', source: 'user' })
      ).rejects.toThrow(/sessionId is required/);
    });

    it('空 content 抛错', async () => {
      await expect(
        engine.enqueueSteer({ sessionId: 's1', content: '', source: 'user' })
      ).rejects.toThrow(/content is required/);
      await expect(
        engine.enqueueSteer({ sessionId: 's1', content: '   ', source: 'user' })
      ).rejects.toThrow(/content is required/);
    });

    it('超长内容被截断（MAX_STEER_ITEM_CHARS）', async () => {
      const longContent = 'x'.repeat(MAX_STEER_ITEM_CHARS + 100);
      const id = await engine.enqueueSteer({
        sessionId: 's1',
        content: longContent,
        source: 'system',
      });
      const row = backend.agentMemory.get(id)!;
      const content = row.content as string;
      expect(content.length).toBeLessThan(longContent.length);
      expect(content).toContain('[truncated]');
    });

    it('支持 user/system/agent 三种来源', async () => {
      for (const source of ['user', 'system', 'agent'] as const) {
        await engine.enqueueSteer({ sessionId: 's1', content: `来自 ${source}`, source });
      }
      expect(backend.agentMemory.size).toBe(3);
    });
  });

  describe('leasePendingSteer', () => {
    it('无 pending 消息返回 null', async () => {
      expect(await engine.leasePendingSteer('s1')).toBeNull();
    });

    it('lease 一条消息并拼装 prompt', async () => {
      await engine.enqueueSteer({
        sessionId: 's1',
        content: '引导内容A',
        source: 'user',
        label: '提醒',
      });
      const batch = await engine.leasePendingSteer('s1');
      expect(batch).not.toBeNull();
      expect(batch!.leaseId).toMatch(/^lease_/);
      expect(batch!.messageIds).toHaveLength(1);
      // prompt 含头部声明 + 内容
      expect(batch!.prompt).toContain('runtime data and evidence');
      expect(batch!.prompt).toContain('引导内容A');
      expect(batch!.prompt).toContain('user');
    });

    it('prompt 头部声明「运行时数据而非用户指令」', async () => {
      await engine.enqueueSteer({ sessionId: 's1', content: 'x', source: 'user' });
      const batch = await engine.leasePendingSteer('s1');
      expect(batch!.prompt).toContain('not as user instructions');
      expect(batch!.prompt).toContain('Agent steer queue');
    });

    it('多条消息按 createdAt 升序 lease', async () => {
      await engine.enqueueSteer({ sessionId: 's1', content: '第一条', source: 'user' });
      vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
      await engine.enqueueSteer({ sessionId: 's1', content: '第二条', source: 'system' });
      vi.setSystemTime(new Date('2026-01-01T00:02:00Z'));
      await engine.enqueueSteer({ sessionId: 's1', content: '第三条', source: 'agent' });

      const batch = await engine.leasePendingSteer('s1');
      expect(batch!.messageIds).toHaveLength(3);
      // prompt 中第一条应在前
      const firstIdx = batch!.prompt.indexOf('第一条');
      const secondIdx = batch!.prompt.indexOf('第二条');
      const thirdIdx = batch!.prompt.indexOf('第三条');
      expect(firstIdx).toBeLessThan(secondIdx);
      expect(secondIdx).toBeLessThan(thirdIdx);
    });

    it('lease 后消息状态变为 in_progress', async () => {
      const id = await engine.enqueueSteer({
        sessionId: 's1',
        content: 'x',
        source: 'user',
      });
      await engine.leasePendingSteer('s1');
      const row = backend.agentMemory.get(id)!;
      const meta = JSON.parse(row.metadata as string);
      expect(meta.deliveryStatus).toBe('in_progress');
      expect(meta.leaseId).toBeDefined();
      expect(meta.leasedAt).toBeDefined();
    });

    it('lease 后再次 lease 无 pending（已被 lease）', async () => {
      await engine.enqueueSteer({ sessionId: 's1', content: 'x', source: 'user' });
      const first = await engine.leasePendingSteer('s1');
      expect(first).not.toBeNull();
      const second = await engine.leasePendingSteer('s1');
      expect(second).toBeNull();
    });

    it('prompt 长度受 MAX_STEER_PROMPT_CHARS 限制', async () => {
      // 写入大量消息，prompt 不超过上限
      for (let i = 0; i < 20; i++) {
        await engine.enqueueSteer({
          sessionId: 's1',
          content: 'y'.repeat(2000),
          source: 'user',
        });
      }
      const batch = await engine.leasePendingSteer('s1');
      expect(batch!.prompt.length).toBeLessThanOrEqual(MAX_STEER_PROMPT_CHARS + 3000); // 含至少一条 + 头部
      expect(batch!.messageIds.length).toBeLessThan(20);
    });

    it('单条消息超长时至少 lease 一条（即使超过软上限）', async () => {
      // 一条接近上限的消息
      await engine.enqueueSteer({
        sessionId: 's1',
        content: 'z'.repeat(MAX_STEER_PROMPT_CHARS - 1000),
        source: 'user',
      });
      const batch = await engine.leasePendingSteer('s1');
      expect(batch).not.toBeNull();
      expect(batch!.messageIds).toHaveLength(1);
    });

    it('空 sessionId 返回 null', async () => {
      expect(await engine.leasePendingSteer('')).toBeNull();
    });

    it('按会话隔离（不 lease 其他 session 的消息）', async () => {
      await engine.enqueueSteer({ sessionId: 's1', content: 'A', source: 'user' });
      await engine.enqueueSteer({ sessionId: 's2', content: 'B', source: 'user' });
      const batch = await engine.leasePendingSteer('s1');
      expect(batch!.messageIds).toHaveLength(1);
      expect(batch!.prompt).toContain('A');
      expect(batch!.prompt).not.toContain('B');
    });
  });

  describe('ackLeasedSteer', () => {
    it('leaseId 匹配时标记 delivered', async () => {
      const id = await engine.enqueueSteer({
        sessionId: 's1',
        content: 'x',
        source: 'user',
      });
      const batch = await engine.leasePendingSteer('s1');
      const ackCount = await engine.ackLeasedSteer(batch!.leaseId, batch!.messageIds);
      expect(ackCount).toBe(1);
      const row = backend.agentMemory.get(id)!;
      const meta = JSON.parse(row.metadata as string);
      expect(meta.deliveryStatus).toBe('delivered');
      expect(meta.injectedAt).toBeDefined();
    });

    it('leaseId 不匹配时跳过', async () => {
      await engine.enqueueSteer({ sessionId: 's1', content: 'x', source: 'user' });
      const batch = await engine.leasePendingSteer('s1');
      const ackCount = await engine.ackLeasedSteer('wrong-lease-id', batch!.messageIds);
      expect(ackCount).toBe(0);
    });

    it('多条消息部分 ack', async () => {
      await engine.enqueueSteer({ sessionId: 's1', content: 'A', source: 'user' });
      await engine.enqueueSteer({ sessionId: 's1', content: 'B', source: 'user' });
      const batch = await engine.leasePendingSteer('s1');
      // 只 ack 第一条
      const ackCount = await engine.ackLeasedSteer(batch!.leaseId, [batch!.messageIds[0]]);
      expect(ackCount).toBe(1);
    });
  });

  describe('releaseLeasedSteer', () => {
    it('回退到 pending 状态', async () => {
      const id = await engine.enqueueSteer({
        sessionId: 's1',
        content: 'x',
        source: 'user',
      });
      const batch = await engine.leasePendingSteer('s1');
      const releaseCount = await engine.releaseLeasedSteer(
        batch!.leaseId,
        batch!.messageIds,
        'inject failed'
      );
      expect(releaseCount).toBe(1);
      const row = backend.agentMemory.get(id)!;
      const meta = JSON.parse(row.metadata as string);
      expect(meta.deliveryStatus).toBe('pending');
      expect(meta.lastError).toBe('inject failed');
    });

    it('release 后可再次 lease', async () => {
      await engine.enqueueSteer({ sessionId: 's1', content: 'x', source: 'user' });
      const first = await engine.leasePendingSteer('s1');
      await engine.releaseLeasedSteer(first!.leaseId, first!.messageIds);
      const second = await engine.leasePendingSteer('s1');
      expect(second).not.toBeNull();
    });
  });

  describe('stale lease 自动重新入队', () => {
    it('lease 后 5 分钟内不重新入队', async () => {
      await engine.enqueueSteer({ sessionId: 's1', content: 'x', source: 'user' });
      await engine.leasePendingSteer('s1');
      // 推进 4 分钟（未超 5 分钟阈值）
      vi.setSystemTime(new Date('2026-01-01T00:04:00Z'));
      expect(await engine.leasePendingSteer('s1')).toBeNull();
    });

    it('lease 后超过 5 分钟自动重新入队', async () => {
      await engine.enqueueSteer({ sessionId: 's1', content: 'x', source: 'user' });
      const first = await engine.leasePendingSteer('s1');
      expect(first).not.toBeNull();
      // 推进 6 分钟（超过 5 分钟 stale 阈值）
      vi.setSystemTime(new Date('2026-01-01T00:06:00Z'));
      const second = await engine.leasePendingSteer('s1');
      expect(second).not.toBeNull();
      expect(second!.messageIds).toHaveLength(1);
    });
  });

  describe('discardStaleSteer', () => {
    it('清理超过 maxAge 的未交付消息', async () => {
      const id = await engine.enqueueSteer({
        sessionId: 's1',
        content: '旧消息',
        source: 'user',
      });
      // 推进 8 天（超过默认 7 天）
      vi.setSystemTime(new Date('2026-01-09T00:00:00Z'));
      const count = await engine.discardStaleSteer();
      expect(count).toBe(1);
      const row = backend.agentMemory.get(id)!;
      const meta = JSON.parse(row.metadata as string);
      expect(meta.deliveryStatus).toBe('discarded');
    });

    it('已 delivered 的消息不清理', async () => {
      await engine.enqueueSteer({ sessionId: 's1', content: 'x', source: 'user' });
      const batch = await engine.leasePendingSteer('s1');
      await engine.ackLeasedSteer(batch!.leaseId, batch!.messageIds);
      vi.setSystemTime(new Date('2026-01-09T00:00:00Z'));
      const count = await engine.discardStaleSteer();
      expect(count).toBe(0);
    });

    it('未过期的消息不清理', async () => {
      await engine.enqueueSteer({ sessionId: 's1', content: 'x', source: 'user' });
      // 推进 3 天（未超 7 天）
      vi.setSystemTime(new Date('2026-01-04T00:00:00Z'));
      const count = await engine.discardStaleSteer();
      expect(count).toBe(0);
    });

    it('自定义 maxAgeMs', async () => {
      await engine.enqueueSteer({ sessionId: 's1', content: 'x', source: 'user' });
      // 推进 2 天
      vi.setSystemTime(new Date('2026-01-03T00:00:00Z'));
      // maxAge=1 天 → 2 天前的消息被清理
      const count = await engine.discardStaleSteer(1 * 24 * 60 * 60 * 1000);
      expect(count).toBe(1);
    });
  });

  describe('listSteer（通过 lease 间接验证）', () => {
    it('pending + stale 重新入队的消息都被 lease', async () => {
      // 第一条：将被 lease 并变 stale
      await engine.enqueueSteer({ sessionId: 's1', content: '旧 pending', source: 'user' });
      await engine.leasePendingSteer('s1');
      // 第二条：6 分钟后再写入
      vi.setSystemTime(new Date('2026-01-01T00:06:00Z'));
      await engine.enqueueSteer({ sessionId: 's1', content: '新 pending', source: 'user' });
      // lease：应同时拿到 stale 重新入队的第一条 + 新的第二条
      const batch = await engine.leasePendingSteer('s1');
      expect(batch!.messageIds).toHaveLength(2);
    });
  });
});
