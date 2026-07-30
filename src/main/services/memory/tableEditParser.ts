/**
 * TableEdit 命令解析器（对话/记忆/写作模式适配层）
 *
 * 重构说明（spec §一 F3 + F4）：
 *  - 公共解析逻辑（数据对象 JSON 容错、命令分派、字段索引转换、F3 越界校验）
 *    已抽取到 `tableEditParserBase.ts` 的 `TableEditParserBase`。
 *  - 本文件保留为薄适配层，对外 API 签名（`tableEditParser.parse`、`TableEditCommand`、
 *    `ParseResult`）完全不变，所有调用点无需改动。
 *  - F3 越界校验：sheetIndex/rowIndex 非正整数时跳过整条命令并警告；
 *    字段索引 1→0 转换后 < 0 时跳过该字段并警告。
 *
 * 索引协议（与既有行为一致）：
 *  - sheetIndex / rowIndex：AI 输出 1-based，parser 阶段转换为 0-based
 *  - 字段索引（data 的键）：AI 输出 1-based 数字字符串，parser 阶段转换为 0-based
 *  - 命名键（非数字字符串）保持原样
 */

import { createLogger } from '../logger';
import {
  TableEditParserBase,
  CommandRegexSpec,
  ParsedCommandCore,
  ParseLineOptions
} from './tableEditParserBase';

const logger = createLogger('writing');

const addLog = (message: string, type: 'error' | 'warn' | 'info' | 'debug' = 'info') => {
  switch (type) {
    case 'error':
      logger.error(message);
      break;
    case 'warn':
      logger.warn(message);
      break;
    case 'debug':
      logger.debug(message);
      break;
    default:
      logger.info(message);
      break;
  }
};

export interface TableEditCommand {
  type: 'insertRow' | 'updateRow' | 'deleteRow';
  tableIndex: number;
  rowIndex?: number;
  data?: Record<string, string>;
  rawCommand?: string;
}

export interface ParseResult {
  success: boolean;
  commands: TableEditCommand[];
  errors: string[];
}

/**
 * memory 适配层命令正则规格（保持原有非 anchored 风格，对外行为不变）
 */
const MEMORY_REGEX_SPEC: CommandRegexSpec = {
  insertRow: /insertRow\((\d+),\s*(\{[\s\S]+\})\)/,
  updateRow: /updateRow\((\d+),\s*(\d+),\s*(\{[\s\S]+\})\)/,
  deleteRow: /deleteRow\((\d+),\s*(\d+)\)/
};

/**
 * memory 适配层解析选项：
 *  - 索引 1-based → 0-based（在 parser 阶段转换）
 *  - 字段索引同样转换
 *  - maxColumnIndex 不提供：parser 阶段不知道列数，列范围校验留给 executor
 */
const MEMORY_PARSE_OPTS: ParseLineOptions = {
  convertIndicesToZeroBased: true,
  convertFieldIndices: true,
  logPrefix: 'TableEditParser'
};

class TableEditParser extends TableEditParserBase {
  private readonly TABLE_EDIT_TAG_REGEX = /<tableEdit[^>]*>([\s\S]*?)<\/tableEdit>/gi;

  /**
   * 解析响应内容中的 tableEdit 命令
   */
  public parse(response: string): ParseResult {
    const result: ParseResult = {
      success: false,
      commands: [],
      errors: []
    };

    if (!response || typeof response !== 'string') {
      result.errors.push('响应内容为空或格式无效');
      addLog('TableEditParser: 响应内容为空或格式无效', 'error');
      return result;
    }

    addLog('TableEditParser: 开始解析 tableEdit 命令', 'debug');
    addLog(`TableEditParser: 响应内容长度 ${response.length} 字符`, 'debug');

    try {
      const tableEditContents = this.extractTableEditContents(response);

      if (tableEditContents.length === 0) {
        result.errors.push('未找到 <tableEdit> 标签或内容为空');
        addLog('TableEditParser: 未找到 <tableEdit> 标签', 'warn');
        return result;
      }

      addLog(`TableEditParser: 找到 ${tableEditContents.length} 个 tableEdit 标签`, 'debug');

      for (const content of tableEditContents) {
        const commands = this.parseCommands(content, result.errors);
        result.commands.push(...commands);
      }

      if (result.commands.length === 0 && result.errors.length > 0) {
        result.success = false;
        addLog(`TableEditParser: 解析完成，共 ${result.errors.length} 个错误`, 'error');
      } else {
        result.success = true;
        addLog(`TableEditParser: 解析完成，共 ${result.commands.length} 个命令`, 'info');
      }
    } catch (error) {
      result.errors.push(`解析过程发生异常: ${error instanceof Error ? error.message : String(error)}`);
      addLog(`TableEditParser: 解析过程发生异常: ${error}`, 'error');
    }

    return result;
  }

  /**
   * 提取 <tableEdit> 标签内的内容
   */
  private extractTableEditContents(response: string): string[] {
    // 复用 Base 的 extractBlocks（单正则场景等价于原实现）
    return this.extractBlocks(response, [this.TABLE_EDIT_TAG_REGEX]);
  }

  /**
   * 从内容中解析命令
   * 直接在内容中按行匹配命令，不依赖 HTML 注释提取（避免嵌套注释破坏外层注释的完整性）
   */
  private parseCommands(content: string, errors: string[]): TableEditCommand[] {
    const commands: TableEditCommand[] = [];

    addLog(`TableEditParser: 内容长度 ${content.length} 字符`, 'debug');

    const lines = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    addLog(`TableEditParser: 共 ${lines.length} 行内容待解析`, 'debug');

    for (const line of lines) {
      const command = this.parseSingleCommand(line);
      if (command) {
        commands.push(command);
        addLog(`TableEditParser: 成功解析命令 ${command.type}(tableIndex=${command.tableIndex})`, 'debug');
      } else {
        addLog(`TableEditParser: 跳过非命令行: ${line.substring(0, 50)}`, 'debug');
      }
    }

    if (commands.length === 0) {
      errors.push('未找到有效的 tableEdit 命令（insertRow/updateRow/deleteRow）');
      addLog('TableEditParser: 未找到有效的 tableEdit 命令', 'warn');
    }

    return commands;
  }

  /**
   * 解析单个命令（委托给 Base 的 tryParseLine，再转换为对外 TableEditCommand 结构）
   */
  private parseSingleCommand(line: string): TableEditCommand | null {
    const core = this.tryParseLine(line, MEMORY_REGEX_SPEC, MEMORY_PARSE_OPTS);
    if (!core) return null;
    return this.toTableEditCommand(core);
  }

  /**
   * 将 Base 的中间结构 ParsedCommandCore 转换为对外 TableEditCommand
   */
  private toTableEditCommand(core: ParsedCommandCore): TableEditCommand {
    return {
      type: core.kind,
      tableIndex: core.sheetIndex,
      rowIndex: core.rowIndex,
      data: core.data,
      rawCommand: core.raw
    };
  }
}

export const tableEditParser = new TableEditParser();
