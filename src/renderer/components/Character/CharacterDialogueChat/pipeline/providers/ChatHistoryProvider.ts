/**
 * 对话历史片段 Provider — ChatHistoryProvider
 *
 * Spec: redesign-dialogue-pipeline-architecture / PromptComposer
 *
 * 迁移自 PromptBuilder.ts::buildFinalSystemPrompt 中的"区域 2：本会话相关历史片段"段落。
 * 将 RAG 检索到的历史片段格式化为参考段落注入 system prompt。
 */

import type { PromptProvider, DialoguePipelineContext, ChatHistoryItem } from '../pipeline.types';

export class ChatHistoryProvider implements PromptProvider {
  readonly name = 'ChatHistoryProvider';
  readonly priority = 210;
  readonly section = 'context' as const;

  isActive(context: DialoguePipelineContext): boolean {
    return context.retrievedContext.chatHistory.length > 0;
  }

  async build(context: DialoguePipelineContext): Promise<string> {
    const items = context.retrievedContext.chatHistory;
    if (!items || items.length === 0) return '';

    const formatted = items
      .map((item: ChatHistoryItem, idx: number) => {
        const score = typeof item.score === 'number' ? ` (相关度: ${(item.score * 100).toFixed(1)}%)` : '';
        return `[历史片段 ${idx + 1}]${score}\n${item.content}`;
      })
      .join('\n\n');

    let result = '';
    result += `\n═══════════════════════════════════════════════════════`;
    result += `\n## 本会话相关历史片段（以下为从本对话历史向量检索的相关片段，仅供补充上下文参考，不是当前对话的一部分）`;
    result += `\n═══════════════════════════════════════════════════════\n\n`;
    result += formatted;
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n## 本会话相关历史片段结束 - 以上历史片段仅供参考`;
    result += `\n═══════════════════════════════════════════════════════`;

    return result;
  }
}
