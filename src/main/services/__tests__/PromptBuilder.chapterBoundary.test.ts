/**
 * 章节边界约束单元测试（2026-10-08 修复"AI生成本章写出全书"）
 *
 * 验证三类防线的提示词层面：
 * 1. buildShardOutlinePrompt / buildShardContentPrompt 必须携带「章节边界约束」
 *    （严禁规划/写其他章节剧情、悬念处收尾即止、分片总和=本章大纲）
 * 2. buildContentPrompt 的「所有章节概要」必须标注"仅参考，不是写作范围"
 * 3. 渲染层入口守卫 chapterOutlineMissing：无大纲时禁止发起生成
 */
import { describe, it, expect } from 'vitest';
import { promptBuilder } from '../writing/PromptBuilder';
import type { ShardOutline } from '../../../shared/types/writing.types';
import { chapterOutlineMissing } from '../../../renderer/components/Creative/WritingModeV2/writing/useV2ShardGeneration';

const CHAPTER_INFO = {
  index: 0,
  title: '第一章：初抵海岛的元气邂逅',
  outline: '莫妮卡抵达爱之岛，与自称经理的岛主相遇，对方邀请她参观本岛。',
  characters: ['莫妮卡', '岛主'],
  scenes: ['海滩', '码头'],
};

const SHARD_OUTLINE: ShardOutline = {
  index: 0,
  title: '分片1：抵达与相遇',
  summary: '莫妮卡乘船抵达爱之岛，与岛主初次对话。',
  targetWordCount: 1000,
};

describe('buildShardOutlinePrompt 章节边界约束', () => {
  it('携带当前章节标题与大纲', () => {
    const p = promptBuilder.buildShardOutlinePrompt(CHAPTER_INFO, 3, 3000);
    expect(p).toContain(CHAPTER_INFO.title);
    expect(p).toContain(CHAPTER_INFO.outline);
  });

  it('携带章节边界约束（严禁其他章节剧情 / 悬念收尾即止 / 分片总和=大纲）', () => {
    const p = promptBuilder.buildShardOutlinePrompt(CHAPTER_INFO, 3, 3000);
    expect(p).toContain('章节边界约束');
    expect(p).toContain('严禁规划其他章节');
    expect(p).toContain('留悬念完全合格');
    expect(p).toContain('所有分片的剧情总和 = 本章大纲');
  });

  it('大纲为空时仍携带边界约束（提示词层防线，入口守卫之外的兜底）', () => {
    const p = promptBuilder.buildShardOutlinePrompt(
      { ...CHAPTER_INFO, outline: '' },
      2,
      2000
    );
    expect(p).toContain('章节边界约束');
    expect(p).toContain('严禁规划其他章节');
  });

  it('分片数量与单片字数约束正确', () => {
    const p = promptBuilder.buildShardOutlinePrompt(CHAPTER_INFO, 3, 3000);
    expect(p).toContain('3 个分片');
    expect(p).toContain('约 1000 字');
  });
});

describe('buildShardContentPrompt 章节边界约束', () => {
  it('携带章节边界约束 + 当前章大纲 + 当前分片简介', () => {
    const p = promptBuilder.buildShardContentPrompt(
      SHARD_OUTLINE,
      0,
      3,
      '',
      CHAPTER_INFO,
      { targetWordCount: 1000, style: '轻快', perspective: '第三人称' }
    );
    expect(p).toContain('章节边界约束');
    expect(p).toContain('严禁写其他章节');
    expect(p).toContain(CHAPTER_INFO.outline);
    expect(p).toContain(SHARD_OUTLINE.summary);
  });

  it('前置分片内容标注为本章已写内容（叙事连贯用途）', () => {
    const p = promptBuilder.buildShardContentPrompt(
      SHARD_OUTLINE,
      1,
      3,
      '前置分片正文……',
      CHAPTER_INFO,
      { targetWordCount: 1000, style: '轻快', perspective: '第三人称' }
    );
    expect(p).toContain('前置分片完整内容');
    expect(p).toContain('本章已生成的前序分片');
  });

  it('不携带「所有章节概要」段（分片内容 prompt 不注入其他章节概要）', () => {
    const p = promptBuilder.buildShardContentPrompt(
      SHARD_OUTLINE,
      0,
      3,
      '',
      CHAPTER_INFO,
      { targetWordCount: 1000, style: '轻快', perspective: '第三人称' },
      { resourceContext: '', tableContext: '' }
    );
    expect(p).not.toContain('所有章节概要');
  });
});

describe('buildContentPrompt 所有章节概要标注', () => {
  it('传入 chapterSummaries 时标注"仅参考，不是写作范围"', () => {
    const p = promptBuilder.buildContentPrompt(
      CHAPTER_INFO,
      {
        resourceContext: '',
        recentChapters: '',
        chapterSummaries: '- 第2章 浴室潮吹: 莫妮卡发现岛上景点是男人。',
        longTermContext: '',
        continuityConstraints: '',
      },
      { targetWordCount: 3000, style: '轻快', perspective: '第三人称' }
    );
    expect(p).toContain('所有章节概要（仅参考，不是写作范围）');
    expect(p).toContain('严禁把它们的情节写进本次生成内容');
  });

  it('未传 chapterSummaries 时不出现该段落', () => {
    const p = promptBuilder.buildContentPrompt(
      CHAPTER_INFO,
      {
        resourceContext: '',
        recentChapters: '',
        chapterSummaries: '',
        longTermContext: '',
        continuityConstraints: '',
      },
      { targetWordCount: 3000, style: '轻快', perspective: '第三人称' }
    );
    expect(p).not.toContain('所有章节概要');
  });
});

describe('chapterOutlineMissing 章节范围识别守卫', () => {
  it('有大纲 → null（放行）', () => {
    expect(chapterOutlineMissing({ summary: ' 莫妮卡抵达爱之岛。 ' })).toBeNull();
  });

  it('空大纲（空串/纯空白/undefined）→ 报错', () => {
    for (const summary of ['', '   ', undefined]) {
      const err = chapterOutlineMissing({ summary });
      expect(err).toBeTruthy();
      expect(err).toContain('没有大纲');
    }
  });

  it('章节对象缺失 → 报错', () => {
    expect(chapterOutlineMissing(undefined)).toContain('当前章节不存在');
    expect(chapterOutlineMissing(null)).toContain('当前章节不存在');
  });
});
