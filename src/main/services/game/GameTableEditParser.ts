/**
 * 游戏模式 tableEdit 命令解析器（适配层）
 *
 * 重构说明（spec §一 F3 + F4）：
 *  - 公共解析逻辑（数据对象 JSON 容错、命令分派、索引校验）已抽取到
 *    `src/main/services/memory/tableEditParserBase.ts` 的 `TableEditParserBase`。
 *  - 本文件保留为薄适配层，对外 API 签名（`GameTableEditParser.parse`、
 *    `GameTableEditParser.stripTableEditTags`、`gameTableEditParser` 单例）完全不变。
 *  - F3 越界校验：sheetIndex/rowIndex 非正整数时跳过整条命令并警告
 *    （由 Base.tryParseLine 统一实现）。
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
 * 转换为 0-based；parser 阶段不转换）：
 * - sheetIndex：从 1 开始，对应 schema.sheets 的顺序
 * - rowIndex：从 1 开始，对应当前 sheet 中的行号
 * - colIndex：从 1 开始，对应当前 sheet headers 的字段索引（key 为字符串形式的数字）
 *
 * 设计说明：
 *  - 索引保持 1-based（不转换），字段索引同样保持原样（不转换），
 *    以保证对外行为完全不变。
 *  - 解析失败的命令记入 errors 数组返回，不抛异常，确保流式叙事不被中断。
 */

import {
  GameTableEditCommand,
  GameTableEditCommandType,
  GameTableEditParseResult
} from '../../../shared/types/game.types';
import {
  TableEditParserBase,
  CommandRegexSpec,
  ParsedCommandCore,
  ParseLineOptions
} from '../memory/tableEditParserBase';

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

/**
 * game 适配层命令正则规格（anchored + i 标志，保持原有风格）
 */
const GAME_REGEX_SPEC: CommandRegexSpec = {
  insertRow: INSERT_ROW_REGEX,
  updateRow: UPDATE_ROW_REGEX,
  deleteRow: DELETE_ROW_REGEX
};

/**
 * game 适配层解析选项：
 *  - 索引保持 1-based（不转换，由 GameTableRepository.applyTableEdits 转换）
 *  - 字段索引保持原样（不转换）
 *  - maxColumnIndex 不提供：parser 阶段不知道列数
 */
const GAME_PARSE_OPTS: ParseLineOptions = {
  convertIndicesToZeroBased: false,
  convertFieldIndices: false,
  logPrefix: 'GameTableEditParser'
};

// ==================== 解析器实现 ====================

export class GameTableEditParser extends TableEditParserBase {
  /**
   * 从 AI 回复文本中解析 <tableEdit> 标签
   *
   * 解析流程：
   * 1. 用 HTML 注释正则提取所有 `<!-- <tableEdit>...</tableEdit> -->` 块
   * 2. 在原文本中剔除已匹配的注释块后，扫描裸标签块（容错）
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

    // 1 + 2. 提取 HTML 注释包裹块 + 裸标签块（Base.extractBlocks 已自动去重）
    const allBlocks = this.extractBlocks(text, [
      TABLE_EDIT_COMMENT_REGEX,
      TABLE_EDIT_BARE_REGEX
    ]);

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
   * 尝试用三种命令正则匹配单行（委托给 Base.tryParseLine）
   */
  private parseSingleCommand(line: string): GameTableEditCommand | null {
    const core = this.tryParseLine(line, GAME_REGEX_SPEC, GAME_PARSE_OPTS);
    if (!core) return null;
    return this.toGameTableEditCommand(core);
  }

  /**
   * 将 Base 的中间结构 ParsedCommandCore 转换为对外 GameTableEditCommand
   */
  private toGameTableEditCommand(core: ParsedCommandCore): GameTableEditCommand {
    const typeMap: Record<ParsedCommandCore['kind'], GameTableEditCommandType> = {
      insertRow: GameTableEditCommandType.INSERT_ROW,
      updateRow: GameTableEditCommandType.UPDATE_ROW,
      deleteRow: GameTableEditCommandType.DELETE_ROW
    };

    return {
      type: typeMap[core.kind],
      sheetIndex: core.sheetIndex,
      rowIndex: core.rowIndex,
      rowData: core.data,
      raw: core.raw
    };
  }
}

// ==================== 单例导出 ====================

export const gameTableEditParser = new GameTableEditParser();
