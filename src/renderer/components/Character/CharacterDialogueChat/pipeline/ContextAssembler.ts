/**
 * 上下文组装模块 — ContextAssembler
 *
 * Spec: redesign-dialogue-pipeline-architecture / ContextAssembler
 *
 * 统一管理知识库检索、对话历史 RAG、记忆表格数据获取和上下文截断。
 * 所有检索操作失败时降级返回空值并记录警告日志，不中断管线执行。
 *
 * 迁移自 CharacterDialogueChat.hooks.ts 中的以下逻辑：
 * - 知识库检索（Step A：retrieveWithKeywords 调用）
 * - 对话历史 RAG（Step A2：chatHistory.retrieve 调用，长对话 > 40 条触发）
 * - 记忆表格数据获取（Step B：memory.getTableData 调用 + markdown 格式化）
 * - 上下文截断（Step D：TokenCounter + ContextTruncator）
 */

import type {
  VectorSearchResult,
  ChatHistoryItem,
  TableStructure,
  ChatMessage,
} from './pipeline.types';
import type { TruncationConfig } from '../TokenManagement/types';
import { TokenCounter } from '../TokenManagement/TokenCounter';
import { ContextTruncator } from '../TokenManagement/ContextTruncator';

/** RAG 检索触发的消息数阈值（对话历史 > 40 条 = 20 轮时触发） */
const RAG_TRIGGER_THRESHOLD = 40;

/** 知识库检索默认参数（与 hooks.ts 一致） */
const KB_TOP_K = 5;
const KB_MIN_SCORE = 0.3;
const KB_SCAN_DEPTH = 4;

/** 对话历史 RAG 检索默认参数（与 hooks.ts 一致） */
const HISTORY_TOP_K = 3;
const HISTORY_MIN_SCORE = 0.6;

export class ContextAssembler {
  /**
   * 知识库检索：调用向量 + 关键词混合检索 API。
   * 失败时返回空数组并记录警告，不中断管线。
   *
   * 迁移自 hooks.ts Step A 的 retrieveWithKeywords 调用。
   * 参数与 hooks.ts 保持一致：scanDepth=4, topK=5, minScore=0.3。
   *
   * @param query 查询文本（用户最近消息内容）
   * @param scopeIds 知识库范围 ID 列表（为空时不限定范围）
   * @returns 检索结果数组，失败时返回空数组
   */
  async retrieveKnowledgeBase(
    query: string,
    scopeIds: string[],
  ): Promise<VectorSearchResult[]> {
    if (!query) return [];

    try {
      const api = (window as any).electronAPI;
      if (!api?.context?.retrieveWithKeywords) {
        console.warn(
          '[ContextAssembler] electronAPI.context.retrieveWithKeywords 不可用，跳过知识库检索',
        );
        return [];
      }

      const contextResult = await api.context.retrieveWithKeywords(
        [{ role: 'user', content: query }],
        {
          topK: KB_TOP_K,
          minScore: KB_MIN_SCORE,
          sources: ['worldbook', 'knowledge', 'memory'],
          scopeIds: scopeIds.length > 0 ? scopeIds : undefined,
        },
        true,  // 启用关键词匹配
        KB_SCAN_DEPTH,
      );

      if (contextResult?.success && contextResult?.items?.length > 0) {
        // 将 API 返回的 items 映射为 VectorSearchResult 类型
        return contextResult.items.map((item: any) => ({
          id: item.id ?? '',
          score: item.score ?? 0,
          metadata: {
            text: item.content ?? '',
            source: item.source ?? '',
            ...(item.metadata ?? {}),
          },
        }));
      }

      return [];
    } catch (error) {
      console.warn(
        `[ContextAssembler] 知识库检索失败: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return [];
    }
  }

  /**
   * 对话历史 RAG 检索：长对话时检索本会话历史向量相似片段。
   * 仅当消息数 > 40 条（20 轮）时触发，短对话跳过。
   * 失败时返回空数组，不中断管线。
   *
   * 迁移自 hooks.ts Step A2 的 chatHistory.retrieve 调用。
   * 参数与 hooks.ts 一致：topK=3, minScore=0.6。
   *
   * @param chatId 聊天会话 ID
   * @param query 查询文本（用户最近消息内容）
   * @param messageCount 当前消息总数（用于判断是否触发检索）
   * @returns 历史片段数组，未触发或失败时返回空数组
   */
  async retrieveChatHistory(
    chatId: string,
    query: string,
    messageCount: number,
  ): Promise<ChatHistoryItem[]> {
    // 短对话不触发 RAG 检索
    if (messageCount <= RAG_TRIGGER_THRESHOLD) {
      return [];
    }

    if (!chatId || !query) return [];

    try {
      const api = (window as any).electronAPI;
      if (!api?.chatHistory?.retrieve) {
        console.warn(
          '[ContextAssembler] electronAPI.chatHistory.retrieve 不可用，跳过对话历史 RAG 检索',
        );
        return [];
      }

      const historyItems = await api.chatHistory.retrieve(
        chatId,
        query,
        HISTORY_TOP_K,
        HISTORY_MIN_SCORE,
      );

      if (Array.isArray(historyItems) && historyItems.length > 0) {
        // API 返回 { content, score, timestamp }，映射为 ChatHistoryItem
        // role 默认为 'assistant'（RAG 检索的历史片段多为 AI 回复）
        return historyItems.map((item: any) => ({
          role: 'assistant' as const,
          content: item.content ?? '',
          timestamp: item.timestamp ?? 0,
          score: item.score,
        }));
      }

      return [];
    } catch (error) {
      console.warn(
        `[ContextAssembler] 对话历史 RAG 检索失败（降级跳过）: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return [];
    }
  }

  /**
   * 获取记忆表格数据并格式化为 Markdown。
   * 未启用时返回空数据，失败时返回空数据不中断管线。
   *
   * 迁移自 hooks.ts Step B 的 memory.getTableData 调用及 markdown 格式化逻辑。
   *
   * @param enabled 是否启用记忆表格
   * @param chatId 聊天会话 ID（用于获取表格数据）
   * @returns 格式化后的 markdown 数据和表格结构信息
   */
  async fetchMemoryTable(
    enabled: boolean,
    chatId: string,
  ): Promise<{ data: string; structure: TableStructure | null }> {
    const emptyResult = { data: '', structure: null };

    if (!enabled) return emptyResult;
    if (!chatId) return emptyResult;

    try {
      const api = (window as any).electronAPI;
      if (!api?.memory?.getTableData) {
        console.warn(
          '[ContextAssembler] electronAPI.memory.getTableData 不可用，跳过记忆表格获取',
        );
        return emptyResult;
      }

      const tableResult = await api.memory.getTableData(chatId);

      if (!tableResult?.sheets?.length || !tableResult?.data) {
        return emptyResult;
      }

      // 提取表格结构信息
      const structure: TableStructure = {
        sheets: tableResult.sheets.map((sheetName: string) => ({
          sheetName,
          headers: tableResult.headers?.[sheetName] ?? [],
          rowCount: tableResult.data?.[sheetName]?.length ?? 0,
        })),
      };

      // 格式化为 Markdown 表格
      let memoryTableData = '# 记忆表格数据\n\n';
      for (const sheetName of tableResult.sheets) {
        const sheetHeaders: string[] = tableResult.headers?.[sheetName] ?? [];
        const sheetRows: any[] = tableResult.data?.[sheetName] ?? [];

        memoryTableData += `## 表格: ${sheetName}\n\n`;
        if (sheetHeaders.length > 0) {
          memoryTableData += '| ' + sheetHeaders.join(' | ') + ' |\n';
          memoryTableData += '| ' + sheetHeaders.map(() => '---').join(' | ') + ' |\n';
        }
        for (const row of sheetRows) {
          const cells = sheetHeaders.map((_h: string, columnIndex: number) => {
            const val = row[columnIndex.toString()];
            return val !== undefined && val !== null ? String(val) : '';
          });
          memoryTableData += '| ' + cells.join(' | ') + ' |\n';
        }
        memoryTableData += '\n';
      }

      return { data: memoryTableData, structure };
    } catch (error) {
      console.warn(
        `[ContextAssembler] 记忆表格数据获取失败（使用空数据）: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return emptyResult;
    }
  }

  /**
   * 上下文截断：基于 token 预算裁剪对话历史消息。
   *
   * 迁移自 hooks.ts Step D 的 TokenCounter + ContextTruncator 逻辑。
   *
   * - token 管理开启时：预热 token 计数缓存，调用 ContextTruncator.truncateMessages
   *   进行基于预算的双向预留裁剪。systemPromptTokens 使用 0（系统提示词在
   *   PromptComposer 阶段构建，此处尚不可用；ContextTruncator 内部会按
   *   spec 顺序 reserve systemPrompt 预算项）。
   * - token 管理关闭时：应用消息数量安全网，超过 maxMessagesToKeep 时
   *   仅保留最近 N 条，防止上下文窗口溢出。
   *
   * @param messages 原始对话历史消息
   * @param config 截断配置
   * @returns 裁剪后的消息列表
   */
  async truncateContext(
    messages: ChatMessage[],
    config: TruncationConfig,
  ): Promise<ChatMessage[]> {
    if (!messages || messages.length === 0) {
      return [];
    }

    // token 管理关闭时的安全网
    if (!config.enabled) {
      const maxMsgs = config.maxMessagesToKeep ?? 60;
      if (messages.length > maxMsgs) {
        let truncated = messages.slice(-maxMsgs);
        // 确保以 user 消息开头（丢弃开头的 assistant 消息）
        if (truncated.length > 0 && truncated[0].role === 'assistant') {
          truncated = truncated.slice(1);
        }
        console.warn(
          `[ContextAssembler] Token 管理关闭但消息数（${messages.length}）超过安全限制（${maxMsgs}），` +
          `自动截断为最近 ${truncated.length} 条以防止上下文窗口溢出。`,
        );
        return truncated;
      }
      return messages;
    }

    // token 管理开启：预热精确 token 计数缓存
    try {
      await TokenCounter.precountMessages(messages);
    } catch (err) {
      console.warn('[ContextAssembler] token 预计数失败，回退字节估算:', err);
    }

    // systemPromptTokens 使用 0（系统提示词在后续 PromptComposer 阶段构建）
    const systemPromptTokens = 0;

    const truncatedMessages = ContextTruncator.truncateMessages(
      messages,
      systemPromptTokens,
      config,
    );

    return truncatedMessages;
  }
}
