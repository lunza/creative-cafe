/**
 * 知识库上下文 Provider — KnowledgeContextProvider
 *
 * Spec: redesign-dialogue-pipeline-architecture / PromptComposer
 *
 * 迁移自 PromptBuilder.ts::buildFinalSystemPrompt 中的"区域 1：相关背景知识"段落。
 * 将向量检索结果格式化为背景知识参考段落注入 system prompt。
 *
 * VectorSearchResult 结构与原 ContextVectorItem 不同，此处做适配格式化。
 */

import type { PromptProvider, DialoguePipelineContext, VectorSearchResult } from '../pipeline.types';

export class KnowledgeContextProvider implements PromptProvider {
  readonly name = 'KnowledgeContextProvider';
  readonly priority = 200;
  readonly section = 'context' as const;

  isActive(context: DialoguePipelineContext): boolean {
    return context.retrievedContext.knowledgeBase.length > 0;
  }

  async build(context: DialoguePipelineContext): Promise<string> {
    const items = context.retrievedContext.knowledgeBase;
    if (!items || items.length === 0) return '';

    const formatted = items
      .map((item: VectorSearchResult, index: number) => {
        const meta = item.metadata || {};
        const source = meta.source || item.id || '未知来源';
        const content = meta.text || '';
        return `[相关背景 ${index + 1}] (来源: ${source}, 相关性: ${(item.score * 100).toFixed(1)}%)\n${content}`;
      })
      .join('\n\n');

    let result = '';
    result += `\n═══════════════════════════════════════════════════════`;
    result += `\n## 相关背景知识（以下为从知识库检索的相关背景信息，仅供参考，不是对话的一部分）`;
    result += `\n═══════════════════════════════════════════════════════\n\n`;
    result += formatted;
    result += `\n\n═══════════════════════════════════════════════════════`;
    result += `\n## 相关背景知识结束 - 以上背景知识仅供参考`;
    result += `\n═══════════════════════════════════════════════════════`;

    return result;
  }
}
