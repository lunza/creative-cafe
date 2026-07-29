/**
 * 技能库与记忆系统基础工具集（foundation 组）
 *
 * 工具调用智能体引擎（方向 0）的基础能力工具集。
 * 将技能库（skillService）与长期记忆（memoryService）以 AgentTool 形式暴露给 Agent，
 * 使 Agent 能够自主发现/调用技能，并读写长期记忆，从而具备自我学习闭环能力。
 *
 * 导出 agentFoundationTools: AgentTool[]，由 tools/index.ts 的 registerBuiltinTools
 * 统一通过 toolRegistry.registerGroup('foundation', ...) 注册。
 *
 * 含工具：
 * - invokeSkill：调用已注册的技能
 * - searchMemories：向量检索长期记忆
 * - recordMemory：记录一条经验到长期记忆（episodic/semantic/procedural 三类分发）
 * - discoverSkills：发现可用技能（返回摘要列表）
 *
 * 设计要点：
 * - 每个参数 schema 严格遵循 JSONSchema（type/properties/required 齐全）
 * - 每个 handler 包裹 try-catch，异常时返回 { success:false, error }，不向 agentLoop 抛错
 *   （与 agentLoop 对工具 handler 的期望一致：抛错会被循环捕获转为 error，但这里主动捕获更清晰）
 */

import type { AgentTool, AgentToolContext, ToolCallResult } from '../agentTypes'
import { skillService } from '../skill/skillService'
import { memoryService } from '../memory/memoryService'
import type { SkillCategory } from '../skill/skillTypes'
import type { MemoryType, LearningEvent } from '../memory/memoryTypes'
import { createLogger } from '../../../logger'

const logger = createLogger('agent-foundation-tools')

/**
 * 工具：invokeSkill —— 调用已注册的技能
 *
 * 委托 skillService.invokeSkill 执行。当面对复杂任务时，
 * Agent 应先 discoverSkills 查找可用技能，再调用本工具执行。
 */
const invokeSkillTool: AgentTool = {
  name: 'invokeSkill',
  description:
    '调用已注册的技能。当面对复杂任务时，先 discoverSkills 查找可用技能，再调用本工具执行。',
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: '技能 id',
      },
      input: {
        type: 'object',
        description: '技能输入参数',
        additionalProperties: true,
      },
    },
    required: ['skillId', 'input'],
  },
  async handler(args, context?: AgentToolContext): Promise<ToolCallResult> {
    try {
      const skillId = args?.skillId
      const input = args?.input ?? {}
      if (!skillId || typeof skillId !== 'string') {
        return { success: false, error: '参数 skillId 不能为空' }
      }

      // skillService.invokeSkill 签名：(id, input, context?) => SkillResult
      // 技能不存在/已禁用时返回结构化错误（不抛错），由 handler 透传
      const result = await skillService.invokeSkill(skillId, input, context)
      return {
        success: result.success,
        data: result.data,
        error: result.error,
      }
    } catch (error) {
      logger.warn('invokeSkill 执行异常', error instanceof Error ? error.message : String(error))
      return {
        success: false,
        error: `invokeSkill 执行异常: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

/**
 * 工具：searchMemories —— 向量检索 Agent 长期记忆
 *
 * 委托 memoryService.searchMemories 做语义检索。
 * 当需要回忆过去类似任务的经验、学到的规则或工作流时调用。
 */
const searchMemoriesTool: AgentTool = {
  name: 'searchMemories',
  description:
    '检索 Agent 长期记忆。当需要回忆过去类似任务的经验、学到的规则或工作流时调用。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '检索查询文本',
      },
      type: {
        type: 'string',
        enum: ['episodic', 'semantic', 'procedural'],
        description: '记忆类型过滤（可选）',
      },
      topK: {
        type: 'number',
        description: '返回数量上限，默认5',
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

      // memoryService.searchMemories 签名：(query, type?, topK=5) => Promise<MemorySearchResult[]>
      // type 枚举与 MemoryType 完全对齐，直接强转；topK 为 undefined 时服务端取默认值 5
      const results = await memoryService.searchMemories(
        query,
        args.type as MemoryType | undefined,
        args.topK,
      )

      return { success: true, data: results }
    } catch (error) {
      logger.warn('searchMemories 执行异常', error instanceof Error ? error.message : String(error))
      return {
        success: false,
        error: `searchMemories 执行异常: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

/**
 * 工具：recordMemory —— 记录一条经验到长期记忆
 *
 * 按 type 分发到 memoryService 的三个记录方法：
 * - episodic：构建 LearningEvent 调 recordEpisodicMemory
 * - semantic：调 recordSemanticMemory(content, pattern, derivedFrom?)
 * - procedural：调 recordProceduralMemory(skillId, content)
 */
const recordMemoryTool: AgentTool = {
  name: 'recordMemory',
  description:
    '记录一条经验到长期记忆。当发现值得记住的模式、规则、教训或有效工作流时调用。',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: '记忆内容文本',
      },
      type: {
        type: 'string',
        enum: ['episodic', 'semantic', 'procedural'],
        description: '记忆类型',
      },
      metadata: {
        type: 'object',
        description: '附加元数据（pattern/skillId/taskType/outcome/toolCalls 等）',
        additionalProperties: true,
      },
    },
    required: ['content', 'type'],
  },
  async handler(args, context?: AgentToolContext): Promise<ToolCallResult> {
    try {
      const content = args?.content
      const type = args?.type as MemoryType | undefined
      const metadata = (args?.metadata ?? {}) as Record<string, any>

      if (!content || typeof content !== 'string' || content.trim() === '') {
        return { success: false, error: '参数 content 不能为空' }
      }
      if (!type) {
        return { success: false, error: '参数 type 不能为空' }
      }

      let memory
      switch (type) {
        case 'episodic': {
          // 构建 LearningEvent：从 metadata 提取字段，缺失项给默认值
          const event: LearningEvent = {
            sessionId: metadata.sessionId,
            taskType: metadata.taskType || 'general',
            outcome: metadata.outcome || 'success',
            toolCalls: metadata.toolCalls || [],
            context,
            timestamp: Date.now(),
          }
          memory = await memoryService.recordEpisodicMemory(event)
          break
        }
        case 'semantic': {
          // pattern 默认 'general'；derivedFrom 可选
          memory = await memoryService.recordSemanticMemory(
            content,
            metadata.pattern || 'general',
            metadata.derivedFrom,
          )
          break
        }
        case 'procedural': {
          // skillId 缺失时用 'unknown' 兜底（procedural 记忆必须关联技能）
          memory = await memoryService.recordProceduralMemory(
            metadata.skillId || 'unknown',
            content,
          )
          break
        }
        default:
          return { success: false, error: '未知记忆类型' }
      }

      return { success: true, data: memory }
    } catch (error) {
      logger.warn('recordMemory 执行异常', error instanceof Error ? error.message : String(error))
      return {
        success: false,
        error: `recordMemory 执行异常: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

/**
 * 工具：discoverSkills —— 发现可用技能
 *
 * 委托 skillService.discoverSkills 按 query 匹配 name/description/tags，返回摘要列表。
 * 返回 SkillSummary[]（id/name/description/category/version/type）。
 */
const discoverSkillsTool: AgentTool = {
  name: 'discoverSkills',
  description:
    '发现可用技能。当不确定有哪些技能可复用时调用，返回技能摘要列表（id/name/description）。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '检索关键词',
      },
      category: {
        type: 'string',
        enum: ['dialogue', 'writing', 'worldbook', 'general'],
        description: '按分类过滤（可选）',
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

      // skillService.discoverSkills 签名：(query, category?) => SkillSummary[]
      // category 枚举与 SkillCategory 完全对齐，直接强转
      const summaries = skillService.discoverSkills(
        query,
        args.category as SkillCategory | undefined,
      )

      return { success: true, data: summaries }
    } catch (error) {
      logger.warn('discoverSkills 执行异常', error instanceof Error ? error.message : String(error))
      return {
        success: false,
        error: `discoverSkills 执行异常: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

/** 技能库与记忆系统基础工具集（供 registerBuiltinTools 通过 registerGroup 批量注册） */
export const agentFoundationTools: AgentTool[] = [
  invokeSkillTool,
  searchMemoriesTool,
  recordMemoryTool,
  discoverSkillsTool,
]
