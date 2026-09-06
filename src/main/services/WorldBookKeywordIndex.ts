/**
 * 世界书关键词倒排索引（spec §二 Task 11）
 *
 * 任务来源：
 *  - SubTask 11.1：建关键词→条目倒排索引，替代每消息 O(n) 扫描
 *  - SubTask 11.2：索引增量更新（条目增删改时）
 *
 * 设计：
 *  1. **Aho-Corasick 自动机**：对所有主关键词构建 AC 自动机，对文本单趟扫描
 *     即可找出所有出现的主关键词，复杂度 O(|text| + |matches|)，替代原先
 *     「逐条目 × 逐关键词 text.includes」的 O(Σ|key| × |text|) 朴素扫描。
 *     - 子串语义与 text.includes 完全一致（无假阴性）。
 *     - matchWholeWords 模式下，对「单字关键词」补做 \W 边界校验，与
 *       WorldBookKeywordMatcher.matchSingleKey 的正则语义对齐；多字关键词
 *       仍按 includes 处理。
 *  2. **关键词→条目倒排索引**：normalizedKey → Set<uid>，AC 命中关键词后
 *     O(1) 反查候选条目，仅对候选条目运行完整 matchEntry 逻辑。
 *  3. **增量更新（懒重建）**：upsertEntry / removeEntry 仅更新 entries 表并
 *     置 dirty 标志（O(1)），AC 自动机与倒排 Map 在下一次 findCandidateEntries
 *     时统一重建。这样一批编辑只触发一次重建，避免频繁编辑时反复重建。
 *
 * 决策：自研（openclaw 无对应实现，其世界书匹配依赖 SillyTavern world-info.js）。
 * 详见 spec §三决策表。
 */

import type { WorldBookEntry } from '../../renderer/types/worldBook';

// ==================== Aho-Corasick 自动机 ====================

/**
 * 紧凑 Aho-Corasick 自动机。
 *
 * 节点用并行数组表示（children 为 Map<char, nodeId>），相比对象嵌套更省内存、
 * 查询更快。仅暴露 build() 与 search()，内部细节不对外。
 *
 * 字符集：任意字符串（含中文、空格、标点）。大小写由调用方在 build/search 前
 * 统一 normalize（toLowerCase）处理，自动机本身不关心大小写。
 */
class AhoCorasick {
  /** children[nodeId] = Map<char, nodeId> */
  private children: Map<string, number>[] = [];
  /** fail[nodeId]：失败链接 */
  private fail: number[] = [];
  /** output[nodeId]：恰在此节点结束的关键词 */
  private output: string[][] = [];
  /** dictOutput[nodeId]：此节点及经 fail 链可达的所有关键词（预计算，search O(1)） */
  private dictOutput: string[][] = [];
  private built = false;

  constructor() {
    this.ensureNode(0); // root
    this.fail[0] = 0;
  }

  private ensureNode(id: number): void {
    while (this.children.length <= id) {
      this.children.push(new Map());
      this.fail.push(0);
      this.output.push([]);
      this.dictOutput.push([]);
    }
  }

  /** 插入一个关键词（已 normalize）。重复插入等价于一次。 */
  insert(keyword: string): void {
    if (!keyword) return;
    let node = 0;
    for (const ch of keyword) {
      let next = this.children[node].get(ch);
      if (next === undefined) {
        next = this.children.length;
        this.ensureNode(next);
        this.children[node].set(ch, next);
      }
      node = next;
    }
    if (!this.output[node].includes(keyword)) {
      this.output[node].push(keyword);
    }
    this.built = false;
  }

  /** 构建 fail 链接与 dictOutput（BFS）。插入完所有关键词后调用一次。 */
  build(): void {
    const queue: number[] = [];
    // 第一层：root 的直接子节点，fail 指向 root
    for (const [, child] of this.children[0]) {
      this.fail[child] = 0;
      queue.push(child);
    }
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      const fu = this.fail[u];
      // dictOutput = 自身 output ∪ fail 的 dictOutput
      this.dictOutput[u] = this.output[u].concat(this.dictOutput[fu]);
      for (const [ch, v] of this.children[u]) {
        // 沿 fail 链找第一个有 ch 子节点的祖先
        let f = fu;
        while (f !== 0 && !this.children[f].has(ch)) {
          f = this.fail[f];
        }
        const target = this.children[f].get(ch);
        this.fail[v] = target !== undefined && target !== v ? target : 0;
        queue.push(v);
      }
    }
    this.built = true;
  }

  /**
   * 在 text（已 normalize）中扫描，返回每个命中的关键词及其结束位置（exclusive）。
   * 同一关键词多次出现会多次返回（调用方按需去重）。
   */
  search(text: string): Array<{ keyword: string; end: number }> {
    if (!this.built) this.build();
    const results: Array<{ keyword: string; end: number }> = [];
    if (!text) return results;
    let node = 0;
    let i = 0;
    for (const ch of text) {
      while (node !== 0 && !this.children[node].has(ch)) {
        node = this.fail[node];
      }
      const next = this.children[node].get(ch);
      if (next !== undefined) {
        node = next;
      }
      const outs = this.dictOutput[node];
      if (outs.length > 0) {
        const end = i + 1;
        for (const kw of outs) {
          results.push({ keyword: kw, end });
        }
      }
      i += 1;
    }
    return results;
  }

  /** 节点数（诊断用）。 */
  get size(): number {
    return this.children.length;
  }
}

// ==================== 关键词倒排索引 ====================

/**
 * 倒排索引中单个关键词的归属信息。
 * primaryUids：以该关键词为主关键词的条目 uid 集合。
 */
interface KeywordIndexValue {
  primaryUids: Set<number>;
  /** 该关键词是否为「单字关键词」（用于 whole-word 边界判定） */
  isSingleWord: boolean;
  /** 关键词长度（normalize 后） */
  length: number;
}

/** 候选筛选选项（与 KeywordMatchOptions 对齐） */
export interface CandidateOptions {
  caseSensitive: boolean;
  matchWholeWords: boolean;
}

/** 重建统计（诊断 / 测试用） */
export interface IndexStats {
  entryCount: number;
  distinctPrimaryKeys: number;
  acNodes: number;
  dirty: boolean;
  lastBuildMs: number;
  lastBuildAt: number | null;
}

/**
 * 世界书关键词倒排索引。
 *
 * 生命周期：
 *  - rebuild(entries)：批量替换所有条目（置 dirty）
 *  - upsertEntry / removeEntry：增量变更（O(1)，置 dirty）
 *  - findCandidateEntries(text, options)：若 dirty 则先重建，再 AC 扫描文本
 *    返回「主关键词在文本中出现」的候选条目集合。
 *
 * 不负责 selectiveLogic / probability 等业务判定——那是 WorldBookKeywordMatcher
 * 的事。本类只做候选筛选，保证零假阴性（候选集 ⊇ 真正应激活的条目）。
 */
export class WorldBookKeywordIndex {
  /** uid → entry（始终当前，增量更新直接改这里） */
  private readonly entries = new Map<number, WorldBookEntry>();
  /** normalizedKey → 归属信息（重建产物） */
  private primaryKeyIndex = new Map<string, KeywordIndexValue>();
  /** AC 自动机（按 caseSensitive 重建） */
  private ac: AhoCorasick | null = null;
  /** 脏标志：entries 变更后置 true，findCandidateEntries 时重建 */
  private dirty = true;
  /** 当前 options（caseSensitive/matchWholeWords）— 仅用于决定是否需重建 AC */
  private lastOptions: CandidateOptions | null = null;

  private stats: IndexStats = {
    entryCount: 0,
    distinctPrimaryKeys: 0,
    acNodes: 0,
    dirty: true,
    lastBuildMs: 0,
    lastBuildAt: null,
  };

  /** 批量替换所有条目并标记需重建。 */
  rebuild(entries: Iterable<WorldBookEntry>): void {
    this.entries.clear();
    for (const e of entries) {
      if (!isEntryDisabled(e)) {
        this.entries.set(e.uid, e);
      }
    }
    this.dirty = true;
  }

  /**
   * 增量新增/更新单个条目（O(1)）。
   * 禁用的条目视为删除。
   */
  upsertEntry(entry: WorldBookEntry): void {
    if (isEntryDisabled(entry)) {
      this.removeEntry(entry.uid);
      return;
    }
    this.entries.set(entry.uid, entry);
    this.dirty = true;
  }

  /** 增量删除单个条目（O(1)）。 */
  removeEntry(uid: number): void {
    if (this.entries.delete(uid)) {
      this.dirty = true;
    }
  }

  /** 当前条目数。 */
  get size(): number {
    return this.entries.size;
  }

  /**
   * 所有常驻（constant/蓝灯）条目。
   *
   * 【constant 支持 - Spec: fix-dialogue-worldbook-association-and-tag-output】
   * 常驻条目不依赖关键词激活（SillyTavern 蓝灯语义），由 WorldBookKeywordMatcher.match
   * 直接并入结果。索引层已在 rebuild/upsertEntry 过滤禁用条目，此处无需重复判断。
   */
  getConstantEntries(): WorldBookEntry[] {
    const constants: WorldBookEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.constant === true) {
        constants.push(entry);
      }
    }
    return constants;
  }

  /** 是否有未重建的变更。 */
  get isDirty(): boolean {
    return this.dirty;
  }

  getStats(): IndexStats {
    return { ...this.stats, dirty: this.dirty };
  }

  /**
   * 找出主关键词在 text 中出现的所有候选条目。
   *
   * 保证：若某条目最终应被 matchEntry 激活，其主关键词必在 text 中出现 →
   * 必在候选集内（零假阴性）。候选集可能略大于真正激活集（假阳性由
   * matchEntry 的 selectiveLogic / probability 过滤）。
   *
   * @param text 待扫描文本
   * @param options 大小写 / 整词选项
   * @returns 候选条目数组（按 uid 升序，调用方按需重排）
   */
  findCandidateEntries(text: string, options: CandidateOptions): WorldBookEntry[] {
    if (!text) return [];
    this.ensureBuilt(options);

    if (this.ac === null || this.primaryKeyIndex.size === 0) {
      return [];
    }

    const normalizedText = options.caseSensitive ? text : text.toLowerCase();
    const hits = this.ac.search(normalizedText);
    if (hits.length === 0) return [];

    // 关键词 → 是否通过边界校验（whole-word 模式下需校验）
    // 用 Map 去重：同一关键词多次命中只校验一次。
    const acceptedKeys = new Set<string>();
    for (const { keyword, end } of hits) {
      const idx = this.primaryKeyIndex.get(keyword);
      if (!idx) continue; // 该关键词不属于任何条目主关键词（理论上不会发生）
      if (options.matchWholeWords && idx.isSingleWord) {
        if (this.checkWordBoundary(normalizedText, end, idx.length)) {
          acceptedKeys.add(keyword);
        }
      } else {
        acceptedKeys.add(keyword);
      }
    }
    if (acceptedKeys.size === 0) return [];

    // 反查候选 uid
    const candidateUids = new Set<number>();
    for (const key of acceptedKeys) {
      const idx = this.primaryKeyIndex.get(key);
      if (idx) {
        for (const uid of idx.primaryUids) {
          candidateUids.add(uid);
        }
      }
    }

    const candidates: WorldBookEntry[] = [];
    for (const uid of candidateUids) {
      const entry = this.entries.get(uid);
      if (entry) candidates.push(entry);
    }
    // 稳定排序：按 uid 升序，便于测试断言
    candidates.sort((a, b) => a.uid - b.uid);
    return candidates;
  }

  /**
   * 整词边界校验（仅对单字关键词生效）。
   *
   * 与 WorldBookKeywordMatcher.matchSingleKey 的正则 `(?:^|\W)(key)(?:$|\W)`
   * 语义对齐：关键词前后字符必须是 \W（非 [A-Za-z0-9_]）或字符串边界。
   * 注意：中文字符属于 \W，因此整词模式对中文等价于子串匹配——这是与现有
   * 实现一致的刻意保留，勿改。
   */
  private checkWordBoundary(normalizedText: string, end: number, keyLen: number): boolean {
    const start = end - keyLen;
    if (start < 0) return false;
    const before = start === 0 ? null : normalizedText[start - 1];
    const after = end >= normalizedText.length ? null : normalizedText[end];
    const isBoundary = (c: string | null): boolean => c === null || /[^A-Za-z0-9_]/.test(c);
    return isBoundary(before) && isBoundary(after);
  }

  /** 若 dirty 或 options 变化，重建 AC 与倒排 Map。 */
  private ensureBuilt(options: CandidateOptions): void {
    const optionsChanged =
      this.lastOptions === null ||
      this.lastOptions.caseSensitive !== options.caseSensitive ||
      this.lastOptions.matchWholeWords !== options.matchWholeWords;

    if (!this.dirty && !optionsChanged && this.ac !== null) {
      return;
    }

    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.buildIndex(options.caseSensitive);
    const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    this.dirty = false;
    this.lastOptions = { ...options };
    this.stats = {
      entryCount: this.entries.size,
      distinctPrimaryKeys: this.primaryKeyIndex.size,
      acNodes: this.ac ? this.ac.size : 0,
      dirty: false,
      lastBuildMs: Math.max(0, t1 - t0),
      lastBuildAt: Date.now(),
    };
  }

  /**
   * 重建倒排 Map 与 AC 自动机。
   *
   * 每次全量重建而非逐条增量——理由：AC 自动机难以高效「删除/改」某关键词，
   * 必须重建；倒排 Map 虽可增量，但与 AC 同源，统一重建保证一致性。配合
   * dirty 懒重建，一批编辑只触发一次重建，编辑频率远低于匹配频率，摊销成本低。
   */
  private buildIndex(caseSensitive: boolean): void {
    this.primaryKeyIndex = new Map();
    const ac = new AhoCorasick();

    for (const entry of this.entries.values()) {
      const primaryKeys = getEffectivePrimaryKeys(entry);
      for (const rawKey of primaryKeys) {
        const trimmed = rawKey.trim();
        if (!trimmed) continue;
        const normalized = caseSensitive ? trimmed : trimmed.toLowerCase();
        let val = this.primaryKeyIndex.get(normalized);
        if (!val) {
          val = {
            primaryUids: new Set<number>(),
            isSingleWord: trimmed.split(/\s+/).length === 1,
            length: normalized.length,
          };
          this.primaryKeyIndex.set(normalized, val);
        }
        val.primaryUids.add(entry.uid);
        ac.insert(normalized);
      }
    }
    ac.build();
    this.ac = ac;
  }
}

// ==================== 辅助函数 ====================

/**
 * 条目禁用判定（双字段统一 - Spec: fix-dialogue-worldbook-association-and-tag-output）。
 *
 * 背景：类型中 `disable` 与 `enabled` 两字段并存（不同导入来源使用不同字段表达禁用），
 * 原判定只认 `disable:true`，导致仅以 `enabled:false` 表达禁用的条目被误触发。
 * 统一语义：`disable === true || enabled === false` 视为禁用。
 */
export function isEntryDisabled(entry: WorldBookEntry): boolean {
  return entry.disable === true || entry.enabled === false;
}

/**
 * 取条目主关键词。供 WorldBookKeywordMatcher 复用，保证两边取值一致。
 * 与 SillyTavern world-info.js 的 key/keys 兼容逻辑对齐。
 */
export function getEffectivePrimaryKeys(entry: WorldBookEntry): string[] {
  return entry.key || entry.keys || [];
}

/**
 * 取条目次关键词。供 WorldBookKeywordMatcher 复用。
 */
export function getEffectiveSecondaryKeys(entry: WorldBookEntry): string[] {
  return entry.keysecondary || entry.secondary_keys || [];
}
