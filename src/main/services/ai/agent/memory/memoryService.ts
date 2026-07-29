/**
 * Agent 长期记忆服务（Task 8）
 *
 * 实现认知科学三分类记忆的存储、检索与衰减管理：
 *   - episodic（情景记忆）：单轮 Agent 执行经验，由 recordEpisodicMemory 记录
 *   - semantic（语义记忆）：从 episodic 沉淀出的模式/规则，由 consolidator 创建
 *   - procedural（程序记忆）：学到的工作流（关联技能），由 consolidator 创建
 *
 * 设计要点：
 *   1. 物理隔离：本模块完全独立于 `src/main/services/memory/`（聊天/表格记忆）。
 *      仅通过 EmbeddingService / VectorStoreService / VectorRegistryService 共用底层基础设施。
 *   2. 增量零影响：向量化失败 / 向量存储不可用时，记忆元数据仍写入 index.json，
 *      记忆功能（非语义检索部分）继续可用。
 *   3. 索引轻量化：index.json 只存元数据，向量数据由 VectorStoreService 独立管理，
 *      避免重复存储与索引膨胀。
 *   4. 单例模式：export const memoryService = new MemoryService()，与项目其他服务一致。
 *
 * 路由约定（与 VectorStoreService.SourceTypeSearchStrategy 对齐）：
 *   所有 Agent 记忆向量统一存入 source='agent-memory' / sourceId='agent-memory' 的 backend。
 *   这样 search 时传 {sourceType:'agent-memory'} 即可路由到该 backend。
 */

import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'
import { app } from 'electron'

import { embeddingService } from '../../../EmbeddingService'
import { vectorStoreService } from '../../../VectorStoreService'
import { vectorRegistryService } from '../../../VectorRegistryService'
import { VectorSourceType } from '../../../../types/vectorConfig'
import { createLogger } from '../../../logger'

import type {
  AgentMemory,
  AgentMemoryMetadata,
  LearningEvent,
  MemoryQueryFilter,
  MemorySearchResult,
  MemoryType,
} from './memoryTypes'
import type { AgentToolContext } from '../agentTypes'

const logger = createLogger('agent-memory')

/** Agent 记忆路由用的 source / sourceId（与 SourceTypeSearchStrategy 对齐） */
const AGENT_MEMORY_SOURCE = VectorSourceType.AGENT_MEMORY // 'agent-memory'
const AGENT_MEMORY_SOURCE_ID = VectorSourceType.AGENT_MEMORY // 同名 sourceId，让 SourceTypeSearchStrategy 命中
/** 单例 registry entry 的 vectorFileId（所有 Agent 记忆共享同一个 backend 文件） */
const AGENT_MEMORY_VECTOR_FILE_ID = 'agent-memory-singleton'

/**
 * Agent 记忆服务
 *
 * 维护一个内存索引 `memories: Map<string, AgentMemory>`（启动时从 index.json 加载），
 * 并在每次增删后异步持久化。向量数据交给 VectorStoreService 管理，注册表条目交给
 * VectorRegistryService 管理（统一用一个 entry 代表整个 agent-memory backend）。
 */
export class MemoryService {
  /** 内存索引：memoryId -> AgentMemory（不含 vector 数组，向量在 VectorStoreService） */
  private memories: Map<string, AgentMemory> = new Map()
  /** 是否已初始化（幂等保护） */
  private initialized: boolean = false
  /** 索引文件路径：userData/agent-memory/index.json */
  private indexPath: string
  /** 已注册的 registry entry id（所有 Agent 记忆共享一个 backend，故共享一个 entry） */
  private registryId: string | null = null

  constructor() {
    this.indexPath = path.join(app.getPath('userData'), 'agent-memory', 'index.json')
  }

  /**
   * 初始化：创建目录、加载索引、记录已注册的 registryId（若存在）。
   * 幂等：多次调用安全。
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    try {
      const dir = path.dirname(this.indexPath)
      await fsPromises.mkdir(dir, { recursive: true })
      await this.loadIndex()

      // 初始化向量基础设施（best-effort，失败不阻断记忆功能）
      try {
        await vectorStoreService.initialize()
      } catch (err) {
        logger.warn('VectorStoreService 初始化失败，语义检索将不可用', err instanceof Error ? err.message : String(err))
      }
      try {
        await vectorRegistryService.initialize()
        // 恢复 registryId（若之前已注册过）
        const entries = await vectorRegistryService.getVectorFilesBySource(AGENT_MEMORY_SOURCE)
        const singleton = entries.find(e => e.vectorFileId === AGENT_MEMORY_VECTOR_FILE_ID)
        if (singleton) {
          this.registryId = singleton.id
        }
      } catch (err) {
        logger.warn('VectorRegistryService 初始化失败，注册表功能将不可用', err instanceof Error ? err.message : String(err))
      }

      this.initialized = true
      logger.info(`MemoryService 初始化完成，已加载 ${this.memories.size} 条记忆`)
    } catch (err) {
      logger.error('MemoryService 初始化失败', err instanceof Error ? err.message : String(err))
      // 即使失败也标记为已初始化，避免后续调用反复触发初始化逻辑；
      // 此时 memories 为空 Map，记忆功能降级为只读空集
      this.initialized = true
    }
  }

  /**
   * 记录一条情景记忆（由 agentLearningService 在每轮 Agent 执行后调用）
   *
   * @param event Agent 轮次学习事件
   * @returns 已写入的记忆条目
   */
  async recordEpisodicMemory(event: LearningEvent): Promise<AgentMemory> {
    await this.initialize()

    const content = this.buildEpisodicContent(event)
    const now = new Date().toISOString()
    const id = this.generateId()

    const metadata: AgentMemoryMetadata = {
      source: 'agent-memory',
      sourceType: 'episodic',
      sessionId: event.sessionId,
      timestamp: event.timestamp,
      taskType: event.taskType,
      outcome: event.outcome,
      toolCalls: event.toolCalls?.map(t => t.name) ?? [],
      durationMs: event.toolCalls?.reduce((sum, t) => sum + (t.durationMs || 0), 0),
      // 上下文关联（便于 queryMemories 按 characterId/projectId 过滤）
      characterId: event.context?.characterId,
      projectId: event.context?.projectId,
    }

    const memory: AgentMemory = {
      id,
      type: 'episodic',
      content,
      metadata,
      createdAt: now,
      updatedAt: now,
      relevance: 1.0, // 新鲜情景记忆相关性满分
    }

    this.memories.set(id, memory)
    await this.persistIndex()
    // best-effort 向量化（失败不影响记忆已写入 index）
    await this.vectorizeAndRegister(memory).catch(err => {
      logger.warn(`记忆 ${id} 向量化失败，仅元数据已持久化`, err instanceof Error ? err.message : String(err))
    })

    logger.info(`已记录情景记忆 ${id} (taskType=${event.taskType}, outcome=${event.outcome})`)
    return memory
  }

  /**
   * 记录一条语义记忆（由 memoryConsolidator 在模式提炼后调用）
   *
   * @param content 记忆文本
   * @param pattern 模式标签（如 'avoid' / 'prefer' / 'sequence'）
   * @param derivedFrom 源自哪些 episodic 记忆 id
   * @returns 已写入的记忆条目
   */
  async recordSemanticMemory(
    content: string,
    pattern: string,
    derivedFrom?: string[]
  ): Promise<AgentMemory> {
    await this.initialize()

    const now = new Date().toISOString()
    const id = this.generateId()
    const metadata: AgentMemoryMetadata = {
      source: 'agent-memory',
      sourceType: 'semantic',
      pattern,
      confidence: 0.5, // 默认置信度，后续由 applyFeedback 调整
      derivedFrom: derivedFrom ?? [],
      supportCount: derivedFrom?.length ?? 1,
    }

    const memory: AgentMemory = {
      id,
      type: 'semantic',
      content,
      metadata,
      createdAt: now,
      updatedAt: now,
      relevance: 0.8, // 语义记忆初始相关性略低于新鲜情景
    }

    this.memories.set(id, memory)
    await this.persistIndex()
    await this.vectorizeAndRegister(memory).catch(err => {
      logger.warn(`语义记忆 ${id} 向量化失败`, err instanceof Error ? err.message : String(err))
    })

    logger.info(`已记录语义记忆 ${id} (pattern=${pattern}, supportCount=${metadata.supportCount})`)
    return memory
  }

  /**
   * 记录一条程序记忆（学到的工作流，关联技能 id）
   *
   * @param skillId 关联的技能 id
   * @param content 记忆文本（如 "执行 X 时优先调用 Y 效果较好"）
   * @returns 已写入的记忆条目
   */
  async recordProceduralMemory(skillId: string, content: string): Promise<AgentMemory> {
    await this.initialize()

    const now = new Date().toISOString()
    const id = this.generateId()
    const metadata: AgentMemoryMetadata = {
      source: 'agent-memory',
      sourceType: 'procedural',
      skillId,
      confidence: 0.6,
      supportCount: 1,
    }

    const memory: AgentMemory = {
      id,
      type: 'procedural',
      content,
      metadata,
      createdAt: now,
      updatedAt: now,
      relevance: 0.8,
    }

    this.memories.set(id, memory)
    await this.persistIndex()
    await this.vectorizeAndRegister(memory).catch(err => {
      logger.warn(`程序记忆 ${id} 向量化失败`, err instanceof Error ? err.message : String(err))
    })

    logger.info(`已记录程序记忆 ${id} (skillId=${skillId})`)
    return memory
  }

  /**
   * 语义检索记忆（基于向量相似度）
   *
   * @param query 查询文本
   * @param type 可选类型过滤（在向量结果上再过滤 sourceType）
   * @param topK 返回条数，默认 5
   * @returns 检索结果列表；若向量化不可用则返回空数组
   */
  async searchMemories(
    query: string,
    type?: MemoryType,
    topK: number = 5
  ): Promise<MemorySearchResult[]> {
    await this.initialize()

    if (!query || !query.trim()) return []

    // 1. 生成查询向量（失败则降级为空结果）
    let queryVector: number[]
    try {
      const embResult = await embeddingService.generateEmbedding(query)
      if (!embResult.success || !embResult.vector) {
        logger.debug('查询向量化失败或已禁用，返回空检索结果', embResult.error || '')
        return []
      }
      queryVector = embResult.vector
    } catch (err) {
      logger.warn('查询向量化异常，返回空检索结果', err instanceof Error ? err.message : String(err))
      return []
    }

    // 2. 在 agent-memory backend 中检索
    let results
    try {
      results = await vectorStoreService.search(queryVector, topK, undefined, {
        sourceType: AGENT_MEMORY_SOURCE,
      })
    } catch (err) {
      logger.warn('向量检索异常，返回空检索结果', err instanceof Error ? err.message : String(err))
      return []
    }

    // 3. 将 SearchResult 映射为 MemorySearchResult
    const memoryResults: MemorySearchResult[] = []
    for (const r of results) {
      // 优先从内存索引查找完整记忆
      let memory = this.memories.get(r.id)
      if (!memory) {
        // 索引未命中（可能跨会话未加载），从 metadata 重建最小记忆
        memory = this.reconstructFromMetadata(r.id, r.metadata)
        if (!memory) continue
      }
      // 类型过滤
      if (type && memory.metadata.sourceType !== type) continue
      memoryResults.push({ memory, score: r.score })
    }

    return memoryResults
  }

  /**
   * 非向量查询：在内存索引上按 metadata 字段过滤
   *
   * @param filter 过滤条件（type/tags/taskType/characterId/projectId）
   */
  async queryMemories(filter: MemoryQueryFilter): Promise<AgentMemory[]> {
    await this.initialize()

    const results: AgentMemory[] = []
    for (const memory of this.memories.values()) {
      if (filter.type && memory.metadata.sourceType !== filter.type) continue
      if (filter.taskType && memory.metadata.taskType !== filter.taskType) continue
      if (filter.characterId && memory.metadata.characterId !== filter.characterId) continue
      if (filter.projectId && memory.metadata.projectId !== filter.projectId) continue
      if (filter.tags && filter.tags.length > 0) {
        const memoryTags = memory.metadata.tags ?? []
        if (!filter.tags.some(t => memoryTags.includes(t))) continue
      }
      results.push(memory)
    }
    return results
  }

  /**
   * RAG 入口：根据上下文 + 任务描述检索相关记忆
   *
   * 由 Agent 决策点调用，用于在生成回复前注入历史经验。
   *
   * @param context 工具执行上下文（角色卡/项目/会话 id）
   * @param taskDescription 当前任务描述
   * @param topK 返回条数
   */
  async getRelevantMemories(
    context: AgentToolContext,
    taskDescription: string,
    topK: number = 5
  ): Promise<MemorySearchResult[]> {
    // 拼接查询：任务描述 + 上下文信息，提升语义召回
    const parts: string[] = []
    if (taskDescription) parts.push(taskDescription)
    if (context.characterId) parts.push(`characterId:${context.characterId}`)
    if (context.projectId) parts.push(`projectId:${context.projectId}`)
    if (context.chatId) parts.push(`chatId:${context.chatId}`)
    const query = parts.join(' ')
    return this.searchMemories(query, undefined, topK)
  }

  /**
   * 删除一条记忆：从索引移除 + 删除向量 + 更新注册表
   *
   * 注意：registry entry 代表整个 agent-memory backend（包含所有记忆向量），
   * 故只在向量层面删除该条记忆；registry entry 仅在 backend 完全清空时清理。
   */
  async deleteMemory(id: string): Promise<void> {
    await this.initialize()

    const memory = this.memories.get(id)
    if (!memory) {
      logger.warn(`deleteMemory: 记忆 ${id} 不存在`)
      return
    }

    // 1. 从内存索引移除并持久化
    this.memories.delete(id)
    await this.persistIndex()

    // 2. best-effort 删除向量
    try {
      await vectorStoreService.delete(id, { sourceType: AGENT_MEMORY_SOURCE })
    } catch (err) {
      logger.warn(`删除记忆 ${id} 的向量失败`, err instanceof Error ? err.message : String(err))
    }

    // 3. 更新 registry entry 的 vectorCount（若已注册）
    await this.refreshRegistryCount().catch(err => {
      logger.warn(`更新 registry vectorCount 失败`, err instanceof Error ? err.message : String(err))
    })

    logger.info(`已删除记忆 ${id}`)
  }

  /**
   * 同步获取记忆（从内存索引）
   * @param id 记忆 id
   */
  getMemory(id: string): AgentMemory | undefined {
    return this.memories.get(id)
  }

  /**
   * 主动持久化内存索引到 index.json
   *
   * 用途：外部模块（如 memoryConsolidator）通过 queryMemories/getMemory 拿到
   * 内存对象引用后，原地修改了字段（如 supportCount/confidence/relevance），
   * 调用本方法将变更落盘。
   */
  async persist(): Promise<void> {
    await this.initialize()
    await this.persistIndex()
  }

  // ============ 私有辅助方法 ============

  /**
   * 由 LearningEvent 构建情景记忆的文本内容
   * 内容文本将作为向量化的输入，故需包含关键语义信息。
   */
  private buildEpisodicContent(event: LearningEvent): string {
    const parts: string[] = []
    parts.push(`任务类型: ${event.taskType}`)
    if (event.taskDescription) parts.push(`任务描述: ${event.taskDescription}`)
    parts.push(`结果: ${event.outcome}`)
    if (event.toolCalls && event.toolCalls.length > 0) {
      const toolSummary = event.toolCalls
        .map(t => `${t.name}(${t.success ? '成功' : '失败'},${t.durationMs}ms)`)
        .join(', ')
      parts.push(`工具调用: ${toolSummary}`)
    }
    if (event.finalContentLength != null) {
      parts.push(`输出长度: ${event.finalContentLength}`)
    }
    return parts.join('\n')
  }

  /**
   * 向量化一条记忆并注册到 registry（best-effort，失败不抛错）
   *
   * 步骤：
   *   1. embeddingService.generateEmbedding → 若失败/禁用，仅保留元数据，不向量化
   *   2. vectorStoreService.add(id, vector, metadata) → 路由到 agent-memory backend
   *   3. vectorRegistryService.registerVectorFile → 注册/更新 singleton entry
   */
  private async vectorizeAndRegister(memory: AgentMemory): Promise<void> {
    if (!memory.content || !memory.content.trim()) return

    // 1. 生成向量
    let vector: number[]
    try {
      const embResult = await embeddingService.generateEmbedding(memory.content)
      if (!embResult.success || !embResult.vector) {
        logger.debug(`记忆 ${memory.id} 跳过向量化（向量化禁用或失败）`, embResult.error || '')
        return
      }
      vector = embResult.vector
    } catch (err) {
      logger.warn(`记忆 ${memory.id} 向量化异常`, err instanceof Error ? err.message : String(err))
      return
    }

    // 2. 写入向量存储（路由到 agent-memory backend）
    try {
      const vectorMetadata: Record<string, any> = {
        ...memory.metadata,
        source: AGENT_MEMORY_SOURCE, // 路由 key（与 AgentMemoryMetadata.source 同值）
        sourceId: AGENT_MEMORY_SOURCE_ID, // 路由 key（与 SourceTypeSearchStrategy 对齐）
        text: memory.content,
        memoryId: memory.id,
        memoryType: memory.type,
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
      }
      await vectorStoreService.add(memory.id, vector, vectorMetadata)
    } catch (err) {
      logger.warn(`记忆 ${memory.id} 写入向量存储失败`, err instanceof Error ? err.message : String(err))
      return
    }

    // 3. 注册/更新 registry entry（所有 Agent 记忆共享一个 entry）
    try {
      const registryId = await vectorRegistryService.registerVectorFile({
        id: this.registryId ?? undefined, // 已有则更新
        vectorFileId: AGENT_MEMORY_VECTOR_FILE_ID,
        sourceType: AGENT_MEMORY_SOURCE,
        sourceId: AGENT_MEMORY_SOURCE_ID,
        sourceName: 'Agent 长期记忆',
        vectorCount: this.memories.size,
        additionalMetadata: {
          memoryIds: Array.from(this.memories.keys()),
        },
      })
      // 缓存 registryId 供后续更新复用
      if (!this.registryId) this.registryId = registryId
    } catch (err) {
      logger.warn(`记忆 ${memory.id} 注册 registry 失败`, err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * 刷新 registry entry 的 vectorCount（删除记忆后调用）
   * 若所有记忆都已清空，可选保留 entry（避免下次创建时重复注册）
   */
  private async refreshRegistryCount(): Promise<void> {
    if (!this.registryId) return
    try {
      await vectorRegistryService.registerVectorFile({
        id: this.registryId,
        vectorFileId: AGENT_MEMORY_VECTOR_FILE_ID,
        sourceType: AGENT_MEMORY_SOURCE,
        sourceId: AGENT_MEMORY_SOURCE_ID,
        sourceName: 'Agent 长期记忆',
        vectorCount: this.memories.size,
        additionalMetadata: {
          memoryIds: Array.from(this.memories.keys()),
        },
      })
    } catch (err) {
      logger.warn(`刷新 registry vectorCount 失败`, err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * 从 SearchResult.metadata 重建最小 AgentMemory（索引未命中时的兜底）
   * 若 metadata 缺少关键字段则返回 undefined
   */
  private reconstructFromMetadata(id: string, metadata: Record<string, any>): AgentMemory | undefined {
    if (!metadata || !metadata.memoryType) return undefined
    const now = new Date().toISOString()
    return {
      id,
      type: metadata.memoryType as MemoryType,
      content: metadata.text ?? '',
      metadata: {
        source: 'agent-memory',
        sourceType: metadata.memoryType as MemoryType,
        taskType: metadata.taskType,
        outcome: metadata.outcome,
        pattern: metadata.pattern,
        skillId: metadata.skillId,
        characterId: metadata.characterId,
        projectId: metadata.projectId,
        tags: metadata.tags,
      },
      createdAt: metadata.createdAt ?? now,
      updatedAt: metadata.updatedAt ?? now,
      relevance: metadata.relevance,
    }
  }

  /**
   * 持久化内存索引到 index.json
   *
   * 重要：不写入 vector 数组（向量数据由 VectorStoreService 管理），
   * 仅写入元数据以保持索引文件轻量。
   */
  private async persistIndex(): Promise<void> {
    try {
      const dir = path.dirname(this.indexPath)
      await fsPromises.mkdir(dir, { recursive: true })

      // 序列化时显式剔除 vector 字段
      const serializable = Array.from(this.memories.values()).map(m => {
        const { vector: _vector, ...rest } = m
        return rest
      })

      await fsPromises.writeFile(
        this.indexPath,
        JSON.stringify(serializable, null, 2),
        'utf-8'
      )
    } catch (err) {
      logger.error('持久化记忆索引失败', err instanceof Error ? err.message : String(err))
      // 不抛出：避免一次磁盘失败级联影响调用方
    }
  }

  /**
   * 从 index.json 加载索引到内存 Map
   * 文件不存在或损坏时降级为空 Map
   */
  private async loadIndex(): Promise<void> {
    try {
      if (!fs.existsSync(this.indexPath)) {
        this.memories = new Map()
        return
      }
      const data = await fsPromises.readFile(this.indexPath, 'utf-8')
      const arr = JSON.parse(data) as AgentMemory[]
      this.memories = new Map()
      for (const m of arr) {
        if (!m || !m.id) continue
        // 加载时确保无 vector 字段（防御：旧版本数据可能残留）
        m.vector = undefined
        this.memories.set(m.id, m)
      }
    } catch (err) {
      logger.warn('加载记忆索引失败，使用空索引', err instanceof Error ? err.message : String(err))
      this.memories = new Map()
    }
  }

  /**
   * 生成唯一记忆 id：mem_{timestamp}_{random}
   */
  private generateId(): string {
    const rand = Math.random().toString(36).slice(2, 10)
    return `mem_${Date.now()}_${rand}`
  }
}

/** 单例导出（与项目其他服务风格一致） */
export const memoryService = new MemoryService()
