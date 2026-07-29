/**
 * Agent 记忆整合器（Task 9）
 *
 * 从情景记忆（episodic）中提取重复模式，沉淀为更高层的语义记忆（semantic）
 * 与程序记忆（procedural），实现 Agent 的「反思—沉淀」自我学习闭环。
 *
 * 设计原则：
 *   1. 规则驱动、确定性：不依赖外部 AI 调用，避免网络抖动与不确定性，
 *      保证整合结果可复现、可调试。后续可扩展为 LLM 辅助提炼，但默认走规则路径。
 *   2. 防御式分组：每个 (taskType, pattern) 分组独立 try-catch，
 *      单个分组异常不影响其他分组的整合进度。
 *   3. 幂等去重：同一 (taskType, leadingTool) 模式只创建一条程序记忆；
 *      已存在的相似语义记忆通过合并（supportCount + 1, derivedFrom 追加）更新。
 *   4. 衰减机制：已被整合的情景记忆 relevance *= 0.7，避免历史经验无限累积
 *      淹没近期更相关的记忆（cap at 0，不出现负值）。
 *
 * 整合流程：
 *   episodic 池 → 按 taskType 分组 → 提取「成功共性 / 失败模式」规则 →
 *   创建或合并 semantic/procedural → 衰减源 episodic → 返回统计
 */

import { createLogger } from '../../../logger'
import { memoryService } from './memoryService'

import type {
  AgentMemory,
  ConsolidationStats,
} from './memoryTypes'

const logger = createLogger('agent-memory-consolidator')

/** 衰减系数：每被整合一次，情景记忆 relevance 乘以此值 */
const EPISODIC_DECAY_FACTOR = 0.7
/** 触发模式提炼的最小样本数（同分组同 outcome 同 leadingTool 至少 2 条） */
const PATTERN_MIN_SAMPLES = 2
/** 失败模式默认置信度 */
const FAILURE_PATTERN_CONFIDENCE = 0.6

/**
 * 记忆整合器
 *
 * 由 agentLearningService.consolidate() / extractPatterns() 调用，
 * 也可独立调用 memoryConsolidator.consolidate() 触发一次整合。
 */
export class MemoryConsolidator {
  /** 注入 memoryService 单例（便于测试时替换为 mock） */
  constructor(private readonly mem: typeof memoryService = memoryService) {}

  /**
   * 执行一次整合：扫描所有情景记忆，提取模式并沉淀为更高层记忆
   *
   * @returns 整合统计：consolidated（处理的 episodic 数）/ created（新建记忆数）/ merged（合并记忆数）
   */
  async consolidate(): Promise<ConsolidationStats> {
    logger.info('开始记忆整合')

    const stats: ConsolidationStats = {
      consolidated: 0,
      created: 0,
      merged: 0,
    }

    // 1. 拉取所有情景记忆
    let episodicMemories: AgentMemory[]
    try {
      episodicMemories = await this.mem.queryMemories({ type: 'episodic' })
    } catch (err) {
      logger.error('整合失败：拉取情景记忆异常', err instanceof Error ? err.message : String(err))
      return stats
    }

    if (episodicMemories.length === 0) {
      logger.info('无情景记忆可整合')
      return stats
    }

    // 2. 按 taskType 分组
    const groupsByTaskType = new Map<string, AgentMemory[]>()
    for (const m of episodicMemories) {
      const taskType = m.metadata.taskType ?? '_unknown_'
      if (!groupsByTaskType.has(taskType)) groupsByTaskType.set(taskType, [])
      groupsByTaskType.get(taskType)!.push(m)
    }

    // 3. 逐分组提取模式（防御：每组独立 try-catch）
    const processedEpisodicIds = new Set<string>()
    for (const [taskType, group] of groupsByTaskType) {
      try {
        const result = await this.processGroup(taskType, group)
        stats.created += result.created
        stats.merged += result.merged
        for (const id of result.processedEpisodicIds) {
          processedEpisodicIds.add(id)
        }
      } catch (err) {
        logger.warn(
          `分组 ${taskType} 整合异常，跳过（不影响其他分组）`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    // 4. 衰减已处理的情景记忆
    for (const id of processedEpisodicIds) {
      try {
        await this.decayEpisodic(id)
        stats.consolidated++
      } catch (err) {
        logger.warn(`衰减情景记忆 ${id} 失败`, err instanceof Error ? err.message : String(err))
      }
    }

    // 5. 整合过程中可能对内存中的记忆对象做了原地修改（合并 / 衰减），统一落盘
    try {
      await this.mem.persist()
    } catch (err) {
      logger.warn('整合后持久化索引失败', err instanceof Error ? err.message : String(err))
    }

    logger.info(
      `记忆整合完成：处理 ${stats.consolidated} 条 episodic，新建 ${stats.created} 条，合并 ${stats.merged} 条`
    )
    return stats
  }

  /**
   * 处理单个 taskType 分组：提取成功共性 + 失败模式
   *
   * @returns 该分组贡献的统计 + 已处理的 episodic id 集合
   */
  private async processGroup(
    taskType: string,
    group: AgentMemory[]
  ): Promise<{
    created: number
    merged: number
    processedEpisodicIds: Set<string>
  }> {
    let createdCount = 0
    let mergedCount = 0
    const processedIds = new Set<string>()

    // ===== 成功共性：success + 同一 leadingTool 出现 ≥2 次 → 程序记忆 =====
    const successLeadingTools = new Map<string, AgentMemory[]>()
    for (const m of group) {
      if (m.metadata.outcome !== 'success') continue
      const leadingTool = m.metadata.toolCalls?.[0]
      if (!leadingTool) continue
      if (!successLeadingTools.has(leadingTool)) successLeadingTools.set(leadingTool, [])
      successLeadingTools.get(leadingTool)!.push(m)
    }

    for (const [toolName, samples] of successLeadingTools) {
      if (samples.length < PATTERN_MIN_SAMPLES) continue
      try {
        const content = `执行${taskType}时优先调用${toolName}效果较好`
        const derivedFrom = samples.map(s => s.id)
        const skillId = `procedural:${taskType}:${toolName}`

        const mergeResult = await this.createOrMergeProcedural(skillId, content, derivedFrom)
        if (mergeResult.created) createdCount++
        else if (mergeResult.merged) mergedCount++

        // 标记源情景记忆为已处理（用于衰减）
        for (const s of samples) processedIds.add(s.id)
      } catch (err) {
        logger.warn(
          `创建程序记忆失败 (taskType=${taskType}, tool=${toolName})`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    // ===== 失败模式：failure + 同一 failing tool 出现 ≥2 次 → 语义记忆 =====
    const failureFailingTools = new Map<string, AgentMemory[]>()
    for (const m of group) {
      if (m.metadata.outcome !== 'failure') continue
      // 「失败工具」取第一条失败的 toolCall（若无 toolCalls 则跳过）
      const failingTool = m.metadata.toolCalls?.[0]
      if (!failingTool) continue
      if (!failureFailingTools.has(failingTool)) failureFailingTools.set(failingTool, [])
      failureFailingTools.get(failingTool)!.push(m)
    }

    for (const [toolName, samples] of failureFailingTools) {
      if (samples.length < PATTERN_MIN_SAMPLES) continue
      try {
        const content = `执行${taskType}时调用${toolName}常失败，建议改用其他方式`
        const derivedFrom = samples.map(s => s.id)

        const mergeResult = await this.createOrMergeSemantic(
          content,
          'avoid',
          derivedFrom,
          FAILURE_PATTERN_CONFIDENCE
        )
        if (mergeResult.created) createdCount++
        else if (mergeResult.merged) mergedCount++

        for (const s of samples) processedIds.add(s.id)
      } catch (err) {
        logger.warn(
          `创建失败模式语义记忆失败 (taskType=${taskType}, tool=${toolName})`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    // 注：用户偏好模式不在此处提取（无用户反馈信号），由 applyFeedback 处理
    return { created: createdCount, merged: mergedCount, processedEpisodicIds: processedIds }
  }

  /**
   * 创建或合并程序记忆
   *
   * 同一 skillId 已存在 → 原地合并（supportCount + 1, derivedFrom 追加, confidence 上调）
   *   合并不调用 recordProceduralMemory（避免重复创建）；由 consolidate 末尾的 persist() 落盘。
   * 否则 → 调用 recordProceduralMemory 新建
   */
  private async createOrMergeProcedural(
    skillId: string,
    content: string,
    derivedFrom: string[]
  ): Promise<{ created: boolean; merged: boolean }> {
    const existing = await this.findProceduralBySkillId(skillId)
    if (existing) {
      // 合并：累加 supportCount，追加 derivedFrom（去重），微调 confidence
      const existingDerived = new Set(existing.metadata.derivedFrom ?? [])
      for (const id of derivedFrom) existingDerived.add(id)
      existing.metadata.derivedFrom = Array.from(existingDerived)
      existing.metadata.supportCount = (existing.metadata.supportCount ?? 1) + 1
      existing.metadata.confidence = Math.min(0.95, (existing.metadata.confidence ?? 0.6) + 0.05)
      existing.updatedAt = new Date().toISOString()
      return { created: false, merged: true }
    }
    // 新建
    await this.mem.recordProceduralMemory(skillId, content)
    return { created: true, merged: false }
  }

  /**
   * 创建或合并语义记忆
   *
   * 同 pattern + content 子串匹配已存在 → 原地合并
   *   合并不调用 recordSemanticMemory（避免重复创建）；由 consolidate 末尾的 persist() 落盘。
   * 否则 → 调用 recordSemanticMemory 新建
   */
  private async createOrMergeSemantic(
    content: string,
    pattern: string,
    derivedFrom: string[],
    confidence: number
  ): Promise<{ created: boolean; merged: boolean }> {
    const existing = await this.findSemanticByPatternAndContent(pattern, content)
    if (existing) {
      // 合并：累加 supportCount，追加 derivedFrom（去重），保留较高 confidence
      const existingDerived = new Set(existing.metadata.derivedFrom ?? [])
      for (const id of derivedFrom) existingDerived.add(id)
      existing.metadata.derivedFrom = Array.from(existingDerived)
      existing.metadata.supportCount = (existing.metadata.supportCount ?? 1) + 1
      existing.metadata.confidence = Math.max(existing.metadata.confidence ?? confidence, confidence)
      existing.updatedAt = new Date().toISOString()
      return { created: false, merged: true }
    }
    // 新建
    await this.mem.recordSemanticMemory(content, pattern, derivedFrom)
    return { created: true, merged: false }
  }

  /**
   * 按 skillId 查找已存在的程序记忆
   */
  private async findProceduralBySkillId(skillId: string): Promise<AgentMemory | undefined> {
    const list = await this.mem.queryMemories({ type: 'procedural' })
    return list.find(m => m.metadata.skillId === skillId)
  }

  /**
   * 按 pattern + content 子串查找已存在的语义记忆
   * （content 子串匹配：相同 taskType+tool 组合的语句视为同模式）
   */
  private async findSemanticByPatternAndContent(
    pattern: string,
    content: string
  ): Promise<AgentMemory | undefined> {
    const list = await this.mem.queryMemories({ type: 'semantic' })
    // 取 content 中关键片段做子串匹配（前 20 字符通常足以区分模式）
    const keyFragment = content.slice(0, 20)
    return list.find(m => m.metadata.pattern === pattern && m.content.includes(keyFragment))
  }

  /**
   * 衰减一条情景记忆：relevance *= 0.7（cap at 0），更新 updatedAt
   * 注意：memoryService 暴露的查询返回的是内存对象的引用，直接修改后会随下次 persistIndex 落盘。
   */
  private async decayEpisodic(id: string): Promise<void> {
    const memory = this.mem.getMemory(id)
    if (!memory) return
    const current = memory.relevance ?? 1.0
    memory.relevance = Math.max(0, current * EPISODIC_DECAY_FACTOR)
    memory.updatedAt = new Date().toISOString()
  }
}

/** 单例导出 */
export const memoryConsolidator = new MemoryConsolidator()
