/**
 * updateStateTable 工具 —— tableEdit 注册为原生工具调用
 *
 * 来源：spec §二 Task 7.3（tableEdit 注册为 updateStateTable 工具，闭环返回结果）
 * 决策：自研（spec §三）。将现有 `<tableEdit>` 文本协议升级为原生工具调用，
 *       AI 通过 function calling 直接执行表格操作，无需文本解析。
 *
 * 职责：
 *  1. 定义 updateStateTable 工具描述符（OpenAI function schema）
 *  2. 接收 commands 参数（insertRow/updateRow/deleteRow）
 *  3. 调用现有 executeTableEditCommands 执行
 *  4. 返回执行结果（成功/失败 + 执行数 + 错误列表）
 *
 * 设计约束（openclaw AGENTS.md）：
 *  - 工具描述是 prompt：description 清晰说明参数格式与返回值
 *  - 闭环返回：执行结果回灌给 LLM，让模型知道是否成功
 *  - 降级保护：工具失败不中断 agentLoop，转为 ToolExecutionResult
 *  - 双轨并行：保留 `<tableEdit>` 文本协议作为降级路径（supportsToolCalling=false 时）
 */

import type { ToolDescriptor } from '../types';
import type { ToolCallContext, ToolExecutionResult } from '../../contracts';
import type { ToolExecutor } from '../toolRegistry';

// ==================== 工具描述符 ====================

/**
 * updateStateTable 工具描述符。
 *
 * 适用模式：dialogue / writing / game（三模式均支持状态表操作）
 * 可用性：要求 context.mode 存在（不在无模式上下文中暴露）
 */
export const updateStateTableDescriptor: ToolDescriptor = {
  name: 'updateStateTable',
  title: 'Update State Table',
  description: `Update the state table by inserting, updating, or deleting rows.

Parameters:
- commands: Array of table edit commands. Each command has:
  - type: "insertRow" | "updateRow" | "deleteRow"
  - tableIndex: 1-based table index (integer >= 1)
  - rowIndex: 1-based row index (integer >= 1, required for updateRow and deleteRow)
  - data: Key-value object for the row (required for insertRow and updateRow)
    - Numeric keys (1, 2, 3...) are 1-based column indices
    - Named keys are column names

Examples:
  Insert: { "type": "insertRow", "tableIndex": 1, "data": { "1": "Value1", "2": "Value2" } }
  Update: { "type": "updateRow", "tableIndex": 1, "rowIndex": 2, "data": { "1": "NewValue" } }
  Delete: { "type": "deleteRow", "tableIndex": 1, "rowIndex": 3 }

Returns: { success: boolean, executed: number, errors: string[] }`,
  inputSchema: {
    type: 'object',
    properties: {
      commands: {
        type: 'array',
        description: 'Array of table edit commands to execute',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['insertRow', 'updateRow', 'deleteRow'],
              description: 'Command type',
            },
            tableIndex: {
              type: 'integer',
              minimum: 1,
              description: '1-based table index',
            },
            rowIndex: {
              type: 'integer',
              minimum: 1,
              description: '1-based row index (required for updateRow and deleteRow)',
            },
            data: {
              type: 'object',
              description: 'Key-value object for the row (required for insertRow and updateRow)',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['type', 'tableIndex'],
        },
      },
    },
    required: ['commands'],
  },
  owner: { kind: 'core' },
  availability: {
    anyOf: [
      { kind: 'context', key: 'mode', equals: 'dialogue' },
      { kind: 'context', key: 'mode', equals: 'writing' },
      { kind: 'context', key: 'mode', equals: 'game' },
    ],
  },
  annotations: { group: 'dialogue', sortKey: '001' },
};

// ==================== 工具执行器 ====================

/**
 * 表格执行器接口（解耦，由调用方注入）。
 *
 * 不同模式（dialogue/writing/game）有不同的表格执行逻辑，
 * 通过此接口注入，updateStateTable 工具无需知道具体实现。
 */
export interface ITableEditExecutor {
  /**
   * 执行表格编辑命令。
   *
   * @param context 工具调用上下文（sessionId / characterId / mode）
   * @param commands 命令列表（已从 AI 参数转换）
   * @returns 执行结果
   */
  execute(
    context: ToolCallContext,
    commands: Array<{
      type: 'insertRow' | 'updateRow' | 'deleteRow';
      tableIndex: number;
      rowIndex?: number;
      data?: Record<string, string>;
    }>
  ): Promise<{ success: boolean; executed: number; errors: string[] }>;
}

/**
 * 创建 updateStateTable 工具执行器。
 *
 * @param tableExecutor 表格执行器（由调用方注入）
 * @returns ToolExecutor 函数
 */
export function createUpdateStateTableExecutor(
  tableExecutor: ITableEditExecutor
): ToolExecutor {
  return async (
    args: Record<string, unknown>,
    context?: ToolCallContext
  ): Promise<ToolExecutionResult> => {
    // 校验参数
    const commands = args.commands;
    if (!Array.isArray(commands) || commands.length === 0) {
      return {
        success: false,
        content: 'Parameter "commands" must be a non-empty array of table edit commands.',
        continueLoop: false,
      };
    }

    if (!context) {
      return {
        success: false,
        content: 'No context provided. Cannot determine which table to update.',
        continueLoop: false,
      };
    }

    // 转换参数格式（AI 传入的 JSON → TableEditCommand 格式）
    const tableCommands = commands.map((cmd, index) => {
      if (!cmd || typeof cmd !== 'object') {
        throw new Error(`Command ${index}: invalid command object`);
      }
      const c = cmd as Record<string, unknown>;
      const type = c.type as 'insertRow' | 'updateRow' | 'deleteRow';
      if (!['insertRow', 'updateRow', 'deleteRow'].includes(type)) {
        throw new Error(`Command ${index}: invalid type "${type}"`);
      }
      const tableIndex = Number(c.tableIndex);
      if (!Number.isInteger(tableIndex) || tableIndex < 1) {
        throw new Error(`Command ${index}: tableIndex must be a positive integer`);
      }
      const rowIndex = c.rowIndex !== undefined ? Number(c.rowIndex) : undefined;
      const data = c.data as Record<string, string> | undefined;
      return { type, tableIndex, rowIndex, data };
    });

    try {
      const result = await tableExecutor.execute(context, tableCommands);
      const summary = `Executed ${result.executed}/${commands.length} commands.` +
        (result.errors.length > 0 ? ` Errors: ${result.errors.join('; ')}` : '');
      return {
        success: result.success,
        content: summary,
        continueLoop: true, // 让模型知道执行结果，决定下一步
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        content: `Table update failed: ${errMsg}. Please check the command format and try again.`,
        continueLoop: true,
      };
    }
  };
}

// ==================== 注册便捷函数 ====================

/**
 * 注册 updateStateTable 工具到 ToolRegistry。
 *
 * @param registry 工具注册中心
 * @param tableExecutor 表格执行器
 */
export function registerUpdateStateTableTool(
  registry: { register: (descriptor: ToolDescriptor, executor: ToolExecutor) => void },
  tableExecutor: ITableEditExecutor
): void {
  registry.register(
    updateStateTableDescriptor,
    createUpdateStateTableExecutor(tableExecutor)
  );
}
