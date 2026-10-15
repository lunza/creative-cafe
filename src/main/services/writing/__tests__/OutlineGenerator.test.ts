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

  it('章节内结构化行（关键情节点/出场人物/场景）提取到对应字段，不进散文摘要（2026-10-08 漫画导入字段为空修复）', () => {
    const md = [
      '# 《爱之岛》故事大纲',
      '',
      '## 第一章：初抵海岛的元气邂逅（第1页）',
      '',
      '关键情节点：莫妮卡抵达爱之岛；岛主邀请参观；莫妮卡毫无戒备答应',
      '出场人物：莫妮卡、岛主',
      '场景：海滩、码头',
      '',
      '莫妮卡穿着泳装裙抵达爱之岛，与自称经理的岛主相遇。',
      '',
      '## 第二章：最受欢迎的“景点”（第2页）',
      '',
      '关键情节点：莫妮卡被带到卧室；真相揭露',
      '出场人物：莫妮卡、岛主',
      '场景：卧室',
      '',
      '场景转到岛主住所的卧室。',
    ].join('\n');

    const outline = generator.parseOutlineResponse(md);
    expect(outline.chapters).toHaveLength(2);
    const ch1 = outline.chapters[0];
    expect(ch1.keyPlotPoints).toEqual([
      '莫妮卡抵达爱之岛',
      '岛主邀请参观',
      '莫妮卡毫无戒备答应',
    ]);
    expect(ch1.characters).toEqual(['莫妮卡', '岛主']);
    expect(ch1.scenes).toEqual(['海滩', '码头']);
    // 结构化行不进散文摘要
    expect(ch1.summary).toBe('莫妮卡穿着泳装裙抵达爱之岛，与自称经理的岛主相遇。');
    expect(ch1.summary).not.toContain('关键情节点');
    expect(outline.chapters[1].scenes).toEqual(['卧室']);
  });

  it('无结构化行的旧版大纲：字段为空数组（向后兼容，不回归）', () => {
    const md = [
      '# 旧版大纲',
      '',
      '## 第一章：开端',
      '',
      '纯散文摘要，没有结构化行。',
    ].join('\n');

    const outline = generator.parseOutlineResponse(md);
    expect(outline.chapters).toHaveLength(1);
    expect(outline.chapters[0].keyPlotPoints).toEqual([]);
    expect(outline.chapters[0].characters).toEqual([]);
    expect(outline.chapters[0].scenes).toEqual([]);
    expect(outline.chapters[0].summary).toContain('纯散文摘要');
  });

  it('结构化行兼容全角冒号与加粗包裹（AI 输出格式漂移容忍）', () => {
    const md = [
      '# 测试',
      '',
      '## 第一章：开端',
      '',
      '**关键情节点：** 情节A；情节B',
      '出场人物: 甲，乙、丙',
      '',
      '正文。',
    ].join('\n');

    const outline = generator.parseOutlineResponse(md);
    expect(outline.chapters[0].keyPlotPoints).toEqual(['情节A', '情节B']);
    // 半角冒号 + 混用逗号/顿号分隔
    expect(outline.chapters[0].characters).toEqual(['甲', '乙', '丙']);
    expect(outline.chapters[0].summary).toBe('正文。');
  });

  it('结构化行带 Markdown 列表项前缀（- 关键情节点：…，实测 local-llm 真实输出格式）', () => {
    const md = [
      '# 《欢迎来到爱之岛》',
      '',
      '## 第一章：海滩相遇（第1页）',
      '',
      '- 关键情节点：莫妮卡站在爱之岛海岸沙滩上感叹海岛美景；岛主从身后搭肩出现并热情问好；岛主邀请莫妮卡赏脸参观本岛',
      '- 出场人物：莫妮卡、岛主',
      '- 场景：爱之岛的海岸沙滩',
      '',
      '莫妮卡是一只狼兽娘，尖立的狼耳和突出的口鼻部是她最醒目的地方。',
    ].join('\n');

    const outline = generator.parseOutlineResponse(md);
    const ch = outline.chapters[0];
    expect(ch.keyPlotPoints).toEqual([
      '莫妮卡站在爱之岛海岸沙滩上感叹海岛美景',
      '岛主从身后搭肩出现并热情问好',
      '岛主邀请莫妮卡赏脸参观本岛',
    ]);
    expect(ch.characters).toEqual(['莫妮卡', '岛主']);
    expect(ch.scenes).toEqual(['爱之岛的海岸沙滩']);
    // 列表结构化行不进散文摘要
    expect(ch.summary).toBe('莫妮卡是一只狼兽娘，尖立的狼耳和突出的口鼻部是她最醒目的地方。');
  });
});
