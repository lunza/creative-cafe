/**
 * 异步表格整理指令 Provider — AsyncTableOrganizeProvider
 *
 * Spec: redesign-dialogue-pipeline-architecture / PromptComposer
 *
 * 迁移自 PromptBuilder.ts::buildAsyncTableOrganizeInstructions。
 * 异步整理模式下，将完整的表格整理指令拼接到 system prompt 末尾。
 *
 * 复用 PromptBuilder.ts::buildAsyncTableOrganizeInstructions 导出函数，
 * 将管线 TableStructure 类型适配为该函数所期望的格式。
 */

import type { PromptProvider, DialoguePipelineContext, TableStructure } from '../pipeline.types';
import { buildAsyncTableOrganizeInstructions } from '../../PromptBuilder';

/**
 * 将管线 TableStructure 类型适配为 buildAsyncTableOrganizeInstructions 所期望的格式。
 *
 * 管线类型：{ sheets: Array<{ sheetName, headers, rowCount }> }
 * 期望类型：{ sheets: string[], headers: Record<string, string[]>, descriptions: Record<string, string> }
 */
function adaptTableStructure(
  structure: TableStructure | null
): { sheets: string[]; headers: Record<string, string[]>; descriptions: Record<string, string> } | undefined {
  if (!structure || !structure.sheets || structure.sheets.length === 0) return undefined;
  const sheets: string[] = [];
  const headers: Record<string, string[]> = {};
  const descriptions: Record<string, string> = {};
  for (const sheet of structure.sheets) {
    sheets.push(sheet.sheetName);
    headers[sheet.sheetName] = sheet.headers || [];
    descriptions[sheet.sheetName] = ''; // 管线类型无 descriptions 字段
  }
  return { sheets, headers, descriptions };
}

export class AsyncTableOrganizeProvider implements PromptProvider {
  readonly name = 'AsyncTableOrganizeProvider';
  readonly priority = 440;
  readonly section = 'suffix' as const;

  isActive(context: DialoguePipelineContext): boolean {
    return context.sessionConfig.memoryTableOrganizeMode === 'async';
  }

  async build(context: DialoguePipelineContext): Promise<string> {
    const memoryTableData = context.retrievedContext.memoryTableData;
    const tableStructure = adaptTableStructure(context.retrievedContext.memoryTableStructure);

    const instructions = await buildAsyncTableOrganizeInstructions(memoryTableData, tableStructure);

    let result = '';
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n## 记忆表格异步整理指令（以下为系统指令，不是对话内容，请严格按照要求执行）`;
    result += `\n═══════════════════════════════════════════════════════`;
    result += instructions;
    result += `\n═══════════════════════════════════════════════════════`;
    result += `\n## 记忆表格异步整理指令结束 - 以上为系统指令`;
    result += `\n═══════════════════════════════════════════════════════`;

    return result;
  }
}
