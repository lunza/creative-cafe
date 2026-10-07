/**
 * jsonRepair 单元测试
 *
 * 回归背景：本地 LLM（abliterated）输出分片大纲 JSON 时带未转义引号/换行/尾逗号，
 * 直接 JSON.parse 报 "Expected ',' or '}' after property value..."（2026-10-05 用户实测）。
 */
import { describe, it, expect } from 'vitest';
import {
  tryParseJsonWithRepair,
  fixChineseQuotes,
  fixUnescapedCharacters,
  fixCommonJsonIssues,
} from '../jsonRepair';

describe('tryParseJsonWithRepair', () => {
  it('干净 JSON 直接解析成功', () => {
    const input = '[{"index":0,"title":"分片1","summary":"内容","targetWordCount":1000}]';
    const parsed = tryParseJsonWithRepair(input);
    expect(parsed).not.toBeNull();
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].title).toBe('分片1');
  });

  it('修复字符串值内未转义的换行（本地 LLM 高频问题）', () => {
    const input = '[{"index":0,"title":"分片1","summary":"第一段\n第二段内容","targetWordCount":1000}]';
    const parsed = tryParseJsonWithRepair(input);
    expect(parsed).not.toBeNull();
    expect(parsed[0].summary).toContain('第一段');
    expect(parsed[0].summary).toContain('第二段内容');
  });

  it('修复字符串值内未转义的引号', () => {
    // 值内含未转义的中文语境引号场景：模型输出 "summary":"他说"你好"然后离开"
    const input = '[{"index":0,"title":"分片1","summary":"他说"你好"然后离开了房间","targetWordCount":1000}]';
    const parsed = tryParseJsonWithRepair(input);
    expect(parsed).not.toBeNull();
    expect(parsed[0].summary).toContain('你好');
  });

  it('修复尾逗号', () => {
    const input = '[{"index":0,"title":"分片1","summary":"内容","targetWordCount":1000,}]';
    const parsed = tryParseJsonWithRepair(input);
    expect(parsed).not.toBeNull();
    expect(parsed[0].title).toBe('分片1');
  });

  it('修复被截断的 JSON（补齐括号）', () => {
    const input = '[{"index":0,"title":"分片1","summary":"内容","targetWordCount":1000},{"index":1,"title":"分片2","summary":"内容被截断了';
    const parsed = tryParseJsonWithRepair(input);
    expect(parsed).not.toBeNull();
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0].title).toBe('分片1');
  });

  it('完全无法修复时返回 null', () => {
    const parsed = tryParseJsonWithRepair('这不是JSON，完全没有结构');
    expect(parsed).toBeNull();
  });
});

describe('fixChineseQuotes', () => {
  it('中文弯引号替换为直引号', () => {
    const result = fixChineseQuotes('“测试”');
    expect(result).toBe('"测试"');
  });
});

describe('fixUnescapedCharacters', () => {
  it('字符串内换行转义为 \\n', () => {
    const result = fixUnescapedCharacters('{"a":"line1\nline2"}');
    expect(JSON.parse(result)).toEqual({ a: 'line1\nline2' });
  });
});

describe('fixCommonJsonIssues', () => {
  it('裸 key 补引号 + 单引号值转双引号 + 尾逗号', () => {
    const result = fixCommonJsonIssues("{title: '值',}");
    expect(result).toBe('{"title":"值"}');
  });
});
