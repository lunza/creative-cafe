import { ipcMain } from 'electron';
import { SearchResult, ContextItem, RetrieveOptions } from '../types/vectorConfig';
import { vectorStoreService } from './VectorStoreService';
import { embeddingService } from './EmbeddingService';

interface Message {
  role: string;
  content: string;
}

export class ContextManager {
  async retrieveContext(
    conversation: Message[],
    options: RetrieveOptions
  ): Promise<ContextItem[]> {
    try {
      const lastMessage = conversation[conversation.length - 1];
      if (!lastMessage || !lastMessage.content) {
        return [];
      }

      const embedResult = await embeddingService.generateEmbedding(lastMessage.content);
      if (!embedResult.success || !embedResult.vector) {
        return [];
      }

      const queryVector = embedResult.vector;

      let filter: Record<string, any> = {};
      if (options.filter) {
        filter = options.filter;
      }
      if (options.sources && options.sources.length > 0) {
        filter.source = options.sources;
      }

      const results = await vectorStoreService.search(queryVector, options.topK, filter);

      const contextItems: ContextItem[] = results
        .filter(r => r.score >= options.minScore)
        .map(r => ({
          id: r.id,
          source: r.metadata.source || 'unknown',
          content: r.metadata.text || '',
          score: r.score,
          metadata: r.metadata
        }));

      return contextItems;
    } catch (error) {
      console.error('[ContextManager] 检索上下文失败:', error);
      return [];
    }
  }

  buildPromptWithSystem(
    systemPrompt: string,
    context: ContextItem[]
  ): string {
    if (context.length === 0) {
      return systemPrompt;
    }

    const contextSection = context
      .map((item, index) => {
        return `[上下文 ${index + 1}] (来源: ${item.source}, 相关性: ${(item.score * 100).toFixed(1)}%)\n${item.content}`;
      })
      .join('\n\n');

    return `${systemPrompt}\n\n--- 相关上下文 ---\n\n${contextSection}\n\n--- 请根据以上上下文回答问题 ---`;
  }

  async compressContext(items: ContextItem[], maxTokens: number): Promise<string> {
    if (items.length === 0) return '';

    const sortedItems = [...items].sort((a, b) => b.score - a.score);

    let compressed = '';
    let tokenCount = 0;
    const tokensPerChar = 0.25;

    for (const item of sortedItems) {
      const itemText = item.content;
      const estimatedTokens = itemText.length * tokensPerChar;

      if (tokenCount + estimatedTokens > maxTokens) {
        const remainingTokens = maxTokens - tokenCount;
        const remainingChars = Math.floor(remainingTokens / tokensPerChar);
        if (remainingChars > 50) {
          compressed += itemText.substring(0, remainingChars) + '...\n\n';
        }
        break;
      }

      compressed += itemText + '\n\n';
      tokenCount += estimatedTokens;
    }

    return compressed.trim();
  }

  async generateSummary(text: string): Promise<string> {
    try {
      if (text.length < 100) {
        return text;
      }

      const prompt = `请对以下文本生成简洁的摘要（不超过100字）：\n\n${text.substring(0, 2000)}\n\n摘要：`;

      const embedResult = await embeddingService.generateEmbedding(prompt);
      return text.substring(0, 200);
    } catch (error) {
      console.error('[ContextManager] 生成摘要失败:', error);
      return text.substring(0, 200);
    }
  }

  registerIpcHandlers(): void {
    ipcMain.handle('context:retrieve', async (_event, { conversation, options }: { conversation: Message[]; options: RetrieveOptions }) => {
      try {
        const items = await this.retrieveContext(conversation, options);
        return { success: true, items };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('context:compress', async (_event, { items, maxTokens }: { items: ContextItem[]; maxTokens: number }) => {
      try {
        const compressed = await this.compressContext(items, maxTokens);
        return { success: true, compressed };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
  }
}

export const contextManager = new ContextManager();
