/**
 * WorldBookKeywordIndex 单元测试
 *
 * 来源：spec §二 Task 11
 *  - SubTask 11.1：关键词→条目倒排索引（Aho-Corasick）
 *  - SubTask 11.2：增量更新
 *
 * 覆盖：
 *  1. Aho-Corasick 自动机正确性（子串 / 大小写 / 重叠 / 前缀 / 无假阳性）
 *  2. 倒排索引候选筛选（主关键词命中 / 未命中 / disable / 共享关键词 / 整词边界）
 *  3. 增量更新（upsert / remove / dirty 懒重建）
 *  4. 等价性：WorldBookKeywordMatcher（用索引）与朴素 O(n) 扫描结果一致
 *     —— 跨多种 selectiveLogic / 整词 / 大小写 / 随机 fuzz
 *
 * 等价性测试是核心保证：索引仅做候选筛选，候选集 ⊇ 真正激活集，最终 matchEntry
 * 逻辑与原实现一致 → 行为零回归。
 */

import { describe, it, expect } from 'vitest';
import {
  WorldBookKeywordIndex,
  getEffectivePrimaryKeys,
  getEffectiveSecondaryKeys,
} from '../WorldBookKeywordIndex';
import {
  WorldBookKeywordMatcher,
  WORLD_INFO_LOGIC,
  type KeywordMatchOptions,
  type KeywordMatchResult,
} from '../WorldBookKeywordMatcher';
import type { WorldBookEntry } from '../../../renderer/types/worldBook';

// ==================== 测试辅助 ====================

let uidSeq = 1;

/** 构造一个 WorldBookEntry，缺省字段填充合理默认值。 */
function makeEntry(partial: Partial<WorldBookEntry> & { uid?: number }): WorldBookEntry {
  const uid = partial.uid ?? uidSeq++;
  return {
    uid,
    id: uid,
    key: [],
    keysecondary: [],
    keys: [],
    secondary_keys: [],
    comment: `entry-${uid}`,
    content: `content-${uid}`,
    constant: false,
    selective: true,
    order: 100,
    position: 0,
    disable: false,
    displayIndex: 0,
    addMemo: true,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    probability: 100,
    depth: 4,
    useProbability: true,
    role: null,
    vectorized: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: 0,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    tags: [],
    selectiveLogic: WORLD_INFO_LOGIC.AND_ANY,
    ignoreBudget: false,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    outletName: '',
    triggers: [],
    characterFilter: { isExclude: false, names: [], tags: [] },
    priority: 0,
    insertion_order: 0,
    enabled: true,
    name: `entry-${uid}`,
    extensions: {
      depth: 4,
      weight: 100,
      addMemo: true,
      displayIndex: 0,
      useProbability: true,
      characterFilter: null,
      excludeRecursion: false,
    },
    ...partial,
  };
}

// ==================== 1. Aho-Corasick 候选筛选 ====================

describe('WorldBookKeywordIndex - 候选筛选', () => {
  it('主关键词在文本中出现 → 返回候选', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([
      makeEntry({ uid: 1, key: ['猫'] }),
      makeEntry({ uid: 2, key: ['狗'] }),
    ]);
    const candidates = index.findCandidateEntries('我有一只猫', { caseSensitive: false, matchWholeWords: false });
    expect(candidates.map(e => e.uid)).toEqual([1]);
  });

  it('主关键词未出现 → 空候选', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([
      makeEntry({ uid: 1, key: ['猫'] }),
      makeEntry({ uid: 2, key: ['狗'] }),
    ]);
    const candidates = index.findCandidateEntries('这里什么都没有', { caseSensitive: false, matchWholeWords: false });
    expect(candidates).toEqual([]);
  });

  it('默认大小写不敏感', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([makeEntry({ uid: 1, key: ['Cat'] })]);
    const candidates = index.findCandidateEntries('a cat here', { caseSensitive: false, matchWholeWords: false });
    expect(candidates.map(e => e.uid)).toEqual([1]);
  });

  it('caseSensitive=true 时大小写敏感', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([makeEntry({ uid: 1, key: ['Cat'] })]);
    const miss = index.findCandidateEntries('a cat here', { caseSensitive: true, matchWholeWords: false });
    expect(miss).toEqual([]);
    const hit = index.findCandidateEntries('a Cat here', { caseSensitive: true, matchWholeWords: false });
    expect(hit.map(e => e.uid)).toEqual([1]);
  });

  it('子串匹配：关键词是文本子串即命中（无假阴性）', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([makeEntry({ uid: 1, key: ['cater'] })]);
    // "caterpillar" 包含 "cater"
    const candidates = index.findCandidateEntries('caterpillar', { caseSensitive: false, matchWholeWords: false });
    expect(candidates.map(e => e.uid)).toEqual([1]);
  });

  it('前缀关键词：扫描经过中间节点时报告前缀命中', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([
      makeEntry({ uid: 1, key: ['cat'] }),
      makeEntry({ uid: 2, key: ['caterpillar'] }),
    ]);
    // "caterpillar" 应同时命中 "cat"（前缀）和 "caterpillar"
    const candidates = index.findCandidateEntries('caterpillar', { caseSensitive: false, matchWholeWords: false });
    expect(candidates.map(e => e.uid).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('disable 条目被排除', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([
      makeEntry({ uid: 1, key: ['猫'], disable: true }),
      makeEntry({ uid: 2, key: ['狗'], disable: false }),
    ]);
    expect(index.size).toBe(1);
    const candidates = index.findCandidateEntries('猫', { caseSensitive: false, matchWholeWords: false });
    expect(candidates).toEqual([]);
  });

  it('共享关键词 → 多条目同时候选', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([
      makeEntry({ uid: 1, key: ['魔法'] }),
      makeEntry({ uid: 2, key: ['魔法'] }),
      makeEntry({ uid: 3, key: ['剑'] }),
    ]);
    const candidates = index.findCandidateEntries('魔法使', { caseSensitive: false, matchWholeWords: false });
    expect(candidates.map(e => e.uid).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('整词模式：单字关键词需 \W 边界', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([makeEntry({ uid: 1, key: ['cat'] })]);
    // "cats" 中 "cat" 后跟 's'（\w）→ 整词不命中
    const miss = index.findCandidateEntries('cats', { caseSensitive: false, matchWholeWords: true });
    expect(miss).toEqual([]);
    // "a cat." 中 "cat" 前后均为 \W / 边界 → 命中
    const hit = index.findCandidateEntries('a cat.', { caseSensitive: false, matchWholeWords: true });
    expect(hit.map(e => e.uid)).toEqual([1]);
  });

  it('整词模式：多字关键词仍按子串匹配', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([makeEntry({ uid: 1, key: ['black cat'] })]);
    // 多字关键词在整词模式下用 includes 语义
    const hit = index.findCandidateEntries('the black cat sleeps', { caseSensitive: false, matchWholeWords: true });
    expect(hit.map(e => e.uid)).toEqual([1]);
  });

  it('整词模式：中文字符属 \W，单字中文关键词等价子串匹配', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([makeEntry({ uid: 1, key: ['猫'] })]);
    // "猫娘" 中 "猫" 后跟 '娘'（中文，\W）→ 边界通过 → 命中（与原实现一致）
    const hit = index.findCandidateEntries('猫娘', { caseSensitive: false, matchWholeWords: true });
    expect(hit.map(e => e.uid)).toEqual([1]);
  });

  it('空文本 → 空候选', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([makeEntry({ uid: 1, key: ['猫'] })]);
    expect(index.findCandidateEntries('', { caseSensitive: false, matchWholeWords: false })).toEqual([]);
  });

  it('无主关键词的条目不参与候选筛选', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([
      makeEntry({ uid: 1, key: [] }),
      makeEntry({ uid: 2, keysecondary: ['x'] }),
    ]);
    // 条目仍被存储（与原实现 entries.filter(!disable) 一致），但无主关键词
    // → 不进入 AC 自动机 / 倒排索引 → 永不出现在候选中
    expect(index.size).toBe(2);
    expect(index.findCandidateEntries('x', { caseSensitive: false, matchWholeWords: false })).toEqual([]);
    index.findCandidateEntries('x', { caseSensitive: false, matchWholeWords: false }); // 触发构建
    expect(index.getStats().distinctPrimaryKeys).toBe(0);
  });
});

// ==================== 2. 增量更新 ====================

describe('WorldBookKeywordIndex - 增量更新（Task 11.2）', () => {
  it('初始 rebuild 后 dirty=false', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([makeEntry({ uid: 1, key: ['猫'] })]);
    // 触发一次构建
    index.findCandidateEntries('猫', { caseSensitive: false, matchWholeWords: false });
    expect(index.isDirty).toBe(false);
  });

  it('upsertEntry 置 dirty，下次查询时懒重建并纳入新条目', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([makeEntry({ uid: 1, key: ['猫'] })]);
    index.findCandidateEntries('猫', { caseSensitive: false, matchWholeWords: false });
    expect(index.isDirty).toBe(false);

    // 增量新增
    index.upsertEntry(makeEntry({ uid: 2, key: ['狗'] }));
    expect(index.isDirty).toBe(true);

    const candidates = index.findCandidateEntries('狗', { caseSensitive: false, matchWholeWords: false });
    expect(index.isDirty).toBe(false);
    expect(candidates.map(e => e.uid)).toEqual([2]);
  });

  it('removeEntry 置 dirty，下次查询时懒重建并排除条目', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([
      makeEntry({ uid: 1, key: ['猫'] }),
      makeEntry({ uid: 2, key: ['狗'] }),
    ]);
    index.findCandidateEntries('猫', { caseSensitive: false, matchWholeWords: false });

    index.removeEntry(1);
    expect(index.isDirty).toBe(true);

    const candidates = index.findCandidateEntries('猫', { caseSensitive: false, matchWholeWords: false });
    expect(candidates).toEqual([]);
    expect(index.size).toBe(1);
  });

  it('upsertEntry 对 disable 条目等价于删除', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([makeEntry({ uid: 1, key: ['猫'] })]);
    index.findCandidateEntries('猫', { caseSensitive: false, matchWholeWords: false });
    expect(index.size).toBe(1);

    index.upsertEntry(makeEntry({ uid: 1, key: ['猫'], disable: true }));
    expect(index.size).toBe(0);
    expect(index.isDirty).toBe(true);
    expect(index.findCandidateEntries('猫', { caseSensitive: false, matchWholeWords: false })).toEqual([]);
  });

  it('upsertEntry 更新已有条目的关键词（同 uid 覆盖）', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([makeEntry({ uid: 1, key: ['猫'] })]);
    index.findCandidateEntries('猫', { caseSensitive: false, matchWholeWords: false });

    // 改关键词
    index.upsertEntry(makeEntry({ uid: 1, key: ['鸟'] }));
    expect(index.findCandidateEntries('猫', { caseSensitive: false, matchWholeWords: false })).toEqual([]);
    expect(index.findCandidateEntries('鸟', { caseSensitive: false, matchWholeWords: false }).map(e => e.uid)).toEqual([1]);
  });

  it('removeEntry 不存在的 uid 不置 dirty', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([makeEntry({ uid: 1, key: ['猫'] })]);
    index.findCandidateEntries('猫', { caseSensitive: false, matchWholeWords: false });
    expect(index.isDirty).toBe(false);
    index.removeEntry(999);
    expect(index.isDirty).toBe(false);
  });

  it('options 变化（caseSensitive）触发重建', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([makeEntry({ uid: 1, key: ['Cat'] })]);
    // case-insensitive 命中
    expect(index.findCandidateEntries('cat', { caseSensitive: false, matchWholeWords: false }).map(e => e.uid)).toEqual([1]);
    // 切换 caseSensitive=true 同一文本不命中
    expect(index.findCandidateEntries('cat', { caseSensitive: true, matchWholeWords: false })).toEqual([]);
  });

  it('getStats 反映索引规模', () => {
    const index = new WorldBookKeywordIndex();
    index.rebuild([
      makeEntry({ uid: 1, key: ['猫', '犬'] }),
      makeEntry({ uid: 2, key: ['猫'] }),
    ]);
    index.findCandidateEntries('猫', { caseSensitive: false, matchWholeWords: false });
    const stats = index.getStats();
    expect(stats.entryCount).toBe(2);
    expect(stats.distinctPrimaryKeys).toBe(2); // '猫' 和 '犬'
    expect(stats.acNodes).toBeGreaterThan(0);
    expect(stats.dirty).toBe(false);
    expect(stats.lastBuildMs).toBeGreaterThanOrEqual(0);
  });
});

// ==================== 3. 等价性：索引 matcher vs 朴素 O(n) 扫描 ====================

/**
 * 朴素参考实现：完全照搬重构前 WorldBookKeywordMatcher 的逐条目扫描逻辑。
 * 用于与索引版 matcher 做结果等价性比对，保证零回归。
 * probability 固定 100（roll∈[0,100) > 100 恒 false → 不触发概率过滤），
 * 避免随机性干扰等价断言。
 */
function naiveMatch(
  entries: WorldBookEntry[],
  text: string,
  options: Required<KeywordMatchOptions>
): KeywordMatchResult[] {
  const results: KeywordMatchResult[] = [];
  for (const entry of entries) {
    if (entry.disable) continue;
    const primaryKeys = getEffectivePrimaryKeys(entry);
    const secondaryKeys = getEffectiveSecondaryKeys(entry);
    if (primaryKeys.length === 0) continue;

    const primaryKeyMatch = primaryKeys.find(key => {
      const trimmed = key.trim();
      return trimmed && naiveMatchSingleKey(trimmed, text, options);
    });
    if (!primaryKeyMatch) continue;

    const hasSecondary = entry.selective && Array.isArray(secondaryKeys) && secondaryKeys.length > 0;
    if (!hasSecondary) {
      results.push({
        entry,
        matchedKeys: [primaryKeyMatch],
        matchType: 'primary',
        matchScore: naiveScore(entry, [primaryKeyMatch], [], options),
      });
      continue;
    }

    const selectiveLogic = entry.selectiveLogic !== undefined ? entry.selectiveLogic : WORLD_INFO_LOGIC.AND_ANY;
    const sec = naiveMatchSecondary(secondaryKeys, text, options, selectiveLogic);
    if (!sec.activated) continue;

    // probability 固定 100 → 不触发过滤
    const allMatchedKeys = [primaryKeyMatch, ...sec.matchedSecondaryKeys];
    results.push({
      entry,
      matchedKeys: allMatchedKeys,
      matchType: sec.matchedSecondaryKeys.length > 0 ? 'both' : 'primary',
      matchScore: naiveScore(entry, [primaryKeyMatch], sec.matchedSecondaryKeys, options),
    });
  }
  results.sort((a, b) => b.entry.order - a.entry.order);
  return results;
}

function naiveMatchSingleKey(key: string, text: string, options: Required<KeywordMatchOptions>): boolean {
  if (!key) return false;
  let searchText = text;
  let searchKey = key;
  if (!options.caseSensitive) {
    searchText = searchText.toLowerCase();
    searchKey = searchKey.toLowerCase();
  }
  if (options.matchWholeWords) {
    const keyWords = searchKey.split(/\s+/);
    if (keyWords.length > 1) return searchText.includes(searchKey);
    const escapedKey = searchKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|\\W)(${escapedKey})(?:$|\\W)`);
    return regex.test(searchText);
  }
  return searchText.includes(searchKey);
}

function naiveMatchSecondary(
  secondaryKeys: string[],
  text: string,
  options: Required<KeywordMatchOptions>,
  selectiveLogic: number
): { activated: boolean; matchedSecondaryKeys: string[] } {
  let hasAnyMatch = false;
  let hasAllMatch = true;
  const matched: string[] = [];
  for (const key of secondaryKeys) {
    const trimmed = key.trim();
    if (!trimmed) continue;
    const m = naiveMatchSingleKey(trimmed, text, options);
    if (m) { hasAnyMatch = true; matched.push(key); }
    if (!m) { hasAllMatch = false; }
    if (selectiveLogic === WORLD_INFO_LOGIC.AND_ANY && m) return { activated: true, matchedSecondaryKeys: matched };
    if (selectiveLogic === WORLD_INFO_LOGIC.NOT_ALL && !m) return { activated: true, matchedSecondaryKeys: matched };
  }
  if (selectiveLogic === WORLD_INFO_LOGIC.NOT_ANY && !hasAnyMatch) return { activated: true, matchedSecondaryKeys: matched };
  if (selectiveLogic === WORLD_INFO_LOGIC.AND_ALL && hasAllMatch && secondaryKeys.length > 0) return { activated: true, matchedSecondaryKeys: matched };
  return { activated: false, matchedSecondaryKeys: matched };
}

function naiveScore(
  entry: WorldBookEntry,
  primary: string[],
  secondary: string[],
  options: Required<KeywordMatchOptions>
): number {
  let score = 0;
  score += primary.length * 10;
  score += secondary.length * 5;
  if (entry.selective && primary.length > 0 && secondary.length > 0) score += 20;
  if (options.useGroupScoring && entry.group) score += 5;
  return score;
}

/** 规整化结果以便比对：仅保留 uid / matchedKeys(排序) / matchType / matchScore。 */
function normalizeResults(results: KeywordMatchResult[]) {
  return results
    .map(r => ({
      uid: r.entry.uid,
      matchedKeys: [...r.matchedKeys].sort(),
      matchType: r.matchType,
      matchScore: r.matchScore,
    }))
    .sort((a, b) => a.uid - b.uid);
}

const ALL_OPTIONS: Required<KeywordMatchOptions>[] = [
  { caseSensitive: false, matchWholeWords: false, useGroupScoring: true },
  { caseSensitive: false, matchWholeWords: true, useGroupScoring: true },
  { caseSensitive: true, matchWholeWords: false, useGroupScoring: true },
  { caseSensitive: true, matchWholeWords: true, useGroupScoring: true },
  { caseSensitive: false, matchWholeWords: false, useGroupScoring: false },
];

const SAMPLE_KEYS = ['cat', 'dog', 'bird', 'magic', '黑猫', '魔法', '剑', 'New York', 'a', 'caterpillar', 'star'];
const SAMPLE_TEXTS = [
  'the cat sat on the mat',
  'I have a dog and a bird',
  'cats are fun',
  '魔法使と黑猫',
  'caterpillar butterfly',
  'New York City',
  'a star shines',
  'nothing here at all',
  'MAGIC and magic',
  '剑与魔法的世界',
];

describe('WorldBookKeywordMatcher - 与朴素扫描等价（零回归）', () => {
  it('手工用例：跨 selectiveLogic 等价', () => {
    const entries = [
      makeEntry({ uid: 1, key: ['cat'], selective: false, order: 100 }),
      makeEntry({ uid: 2, key: ['cat'], keysecondary: ['mat'], selective: true, selectiveLogic: WORLD_INFO_LOGIC.AND_ANY, order: 200 }),
      makeEntry({ uid: 3, key: ['cat'], keysecondary: ['dog'], selective: true, selectiveLogic: WORLD_INFO_LOGIC.NOT_ANY, order: 150 }),
      makeEntry({ uid: 4, key: ['cat'], keysecondary: ['mat', 'rug'], selective: true, selectiveLogic: WORLD_INFO_LOGIC.AND_ALL, order: 180 }),
      makeEntry({ uid: 5, key: ['cat'], keysecondary: ['mat', 'rug'], selective: true, selectiveLogic: WORLD_INFO_LOGIC.NOT_ALL, order: 170 }),
      makeEntry({ uid: 6, key: ['dog'], selective: false, order: 120, group: 'g1' }),
      makeEntry({ uid: 7, key: ['caterpillar'], selective: false, order: 90 }),
    ];
    const text = 'the cat sat on the mat';
    for (const options of ALL_OPTIONS) {
      const matcher = new WorldBookKeywordMatcher(entries, options);
      const indexed = normalizeResults(matcher.match(text));
      const naive = normalizeResults(naiveMatch(entries, text, options));
      expect(indexed).toEqual(naive);
    }
  });

  it('手工用例：整词 / 大小写组合等价', () => {
    const entries = [
      makeEntry({ uid: 1, key: ['cat'] }),
      makeEntry({ uid: 2, key: ['Cat'] }),
      makeEntry({ uid: 3, key: ['black cat'] }),
      makeEntry({ uid: 4, key: ['a'] }),
    ];
    const texts = ['cat', 'cats', 'a cat', 'black cat', 'Cat', 'CAT'];
    for (const options of ALL_OPTIONS) {
      for (const text of texts) {
        const matcher = new WorldBookKeywordMatcher(entries, options);
        const indexed = normalizeResults(matcher.match(text));
        const naive = normalizeResults(naiveMatch(entries, text, options));
        expect(indexed).toEqual(naive);
      }
    }
  });

  it('随机 fuzz：跨条目/文本/选项组合结果一致', () => {
    // 确定性伪随机
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

    for (let iter = 0; iter < 200; iter++) {
      const entryCount = 1 + Math.floor(rand() * 8);
      const entries: WorldBookEntry[] = [];
      for (let i = 0; i < entryCount; i++) {
        const keyCount = Math.floor(rand() * 3);
        const keys: string[] = [];
        for (let k = 0; k < keyCount; k++) keys.push(pick(SAMPLE_KEYS));
        const secKeys = rand() < 0.5 ? [] : [pick(SAMPLE_KEYS), pick(SAMPLE_KEYS)];
        entries.push(makeEntry({
          uid: i + 1,
          key: keys,
          keysecondary: secKeys,
          selective: secKeys.length > 0,
          selectiveLogic: Math.floor(rand() * 4),
          order: Math.floor(rand() * 200),
          group: rand() < 0.3 ? 'g1' : '',
          disable: rand() < 0.15,
          probability: 100, // 固定，避免随机过滤
        }));
      }
      const text = pick(SAMPLE_TEXTS);
      const options = pick(ALL_OPTIONS);

      const matcher = new WorldBookKeywordMatcher(entries, options);
      const indexed = normalizeResults(matcher.match(text));
      const naive = normalizeResults(naiveMatch(entries, text, options));
      if (JSON.stringify(indexed) !== JSON.stringify(naive)) {
        // 失败时打印诊断信息
        expect.fail(
          `fuzz iter ${iter} mismatch\n` +
          `entries: ${JSON.stringify(entries.map(e => ({ uid: e.uid, key: e.key, sec: e.keysecondary, logic: e.selectiveLogic, disable: e.disable })))}\n` +
          `text: ${JSON.stringify(text)}\noptions: ${JSON.stringify(options)}\n` +
          `indexed: ${JSON.stringify(indexed)}\nnaive: ${JSON.stringify(naive)}`
        );
      }
    }
  });
});

// ==================== 4. 增量 API 在 matcher 层等价性 ====================

describe('WorldBookKeywordMatcher - 增量 API 等价性', () => {
  it('upsertEntry + removeEntry 与 rebuild 全量结果一致', () => {
    const base = [
      makeEntry({ uid: 1, key: ['cat'] }),
      makeEntry({ uid: 2, key: ['dog'] }),
    ];
    const added = makeEntry({ uid: 3, key: ['bird'], selective: false, order: 50 });

    // 全量重建路径
    const fullMatcher = new WorldBookKeywordMatcher([...base, added], { caseSensitive: false, matchWholeWords: false });
    const fullResults = normalizeResults(fullMatcher.match('cat dog bird'));

    // 增量路径：先 base，再 upsert added
    const incrMatcher = new WorldBookKeywordMatcher(base, { caseSensitive: false, matchWholeWords: false });
    incrMatcher.match('cat'); // 触发首次构建
    incrMatcher.upsertEntry(added);
    const incrResults = normalizeResults(incrMatcher.match('cat dog bird'));

    expect(incrResults).toEqual(fullResults);

    // 再 remove added，应回到 base 的结果
    incrMatcher.removeEntry(3);
    const afterRemove = normalizeResults(incrMatcher.match('cat dog bird'));
    const baseResults = normalizeResults(new WorldBookKeywordMatcher(base, { caseSensitive: false, matchWholeWords: false }).match('cat dog bird'));
    expect(afterRemove).toEqual(baseResults);
  });

  it('indexedSize 反映非 disable 条目数', () => {
    const matcher = new WorldBookKeywordMatcher([
      makeEntry({ uid: 1, key: ['a'] }),
      makeEntry({ uid: 2, key: ['b'], disable: true }),
      makeEntry({ uid: 3, key: ['c'] }),
    ], { caseSensitive: false, matchWholeWords: false });
    expect(matcher.indexedSize).toBe(2);
    matcher.upsertEntry(makeEntry({ uid: 4, key: ['d'] }));
    expect(matcher.indexedSize).toBe(3);
    matcher.removeEntry(1);
    expect(matcher.indexedSize).toBe(2);
  });
});
