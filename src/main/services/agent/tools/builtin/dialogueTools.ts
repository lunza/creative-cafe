/**
 * 对话组工具 —— dialogue mode 工具集
 *
 * 来源：spec §二 Task 16.1（对话组工具：searchWorldbook / searchHistory / addMemoryNote）
 * 决策：自研（spec §三无对应 openclaw 文件）。对话组工具是本项目特有业务，
 *       复用现有服务（worldBookService / chatSessionRepository / memoryStore）。
 *
 * 三个工具：
 *  1. searchWorldbook  —— 向量检索世界书条目（复用 worldBookService.searchWorldBookEntriesByVector）
 *  2. searchHistory    —— 关键词搜索对话历史（复用 chatSessionRepository.searchChatMessages）
 *  3. addMemoryNote    —— 写入 agent 记忆笔记（复用 memoryStore.write）
 *
 * 设计约束（openclaw AGENTS.md）：
 *  - 工具描述是 prompt：description 清晰说明参数格式与返回值
 *  - 闭环返回：执行结果回灌给 LLM，让模型知道检索/写入结果
 *  - 降级保护：工具失败不中断 agentLoop，转为 ToolExecutionResult
 *  - 可用性限制：仅 mode='dialogue' 时可用（availability 表达式 gating）
 */

import type { ToolDescriptor } from '../types';
import type { ToolCallContext, ToolExecutionResult } from '../../contracts';
import type { ToolExecutor } from '../toolRegistry';

// ==================== 服务接口（依赖注入） ====================

/**
 * 对话组工具依赖的服务接口。
 *
 * 由调用方（agentHandlers）注入实际实现，工具代码不直接 import 服务，
 * 保持低耦合（与 updateStateTable 的 ITableEditExecutor 模式一致）。
 */
export interface IDialogueToolServices {
  /** 向量检索世界书条目 */
  searchWorldBookEntries(
    query: string,
    topK?: number
  ): Promise<Array<{
    id: string;
    score: number;
    metadata: Record<string, unknown>;
  }>>;

  /** 读取世界书条目内容（根据向量检索返回的 metadata 定位文件与条目） */
  readWorldBookEntry(
    filePath: string,
    entryUid: string
  ): Promise<{ name: string; content: string; comment?: string } | null>;

  /** 关键词搜索对话历史 */
  searchChatHistory(
    keyword: string,
    chatId?: string
  ): Promise<Array<{
    role: string;
    content: string;
    timestamp?: number;
    chatId?: string;
  }>>;

  /** 写入 agent 记忆笔记 */
  addMemoryNote(
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<{ success: boolean; id?: string; error?: string }>;
}

// ==================== searchWorldbook 工具 ====================

export const searchWorldbookDescriptor: ToolDescriptor = {
  name: 'searchWorldbook',
  title: 'Search Worldbook',
  description: `Search the worldbook for entries relevant to a query using semantic vector search.

Use this when you need to look up lore, setting details, character backgrounds, or world rules that are stored in the worldbook.

Parameters:
- query: Natural language search query (e.g., "magic system rules", "character Alice background")
- topK: Maximum number of results to return (default: 5, max: 20)

Returns: Array of matching entries with name, content, and relevance score. Higher score = more relevant.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query',
      },
      topK: {
        type: 'integer',
        minimum: 1,
        maximum: 20,
        description: 'Maximum number of results (default 5)',
      },
    },
    required: ['query'],
  },
  owner: { kind: 'core' },
  availability: {
    kind: 'context',
    key: 'mode',
    equals: 'dialogue',
  },
  annotations: { group: 'dialogue', sortKey: '010' },
};

export function createSearchWorldbookExecutor(
  services: IDialogueToolServices
): ToolExecutor {
  return async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const query = String(args.query || '').trim();
    if (!query) {
      return {
        success: false,
        content: 'Parameter "query" is required and must be a non-empty string.',
        continueLoop: false,
      };
    }

    const topK = typeof args.topK === 'number' ? Math.min(Math.max(args.topK, 1), 20) : 5;

    try {
      const results = await services.searchWorldBookEntries(query, topK);
      if (results.length === 0) {
        return {
          success: true,
          content: `No worldbook entries found for query: "${query}". Try a different search term.`,
          continueLoop: true,
        };
      }

      // 尝试加载条目完整内容
      const entries: string[] = [];
      for (const result of results) {
        const filePath = String(result.metadata?.filePath || result.metadata?.worldBookPath || '');
        const entryUid = String(result.metadata?.uid || result.metadata?.entryUid || result.id || '');
        if (filePath && entryUid) {
          const entry = await services.readWorldBookEntry(filePath, entryUid);
          if (entry) {
            entries.push(
              `[${entry.name}] (score: ${result.score.toFixed(3)})\n${entry.content}` +
              (entry.comment ? `\n(comment: ${entry.comment})` : '')
            );
            continue;
          }
        }
        // 降级：仅返回 metadata 摘要
        entries.push(
          `[Entry ${result.id}] (score: ${result.score.toFixed(3)})\n${JSON.stringify(result.metadata)}`
        );
      }

      return {
        success: true,
        content: `Found ${results.length} worldbook entries:\n\n${entries.join('\n\n---\n\n')}`,
        continueLoop: true,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        content: `Worldbook search failed: ${errMsg}. Try rephrasing your query or proceed without worldbook context.`,
        continueLoop: true,
      };
    }
  };
}

// ==================== searchHistory 工具 ====================

export const searchHistoryDescriptor: ToolDescriptor = {
  name: 'searchHistory',
  title: 'Search Chat History',
  description: `Search past chat messages by keyword to recall what was previously said.

Use this when you need to recall specific topics, promises, or events from earlier in the conversation or past sessions.

Parameters:
- query: Keyword or phrase to search for in chat history
- chatId: Optional specific chat session ID to search. If omitted, searches the current character's chat.

Returns: Array of matching messages with role (user/assistant), content, and timestamp.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Keyword or phrase to search for',
      },
      chatId: {
        type: 'string',
        description: 'Optional specific chat session ID to search',
      },
    },
    required: ['query'],
  },
  owner: { kind: 'core' },
  availability: {
    kind: 'context',
    key: 'mode',
    equals: 'dialogue',
  },
  annotations: { group: 'dialogue', sortKey: '020' },
};

export function createSearchHistoryExecutor(
  services: IDialogueToolServices
): ToolExecutor {
  return async (args: Record<string, unknown>, context?: ToolCallContext): Promise<ToolExecutionResult> => {
    const query = String(args.query || '').trim();
    if (!query) {
      return {
        success: false,
        content: 'Parameter "query" is required and must be a non-empty string.',
        continueLoop: false,
      };
    }

    const chatId = typeof args.chatId === 'string' ? args.chatId : context?.sessionId;

    try {
      const results = await services.searchChatHistory(query, chatId);
      if (results.length === 0) {
        return {
          success: true,
          content: `No chat history found for query: "${query}".`,
          continueLoop: true,
        };
      }

      const formatted = results.map((msg, idx) => {
        const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString('zh-CN') : 'unknown time';
        return `${idx + 1}. [${msg.role}] (${time}): ${msg.content.substring(0, 500)}`;
      });

      return {
        success: true,
        content: `Found ${results.length} matching messages:\n\n${formatted.join('\n\n')}`,
        continueLoop: true,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        content: `Chat history search failed: ${errMsg}. Proceed without historical context.`,
        continueLoop: true,
      };
    }
  };
}

// ==================== addMemoryNote 工具 ====================

export const addMemoryNoteDescriptor: ToolDescriptor = {
  name: 'addMemoryNote',
  title: 'Add Memory Note',
  description: `Save a note to long-term agent memory for future reference.

Use this to record important facts, decisions, character preferences, or significant events that should be remembered in future conversations.

Parameters:
- content: The note content to remember (natural language, be specific and concise)
- tags: Optional array of tags for categorization (e.g., ["character", "preference"])

Returns: Confirmation with the memory note ID.`,
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The note content to remember',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags for categorization',
      },
    },
    required: ['content'],
  },
  owner: { kind: 'core' },
  availability: {
    kind: 'context',
    key: 'mode',
    equals: 'dialogue',
  },
  annotations: { group: 'dialogue', sortKey: '030' },
};

export function createAddMemoryNoteExecutor(
  services: IDialogueToolServices
): ToolExecutor {
  return async (args: Record<string, unknown>, context?: ToolCallContext): Promise<ToolExecutionResult> => {
    const content = String(args.content || '').trim();
    if (!content) {
      return {
        success: false,
        content: 'Parameter "content" is required and must be a non-empty string.',
        continueLoop: false,
      };
    }

    const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];

    try {
      const metadata: Record<string, unknown> = {};
      if (tags.length > 0) metadata.tags = tags;
      if (context?.characterId) metadata.characterId = context.characterId;
      if (context?.sessionId) metadata.sessionId = context.sessionId;

      const result = await services.addMemoryNote(content, metadata);
      if (result.success) {
        return {
          success: true,
          content: `Memory note saved successfully (ID: ${result.id || 'unknown'}). The note will be available for future retrieval.`,
          continueLoop: true,
        };
      } else {
        return {
          success: false,
          content: `Failed to save memory note: ${result.error || 'unknown error'}. The conversation can continue without saving.`,
          continueLoop: true,
        };
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        content: `Memory note save failed: ${errMsg}. The conversation can continue without saving.`,
        continueLoop: true,
      };
    }
  };
}

// ==================== 注册便捷函数 ====================

/**
 * 注册所有对话组工具到 ToolRegistry。
 *
 * @param registry 工具注册中心
 * @param services 对话组工具依赖的服务
 */
export function registerDialogueTools(
  registry: { register: (descriptor: ToolDescriptor, executor: ToolExecutor) => void },
  services: IDialogueToolServices
): void {
  const tools = [
    { descriptor: searchWorldbookDescriptor, executor: createSearchWorldbookExecutor(services) },
    { descriptor: searchHistoryDescriptor, executor: createSearchHistoryExecutor(services) },
    { descriptor: addMemoryNoteDescriptor, executor: createAddMemoryNoteExecutor(services) },
  ];

  for (const { descriptor, executor } of tools) {
    try {
      registry.register(descriptor, executor);
    } catch {
      // 工具可能已被注册（并发场景），忽略
    }
  }
}
