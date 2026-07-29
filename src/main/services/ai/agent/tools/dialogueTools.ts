/**
 * 对话模式工具集
 *
 * 工具调用智能体引擎（方向 0）的验证用真实工具集。
 * 复用 worldBookService 与 chatVectorizationService，证明引擎端到端可用。
 *
 * 导出 dialogueTools: AgentTool[]，由 tools/index.ts 的 registerBuiltinTools
 * 统一通过 toolRegistry.registerGroup('dialogue', ...) 注册。
 *
 * 含工具：
 * - searchWorldbook：根据关键词搜索世界书条目，返回 top-K 条目摘要
 * - searchChatHistory：向量检索历史对话，返回相关片段
 */

import type { AgentTool, AgentToolContext, ToolCallResult } from '../agentTypes'
// AgentToolContext 仅在需要 chatId 等上下文的工具中使用，故保留类型导入
import { worldBookService } from '../../../worldBookService'
import { chatVectorizationService } from '../../../ChatVectorizationService'

/** 默认返回条数上限 */
const DEFAULT_TOP_K = 5

/**
 * 工具：searchWorldbook —— 根据关键词搜索世界书条目
 *
 * 调用 worldBookService.matchKeywords 做关键词匹配（主+次关键词，SillyTavern 激活逻辑）。
 * worldBookPaths 不传时 matchKeywords 内部会遍历全部世界书，故 handler 无需预先解析路径。
 * characterId 当前不参与 worldBookService 的过滤逻辑，仅作为上下文保留以备后续扩展。
 */
const searchWorldbookTool: AgentTool = {
  name: 'searchWorldbook',
  description:
    '搜索世界书条目。当需要查询角色设定、地点、物品、事件等背景信息时调用。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词',
      },
    },
    required: ['query'],
  },
  async handler(args, context?: AgentToolContext): Promise<ToolCallResult> {
    try {
      const query = args?.query
      if (!query || typeof query !== 'string' || query.trim() === '') {
        return { success: false, error: '参数 query 不能为空' }
      }

      // matchKeywords 签名：(text, worldBookPaths?, options?) => { success, matches, count, error? }
      // 不传 worldBookPaths 时遍历全部世界书；maxResults 控制返回上限
      // context.characterId 当前不参与 worldBookService 的过滤逻辑（服务按 worldBookPaths 过滤），
      // 仅作为上下文保留以备后续扩展，故 void 标记避免 lint 噪音
      void context
      const matchResult = await worldBookService.matchKeywords(query, undefined, {
        maxResults: DEFAULT_TOP_K,
      })

      if (!matchResult.success) {
        return { success: false, error: matchResult.error || '世界书关键词匹配失败' }
      }

      // 无匹配：返回空 entries + 提示消息
      if (matchResult.matches.length === 0) {
        return {
          success: true,
          data: {
            entries: [],
            message: '未找到匹配条目',
          },
        }
      }

      const entries = matchResult.matches.map((m) => ({
        name: m.name || m.comment || '未命名条目',
        // 内容摘要取前 200 字，避免回填过长撑爆上下文
        content: (m.content || '').slice(0, 200),
        keywords: m.matchedKeys || [],
        matchType: m.matchType,
        matchScore: m.matchScore,
      }))

      return {
        success: true,
        data: {
          entries,
          total: matchResult.count,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: `searchWorldbook 执行异常: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

/**
 * 工具：searchChatHistory —— 向量检索历史对话片段
 *
 * 调用 chatVectorizationService.retrieveChatHistory 做语义检索。
 * retrieveChatHistory 内部已做 minScore 过滤（默认 0.6）与异常吞掉，
 * 返回空数组表示无相关片段或向量化未启用，handler 据此返回空结果而非报错。
 *
 * chatId 必须从 AgentToolContext 获取，否则无法定位会话向量空间。
 */
const searchChatHistoryTool: AgentTool = {
  name: 'searchChatHistory',
  description:
    '检索历史对话。当需要回忆之前聊过的内容、长会话不失忆时调用。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '检索查询',
      },
    },
    required: ['query'],
  },
  async handler(args, context?: AgentToolContext): Promise<ToolCallResult> {
    try {
      const query = args?.query
      if (!query || typeof query !== 'string' || query.trim() === '') {
        return { success: false, error: '参数 query 不能为空' }
      }

      // chatId 必须从上下文获取，否则无法定位会话向量空间
      const chatId = context?.chatId
      if (!chatId) {
        return { success: false, error: '未提供 chatId 无法定位会话历史向量空间' }
      }

      // retrieveChatHistory 签名：(chatId, queryText, topK=3, minScore=0.6)
      // 返回 {content, score, timestamp}[]
      // retrieveChatHistory 内部对未启用向量化场景返回空数组（不抛错），故视为幂等
      const fragments = await chatVectorizationService.retrieveChatHistory(
        chatId,
        query,
        DEFAULT_TOP_K,
      )

      // 无匹配历史：返回空 fragments + 提示消息
      if (fragments.length === 0) {
        return {
          success: true,
          data: {
            fragments: [],
            message: '无匹配历史',
          },
        }
      }

      return {
        success: true,
        data: {
          fragments: fragments.map((f) => ({
            content: f.content,
            score: f.score,
            timestamp: f.timestamp,
          })),
          total: fragments.length,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: `searchChatHistory 执行异常: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

/** 对话模式工具集（供 registerBuiltinTools 通过 registerGroup 批量注册） */
export const dialogueTools: AgentTool[] = [searchWorldbookTool, searchChatHistoryTool]
