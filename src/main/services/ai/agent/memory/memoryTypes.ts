/**
 * Agent 长期学习与记忆系统核心类型定义
 *
 * 对标具备长期学习特性的 Agent 架构。
 * 采用认知科学三分类：episodic（情景）/ semantic（语义）/ procedural（程序）。
 * 复用现有向量基础设施（VectorStoreService/VectorRegistryService）存储与检索。
 */

import type { AgentToolContext, AgentLoopResult } from '../agentTypes'

/**
 * 记忆类型（认知科学三分类）
 *
 * - episodic（情景记忆）：具体 Agent 轮次经验
 *   例："在角色卡X的对话中，调用 searchWorldbook 成功找到设定Y"
 * - semantic（语义记忆）：沉淀的知识/模式/规则
 *   例："用户偏好简洁回复，长篇设定查询前先确认"
 * - procedural（程序记忆）：学到的工作流（关联技能）
 *   例："写战斗场景时，先查角色能力表→再查世界书战斗规则→再生成"
 */
export type MemoryType = 'episodic' | 'semantic' | 'procedural'

/** Agent 记忆条目 */
export interface AgentMemory {
  id: string
  type: MemoryType
  /** 记忆文本 */
  content: string
  metadata: AgentMemoryMetadata
  /** 向量（由 EmbeddingService 生成，可选） */
  vector?: number[]
  createdAt: string
  updatedAt: string
  /** 衰减后的相关性（0-1，近期记忆更高） */
  relevance?: number
}

/** 记忆元数据 */
export interface AgentMemoryMetadata {
  source: 'agent-memory'
  sourceType: MemoryType

  // ===== episodic 专属 =====
  sessionId?: string
  timestamp?: number
  /** 'dialogue' | 'writing' | 'worldbook' | ... */
  taskType?: string
  outcome?: 'success' | 'failure' | 'partial'
  /** 涉及的工具名 */
  toolCalls?: string[]
  durationMs?: number

  // ===== semantic 专属 =====
  pattern?: string
  /** 0-1 */
  confidence?: number
  /** 源自哪些 episodic 记忆 id */
  derivedFrom?: string[]
  /** 支撑该结论的 episodic 数 */
  supportCount?: number

  // ===== procedural 专属 =====
  skillId?: string

  // ===== 通用 =====
  tags?: string[]
  characterId?: string
  projectId?: string
}

/**
 * Agent 轮次学习事件（供 agentLearningService 记录）
 *
 * 由 agentLoop 的 onTurnComplete 回调触发，封装一轮 Agent 执行的经验数据。
 */
export interface LearningEvent {
  sessionId?: string
  taskType: string
  taskDescription?: string
  toolCalls: Array<{ name: string; success: boolean; durationMs: number }>
  outcome: 'success' | 'failure' | 'partial'
  finalContentLength?: number
  context?: AgentToolContext
  timestamp: number
}

/** 记忆检索结果 */
export interface MemorySearchResult {
  memory: AgentMemory
  /** 相似度分数 */
  score: number
}

/** 记忆查询过滤器（非向量查询） */
export interface MemoryQueryFilter {
  type?: MemoryType
  tags?: string[]
  taskType?: string
  characterId?: string
  projectId?: string
}

/** 记忆整合统计 */
export interface ConsolidationStats {
  /** 处理的 episodic 记忆数 */
  consolidated: number
  /** 新创建的 semantic/procedural 记忆数 */
  created: number
  /** 合并的重复记忆数 */
  merged: number
}

/** 决策优化建议 */
export interface DecisionOptimization {
  relevantMemories: MemorySearchResult[]
  /** 建议调用的技能 id */
  suggestedSkills?: string[]
  /** 0-1 */
  confidence: number
}

/** 用户反馈 */
export interface MemoryFeedback {
  correct: boolean
  correction?: string
}

/** 复用 AgentLoopResult 类型导出（供学习服务引用） */
export type { AgentLoopResult }
