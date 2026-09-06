/**
 * humanizerPolish 单元测试（v3 完整版）
 *
 * Spec: polish-deai-humanizer / 2026-08-21 第二次返工后
 *
 * ⚠️ 长度断言用下限而非上限——v1/v2 两次"蒸馏精简"均导致覆盖不足被用户打回，
 * 用 ≥5000 字符下限锁死完整版规模，防止未来再被"优化"成简写版。
 * 覆盖：注入开关 / 锚点防重 / 空输入 / 27 模式覆盖 / RP 域词表（含用户实测"冰冷的"）。
 */

import { describe, it, expect } from 'vitest';
import {
  withHumanizerRules,
  withHumanizerGenerationRules,
  withHumanizerTextgenRules,
  HUMANIZER_POLISH_ANCHOR,
  HUMANIZER_POLISH_RULES,
  HUMANIZER_GENERATION_ANCHOR,
  HUMANIZER_GENERATION_RULES,
  HUMANIZER_TEXTGEN_RULES,
  HUMANIZER_RP_WARNLIST,
  HUMANIZER_FULL_GUIDE,
} from '../humanizerPolish';

const BASE_PROMPT = '你是一个专业的文本润色助手，正在优化SillyTavern角色卡的内容。';
const GENERATION_PROMPT = '你是一个专业的世界书（Lorebook）创建助手。请根据用户提供的主题描述，生成完整的世界书数据结构。';

describe('withHumanizerRules（润色）', () => {
  it('开关开启：追加规则块', () => {
    const result = withHumanizerRules(BASE_PROMPT, true);
    expect(result).toContain(HUMANIZER_POLISH_ANCHOR);
    expect(result).toContain(BASE_PROMPT);
    expect(result.indexOf(HUMANIZER_POLISH_ANCHOR)).toBeGreaterThan(result.indexOf(BASE_PROMPT));
  });

  it('开关关闭：原样返回', () => {
    const result = withHumanizerRules(BASE_PROMPT, false);
    expect(result).toBe(BASE_PROMPT);
    expect(result).not.toContain(HUMANIZER_POLISH_ANCHOR);
  });

  it('锚点守卫：已含规则块不重复注入', () => {
    const once = withHumanizerRules(BASE_PROMPT, true);
    const twice = withHumanizerRules(once, true);
    expect(twice).toBe(once);
    expect(twice.split(HUMANIZER_POLISH_ANCHOR).length - 1).toBe(1);
  });

  it('空输入：原样返回空串', () => {
    expect(withHumanizerRules('', true)).toBe('');
    expect(withHumanizerRules('', false)).toBe('');
  });

  it('尾部空白清理：不产生空行堆积', () => {
    const result = withHumanizerRules(BASE_PROMPT + '\n\n  ', true);
    expect(result).not.toMatch(/\n{4,}/);
  });
});

describe('withHumanizerGenerationRules（生成）', () => {
  it('默认注入（无开关参数，生成场景默认开启）', () => {
    const result = withHumanizerGenerationRules(GENERATION_PROMPT);
    expect(result).toContain(HUMANIZER_GENERATION_ANCHOR);
    expect(result).toContain(GENERATION_PROMPT);
  });

  it('锚点守卫：已含规则块不重复注入', () => {
    const once = withHumanizerGenerationRules(GENERATION_PROMPT);
    const twice = withHumanizerGenerationRules(once);
    expect(twice).toBe(once);
    expect(twice.split(HUMANIZER_GENERATION_ANCHOR).length - 1).toBe(1);
  });

  it('与润色锚点互不干扰（润色锚点不触发生成守卫）', () => {
    const polished = withHumanizerRules(GENERATION_PROMPT, true);
    const result = withHumanizerGenerationRules(polished);
    expect(result).toContain(HUMANIZER_GENERATION_ANCHOR);
    expect(result).toContain(HUMANIZER_POLISH_ANCHOR);
  });

  it('空输入：原样返回空串', () => {
    expect(withHumanizerGenerationRules('')).toBe('');
  });
});

describe('withHumanizerTextgenRules（文本生成，角色卡字段等非 JSON 场景）', () => {
  const CHARGEN_PROMPT = '你是一个专业的角色卡创建助手。请根据要求生成角色卡的指定字段内容。';

  it('默认注入（无开关参数）', () => {
    const result = withHumanizerTextgenRules(CHARGEN_PROMPT);
    expect(result).toContain(HUMANIZER_GENERATION_ANCHOR);
    expect(result).toContain(CHARGEN_PROMPT);
  });

  it('锚点守卫：与生成变体共用锚点，已含规则块不重复注入', () => {
    const once = withHumanizerTextgenRules(CHARGEN_PROMPT);
    expect(withHumanizerTextgenRules(once)).toBe(once);
    // 先经生成变体注入后，文本生成变体守卫生效不重复
    const viaGen = withHumanizerGenerationRules(CHARGEN_PROMPT);
    expect(withHumanizerTextgenRules(viaGen)).toBe(viaGen);
  });

  it('关键差异：无 JSON 声明（避免误导模型输出 JSON 破坏直接文本格式）', () => {
    expect(HUMANIZER_TEXTGEN_RULES).not.toContain('仅约束 JSON');
    expect(HUMANIZER_TEXTGEN_RULES).not.toContain('不改变 JSON 结构');
  });

  it('文体总则适配 RP 域：设定类平实 + 对话像真人说话', () => {
    expect(HUMANIZER_TEXTGEN_RULES).toContain('对话/开场白/问候语要像真人说话');
  });

  it('组装完整性：RP 词表 + 完整指南，规模下限 ≥3500', () => {
    expect(HUMANIZER_TEXTGEN_RULES).toContain(HUMANIZER_RP_WARNLIST);
    expect(HUMANIZER_TEXTGEN_RULES).toContain(HUMANIZER_FULL_GUIDE);
    expect(HUMANIZER_TEXTGEN_RULES.length).toBeGreaterThanOrEqual(3500);
  });

  it('空输入：原样返回空串', () => {
    expect(withHumanizerTextgenRules('')).toBe('');
  });
});

describe('完整指南 HUMANIZER_FULL_GUIDE（27 模式全量，防退化下限断言）', () => {
  it('包含全部 27 个模式编号', () => {
    for (let i = 1; i <= 27; i++) {
      expect(HUMANIZER_FULL_GUIDE).toContain(`#${i} `);
    }
  });

  it('包含指南各章节（核心规则/人味/检查清单/自检）', () => {
    expect(HUMANIZER_FULL_GUIDE).toContain('核心规则');
    expect(HUMANIZER_FULL_GUIDE).toContain('增加人味');
    expect(HUMANIZER_FULL_GUIDE).toContain('交付前快速检查清单');
    expect(HUMANIZER_FULL_GUIDE).toContain('最终反AI自检');
  });

  it('包含代表性词表词（#1 意义拔高 / #4 宣传腔 / #7 AI词汇 / #8 系动词 / #20 连字符 / #21 权威套路）', () => {
    expect(HUMANIZER_FULL_GUIDE).toContain('标志着');
    expect(HUMANIZER_FULL_GUIDE).toContain('坐落于');
    expect(HUMANIZER_FULL_GUIDE).toContain('充满活力的');
    expect(HUMANIZER_FULL_GUIDE).toContain('毋庸置疑');
    expect(HUMANIZER_FULL_GUIDE).toContain('作为/成为/充当');
    expect(HUMANIZER_FULL_GUIDE).toContain('赋能');
    expect(HUMANIZER_FULL_GUIDE).toContain('真正的问题是');
  });

  it('包含改写示例（✗/✓ 对照）', () => {
    expect(HUMANIZER_FULL_GUIDE).toContain('✗');
    expect(HUMANIZER_FULL_GUIDE).toContain('✓');
  });

  it('规模下限锁死（≥3000 字符，防止再被精简成蒸馏版——v2 蒸馏版仅 ~500）', () => {
    expect(HUMANIZER_FULL_GUIDE.length).toBeGreaterThanOrEqual(3000);
  });
});

describe('RP 域词表 HUMANIZER_RP_WARNLIST（指南不覆盖的实测高频词）', () => {
  it('包含用户实测反馈的"冰冷的"', () => {
    expect(HUMANIZER_RP_WARNLIST).toContain('冰冷的');
  });

  it('包含 RP 高频 AI 腔词（嘴角勾起/眼底闪过/睫毛颤/空气凝固等）', () => {
    expect(HUMANIZER_RP_WARNLIST).toContain('嘴角勾起一抹');
    expect(HUMANIZER_RP_WARNLIST).toContain('眼底闪过一丝');
    expect(HUMANIZER_RP_WARNLIST).toContain('空气仿佛凝固');
    expect(HUMANIZER_RP_WARNLIST).toContain('禁忌之美');
    expect(HUMANIZER_RP_WARNLIST).toContain('缱绻');
  });

  it('含"换具体表达"引导而非机械禁词（humanizer 核心理念）', () => {
    expect(HUMANIZER_RP_WARNLIST).toContain('换成具体可观察的动作、感官细节或事实');
  });
});

describe('规则块组装完整性', () => {
  it('润色规则块 = 例外条款 + RP词表 + 完整指南', () => {
    expect(HUMANIZER_POLISH_RULES).toContain('除非用户的润色要求明确指定了其他风格');
    expect(HUMANIZER_POLISH_RULES).toContain(HUMANIZER_RP_WARNLIST);
    expect(HUMANIZER_POLISH_RULES).toContain(HUMANIZER_FULL_GUIDE);
  });

  it('生成规则块 = JSON-aware声明 + 设定集文体 + RP词表 + 完整指南', () => {
    expect(HUMANIZER_GENERATION_RULES).toContain('仅约束 JSON 中');
    expect(HUMANIZER_GENERATION_RULES).toContain('不改变 JSON 结构');
    expect(HUMANIZER_GENERATION_RULES).toContain('百科条目');
    expect(HUMANIZER_GENERATION_RULES).toContain(HUMANIZER_RP_WARNLIST);
    expect(HUMANIZER_GENERATION_RULES).toContain(HUMANIZER_FULL_GUIDE);
  });

  it('润色规则块规模下限（≥3500 字符，远高于 v2 蒸馏版 ~500）', () => {
    expect(HUMANIZER_POLISH_RULES.length).toBeGreaterThanOrEqual(3500);
  });

  it('生成规则块规模下限（≥3600 字符，远高于 v2 蒸馏版 ~350）', () => {
    expect(HUMANIZER_GENERATION_RULES.length).toBeGreaterThanOrEqual(3600);
  });
});
