/**
 * buildStopSequencesForUserReply 单元测试
 *
 * 验证目标（spec Task 1.2 / Task 5.2）：
 * 1. buildStopSequencesForUserReply('艾莉') 返回 4 项数组（仅双换行前缀）
 * 2. 4 项均以 \n\n 开头
 * 3. 包含 \n\n艾莉:、\n\n艾莉：、\n\n{{char}}:、\n\n{{char}}：
 * 4. customStops 合并与去重逻辑正确
 * 5. charName 缺省时回退到 'Character'
 * 6. customStops 中的空字符串与纯空白被过滤
 *
 * Spec: add-ai-user-reply-button / Task 1.2
 *
 * 注意：spec 原文写"safeCharName='Character' matches the fallback default"会触发去重，
 * 但实际实现中 'Character' 与 '{{char}}' 是不同的字符串字面量，不会去重；
 * 真正的去重仅在 charName='{{char}}' 时发生（见源码注释）。本测试以实际实现为准。
 *
 * ⚠️ 测试对齐说明：原实现返回 8 项（4 双换行 + 4 单换行），后经 Bug修复
 *    移除单换行变体（详见 PromptBuilder.ts 中 `buildStopSequencesForUserReply` 的
 *    「🐛 Bug修复（重点）」注释）。本测试以实际实现为准，验证 4 项双换行前缀变体。
 */

import { describe, it, expect } from 'vitest';
import { buildStopSequencesForUserReply } from '../PromptBuilder';

describe('buildStopSequencesForUserReply（Spec: add-ai-user-reply-button / Task 1.2）', () => {
  describe('默认数组内容（4 项双换行前缀变体）', () => {
    it('返回包含双换行前缀角色名变体（中英文冒号）', () => {
      const stops = buildStopSequencesForUserReply('艾莉');
      // 双换行前缀：角色名 + 中英文冒号
      expect(stops).toContain('\n\n艾莉:');
      expect(stops).toContain('\n\n艾莉：');
      // 双换行前缀：模板变量 + 中英文冒号
      expect(stops).toContain('\n\n{{char}}:');
      expect(stops).toContain('\n\n{{char}}：');
    });

    it('不包含单换行前缀变体（Bug修复后已移除，避免误触发截断）', () => {
      const stops = buildStopSequencesForUserReply('艾莉');
      expect(stops).not.toContain('\n艾莉:');
      expect(stops).not.toContain('\n艾莉：');
      expect(stops).not.toContain('\n{{char}}:');
      expect(stops).not.toContain('\n{{char}}：');
    });

    it('默认数组长度为 4（仅双换行前缀）', () => {
      const stops = buildStopSequencesForUserReply('艾莉');
      // 角色名 '艾莉' 与 '{{char}}' 不同，无内部重复，4 项全部保留
      expect(stops).toHaveLength(4);
    });

    it('全部 4 项以双换行符 \\n\\n 开头', () => {
      const stops = buildStopSequencesForUserReply('艾莉');
      expect(stops).toHaveLength(4);
      for (const s of stops) {
        expect(s.startsWith('\n\n')).toBe(true);
      }
    });

    it('4 项默认数组的精确内容（charName=艾莉）', () => {
      const stops = buildStopSequencesForUserReply('艾莉');
      expect(stops).toEqual([
        '\n\n艾莉:',
        '\n\n艾莉：',
        '\n\n{{char}}:',
        '\n\n{{char}}：',
      ]);
    });
  });

  describe('charName 缺省/空白回退', () => {
    it('charName 为空时回退到默认 Character', () => {
      const stops = buildStopSequencesForUserReply('');
      expect(stops).toContain('\n\nCharacter:');
      expect(stops).toContain('\n\nCharacter：');
      // 不应包含 "\n\n:"（空角色名 + 冒号）
      expect(stops).not.toContain('\n\n:');
    });

    it('charName 为空白字符时回退到默认 Character', () => {
      const stops = buildStopSequencesForUserReply('   ');
      expect(stops).toContain('\n\nCharacter:');
    });

    it('charName 为空白字符时回退后仍为 4 项', () => {
      const stops = buildStopSequencesForUserReply('   ');
      // 'Character' 与 '{{char}}' 不重复，仍为 4 项
      expect(stops).toHaveLength(4);
    });
  });

  describe('customStops 合并与去重', () => {
    it('传入 customStops 时合并到数组末尾', () => {
      const stops = buildStopSequencesForUserReply('艾莉', ['<END>']);
      // 默认 4 个 + 自定义 1 个
      expect(stops).toHaveLength(5);
      // 自定义在末尾
      expect(stops[4]).toBe('<END>');
      // 默认仍在前面
      expect(stops).toContain('\n\n艾莉:');
    });

    it('customStops 与默认重复时去重', () => {
      // 角色名变体已默认存在，customStops 重复提供应被去重
      const stops = buildStopSequencesForUserReply('艾莉', ['\n\n艾莉:', '\n\n{{char}}:', '<END>']);
      // 4 个默认 + 1 个新增（<END>），重复的 2 个被去重
      expect(stops).toHaveLength(5);
      expect(stops.filter(s => s === '\n\n艾莉:')).toHaveLength(1);
      expect(stops.filter(s => s === '\n\n{{char}}:')).toHaveLength(1);
      expect(stops).toContain('<END>');
    });

    it('customStops 内部自身重复时也去重', () => {
      const stops = buildStopSequencesForUserReply('艾莉', ['<END>', '<END>', '\n助理:', '\n助理:']);
      // 4 默认 + 2 去重后自定义
      expect(stops).toHaveLength(6);
      expect(stops.filter(s => s === '<END>')).toHaveLength(1);
      expect(stops.filter(s => s === '\n助理:')).toHaveLength(1);
    });

    it('customStops 包含空字符串与空白时被过滤', () => {
      const stops = buildStopSequencesForUserReply('艾莉', ['', '   ', '<END>']);
      // 4 默认 + 1 个有效（<END>），空字符串和纯空白被过滤
      expect(stops).toHaveLength(5);
      expect(stops).not.toContain('');
      expect(stops).toContain('<END>');
    });

    it('customStops 为空数组时仅返回默认数组', () => {
      const stops = buildStopSequencesForUserReply('艾莉', []);
      expect(stops).toHaveLength(4);
      expect(stops).toContain('\n\n艾莉:');
    });

    it('customStops 为 undefined 时仅返回默认数组', () => {
      const stops = buildStopSequencesForUserReply('艾莉', undefined);
      expect(stops).toHaveLength(4);
    });
  });

  describe('charName 与 {{char}} 模板变量重名时的去重', () => {
    it('charName 恰为 "{{char}}" 时去重 \\n\\n{{char}}: 重复项', () => {
      // 当 charName='{{char}}' 时，角色名变体与模板变量字面量相同，应去重
      const stops = buildStopSequencesForUserReply('{{char}}');
      expect(stops.filter(s => s === '\n\n{{char}}:')).toHaveLength(1);
      expect(stops.filter(s => s === '\n\n{{char}}：')).toHaveLength(1);
      // 总长度：4 - 2 重复 = 2 项
      expect(stops).toHaveLength(2);
    });

    it('charName 为 "Character"（与 fallback 默认值相同）时不触发去重', () => {
      // 注：'Character' 仅在 charName 为空/空白时作为 fallback，
      // 当用户显式传入 'Character' 时与 '{{char}}' 字面量不同，不会去重
      const stops = buildStopSequencesForUserReply('Character');
      // 4 项全部保留（'Character' 与 '{{char}}' 是不同字符串）
      expect(stops).toHaveLength(4);
      expect(stops).toContain('\n\nCharacter:');
      expect(stops).toContain('\n\n{{char}}:');
    });
  });

  describe('英文角色名场景', () => {
    it('英文角色名（如 Alice）返回 4 项默认数组', () => {
      const stops = buildStopSequencesForUserReply('Alice');
      expect(stops).toContain('\n\nAlice:');
      expect(stops).toContain('\n\nAlice：');
      // 模板变量变体
      expect(stops).toContain('\n\n{{char}}:');
      // 角色名变体不应与 {{char}} 重复
      expect(stops).toHaveLength(4);
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
