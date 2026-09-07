/**
 * 输出合规检测器 — complianceChecker
 *
 * Spec: enforce-forbidden-words-and-dialogue-naturalness / Task 3
 *
 * 用途：对话响应完成后检测禁词命中（供硬执行层决定重试/替换）。
 * 纯函数 + 编译缓存，无副作用、无 IPC，可安全同步调用（<10ms 量级）。
 *
 * 匹配策略（混合，以简单可靠为先）：
 * - 含 CJK 字符的词：子串匹配（中文无词边界，"冰冷的" 命中 "语气冰冷的"）
 * - 纯 ASCII 词：\b 全词匹配 + 大小写不敏感（"ass" 不误匹配 "class"）
 * - 双语词条适配：默认配置的词格式为 "sacrifice (献祭)"（提示词展示用），
 *   编译时拆解为 ["sacrifice", "献祭"] 两个独立检测词——否则精确匹配永不命中，
 *   硬执行对默认配置形同虚设
 */

import type { ForbiddenWordsConfig, ForbiddenWordCategory, ForbiddenWordsEnforcement } from '@shared/types/forbiddenWords';
import {
  DEFAULT_ENFORCEMENT,
  DEFAULT_REPLACEMENT_TEXT,
  DEFAULT_MAX_RETRIES,
} from '@shared/types/forbiddenWords';

/** 单条命中信息 */
export interface ComplianceHit {
  /** 命中的禁词（拆解后的检测词，非原始词条） */
  word: string;
  /** 所属类别名 */
  category: string;
  /** 首次命中位置（报告用；替换走全量匹配不依赖此值） */
  index: number;
}

/** 合规检测结果 */
export interface ComplianceResult {
  /** 全部命中（跨类别，按内容中出现顺序无关——按词表序） */
  hits: ComplianceHit[];
  /** 无命中时 true（短路：配置无效也返回 clean，硬执行层据此跳过） */
  clean: boolean;
}

/** 编译后的检测词 */
interface CompiledWord {
  /** 检测词原文（用于替换与报告） */
  word: string;
  /** 所属类别名 */
  category: string;
  /** true=ASCII 词用 \b 全词正则；false=含 CJK 用子串匹配 */
  ascii: boolean;
  /** ASCII 词的预编译正则（大小写不敏感 + 全局） */
  regex?: RegExp;
}

/** 编译缓存：同一配置对象引用复用编译结果（Zustand setting 对象在未变更期间引用稳定） */
const compileCache = new WeakMap<object, CompiledWord[]>();

/** CJK 字符检测（含扩展A区与兼容表意文字） */
const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

/** 正则特殊字符转义 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 拆解双语词条："sacrifice (献祭)" → ["sacrifice", "献祭"]。
 * 仅匹配 "xxx (yyy)" 形态（英文空格 + 括号包裹的翻译），其余原样返回。
 */
export function parseWordEntry(word: string): string[] {
  const trimmed = word.trim();
  // 形态：非括号主体 + " (" + 翻译 + ")"
  const m = trimmed.match(/^(.+?)\s*[（(]\s*(.+?)\s*[)）]$/);
  if (m && m[1].trim() && m[2].trim()) {
    return [m[1].trim(), m[2].trim()];
  }
  return trimmed ? [trimmed] : [];
}

/**
 * 编译类别词表为检测词数组（全类别扁平化，保持类别归属）。
 * 结果按配置对象缓存。
 */
export function compileForbiddenWords(categories: ForbiddenWordCategory[]): CompiledWord[] {
  const compiled: CompiledWord[] = [];
  for (const cat of categories) {
    if (!cat?.name || !Array.isArray(cat.words)) continue;
    // 同一类别内去重（拆解后）
    const seen = new Set<string>();
    for (const raw of cat.words) {
      if (typeof raw !== 'string') continue;
      for (const w of parseWordEntry(raw)) {
        if (seen.has(w)) continue;
        seen.add(w);
        const ascii = !CJK_RE.test(w);
        compiled.push(
          ascii
            ? { word: w, category: cat.name, ascii, regex: new RegExp(`\\b${escapeRegExp(w)}\\b`, 'gi') }
            : { word: w, category: cat.name, ascii }
        );
      }
    }
  }
  return compiled;
}

/** 取编译结果（带 WeakMap 缓存）。categories 数组每次渲染可能新建——以 config 对象为缓存键。 */
function getCompiled(config: ForbiddenWordsConfig): CompiledWord[] {
  const cached = compileCache.get(config);
  if (cached) return cached;
  const compiled = compileForbiddenWords(config.categories || []);
  compileCache.set(config, compiled);
  return compiled;
}

/**
 * 检测内容命中禁词的情况。
 *
 * 短路返回 clean：未启用 / 无类别 / 空内容 / 编译结果为空。
 *
 * @param content 待检测文本
 * @param config 禁词配置（须为已启用状态——调用方判定，本函数不重复判 enabled，
 *               以便测试直接构造 categories）
 */
export function checkCompliance(content: string, config: ForbiddenWordsConfig): ComplianceResult {
  if (!content || !config || !config.categories || config.categories.length === 0) {
    return { hits: [], clean: true };
  }
  const compiled = getCompiled(config);
  if (compiled.length === 0) return { hits: [], clean: true };

  const hits: ComplianceHit[] = [];
  for (const cw of compiled) {
    if (cw.ascii && cw.regex) {
      // 重置 lastIndex（全局正则复用必需）
      cw.regex.lastIndex = 0;
      const m = cw.regex.exec(content);
      if (m) hits.push({ word: cw.word, category: cw.category, index: m.index });
    } else {
      const idx = content.indexOf(cw.word);
      if (idx >= 0) hits.push({ word: cw.word, category: cw.category, index: idx });
    }
  }
  return { hits, clean: hits.length === 0 };
}

/**
 * 硬替换：将内容中全部禁词命中替换为 replacementText。
 * 剩余文本（含标点、换行、其他内容）逐字保留。
 */
export function replaceForbiddenWords(
  content: string,
  config: ForbiddenWordsConfig,
  replacementText: string
): string {
  if (!content) return content;
  const compiled = getCompiled(config);
  if (compiled.length === 0) return content;

  let result = content;
  for (const cw of compiled) {
    if (cw.ascii && cw.regex) {
      cw.regex.lastIndex = 0;
      result = result.replace(cw.regex, replacementText);
    } else {
      // 子串全量替换（replaceAll 语义，兼容旧目标可用 split/join）
      result = result.split(cw.word).join(replacementText);
    }
  }
  return result;
}

/** 解析生效执行模式（缺省取默认 'retry-and-replace'） */
export function resolveEnforcement(config?: ForbiddenWordsConfig): ForbiddenWordsEnforcement {
  return config?.enforcement ?? DEFAULT_ENFORCEMENT;
}

/** 解析替换文本（缺省 '***'） */
export function resolveReplacementText(config?: ForbiddenWordsConfig): string {
  return config?.replacementText || DEFAULT_REPLACEMENT_TEXT;
}

/** 解析重试上限（缺省 2，范围钳制 1-5） */
export function resolveMaxRetries(config?: ForbiddenWordsConfig): number {
  const n = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
  return Math.min(5, Math.max(1, Math.floor(n) || DEFAULT_MAX_RETRIES));
}
