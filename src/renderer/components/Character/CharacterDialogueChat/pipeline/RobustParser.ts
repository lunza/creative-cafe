/**
 * 逻辑兼容性层 — RobustParser
 *
 * Spec: redesign-dialogue-pipeline-architecture / RobustParser
 *
 * 强大的 AI 输出解析器，保证在 AI 生成文本不稳定时仍能正确识别意图和执行后处理。
 * 提供多模式正则匹配、模糊关键词 proximity 匹配、残留碎片清理三大能力。
 *
 * 同时暴露静态模式集合（EXPRESSION_PATTERNS / SUGGESTED_OPTIONS_PATTERNS /
 * TABLE_EDIT_PATTERNS），供 AIIntentRecognizer 和 PostProcessPlugins 复用。
 */

import type { ParsePattern, ParseResult } from './pipeline.types';

export class RobustParser {
  // ===== 核心方法 =====

  /**
   * 多模式匹配：按 patterns 数组顺序依次尝试正则，返回首个匹配结果。
   * 每个 pattern 包含 name、regex、extractor 三部分。
   *
   * @param content 待解析的文本
   * @param patterns 有序正则模式列表（按优先级排列）
   * @returns 首个匹配结果，全部失败时返回 null
   */
  match(content: string, patterns: ParsePattern[]): ParseResult | null {
    if (!content || typeof content !== 'string') {
      return null;
    }

    for (const pattern of patterns) {
      // 重置 lastIndex（防止带 g 标志的正则在多次调用时状态残留）
      pattern.regex.lastIndex = 0;
      const m = content.match(pattern.regex);
      if (m) {
        const extracted = pattern.extractor(m);
        return {
          data: extracted.data,
          rawMatch: extracted.rawMatch,
        };
      }
    }

    return null;
  }

  /**
   * 模糊匹配：当精确正则模式全部失败时，使用关键词 proximity 匹配。
   * 在 content 中搜索所有关键词，若关键词在 proximity 字符范围内彼此接近，
   * 则提取关键词之间的文本作为 data。
   *
   * @param content 待解析的文本
   * @param keywords 关键词列表（需全部出现才算匹配）
   * @param proximity 关键词之间的最大字符距离
   * @returns 匹配结果，无法匹配时返回 null
   */
  fuzzyMatch(content: string, keywords: string[], proximity: number): ParseResult | null {
    if (!content || typeof content !== 'string' || keywords.length === 0) {
      return null;
    }

    // 查找每个关键词在内容中的首次出现位置
    const positions: Array<{ keyword: string; index: number }> = [];
    for (const keyword of keywords) {
      const idx = content.indexOf(keyword);
      if (idx === -1) {
        // 任一关键词缺失即匹配失败
        return null;
      }
      positions.push({ keyword, index: idx });
    }

    // 按位置排序
    positions.sort((a, b) => a.index - b.index);

    // 检查相邻关键词间距是否都在 proximity 范围内
    for (let i = 1; i < positions.length; i++) {
      const gap = positions[i].index - (positions[i - 1].index + positions[i - 1].keyword.length);
      if (gap > proximity) {
        return null;
      }
    }

    // 提取最左关键词起点到最右关键词终点之间的文本
    const startIndex = positions[0].index;
    const endIndex = positions[positions.length - 1].index + positions[positions.length - 1].keyword.length;
    const rawMatch = content.substring(startIndex, endIndex);

    // 提取关键词之间的内容作为 data
    const innerStart = positions[0].index + positions[0].keyword.length;
    const innerEnd = positions[positions.length - 1].index;
    const innerText = content.substring(innerStart, innerEnd).trim();

    return {
      data: { text: innerText },
      rawMatch,
    };
  }

  /**
   * 清理残留碎片：移除匹配后遗留的孤立标记字符（如 <<>> 等残缺标记碎片）。
   *
   * @param content 已移除主匹配后的文本
   * @param residuePattern 残留碎片的正则模式
   * @returns 清理并 trim 后的文本
   */
  cleanup(content: string, residuePattern: RegExp): string {
    if (!content) return '';
    return content.replace(residuePattern, '').trim();
  }

  // ===== 静态模式集合 =====

  /**
   * 表情情绪标签解析模式集合。
   * 迁移自 PromptBuilder.ts::parseExpressionFromContent。
   *
   * 匹配优先级：
   * 1. 主格式：<<<EXPRESSION>>>key<<<END_EXPRESSION>>>（大小写不敏感）
   * 2. 容错：仅有开始标记 <<<EXPRESSION>>>key 到文本末尾
   * 3. ⚠️ 容错：AI 输出残缺标记（如 <<>>key<<<_EXPRESSION>>>）
   * 4. ⚠️ 容错：残缺开始标记 + key 到末尾（无结束标记）
   * 5. ⚠️ 终极兜底：key 在 EXPRESSION 之前
   * 6. ⚠️ 终极兜底：key 在 EXPRESSION 之后
   * 7. 兼容变体：纯标签 <expression>key</expression>
   * 8. 兼容变体：仅有 <expression>key 到末尾
   */
  static readonly EXPRESSION_PATTERNS: ParsePattern[] = [
    // 1. 主格式：<<<EXPRESSION>>>key<<<END_EXPRESSION>>>（大小写不敏感）
    {
      name: 'text-marker',
      regex: /<<<EXPRESSION>>>\s*([a-z_][a-z0-9_]*)\s*<<<END_EXPRESSION>>>/i,
      extractor: (m) => ({
        data: { emotion: m[1].toLowerCase() },
        rawMatch: m[0],
      }),
    },
    // 2. 容错：仅有开始标记 <<<EXPRESSION>>>key 到文本末尾
    {
      name: 'text-marker-unclosed',
      regex: /<<<EXPRESSION>>>\s*([a-z_][a-z0-9_]*)\s*$/i,
      extractor: (m) => ({
        data: { emotion: m[1].toLowerCase() },
        rawMatch: m[0],
      }),
    },
    // 3. ⚠️ 容错：AI 输出残缺标记（如 <<>>key<<<_EXPRESSION>>>）
    //    策略：忽略尖括号数量，匹配 EXPRESSION 字样前后的有效情绪键名
    {
      name: 'text-marker-malformed',
      regex: /[<>_]+EXPRESSION[<>_]+\s*([a-z_][a-z0-9_]*)\s*[<>_]+(?:END[_]*EXPRESSION|EXPRESSION)[<>_]+/i,
      extractor: (m) => ({
        data: { emotion: m[1].toLowerCase() },
        rawMatch: m[0],
      }),
    },
    // 4. ⚠️ 容错：残缺开始标记 + key 到末尾（无结束标记）
    {
      name: 'text-marker-malformed-unclosed',
      regex: /[<>_]+EXPRESSION[<>_]+\s*([a-z_][a-z0-9_]*)\s*$/i,
      extractor: (m) => ({
        data: { emotion: m[1].toLowerCase() },
        rawMatch: m[0],
      }),
    },
    // 5. ⚠️ 终极兜底：key 在 EXPRESSION 之前（文本末尾出现 EXPRESSION 字样）
    {
      name: 'text-marker-fallback-before',
      regex: /\b([a-z_][a-z0-9_]*)\s*[<>_]+(?:END[_]*EXPRESSION|EXPRESSION)[<>_]+\s*$/i,
      extractor: (m) => ({
        data: { emotion: m[1].toLowerCase() },
        rawMatch: m[0],
      }),
    },
    // 6. ⚠️ 终极兜底：key 在 EXPRESSION 之后
    {
      name: 'text-marker-fallback-after',
      regex: /EXPRESSION[<>_]+\s*([a-z_][a-z0-9_]*)\s*[<>_]*\s*$/i,
      extractor: (m) => ({
        data: { emotion: m[1].toLowerCase() },
        rawMatch: m[0],
      }),
    },
    // 7. 兼容变体：纯标签 <expression>key</expression>
    {
      name: 'plain-tag',
      regex: /<expression>\s*([a-z_][a-z0-9_]*)\s*<\/expression>/i,
      extractor: (m) => ({
        data: { emotion: m[1].toLowerCase() },
        rawMatch: m[0],
      }),
    },
    // 8. 兼容变体：仅有 <expression>key 到末尾
    {
      name: 'plain-tag-unclosed',
      regex: /<expression>\s*([a-z_][a-z0-9_]*)\s*$/i,
      extractor: (m) => ({
        data: { emotion: m[1].toLowerCase() },
        rawMatch: m[0],
      }),
    },
  ];

  /**
   * 辅助模式推荐选项解析模式集合。
   * 迁移自 CharacterDialogueChat.hooks.ts 中的 optionPatterns。
   *
   * 【重点标记】修复：原仅匹配 HTML 注释格式，多数 AI 模型不生成 HTML 注释导致功能失效。
   * 改用多格式容错匹配：优先匹配 <<<SUGGESTED_OPTIONS>>> 文本标记格式，
   * 回退匹配 HTML 注释、纯标签、方括号等变体。
   *
   * 匹配优先级：
   * 1. 主格式：<<<SUGGESTED_OPTIONS>>> ... <<<END_OPTIONS>>>
   * 2. 容错：仅有开始标记到文本末尾
   * 3. 兼容旧格式：HTML 注释包裹
   * 4. 容错：仅有开始标签到末尾
   * 5. 兼容变体：纯标签
   * 6. 兼容变体：方括号
   */
  static readonly SUGGESTED_OPTIONS_PATTERNS: ParsePattern[] = [
    // 1. 主格式：<<<SUGGESTED_OPTIONS>>> ... <<<END_OPTIONS>>>
    {
      name: 'text-marker',
      regex: /<<<SUGGESTED_OPTIONS>>>\s*([\s\S]*?)<<<END_OPTIONS>>>/i,
      extractor: (m) => ({
        data: { optionsText: m[1] },
        rawMatch: m[0],
      }),
    },
    // 2. 容错：仅有开始标记 <<<SUGGESTED_OPTIONS>>> 到文本末尾（AI 遗漏结束标记或被截断）
    {
      name: 'text-marker-unclosed',
      regex: /<<<SUGGESTED_OPTIONS>>>\s*([\s\S]*?)$/i,
      extractor: (m) => ({
        data: { optionsText: m[1] },
        rawMatch: m[0],
      }),
    },
    // 3. 兼容旧格式：<!-- <suggestedOptions> ... </suggestedOptions> -->
    {
      name: 'html-comment',
      regex: /<!--\s*<suggestedOptions>([\s\S]*?)<\/suggestedOptions>\s*-->/i,
      extractor: (m) => ({
        data: { optionsText: m[1] },
        rawMatch: m[0],
      }),
    },
    // 4. 容错：仅有 <suggestedOptions> 开始标签到末尾
    {
      name: 'plain-tag-unclosed',
      regex: /<suggestedOptions>([\s\S]*?)$/i,
      extractor: (m) => ({
        data: { optionsText: m[1] },
        rawMatch: m[0],
      }),
    },
    // 5. 兼容变体：纯标签 <suggestedOptions> ... </suggestedOptions>
    {
      name: 'plain-tag',
      regex: /<suggestedOptions>([\s\S]*?)<\/suggestedOptions>/i,
      extractor: (m) => ({
        data: { optionsText: m[1] },
        rawMatch: m[0],
      }),
    },
    // 6. 兼容变体：方括号 [suggested_options] ... [/suggested_options]
    {
      name: 'bracket-tag',
      regex: /\[suggested_options\]\s*([\s\S]*?)\[\/suggested_options\]/i,
      extractor: (m) => ({
        data: { optionsText: m[1] },
        rawMatch: m[0],
      }),
    },
  ];

  /**
   * 表格编辑命令标签解析模式集合。
   * 迁移自 CharacterDialogueChat.hooks.ts 中的 tableEditPatterns。
   *
   * 匹配优先级：
   * 1. 标准格式：HTML 注释 + 标签 <!-- <tableEdit>...</tableEdit> -->
   * 2. 无注释格式：纯标签 <tableEdit>...</tableEdit>
   * 3. 注释分隔格式：<!-- tableEdit -->...<!-- /tableEdit -->
   */
  static readonly TABLE_EDIT_PATTERNS: ParsePattern[] = [
    // 1. 标准格式(HTML注释+标签)
    {
      name: 'html-comment-tag',
      regex: /<!--\s*<tableEdit>([\s\S]*?)<\/tableEdit>\s*-->/gi,
      extractor: (m) => ({
        data: { commandsText: m[1] },
        rawMatch: m[0],
      }),
    },
    // 2. 无注释格式(纯标签)
    {
      name: 'plain-tag',
      regex: /<tableEdit>([\s\S]*?)<\/tableEdit>/gi,
      extractor: (m) => ({
        data: { commandsText: m[1] },
        rawMatch: m[0],
      }),
    },
    // 3. 注释分隔格式
    {
      name: 'comment-delimited',
      regex: /<!--\s*tableEdit\s*-->([\s\S]*?)<!--\s*\/tableEdit\s*-->/gi,
      extractor: (m) => ({
        data: { commandsText: m[1] },
        rawMatch: m[0],
      }),
    },
  ];
}
