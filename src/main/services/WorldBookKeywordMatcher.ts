import { WorldBookEntry } from '../../renderer/types/worldBook';
import {
  WorldBookKeywordIndex,
  getEffectivePrimaryKeys,
  getEffectiveSecondaryKeys,
  type IndexStats,
} from './WorldBookKeywordIndex';

// ==================== 类型定义 ====================

export interface KeywordMatchResult {
  entry: WorldBookEntry;
  matchedKeys: string[];
  matchType: 'primary' | 'secondary' | 'both';
  matchScore: number;
}

export interface KeywordMatchOptions {
  caseSensitive?: boolean;
  matchWholeWords?: boolean;
  useGroupScoring?: boolean;
}

const DEFAULT_OPTIONS: Required<KeywordMatchOptions> = {
  caseSensitive: false,
  matchWholeWords: false,
  useGroupScoring: true,
};

// ==================== selectiveLogic 枚举（与 SillyTavern 一致） ====================
// 参考：sillytavern-source/SillyTavern/public/scripts/world-info.js L33-L38
export const WORLD_INFO_LOGIC = {
  AND_ANY: 0,  // 任意一个次关键词匹配即激活
  NOT_ALL: 1,  // 并非所有次关键词都匹配时激活
  NOT_ANY: 2,  // 没有任何次关键词匹配时激活
  AND_ALL: 3,  // 所有次关键词都匹配时才激活
};

// ==================== 核心匹配引擎 ====================
// 参考：sillytavern-source/SillyTavern/public/scripts/world-info.js L4655-L4860
//
// 性能优化（spec §二 Task 11）：
//  原实现 match() 对所有条目逐个 matchEntry，每条目再对每个关键词做
//  text.includes —— O(Σ|key| × |text|) 每消息。现引入 WorldBookKeywordIndex
//  （Aho-Corasick + 关键词→条目倒排索引）先筛出「主关键词在文本中出现」
//  的候选条目（O(|text| + |matches|)），再仅对候选运行完整 matchEntry。
//  matchEntry 的 selectiveLogic / probability / 评分逻辑保持不变，仅在候选
//  集上运行 → 零行为变更，零假阴性（候选集 ⊇ 真正激活集）。

export class WorldBookKeywordMatcher {
  private options: Required<KeywordMatchOptions>;
  private readonly index: WorldBookKeywordIndex;

  constructor(entries: WorldBookEntry[], options?: KeywordMatchOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.index = new WorldBookKeywordIndex();
    // 构造即批量构建索引（过滤 disable 条目由 index.rebuild 负责）
    this.index.rebuild(entries);
  }

  match(text: string): KeywordMatchResult[] {
    if (!text) return [];

    // 1. 倒排索引筛候选：仅对「主关键词在文本中出现」的条目运行完整判定
    const candidates = this.index.findCandidateEntries(text, {
      caseSensitive: this.options.caseSensitive,
      matchWholeWords: this.options.matchWholeWords,
    });

    if (candidates.length === 0) return [];

    const results: KeywordMatchResult[] = [];
    for (const entry of candidates) {
      const match = this.matchEntry(entry, text);
      if (match) {
        results.push(match);
      }
    }

    // 按 order 降序排序（order 越大越优先）
    results.sort((a, b) => b.entry.order - a.entry.order);

    return results;
  }

  // ==================== 增量更新 API（spec SubTask 11.2） ====================

  /**
   * 批量替换所有条目。重建在下一次 match 时懒触发。
   * 适用于 worldBook 缓存整体刷新场景。
   */
  rebuild(entries: WorldBookEntry[]): void {
    this.index.rebuild(entries);
  }

  /**
   * 增量新增/更新单个条目（O(1)，置 dirty）。
   * disable 的条目等价于删除。重建在下一次 match 时懒触发。
   */
  upsertEntry(entry: WorldBookEntry): void {
    this.index.upsertEntry(entry);
  }

  /**
   * 增量删除单个条目（O(1)，置 dirty）。
   */
  removeEntry(uid: number): void {
    this.index.removeEntry(uid);
  }

  /** 当前索引条目数（不含 disable）。 */
  get indexedSize(): number {
    return this.index.size;
  }

  /** 索引诊断信息（条目数 / 关键词数 / AC 节点数 / 上次重建耗时）。 */
  getIndexStats(): IndexStats {
    return this.index.getStats();
  }

  /**
   * 匹配单个条目 — 完全按照 SillyTavern 的激活逻辑实现
   * 参考：world-info.js L4762-L4860
   *
   * 注意：本方法假定 entry 已通过候选筛选（主关键词在文本中出现）。
   * 仍会重新校验主关键词以保持逻辑自洽（候选集可能有少量假阳性，需再确认）。
   */
  private matchEntry(entry: WorldBookEntry, text: string): KeywordMatchResult | null {
    const primaryKeys = getEffectivePrimaryKeys(entry);
    const secondaryKeys = getEffectiveSecondaryKeys(entry);

    // 没有主关键词的条目不通过关键词匹配激活
    if (primaryKeys.length === 0) {
      return null;
    }

    // PRIMARY KEYWORDS — 找到任意一个主关键词匹配即可（OR 逻辑）
    // 参考：world-info.js L4784-L4792
    const primaryKeyMatch = primaryKeys.find(key => {
      const trimmed = key.trim();
      return trimmed && this.matchSingleKey(trimmed, text);
    });

    if (!primaryKeyMatch) {
      // 候选筛选已保证至少一个主关键词命中；此处理论上不应进入。
      // 保留原校验以保证正确性（如 options 不一致时的降级）。
      return null;
    }

    // 检查是否有次关键词
    // 参考：world-info.js L4794-L4798
    const hasSecondaryKeywords = (
      entry.selective &&
      Array.isArray(secondaryKeys) &&
      secondaryKeys.length > 0
    );

    if (!hasSecondaryKeywords) {
      // 没有次关键词 → 主关键词匹配即激活
      // 参考：world-info.js L4800-L4805
      const matchScore = this.calculateMatchScore(entry, [primaryKeyMatch], []);
      return {
        entry,
        matchedKeys: [primaryKeyMatch],
        matchType: 'primary',
        matchScore,
      };
    }

    // 有次关键词 → 根据 selectiveLogic 判断
    // 参考：world-info.js L4808-L4860
    const selectiveLogic = entry.selectiveLogic !== undefined ? entry.selectiveLogic : WORLD_INFO_LOGIC.AND_ANY;
    const secondaryMatchResult = this.matchSecondaryKeys(secondaryKeys, text, selectiveLogic);

    if (!secondaryMatchResult.activated) {
      return null;
    }

    // 概率过滤
    // 参考：world-info.js L4863-L4869
    if (entry.useProbability !== false && entry.probability !== undefined && entry.probability !== null) {
      const roll = Math.random() * 100;
      if (roll > entry.probability) {
        return null;
      }
    }

    // 计算匹配分数
    const allMatchedKeys = [primaryKeyMatch, ...secondaryMatchResult.matchedSecondaryKeys];
    const matchScore = this.calculateMatchScore(entry, [primaryKeyMatch], secondaryMatchResult.matchedSecondaryKeys);

    // 确定匹配类型
    const matchType: KeywordMatchResult['matchType'] = secondaryMatchResult.matchedSecondaryKeys.length > 0 ? 'both' : 'primary';

    return {
      entry,
      matchedKeys: allMatchedKeys,
      matchType,
      matchScore,
    };
  }

  /**
   * 匹配次关键词 — 根据 selectiveLogic 判断是否激活
   * 参考：world-info.js L4813-L4850
   */
  private matchSecondaryKeys(
    secondaryKeys: string[],
    text: string,
    selectiveLogic: number
  ): { activated: boolean; matchedSecondaryKeys: string[] } {
    let hasAnyMatch = false;
    let hasAllMatch = true;
    const matchedSecondaryKeys: string[] = [];

    for (const key of secondaryKeys) {
      const trimmed = key.trim();
      if (!trimmed) continue;

      const hasSecondaryMatch = this.matchSingleKey(trimmed, text);

      if (hasSecondaryMatch) {
        hasAnyMatch = true;
        matchedSecondaryKeys.push(key);
      }
      if (!hasSecondaryMatch) {
        hasAllMatch = false;
      }

      // AND_ANY: 找到任意一个次关键词匹配即激活
      if (selectiveLogic === WORLD_INFO_LOGIC.AND_ANY && hasSecondaryMatch) {
        return { activated: true, matchedSecondaryKeys };
      }

      // NOT_ALL: 找到任意一个次关键词不匹配即激活
      if (selectiveLogic === WORLD_INFO_LOGIC.NOT_ALL && !hasSecondaryMatch) {
        return { activated: true, matchedSecondaryKeys };
      }
    }

    // NOT_ANY: 没有任何次关键词匹配时才激活
    if (selectiveLogic === WORLD_INFO_LOGIC.NOT_ANY && !hasAnyMatch) {
      return { activated: true, matchedSecondaryKeys };
    }

    // AND_ALL: 所有次关键词都匹配时才激活
    if (selectiveLogic === WORLD_INFO_LOGIC.AND_ALL && hasAllMatch && secondaryKeys.length > 0) {
      return { activated: true, matchedSecondaryKeys };
    }

    return { activated: false, matchedSecondaryKeys };
  }

  private matchSingleKey(key: string, text: string): boolean {
    if (!key) return false;

    let searchText = text;
    let searchKey = key;

    // 大小写处理
    if (!this.options.caseSensitive) {
      searchText = searchText.toLowerCase();
      searchKey = searchKey.toLowerCase();
    }

    // 完整单词匹配
    // 参考：world-info.js L349-L363
    if (this.options.matchWholeWords) {
      // 如果关键词包含多个词，直接用 includes 匹配
      const keyWords = searchKey.split(/\s+/);
      if (keyWords.length > 1) {
        return searchText.includes(searchKey);
      }

      // 单个词使用边界匹配，包含标点符号等非字母数字字符
      const escapedKey = searchKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?:^|\\W)(${escapedKey})(?:$|\\W)`);
      return regex.test(searchText);
    }

    // 子字符串匹配
    return searchText.includes(searchKey);
  }

  private calculateMatchScore(
    entry: WorldBookEntry,
    primaryMatched: string[],
    secondaryMatched: string[]
  ): number {
    let score = 0;

    // 基础分数：主关键词每个 +10 分
    score += primaryMatched.length * 10;

    // 次关键词每个 +5 分
    score += secondaryMatched.length * 5;

    // selective 模式且主次都匹配额外加分
    if (entry.selective && primaryMatched.length > 0 && secondaryMatched.length > 0) {
      score += 20;
    }

    // group 加分
    if (this.options.useGroupScoring && entry.group) {
      score += 5;
    }

    return score;
  }
}

// ==================== 便捷函数 ====================

export function matchWorldBookKeywords(
  entries: WorldBookEntry[],
  text: string,
  options?: KeywordMatchOptions
): KeywordMatchResult[] {
  const matcher = new WorldBookKeywordMatcher(entries, options);
  return matcher.match(text);
}

export function formatKeywordMatchResults(results: KeywordMatchResult[]): string {
  if (results.length === 0) return '';

  return results
    .map((result, index) => {
      const header = `[关键词匹配 ${index + 1}] ${result.entry.comment || result.entry.name} (${result.matchType === 'both' ? '主+次关键词' : result.matchType === 'primary' ? '主关键词' : '次关键词'}, 匹配度: ${result.matchScore})`;
      const keys = `触发关键词: ${result.matchedKeys.join(', ')}`;
      return `${header}\n${keys}\n${result.entry.content}`;
    })
    .join('\n\n---\n\n');
}
