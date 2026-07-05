/**
 * 游戏模式 tableEdit 命令解析器
 *
 * 解析 AI 回复末尾的 <tableEdit> 标签，提取表格编辑命令。
 *
 * 协议（与对话模式/写作模式对齐，参考
 *  `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`
 *  的 buildAsyncTableOrganizeInstructions 函数）：
 *
 * 标签格式（HTML 注释包裹，AI 通常输出此格式）：
 * ```
 * <!--  <tableEdit>
 * insertRow(1, {"2":"worker_001","3":"农夫"})
 * updateRow(1, 2, {"4":"警长"})
 * deleteRow(1, 3)
 * </tableEdit> -->
 * ```
 *
 * 也兼容无 HTML 注释包裹的版本（容错）：
 * ```
 * <tableEdit>...</tableEdit>
 * ```
 *
 * 命令格式：
 * - `insertRow(sheetIndex, {"colIndex":"value",...})`
 * - `updateRow(sheetIndex, rowIndex, {"colIndex":"value",...})`
 * - `deleteRow(sheetIndex, rowIndex)`
 *
 * 索引规则（**全部 1-based**，由 GameTableRepository.applyTableEdits 在应用时
 * 转换为 0-based）：
 * - sheetIndex：从 1 开始，对应 schema.sheets 的顺序
 * - rowIndex：从 1 开始，对应当前 sheet 中的行号
 * - colIndex：从 1 开始，对应当前 sheet headers 的字段索引（key 为字符串形式的数字）
 *
 * 设计说明：
 * - 参考既有 `src/main/services/memory/tableEditParser.ts` 的正则与容错策略，
 *   但不直接 import，避免跨模块耦合（游戏模块独立维护）。
 * - 解析失败的命令记入 errors 数组返回，不抛异常，确保流式叙事不被中断。
 */

import {
  GameTableEditCommand,
  GameTableEditCommandType,
  GameTableEditParseResult
} from '../../../shared/types/game.types';

// ==================== 正则常量 ====================

/**
 * 匹配 HTML 注释包裹的 <tableEdit> 标签内容
 * 容忍标签前后的空格与注释符之间的空格（如 `<!--  <tableEdit>`）。
 */
const TABLE_EDIT_COMMENT_REGEX = /<!--\s*<tableEdit>\s*([\s\S]*?)\s*<\/tableEdit>\s*-->/gi;

/**
 * 匹配无 HTML 注释包裹的 <tableEdit> 标签内容（容错路径）。
 * 注意：必须在使用 COMMENT_REGEX 提取失败后再尝试，且需要排除已被
 * COMMENT_REGEX 消费过的部分，避免重复提取。
 */
const TABLE_EDIT_BARE_REGEX = /<tableEdit>\s*([\s\S]*?)\s*<\/tableEdit>/gi;

/**
 * 匹配单个命令行（已 trim）。
 * 三种命令格式：
 * - insertRow(sheetIndex, {...})
 * - updateRow(sheetIndex, rowIndex, {...})
 * - deleteRow(sheetIndex, rowIndex)
 *
 * 设计：sheetIndex 与 rowIndex 必须为纯数字（\d+），data 必须为 {...}。
 * 这样可以严格过滤形如 `insertRow("1", ...)` 的字符串索引错误。
 */
const INSERT_ROW_REGEX = /^insertRow\s*\(\s*(\d+)\s*,\s*(\{[\s\S]+\})\s*\)$/i;
const UPDATE_ROW_REGEX = /^updateRow\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\{[\s\S]+\})\s*\)$/i;
const DELETE_ROW_REGEX = /^deleteRow\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)$/i;

// ==================== 解析器实现 ====================

export class GameTableEditParser {
  /**
   * 从 AI 回复文本中解析 <tableEdit> 标签
   *
   * 解析流程：
   * 1. 用 HTML 注释正则提取所有 `<!-- <tableEdit>...</tableEdit> -->` 块
   * 2. 用裸标签正则提取所有 `<tableEdit>...</tableEdit>` 块（在原文本中
   *    去掉已匹配的注释块后扫描，避免重复）
   * 3. 对每个块按行解析命令
   * 4. 收集所有 commands 与 errors
   *
   * @param text AI 完整回复
   * @returns 解析结果（commands + errors）
   */
  parse(text: string): GameTableEditParseResult {
    const result: GameTableEditParseResult = { commands: [], errors: [] };

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      // 空回复视为无命令，不视为错误（AI 可能未触发任何表格变更）
      return result;
    }

    // 1. 提取 HTML 注释包裹的 tableEdit 块
    const commentBlocks = this.extractBlocks(text, TABLE_EDIT_COMMENT_REGEX);

    // 2. 在原文本中剔除已匹配的注释块后，扫描裸标签块（容错）
    const stripped = text.replace(TABLE_EDIT_COMMENT_REGEX, '');
    const bareBlocks = this.extractBlocks(stripped, TABLE_EDIT_BARE_REGEX);

    const allBlocks = [...commentBlocks, ...bareBlocks];
    if (allBlocks.length === 0) {
      // 无 tableEdit 标签：返回空结果（不视为错误，AI 可能只是叙事无变更）
      return result;
    }

    for (const block of allBlocks) {
      const { commands, errors } = this.parseBlock(block);
      result.commands.push(...commands);
      result.errors.push(...errors);
    }

    return result;
  }

  /**
   * 从回复文本中剥离 <tableEdit> 标签，返回纯叙事文本
   *
   * 用于：将 AI 完整回复拆分为「叙事文本」与「表格命令」两部分，
   * 叙事文本用于推送 game:narrative:complete 事件中的 fullText 字段。
   *
   * 同时剥离 HTML 注释包裹与裸标签两种格式，并清理首尾多余空白行。
   */
  stripTableEditTags(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    let stripped = text
      .replace(TABLE_EDIT_COMMENT_REGEX, '')
      .replace(TABLE_EDIT_BARE_REGEX, '');

    // 清理剥离后残留的多余空行（连续 3 个以上换行压缩为 2 个）
    stripped = stripped.replace(/\n{3,}/g, '\n\n');

    return stripped.trim();
  }

  // ==================== 内部方法 ====================

  /**
   * 用指定正则提取所有匹配块的内容（捕获组 1）
   */
  private extractBlocks(text: string, regex: RegExp): string[] {
    const blocks: string[] = [];
    // 必须重新构造 RegExp 实例，因为带 g 标志的正则在 exec/test 时
    // 会维护 lastIndex 状态，全局复用会导致漏匹配
    const re = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const content = match[1];
      if (content && content.trim().length > 0) {
        blocks.push(content);
      }
    }
    return blocks;
  }

  /**
   * 解析单个 tableEdit 块的内容
   *
   * 按行分割，对每个非空行尝试解析为命令。无法识别的行记入 errors。
   */
  private parseBlock(blockContent: string): { commands: GameTableEditCommand[]; errors: string[] } {
    const commands: GameTableEditCommand[] = [];
    const errors: string[] = [];

    const lines = blockContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    for (const line of lines) {
      const command = this.parseSingleCommand(line);
      if (command) {
        commands.push(command);
      } else {
        // 无法识别的行：可能是注释/说明文本，也可能是格式错误的命令
        // 统一记入 errors 供审计，但不中断后续解析
        errors.push(`无法解析的命令行: ${line}`);
      }
    }

    return { commands, errors };
  }

  /**
   * 尝试用三种命令正则匹配单行
   */
  private parseSingleCommand(line: string): GameTableEditCommand | null {
    // 顺序：insertRow / updateRow / deleteRow
    // 注意：必须先匹配 updateRow（参数最多），否则 insertRow 的 (\{...\})
    // 可能误匹配 updateRow 的部分内容（虽然 anchored ^...$ 通常能区分）
    const updateMatch = UPDATE_ROW_REGEX.exec(line);
    if (updateMatch) {
      return this.buildUpdateCommand(updateMatch, line);
    }

    const insertMatch = INSERT_ROW_REGEX.exec(line);
    if (insertMatch) {
      return this.buildInsertCommand(insertMatch, line);
    }

    const deleteMatch = DELETE_ROW_REGEX.exec(line);
    if (deleteMatch) {
      return this.buildDeleteCommand(deleteMatch, line);
    }

    return null;
  }

  private buildInsertCommand(
    match: RegExpExecArray,
    raw: string
  ): GameTableEditCommand | null {
    const sheetIndex = parseInt(match[1], 10);
    const dataStr = match[2];

    if (isNaN(sheetIndex) || sheetIndex < 1) {
      return null;
    }

    const rowData = this.parseDataObject(dataStr);
    if (rowData === null) {
      return null;
    }

    return {
      type: GameTableEditCommandType.INSERT_ROW,
      sheetIndex,
      rowData,
      raw
    };
  }

  private buildUpdateCommand(
    match: RegExpExecArray,
    raw: string
  ): GameTableEditCommand | null {
    const sheetIndex = parseInt(match[1], 10);
    const rowIndex = parseInt(match[2], 10);
    const dataStr = match[3];

    if (isNaN(sheetIndex) || sheetIndex < 1 || isNaN(rowIndex) || rowIndex < 1) {
      return null;
    }

    const rowData = this.parseDataObject(dataStr);
    if (rowData === null) {
      return null;
    }

    return {
      type: GameTableEditCommandType.UPDATE_ROW,
      sheetIndex,
      rowIndex,
      rowData,
      raw
    };
  }

  private buildDeleteCommand(
    match: RegExpExecArray,
    raw: string
  ): GameTableEditCommand | null {
    const sheetIndex = parseInt(match[1], 10);
    const rowIndex = parseInt(match[2], 10);

    if (isNaN(sheetIndex) || sheetIndex < 1 || isNaN(rowIndex) || rowIndex < 1) {
      return null;
    }

    return {
      type: GameTableEditCommandType.DELETE_ROW,
      sheetIndex,
      rowIndex,
      raw
    };
  }

  /**
   * 解析 JSON 数据对象
   *
   * 容错策略（与既有 tableEditParser.ts 对齐）：
   * 1. 清理内嵌的 HTML 注释（如 `"朱迪<!-- 药 -->"` → `"朱迪"`）
   * 2. 尝试直接 JSON.parse
   * 3. 失败则规范化（给未加引号的键名加引号、单引号转双引号、清理尾逗号）后重试
   * 4. 仍失败则返回 null（调用方记入 errors）
   *
   * @returns 解析后的键值对象（值为字符串），失败返回 null
   */
  private parseDataObject(dataStr: string): Record<string, string> | null {
    // 1. 清理嵌套 HTML 注释
    const cleaned = dataStr.replace(/<!--[\s\S]*?-->/g, '');

    // 2. 直接解析
    try {
      const parsed = JSON.parse(cleaned);
      if (this.isPlainObject(parsed)) {
        return this.toStringValueMap(parsed);
      }
    } catch {
      // 进入规范化重试路径
    }

    // 3. 规范化后重试
    try {
      const normalized = this.normalizeJsonObject(cleaned);
      const parsed = JSON.parse(normalized);
      if (this.isPlainObject(parsed)) {
        return this.toStringValueMap(parsed);
      }
    } catch {
      // 解析彻底失败
    }

    return null;
  }

  /**
   * 规范化 JSON 字符串（处理 AI 可能输出的非标准格式）
   *
   * 处理顺序（重要）：
   * 1. 未加引号的键名 → 加双引号
   * 2. 单引号键名 → 双引号
   * 3. 单引号字符串值 → 双引号
   * 4. 清理尾逗号
   *
   * 注意：此方法可能破坏已包含冒号的合法 JSON 值（如 "00:00"），
   * 因此仅在直接 JSON.parse 失败时作为兜底使用。
   */
  private normalizeJsonObject(str: string): string {
    let normalized = str.trim();

    // 1. 给未加引号的键名加双引号（如 {key: "value"} → {"key": "value"}）
    normalized = normalized.replace(/(\{|,)\s*(\w+)\s*:/g, '$1"$2":');
    // 处理开头未加引号的键名
    normalized = normalized.replace(/^\s*(\w+)\s*:/, '"$1":');

    // 2. 单引号键名转双引号（如 {'key': ...} → {"key": ...}）
    //    必须在单引号值转换之前执行，避免误吞键名末尾的冒号
    normalized = normalized.replace(/(\{|,)\s*'([^']+?)'\s*:/g, '$1"$2":');

    // 3. 单引号字符串值转双引号
    normalized = normalized.replace(/:\s*'([^']*)'/g, ':"$1"');

    // 4. 清理尾逗号
    normalized = normalized.replace(/,\s*}/g, '}');
    normalized = normalized.replace(/,\s*]/g, ']');

    return normalized;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * 将对象的所有值转换为字符串（数字/布尔等也转字符串）
   * 与既有 parser 行为对齐，统一 rowData 的值类型。
   */
  private toStringValueMap(obj: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        result[key] = '';
      } else if (typeof value === 'object') {
        // 嵌套对象/数组：序列化为 JSON 字符串（罕见但需容错）
        try {
          result[key] = JSON.stringify(value);
        } catch {
          result[key] = String(value);
        }
      } else {
        result[key] = String(value);
      }
    }
    return result;
  }
}

// ==================== 单例导出 ====================

export const gameTableEditParser = new GameTableEditParser();
