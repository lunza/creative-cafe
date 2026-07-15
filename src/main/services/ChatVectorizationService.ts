import path from 'path';
import { embeddingService } from './EmbeddingService';
import { vectorStoreService } from './VectorStoreService';
import { vectorRegistryService } from './VectorRegistryService';
import { VectorSourceType } from '../types/vectorConfig';
import { getStorageService } from './storageService';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  name?: string;
  create_date?: number;
  [key: string]: any;
}

export interface VectorizeChatResult {
  success: boolean;
  messagesVectorized: number;
  messagesFailed: number;
  error?: string;
  messageVectorIds: string[];
}

export class ChatVectorizationService {
  async vectorizeChat(
    characterId: string,
    messages: ChatMessage[]
  ): Promise<VectorizeChatResult> {
    try {
      console.log(`[ChatVectorizationService] vectorizeChat: starting for character ${characterId}`);

      if (!characterId || characterId.trim().length === 0) {
        return { success: false, messagesVectorized: 0, messagesFailed: 0, error: '角色ID为空', messageVectorIds: [] };
      }

      if (!messages || messages.length === 0) {
        return { success: false, messagesVectorized: 0, messagesFailed: 0, error: '消息列表为空', messageVectorIds: [] };
      }

      // 注意：手动按钮触发的向量化不需要检查 autoVectorizeWorldBook 配置
      // 该配置仅用于控制自动向量化，不影响手动触发的向量化

      const result: VectorizeChatResult = {
        success: true,
        messagesVectorized: 0,
        messagesFailed: 0,
        messageVectorIds: []
      };

      let chunkIndex = 0;
      for (const message of messages) {
        if (!message.content || message.content.trim().length === 0) {
          console.log(`[ChatVectorizationService] vectorizeChat: skipping empty message at index ${chunkIndex}`);
          chunkIndex++;
          continue;
        }

        if (message.role !== 'user' && message.role !== 'assistant') {
          console.log(`[ChatVectorizationService] vectorizeChat: skipping system message at index ${chunkIndex}`);
          chunkIndex++;
          continue;
        }

        const vectorizeText = this.buildMessageText(message, chunkIndex);
        const messageId = `chat_${characterId}_${chunkIndex}`;

        try {
          console.log(`[ChatVectorizationService] vectorizeChat: vectorizing message ${chunkIndex} (role: ${message.role})`);

          const embedResult = await embeddingService.generateEmbedding(vectorizeText);

          if (embedResult.success && embedResult.vector) {
            const metadata: Record<string, any> = {
              text: vectorizeText,
              source: VectorSourceType.CHARACTER_CHAT,
              sourceId: characterId,
              sourceType: 'chat_message',
              characterId: characterId,
              chunkIndex: chunkIndex,
              messageRole: message.role,
              messageName: message.name || '',
              messageCreateDate: message.create_date || Date.now(),
              isUserMessage: message.role === 'user',
              isAssistantMessage: message.role === 'assistant',
              createdAt: Date.now(),
              updatedAt: Date.now()
            };

            await vectorStoreService.add(messageId, embedResult.vector, metadata);
            result.messagesVectorized++;
            result.messageVectorIds.push(messageId);
            console.log(`[ChatVectorizationService] vectorizeChat: message ${chunkIndex} vectorized successfully`);
          } else {
            result.messagesFailed++;
            console.warn(`[ChatVectorizationService] vectorizeChat: message ${chunkIndex} vectorization failed: ${embedResult.error}`);
          }
        } catch (error) {
          result.messagesFailed++;
          console.error(`[ChatVectorizationService] vectorizeChat: message ${chunkIndex} vectorization error:`, error);
        }

        chunkIndex++;
      }

      await vectorStoreService.persist();
      console.log(`[ChatVectorizationService] vectorizeChat: persisted vectors after vectorization`);

      console.log(`[ChatVectorizationService] vectorizeChat: completed - messagesVectorized=${result.messagesVectorized}, messagesFailed=${result.messagesFailed}`);

      if (result.messagesVectorized > 0) {
        try {
          await vectorRegistryService.registerVectorFile({
            vectorFileId: characterId,
            sourceType: VectorSourceType.CHARACTER_CHAT,
            sourceId: characterId,
            sourceName: characterId,
            vectorCount: result.messagesVectorized,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            status: 'active',
            additionalMetadata: {
              messagesVectorized: result.messagesVectorized,
              messagesFailed: result.messagesFailed,
              messageVectorIds: result.messageVectorIds,
            }
          });
          console.log(`[ChatVectorizationService] vectorizeChat: registered to vector registry with sourceType=${VectorSourceType.CHARACTER_CHAT}, sourceId=${characterId}`);
        } catch (error) {
          console.error('[ChatVectorizationService] vectorizeChat: failed to register to registry:', error);
        }
      }

      return result;

    } catch (error) {
      console.error('[ChatVectorizationService] vectorizeChat: fatal error:', error);
      return {
        success: false,
        messagesVectorized: 0,
        messagesFailed: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
        messageVectorIds: []
      };
    }
  }

  async deleteVectorization(characterId: string): Promise<{ success: boolean; deletedCount: number; error?: string }> {
    try {
      console.log(`[ChatVectorizationService] deleteVectorization: starting for character ${characterId}`);

      const registryEntries = await vectorRegistryService.getVectorFilesBySourceId(characterId);
      console.log(`[ChatVectorizationService] deleteVectorization: found ${registryEntries.length} registry entries`);

      let totalDeleted = 0;
      if (registryEntries.length > 0) {
        for (const entry of registryEntries) {
          if (entry.sourceType !== VectorSourceType.CHARACTER_CHAT) {
            continue;
          }

          console.log(`[ChatVectorizationService] deleteVectorization: deleting vectors from ${entry.sourceType}:${entry.sourceId}`);
          const deleted = await vectorStoreService.deleteByPrefix(`chat_${characterId}_`, {
            sourceType: entry.sourceType,
            sourceId: entry.sourceId,
          });
          totalDeleted += deleted;
          console.log(`[ChatVectorizationService] deleteVectorization: deleted ${deleted} vectors`);

          const remainingCount = await vectorStoreService.countByPrefix(`chat_${characterId}_`);
          if (remainingCount === 0) {
            console.log(`[ChatVectorizationService] deleteVectorization: removing registry entry ${entry.id}`);
            await vectorRegistryService.deleteVectorFile(entry.id);
            console.log(`[ChatVectorizationService] deleteVectorization: vecstore files will be cleaned up on next service initialization`);
          } else {
            console.log(`[ChatVectorizationService] deleteVectorization: updating vectorCount to ${remainingCount}`);
            await vectorRegistryService.updateVectorFile(entry.id, { vectorCount: remainingCount });
          }
        }
      } else {
        console.log(`[ChatVectorizationService] deleteVectorization: no registry entries, falling back to global delete`);
        totalDeleted = await vectorStoreService.deleteByPrefix(`chat_${characterId}_`);
        console.log(`[ChatVectorizationService] deleteVectorization: deleted ${totalDeleted} vectors from all stores`);
      }

      console.log(`[ChatVectorizationService] deleteVectorization: completed, totalDeleted=${totalDeleted}`);
      return { success: true, deletedCount: totalDeleted };
    } catch (error) {
      console.error(`[ChatVectorizationService] deleteVectorization failed for ${characterId}:`, error);
      return { success: false, deletedCount: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async searchChatMessages(characterId: string, query: string, topK: number = 5): Promise<Array<{ id: string; score: number; metadata: Record<string, any> }>> {
    try {
      const embedResult = await embeddingService.generateEmbedding(query);
      if (!embedResult.success || !embedResult.vector) {
        return [];
      }

      const results = await vectorStoreService.search(embedResult.vector, topK, {
        source: VectorSourceType.CHARACTER_CHAT,
        characterId: characterId
      });

      return results;
    } catch (error) {
      console.error('[ChatVectorizationService] searchChatMessages: failed:', error);
      return [];
    }
  }

  /**
   * 检索本会话历史消息的向量相似片段（Spec: optimize-chat-ai-intelligence / Task 7.1）
   *
   * 与 searchChatMessages 的差异：
   *   - 接口名贴合 spec 描述（chatHistory:retrieve IPC channel）
   *   - 返回值结构精简为 {content, score, timestamp}，便于 hooks.ts 直接注入 system prompt
   *   - 内置 minScore 阈值过滤，避免低相似度片段污染上下文
   *   - 失败时返回空数组（不抛异常），保证对话主流程不被阻塞
   *
   * @param chatId 会话标识（hooks.ts 传入 characterInfo.characterCardName || characterCardId，与 vectorizeChat 的 characterId 同源）
   * @param queryText 检索文本（一般为最近一条用户消息）
   * @param topK 返回条数上限，默认 3
   * @param minScore 相似度阈值，默认 0.6（spec 约定）
   */
  async retrieveChatHistory(
    chatId: string,
    queryText: string,
    topK: number = 3,
    minScore: number = 0.6
  ): Promise<Array<{ content: string; score: number; timestamp: number }>> {
    try {
      if (!chatId || !queryText || queryText.trim().length === 0) {
        return [];
      }

      const embedResult = await embeddingService.generateEmbedding(queryText);
      if (!embedResult.success || !embedResult.vector) {
        console.warn('[ChatVectorizationService] retrieveChatHistory: embedding generation failed:', embedResult.error);
        return [];
      }

      // 多取一些候选（topK * 2）以便 minScore 过滤后仍能凑够 topK 条
      const candidateCount = Math.max(topK * 2, topK);
      const results = await vectorStoreService.search(embedResult.vector, candidateCount, {
        source: VectorSourceType.CHARACTER_CHAT,
        characterId: chatId,
      });

      const filtered = results
        .filter(r => r.score >= minScore)
        .slice(0, topK)
        .map(r => ({
          // metadata.text 由 vectorizeChat / vectorizeIncremental 写入（buildMessageText 的输出）
          content: (r.metadata?.text as string) || (r.metadata?.content as string) || '',
          score: r.score,
          timestamp: (r.metadata?.messageCreateDate as number) || (r.metadata?.createdAt as number) || 0,
        }))
        .filter(item => item.content.length > 0);

      // 按时间升序排列，便于 system prompt 中按对话发生顺序注入（spec: "按时间顺序注入"）
      filtered.sort((a, b) => a.timestamp - b.timestamp);

      console.log(`[ChatVectorizationService] retrieveChatHistory: chatId=${chatId}, query length=${queryText.length}, candidates=${results.length}, filtered=${filtered.length}`);
      return filtered;
    } catch (error) {
      console.error('[ChatVectorizationService] retrieveChatHistory: failed (returning empty array to not block main flow):', error);
      return [];
    }
  }

  /**
   * 增量向量化本会话消息（Spec: optimize-chat-ai-intelligence / Task 7.2）
   *
   * 与 vectorizeChat 的差异：
   *   - 跳过已向量化的 messageId（通过 vectorStoreService.getById 检查），避免重复向量化
   *   - 使用稳定的 messageId 格式 `chat_${chatId}_msg_${message.id}`，与 vectorizeChat 的
   *     `chat_${characterId}_${chunkIndex}` 共存于同一 source store（同 characterId），互不冲突
   *   - 失败仅记录日志，不抛异常（spec: "向量化失败不阻塞对话主流程"）
   *   - 持久化与 registry 注册复用 vectorizeChat 的逻辑（注册时追加 messagesVectorized 计数）
   *
   * @param chatId 会话标识（同 retrieveChatHistory）
   * @param messages 待向量化的消息列表（一般为最近 10 条用户+AI 消息）
   */
  async vectorizeIncremental(chatId: string, messages: ChatMessage[]): Promise<void> {
    try {
      if (!chatId || chatId.trim().length === 0) {
        console.warn('[ChatVectorizationService] vectorizeIncremental: chatId is empty, skipping');
        return;
      }

      if (!messages || messages.length === 0) {
        console.log('[ChatVectorizationService] vectorizeIncremental: messages is empty, skipping');
        return;
      }

      console.log(`[ChatVectorizationService] vectorizeIncremental: starting for chatId=${chatId}, messages=${messages.length}`);

      let vectorizedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      const vectorIds: string[] = [];
      const vectorizeStartTime = Date.now();

      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];

        // 跳过空消息与 system 消息（与 vectorizeChat 行为一致）
        if (!message.content || message.content.trim().length === 0) {
          skippedCount++;
          continue;
        }
        if (message.role !== 'user' && message.role !== 'assistant') {
          skippedCount++;
          continue;
        }

        // 稳定的 messageId：使用 message.id 字段（hooks.ts 中为时间戳+随机串）
        // 若 message.id 缺失，回退到 index 标识，保证幂等性
        const msgIdPart = (message.id as string) || `idx${i}`;
        const vectorId = `chat_${chatId}_msg_${msgIdPart}`;

        try {
          // 检查是否已向量化（幂等性保证）
          const existing = await vectorStoreService.getById(vectorId);
          if (existing) {
            skippedCount++;
            console.log(`[ChatVectorizationService] vectorizeIncremental: [${i + 1}/${messages.length}] skipped (already vectorized) id=${vectorId}`);
            continue;
          }

          const vectorizeText = this.buildMessageText(message, i);
          const embedStart = Date.now();
          console.log(`[ChatVectorizationService] vectorizeIncremental: [${i + 1}/${messages.length}] generating embedding, role=${message.role}, textLen=${vectorizeText.length}, id=${vectorId}`);
          const embedResult = await embeddingService.generateEmbedding(vectorizeText);
          const embedDuration = Date.now() - embedStart;

          if (embedResult.success && embedResult.vector) {
            console.log(`[ChatVectorizationService] vectorizeIncremental: [${i + 1}/${messages.length}] embedding done in ${embedDuration}ms, dim=${embedResult.vector.length}, writing to store`);
            const metadata: Record<string, any> = {
              text: vectorizeText,
              source: VectorSourceType.CHARACTER_CHAT,
              sourceId: chatId,
              sourceType: 'chat_message',
              characterId: chatId,
              chunkIndex: i,
              messageId: msgIdPart,
              messageRole: message.role,
              messageName: message.name || '',
              messageCreateDate: message.create_date || message.timestamp || Date.now(),
              isUserMessage: message.role === 'user',
              isAssistantMessage: message.role === 'assistant',
              isIncremental: true, // 标记为增量向量化，便于排查
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };

            await vectorStoreService.add(vectorId, embedResult.vector, metadata);
            vectorizedCount++;
            vectorIds.push(vectorId);
            console.log(`[ChatVectorizationService] vectorizeIncremental: [${i + 1}/${messages.length}] added to store, total vectorized=${vectorizedCount}`);
          } else {
            failedCount++;
            console.warn(`[ChatVectorizationService] vectorizeIncremental: [${i + 1}/${messages.length}] embedding failed in ${embedDuration}ms: ${embedResult.error}`);
          }
        } catch (error) {
          failedCount++;
          console.error(`[ChatVectorizationService] vectorizeIncremental: [${i + 1}/${messages.length}] vectorization error:`, error);
        }
      }

      if (vectorizedCount > 0) {
        try {
          const persistStart = Date.now();
          console.log(`[ChatVectorizationService] vectorizeIncremental: persisting ${vectorizedCount} new vectors...`);
          await vectorStoreService.persist();
          console.log(`[ChatVectorizationService] vectorizeIncremental: persist done in ${Date.now() - persistStart}ms`);
        } catch (persistError) {
          console.error('[ChatVectorizationService] vectorizeIncremental: persist failed:', persistError);
        }

        // 注册到 registry（更新计数；若不存在则创建）
        try {
          const existingEntries = await vectorRegistryService.getVectorFilesBySourceId(chatId);
          const chatEntry = existingEntries.find(e => e.sourceType === VectorSourceType.CHARACTER_CHAT);
          if (chatEntry) {
            const newCount = (chatEntry.vectorCount || 0) + vectorizedCount;
            await vectorRegistryService.updateVectorFile(chatEntry.id, {
              vectorCount: newCount,
              updatedAt: Date.now(),
            });
            console.log(`[ChatVectorizationService] vectorizeIncremental: updated registry entry ${chatEntry.id} vectorCount to ${newCount}`);
          } else {
            await vectorRegistryService.registerVectorFile({
              vectorFileId: chatId,
              sourceType: VectorSourceType.CHARACTER_CHAT,
              sourceId: chatId,
              sourceName: chatId,
              vectorCount: vectorizedCount,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              status: 'active',
              additionalMetadata: {
                messagesVectorized: vectorizedCount,
                messagesFailed: failedCount,
                messageVectorIds: vectorIds,
                incremental: true,
              },
            });
            console.log(`[ChatVectorizationService] vectorizeIncremental: created new registry entry for chatId=${chatId}`);
          }
        } catch (registryError) {
          console.error('[ChatVectorizationService] vectorizeIncremental: registry update failed:', registryError);
        }
      }

      console.log(
        `[ChatVectorizationService] vectorizeIncremental: completed in ${Date.now() - vectorizeStartTime}ms - vectorized=${vectorizedCount}, skipped=${skippedCount}, failed=${failedCount}`
      );
    } catch (error) {
      // spec: "向量化失败不阻塞对话主流程（仅记录日志）"
      console.error('[ChatVectorizationService] vectorizeIncremental: fatal error (swallowed to not block main flow):', error);
    }
  }

  private buildMessageText(message: ChatMessage, index: number): string {
    const roleLabel = message.role === 'user' ? '用户' : '助手';
    const nameInfo = message.name ? ` (名称: ${message.name})` : '';
    return `${roleLabel}${nameInfo} [消息 ${index}]:\n${message.content}`;
  }
}

export const chatVectorizationService = new ChatVectorizationService();
