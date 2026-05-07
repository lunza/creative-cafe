/**
 * TableEdit 命令解析器
 * 负责解析 HTML 注释格式中的表格编辑命令
 */

import { sendLogToRenderer } from '../../index';

const addLog = (message: string, type: 'error' | 'warn' | 'info' | 'debug' = 'info') => {
  sendLogToRenderer(message, type);
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

class TableEditParser {
  private readonly TABLE_EDIT_TAG_REGEX = /<tableEdit[^>]*>([\s\S]*?)<\/tableEdit>/gi;
  private readonly HTML_COMMENT_REGEX = /<!--([\s\S]*?)-->/g;
  private readonly INSERT_ROW_REGEX = /insertRow\((\d+),\s*(\{[^}]+\})\)/;
  private readonly UPDATE_ROW_REGEX = /updateRow\((\d+),\s*(\d+),\s*(\{[^}]+\})\)/;
  private readonly DELETE_ROW_REGEX = /deleteRow\((\d+),\s*(\d+)\)/;

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
    const contents: string[] = [];
    const regex = new RegExp(this.TABLE_EDIT_TAG_REGEX.source, this.TABLE_EDIT_TAG_REGEX.flags);
    let match;

    while ((match = regex.exec(response)) !== null) {
      const content = match[1]?.trim();
      if (content) {
        contents.push(content);
        addLog('TableEditParser: 提取 tableEdit 标签内容成功', 'debug');
      }
    }

    return contents;
  }

  /**
   * 从内容中解析命令
   */
  private parseCommands(content: string, errors: string[]): TableEditCommand[] {
    const commands: TableEditCommand[] = [];

    const commentText = this.extractCommentText(content);
    if (!commentText) {
      errors.push('未找到 HTML 注释或注释内容为空');
      addLog('TableEditParser: 未找到 HTML 注释', 'warn');
      return commands;
    }

    addLog(`TableEditParser: 提取注释内容长度 ${commentText.length} 字符`, 'debug');

    const lines = commentText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    addLog(`TableEditParser: 共 ${lines.length} 行命令待解析`, 'debug');

    for (const line of lines) {
      const command = this.parseSingleCommand(line);
      if (command) {
        commands.push(command);
        addLog(`TableEditParser: 成功解析命令 ${command.type}(tableIndex=${command.tableIndex})`, 'debug');
      } else {
        errors.push(`无法解析命令: ${line}`);
        addLog(`TableEditParser: 命令解析失败: ${line}`, 'error');
      }
    }

    return commands;
  }

  /**
   * 提取 HTML 注释内容
   */
  private extractCommentText(content: string): string | null {
    const regex = new RegExp(this.HTML_COMMENT_REGEX.source, this.HTML_COMMENT_REGEX.flags);
    let match;
    const comments: string[] = [];

    while ((match = regex.exec(content)) !== null) {
      if (match[1]?.trim()) {
        comments.push(match[1].trim());
      }
    }

    return comments.length > 0 ? comments.join('\n') : null;
  }

  /**
   * 解析单个命令
   */
  private parseSingleCommand(line: string): TableEditCommand | null {
    let command = this.parseInsertRow(line);
    if (command) return command;

    command = this.parseUpdateRow(line);
    if (command) return command;

    command = this.parseDeleteRow(line);
    if (command) return command;

    return null;
  }

  /**
   * 解析 insertRow 命令
   */
  private parseInsertRow(line: string): TableEditCommand | null {
    const regex = new RegExp(this.INSERT_ROW_REGEX.source);
    const match = regex.exec(line);

    if (!match) return null;

    const tableIndex = parseInt(match[1], 10);
    const dataStr = match[2];

    const data = this.parseDataObject(dataStr);
    if (!data) {
      addLog(`TableEditParser: insertRow 数据解析失败: ${dataStr}`, 'error');
      return null;
    }

    return {
      type: 'insertRow',
      tableIndex,
      data,
      rawCommand: line
    };
  }

  /**
   * 解析 updateRow 命令
   */
  private parseUpdateRow(line: string): TableEditCommand | null {
    const regex = new RegExp(this.UPDATE_ROW_REGEX.source);
    const match = regex.exec(line);

    if (!match) return null;

    const tableIndex = parseInt(match[1], 10);
    const rowIndex = parseInt(match[2], 10);
    const dataStr = match[3];

    const data = this.parseDataObject(dataStr);
    if (!data) {
      addLog(`TableEditParser: updateRow 数据解析失败: ${dataStr}`, 'error');
      return null;
    }

    return {
      type: 'updateRow',
      tableIndex,
      rowIndex,
      data,
      rawCommand: line
    };
  }

  /**
   * 解析 deleteRow 命令
   */
  private parseDeleteRow(line: string): TableEditCommand | null {
    const regex = new RegExp(this.DELETE_ROW_REGEX.source);
    const match = regex.exec(line);

    if (!match) return null;

    const tableIndex = parseInt(match[1], 10);
    const rowIndex = parseInt(match[2], 10);

    return {
      type: 'deleteRow',
      tableIndex,
      rowIndex,
      rawCommand: line
    };
  }

  /**
   * 解析数据对象（处理引号和非引号键）
   */
  private parseDataObject(dataStr: string): Record<string, string> | null {
    try {
      const normalizedStr = this.normalizeJsonObject(dataStr);
      const parsed = JSON.parse(normalizedStr);

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        addLog(`TableEditParser: 数据对象格式无效: ${dataStr}`, 'error');
        return null;
      }

      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        result[key] = String(value);
      }

      return result;
    } catch (error) {
      addLog(`TableEditParser: JSON 解析失败: ${dataStr}, 错误: ${error}`, 'error');
      return null;
    }
  }

  /**
   * 规范化 JSON 对象字符串（处理非标准格式）
   */
  private normalizeJsonObject(str: string): string {
    let normalized = str.trim();

    normalized = normalized.replace(/(\w+)\s*:/g, '"$1":');

    normalized = normalized.replace(/:\s*'([^']*)'/g, ':"$1"');

    normalized = normalized.replace(/,\s*}/g, '}');
    normalized = normalized.replace(/,\s*]/g, ']');

    return normalized;
  }
}

export const tableEditParser = new TableEditParser();
