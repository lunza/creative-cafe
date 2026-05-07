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

  private buildMessageText(message: ChatMessage, index: number): string {
    const roleLabel = message.role === 'user' ? '用户' : '助手';
    const nameInfo = message.name ? ` (名称: ${message.name})` : '';
    return `${roleLabel}${nameInfo} [消息 ${index}]:\n${message.content}`;
  }
}

export const chatVectorizationService = new ChatVectorizationService();
