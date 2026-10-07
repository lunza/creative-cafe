/**
 * v2TableUtils 单元测试
 *
 * 覆盖：
 * - mergeWritingTemplates：内置优先、custom 标记、同 id 去重
 * - validateWritingTemplate：各非法结构均被拦截，合法模板通过
 * - summarizeTableChanges：三类变更计数
 * - buildTableCsv：转义、BOM、额外键兜底
 */
import { describe, it, expect } from 'vitest';
import type { WritingTableTemplate } from '../../constants/writingTableTemplates';
import {
  mergeWritingTemplates,
  validateWritingTemplate,
  summarizeTableChanges,
  buildTableCsv,
  buildBookCheckMarkdown,
  type V2BookCheckResultItem,
} from '../v2TableUtils';

const builtin: WritingTableTemplate = {
  id: 'writing-default',
  name: '内置模板',
  description: '内置',
  sheets: [
    { name: '角色表', headers: ['姓名', '身份'], description: '角色', order: 0 },
  ],
};

const customOk: WritingTableTemplate = {
  id: 'custom-1',
  name: '自定义模板',
  description: '自定义',
  sheets: [
    { name: '事件表', headers: ['事件', '章节'], description: '事件', order: 0 },
  ],
};

describe('mergeWritingTemplates', () => {
  it('内置在前且标记 custom=false，自定义标记 custom=true', () => {
    const merged = mergeWritingTemplates([builtin], [customOk]);
    expect(merged.map((t) => t.id)).toEqual(['writing-default', 'custom-1']);
    expect(merged[0].custom).toBe(false);
    expect(merged[1].custom).toBe(true);
  });

  it('自定义与内置同 id 时忽略自定义（内置不可覆盖）', () => {
    const impostor: WritingTableTemplate = { ...customOk, id: 'writing-default' };
    const merged = mergeWritingTemplates([builtin], [impostor]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('内置模板');
    expect(merged[0].custom).toBe(false);
  });

  it('自定义内部同 id 去重（后者覆盖前者）', () => {
    const dup: WritingTableTemplate = { ...customOk, name: '自定义模板v2' };
    const merged = mergeWritingTemplates([], [customOk, dup]);
    const customItems = merged.filter((t) => t.id === 'custom-1');
    expect(customItems).toHaveLength(1);
    expect(customItems[0].name).toBe('自定义模板v2');
  });
});

describe('validateWritingTemplate', () => {
  it('合法模板通过', () => {
    expect(validateWritingTemplate(customOk)).toBeNull();
  });

  it('空名称/空描述/无表格被拦截', () => {
    expect(validateWritingTemplate({ ...customOk, name: '  ' })).not.toBeNull();
    expect(validateWritingTemplate({ ...customOk, description: '' })).not.toBeNull();
    expect(validateWritingTemplate({ ...customOk, sheets: [] })).not.toBeNull();
  });

  it('重复表名/重复列名/空列名/缺表描述被拦截', () => {
    const dupSheet: WritingTableTemplate = {
      ...customOk,
      sheets: [
        { name: '表', headers: ['a'], description: 'd', order: 0 },
        { name: '表', headers: ['b'], description: 'd', order: 1 },
      ],
    };
    expect(validateWritingTemplate(dupSheet)).toContain('重复');
    const dupHeader: WritingTableTemplate = {
      ...customOk,
      sheets: [{ name: '表', headers: ['a', 'a'], description: 'd', order: 0 }],
    };
    expect(validateWritingTemplate(dupHeader)).toContain('重复列');
    const emptyHeader: WritingTableTemplate = {
      ...customOk,
      sheets: [{ name: '表', headers: ['a', '  '], description: 'd', order: 0 }],
    };
    expect(validateWritingTemplate(emptyHeader)).toContain('空列名');
    const noDesc: WritingTableTemplate = {
      ...customOk,
      sheets: [{ name: '表', headers: ['a'], description: '', order: 0 }],
    };
    expect(validateWritingTemplate(noDesc)).toContain('描述');
  });
});

describe('summarizeTableChanges', () => {
  it('三类变更分别计数，缺失字段按 0 处理', () => {
    const s = summarizeTableChanges({
      addedRows: [1, 2, 3],
      modifiedCells: [{}, {}],
      deletedRows: [{}],
    });
    expect(s).toEqual({ added: 3, modified: 2, deleted: 1 });
    expect(summarizeTableChanges({} as never)).toEqual({ added: 0, modified: 0, deleted: 0 });
  });
});

describe('buildTableCsv', () => {
  it('表头 + 数据行，含 BOM', () => {
    const csv = buildTableCsv(['姓名', '身份'], [{ 姓名: '林一', 身份: '主角' }]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('姓名,身份');
    expect(lines[1]).toBe('林一,主角');
  });

  it('逗号/引号/换行正确转义', () => {
    const csv = buildTableCsv(['备注'], [{ 备注: 'a,b' }, { 备注: 'he said "hi"' }, { 备注: 'line1\nline2' }]);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1]).toBe('"a,b"');
    expect(lines[2]).toBe('"he said ""hi"""');
    expect(lines[3]).toBe('"line1\nline2"');
  });

  it('数据行额外键追加为列（模板外的用户自加列不丢）', () => {
    const csv = buildTableCsv(['姓名'], [{ 姓名: '林一', 备注: 'x' }]);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('姓名,备注');
    expect(lines[1]).toBe('林一,x');
  });

  it('空数据仅输出表头', () => {
    const csv = buildTableCsv(['a', 'b'], []);
    expect(csv.slice(1)).toBe('a,b');
  });
});

describe('buildBookCheckMarkdown（全书检查报告）', () => {
  const okItem: V2BookCheckResultItem = {
    chapterIndex: 0,
    title: '开端',
    report: {
      overallScore: 82,
      totalIssues: 2,
      highSeverityCount: 1,
      mediumSeverityCount: 1,
      lowSeverityCount: 0,
      dimensions: [
        {
          dimension: 'character_consistency',
          score: 70,
          maxScore: 100,
          issues: [
            {
              dimension: 'character_consistency',
              severity: 'high',
              title: '角色能力矛盾',
              description: '林一在第 2 章受伤但第 3 章行动如常',
              suggestion: '补充恢复情节',
            },
            {
              dimension: 'character_consistency',
              severity: 'medium',
              title: '称呼不一致',
              description: '有时称"队长"有时称"林队"',
              suggestion: '统一称呼',
            },
          ],
        },
      ],
    },
  };
  const failedItem: V2BookCheckResultItem = {
    chapterIndex: 1,
    title: '转折',
    error: 'AI 服务超时',
  };

  it('包含标题、汇总行与总览表', () => {
    const md = buildBookCheckMarkdown('测试作品', [okItem, failedItem]);
    expect(md).toContain('# 《测试作品》全书剧情检查报告');
    expect(md).toContain('检查 2 章');
    expect(md).toContain('平均 82 分');
    expect(md).toContain('共 2 个问题');
    expect(md).toContain('| 1. 开端 | 82 | 2 | 1 | 1 | 0 |');
    expect(md).toContain('| 2. 转折 | — | — | 检查失败 | | |');
  });

  it('章节明细含问题维度/严重度/描述/建议，失败章节标注原因', () => {
    const md = buildBookCheckMarkdown('测试作品', [okItem, failedItem]);
    expect(md).toContain('### 1. 开端（82 分）');
    expect(md).toContain('[高]');
    expect(md).toContain('角色能力矛盾');
    expect(md).toContain('- 建议：补充恢复情节');
    // 失败章节标题不带分数后缀
    expect(md).toContain('### 2. 转折');
    expect(md).not.toContain('### 2. 转折（');
    expect(md).toContain('检查失败：AI 服务超时');
  });

  it('无问题章节输出"未发现问题"；全部失败时汇总为无有效结果', () => {
    const clean: V2BookCheckResultItem = {
      chapterIndex: 0,
      title: '平静',
      report: {
        overallScore: 95,
        totalIssues: 0,
        highSeverityCount: 0,
        mediumSeverityCount: 0,
        lowSeverityCount: 0,
        dimensions: [],
      },
    };
    expect(buildBookCheckMarkdown('作品', [clean])).toContain('_未发现问题_');
    const onlyFailed = buildBookCheckMarkdown('作品', [{ chapterIndex: 0, title: '坏章', error: 'x' }]);
    expect(onlyFailed).toContain('无有效结果');
  });
});
