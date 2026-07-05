/**
 * GameTableEditParser 单元测试
 *
 * 覆盖场景：
 * 1. 空回复与无效输入
 * 2. 无 tableEdit 标签
 * 3. HTML 注释包裹格式（标准格式）
 * 4. 无 HTML 注释包裹格式（容错）
 * 5. 单命令：insertRow / updateRow / deleteRow
 * 6. 多命令混合
 * 7. 格式错误容错（无效 JSON、字符串索引、缺失参数等）
 * 8. JSON 容错（嵌套 HTML 注释、单引号、未加引号键名）
 * 9. stripTableEditTags 剥离功能
 *
 * 验证目标（spec Task 3.4）：
 * - 解析器对 insertRow / updateRow / deleteRow 三种命令均可正确提取
 * - 对格式错误的命令容错（跳过而非崩溃），记入 errors 数组
 * - 索引保持 1-based（不转换为 0-based，转换由 GameTableRepository 负责）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameTableEditParser } from '../GameTableEditParser';
import { GameTableEditCommandType } from '../../../../shared/types/game.types';

describe('GameTableEditParser', () => {
  let parser: GameTableEditParser;

  beforeEach(() => {
    parser = new GameTableEditParser();
  });

  // ========== 1. 空回复与无效输入 ==========

  describe('Empty / invalid input', () => {
    it('empty string returns empty result', () => {
      const result = parser.parse('');
      expect(result.commands).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('whitespace-only string returns empty result', () => {
      const result = parser.parse('   \n\n   \t  ');
      expect(result.commands).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('null/undefined input returns empty result without throwing', () => {
      // @ts-expect-error 测试容错：传入 null
      const result = parser.parse(null);
      expect(result.commands).toEqual([]);
      // @ts-expect-error 测试容错：传入 undefined
      const result2 = parser.parse(undefined);
      expect(result2.commands).toEqual([]);
    });
  });

  // ========== 2. 无 tableEdit 标签 ==========

  describe('No tableEdit tag', () => {
    it('pure narrative text without tableEdit returns empty result', () => {
      const text = '朱迪走进中央公园，阳光洒在她的警官徽章上。';
      const result = parser.parse(text);
      expect(result.commands).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('multi-paragraph narrative without tableEdit returns empty result', () => {
      const text = [
        '第一章 序章',
        '',
        '朱迪推开门，看见了一片新世界。',
        '',
        '"你好，"她说。',
        '',
        '尼克微笑着回应。'
      ].join('\n');
      const result = parser.parse(text);
      expect(result.commands).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });

  // ========== 3. HTML 注释包裹格式（标准） ==========

  describe('HTML comment-wrapped format (standard)', () => {
    it('parses single insertRow in HTML comment block', () => {
      const text = [
        '朱迪加入了小镇。',
        '<!--  <tableEdit>',
        'insertRow(1, {"2":"zhudi_001","3":"朱迪","4":"警官"})',
        '</tableEdit> -->'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(1);
      const cmd = result.commands[0];
      expect(cmd.type).toBe(GameTableEditCommandType.INSERT_ROW);
      expect(cmd.sheetIndex).toBe(1);
      expect(cmd.rowData).toEqual({
        '2': 'zhudi_001',
        '3': '朱迪',
        '4': '警官'
      });
      expect(cmd.raw).toContain('insertRow');
    });

    it('parses single updateRow in HTML comment block', () => {
      const text = [
        '朱迪升职了。',
        '<!--  <tableEdit>',
        'updateRow(1, 2, {"4":"警长"})',
        '</tableEdit> -->'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(1);
      const cmd = result.commands[0];
      expect(cmd.type).toBe(GameTableEditCommandType.UPDATE_ROW);
      expect(cmd.sheetIndex).toBe(1);
      expect(cmd.rowIndex).toBe(2);
      expect(cmd.rowData).toEqual({ '4': '警长' });
    });

    it('parses single deleteRow in HTML comment block', () => {
      const text = [
        '老张离开了小镇。',
        '<!--  <tableEdit>',
        'deleteRow(1, 3)',
        '</tableEdit> -->'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(1);
      const cmd = result.commands[0];
      expect(cmd.type).toBe(GameTableEditCommandType.DELETE_ROW);
      expect(cmd.sheetIndex).toBe(1);
      expect(cmd.rowIndex).toBe(3);
      expect(cmd.rowData).toBeUndefined();
    });

    it('tolerates extra whitespace in HTML comment wrapper', () => {
      const text = [
        '叙事文本。',
        '<!--    <tableEdit>   ',
        'insertRow(2, {"2":"item_001","3":"徽章"})',
        '   </tableEdit>    -->'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].sheetIndex).toBe(2);
    });
  });

  // ========== 4. 无 HTML 注释包裹格式（容错） ==========

  describe('Bare tag format (fallback)', () => {
    it('parses commands from bare <tableEdit> tag without HTML comment', () => {
      const text = [
        '叙事文本。',
        '<tableEdit>',
        'insertRow(1, {"2":"zhudi_001","3":"朱迪"})',
        '</tableEdit>'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].type).toBe(GameTableEditCommandType.INSERT_ROW);
      expect(result.commands[0].sheetIndex).toBe(1);
    });

    it('does not double-count when both formats present', () => {
      // 同时存在注释包裹和裸标签时，应分别提取但不应重复
      const text = [
        '<!--  <tableEdit>',
        'insertRow(1, {"2":"a_001","3":"A"})',
        '</tableEdit> -->',
        '<tableEdit>',
        'insertRow(1, {"2":"b_001","3":"B"})',
        '</tableEdit>'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(2);
      expect(result.commands[0].rowData!['3']).toBe('A');
      expect(result.commands[1].rowData!['3']).toBe('B');
    });
  });

  // ========== 5. 单命令各类型 ==========

  describe('Single command types', () => {
    it('parses insertRow with multiple fields', () => {
      const text = '<!--  <tableEdit>\ninsertRow(2, {"2":"nick_001","3":"尼克","4":"狐警","5":"搭档"})\n</tableEdit> -->';
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(1);
      const cmd = result.commands[0];
      expect(cmd.type).toBe(GameTableEditCommandType.INSERT_ROW);
      expect(cmd.sheetIndex).toBe(2);
      expect(cmd.rowData).toEqual({
        '2': 'nick_001',
        '3': '尼克',
        '4': '狐警',
        '5': '搭档'
      });
    });

    it('parses updateRow with multiple field updates', () => {
      const text = '<!--  <tableEdit>\nupdateRow(3, 5, {"4":"已完成","6":"奖励已发放"})\n</tableEdit> -->';
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(1);
      const cmd = result.commands[0];
      expect(cmd.type).toBe(GameTableEditCommandType.UPDATE_ROW);
      expect(cmd.sheetIndex).toBe(3);
      expect(cmd.rowIndex).toBe(5);
      expect(cmd.rowData).toEqual({
        '4': '已完成',
        '6': '奖励已发放'
      });
    });

    it('parses deleteRow', () => {
      const text = '<!--  <tableEdit>\ndeleteRow(2, 7)\n</tableEdit> -->';
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(1);
      const cmd = result.commands[0];
      expect(cmd.type).toBe(GameTableEditCommandType.DELETE_ROW);
      expect(cmd.sheetIndex).toBe(2);
      expect(cmd.rowIndex).toBe(7);
      expect(cmd.rowData).toBeUndefined();
    });
  });

  // ========== 6. 多命令混合 ==========

  describe('Multiple commands mixed', () => {
    it('parses mix of insert/update/delete in single block', () => {
      const text = [
        '叙事文本...',
        '<!--  <tableEdit>',
        'insertRow(1, {"2":"zhudi_001","3":"朱迪","4":"警官"})',
        'updateRow(1, 2, {"4":"警长"})',
        'deleteRow(1, 3)',
        'insertRow(2, {"2":"badge_001","3":"警官徽章"})',
        '</tableEdit> -->'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(4);
      expect(result.commands[0].type).toBe(GameTableEditCommandType.INSERT_ROW);
      expect(result.commands[1].type).toBe(GameTableEditCommandType.UPDATE_ROW);
      expect(result.commands[2].type).toBe(GameTableEditCommandType.DELETE_ROW);
      expect(result.commands[3].type).toBe(GameTableEditCommandType.INSERT_ROW);

      // sheetIndex 保持 1-based
      expect(result.commands[3].sheetIndex).toBe(2);
    });

    it('parses commands from multiple separate tableEdit blocks', () => {
      const text = [
        '<!--  <tableEdit>',
        'insertRow(1, {"2":"a","3":"A"})',
        '</tableEdit> -->',
        '叙事文本中间。',
        '<!--  <tableEdit>',
        'deleteRow(1, 1)',
        '</tableEdit> -->'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(2);
      expect(result.commands[0].type).toBe(GameTableEditCommandType.INSERT_ROW);
      expect(result.commands[1].type).toBe(GameTableEditCommandType.DELETE_ROW);
    });
  });

  // ========== 7. 格式错误容错 ==========

  describe('Format error tolerance', () => {
    it('records unrecognized lines as errors without throwing', () => {
      const text = [
        '<!--  <tableEdit>',
        '这是一行普通文本，不是命令',
        'insertRow(1, {"2":"a","3":"A"})',
        'another invalid line',
        '</tableEdit> -->'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(1);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain('无法解析的命令行');
    });

    it('skips insertRow with string sheetIndex (quoted)', () => {
      const text = [
        '<!--  <tableEdit>',
        'insertRow("1", {"2":"a","3":"A"})',
        '</tableEdit> -->'
      ].join('\n');
      const result = parser.parse(text);

      // 字符串索引不符合 \d+ 正则，记入 errors
      expect(result.commands).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('skips updateRow with invalid JSON data', () => {
      const text = [
        '<!--  <tableEdit>',
        'updateRow(1, 2, {invalid json})',
        '</tableEdit> -->'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('skips insertRow with missing data argument', () => {
      const text = [
        '<!--  <tableEdit>',
        'insertRow(1)',
        '</tableEdit> -->'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(0);
    });

    it('skips deleteRow with missing rowIndex', () => {
      const text = [
        '<!--  <tableEdit>',
        'deleteRow(1)',
        '</tableEdit> -->'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(0);
    });

    it('skips commands with zero sheetIndex (1-based minimum)', () => {
      const text = [
        '<!--  <tableEdit>',
        'insertRow(0, {"2":"a"})',
        '</tableEdit> -->'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(0);
    });

    it('continues parsing after encountering invalid command', () => {
      const text = [
        '<!--  <tableEdit>',
        'invalid line',
        'insertRow(1, {"2":"a","3":"A"})',
        'another bad line',
        'deleteRow(2, 1)',
        '</tableEdit> -->'
      ].join('\n');
      const result = parser.parse(text);

      // 即使中间有错误行，前后合法命令仍被解析
      expect(result.commands).toHaveLength(2);
      expect(result.errors).toHaveLength(2);
    });
  });

  // ========== 8. JSON 容错 ==========

  describe('JSON data tolerance', () => {
    it('strips nested HTML comments in JSON values', () => {
      const text = [
        '<!--  <tableEdit>',
        'insertRow(1, {"2":"zhudi<!-- 药 -->","3":"朱迪"})',
        '</tableEdit> -->'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].rowData!['2']).toBe('zhudi');
      expect(result.commands[0].rowData!['3']).toBe('朱迪');
    });

    it('normalizes single-quoted strings to double-quoted', () => {
      const text = [
        '<tableEdit>',
        "insertRow(1, {'2':'nick_001','3':'尼克'})",
        '</tableEdit>'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].rowData!['2']).toBe('nick_001');
      expect(result.commands[0].rowData!['3']).toBe('尼克');
    });

    it('normalizes unquoted keys', () => {
      const text = [
        '<tableEdit>',
        'insertRow(1, {2:"nick_001",3:"尼克"})',
        '</tableEdit>'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].rowData!['2']).toBe('nick_001');
      expect(result.commands[0].rowData!['3']).toBe('尼克');
    });

    it('tolerates trailing comma in JSON object', () => {
      const text = [
        '<tableEdit>',
        'insertRow(1, {"2":"a","3":"A",})',
        '</tableEdit>'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].rowData!['2']).toBe('a');
    });

    it('converts numeric values to string', () => {
      const text = [
        '<tableEdit>',
        'insertRow(1, {"2":100,"3":"金币"})',
        '</tableEdit>'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].rowData!['2']).toBe('100');
    });

    it('handles special characters in values (quotes, newlines)', () => {
      const text = [
        '<tableEdit>',
        'insertRow(1, {"2":"a\\"b","3":"line1\\nline2"})',
        '</tableEdit>'
      ].join('\n');
      const result = parser.parse(text);

      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].rowData!['2']).toBe('a"b');
      expect(result.commands[0].rowData!['3']).toBe('line1\nline2');
    });
  });

  // ========== 9. stripTableEditTags ==========

  describe('stripTableEditTags', () => {
    it('returns empty string for empty input', () => {
      expect(parser.stripTableEditTags('')).toBe('');
      // @ts-expect-error 测试容错
      expect(parser.stripTableEditTags(null)).toBe('');
    });

    it('returns text unchanged when no tableEdit tag', () => {
      const text = '朱迪走进了小镇。';
      expect(parser.stripTableEditTags(text)).toBe('朱迪走进了小镇。');
    });

    it('strips HTML comment-wrapped tableEdit block', () => {
      const text = [
        '朱迪走进了小镇。',
        '<!--  <tableEdit>',
        'insertRow(1, {"2":"a"})',
        '</tableEdit> -->'
      ].join('\n');
      const stripped = parser.stripTableEditTags(text);
      expect(stripped).toBe('朱迪走进了小镇。');
    });

    it('strips bare tableEdit block', () => {
      const text = [
        '朱迪走进了小镇。',
        '<tableEdit>',
        'insertRow(1, {"2":"a"})',
        '</tableEdit>'
      ].join('\n');
      const stripped = parser.stripTableEditTags(text);
      expect(stripped).toBe('朱迪走进了小镇。');
    });

    it('strips multiple tableEdit blocks', () => {
      const text = [
        '段落一。',
        '<!--  <tableEdit>',
        'insertRow(1, {"2":"a"})',
        '</tableEdit> -->',
        '段落二。',
        '<tableEdit>',
        'deleteRow(1, 1)',
        '</tableEdit>'
      ].join('\n');
      const stripped = parser.stripTableEditTags(text);
      expect(stripped).toContain('段落一');
      expect(stripped).toContain('段落二');
      expect(stripped).not.toContain('tableEdit');
      expect(stripped).not.toContain('insertRow');
    });

    it('collapses excessive blank lines after stripping', () => {
      const text = [
        '段落一。',
        '',
        '',
        '',
        '<!--  <tableEdit>',
        'insertRow(1, {"2":"a"})',
        '</tableEdit> -->',
        '',
        '',
        '',
        '段落二。'
      ].join('\n');
      const stripped = parser.stripTableEditTags(text);

      // 多余的空行被压缩为最多 2 个换行（1 个空行）
      expect(stripped).not.toMatch(/\n{3,}/);
    });

    it('preserves narrative text containing "tableEdit" as content (not tag)', () => {
      // 极端边界：叙事文本中提到了 tableEdit 字符串，但未形成完整标签
      const text = 'AI 提到了 tableEdit 协议，但没有生成标签。';
      const stripped = parser.stripTableEditTags(text);
      // 完整文本应被保留（因为不形成完整 <tableEdit>...</tableEdit> 标签）
      expect(stripped).toContain('tableEdit');
    });
  });
});
