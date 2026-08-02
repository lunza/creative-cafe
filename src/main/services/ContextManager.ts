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

/**
 * 文本分词（中文按字符，英文按空格）。
 */
function tokenize(text: string): Set<string> {
  // 中文按字符分词，英文按空格分词
  const tokens = new Set<string>();
  // 英文单词
  const englishWords = text.toLowerCase().match(/[a-z]+/g) || [];
  englishWords.forEach(w => tokens.add(w));
  // 中文字符（每2个字一组，滑动窗口）
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  for (let i = 0; i < chineseChars.length - 1; i++) {
    tokens.add(chineseChars[i] + chineseChars[i + 1]);
  }
  // 单字也加入
  chineseChars.forEach(c => tokens.add(c));
  return tokens;
}

/**
 * Jaccard 相似度（交集/并集）。
 */
function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
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

  /**
   * 混合检索：向量检索 + 关键词检索合并，MMR 去重 + 时间衰减。
   *
   * 参考 openclaw 混合检索策略：
   *  - 向量检索（权重 0.7）+ 关键词检索（权重 0.3）合并
   *  - MMR 去重：MMR = λ * sim(query, doc) - (1-λ) * max(sim(doc, selected_docs))，λ=0.7
   *  - 时间衰减：score *= exp(-daysSinceLastAccess / 30)，30 天半衰期
   *  - 统一检索 memory + worldbook + chatHistory 三源
   *
   * @param query 查询文本
   * @param options 检索选项（topK/minScore/sources/scopeIds/filter）
   * @returns 混合检索结果（按 score 降序，经 MMR 去重 + 时间衰减）
   */
  async retrieveWithHybrid(
    query: string,
    options: RetrieveOptions & {
      /** MMR lambda 参数（默认 0.7，越大越注重相关性，越小越注重多样性） */
      mmrLambda?: number;
      /** 时间衰减半衰期（天，默认 30） */
      timeDecayHalfLife?: number;
      /** 是否启用关键词匹配（默认 true） */
      enableKeywordMatch?: boolean;
      /** 扫描深度（关键词匹配用，最近N条消息，默认4） */
      scanDepth?: number;
      /** 全局扫描数据（关键词匹配用） */
      globalScanData?: {
        personaDescription?: string;
        characterDescription?: string;
        characterPersonality?: string;
        characterDepthPrompt?: string;
        scenario?: string;
        creatorNotes?: string;
      };
      /** 对话历史（关键词匹配用） */
      conversation?: Message[];
    }
  ): Promise<ContextItem[]> {
    try {
      const topK = options.topK || 5;
      const minScore = options.minScore || 0;
      const mmrLambda = options.mmrLambda ?? 0.7;
      const halfLife = options.timeDecayHalfLife ?? 30;
      const enableKeywordMatch = options.enableKeywordMatch !== false;
      const scanDepth = options.scanDepth || 4;

      const vectorWeight = 0.7;
      const keywordWeight = 0.3;

      // ========== 步骤 1：向量检索（权重 0.7） ==========
      const vectorItems: ContextItem[] = [];
      const embedResult = await embeddingService.generateEmbedding(query);
      if (embedResult.success && embedResult.vector) {
        const queryVector = embedResult.vector;
        let filter: Record<string, any> = {};
        if (options.filter) {
          filter = options.filter;
        }
        if (options.sources && options.sources.length > 0) {
          filter.source = options.sources;
        }

        // 多取一倍用于 MMR 筛选
        const results = await vectorStoreService.search(queryVector, topK * 2, filter, {
          scopeIds: options.scopeIds
        });

        for (const r of results) {
          if (r.score >= minScore) {
            vectorItems.push({
              id: r.id,
              source: r.metadata.source || 'unknown',
              content: r.metadata.text || '',
              score: r.score * vectorWeight,
              metadata: r.metadata
            });
          }
        }
      }

      // ========== 步骤 2：关键词检索（权重 0.3） ==========
      const keywordItems: ContextItem[] = [];
      if (enableKeywordMatch && options.scopeIds && options.scopeIds.length > 0) {
        try {
          const scanText = buildScanText(
            options.conversation || [],
            scanDepth,
            options.globalScanData
          );

          const keywordResult = await worldBookService.matchKeywords(scanText, options.scopeIds, {
            caseSensitive: false,
            matchWholeWords: false,
            maxResults: topK
          });

          if (keywordResult.success && keywordResult.matches.length > 0) {
            for (const match of keywordResult.matches) {
              // 去除与向量结果重复的条目（按 metadata.entryUid 去重）
              const alreadyExists = vectorItems.some(vi =>
                vi.metadata && vi.metadata.entryUid === String(match.entry.uid)
              );

              if (!alreadyExists) {
                keywordItems.push({
                  id: `keyword_${match.entry.uid}_${match.matchScore}`,
                  source: 'worldbook_keyword',
                  content: match.content,
                  score: Math.min(match.matchScore / 100, 1.0) * keywordWeight,
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
          console.error('[ContextManager] 混合检索关键词匹配失败:', error);
        }
      }

      // ========== 步骤 3：合并候选集 ==========
      const candidates: ContextItem[] = [...vectorItems, ...keywordItems];

      if (candidates.length === 0) {
        return [];
      }

      // ========== 步骤 4：时间衰减 ==========
      const now = Date.now();
      for (const item of candidates) {
        const timestamp = item.metadata?.timestamp || item.metadata?.createdAt;
        if (timestamp) {
          const daysSinceLastAccess = (now - timestamp) / (1000 * 60 * 60 * 24);
          item.score *= Math.exp(-daysSinceLastAccess / halfLife);
        }
      }

      // ========== 步骤 5：MMR 去重选择 ==========
      // 预计算每个候选条目的 token 集合
      const candidateTokens = candidates.map(c => tokenize(c.content));
      const selected: ContextItem[] = [];
      const selectedIndices: number[] = [];
      const selectedTokens: Set<string>[] = [];

      // 第一条直接选 score 最高的
      let bestIdx = 0;
      for (let i = 1; i < candidates.length; i++) {
        if (candidates[i].score > candidates[bestIdx].score) {
          bestIdx = i;
        }
      }
      selected.push(candidates[bestIdx]);
      selectedIndices.push(bestIdx);
      selectedTokens.push(candidateTokens[bestIdx]);

      // 迭代选择剩余条目
      while (selected.length < topK && selectedIndices.length < candidates.length) {
        let bestMmrScore = -Infinity;
        let bestCandidateIdx = -1;

        for (let i = 0; i < candidates.length; i++) {
          if (selectedIndices.includes(i)) continue;

          const relevanceScore = candidates[i].score;
          // 计算与已选条目的最大相似度
          let maxSimilarity = 0;
          for (const selTokens of selectedTokens) {
            const sim = jaccardSimilarity(candidateTokens[i], selTokens);
            if (sim > maxSimilarity) {
              maxSimilarity = sim;
            }
          }

          const mmrScore = mmrLambda * relevanceScore - (1 - mmrLambda) * maxSimilarity;

          if (mmrScore > bestMmrScore) {
            bestMmrScore = mmrScore;
            bestCandidateIdx = i;
          }
        }

        if (bestCandidateIdx === -1) break;

        selected.push(candidates[bestCandidateIdx]);
        selectedIndices.push(bestCandidateIdx);
        selectedTokens.push(candidateTokens[bestCandidateIdx]);
      }

      // ========== 步骤 6：返回结果 ==========
      // 按最终 score 降序排列
      selected.sort((a, b) => b.score - a.score);

      return selected.slice(0, topK);
    } catch (error) {
      console.error('[ContextManager] 混合检索失败:', error);
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

    ipcMain.handle('context:retrieveWithHybrid', async (_event, { query, options }: { query: string; options: any }) => {
      try {
        const items = await this.retrieveWithHybrid(query, options);
        return { success: true, items };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
  }
}

export const contextManager = new ContextManager();
