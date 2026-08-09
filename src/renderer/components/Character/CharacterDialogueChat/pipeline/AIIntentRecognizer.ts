/**
 * AI 意图识别模块 — AIIntentRecognizer
 *
 * Spec: redesign-dialogue-pipeline-architecture / IntentRecognizer
 *
 * 扫描 AI 响应内容，识别所有结构化标签意图（expression / suggested_options /
 * table_edit / think_tag / image_generation），返回 DetectedIntent[]。
 * 使用 RobustParser 进行多格式容错匹配，保证在 AI 生成文本不稳定时仍能正确识别意图。
 *
 * - detect：扫描内容中所有标签类型，返回检测到的意图数组
 * - stripIntents：从内容中剥离所有已识别标签，返回纯净叙事内容
 * - getIntentRouter：返回空的意图路由表（由 ExtensionRegistry 注册处理器）
 */

import type {
  AIIntentType,
  DetectedIntent,
  IntentHandler,
  ParsePattern,
  ParseResult,
} from './pipeline.types';
import { RobustParser } from './RobustParser';

/**
 * think 标签完整匹配正则。
 * 支持变体：ILD(think)、thinking、thought、antml:thinking。
 * 捕获组 1 = 标签名，捕获组 2 = 标签内容。
 */
const THINK_TAG_COMPLETE_REGEX = /<(think|thinking|thought|antml:thinking)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;

/**
 * think 标签未关闭匹配正则（流式场景）。
 * 仅匹配行首的未关闭标签到文本末尾，避免匹配句子中间的字面量。
 * 捕获组 1 = 标签名，捕获组 2 = 标签内容。
 */
const THINK_TAG_UNCLOSED_REGEX = /(?:^|\n)[ \t]*<(think|thinking|thought|antml:thinking)\b[^>]*>([\s\S]*)$/i;

/**
 * 图片生成请求匹配正则（预留功能）。
 * 格式：<<<GENERATE_IMAGE>>>prompt<<<END_IMAGE>>>
 * 捕获组 1 = 生成提示词。
 */
const IMAGE_GENERATION_REGEX = /<<<GENERATE_IMAGE>>>([\s\S]*?)<<<END_IMAGE>>>/gi;

/**
 * 残留碎片清理正则 — 移除剥离标签后遗留的孤立标记字符（如 <<>>、<<<_、>>> 等）。
 * 匹配 3 个及以上连续的 <、>、_ 字符，避免误伤合法的 markdown 粗体（__）或比较符号（<<）。
 */
const RESIDUE_FRAGMENT_REGEX = /[<>_]{3,}/g;

/**
 * 表情标签的标准格式名称集合 — 这些模式匹配到的标签视为标准格式（confidence=1.0）。
 * 其余模式（malformed / fallback）视为容错匹配（confidence=0.8）。
 */
const EXPRESSION_STANDARD_NAMES = new Set([
  'text-marker',
  'text-marker-unclosed',
  'plain-tag',
  'plain-tag-unclosed',
]);

/**
 * 辅助模式选项的标准格式名称集合 — 这些模式匹配到的标签视为标准格式（confidence=1.0）。
 * 方括号格式视为容错匹配（confidence=0.8）。
 */
const SUGGESTED_OPTIONS_STANDARD_NAMES = new Set([
  'text-marker',
  'text-marker-unclosed',
  'html-comment',
  'plain-tag',
  'plain-tag-unclosed',
]);

/**
 * 表格编辑命令的标准格式名称集合 — HTML 注释+标签和纯标签为标准格式（confidence=1.0）。
 * 注释分隔格式为容错匹配（confidence=0.8）。
 */
const TABLE_EDIT_STANDARD_NAMES = new Set([
  'html-comment-tag',
  'plain-tag',
]);

export class AIIntentRecognizer {
  /** RobustParser 实例，用于多模式匹配和残留碎片清理 */
  private readonly parser: RobustParser;

  constructor() {
    this.parser = new RobustParser();
  }

  /**
   * 扫描 AI 响应内容，识别所有结构化标签意图。
   *
   * 对每种标签类型依次检测：
   * 1. expression — 表情情绪标签（<<<EXPRESSION>>>key<<<END_EXPRESSION>>>）
   * 2. suggested_options — 辅助模式推荐选项（<<<SUGGESTED_OPTIONS>>>...<<<END_OPTIONS>>>）
   * 3. table_edit — 表格编辑命令（<tableEdit>...</tableEdit>）
   * 4. think_tag — 思考标签（ILD/thinking/thought/antml:thinking）
   * 5. image_generation — 图片生成请求（预留功能）
   *
   * @param content AI 响应原始内容
   * @returns 检测到的所有意图数组（可能为空）
   */
  detect(content: string): DetectedIntent[] {
    if (!content || typeof content !== 'string') {
      return [];
    }

    const intents: DetectedIntent[] = [];

    // 1. 表情情绪标签
    this.detectExpression(content, intents);
    // 2. 辅助模式推荐选项
    this.detectSuggestedOptions(content, intents);
    // 3. 表格编辑命令
    this.detectTableEdit(content, intents);
    // 4. 思考标签
    this.detectThinkTags(content, intents);
    // 5. 图片生成请求（预留）
    this.detectImageGeneration(content, intents);

    return intents;
  }

  /**
   * 从内容中剥离所有已识别的标签，返回纯净叙事内容。
   *
   * 处理步骤：
   * 1. 逐一移除每个意图的 rawMatch 原始匹配文本
   * 2. 使用 RobustParser.cleanup 清理残留碎片（如孤立尖括号 <<>>）
   * 3. 移除首尾空白
   * 4. 折叠 3+ 连续换行为 2 个
   *
   * @param content AI 响应原始内容
   * @param intents detect 方法返回的意图列表
   * @returns 剥离所有标签后的纯净叙事内容
   */
  stripIntents(content: string, intents: DetectedIntent[]): string {
    if (!content) return '';
    if (!intents || intents.length === 0) {
      return content.trim().replace(/\n{3,}/g, '\n\n');
    }

    let result = content;

    // 逐一移除每个意图的原始匹配文本
    for (const intent of intents) {
      if (intent.rawMatch) {
        // 使用 split + join 避免 replace 的正则元字符问题
        result = result.split(intent.rawMatch).join('');
      }
    }

    // 使用 RobustParser.cleanup 清理残留碎片（如 <<>>, <<<_, >>> 等残缺标记）
    result = this.parser.cleanup(result, RESIDUE_FRAGMENT_REGEX);

    // 移除首尾空白
    result = result.trim();

    // 折叠 3+ 连续换行为 2 个
    result = result.replace(/\n{3,}/g, '\n\n');

    return result;
  }

  /**
   * 返回意图路由表（空 Map）。
   * 实际的 IntentHandler 由 ExtensionRegistry 注册，此处仅提供空容器。
   *
   * @returns 空的 AIIntentType → IntentHandler 映射表
   */
  getIntentRouter(): Map<AIIntentType, IntentHandler> {
    return new Map<AIIntentType, IntentHandler>();
  }

  // ===== 私有检测方法 =====

  /**
   * 检测表情情绪标签。
   * 使用 RobustParser.EXPRESSION_PATTERNS 进行多格式容错匹配。
   * 标准格式 confidence=1.0，残缺/兜底格式 confidence=0.8。
   *
   * @param content AI 响应内容
   * @param intents 检测结果累加数组
   */
  private detectExpression(content: string, intents: DetectedIntent[]): void {
    const { result, patternName } = this.matchWithPatternName(
      content,
      RobustParser.EXPRESSION_PATTERNS,
    );
    if (!result) return;

    const data = result.data as { emotion: string };
    const confidence = EXPRESSION_STANDARD_NAMES.has(patternName) ? 1.0 : 0.8;

    intents.push({
      type: 'expression',
      data: { emotion: data.emotion },
      rawMatch: result.rawMatch,
      confidence,
    });
  }

  /**
   * 检测辅助模式推荐选项。
   * 使用 RobustParser.SUGGESTED_OPTIONS_PATTERNS 进行多格式容错匹配。
   * 将选项文本按行拆分、过滤空行后存入 data.options。
   * 标准格式 confidence=1.0，方括号格式 confidence=0.8。
   *
   * @param content AI 响应内容
   * @param intents 检测结果累加数组
   */
  private detectSuggestedOptions(content: string, intents: DetectedIntent[]): void {
    const { result, patternName } = this.matchWithPatternName(
      content,
      RobustParser.SUGGESTED_OPTIONS_PATTERNS,
    );
    if (!result) return;

    const data = result.data as { optionsText: string };
    // 按行拆分，过滤空行（保留原始文本行，不修剪内容）
    const options = data.optionsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const confidence = SUGGESTED_OPTIONS_STANDARD_NAMES.has(patternName) ? 1.0 : 0.8;

    intents.push({
      type: 'suggested_options',
      data: { options },
      rawMatch: result.rawMatch,
      confidence,
    });
  }

  /**
   * 检测表格编辑命令标签。
   * 使用 RobustParser.TABLE_EDIT_PATTERNS 进行多格式匹配。
   * data 存储原始命令文本（rawContent），供后续 TableEditPlugin 解析。
   * 标准格式 confidence=1.0，注释分隔格式 confidence=0.8。
   *
   * @param content AI 响应内容
   * @param intents 检测结果累加数组
   */
  private detectTableEdit(content: string, intents: DetectedIntent[]): void {
    const { result, patternName } = this.matchWithPatternName(
      content,
      RobustParser.TABLE_EDIT_PATTERNS,
    );
    if (!result) return;

    const data = result.data as { commandsText: string };
    const confidence = TABLE_EDIT_STANDARD_NAMES.has(patternName) ? 1.0 : 0.8;

    intents.push({
      type: 'table_edit',
      data: { rawContent: data.commandsText },
      rawMatch: result.rawMatch,
      confidence,
    });
  }

  /**
   * 检测思考标签。
   * 支持变体：ILD(think)、thinking、thought、antml:thinking。
   * 同时处理完整标签对和未关闭标签（流式场景）。
   * confidence 固定为 1.0。
   *
   * @param content AI 响应内容
   * @param intents 检测结果累加数组
   */
  private detectThinkTags(content: string, intents: DetectedIntent[]): void {
    // 1. 查找完整的 think 标签对
    const completePattern = new RegExp(THINK_TAG_COMPLETE_REGEX.source, 'gi');
    let match: RegExpExecArray | null;
    let lastCompleteEnd = 0;

    while ((match = completePattern.exec(content)) !== null) {
      const tagType = match[1].toLowerCase();
      const tagContent = match[2].trim();

      intents.push({
        type: 'think_tag',
        data: { content: tagContent, tagType },
        rawMatch: match[0],
        confidence: 1.0,
      });

      lastCompleteEnd = match.index + match[0].length;
    }

    // 2. 查找未关闭的 think 标签（流式场景）
    //    在最后一个完整标签之后的内容中查找，避免与完整标签重叠
    const remaining = content.substring(lastCompleteEnd);
    const unclosedPattern = new RegExp(THINK_TAG_UNCLOSED_REGEX.source, 'i');
    const unclosedMatch = remaining.match(unclosedPattern);

    if (unclosedMatch) {
      const tagType = unclosedMatch[1].toLowerCase();
      const tagContent = unclosedMatch[2].trim();

      intents.push({
        type: 'think_tag',
        data: { content: tagContent, tagType },
        rawMatch: unclosedMatch[0],
        confidence: 1.0,
      });
    }
  }

  /**
   * 检测图片生成请求（预留功能）。
   * 格式：<<<GENERATE_IMAGE>>>prompt<<<END_IMAGE>>>
   * confidence 固定为 1.0。
   *
   * @param content AI 响应内容
   * @param intents 检测结果累加数组
   */
  private detectImageGeneration(content: string, intents: DetectedIntent[]): void {
    const pattern = new RegExp(IMAGE_GENERATION_REGEX.source, 'gi');
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(content)) !== null) {
      const prompt = match[1].trim();

      intents.push({
        type: 'image_generation',
        data: { prompt },
        rawMatch: match[0],
        confidence: 1.0,
      });
    }
  }

  // ===== 辅助方法 =====

  /**
   * 带模式名称的多模式匹配。
   *
   * 与 RobustParser.match 类似，按 patterns 顺序依次尝试正则匹配，
   * 返回首个匹配结果及其对应的模式名称（用于 confidence 判定）。
   *
   * @param content 待解析的文本
   * @param patterns 有序正则模式列表（按优先级排列）
   * @returns 匹配结果和模式名称，全部失败时 result 为 null
   */
  private matchWithPatternName(
    content: string,
    patterns: ParsePattern[],
  ): { result: ParseResult; patternName: string } | { result: null; patternName: string } {
    for (const pattern of patterns) {
      // 重置 lastIndex（防止带 g 标志的正则在多次调用时状态残留）
      pattern.regex.lastIndex = 0;
      const m = content.match(pattern.regex);
      if (m) {
        const extracted = pattern.extractor(m);
        return {
          result: {
            data: extracted.data,
            rawMatch: extracted.rawMatch,
          },
          patternName: pattern.name,
        };
      }
    }

    return { result: null, patternName: '' };
  }
}
