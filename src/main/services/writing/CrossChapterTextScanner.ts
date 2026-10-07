/**
 * 跨章文本雷同扫描器（纯函数，无 IO）
 * Spec: add-cross-chapter-coherence-review
 *
 * 职责：text_repetition（文本重复）的确定性检测，零 token 成本、位置精确到句。
 *
 * 算法（短语级公共子串匹配，而非整句相似度）：
 * 五章实测（见 CODE_WIKI 跨章审查条目）表明，中文网文跨章重复的形态是
 * "同一短语在不同句中复现"（如"那张宽大的双人床上"、"像是一台不知疲倦的打桩机"），
 * 整句相似度（Jaccard）对这类部分重叠的重复严重低估（同场景重写的两句整句
 * Jaccard 仅 ~0.2），无法命中。因此采用：
 *   1. 句级切分（句末标点，保留 ≥8 字句）
 *   2. 归一化（去空白与标点）后，用 5-gram 倒排索引找出两章间所有公共子串起点
 *   3. 从每个起点双向扩展得到最长公共片段（≥5 字）
 *   4. 命中判据（similarityThreshold 映射到最小片段长度，阈值越高要求片段越长）：
 *      - 较长句对：最长公共片段 ≥ minLong（默认 0.75→6 字），
 *        或 ≥2 个互不重叠的公共片段（各 ≥ minShort，默认 0.75→4 字）
 *        ——双片段规则捕获"层层叠叠的 + 粗暴地抚平"这类拆散在句中的复现
 *      - 短句对（较短句 ≤15 字）：要求匹配字符占比 ≥ 0.85（近似整句复制才算，
 *        防常见短语误报，对应 spec 的短句高阈值条款）
 *   5. 仅比较 |i-j| ≤ distance 的章节对（含章内 i===j）
 *   6. 同一章节对的多组雷同句合并为一条 issue（≤3 组示例），severity 按章节距离
 */
import {
  CrossCheckIssue,
  CrossCheckSeverity,
} from '../../../shared/types/cross-chapter-review.types';

export interface ScannerChapter {
  /** 0 基数组位置（project.outline.chapters 下标） */
  position: number;
  title: string;
  content: string;
}

export interface ScannerOptions {
  /** 章节比对距离（含章内；|i-j| ≤ distance 才比较） */
  distance: number;
  /** 文本相似度阈值 0.50-0.95（映射到最小公共片段长度） */
  similarityThreshold: number;
}

interface Sentence {
  /** 原句（含标点） */
  text: string;
  /** 归一化文本（去空白与标点，仅留汉字/字母/数字） */
  norm: string;
}

/** 归一化：仅保留汉字/字母/数字（跨章重复比对时标点与空白不参与匹配） */
export function normalizeText(s: string): string {
  return s.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '');
}

const MIN_SENTENCE_LEN = 8;
const GRAM = 5;
/** 句末标点（含换行，段落边界也是句子边界） */
const SENTENCE_END = /[。！？!?；…\n]/;

/** 句级切分：按句末标点切句，保留归一化后 ≥8 字的句子 */
export function splitSentences(content: string): Sentence[] {
  const out: Sentence[] = [];
  let buf = '';
  const flush = () => {
    const text = buf.trim();
    buf = '';
    if (!text) return;
    const norm = normalizeText(text);
    if (norm.length >= MIN_SENTENCE_LEN) {
      out.push({ text, norm });
    }
  };
  for (const ch of content) {
    if (SENTENCE_END.test(ch)) {
      buf += ch;
      flush();
    } else {
      buf += ch;
    }
  }
  flush();
  return out;
}

interface MatchRecord {
  si: number;
  sj: number;
  /** 在句 si / 句 sj 归一化文本中的起点 */
  startA: number;
  startB: number;
  len: number;
}

/**
 * 找出两章（或同章）句子间的所有最长公共片段。
 * 用 GRAM-gram 倒排索引定位公共起点，再从起点线性扩展。
 */
function findMatches(sentsA: Sentence[], sentsB: Sentence[], sameChapter: boolean): MatchRecord[] {
  // 倒排：gram -> [句内偏移] 列表（按句子序号分组存储）
  const indexB = new Map<string, { si: number; offset: number }[]>();
  sentsB.forEach((s, si) => {
    for (let o = 0; o + GRAM <= s.norm.length; o++) {
      const g = s.norm.substring(o, o + GRAM);
      let arr = indexB.get(g);
      if (!arr) {
        arr = [];
        indexB.set(g, arr);
      }
      arr.push({ si, offset: o });
    }
  });

  const raw: MatchRecord[] = [];
  sentsA.forEach((sa, si) => {
    for (let o = 0; o + GRAM <= sa.norm.length; o++) {
      const g = sa.norm.substring(o, o + GRAM);
      const hits = indexB.get(g);
      if (!hits) continue;
      for (const hb of hits) {
        // 同章：只保留 (小序号, 大序号) 一种顺序，避免同一物理片段被双向记录
        if (sameChapter && si > hb.si) continue;
        // 同章同句同位置：同一处文本自身，跳过
        if (sameChapter && si === hb.si && o === hb.offset) continue;
        // 同章同句内部重复：要求不重叠（B 在 A 之后）
        if (sameChapter && si === hb.si) {
          if (hb.offset < o) continue; // 只保留 (o, hb.offset) 一种顺序
          if (hb.offset < o + GRAM) continue; // 重叠片段跳过
        }
        // 从起点扩展最长公共片段
        let len = GRAM;
        while (
          o + len < sa.norm.length &&
          hb.offset + len < sentsB[hb.si].norm.length &&
          sa.norm[o + len] === sentsB[hb.si].norm[hb.offset + len]
        ) {
          len++;
        }
        raw.push({ si, sj: hb.si, startA: o, startB: hb.offset, len });
      }
    }
  });

  // 去包含：按长度降序，被已保留片段覆盖（同句对内包含）的丢弃
  raw.sort((x, y) => y.len - x.len);
  const kept: MatchRecord[] = [];
  for (const m of raw) {
    const subsumed = kept.some(
      (k) =>
        k.si === m.si &&
        k.sj === m.sj &&
        m.startA >= k.startA &&
        m.startA + m.len <= k.startA + k.len &&
        m.startB >= k.startB &&
        m.startB + m.len <= k.startB + k.len
    );
    if (!subsumed) kept.push(m);
  }
  return kept;
}

interface SentencePairGroup {
  si: number;
  sj: number;
  /** 该句对内保留的最长公共片段（按长度降序，去包含后互不包含） */
  matches: MatchRecord[];
  maxLen: number;
  /** 匹配字符总数（近似：片段长度求和） */
  matchedChars: number;
  minNormLen: number;
}

/** 命中判据：阈值映射到最小公共片段长度；短句对要求近似整句复制 */
function isHit(group: SentencePairGroup, threshold: number): boolean {
  const matchedRatio = group.matchedChars / group.minNormLen;
  if (group.minNormLen <= 15) {
    // 短句对：匹配占比 ≥0.85（近似整句复制）才算，防常见短语误报
    return matchedRatio >= 0.85;
  }
  const minLong = Math.max(4, Math.round(8 * threshold));
  const minShort = Math.max(3, Math.round(5 * threshold));
  const longHit = group.maxLen >= minLong;
  const shortPhrases = group.matches.filter((m) => m.len >= minShort);
  const multiHit = shortPhrases.length >= 2;
  return longHit || multiHit;
}

function severityForDistance(distance: number): CrossCheckSeverity {
  if (distance <= 0) return 'medium';
  if (distance === 1) return 'high';
  if (distance === 2) return 'medium';
  return 'low';
}

/**
 * 跨章文本雷同扫描（纯函数入口）
 * @returns text_repetition 问题列表（每章节对至多一条，≤3 组示例）
 */
export function scanTextRepetition(chapters: ScannerChapter[], options: ScannerOptions): CrossCheckIssue[] {
  const { distance, similarityThreshold } = options;
  const issues: CrossCheckIssue[] = [];
  const prepared = chapters.map((c) => ({
    position: c.position,
    title: c.title,
    sentences: splitSentences(c.content),
  }));

  for (let i = 0; i < prepared.length; i++) {
    for (let j = i; j < prepared.length; j++) {
      const gap = j - i;
      if (gap > distance) continue;
      const A = prepared[i];
      const B = prepared[j];
      if (A.sentences.length === 0 || B.sentences.length === 0) continue;

      const matches = findMatches(A.sentences, B.sentences, i === j);
      if (matches.length === 0) continue;

      // 按句对分组
      const groupKey = (si: number, sj: number) =>
        i === j ? `${Math.min(si, sj)}|${Math.max(si, sj)}` : `${si}|${sj}`;
      const groups = new Map<string, MatchRecord[]>();
      for (const m of matches) {
        const key = groupKey(m.si, m.sj);
        let arr = groups.get(key);
        if (!arr) {
          arr = [];
          groups.set(key, arr);
        }
        arr.push(m);
      }

      const hitGroups: SentencePairGroup[] = [];
      for (const [, ms] of groups) {
        const si = ms[0].si;
        const sj = ms[0].sj;
        const sa = A.sentences[si];
        const sb = B.sentences[sj];
        const maxLen = Math.max(...ms.map((m) => m.len));
        const matchedChars = ms.reduce((sum, m) => sum + m.len, 0);
        const minNormLen = Math.min(sa.norm.length, sb.norm.length);
        const group: SentencePairGroup = {
          si,
          sj,
          matches: ms,
          maxLen,
          matchedChars,
          minNormLen,
        };
        if (isHit(group, similarityThreshold)) hitGroups.push(group);
      }
      if (hitGroups.length === 0) continue;

      hitGroups.sort((a, b) => b.maxLen - a.maxLen);
      const top = hitGroups[0];
      const topA = A.sentences[top.si];
      const topB = B.sentences[top.sj];

      const similarPairs = hitGroups.slice(0, 3).map((g) => {
        const ga = A.sentences[g.si];
        const gb = B.sentences[g.sj];
        const m = g.matches[0];
        return {
          a: ga.text,
          b: gb.text,
          phrase: ga.norm.substring(m.startA, m.startA + m.len),
          similarity: Math.min(1, Math.round((g.matchedChars / g.minNormLen) * 100) / 100),
        };
      });

      const sameChapter = i === j;
      issues.push({
        id: `local-${A.position}-${B.position}`,
        type: 'text_repetition',
        severity: severityForDistance(gap),
        description: sameChapter
          ? `「${A.title}」内部存在 ${hitGroups.length} 组雷同文本（最长公共片段 ${top.maxLen} 字）`
          : `「${A.title}」与「${B.title}」存在 ${hitGroups.length} 组雷同文本（最长公共片段 ${top.maxLen} 字）`,
        chapterA: { index: A.position, title: A.title, quote: topA.text, located: true },
        chapterB: { index: B.position, title: B.title, quote: topB.text, located: true },
        source: 'local',
        maxPhraseLen: top.maxLen,
        similarPairs,
      });
    }
  }

  return issues;
}
