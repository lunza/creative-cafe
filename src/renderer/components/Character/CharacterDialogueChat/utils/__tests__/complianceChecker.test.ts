/**
 * complianceChecker 单元测试
 *
 * Spec: enforce-forbidden-words-and-dialogue-naturalness / Task 3
 * 覆盖：
 *  - 中文禁词子串命中（"冰冷的" 等含 CJK 词）
 *  - 英文禁词 \b 全词匹配（"ass" 不误匹配 "class"）
 *  - 大小写不敏感
 *  - 双语词条拆解（"sacrifice (献祭)" → 两个独立检测词）
 *  - 短路：空内容 / 空类别 / 空 words
 *  - 多类别全检测
 *  - replaceForbiddenWords 硬替换
 *  - resolve* 缺省解析
 *  - 性能：1000+ 禁词 < 50ms
 */

import { describe, it, expect } from 'vitest';
import {
  parseWordEntry,
  checkCompliance,
  replaceForbiddenWords,
  resolveEnforcement,
  resolveReplacementText,
  resolveMaxRetries,
} from '../complianceChecker';
import type { ForbiddenWordsConfig, ForbiddenWordCategory } from '@shared/types/forbiddenWords';

/** 构造配置（每次新建对象，避免 WeakMap 缓存串扰） */
function makeConfig(categories: ForbiddenWordCategory[]): ForbiddenWordsConfig {
  return { enabled: true, categories };
}

describe('parseWordEntry', () => {
  it('双语词条拆解为两个检测词', () => {
    expect(parseWordEntry('sacrifice (献祭)')).toEqual(['sacrifice', '献祭']);
    expect(parseWordEntry('sacred（神圣）')).toEqual(['sacred', '神圣']);
  });

  it('无括号词条原样返回', () => {
    expect(parseWordEntry('恐惧')).toEqual(['恐惧']);
    expect(parseWordEntry('  fear  ')).toEqual(['fear']);
  });

  it('空词条返回空数组', () => {
    expect(parseWordEntry('')).toEqual([]);
    expect(parseWordEntry('   ')).toEqual([]);
  });
});

describe('checkCompliance', () => {
  it('中文禁词子串命中（含前缀语境不干扰）', () => {
    const config = makeConfig([
      { name: 'RP词表', description: '', words: ['冰冷的'] },
    ]);
    const r = checkCompliance('她的语气冰冷的，像结了霜。', config);
    expect(r.clean).toBe(false);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].word).toBe('冰冷的');
    expect(r.hits[0].category).toBe('RP词表');
  });

  it('英文禁词全词匹配：ass 不误匹配 class', () => {
    const config = makeConfig([
      { name: 'EN', description: '', words: ['ass'] },
    ]);
    expect(checkCompliance('He sat in the classroom.', config).clean).toBe(true);
    const r = checkCompliance('Kick his ass!', config);
    expect(r.clean).toBe(false);
    expect(r.hits[0].word).toBe('ass');
  });

  it('英文大小写不敏感命中', () => {
    const config = makeConfig([
      { name: 'EN', description: '', words: ['Sacrifice'] },
    ]);
    expect(checkCompliance('a SACRIFICE was made', config).clean).toBe(false);
    expect(checkCompliance('sAcRiFiCe', config).hits).toHaveLength(1);
  });

  it('双语词条两个语种均可命中', () => {
    const config = makeConfig([
      { name: 'Religious', description: '', words: ['sacrifice (献祭)'] },
    ]);
    expect(checkCompliance('the sacrifice begins', config).clean).toBe(false);
    expect(checkCompliance('一场献祭即将开始', config).clean).toBe(false);
    expect(checkCompliance('nothing happened here', config).clean).toBe(true);
  });

  it('空内容 / 空类别短路返回 clean', () => {
    expect(checkCompliance('', makeConfig([{ name: 'A', description: '', words: ['x'] }])).clean).toBe(true);
    expect(checkCompliance('some text', makeConfig([])).clean).toBe(true);
    expect(checkCompliance('some text', { enabled: true, categories: [] }).clean).toBe(true);
  });

  it('空 words / 无效类别被跳过', () => {
    const config = makeConfig([
      { name: 'Empty', description: '', words: [] },
      { name: 'Bad', description: '', words: undefined as unknown as string[] },
    ]);
    expect(checkCompliance('anything', config).clean).toBe(true);
  });

  it('多类别全部检测（任一类别命中即报告）', () => {
    const config = makeConfig([
      { name: 'Cat1', description: '', words: ['恐惧'] },
      { name: 'Cat2', description: '', words: ['绝望'] },
    ]);
    const r = checkCompliance('心中泛起恐惧与绝望', config);
    expect(r.clean).toBe(false);
    expect(r.hits).toHaveLength(2);
    expect(r.hits.map(h => h.category).sort()).toEqual(['Cat1', 'Cat2']);
  });

  it('正则特殊字符词条不崩溃且可命中', () => {
    const config = makeConfig([
      { name: 'Special', description: '', words: ['a.c'] },
    ]);
    // "a.c" 作为字面词命中；不命中 "abc"
    expect(checkCompliance('value a.c here', config).clean).toBe(false);
    expect(checkCompliance('abc here', config).clean).toBe(true);
  });

  it('性能：1000+ 禁词检测 < 50ms', () => {
    const words: string[] = [];
    for (let i = 0; i < 1000; i++) {
      words.push(i % 2 === 0 ? `禁词${i}号` : `forbidden${i}`);
    }
    const config = makeConfig([{ name: 'Big', description: '', words }]);
    const content = '这是一段包含 禁词500号 与 forbidden501 的长文本。'.repeat(20);
    const start = performance.now();
    const r = checkCompliance(content, config);
    const elapsed = performance.now() - start;
    expect(r.clean).toBe(false);
    expect(elapsed).toBeLessThan(50);
  });
});

describe('replaceForbiddenWords', () => {
  it('中文子串全量替换', () => {
    const config = makeConfig([{ name: 'A', description: '', words: ['冰冷的'] }]);
    const out = replaceForbiddenWords('冰冷的目光，冰冷的语气。', config, '[避]');
    expect(out).toBe('[避]目光，[避]语气。');
  });

  it('英文全词替换（不破坏相邻字母）', () => {
    const config = makeConfig([{ name: 'A', description: '', words: ['fear'] }]);
    const out = replaceForbiddenWords('No fear here, fearless is fine.', config, 'X');
    // fearless 中 fear 因 \b 不替换
    expect(out).toBe('No X here, fearless is fine.');
  });

  it('替换命中词后其余文本逐字保留', () => {
    const config = makeConfig([{ name: 'A', description: '', words: ['恐惧'] }]);
    const src = '他说："恐惧，是心的回声。"\n*后退一步*';
    const out = replaceForbiddenWords(src, config, '***');
    expect(out).toBe('他说："***，是心的回声。"\n*后退一步*');
  });

  it('空内容 / 空词表原样返回', () => {
    const config = makeConfig([{ name: 'A', description: '', words: ['x'] }]);
    expect(replaceForbiddenWords('', config, '***')).toBe('');
    expect(replaceForbiddenWords('text', makeConfig([]), '***')).toBe('text');
  });
});

describe('resolve* 缺省解析', () => {
  it('缺省 enforcement/replacementText/maxRetries 取默认值', () => {
    expect(resolveEnforcement(undefined)).toBe('retry-and-replace');
    expect(resolveEnforcement(makeConfig([]))).toBe('retry-and-replace');
    expect(resolveReplacementText(undefined)).toBe('***');
    expect(resolveMaxRetries(undefined)).toBe(2);
  });

  it('显式配置优先于默认值', () => {
    const config: ForbiddenWordsConfig = {
      enabled: true,
      categories: [],
      enforcement: 'prompt-only',
      replacementText: '[已过滤]',
      maxRetries: 3,
    };
    expect(resolveEnforcement(config)).toBe('prompt-only');
    expect(resolveReplacementText(config)).toBe('[已过滤]');
    expect(resolveMaxRetries(config)).toBe(3);
  });

  it('maxRetries 越界钳制到 1-5', () => {
    expect(resolveMaxRetries({ enabled: true, categories: [], maxRetries: 0 })).toBe(2); // floor(0)||default → 2
    expect(resolveMaxRetries({ enabled: true, categories: [], maxRetries: 99 })).toBe(5);
    expect(resolveMaxRetries({ enabled: true, categories: [], maxRetries: -3 })).toBe(1); // max(1,-3)=1
  });
});
