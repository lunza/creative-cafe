/**
 * stagger 单元测试 —— 防锁步抖动窗口（照抄 openclaw stagger.ts）
 *
 * 来源：spec §二 Task 18.1（learning/stagger.ts）
 *
 * 覆盖：
 *  1. normalizeCronStaggerMs：number / string / 0 / 负数 / 无效
 *  2. resolveDefaultCronStaggerMs：top-of-hour recurring vs 非整点 / 非通配 hour
 *  3. resolveCronStaggerMs：显式优先（含 0） / 回退默认 / 无默认
 *  4. applyStaggerJitter：抖动范围 [nextRun, nextRun+stagger] / staggerMs=0 / 注入随机
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TOP_OF_HOUR_STAGGER_MS,
  normalizeCronStaggerMs,
  resolveDefaultCronStaggerMs,
  resolveCronStaggerMs,
  applyStaggerJitter,
} from '../stagger';

describe('normalizeCronStaggerMs', () => {
  it('number 直接用（非负整数）', () => {
    expect(normalizeCronStaggerMs(0)).toBe(0);
    expect(normalizeCronStaggerMs(1000)).toBe(1000);
    expect(normalizeCronStaggerMs(60000)).toBe(60000);
  });

  it('string 解析为非负整数（纯数字字符串，不 trim 空格）', () => {
    expect(normalizeCronStaggerMs('0')).toBe(0);
    expect(normalizeCronStaggerMs('1000')).toBe(1000);
    // 带空格的字符串不被接受（parseStrictNonNegativeInteger 要求纯数字）
    expect(normalizeCronStaggerMs(' 60000 ')).toBeUndefined();
  });

  it('0 保留（表示精确按计划执行）', () => {
    expect(normalizeCronStaggerMs(0)).toBe(0);
    expect(normalizeCronStaggerMs('0')).toBe(0);
  });

  it('负数 number 被 Math.max(0,...) 钳位为 0', () => {
    // 实现行为：number 类型经 Math.max(0, Math.floor(n))，负数 → 0
    expect(normalizeCronStaggerMs(-1)).toBe(0);
    expect(normalizeCronStaggerMs(-100)).toBe(0);
    // 负数字符串不被 parseStrictNonNegativeInteger 接受 → undefined
    expect(normalizeCronStaggerMs('-5')).toBeUndefined();
  });

  it('小数 number 被 Math.floor 向下取整', () => {
    // 实现行为：number 类型经 Math.floor，小数 → 整数
    expect(normalizeCronStaggerMs(1.5)).toBe(1);
    expect(normalizeCronStaggerMs(99.9)).toBe(99);
    // 小数字符串不被 parseStrictNonNegativeInteger 接受 → undefined
    expect(normalizeCronStaggerMs('1.5')).toBeUndefined();
  });

  it('无效字符串返回 undefined', () => {
    expect(normalizeCronStaggerMs('abc')).toBeUndefined();
    expect(normalizeCronStaggerMs('')).toBeUndefined();
    expect(normalizeCronStaggerMs('5m')).toBeUndefined();
  });

  it('非 number/string 类型返回 undefined', () => {
    expect(normalizeCronStaggerMs(null)).toBeUndefined();
    expect(normalizeCronStaggerMs(undefined)).toBeUndefined();
    expect(normalizeCronStaggerMs({})).toBeUndefined();
  });

  it('浮点 number 向下取整', () => {
    expect(normalizeCronStaggerMs(100.9)).toBe(100);
  });
});

describe('resolveDefaultCronStaggerMs', () => {
  it('top-of-hour recurring（minute=0, hour=通配）→ 5 分钟', () => {
    expect(resolveDefaultCronStaggerMs('0 * * * *')).toBe(DEFAULT_TOP_OF_HOUR_STAGGER_MS);
    expect(resolveDefaultCronStaggerMs('0 ? * * *')).toBe(DEFAULT_TOP_OF_HOUR_STAGGER_MS);
    expect(resolveDefaultCronStaggerMs('0 */2 * * *')).toBe(DEFAULT_TOP_OF_HOUR_STAGGER_MS);
  });

  it('6 字段 top-of-hour recurring → 5 分钟', () => {
    expect(resolveDefaultCronStaggerMs('0 0 * * * *')).toBe(DEFAULT_TOP_OF_HOUR_STAGGER_MS);
  });

  it('非整点 cron（minute≠0）→ undefined', () => {
    expect(resolveDefaultCronStaggerMs('30 * * * *')).toBeUndefined();
    expect(resolveDefaultCronStaggerMs('15 */2 * * *')).toBeUndefined();
  });

  it('整点但 hour 非通配（固定 hour）→ undefined', () => {
    expect(resolveDefaultCronStaggerMs('0 3 * * *')).toBeUndefined();
    expect(resolveDefaultCronStaggerMs('0 0,12 * * *')).toBeUndefined();
  });

  it('字段数不对 → undefined', () => {
    expect(resolveDefaultCronStaggerMs('0 * * *')).toBeUndefined();
    expect(resolveDefaultCronStaggerMs('* * * * * * *')).toBeUndefined();
  });
});

describe('resolveCronStaggerMs', () => {
  it('显式 staggerMs 优先（包括 0）', () => {
    expect(resolveCronStaggerMs({ kind: 'cron', expr: '0 * * * *', staggerMs: 1000 })).toBe(1000);
    // 显式 0 表示精确执行（即使 top-of-hour 默认 5 分钟也不应用）
    expect(resolveCronStaggerMs({ kind: 'cron', expr: '0 * * * *', staggerMs: 0 })).toBe(0);
  });

  it('无显式 + top-of-hour recurring → 默认 5 分钟', () => {
    expect(resolveCronStaggerMs({ kind: 'cron', expr: '0 * * * *' })).toBe(
      DEFAULT_TOP_OF_HOUR_STAGGER_MS
    );
  });

  it('无显式 + 非 top-of-hour → 0', () => {
    expect(resolveCronStaggerMs({ kind: 'cron', expr: '0 3 * * *' })).toBe(0);
    expect(resolveCronStaggerMs({ kind: 'cron', expr: '30 * * * *' })).toBe(0);
  });

  it('显式无效字符串 + top-of-hour → 回退默认 5 分钟', () => {
    // 'abc' 解析为 undefined → 回退默认
    expect(resolveCronStaggerMs({ kind: 'cron', expr: '0 * * * *', staggerMs: 'abc' })).toBe(
      DEFAULT_TOP_OF_HOUR_STAGGER_MS
    );
  });

  it('显式负数 number 被钳位为 0（视为精确执行，不回退默认）', () => {
    // -1 经 Math.max(0,...) 钳位为 0 → explicit=0 → 返回 0（不回退默认）
    expect(resolveCronStaggerMs({ kind: 'cron', expr: '0 * * * *', staggerMs: -1 })).toBe(0);
  });

  it('无 expr → 0', () => {
    expect(resolveCronStaggerMs({ kind: 'cron' })).toBe(0);
  });
});

describe('applyStaggerJitter', () => {
  const base = 1_000_000_000_000;

  it('staggerMs=0 → 不抖动，返回原值', () => {
    expect(applyStaggerJitter(base, 0)).toBe(base);
  });

  it('staggerMs<0 → 不抖动，返回原值', () => {
    expect(applyStaggerJitter(base, -100)).toBe(base);
  });

  it('随机=0 → 落在 base', () => {
    expect(applyStaggerJitter(base, 60000, () => 0)).toBe(base);
  });

  it('随机接近 1 → 落在 base + staggerMs - 1（floor）', () => {
    expect(applyStaggerJitter(base, 60000, () => 0.9999)).toBe(base + Math.floor(0.9999 * 60000));
  });

  it('抖动结果始终在 [base, base + staggerMs) 区间', () => {
    const staggerMs = 5 * 60 * 1000;
    for (let i = 0; i < 100; i++) {
      const result = applyStaggerJitter(base, staggerMs, Math.random);
      expect(result).toBeGreaterThanOrEqual(base);
      expect(result).toBeLessThan(base + staggerMs);
    }
  });

  it('注入固定随机函数验证确定性', () => {
    const seq = [0, 0.25, 0.5, 0.75, 0.99];
    let idx = 0;
    const randomFn = () => seq[idx++ % seq.length];
    const staggerMs = 1000;
    expect(applyStaggerJitter(base, staggerMs, randomFn)).toBe(base + Math.floor(0 * 1000));
    expect(applyStaggerJitter(base, staggerMs, randomFn)).toBe(base + Math.floor(0.25 * 1000));
    expect(applyStaggerJitter(base, staggerMs, randomFn)).toBe(base + Math.floor(0.5 * 1000));
  });
});

describe('常量', () => {
  it('DEFAULT_TOP_OF_HOUR_STAGGER_MS 为 5 分钟', () => {
    expect(DEFAULT_TOP_OF_HOUR_STAGGER_MS).toBe(5 * 60 * 1000);
  });
});
