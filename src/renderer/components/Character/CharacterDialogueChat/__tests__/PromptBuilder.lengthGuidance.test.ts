/**
 * buildLengthGuidancePrompt / buildCharacterContext (options) 单元测试
 *
 * 验证目标：
 * 1. buildLengthGuidancePrompt 日常模式输出信息密度引导（"通常 X 字左右"+实质推进），
 *    不再包含硬性字数下限与"三要素"表述（Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 2）
 * 2. 强化模式（strengthen=true）保留硬性字数下限与"重要提醒"段
 *    （Spec: fix-ai-response-length-degradation 救火机制原样保留）
 * 3. buildLengthGuidancePrompt 在 minResponseChars<=0 时返回空串
 * 4. buildCharacterContext 第三参数 options.minResponseChars 控制是否追加长度引导
 * 5. buildCharacterContext options.strengthenLength=true 时追加强化段
 *
 * Spec: fix-ai-response-length-degradation / Task 3.2 / 3.3 / 8.1 / 8.2
 * Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 2（日常模式措辞改造）
 */

import { describe, it, expect } from 'vitest';
import {
  buildLengthGuidancePrompt,
  buildCharacterContext,
} from '../PromptBuilder';

describe('buildLengthGuidancePrompt（Spec: fix-ai-response-length-degradation / Task 3.2 + reduce-dialogue-ai-flavor-and-repetition / Phase 2）', () => {
  describe('日常模式（strengthen=false）— 信息密度引导', () => {
    it('返回包含软性字数参考与角色名的约束串', () => {
      const prompt = buildLengthGuidancePrompt(300, false, '艾莉');
      // 软性字数参考（"通常 … 字左右"），非硬性下限
      expect(prompt).toContain('通常在 300 字左右');
      expect(prompt).toContain('艾莉');
    });

    it('包含实质推进引导（信息密度核心约束）', () => {
      const prompt = buildLengthGuidancePrompt(300, false, '艾莉');
      expect(prompt).toContain('实质推进');
      expect(prompt).toContain('情节点');
    });

    it('不再包含硬性字数下限与三要素表述（去填充式写作）', () => {
      const prompt = buildLengthGuidancePrompt(300, false, '艾莉');
      expect(prompt).not.toContain('不少于 300 字');
      expect(prompt).not.toContain('避免简短敷衍');
    });

    it('不包含"重要提醒"段落（仅强化模式才有）', () => {
      const prompt = buildLengthGuidancePrompt(300, false, '艾莉');
      expect(prompt).not.toContain('重要提醒');
    });
  });

  describe('强化模式（strengthen=true）— 救火机制保留', () => {
    it('返回包含"重要提醒"与"过短"关键词的强化串', () => {
      const prompt = buildLengthGuidancePrompt(300, true, '艾莉');
      expect(prompt).toContain('重要提醒');
      expect(prompt).toContain('过短');
    });

    it('强化模式保留硬性字数下限（至少 300 字）', () => {
      const prompt = buildLengthGuidancePrompt(300, true, '艾莉');
      expect(prompt).toContain('至少 300 字');
    });

    it('强化模式包含默认约束段与角色名', () => {
      const prompt = buildLengthGuidancePrompt(300, true, '艾莉');
      expect(prompt).toContain('通常在 300 字左右');
      expect(prompt).toContain('艾莉');
    });
  });

  describe('边界条件', () => {
    it('minResponseChars=0 时返回空串', () => {
      const prompt = buildLengthGuidancePrompt(0, false, '艾莉');
      expect(prompt).toBe('');
    });

    it('未传入 charName 时回退到默认 "Character"', () => {
      const prompt = buildLengthGuidancePrompt(300, false);
      expect(prompt).toContain('Character');
      expect(prompt).toContain('通常在 300 字左右');
    });

    it('charName 为空字符串时回退到默认 "Character"', () => {
      const prompt = buildLengthGuidancePrompt(300, false, '');
      expect(prompt).toContain('Character');
      expect(prompt).toContain('通常在 300 字左右');
    });

    it('minResponseChars 为负数时返回空串', () => {
      const prompt = buildLengthGuidancePrompt(-100, false, '艾莉');
      expect(prompt).toBe('');
    });
  });
});

describe('buildCharacterContext options 参数（Spec: Task 3.3 / 8.2）', () => {
  // 最小可用的 characterInfo
  const baseInfo = { name: '艾莉' };

  describe('options.minResponseChars 注入长度引导', () => {
    it('传入 minResponseChars=300 时输出包含"通常在 300 字左右"约束', () => {
      const ctx = buildCharacterContext(baseInfo, 'User', { minResponseChars: 300 });
      expect(ctx).toContain('通常在 300 字左右');
    });

    it('传入 minResponseChars=300 + strengthenLength=true 时输出包含"重要提醒"强化段', () => {
      const ctx = buildCharacterContext(baseInfo, 'User', {
        minResponseChars: 300,
        strengthenLength: true,
      });
      expect(ctx).toContain('通常在 300 字左右');
      expect(ctx).toContain('重要提醒');
      expect(ctx).toContain('至少 300 字');
    });

    it('strengthenLength 默认（未传）时不包含"重要提醒"', () => {
      const ctx = buildCharacterContext(baseInfo, 'User', { minResponseChars: 300 });
      expect(ctx).toContain('通常在 300 字左右');
      expect(ctx).not.toContain('重要提醒');
    });

    it('strengthenLength=false 时不包含"重要提醒"', () => {
      const ctx = buildCharacterContext(baseInfo, 'User', {
        minResponseChars: 300,
        strengthenLength: false,
      });
      expect(ctx).toContain('通常在 300 字左右');
      expect(ctx).not.toContain('重要提醒');
    });
  });

  describe('未传入 options 时保持向后兼容', () => {
    it('未传入第三参数 options 时不包含长度引导约束', () => {
      const ctx = buildCharacterContext(baseInfo, 'User');
      expect(ctx).not.toContain('通常在');
    });

    it('传入空对象 options 时不包含长度引导约束', () => {
      const ctx = buildCharacterContext(baseInfo, 'User', {});
      expect(ctx).not.toContain('通常在');
    });

    it('未传入 options 时仍输出角色卡权威约束（验证主流程未受影响）', () => {
      const ctx = buildCharacterContext(baseInfo, 'User');
      expect(ctx).toContain('【重要】角色卡设定为绝对权威');
      expect(ctx).toContain('艾莉');
    });
  });

  describe('minResponseChars=0 关闭长度引导', () => {
    it('minResponseChars=0 时不包含长度引导约束', () => {
      const ctx = buildCharacterContext(baseInfo, 'User', { minResponseChars: 0 });
      expect(ctx).not.toContain('通常在');
    });

    it('minResponseChars=0 + strengthenLength=true 时也不包含"重要提醒"', () => {
      // strengthen=true 但 minResponseChars=0 应整体跳过长度引导
      const ctx = buildCharacterContext(baseInfo, 'User', {
        minResponseChars: 0,
        strengthenLength: true,
      });
      expect(ctx).not.toContain('通常在');
      expect(ctx).not.toContain('重要提醒');
    });

    it('minResponseChars 为负数时也不包含长度引导约束', () => {
      const ctx = buildCharacterContext(baseInfo, 'User', { minResponseChars: -1 });
      expect(ctx).not.toContain('通常在');
    });
  });

  describe('长度引导段在角色卡权威约束之后', () => {
    it('"通常在 300 字左右"出现在"角色卡设定为绝对权威"之后', () => {
      const ctx = buildCharacterContext(baseInfo, 'User', { minResponseChars: 300 });
      const authorityIdx = ctx.indexOf('【重要】角色卡设定为绝对权威');
      const lengthIdx = ctx.indexOf('通常在 300 字左右');
      expect(authorityIdx).toBeGreaterThanOrEqual(0);
      expect(lengthIdx).toBeGreaterThan(authorityIdx);
    });
  });
});
