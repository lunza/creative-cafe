/**
 * styleFingerprint 单元测试
 *
 * Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 3 / Task 3.4
 * 覆盖：开场类型判定、指纹提取、规避指令触发条件、轮换 seed 行为。
 */

import { describe, it, expect } from 'vitest';
import {
  detectOpeningType,
  extractStyleFingerprint,
  buildStyleAvoidancePrompt,
  buildCreativeRotationPrompt,
  hashString,
  CREATIVE_ROTATION_POOL,
  STYLE_FINGERPRINT_WINDOW,
} from '../styleFingerprint';

describe('detectOpeningType', () => {
  it('星号开头识别为 action', () => {
    expect(detectOpeningType('*微微一笑* "你好"')).toBe('action');
    expect(detectOpeningType('  *她低下头*')).toBe('action');
  });

  it('引号开头识别为 dialogue（含中文引号）', () => {
    expect(detectOpeningType('"直接说话"')).toBe('dialogue');
    expect(detectOpeningType('“中文引号开头”')).toBe('dialogue');
    expect(detectOpeningType('「日式引号」')).toBe('dialogue');
  });

  it('其他识别为 narration', () => {
    expect(detectOpeningType('窗外的雨渐渐大了。')).toBe('narration');
    expect(detectOpeningType('沉默了很久之后……')).toBe('narration');
  });
});

describe('extractStyleFingerprint', () => {
  it('提取开场类型序列与动作短语集合', () => {
    const replies = [
      '*微笑* "你好"',      // action
      '“我走了。”',          // dialogue
      '夜色渐深。*叹气*',    // narration
    ];
    const fp = extractStyleFingerprint(replies);
    expect(fp.openingTypes).toEqual(['action', 'dialogue', 'narration']);
    expect(fp.actionPhrases).toContain('微笑');
    expect(fp.actionPhrases).toContain('叹气');
  });

  it('过滤空串与非法输入', () => {
    const fp = extractStyleFingerprint(['', '   ', null as any, undefined as any]);
    expect(fp.openingTypes).toEqual([]);
    expect(fp.actionPhrases).toEqual([]);
    expect(extractStyleFingerprint([] as string[]).openingTypes).toEqual([]);
  });
});

describe('buildStyleAvoidancePrompt', () => {
  it('样本不足（<3 条）返回空串', () => {
    const fp = extractStyleFingerprint(['*微笑* a', '*微笑* b']);
    expect(buildStyleAvoidancePrompt(fp)).toBe('');
  });

  it('≥3/5 同类型开场触发开场规避', () => {
    const replies = [
      '*微笑* "一"',
      '*点头* "二"',
      '*叹气* "三"',
      '“四”',
      '*挥手* "五"',
    ];
    const prompt = buildStyleAvoidancePrompt(extractStyleFingerprint(replies));
    expect(prompt).toContain('【表达提醒】');
    expect(prompt).toContain('动作描写');
    expect(prompt).toContain('开场');
  });

  it('动作短语出现 ≥3 次触发短语规避', () => {
    const replies = [
      '*微微一笑* "一"',
      '*微微一笑* "二"',
      '“三。”*微微一笑*',
    ];
    const prompt = buildStyleAvoidancePrompt(extractStyleFingerprint(replies));
    expect(prompt).toContain('微微一笑');
    expect(prompt).toContain('用过多次');
  });

  it('无重复信号返回空串', () => {
    const replies = [
      '*微笑* "一"',
      '“二。”她说。',
      '夜色渐深，远处传来钟声。',
    ];
    expect(buildStyleAvoidancePrompt(extractStyleFingerprint(replies))).toBe('');
  });

  it('规避指令为描述性措辞（不含"禁止"字样）', () => {
    const replies = ['*微笑* "一"', '*点头* "二"', '*叹气* "三"'];
    const prompt = buildStyleAvoidancePrompt(extractStyleFingerprint(replies));
    expect(prompt).not.toContain('禁止');
    expect(prompt).toContain('不妨');
  });
});

describe('buildCreativeRotationPrompt / hashString', () => {
  it('始终返回非空指令且包含策略文本', () => {
    const prompt = buildCreativeRotationPrompt(42);
    expect(prompt).toContain('【表达方式建议】');
    expect(prompt).toContain('仅供参考');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('相同 seed 结果稳定（确定性）', () => {
    expect(buildCreativeRotationPrompt(42)).toBe(buildCreativeRotationPrompt(42));
  });

  it('不同 seed 覆盖池内不同策略', () => {
    const picked = new Set<string>();
    for (let seed = 0; seed < CREATIVE_ROTATION_POOL.length * 3; seed++) {
      const prompt = buildCreativeRotationPrompt(seed);
      // 从指令中反查策略文本
      for (const s of CREATIVE_ROTATION_POOL) {
        if (prompt.includes(s)) {
          picked.add(s);
          break;
        }
      }
    }
    expect(picked.size).toBeGreaterThanOrEqual(CREATIVE_ROTATION_POOL.length / 2);
  });

  it('hashString 对不同文本产生不同值', () => {
    expect(hashString('你好')).not.toBe(hashString('再见'));
    expect(hashString('')).toBe(hashString(''));
  });

  it('轮换池常量完整（12 项）', () => {
    expect(CREATIVE_ROTATION_POOL.length).toBe(12);
    expect(STYLE_FINGERPRINT_WINDOW).toBe(5);
  });
});
