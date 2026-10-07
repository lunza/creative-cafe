/**
 * v2ExportContent 单元测试
 *
 * 覆盖：
 * - TXT / Markdown 文本结构（标题、章节头、分隔符）
 * - JSON 导出的稳定契约（字段齐全、章节顺序、字数回退、内容 trim、可被 JSON.parse）
 * - 空内容章节的兜底行为
 */
import { describe, it, expect } from 'vitest';
import { ExportFormat } from '../../types/writing.types';
import type { WritingProject, ChapterOutline } from '../../types/writing.types';
import { buildExportContent } from '../v2ExportContent';

function makeChapter(partial: Partial<ChapterOutline> & { index: number; title: string }): ChapterOutline {
  return {
    summary: '',
    keyPlotPoints: [],
    characters: [],
    scenes: [],
    targetWordCount: 1000,
    ...partial,
  };
}

function makeProject(title = '测试作品'): WritingProject {
  return {
    id: 'p1',
    title,
    createdAt: 0,
    updatedAt: 0,
    outline: {
      workInfo: { suggestedTitle: title },
      storyLine: { summary: '' },
      chapters: [
        makeChapter({ index: 0, title: '第一章', content: '  正文一  ' }),
        makeChapter({ index: 1, title: '第二章', content: '正文二', wordCount: 3 }),
        makeChapter({ index: 2, title: '第三章' }),
      ],
    },
  } as unknown as WritingProject;
}

const chaptersOf = (p: WritingProject) => p.outline!.chapters!;

describe('buildExportContent - TXT', () => {
  it('包含作品标题与全部章节标题', () => {
    const project = makeProject();
    const out = buildExportContent(project, chaptersOf(project), ExportFormat.TXT);
    expect(out).toContain('测试作品');
    expect(out).toContain('第一章');
    expect(out).toContain('第二章');
    expect(out).toContain('第三章');
  });

  it('章节间使用分隔线', () => {
    const project = makeProject();
    const out = buildExportContent(project, chaptersOf(project), ExportFormat.TXT);
    expect(out).toContain('─'.repeat(40));
  });

  it('内容做 trim 处理', () => {
    const project = makeProject();
    const out = buildExportContent(project, chaptersOf(project), ExportFormat.TXT);
    expect(out).toContain('正文一');
    expect(out).not.toContain('  正文一');
  });

  it('无内容章节导出为空正文（不报错）', () => {
    const project = makeProject();
    const out = buildExportContent(project, chaptersOf(project), ExportFormat.TXT);
    expect(out).toContain('第三章\n\n');
  });
});

describe('buildExportContent - Markdown', () => {
  it('使用 # 作品标题与 ## 章节标题', () => {
    const project = makeProject();
    const out = buildExportContent(project, chaptersOf(project), ExportFormat.MARKDOWN);
    expect(out.startsWith('# 测试作品')).toBe(true);
    expect(out).toContain('## 第一章');
    expect(out).toContain('## 第三章');
  });

  it('章节间使用 --- 分隔', () => {
    const project = makeProject();
    const out = buildExportContent(project, chaptersOf(project), ExportFormat.MARKDOWN);
    expect(out).toContain('\n\n---\n\n');
  });
});

describe('buildExportContent - JSON', () => {
  it('输出可被 JSON.parse 且契约字段齐全', () => {
    const project = makeProject();
    const out = buildExportContent(project, chaptersOf(project), ExportFormat.JSON);
    const parsed = JSON.parse(out);
    expect(parsed.title).toBe('测试作品');
    expect(parsed.format).toBe('json');
    expect(parsed.chapterCount).toBe(3);
    expect(Array.isArray(parsed.chapters)).toBe(true);
    expect(parsed.exportedAt).toBeTruthy();
    // exportedAt 是 ISO 时间戳
    expect(Number.isNaN(Date.parse(parsed.exportedAt))).toBe(false);
  });

  it('章节按传入顺序导出且 index/title 正确', () => {
    const project = makeProject();
    const parsed = JSON.parse(buildExportContent(project, chaptersOf(project), ExportFormat.JSON));
    expect(parsed.chapters.map((c: { index: number }) => c.index)).toEqual([0, 1, 2]);
    expect(parsed.chapters.map((c: { title: string }) => c.title)).toEqual(['第一章', '第二章', '第三章']);
  });

  it('wordCount 优先用已有值，缺失时回退 content.length', () => {
    const project = makeProject();
    const parsed = JSON.parse(buildExportContent(project, chaptersOf(project), ExportFormat.JSON));
    expect(parsed.chapters[0].wordCount).toBe(3); // '正文一'
    expect(parsed.chapters[1].wordCount).toBe(3); // 显式 wordCount
    expect(parsed.chapters[2].wordCount).toBe(0); // 无内容
  });

  it('内容做 trim 处理', () => {
    const project = makeProject();
    const parsed = JSON.parse(buildExportContent(project, chaptersOf(project), ExportFormat.JSON));
    expect(parsed.chapters[0].content).toBe('正文一');
  });

  it('仅导出传入的章节子集（章节多选语义）', () => {
    const project = makeProject();
    const chapters = chaptersOf(project);
    const parsed = JSON.parse(buildExportContent(project, [chapters[2]], ExportFormat.JSON));
    expect(parsed.chapterCount).toBe(1);
    expect(parsed.chapters[0].title).toBe('第三章');
  });

  it('空标题回退为"未命名作品"', () => {
    const project = makeProject('');
    const parsed = JSON.parse(buildExportContent(project, chaptersOf(project), ExportFormat.JSON));
    expect(parsed.title).toBe('未命名作品');
  });
});
