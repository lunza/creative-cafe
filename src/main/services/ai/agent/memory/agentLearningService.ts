/**
 * Agent 学习服务（Task 10）
 *
 * 自我学习闭环的编排者：连接 agentLoop（经验产生）→ memoryService（记忆存储）→
 * memoryConsolidator（模式沉淀）→ Agent 决策（RAG 注入），形成完整的
 * 「执行 → 记录 → 反思 → 优化」学习飞轮。
 *
 * 职责：
 *   1. recordTurnExperience：作为 agentLoop onTurnComplete 回调的后端，
 *      将一轮 Agent 执行结果转换为 LearningEvent 并写入情景记忆。
 *   2. extractPatterns：触发 consolidator 提取模式，返回指定 taskType 的语义记忆。
 *   3. optimizeDecision：在 Agent 决策前检索相关记忆 + 建议技能 + 计算置信度，
 *      作为 RAG 上下文注入提示词。
 *   4. applyFeedback：处理用户对记忆的反馈（正确/错误/纠正），调整置信度或删除。
 *   5. consolidate：暴露给外部定时任务/手动触发，委托给 consolidator。
 *
 * 设计原则：
 *   - 所有方法 try-catch 包裹，作为后台 hook 调用时绝不抛错（避免影响主流程）。
 *   - 置信度计算保守：base 0.5 + 每条相关记忆 +0.1（cap 0.9）- 失败模式 -0.1。
 *   - 单例模式：与 memoryService / memoryConsolidator 一致。
 */

import { createLogger } from '../../../logger'
import { memoryService } from './memoryService'
import { memoryConsolidator } from './memoryConsolidator'

import type {
  AgentMemory,
  ConsolidationStats,
  DecisionOptimization,
  LearningEvent,
  MemoryFeedback,
  MemorySearchResult,
} from './memoryTypes'
import type { AgentLoopResult, AgentToolContext } from '../agentTypes'

const logger = createLogger('agent-learning')

/** 决策置信度上限 */
const CONFIDENCE_CAP = 0.9
/** 决策置信度基数 */
const CONFIDENCE_BASE = 0.5
/** 每条相关记忆的置信度增量 */
const CONFIDENCE_PER_MEMORY = 0.1
/** 命中失败模式时的置信度减量 */
const CONFIDENCE_FAILURE_PENALTY = 0.1

/**
 * Agent 学习服务
 *
 * 由 agentLoop 通过 onTurnComplete 回调触发经验记录，
 * 由 Agent 决策点通过 optimizeDecision 检索历史经验。
 */
export class AgentLearningService {
  constructor(
    private readonly mem: typeof memoryService = memoryService,
    private readonly consolidator: typeof memoryConsolidator = memoryConsolidator
  ) {}

  /**
   * 记录一轮 Agent 执行经验（agentLoop onTurnComplete 回调入口）
   *
   * 用 result 中的数据丰富 event，然后委托 memoryService 写入情景记忆。
   * 全程 try-catch：作为后台 hook 调用时绝不抛错。
   *
   * @param result Agent 循环返回结果
   * @param event  原始学习事件（部分字段会被 result 数据覆盖）
   */
  async recordTurnExperience(
    result: AgentLoopResult,
    event: LearningEvent
  ): Promise<void> {
    try {
      // 1. 用 result.stoppedReason 推断 outcome
      //    'completed' → success
      //    'max_iterations' → partial（达到迭代上限，部分完成）
      //    'error' / 'aborted' → failure
      const outcome: LearningEvent['outcome'] =
        result.stoppedReason === 'completed'
          ? 'success'
          : result.stoppedReason === 'max_iterations'
          ? 'partial'
          : 'failure'

      // 2. 用 result.toolCallHistory 填充 toolCalls（提取 name/success/durationMs）
      const toolCalls: LearningEvent['toolCalls'] = (result.toolCallHistory ?? []).map(tc => ({
        name: tc.toolName,
        success: tc.result?.success ?? false,
        durationMs: tc.durationMs ?? 0,
      }))

      // 3. finalContentLength 来自 result.finalContent
      const finalContentLength = result.finalContent?.length ?? 0

      // 4. 合成增强后的 event（不修改入参 event）
      const enrichedEvent: LearningEvent = {
        ...event,
        outcome,
        toolCalls,
        finalContentLength,
        timestamp: event.timestamp ?? Date.now(),
      }

      await this.mem.recordEpisodicMemory(enrichedEvent)
      logger.info(
        `已记录 Agent 经验 (taskType=${event.taskType}, outcome=${outcome}, tools=${toolCalls.length})`
      )
    } catch (err) {
      // 关键：后台 hook 绝不抛错，仅记录日志
      logger.error(
        'recordTurnExperience 异常（已吞没，不影响主流程）',
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  /**
   * 提取模式：触发 consolidator 整合，返回（可选过滤 taskType 的）语义记忆
   *
   * @param taskType 可选过滤；不传则返回所有语义记忆
   * @returns 语义记忆列表
   */
  async extractPatterns(taskType?: string): Promise<AgentMemory[]> {
    try {
      // 1. 触发整合（consolidator 内部会创建/合并语义记忆）
      await this.consolidator.consolidate()
      // 2. 查询语义记忆
      //    taskType 过滤语义：语义记忆的 metadata.taskType 通常未设置（consolidator
      //    创建时未显式赋值），故这里宽松匹配——若 taskType 给定则同时考虑
      //    metadata.taskType 命中或 content 包含 taskType 字符串
      const allSemantic = await this.mem.queryMemories({ type: 'semantic' })
      if (!taskType) return allSemantic
      return allSemantic.filter(
        m => m.metadata.taskType === taskType || m.content.includes(taskType)
      )
    } catch (err) {
      logger.error('extractPatterns 异常', err instanceof Error ? err.message : String(err))
      return []
    }
  }

  /**
   * 决策优化：在 Agent 决策前检索相关记忆 + 建议技能 + 计算置信度
   *
   * @param taskType 当前任务类型
   * @param taskDescription 当前任务描述
   * @param context 可选上下文（角色卡/项目/会话 id）
   * @returns DecisionOptimization：相关记忆 + 建议技能 + 置信度
   */
  async optimizeDecision(
    taskType: string,
    taskDescription: string,
    context?: AgentToolContext
  ): Promise<DecisionOptimization> {
    try {
      // 1. RAG 检索相关记忆
      const relevantMemories: MemorySearchResult[] = await this.mem.getRelevantMemories(
        context ?? {},
        taskDescription,
        5
      )

      // 2. 建议技能：查询程序记忆中匹配 taskType 的，收集 skillId
      const suggestedSkills = await this.suggestSkills(taskType)

      // 3. 置信度计算
      let confidence = CONFIDENCE_BASE
      confidence += relevantMemories.length * CONFIDENCE_PER_MEMORY
      // 命中失败模式（pattern='avoid' 的语义记忆）时降低置信度
      const hasFailurePattern = relevantMemories.some(
        r => r.memory.metadata.pattern === 'avoid'
      )
      if (hasFailurePattern) confidence -= CONFIDENCE_FAILURE_PENALTY
      confidence = Math.max(0, Math.min(CONFIDENCE_CAP, confidence))

      return { relevantMemories, suggestedSkills, confidence }
    } catch (err) {
      logger.error('optimizeDecision 异常，返回降级结果', err instanceof Error ? err.message : String(err))
      return { relevantMemories: [], suggestedSkills: [], confidence: CONFIDENCE_BASE }
    }
  }

  /**
   * 应用用户反馈：调整记忆置信度 / 创建纠正 / 删除
   *
   * @param memoryId 反馈针对的记忆 id
   * @param feedback 反馈内容（correct=true 加分；correct=false 且有 correction 创建纠正；否则删除）
   */
  async applyFeedback(memoryId: string, feedback: MemoryFeedback): Promise<void> {
    try {
      const memory = this.mem.getMemory(memoryId)
      if (!memory) {
        logger.warn(`applyFeedback: 记忆 ${memoryId} 不存在`)
        return
      }

      if (feedback.correct) {
        // 正确反馈：上调 confidence / supportCount
        memory.metadata.confidence = Math.min(
          0.95,
          (memory.metadata.confidence ?? 0.5) + 0.1
        )
        memory.metadata.supportCount = (memory.metadata.supportCount ?? 1) + 1
        memory.updatedAt = new Date().toISOString()
        await this.mem.persist()
        logger.info(`反馈：记忆 ${memoryId} 置信度上调至 ${memory.metadata.confidence}`)
        return
      }

      // 错误反馈
      if (feedback.correction && feedback.correction.trim()) {
        // 提供纠正内容：创建一条新的语义记忆，并降低原记忆置信度
        const originalConfidence = memory.metadata.confidence ?? 0.5
        memory.metadata.confidence = originalConfidence * 0.5
        memory.updatedAt = new Date().toISOString()

        await this.mem.recordSemanticMemory(
          feedback.correction,
          'user-correction',
          [memoryId]
        )
        await this.mem.persist()
        logger.info(
          `反馈：记忆 ${memoryId} 置信度降至 ${memory.metadata.confidence}，已创建纠正记忆`
        )
      } else {
        // 无纠正内容：直接删除该记忆
        await this.mem.deleteMemory(memoryId)
        logger.info(`反馈：记忆 ${memoryId} 已删除（无纠正内容）`)
      }
    } catch (err) {
      logger.error('applyFeedback 异常', err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * 触发整合（暴露给外部定时任务 / 手动调用）
   */
  async consolidate(): Promise<ConsolidationStats> {
    try {
      return await this.consolidator.consolidate()
    } catch (err) {
      logger.error('consolidate 异常', err instanceof Error ? err.message : String(err))
      return { consolidated: 0, created: 0, merged: 0 }
    }
  }

  /**
   * 私有：从程序记忆中提取建议技能 id
   * 匹配规则：程序记忆的 content 包含 taskType 字符串
   */
  private async suggestSkills(taskType: string): Promise<string[]> {
    const procedural = await this.mem.queryMemories({ type: 'procedural' })
    const skills = new Set<string>()
    for (const m of procedural) {
      if (m.content.includes(taskType) && m.metadata.skillId) {
        skills.add(m.metadata.skillId)
      }
    }
    return Array.from(skills)
  }
}

/** 单例导出 */
export const agentLearningService = new AgentLearningService()
