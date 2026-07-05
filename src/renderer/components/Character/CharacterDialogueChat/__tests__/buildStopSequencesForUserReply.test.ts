/**
 * buildStopSequencesForUserReply 单元测试
 *
 * 验证目标（spec Task 1.2 / Task 5.2）：
 * 1. buildStopSequencesForUserReply('艾莉') 返回 8 项数组
 * 2. 前 4 项以 \n\n 开头，后 4 项以 \n 开头（非 \n\n）
 * 3. 包含 \n\n艾莉:、\n\n艾莉：、\n\n{{char}}:、\n\n{{char}}： 等
 * 4. customStops 合并与去重逻辑正确
 * 5. 用户名缺省时回退到 'Character'
 * 6. customStops 中的空字符串与纯空白被过滤
 *
 * Spec: add-ai-user-reply-button / Task 1.2
 *
 * 注意：spec 原文写"safeCharName='Character' matches the fallback default"会触发去重，
 * 但实际实现中 'Character' 与 '{{char}}' 是不同的字符串字面量，不会去重；
 * 真正的去重仅在 charName='{{char}}' 时发生（见源码注释）。本测试以实际实现为准。
 */

import { describe, it, expect } from 'vitest';
import { buildStopSequencesForUserReply } from '../PromptBuilder';

describe('buildStopSequencesForUserReply（Spec: add-ai-user-reply-button / Task 1.2）', () => {
  describe('默认数组内容（8 项变体）', () => {
    it('返回包含双换行前缀角色名变体（中英文冒号）', () => {
      const stops = buildStopSequencesForUserReply('艾莉');
      // 双换行前缀：角色名 + 中英文冒号
      expect(stops).toContain('\n\n艾莉:');
      expect(stops).toContain('\n\n艾莉：');
      // 双换行前缀：模板变量 + 中英文冒号
      expect(stops).toContain('\n\n{{char}}:');
      expect(stops).toContain('\n\n{{char}}：');
    });

    it('返回包含单换行前缀角色名变体（中英文冒号）', () => {
      const stops = buildStopSequencesForUserReply('艾莉');
      // 单换行前缀：角色名 + 中英文冒号
      expect(stops).toContain('\n艾莉:');
      expect(stops).toContain('\n艾莉：');
      // 单换行前缀：模板变量 + 中英文冒号
      expect(stops).toContain('\n{{char}}:');
      expect(stops).toContain('\n{{char}}：');
    });

    it('默认数组长度为 8（4 双换行前缀 + 4 单换行前缀）', () => {
      const stops = buildStopSequencesForUserReply('艾莉');
      // 角色名 '艾莉' 与 '{{char}}' 不同，无内部重复，8 项全部保留
      expect(stops).toHaveLength(8);
    });

    it('前 4 项以双换行符 \\n\\n 开头', () => {
      const stops = buildStopSequencesForUserReply('艾莉');
      expect(stops).toHaveLength(8);
      const first4 = stops.slice(0, 4);
      for (const s of first4) {
        expect(s.startsWith('\n\n')).toBe(true);
      }
    });

    it('后 4 项以单换行符 \\n 开头（非 \\n\\n）', () => {
      const stops = buildStopSequencesForUserReply('艾莉');
      const last4 = stops.slice(4, 8);
      for (const s of last4) {
        expect(s.startsWith('\n')).toBe(true);
        // 关键：不应以 \n\n 开头（否则会与双换行变体重复）
        expect(s.startsWith('\n\n')).toBe(false);
      }
    });

    it('8 项默认数组的精确内容（charName=艾莉）', () => {
      const stops = buildStopSequencesForUserReply('艾莉');
      expect(stops).toEqual([
        '\n\n艾莉:',
        '\n\n艾莉：',
        '\n\n{{char}}:',
        '\n\n{{char}}：',
        '\n艾莉:',
        '\n艾莉：',
        '\n{{char}}:',
        '\n{{char}}：',
      ]);
    });
  });

  describe('charName 缺省/空白回退', () => {
    it('charName 为空时回退到默认 Character', () => {
      const stops = buildStopSequencesForUserReply('');
      expect(stops).toContain('\n\nCharacter:');
      expect(stops).toContain('\n\nCharacter：');
      expect(stops).toContain('\nCharacter:');
      expect(stops).toContain('\nCharacter：');
      // 不应包含 "\n\n:"（空角色名 + 冒号）
      expect(stops).not.toContain('\n\n:');
      expect(stops).not.toContain('\n:');
    });

    it('charName 为空白字符时回退到默认 Character', () => {
      const stops = buildStopSequencesForUserReply('   ');
      expect(stops).toContain('\n\nCharacter:');
      expect(stops).toContain('\nCharacter:');
    });

    it('charName 为空白字符时回退后仍为 8 项', () => {
      const stops = buildStopSequencesForUserReply('   ');
      // 'Character' 与 '{{char}}' 不重复，仍为 8 项
      expect(stops).toHaveLength(8);
    });
  });

  describe('customStops 合并与去重', () => {
    it('传入 customStops 时合并到数组末尾', () => {
      const stops = buildStopSequencesForUserReply('艾莉', ['<END>']);
      // 默认 8 个 + 自定义 1 个
      expect(stops).toHaveLength(9);
      // 自定义在末尾
      expect(stops[8]).toBe('<END>');
      // 默认仍在前面
      expect(stops).toContain('\n\n艾莉:');
      expect(stops).toContain('\n艾莉:');
    });

    it('customStops 与默认重复时去重', () => {
      // 角色名变体已默认存在，customStops 重复提供应被去重
      const stops = buildStopSequencesForUserReply('艾莉', ['\n艾莉:', '\n{{char}}:', '<END>']);
      // 8 个默认 + 1 个新增（<END>），重复的 2 个被去重
      expect(stops).toHaveLength(9);
      expect(stops.filter(s => s === '\n艾莉:')).toHaveLength(1);
      expect(stops.filter(s => s === '\n{{char}}:')).toHaveLength(1);
      expect(stops).toContain('<END>');
    });

    it('customStops 内部自身重复时也去重', () => {
      const stops = buildStopSequencesForUserReply('艾莉', ['<END>', '<END>', '\n助理:', '\n助理:']);
      // 8 默认 + 2 去重后自定义
      expect(stops).toHaveLength(10);
      expect(stops.filter(s => s === '<END>')).toHaveLength(1);
      expect(stops.filter(s => s === '\n助理:')).toHaveLength(1);
    });

    it('customStops 包含空字符串与空白时被过滤', () => {
      const stops = buildStopSequencesForUserReply('艾莉', ['', '   ', '<END>']);
      // 8 默认 + 1 个有效（<END>），空字符串和纯空白被过滤
      expect(stops).toHaveLength(9);
      expect(stops).not.toContain('');
      expect(stops).toContain('<END>');
    });

    it('customStops 为空数组时仅返回默认数组', () => {
      const stops = buildStopSequencesForUserReply('艾莉', []);
      expect(stops).toHaveLength(8);
      expect(stops).toContain('\n\n艾莉:');
      expect(stops).toContain('\n艾莉:');
    });

    it('customStops 为 undefined 时仅返回默认数组', () => {
      const stops = buildStopSequencesForUserReply('艾莉', undefined);
      expect(stops).toHaveLength(8);
    });
  });

  describe('charName 与 {{char}} 模板变量重名时的去重', () => {
    it('charName 恰为 "{{char}}" 时去重 \\n{{char}}: 与 \\n\\n{{char}}:', () => {
      // 当 charName='{{char}}' 时，角色名变体与模板变量字面量相同，应去重
      const stops = buildStopSequencesForUserReply('{{char}}');
      // \n{{char}}: 和 \n{{char}}：各出现一次（去重后）
      expect(stops.filter(s => s === '\n{{char}}:')).toHaveLength(1);
      expect(stops.filter(s => s === '\n{{char}}：')).toHaveLength(1);
      // 双换行变体同样去重
      expect(stops.filter(s => s === '\n\n{{char}}:')).toHaveLength(1);
      expect(stops.filter(s => s === '\n\n{{char}}：')).toHaveLength(1);
      // 总长度：8 - 4 重复 = 4 项
      expect(stops).toHaveLength(4);
    });

    it('charName 为 "Character"（与 fallback 默认值相同）时不触发去重', () => {
      // 注：'Character' 仅在 charName 为空/空白时作为 fallback，
      // 当用户显式传入 'Character' 时与 '{{char}}' 字面量不同，不会去重
      const stops = buildStopSequencesForUserReply('Character');
      // 8 项全部保留（'Character' 与 '{{char}}' 是不同字符串）
      expect(stops).toHaveLength(8);
      expect(stops).toContain('\n\nCharacter:');
      expect(stops).toContain('\n\n{{char}}:');
      expect(stops).toContain('\nCharacter:');
      expect(stops).toContain('\n{{char}}:');
    });
  });

  describe('英文角色名场景', () => {
    it('英文角色名（如 Alice）返回 8 项默认数组', () => {
      const stops = buildStopSequencesForUserReply('Alice');
      expect(stops).toContain('\n\nAlice:');
      expect(stops).toContain('\n\nAlice：');
      expect(stops).toContain('\nAlice:');
      expect(stops).toContain('\nAlice：');
      // 模板变量变体
      expect(stops).toContain('\n\n{{char}}:');
      expect(stops).toContain('\n{{char}}:');
      // 角色名变体不应与 {{char}} 重复
      expect(stops).toHaveLength(8);
    });
  });

  describe('纯函数行为', () => {
    it('多次调用返回相同结果', () => {
      const a = buildStopSequencesForUserReply('艾莉');
      const b = buildStopSequencesForUserReply('艾莉');
      expect(a).toEqual(b);
    });

    it('同一 charName 多次调用结果长度一致', () => {
      const a = buildStopSequencesForUserReply('艾莉', ['<END>']);
      const b = buildStopSequencesForUserReply('艾莉', ['<END>']);
      expect(a.length).toBe(b.length);
      expect(a).toEqual(b);
    });
  });
});
