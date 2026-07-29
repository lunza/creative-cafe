/**
 * 世界书模式工具集
 *
 * 工具调用智能体引擎（方向 0）的验证用真实工具集。
 * 复用 worldBookService.searchWorldBookEntriesByVector 做条目语义检索。
 *
 * 注册工具：
 * - searchEntries：世界书条目语义检索（基于向量）
 */

import type { AgentTool, ToolCallResult } from '../agentTypes'
import { worldBookService } from '../../../worldBookService'

/** 默认返回条数上限 */
const DEFAULT_TOP_K = 5

/**
 * 工具：searchEntries —— 世界书条目语义检索
 *
 * 调用 worldBookService.searchWorldBookEntriesByVector 做向量相似度检索。
 * 与 dialogue 组的 searchWorldbook（关键词匹配）互补：本工具基于语义嵌入，
 * 适合关键词难以精确命中的模糊检索场景。该方法内部已 try-catch，失败返回空数组。
 *
 * searchWorldBookEntriesByVector 签名：(query, topK=5) => Array<{ id, score, metadata }>
 * metadata 由 vectorizeWorldBook 写入，含 entryName / entryContent / entryKeys 等字段。
 */
const searchEntriesTool: AgentTool = {
  name: 'searchEntries',
  description: '语义检索世界书条目，返回最相关的条目内容。比关键词匹配更智能。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '语义查询',
      },
    },
    required: ['query'],
  },
  async handler(args): Promise<ToolCallResult> {
    try {
      const query = args?.query
      if (!query || typeof query !== 'string' || query.trim() === '') {
        return { success: false, error: '参数 query 不能为空' }
      }

      // searchWorldBookEntriesByVector 在 vector store 中按 source=worldbook/sourceType=entry 过滤
      const results = await worldBookService.searchWorldBookEntriesByVector(query, DEFAULT_TOP_K)

      // 无匹配：返回空 entries + 提示消息（与 searchWorldbook 行为保持一致）
      if (results.length === 0) {
        return {
          success: true,
          data: {
            entries: [],
            message: '未找到匹配条目',
          },
        }
      }

      const entries = results.map((r) => ({
        id: r.id,
        score: r.score,
        name: r.metadata?.entryName || r.metadata?.name || '未命名条目',
        // 内容摘要取前 200 字；优先 entryContent，回退 text（chunk 全文）
        content: (
          (r.metadata?.entryContent as string) ||
          (r.metadata?.text as string) ||
          ''
        ).slice(0, 200),
        // entryKeys 为主+次关键词合并数组，entryKey 仅为关键词；优先取合并值
        keywords: r.metadata?.entryKeys || r.metadata?.entryKey || [],
      }))

      return {
        success: true,
        data: {
          entries,
          total: entries.length,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: `searchEntries 执行异常: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

/**
 * 世界书模式工具集
 *
 * 由 registerBuiltinTools() 统一通过 toolRegistry.registerGroup('worldbook', worldbookTools) 批量注册。
 */
export const worldbookTools: AgentTool[] = [searchEntriesTool]
