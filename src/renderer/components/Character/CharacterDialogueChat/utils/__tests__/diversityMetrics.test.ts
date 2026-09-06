/**
 * diversityMetrics 单元测试
 *
 * Spec: reduce-dialogue-ai-flavor-and-repetition / Phase 1 / Task 1.2
 * 覆盖：5 项指标的边界（空输入 / 单条 / 全相同 / 全不同）与典型场景。
 */

import { describe, it, expect } from 'vitest';
import {
  openingRepetitionRate,
  distinct3,
  structuralTemplateRate,
  crossTurnJaccard,
  actionPhraseConcentration,
  computeDiversityReport,
  formatDiversityReport,
  extractActionPhrases,
} from '../diversityMetrics';

// 典型"三板斧"模板回复（动作开场 + 对话 + 动作）
const T1 = `*微微一笑* "今天天气不错呢。" *她望向窗外*`;
const T2 = `*微微一笑* "要一起喝茶吗？" *她端起茶杯*`;
const T3 = `*轻轻叹气* "我有点累了。" *她揉了揉太阳穴*`;

describe('openingRepetitionRate', () => {
  it('空输入 / 单条输入返回 0', () => {
    expect(openingRepetitionRate([])).toBe(0);
    expect(openingRepetitionRate([T1])).toBe(0);
  });

  it('开头 4 字符重复（剥离星号后）被检出', () => {
    // T1/T2 剥离星号后开头均为 "微微一笑…"，T3 为 "轻轻叹气…"
    const rate = openingRepetitionRate([T1, T2, T3]);
    expect(rate).toBeCloseTo(0.5); // 1/2 可比较对
  });

  it('开头互不相同返回 0', () => {
    const a = '*低头* "嗯。"';
    const b = '*抬头* "好。"';
    const c = '*转身* "再见。"';
    expect(openingRepetitionRate([a, b, c])).toBe(0);
  });

  it('全部相同返回 1', () => {
    const a = '*微微一笑* "嗨。"';
    expect(openingRepetitionRate([a, a, a])).toBe(1);
  });
});

describe('distinct3', () => {
  it('空输入返回 0', () => {
    expect(distinct3([])).toBe(0);
  });

  it('重复文本低于多样性文本', () => {
    const repetitive = ['啊啊啊啊啊啊', '啊啊啊啊啊啊'];
    const diverse = ['今天的雨下得很大', '窗外的猫跳上了屋顶'];
    expect(distinct3(repetitive)).toBeLessThan(distinct3(diverse));
  });

  it('拼接重复回复会引入边界 n-gram，比例低于单条', () => {
    const t = '这是一段用于测试的文本';
    // join 两条相同文本在接缝处产生新的 3-gram，总数翻倍而唯一数增加有限
    expect(distinct3([t, t])).toBeLessThan(distinct3([t]));
  });
});

describe('structuralTemplateRate', () => {
  it('空输入返回 0', () => {
    expect(structuralTemplateRate([])).toBe(0);
  });

  it('三板斧模板被识别，纯对话不识别', () => {
    const plain = '“我今天就先到这里吧。”';
    expect(structuralTemplateRate([T1, T2, plain])).toBeCloseTo(2 / 3);
  });

  it('动作开场但无对话不识别', () => {
    const noDialogue = '*她站起来走向门口，头也不回地离开了房间*';
    expect(structuralTemplateRate([noDialogue])).toBe(0);
  });
});

describe('crossTurnJaccard', () => {
  it('少于 2 条返回 0', () => {
    expect(crossTurnJaccard([T1])).toBe(0);
    expect(crossTurnJaccard([])).toBe(0);
  });

  it('相同相邻回复相似度接近 1，不同回复更低', () => {
    const same = crossTurnJaccard(['*微笑* "你好"', '*微笑* "你好"']);
    const diff = crossTurnJaccard(['*微笑* "你好"', '*叹气* "我走了，别送"']);
    expect(same).toBeGreaterThan(diff);
    expect(same).toBeGreaterThan(0.8);
  });
});

describe('actionPhraseConcentration', () => {
  it('无动作短语返回 0', () => {
    expect(actionPhraseConcentration(['纯对话回复而已'])).toBe(0);
  });

  it('重复短语抬高集中度（样本需超过 top-5 窗口才有区分度）', () => {
    // concentrated：12 个短语中"微微一笑"重复 6 次 → top5 占比 10/12
    const concentrated = [
      '*微微一笑* "一"', '*微微一笑* "二"', '*微微一笑* "三"',
      '*微微一笑* "四"', '*微微一笑* "五"', '*微微一笑* "六"',
      '*点头* "七"', '*摇头* "八"', '*叹气* "九"',
      '*挥手* "十"', '*皱眉* "十一"', '*耸肩* "十二"',
    ];
    // spread：12 个互不相同的短语 → top5 占比 5/12
    const spread = [
      '*微笑* "一"', '*点头* "二"', '*摇头* "三"', '*叹气* "四"',
      '*挥手* "五"', '*皱眉* "六"', '*耸肩* "七"', '*眨眼* "八"',
      '*挑眉* "九"', '*低头* "十"', '*抬头* "十一"', '*转身* "十二"',
    ];
    expect(actionPhraseConcentration(concentrated)).toBeGreaterThan(
      actionPhraseConcentration(spread)
    );
  });

  it('全部相同短语返回 1', () => {
    expect(actionPhraseConcentration(['*微笑* a', '*微笑* b', '*微笑* c'])).toBeCloseTo(1);
  });
});

describe('extractActionPhrases', () => {
  it('提取星号包裹内容并小写化', () => {
    expect(extractActionPhrases('*微微一笑* "话" *She Smiles*')).toEqual(['微微一笑', 'she smiles']);
  });

  it('单星号与跨行星号不提取', () => {
    expect(extractActionPhrases('*单星号')).toEqual([]);
    expect(extractActionPhrases('*跨行\n动作*')).toEqual([]);
  });
});

describe('computeDiversityReport', () => {
  it('窗口截取末尾 N 条并过滤空串', () => {
    const replies = ['*a* "一"', '*b* "二"', '*c* "三"', '', '   '];
    const report = computeDiversityReport(replies, 10);
    expect(report.sampleSize).toBe(3);
  });

  it('window 参数生效', () => {
    const replies = [T1, T2, T3];
    const report = computeDiversityReport(replies, 2);
    expect(report.sampleSize).toBe(2);
  });

  it('聚合报告字段完整且在 0-1 范围', () => {
    const report = computeDiversityReport([T1, T2, T3]);
    for (const v of [
      report.openingRepetition,
      report.distinct3,
      report.structuralTemplate,
      report.crossTurnJaccard,
      report.actionConcentration,
    ]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('模板化样本的结构模板率高于多样化样本', () => {
    const templated = computeDiversityReport([T1, T2, T3]);
    const varied = computeDiversityReport([
      '“直接从对话开始。”她说。',
      '窗外的雨声渐渐大了。*她合上书*',
      '沉默持续了很久，久到茶都凉了。',
    ]);
    expect(templated.structuralTemplate).toBeGreaterThan(varied.structuralTemplate);
  });
});

describe('formatDiversityReport', () => {
  it('输出包含全部指标键的单行文本', () => {
    const line = formatDiversityReport(computeDiversityReport([T1, T2, T3]));
    expect(line).toContain('sample=3');
    expect(line).toContain('openingRep=');
    expect(line).toContain('distinct3=');
    expect(line).toContain('template=');
    expect(line).toContain('crossJaccard=');
    expect(line).toContain('actionConc=');
    expect(line).not.toContain('\n');
  });
});
