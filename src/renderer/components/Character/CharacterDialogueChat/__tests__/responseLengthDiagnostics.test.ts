/**
 * shouldStrengthenLength 单元测试
 *
 * 验证目标（spec Task 8.5）：
 * 1. 最近 3 轮回复均低于阈值时返回 true（触发强化约束）
 * 2. 历史不足 3 轮时返回 false
 * 3. 任意一轮达到阈值时返回 false
 * 4. 阈值 <= 0 时返回 false（关闭功能）
 * 5. 空历史返回 false
 *
 * Spec: fix-ai-response-length-degradation / Task 4 / 8.5
 */

import { describe, it, expect } from 'vitest';
import { shouldStrengthenLength } from '../CharacterDialogueChat.hooks';

describe('shouldStrengthenLength（Spec: fix-ai-response-length-degradation / Task 4）', () => {
  describe('触发强化约束（返回 true）', () => {
    it('3 轮均低于阈值时返回 true', () => {
      expect(shouldStrengthenLength([100, 100, 100], 300)).toBe(true);
    });

    it('超过 3 轮且最后 3 轮均低于阈值时返回 true', () => {
      // 前 1 轮达到阈值不影响：只看最后 3 轮
      expect(shouldStrengthenLength([100, 100, 100, 100], 300)).toBe(true);
    });

    it('最后 3 轮均低于阈值（前几轮混合）返回 true', () => {
      // 历史：500, 200, 100, 100（最后 3 轮：500,200,100 - 但 500 >= 300，所以应返回 false）
      // 修正：最后 3 轮 = [200, 100, 100] 均低于 300 → true
      expect(shouldStrengthenLength([500, 200, 100, 100], 300)).toBe(true);
    });
  });

  describe('不触发强化约束（返回 false）', () => {
    it('仅 2 轮历史时返回 false（需要至少 3 轮）', () => {
      expect(shouldStrengthenLength([100, 100], 300)).toBe(false);
    });

    it('1 轮历史时返回 false', () => {
      expect(shouldStrengthenLength([100], 300)).toBe(false);
    });

    it('最后 1 轮达到阈值时返回 false', () => {
      // 最后 3 轮 = [100, 100, 500]，500 >= 300 → false
      expect(shouldStrengthenLength([100, 100, 500], 300)).toBe(false);
    });

    it('超过 3 轮但最后 1 轮达到阈值时返回 false', () => {
      // 最后 3 轮 = [100, 100, 500]，500 >= 300 → false
      expect(shouldStrengthenLength([100, 100, 100, 500], 300)).toBe(false);
    });

    it('最后 3 轮中第 2 轮达到阈值时返回 false', () => {
      // 最后 3 轮 = [100, 500, 100]，500 >= 300 → false
      expect(shouldStrengthenLength([100, 500, 100], 300)).toBe(false);
    });

    it('空历史返回 false', () => {
      expect(shouldStrengthenLength([], 300)).toBe(false);
    });
  });

  describe('阈值边界（关闭功能）', () => {
    it('threshold = 0 时返回 false（关闭强化约束）', () => {
      expect(shouldStrengthenLength([100, 100, 100], 0)).toBe(false);
    });

    it('threshold 为负数时返回 false（关闭强化约束）', () => {
      expect(shouldStrengthenLength([100, 100, 100], -1)).toBe(false);
    });

    it('threshold = 0 时即使所有回复为 0 也返回 false', () => {
      // 阈值 0 关闭功能，不会触发
      expect(shouldStrengthenLength([0, 0, 0], 0)).toBe(false);
    });
  });

  describe('回复长度边界', () => {
    it('回复长度恰好等于阈值时不触发（>= threshold 视为达标）', () => {
      // 最后 3 轮 = [300, 300, 300]，每项都 = threshold，应视为达标 → false
      expect(shouldStrengthenLength([300, 300, 300], 300)).toBe(false);
    });

    it('回复长度 = threshold - 1 时触发', () => {
      // 最后 3 轮 = [299, 299, 299]，每项都 < threshold → true
      expect(shouldStrengthenLength([299, 299, 299], 300)).toBe(true);
    });

    it('回复长度为 0 时不触发（0 被视为无效回复，不计入短回复判定）', () => {
      // 源码：last3.every(len => typeof len === 'number' && len > 0 && len < threshold)
      // 0 不满足 len > 0，因此 every() 返回 false → shouldStrengthenLength 返回 false
      expect(shouldStrengthenLength([0, 0, 0], 300)).toBe(false);
    });

    it('最后 3 轮中含 0 时不触发（0 视为无效回复）', () => {
      // [100, 0, 100]: 0 不满足 len > 0 → false
      expect(shouldStrengthenLength([100, 0, 100], 300)).toBe(false);
    });
  });

  describe('非数组输入容错', () => {
    it('传入 null 时返回 false（不抛异常）', () => {
      expect(shouldStrengthenLength(null as unknown as number[], 300)).toBe(false);
    });

    it('传入 undefined 时返回 false（不抛异常）', () => {
      expect(shouldStrengthenLength(undefined as unknown as number[], 300)).toBe(false);
    });
  });
});
