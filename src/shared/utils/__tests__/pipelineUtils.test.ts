/**
 * pipelineUtils 单元测试
 *
 * 覆盖：
 * - validatePipelineInit：合法参数 / 各非法组合（章节数、字数、角色卡、世界书、描述、模型配置）
 * - assertE2EResult：全过 / 单章字数不足 / 总字数不足 / 角色未注入 / 世界书未注入 / 章节数错 / 导出缺失
 * - verdictOf：汇总项不计入 verdict
 * - suggestedShardCount：边界值
 */
import { describe, it, expect } from 'vitest';
import type { PipelineInitParams } from '../../types/writing-v2.types';
import {
  validatePipelineInit,
  assertE2EResult,
  verdictOf,
  suggestedShardCount,
  type E2EAssertInput,
  type PipelineCandidateIds,
} from '../pipelineUtils';

function makeParams(partial: Partial<PipelineInitParams> = {}): PipelineInitParams {
  return {
    creativeDescription: '一个关于灵潮觉醒的故事',
    novelType: '玄幻',
    narrativePerspective: '第三人称',
    targetWordCount: 6000,
    chapterCount: 3,
    characterCardIds: ['/chars/a.png'],
    worldBookIds: ['/wb/w.json'],
    modelConfig: { model: 'test-model', temperature: 0.8, maxTokens: 4096 },
    ...partial,
  };
}

const CANDIDATES: PipelineCandidateIds = {
  characterIds: ['/chars/a.png', '/chars/b.png'],
  worldBookIds: ['/wb/w.json'],
};

describe('validatePipelineInit', () => {
  it('合法参数（无候选列表）通过', () => {
    const result = validatePipelineInit(makeParams());
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('合法参数（带候选列表，id 均存在）通过', () => {
    const params = makeParams({
      characterCardIds: ['/chars/a.png', '/chars/b.png'],
    });
    const result = validatePipelineInit(params, CANDIDATES);
    expect(result.ok).toBe(true);
  });

  it('章节数为 0 / 51 / 小数时分别报错', () => {
    for (const bad of [0, 51, 2.5]) {
      const result = validatePipelineInit(makeParams({ chapterCount: bad }));
      expect(result.ok).toBe(false);
      expect(result.errors).toContain('章节数必须是 1-50 的整数');
    }
  });

  it('目标字数越界（999 / 200001）报错', () => {
    for (const bad of [999, 200001]) {
      const result = validatePipelineInit(makeParams({ targetWordCount: bad }));
      expect(result.ok).toBe(false);
      expect(result.errors).toContain('目标字数必须在 1000-200000 之间');
    }
  });

  it('创意描述为空 / 纯空白报错', () => {
    for (const bad of ['', '   ']) {
      const result = validatePipelineInit(makeParams({ creativeDescription: bad }));
      expect(result.ok).toBe(false);
      expect(result.errors).toContain('创意描述不能为空');
    }
  });

  it('角色卡为空报错；无候选列表时跳过存在性校验', () => {
    const result = validatePipelineInit(makeParams({ characterCardIds: [] }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('至少需要绑定 1 个角色卡');

    const noCandidates = validatePipelineInit(
      makeParams({ characterCardIds: ['/not-exist.png'] }),
    );
    expect(noCandidates.ok).toBe(true);
  });

  it('角色卡 id 重复报错', () => {
    const result = validatePipelineInit(
      makeParams({ characterCardIds: ['/chars/a.png', '/chars/a.png'] }),
      CANDIDATES,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('角色卡 id 存在重复');
  });

  it('角色卡 id 不存在于候选列表报错', () => {
    const result = validatePipelineInit(
      makeParams({ characterCardIds: ['/chars/a.png', '/ghost.png'] }),
      CANDIDATES,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('角色卡 id 不存在于候选列表（1 个）');
  });

  it('世界书为空 / id 不存在分别报错', () => {
    const empty = validatePipelineInit(makeParams({ worldBookIds: [] }));
    expect(empty.ok).toBe(false);
    expect(empty.errors).toContain('至少需要绑定 1 本世界书');

    const missing = validatePipelineInit(
      makeParams({ worldBookIds: ['/ghost.json'] }),
      CANDIDATES,
    );
    expect(missing.ok).toBe(false);
    expect(missing.errors).toContain('世界书 id 不存在于候选列表（1 个）');
  });

  it('模型配置缺失 model 报错', () => {
    const result = validatePipelineInit(
      makeParams({ modelConfig: { model: '', temperature: 0.8, maxTokens: 4096 } }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('缺少有效的模型配置');
  });

  it('多个错误同时报告', () => {
    const result = validatePipelineInit(
      makeParams({
        creativeDescription: '',
        chapterCount: 99,
        characterCardIds: [],
        worldBookIds: [],
      }),
      CANDIDATES,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------- assertE2EResult ----------

/** 构造长度为 len 且包含 name 的文本 */
function textWith(len: number, name: string): string {
  if (len <= name.length) return name;
  return name + '字'.repeat(len - name.length);
}

function makeE2EInput(partial: {
  chapterLens?: number[];
  chapterTarget?: number;
  expectedChapterCount?: number;
  expectedTargetWordCount?: number;
  /** 被断言必须出现的角色名 */
  characterNames?: string[];
  /** 实际嵌入正文的角色名（默认与 characterNames 相同） */
  contentNames?: string[];
  worldbookKeywords?: string[];
  outlineText?: string;
  exportedFileExists?: boolean;
}): E2EAssertInput {
  const {
    chapterLens = [2000, 2000, 2000],
    chapterTarget = 2000,
    expectedChapterCount = 3,
    expectedTargetWordCount = 6000,
    characterNames = ['苏念', '沈夜'],
    contentNames = characterNames,
    worldbookKeywords = ['灵潮'],
    outlineText = '大纲：苏念在云澜大陆遭遇灵潮',
    exportedFileExists = true,
  } = partial;

  const name0 = contentNames[0] ?? '';
  const name1 = contentNames[1] ?? '';
  return {
    chapters: chapterLens.map((len, i) => ({
      index: i,
      title: `第${i + 1}章`,
      content:
        i === 0
          ? textWith(len, name0)
          : name1
            ? name0 + name1 + '字'.repeat(Math.max(0, len - name0.length - name1.length))
            : textWith(len, name0),
      targetWordCount: chapterTarget,
    })),
    expected: {
      chapterCount: expectedChapterCount,
      targetWordCount: expectedTargetWordCount,
      characterNames,
      worldbookKeywords,
      outlineText,
      exportedFileExists,
    },
  };
}

function findAssertion(assertions: { name: string; passed: boolean }[], name: string) {
  return assertions.find((a) => a.name === name);
}

describe('assertE2EResult', () => {
  it('全部通过', () => {
    const assertions = assertE2EResult(makeE2EInput({}));
    const names = assertions.map((a) => a.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'chapterCount',
        'chapter[0].wordCount',
        'chapter[1].wordCount',
        'chapter[2].wordCount',
        'allChapters.wordCount',
        'totalWordCount',
        'characterInjected:苏念',
        'characterInjected:沈夜',
        'worldbookInjected',
        'exportedFile',
      ]),
    );
    for (const a of assertions) {
      expect(a.passed, a.name).toBe(true);
    }
    expect(verdictOf(assertions)).toBe('PASS');
  });

  it('单章字数不足（< 章目标 50%）', () => {
    const assertions = assertE2EResult(
      makeE2EInput({ chapterLens: [800, 2000, 2000] }),
    );
    expect(findAssertion(assertions, 'chapter[0].wordCount')?.passed).toBe(false);
    expect(findAssertion(assertions, 'chapter[1].wordCount')?.passed).toBe(true);
    expect(findAssertion(assertions, 'allChapters.wordCount')?.passed).toBe(false);
    expect(verdictOf(assertions)).toBe('FAIL');
  });

  it('总字数不足（< 目标 80%）但单章达标', () => {
    // 每章目标 1000（下限 500），实际各 600 → 单章过，总字数 1800 < 3000×80%=2400
    const assertions = assertE2EResult(
      makeE2EInput({
        chapterLens: [600, 600, 600],
        chapterTarget: 1000,
        expectedTargetWordCount: 3000,
      }),
    );
    expect(findAssertion(assertions, 'chapter[0].wordCount')?.passed).toBe(true);
    expect(findAssertion(assertions, 'totalWordCount')?.passed).toBe(false);
    expect(verdictOf(assertions)).toBe('FAIL');
  });

  it('角色未注入（名称未出现在大纲与全文）', () => {
    // 大纲不含角色名，全文构造时以空角色名占位 → 名称不出现
    const assertions = assertE2EResult(
      makeE2EInput({
        characterNames: ['不在场角色甲', '不在场角色乙'],
        contentNames: ['苏念', '沈夜'],
        outlineText: '大纲：某故事',
      }),
    );
    expect(findAssertion(assertions, 'characterInjected:不在场角色甲')?.passed).toBe(false);
    expect(findAssertion(assertions, 'characterInjected:不在场角色乙')?.passed).toBe(false);
    expect(verdictOf(assertions)).toBe('FAIL');
  });

  it('世界书词条均未命中', () => {
    const assertions = assertE2EResult(
      makeE2EInput({
        worldbookKeywords: ['未出现词条X', '未出现词条Y'],
        outlineText: '大纲：某故事',
      }),
    );
    expect(findAssertion(assertions, 'worldbookInjected')?.passed).toBe(false);
    expect(verdictOf(assertions)).toBe('FAIL');
  });

  it('世界书词条在大纲中命中（全文无）也算注入', () => {
    const assertions = assertE2EResult(
      makeE2EInput({
        characterNames: [],
        worldbookKeywords: ['大纲专用词'],
        outlineText: '大纲：包含「大纲专用词」',
      }),
    );
    expect(findAssertion(assertions, 'worldbookInjected')?.passed).toBe(true);
    expect(verdictOf(assertions)).toBe('PASS');
  });

  it('章节数错误', () => {
    const assertions = assertE2EResult(
      makeE2EInput({
        chapterLens: [2000, 2000],
        expectedChapterCount: 3,
        expectedTargetWordCount: 4000,
      }),
    );
    expect(findAssertion(assertions, 'chapterCount')?.passed).toBe(false);
    expect(verdictOf(assertions)).toBe('FAIL');
  });

  it('导出文件缺失', () => {
    const assertions = assertE2EResult(makeE2EInput({ exportedFileExists: false }));
    expect(findAssertion(assertions, 'exportedFile')?.passed).toBe(false);
    expect(verdictOf(assertions)).toBe('FAIL');
  });

  it('章节为空时字数汇总断言失败', () => {
    const assertions = assertE2EResult(
      makeE2EInput({
        chapterLens: [],
        expectedChapterCount: 0,
        expectedTargetWordCount: 0,
        characterNames: [],
      }),
    );
    expect(findAssertion(assertions, 'allChapters.wordCount')?.passed).toBe(false);
    // 汇总项不计入 verdict；其余项（章节数 0=0、总字数 0>=0、世界书命中）
    expect(verdictOf(assertions)).toBe('PASS');
  });
});

describe('verdictOf', () => {
  it('仅汇总项失败时仍为 PASS', () => {
    const verdict = verdictOf([
      { name: 'chapterCount', passed: true, detail: '' },
      { name: 'allChapters.wordCount', passed: false, detail: '' },
      { name: 'totalWordCount', passed: true, detail: '' },
    ]);
    expect(verdict).toBe('PASS');
  });

  it('存在单项失败时 FAIL', () => {
    const verdict = verdictOf([
      { name: 'chapterCount', passed: true, detail: '' },
      { name: 'allChapters.wordCount', passed: false, detail: '' },
      { name: 'chapter[1].wordCount', passed: false, detail: '' },
    ]);
    expect(verdict).toBe('FAIL');
  });

  it('空数组视为 PASS', () => {
    expect(verdictOf([])).toBe('PASS');
  });
});

describe('suggestedShardCount', () => {
  it('边界值：负数/0 → 1', () => {
    expect(suggestedShardCount(-100)).toBe(1);
    expect(suggestedShardCount(0)).toBe(1);
  });

  it('≤2500 → 1 片', () => {
    expect(suggestedShardCount(1)).toBe(1);
    expect(suggestedShardCount(2500)).toBe(1);
  });

  it('中间值按比例取整', () => {
    expect(suggestedShardCount(2501)).toBe(2);
    expect(suggestedShardCount(5000)).toBe(2);
    expect(suggestedShardCount(5001)).toBe(3);
    expect(suggestedShardCount(6000)).toBe(3);
    expect(suggestedShardCount(12500)).toBe(5);
  });

  it('上限 5 片', () => {
    expect(suggestedShardCount(12501)).toBe(5);
    expect(suggestedShardCount(200000)).toBe(5);
  });
});
