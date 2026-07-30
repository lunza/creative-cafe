/**
 * buildStopSequences 单元测试
 *
 * 验证目标：
 * 1. buildStopSequences("张三") 返回包含 `\n\n张三:` 和 `\n\n张三：` 等的数组
 * 2. 默认返回 6 个用户名变体（仅双换行前缀）
 *    （Spec: fix-ai-response-length-degradation / Task 6 + 🐛 Bug修复：
 *     移除单换行前缀变体，避免 OpenAI-compatible 后端子串匹配误触发截断）
 * 3. 传入 customStops 时合并且去重
 * 4. 用户名为 "User"/"用户" 时与通用前缀去重
 *
 * Spec: optimize-chat-ai-intelligence / Task 3
 * Spec: fix-ai-response-length-degradation / Task 6（停止序列优化）
 *
 * ⚠️ 测试对齐说明：原实现返回 12 项（6 双换行 + 6 单换行），后经 Bug修复
 *    移除单换行变体（详见 PromptBuilder.ts 中 `buildStopSequences` 的「🐛 Bug修复（重点）」注释）。
 *    本测试以实际实现为准，验证 6 项双换行前缀变体。
 */

import { describe, it, expect } from 'vitest';
import { buildStopSequences } from '../PromptBuilder';

describe('buildStopSequences', () => {
  describe('默认数组内容（Spec: Task 6 - 6 项双换行前缀变体）', () => {
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

    it('不包含单换行前缀变体（Bug修复后已移除，避免误触发截断）', () => {
      const stops = buildStopSequences('张三');
      // 单换行前缀变体已移除（OpenAI-compatible 后端子串匹配会误触发）
      expect(stops).not.toContain('\n张三:');
      expect(stops).not.toContain('\n张三：');
      expect(stops).not.toContain('\n用户:');
      expect(stops).not.toContain('\n用户：');
      expect(stops).not.toContain('\nUser:');
      expect(stops).not.toContain('\nUser：');
    });

    it('默认数组长度为 6（仅双换行前缀）', () => {
      const stops = buildStopSequences('李四');
      // 用户名 '李四' 与 '用户'/'User' 均不同，无内部重复，6 项全部保留
      expect(stops).toHaveLength(6);
    });

    it('全部 6 项以双换行符 \\n\\n 开头', () => {
      const stops = buildStopSequences('张三');
      expect(stops).toHaveLength(6);
      for (const s of stops) {
        expect(s.startsWith('\n\n')).toBe(true);
      }
    });

    it('6 项默认数组的精确内容（用户名=张三）', () => {
      const stops = buildStopSequences('张三');
      expect(stops).toEqual([
        '\n\n张三:',
        '\n\n张三：',
        '\n\n用户:',
        '\n\n用户：',
        '\n\nUser:',
        '\n\nUser：',
      ]);
    });
  });

  describe('用户名缺省/空白回退', () => {
    it('用户名为空时回退到默认 User', () => {
      const stops = buildStopSequences('');
      expect(stops).toContain('\n\nUser:');
      expect(stops).toContain('\n\nUser：');
      // 不应包含 "\n\n:"（空用户名 + 冒号）
      expect(stops).not.toContain('\n\n:');
    });

    it('用户名为空白字符时回退到默认 User', () => {
      const stops = buildStopSequences('   ');
      expect(stops).toContain('\n\nUser:');
    });
  });

  describe('customStops 合并与去重', () => {
    it('传入 customStops 时合并到数组末尾', () => {
      const customStops = ['<END>', '\n助理:'];
      const stops = buildStopSequences('张三', customStops);
      // 默认 6 个 + 自定义 2 个
      expect(stops).toHaveLength(8);
      // 自定义在末尾
      expect(stops[6]).toBe('<END>');
      expect(stops[7]).toBe('\n助理:');
      // 默认仍在前面
      expect(stops).toContain('\n\n张三:');
    });

    it('customStops 与默认重复时去重', () => {
      // 用户名变体已默认存在，customStops 重复提供应被去重
      const customStops = ['\n\n张三:', '\n\n用户:', '<END>'];
      const stops = buildStopSequences('张三', customStops);
      // 6 个默认 + 1 个新增（<END>），重复的 2 个被去重
      expect(stops).toHaveLength(7);
      expect(stops.filter(s => s === '\n\n张三:')).toHaveLength(1);
      expect(stops.filter(s => s === '\n\n用户:')).toHaveLength(1);
      expect(stops).toContain('<END>');
    });

    it('customStops 内部自身重复时也去重', () => {
      const customStops = ['<END>', '<END>', '\n助理:', '\n助理:'];
      const stops = buildStopSequences('王五', customStops);
      // 6 默认 + 2 去重后自定义
      expect(stops).toHaveLength(8);
      expect(stops.filter(s => s === '<END>')).toHaveLength(1);
      expect(stops.filter(s => s === '\n助理:')).toHaveLength(1);
    });

    it('customStops 包含空字符串时被过滤', () => {
      const customStops = ['', '<END>', '   '];
      const stops = buildStopSequences('张三', customStops);
      // 6 默认 + 1 个有效（<END>），空字符串和纯空白被过滤
      expect(stops).toHaveLength(7);
      expect(stops).not.toContain('');
    });

    it('customStops 为空数组时仅返回默认数组', () => {
      const stops = buildStopSequences('张三', []);
      expect(stops).toHaveLength(6);
      expect(stops).toContain('\n\n张三:');
    });

    it('customStops 为 undefined 时仅返回默认数组', () => {
      const stops = buildStopSequences('张三', undefined);
      expect(stops).toHaveLength(6);
    });
  });

  describe('英文用户名场景', () => {
    it('英文用户名（如 Alice）返回 6 项默认数组', () => {
      const stops = buildStopSequences('Alice');
      expect(stops).toContain('\n\nAlice:');
      expect(stops).toContain('\n\nAlice：');
      // 通用前缀
      expect(stops).toContain('\n\nUser:');
      // 用户名变体不应与通用 User 重复（除非用户名就是 User）
      expect(stops).toHaveLength(6);
    });
  });

  describe('用户名与通用前缀重名时的去重', () => {
    it('用户名恰好为 "User" 时去重 \\n\\nUser: 重复项', () => {
      // 用户名变体 \n\nUser:/\n\nUser： 与通用 \n\nUser:/\n\nUser： 相同，应去重
      const stops = buildStopSequences('User');
      expect(stops.filter(s => s === '\n\nUser:')).toHaveLength(1);
      expect(stops.filter(s => s === '\n\nUser：')).toHaveLength(1);
      // 总长度：6 - 2 重复 = 4 项
      expect(stops).toHaveLength(4);
    });

    it('用户名恰好为 "用户" 时去重 \\n\\n用户: 重复项', () => {
      const stops = buildStopSequences('用户');
      expect(stops.filter(s => s === '\n\n用户:')).toHaveLength(1);
      expect(stops.filter(s => s === '\n\n用户：')).toHaveLength(1);
      // 总长度：6 - 2 重复 = 4 项
      expect(stops).toHaveLength(4);
    });
  });

  describe('纯函数行为', () => {
    it('多次调用返回相同结果', () => {
      const a = buildStopSequences('张三');
      const b = buildStopSequences('张三');
      expect(a).toEqual(b);
    });

    it('同一 userName 多次调用结果长度一致', () => {
      const a = buildStopSequences('张三', ['<END>']);
      const b = buildStopSequences('张三', ['<END>']);
      expect(a.length).toBe(b.length);
      expect(a).toEqual(b);
    });
  });
});
