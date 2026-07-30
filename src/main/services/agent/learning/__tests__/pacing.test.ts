/**
 * pacing 单元测试 —— 防失控 pacing 钳位（照抄 openclaw pacing.ts）
 *
 * 来源：spec §二 Task 18.1（learning/pacing.ts）
 *
 * 覆盖：
 *  1. parseDurationMs：纯数字 / ms / s / m / h / d / 复合 / 无效
 *  2. parseCronPacingBounds：min/max 缺失 / min>max / 解析失败 / 合法边界
 *  3. resolvePacedNextRunAtMs：min 下界钳位 / max 上界钳位 / 区间内不变 /
 *     仅 min / 仅 max / 无界（infinity）
 */

import { describe, it, expect } from 'vitest';
import {
  parseDurationMs,
  parseCronPacingBounds,
  resolvePacedNextRunAtMs,
} from '../pacing';

describe('parseDurationMs', () => {
  it('纯数字字符串视为毫秒', () => {
    expect(parseDurationMs('500')).toBe(500);
    expect(parseDurationMs('1000')).toBe(1000);
  });

  it('毫秒单位', () => {
    expect(parseDurationMs('500ms')).toBe(500);
    expect(parseDurationMs('1ms')).toBe(1);
  });

  it('秒/分/时/天单位', () => {
    expect(parseDurationMs('30s')).toBe(30 * 1000);
    expect(parseDurationMs('5m')).toBe(5 * 60 * 1000);
    expect(parseDurationMs('2h')).toBe(2 * 60 * 60 * 1000);
    expect(parseDurationMs('1d')).toBe(24 * 60 * 60 * 1000);
  });

  it('复合格式：1h30m / 2d4h', () => {
    expect(parseDurationMs('1h30m')).toBe(60 * 60 * 1000 + 30 * 60 * 1000);
    expect(parseDurationMs('2d4h')).toBe(2 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000);
  });

  it('空字符串抛错', () => {
    expect(() => parseDurationMs('')).toThrow(/empty/);
    expect(() => parseDurationMs('   ')).toThrow(/empty/);
  });

  it('无效格式抛错', () => {
    expect(() => parseDurationMs('abc')).toThrow(/invalid/);
    expect(() => parseDurationMs('5x')).toThrow(/invalid/);
    expect(() => parseDurationMs('h')).toThrow(/invalid/);
  });

  it('零或负数（纯数字）抛错', () => {
    expect(() => parseDurationMs('0')).toThrow(/positive/);
    // 负数不匹配纯数字正则，按无效格式抛错
    expect(() => parseDurationMs('-5')).toThrow();
  });
});

describe('parseCronPacingBounds', () => {
  it('仅指定 min', () => {
    const bounds = parseCronPacingBounds({ min: '5m' });
    expect(bounds.minMs).toBe(5 * 60 * 1000);
    expect(bounds.maxMs).toBeUndefined();
  });

  it('仅指定 max', () => {
    const bounds = parseCronPacingBounds({ max: '1h' });
    expect(bounds.minMs).toBeUndefined();
    expect(bounds.maxMs).toBe(60 * 60 * 1000);
  });

  it('同时指定 min 和 max', () => {
    const bounds = parseCronPacingBounds({ min: '5m', max: '1h' });
    expect(bounds.minMs).toBe(5 * 60 * 1000);
    expect(bounds.maxMs).toBe(60 * 60 * 1000);
  });

  it('min 和 max 都未指定抛错', () => {
    expect(() => parseCronPacingBounds({})).toThrow(/at least one/);
    expect(() => parseCronPacingBounds({})).toThrow(/min or max/);
  });

  it('min > max 抛错', () => {
    expect(() => parseCronPacingBounds({ min: '1h', max: '5m' })).toThrow(/min must not exceed max/);
  });

  it('min == max 合法（边界相等）', () => {
    const bounds = parseCronPacingBounds({ min: '5m', max: '5m' });
    expect(bounds.minMs).toBe(bounds.maxMs);
  });

  it('min 无效格式抛错', () => {
    expect(() => parseCronPacingBounds({ min: 'abc' })).toThrow(/must be a positive duration/);
  });
});

describe('resolvePacedNextRunAtMs', () => {
  const now = 1_000_000_000_000; // 固定基准时间

  it('proposed 在区间内 → 保持不变', () => {
    const next = resolvePacedNextRunAtMs({
      nowMs: now,
      delayMs: 10 * 60 * 1000, // 10 分钟
      pacing: { min: '5m', max: '30m' },
    });
    expect(next).toBe(now + 10 * 60 * 1000);
  });

  it('proposed < min → 钳位到 min 下界', () => {
    const next = resolvePacedNextRunAtMs({
      nowMs: now,
      delayMs: 60_000, // 1 分钟（小于 min 5 分钟）
      pacing: { min: '5m' },
    });
    expect(next).toBe(now + 5 * 60 * 1000);
  });

  it('proposed > max → 钳位到 max 上界', () => {
    const next = resolvePacedNextRunAtMs({
      nowMs: now,
      delayMs: 60 * 60 * 1000, // 1 小时（大于 max 30 分钟）
      pacing: { max: '30m' },
    });
    expect(next).toBe(now + 30 * 60 * 1000);
  });

  it('仅指定 min，proposed > min → 保持 proposed', () => {
    const next = resolvePacedNextRunAtMs({
      nowMs: now,
      delayMs: 60 * 60 * 1000, // 1 小时
      pacing: { min: '5m' },
    });
    expect(next).toBe(now + 60 * 60 * 1000);
  });

  it('仅指定 max，proposed < max → 保持 proposed', () => {
    const next = resolvePacedNextRunAtMs({
      nowMs: now,
      delayMs: 60_000, // 1 分钟
      pacing: { max: '30m' },
    });
    expect(next).toBe(now + 60_000);
  });

  it('proposed 恰好等于 min → 不变', () => {
    const next = resolvePacedNextRunAtMs({
      nowMs: now,
      delayMs: 5 * 60 * 1000,
      pacing: { min: '5m', max: '30m' },
    });
    expect(next).toBe(now + 5 * 60 * 1000);
  });

  it('proposed 恰好等于 max → 不变', () => {
    const next = resolvePacedNextRunAtMs({
      nowMs: now,
      delayMs: 30 * 60 * 1000,
      pacing: { min: '5m', max: '30m' },
    });
    expect(next).toBe(now + 30 * 60 * 1000);
  });

  it('delayMs 为 0 时钳位到 min', () => {
    const next = resolvePacedNextRunAtMs({
      nowMs: now,
      delayMs: 0,
      pacing: { min: '5m' },
    });
    expect(next).toBe(now + 5 * 60 * 1000);
  });

  it('复合时长字符串作为 pacing 边界', () => {
    const next = resolvePacedNextRunAtMs({
      nowMs: now,
      delayMs: 60 * 60 * 1000, // 1 小时
      pacing: { min: '1h30m', max: '2d' },
    });
    // 1 小时 < 1h30m → 钳位到 min
    expect(next).toBe(now + (60 * 60 * 1000 + 30 * 60 * 1000));
  });
});
