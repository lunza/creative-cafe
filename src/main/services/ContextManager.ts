import { ipcMain } from 'electron';
import { SearchResult, ContextItem, RetrieveOptions } from '../types/vectorConfig';
import { vectorStoreService } from './VectorStoreService';
import { embeddingService } from './EmbeddingService';
import { worldBookService } from './worldBookService';

interface Message {
  role: string;
  content: string;
}

interface ContextRetrieveResult {
  vectorItems: ContextItem[];
  keywordItems: ContextItem[];
  allItems: ContextItem[];
}

/**
 * 构建用于关键词匹配的扫描文本
 * 参考 SillyTavern 的 WorldInfoBuffer.get() 方法
 * @param conversation 对话历史
 * @param scanDepth 扫描深度（最近N条消息）
 * @param globalScanData 全局扫描数据
 * @returns 合并后的扫描文本
 */
function buildScanText(
  conversation: Message[],
  scanDepth: number = 4,
  globalScanData?: {
    personaDescription?: string;
    characterDescription?: string;
    characterPersonality?: string;
    characterDepthPrompt?: string;
    scenario?: string;
    creatorNotes?: string;
  }
): string {
  const parts: string[] = [];

  // 1. 最近的 N 条消息（从后往前取，然后反转保持顺序）
  const recentMessages = conversation
    .slice(-scanDepth)
    .filter(msg => msg && msg.content && msg.content.trim())
    .map(msg => msg.content.trim());

  parts.push(...recentMessages);

  // 2. 全局扫描数据（仅包含轻量级元数据，不包含角色卡片）
  // 注意：
  // - 不包含 characterDescription（角色卡片），因为角色卡片中嵌入了所有世界书条目的完整表格
  //   这会导致所有关键词都产生假阳性匹配（关键词在卡片表格中都能找到）
  // - 不包含 characterPersonality/characterDepthPrompt，同理
  // SillyTavern 的 global scan 也只扫描 persona/scenario 等轻量元数据，不扫描角色卡片
  if (globalScanData) {
    if (globalScanData.personaDescription?.trim()) {
      parts.push(globalScanData.personaDescription.trim());
    }
    if (globalScanData.scenario?.trim()) {
      parts.push(globalScanData.scenario.trim());
    }
    if (globalScanData.creatorNotes?.trim()) {
      parts.push(globalScanData.creatorNotes.trim());
    }
  }

  return parts.join('\n');
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

      const results = await vectorStoreService.search(queryVector, options.topK, filter, {
        scopeIds: options.scopeIds
      });

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

  /**
   * 综合检索：向量检索 + 关键词匹配
   * @param conversation 对话历史
   * @param options 检索选项
   * @param enableKeywordMatch 是否启用关键词匹配（默认true）
   * @param scanDepth 扫描深度（最近N条消息，默认4，参考SillyTavern）
   * @param globalScanData 全局扫描数据（角色描述、场景等）
   * @returns 合并后的上下文条目
   */
  async retrieveContextWithKeywords(
    conversation: Message[],
    options: RetrieveOptions,
    enableKeywordMatch: boolean = true,
    scanDepth: number = 4,
    globalScanData?: {
      personaDescription?: string;
      characterDescription?: string;
      characterPersonality?: string;
      characterDepthPrompt?: string;
      scenario?: string;
      creatorNotes?: string;
    }
  ): Promise<ContextRetrieveResult> {
    try {
      const lastMessage = conversation[conversation.length - 1];
      if (!lastMessage || !lastMessage.content) {
        return { vectorItems: [], keywordItems: [], allItems: [] };
      }

      const text = lastMessage.content;
      const vectorItems: ContextItem[] = [];
      const keywordItems: ContextItem[] = [];

      // 第一步：向量检索
      const embedResult = await embeddingService.generateEmbedding(text);
      if (embedResult.success && embedResult.vector) {
        const queryVector = embedResult.vector;
        let filter: Record<string, any> = {};
        if (options.filter) {
          filter = options.filter;
        }
        if (options.sources && options.sources.length > 0) {
          filter.source = options.sources;
        }

        const results = await vectorStoreService.search(queryVector, options.topK, filter, {
          scopeIds: options.scopeIds
        });

        for (const r of results) {
          if (r.score >= options.minScore) {
            vectorItems.push({
              id: r.id,
              source: r.metadata.source || 'unknown',
              content: r.metadata.text || '',
              score: r.score,
              metadata: r.metadata
            });
          }
        }
      }

      // 第二步：关键词匹配（仅对 worldbook 来源）
      if (enableKeywordMatch && options.scopeIds && options.scopeIds.length > 0) {
        try {
          // 构建扫描文本：最近 N 条消息 + 全局扫描数据
          const scanText = buildScanText(conversation, scanDepth, globalScanData);
          console.log(`[ContextManager] 扫描文本长度: ${scanText.length}, 前200字符: ${scanText.substring(0, 200)}`);

          const keywordResult = await worldBookService.matchKeywords(scanText, options.scopeIds, {
            caseSensitive: false,
            matchWholeWords: false,
            maxResults: 5,
          });
          console.log(`[ContextManager] 关键词匹配返回: ${keywordResult.matches.length} 个匹配, success=${keywordResult.success}`);

          if (keywordResult.success && keywordResult.matches.length > 0) {
            for (const match of keywordResult.matches) {
              // 去重：检查是否已通过向量检索获取
              const alreadyExists = vectorItems.some(vi => 
                vi.metadata && vi.metadata.entryUid === String(match.entry.uid)
              );

              if (!alreadyExists) {
                keywordItems.push({
                  id: `keyword_${match.entry.uid}_${match.matchScore}`,
                  source: 'worldbook_keyword',
                  content: match.content,
                  score: Math.min(match.matchScore / 100, 1.0),
                  metadata: {
                    source: 'worldbook',
                    text: match.content,
                    entryUid: match.entry.uid,
                    matchedKeys: match.matchedKeys,
                    matchType: match.matchType,
                    matchScore: match.matchScore,
                    entryName: match.name,
                    entryComment: match.comment,
                  }
                });
              }
            }
          }
        } catch (error) {
          console.error('[ContextManager] 关键词匹配失败:', error);
        }
      }

      // 合并：向量结果优先，关键词结果追加
      const allItems = [...vectorItems, ...keywordItems];

      return {
        vectorItems,
        keywordItems,
        allItems,
      };
    } catch (error) {
      console.error('[ContextManager] 综合检索失败:', error);
      return { vectorItems: [], keywordItems: [], allItems: [] };
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

  registerIpcHandlers(): void {
    ipcMain.handle('context:retrieve', async (_event, { conversation, options }: { conversation: Message[]; options: RetrieveOptions }) => {
      try {
        const items = await this.retrieveContext(conversation, options);
        return { success: true, items };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('context:retrieveWithKeywords', async (_event, { conversation, options, enableKeywordMatch, scanDepth, globalScanData }: { 
      conversation: Message[]; 
      options: RetrieveOptions; 
      enableKeywordMatch?: boolean;
      scanDepth?: number;
      globalScanData?: {
        personaDescription?: string;
        characterDescription?: string;
        characterPersonality?: string;
        characterDepthPrompt?: string;
        scenario?: string;
        creatorNotes?: string;
      };
    }) => {
      try {
        const result = await this.retrieveContextWithKeywords(
          conversation, 
          options, 
          enableKeywordMatch !== false, 
          scanDepth || 4,
          globalScanData
        );
        return { success: true, items: result.allItems, vectorItems: result.vectorItems, keywordItems: result.keywordItems };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('worldbook:matchKeywords', async (_event, { text, worldBookPaths, options }: { text: string; worldBookPaths?: string[]; options?: any }) => {
      try {
        const result = await worldBookService.matchKeywords(text, worldBookPaths, options);
        return result;
      } catch (error) {
        return { success: false, matches: [], count: 0, error: error instanceof Error ? error.message : 'Unknown error' };
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
