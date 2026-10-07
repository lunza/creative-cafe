import { describe, it, expect } from 'vitest';
import { OutlineGenerator } from '../OutlineGenerator';

/**
 * parseOutlineResponse 的 Markdown 兜底解析测试
 *
 * 背景：漫画解析模式的「生成故事大纲」产出 Markdown 大纲（非 V2 管线的 JSON），
 * 导入写作编辑器时曾全部 JSON 修复策略失败报「大纲解析失败」。
 */
describe('OutlineGenerator.parseOutlineResponse - Markdown 兜底解析', () => {
  const generator = new OutlineGenerator();

  it('标准 Markdown 大纲：# 作品名 + ## 章节 → 解析出标题与章节', () => {
    const md = [
      '# 《欢迎来到爱之岛》完整故事大纲',
      '',
      '这是一部关于离岛恋爱的故事。',
      '',
      '## 第一章：初到爱之岛',
      '',
      '主角登岛，邂逅女主角。',
      '',
      '## 第二章：暗流涌动',
      '',
      '岛上出现神秘组织。',
    ].join('\n');

    const outline = generator.parseOutlineResponse(md);
    expect(outline.workInfo.suggestedTitle).toBe('《欢迎来到爱之岛》完整故事大纲');
    expect(outline.chapters).toHaveLength(2);
    expect(outline.chapters[0].title).toBe('第一章：初到爱之岛');
    expect(outline.chapters[0].summary).toContain('主角登岛');
    expect(outline.chapters[1].index).toBe(2);
    // 前言进入 storyLine.coreConflict
    expect(outline.storyLine.coreConflict).toContain('离岛恋爱');
  });

  it('「第X章」样式独立行（非 Markdown 标题）也能识别为章节', () => {
    const md = [
      '作品简介：一段奇幻旅程。',
      '',
      '第1章 启程',
      '少年离开家乡。',
      '',
      '**第2章：试炼**',
      '少年遇到导师。',
    ].join('\n');

    const outline = generator.parseOutlineResponse(md);
    expect(outline.chapters).toHaveLength(2);
    expect(outline.chapters[0].title).toBe('第1章 启程');
    expect(outline.chapters[1].title).toBe('第2章：试炼');
    expect(outline.workInfo.suggestedTitle).toBeTruthy();
  });

  it('JSON 大纲仍然走 JSON 路径（兜底不影响既有格式）', () => {
    const json = JSON.stringify({
      workInfo: { suggestedTitle: '测试作品', novelType: 'web_novel', estimatedWordCount: 10000, chapterCount: 1 },
      storyLine: { coreConflict: '冲突', storyArc: { beginning: '', development: '', climax: '', resolution: '' }, theme: '主题' },
      chapters: [{ index: 1, title: '第一章', summary: '摘要' }],
    });

    const outline = generator.parseOutlineResponse(json);
    expect(outline.workInfo.suggestedTitle).toBe('测试作品');
    expect(outline.chapters).toHaveLength(1);
  });

  it('既非 JSON 也无章节结构的纯文本 → 抛出原错误', () => {
    expect(() => generator.parseOutlineResponse('这是一段没有任何结构的普通文字。\n第二行。')).toThrow();
  });

  it('元信息小节（背景/角色档案）不误判为章节（修复 33 章节问题）', () => {
    const md = [
      '# 《测试作品》故事大纲',
      '',
      '## 一、故事背景',
      '',
      '故事发生在遥远的爱之岛。',
      '',
      '## 二、主要角色',
      '',
      '### 林晓',
      '',
      '温柔的女主角。',
      '',
      '### 阿海',
      '',
      '男主角，性格直爽。',
      '',
      '## 三、剧情发展',
      '',
      '### 第一章：初遇（第1页）',
      '',
      '两人登岛相遇。',
      '',
      '### 第二章：危机（第2页）',
      '',
      '风暴来临，两人被困山洞。',
    ].join('\n');

    const outline = generator.parseOutlineResponse(md);
    // 只有两个「第X章」是章节，背景/角色/剧情框架小节与角色名都不算
    expect(outline.chapters).toHaveLength(2);
    expect(outline.chapters[0].title).toBe('第一章：初遇（第1页）');
    expect(outline.chapters[1].title).toBe('第二章：危机（第2页）');
    expect(outline.workInfo.suggestedTitle).toBe('《测试作品》故事大纲');
    // 元信息不丢失：背景与角色信息合并进故事主线说明
    expect(outline.storyLine.coreConflict).toContain('爱之岛');
    expect(outline.storyLine.coreConflict).toContain('林晓');
    // 章节数同步到 workInfo
    expect(outline.workInfo.chapterCount).toBe(2);
  });

  it('含元信息关键词的章节（第二章：背景揭露）仍识别为章节', () => {
    const md = [
      '# 测试',
      '',
      '## 第一章：开端',
      '',
      '开篇剧情。',
      '',
      '## 第二章：背景揭露',
      '',
      '主角发现岛屿的秘密。',
    ].join('\n');

    const outline = generator.parseOutlineResponse(md);
    expect(outline.chapters).toHaveLength(2);
    expect(outline.chapters[1].title).toBe('第二章：背景揭露');
    expect(outline.chapters[1].summary).toContain('岛屿的秘密');
  });
});
