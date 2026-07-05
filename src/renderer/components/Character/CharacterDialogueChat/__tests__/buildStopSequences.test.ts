/**
 * buildStopSequences 单元测试
 *
 * 验证目标：
 * 1. buildStopSequences("张三") 返回包含 `\n张三:` 和 `\n张三：` 等的数组
 * 2. 默认返回 12 个用户名变体（6 双换行前缀 + 6 单换行前缀）
 *    （Spec: fix-ai-response-length-degradation / Task 6）
 * 3. 传入 customStops 时合并且去重
 * 4. 用户名为 "User"/"用户" 时与通用前缀去重
 *
 * Spec: optimize-chat-ai-intelligence / Task 3
 * Spec: fix-ai-response-length-degradation / Task 6（停止序列优化）
 */

import { describe, it, expect } from 'vitest';
import { buildStopSequences } from '../PromptBuilder';

describe('buildStopSequences', () => {
  describe('默认数组内容（Spec: Task 6 - 12 项变体）', () => {
    it('返回包含双换行前缀用户名变体（中英文冒号）', () => {
      const stops = buildStopSequences('张三');
      // 双换行前缀：用户名 + 中英文冒号
      expect(stops).toContain('\n\n张三:');
      expect(stops).toContain('\n\n张三：');
      // 双换行前缀：中文通用前缀
      expect(stops).toContain('\n\n用户:');
      expect(stops).toContain('\n\n用户：');
      // 双换行前缀：英文通用前缀
      expect(stops).toContain('\n\nUser:');
      expect(stops).toContain('\n\nUser：');
    });

    it('返回包含单换行前缀用户名变体（中英文冒号）', () => {
      const stops = buildStopSequences('张三');
      // 单换行前缀：用户名 + 中英文冒号
      expect(stops).toContain('\n张三:');
      expect(stops).toContain('\n张三：');
      // 单换行前缀：中文通用前缀
      expect(stops).toContain('\n用户:');
      expect(stops).toContain('\n用户：');
      // 单换行前缀：英文通用前缀
      expect(stops).toContain('\nUser:');
      expect(stops).toContain('\nUser：');
    });

    it('默认数组长度为 12（6 双换行前缀 + 6 单换行前缀）', () => {
      const stops = buildStopSequences('李四');
      // 用户名 '李四' 与 '用户'/'User' 均不同，无内部重复，12 项全部保留
      expect(stops).toHaveLength(12);
    });

    it('前 6 项以双换行符 \\n\\n 开头', () => {
      const stops = buildStopSequences('张三');
      expect(stops).toHaveLength(12);
      const first6 = stops.slice(0, 6);
      for (const s of first6) {
        expect(s.startsWith('\n\n')).toBe(true);
      }
    });

    it('后 6 项以单换行符 \\n 开头（非 \\n\\n）', () => {
      const stops = buildStopSequences('张三');
      const last6 = stops.slice(6, 12);
      for (const s of last6) {
        expect(s.startsWith('\n')).toBe(true);
        // 关键：不应以 \n\n 开头（否则会与双换行变体重复）
        expect(s.startsWith('\n\n')).toBe(false);
      }
    });

    it('12 项默认数组的精确内容（用户名=张三）', () => {
      const stops = buildStopSequences('张三');
      expect(stops).toEqual([
        '\n\n张三:',
        '\n\n张三：',
        '\n\n用户:',
        '\n\n用户：',
        '\n\nUser:',
        '\n\nUser：',
        '\n张三:',
        '\n张三：',
        '\n用户:',
        '\n用户：',
        '\nUser:',
        '\nUser：',
      ]);
    });
  });

  describe('用户名缺省/空白回退', () => {
    it('用户名为空时回退到默认 User', () => {
      const stops = buildStopSequences('');
      expect(stops).toContain('\n\nUser:');
      expect(stops).toContain('\n\nUser：');
      expect(stops).toContain('\nUser:');
      expect(stops).toContain('\nUser：');
      // 不应包含 "\n\n:"（空用户名 + 冒号）
      expect(stops).not.toContain('\n\n:');
      expect(stops).not.toContain('\n:');
    });

    it('用户名为空白字符时回退到默认 User', () => {
      const stops = buildStopSequences('   ');
      expect(stops).toContain('\n\nUser:');
      expect(stops).toContain('\nUser:');
    });
  });

  describe('customStops 合并与去重', () => {
    it('传入 customStops 时合并到数组末尾', () => {
      const customStops = ['<END>', '\n助理:'];
      const stops = buildStopSequences('张三', customStops);
      // 默认 12 个 + 自定义 2 个
      expect(stops).toHaveLength(14);
      // 自定义在末尾
      expect(stops[12]).toBe('<END>');
      expect(stops[13]).toBe('\n助理:');
      // 默认仍在前面
      expect(stops).toContain('\n\n张三:');
      expect(stops).toContain('\n张三:');
    });

    it('customStops 与默认重复时去重', () => {
      // 用户名变体已默认存在，customStops 重复提供应被去重
      const customStops = ['\n张三:', '\n用户:', '<END>'];
      const stops = buildStopSequences('张三', customStops);
      // 12 个默认 + 1 个新增（<END>），重复的 2 个被去重
      expect(stops).toHaveLength(13);
      expect(stops.filter(s => s === '\n张三:')).toHaveLength(1);
      expect(stops.filter(s => s === '\n用户:')).toHaveLength(1);
      expect(stops).toContain('<END>');
    });

    it('customStops 内部自身重复时也去重', () => {
      const customStops = ['<END>', '<END>', '\n助理:', '\n助理:'];
      const stops = buildStopSequences('王五', customStops);
      // 12 默认 + 2 去重后自定义
      expect(stops).toHaveLength(14);
      expect(stops.filter(s => s === '<END>')).toHaveLength(1);
      expect(stops.filter(s => s === '\n助理:')).toHaveLength(1);
    });

    it('customStops 包含空字符串时被过滤', () => {
      const customStops = ['', '<END>', '   '];
      const stops = buildStopSequences('张三', customStops);
      // 12 默认 + 1 个有效（<END>），空字符串和纯空白被过滤
      expect(stops).toHaveLength(13);
      expect(stops).not.toContain('');
    });

    it('customStops 为空数组时仅返回默认数组', () => {
      const stops = buildStopSequences('张三', []);
      expect(stops).toHaveLength(12);
      expect(stops).toContain('\n\n张三:');
      expect(stops).toContain('\n张三:');
    });

    it('customStops 为 undefined 时仅返回默认数组', () => {
      const stops = buildStopSequences('张三', undefined);
      expect(stops).toHaveLength(12);
    });
  });

  describe('英文用户名场景', () => {
    it('英文用户名（如 Alice）返回 12 项默认数组', () => {
      const stops = buildStopSequences('Alice');
      expect(stops).toContain('\n\nAlice:');
      expect(stops).toContain('\n\nAlice：');
      expect(stops).toContain('\nAlice:');
      expect(stops).toContain('\nAlice：');
      // 通用前缀
      expect(stops).toContain('\n\nUser:');
      expect(stops).toContain('\nUser:');
      // 用户名变体不应与通用 User 重复（除非用户名就是 User）
      expect(stops).toHaveLength(12);
    });
  });

  describe('用户名与通用前缀重名时的去重', () => {
    it('用户名恰好为 "User" 时去重 \\nUser: 与 \\n\\nUser:', () => {
      // 用户名变体 \nUser:/\n\nUser: 与通用 \nUser:/\n\nUser: 相同，应去重
      const stops = buildStopSequences('User');
      // \nUser: 和 \nUser：各出现一次（去重后）
      expect(stops.filter(s => s === '\nUser:')).toHaveLength(1);
      expect(stops.filter(s => s === '\nUser：')).toHaveLength(1);
      // 双换行变体同样去重
      expect(stops.filter(s => s === '\n\nUser:')).toHaveLength(1);
      expect(stops.filter(s => s === '\n\nUser：')).toHaveLength(1);
      // 总长度：12 - 4 重复 = 8 项
      expect(stops).toHaveLength(8);
    });

    it('用户名恰好为 "用户" 时去重 \\n用户: 与 \\n\\n用户:', () => {
      const stops = buildStopSequences('用户');
      expect(stops.filter(s => s === '\n用户:')).toHaveLength(1);
      expect(stops.filter(s => s === '\n用户：')).toHaveLength(1);
      expect(stops.filter(s => s === '\n\n用户:')).toHaveLength(1);
      expect(stops.filter(s => s === '\n\n用户：')).toHaveLength(1);
      // 总长度：12 - 4 重复 = 8 项
      expect(stops).toHaveLength(8);
    });
  });
});
