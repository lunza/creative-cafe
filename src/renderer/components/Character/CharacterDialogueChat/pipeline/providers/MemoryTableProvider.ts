/**
 * 记忆表格数据 Provider — MemoryTableProvider
 *
 * Spec: redesign-dialogue-pipeline-architecture / PromptComposer
 *
 * 迁移自 PromptBuilder.ts::buildFinalSystemPrompt 中的"区域 3：记忆表格数据"段落。
 * 将记忆表格的 markdown 数据注入 system prompt 作为参考。
 */

import type { PromptProvider, DialoguePipelineContext } from '../pipeline.types';

export class MemoryTableProvider implements PromptProvider {
  readonly name = 'MemoryTableProvider';
  readonly priority = 220;
  readonly section = 'context' as const;

  isActive(context: DialoguePipelineContext): boolean {
    return !!context.retrievedContext.memoryTableData && context.retrievedContext.memoryTableData.trim().length > 0;
  }

  async build(context: DialoguePipelineContext): Promise<string> {
    const memoryTableData = context.retrievedContext.memoryTableData;
    if (!memoryTableData || !memoryTableData.trim()) return '';

    let result = '';
    result += `\n═══════════════════════════════════════════════════════`;
    result += `\n## 记忆表格数据（以下为已记录的记忆表格，仅供参考，不是对话的一部分）`;
    result += `\n═══════════════════════════════════════════════════════\n\n`;
    result += memoryTableData;
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n## 记忆表格数据结束 - 以上记忆表格数据仅供参考`;
    result += `\n═══════════════════════════════════════════════════════`;

    return result;
  }
}
