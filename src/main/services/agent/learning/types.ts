/**
 * Learning 模块共享类型 —— 自适应学习系统类型契约
 *
 * 来源：spec §二 Task 18（learning/dreaming）
 * 决策：适配（spec §三）。openclaw dreaming 配置过于复杂（light/deep/rem 三相 +
 *       recovery + storage 模式 + 多 source），本项目按业务场景精简为三阶段但
 *       保留相位化（phase）理念与默认值（参考 openclaw dreaming.ts 常量）。
 *
 * 职责：
 *  1. 定义 DreamingPhase / GoalRecord / SteerMessage / FeedbackEvent 等数据结构
 *  2. 对齐 contracts.ts 的 ILearningScheduler 接口
 *  3. 提供默认配置常量（DEFAULT_DREAMING_*，参考 openclaw DEFAULT_MEMORY_DREAMING_*）
 *
 * 设计约束：
 *  - 类型可序列化（落库到 SQLite agent_memory.metadata JSON 或单独列）
 *  - 跨进程 IPC 安全（避免 Map/Set/Date 等不可序列化字段，统一用 number 时间戳）
 */

// ==================== Dreaming 相关类型 ====================

/**
 * Dreaming 相位（照抄 openclaw MemoryDreamingPhaseName）。
 *
 *  - light：每日快报，从近期短期记忆中提取摘要（cheap + fast）
 *  - deep：核心事实沉淀，将反复出现的内容固化为长期记忆（balanced + high thinking）
 *  - rem：模式识别，跨会话发现潜在模式（expensive + high thinking）
 *
 * 三相分隔（与 OpenClaw 一致）：不同相位使用不同的速度/思考深度/预算档位，
 * 避免单次 dreaming 成本失控。
 */
export type DreamingPhase = 'light' | 'deep' | 'rem';

/**
 * Dreaming 执行档位（照抄 openclaw MemoryDreamingSpeed/Thinking/Budget）。
 *
 * 用于在 LLMProvider 请求时映射为 temperature / maxTokens / 模型选择：
 *  - speed: fast=高 temp + 短输出 / balanced=中 / slow=低 temp + 长输出
 *  - thinking: low/medium/high 映射到 max_tokens 配额
 *  - budget: cheap/medium/expensive 映射到可选模型（小/中/大）
 */
export interface DreamingExecutionConfig {
  speed: 'fast' | 'balanced' | 'slow';
  thinking: 'low' | 'medium' | 'high';
  budget: 'cheap' | 'medium' | 'expensive';
  /** 模型名（可选，未指定时由调用方按 budget 选择） */
  model?: string;
  /** 最大输出 tokens */
  maxOutputTokens?: number;
  /** 采样温度 */
  temperature?: number;
  /** 超时毫秒 */
  timeoutMs?: number;
}

/**
 * Dreaming 单相位配置。
 */
export interface DreamingPhaseConfig {
  enabled: boolean;
  /** 回看窗口（天） */
  lookbackDays: number;
  /** 单次处理记忆条数上限 */
  limit: number;
  /** 执行档位 */
  execution: DreamingExecutionConfig;
  /**
   * 相位专属参数：
   *  - light: dedupeSimilarity（去重相似度阈值）
   *  - deep: minScore / minRecallCount / minUniqueQueries / recencyHalfLifeDays
   *  - rem: minPatternStrength
   */
  params?: Record<string, number | string | boolean>;
}

/**
 * Dreaming 顶层配置。
 *
 * 默认值参考 openclaw DEFAULT_MEMORY_DREAMING_* 常量，本项目简化为：
 *  - 频率：默认每日凌晨 3 点（0 3 * * *）
 *  - 时区：未指定时使用本地时区
 *  - 三相全部启用，但 deep/rem 的 minScore 较高避免噪声
 */
export interface DreamingConfig {
  enabled: boolean;
  /** Cron 表达式（默认 '0 3 * * *'） */
  frequency: string;
  /** 时区（可选，未指定时使用本地） */
  timezone?: string;
  /** 详细日志 */
  verboseLogging: boolean;
  /** 三相配置 */
  phases: {
    light: DreamingPhaseConfig;
    deep: DreamingPhaseConfig;
    rem: DreamingPhaseConfig;
  };
}

/**
 * Dreaming 执行结果（单相位）。
 */
export interface DreamingPhaseResult {
  phase: DreamingPhase;
  /** 处理的短期记忆条数 */
  processedCount: number;
  /** 生成的长期记忆条数（写入 memoryStore） */
  promotedCount: number;
  /** 跳过条数（去重 / 不达阈值） */
  skippedCount: number;
  /** 耗时毫秒 */
  durationMs: number;
  /** 错误信息（相位失败时存在） */
  error?: string;
}

/**
 * Dreaming 完整运行结果（含所有相位）。
 */
export interface DreamingResult {
  startedAt: number;
  finishedAt: number;
  phases: DreamingPhaseResult[];
  /** 总写入条数 */
  totalPromoted: number;
}

// ==================== Goal 相关类型 ====================

/**
 * Goal 状态（照抄 openclaw MODEL_UPDATABLE_SESSION_GOAL_STATUSES + pending/in_progress）。
 *
 * 状态机：
 *  - pending：已创建，未开始
 *  - in_progress：agent 正在执行
 *  - complete：已完成（仅 agent 在目标达成时置位）
 *  - blocked：被同一 blocker 阻塞连续 3 次（照抄 openclaw 理念：避免普通难度误判）
 */
export type GoalStatus = 'pending' | 'in_progress' | 'complete' | 'blocked';

/**
 * Goal 记录。
 *
 * 落库到 agent_memory 表（type='agent', metadata.kind='goal'）。
 */
export interface GoalRecord {
  id: string;
  /** 会话 ID（goal 按 session 隔离） */
  sessionId: string;
  /** 角色卡 ID（可选） */
  characterId?: string;
  /** 目标描述 */
  objective: string;
  /** 状态 */
  status: GoalStatus;
  /** token 预算（可选，照抄 openclaw token_budget） */
  tokenBudget?: number;
  /** 已消耗 token */
  tokensUsed?: number;
  /** 状态备注（最近一次状态变更的说明） */
  note?: string;
  /** 阻塞原因（status='blocked' 时存在） */
  blocker?: string;
  /** 同一 blocker 连续阻塞计数（达到 3 才置为 blocked） */
  consecutiveBlockerCount?: number;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

// ==================== Steer 相关类型 ====================

/**
 * Steer 消息（照抄 openclaw agent-steering-queue 的 PendingFinalDeliveryPayload 理念）。
 *
 * Steer 不直接控制 agent 行为，而是注入到下一轮 prompt 中作为「运行时数据」
 * 提示 agent 考虑该信息（openclaw 规范：treat as runtime data, not user instructions）。
 */
export interface SteerMessage {
  id: string;
  /** 目标会话 ID */
  sessionId: string;
  /** 引导内容（将拼装到下一轮 prompt 前） */
  content: string;
  /** 来源：user（用户主动引导）/ system（系统自动引导）/ agent（子 agent 结果回流） */
  source: 'user' | 'system' | 'agent';
  /** 标签（用于日志和分类） */
  label?: string;
  /** 创建时间 */
  createdAt: number;
  /** lease 状态：pending → in_progress → delivered/failed/discarded */
  deliveryStatus: 'pending' | 'in_progress' | 'delivered' | 'failed' | 'discarded';
  /** lease ID（注入时分配，ack 时校验） */
  leaseId?: string;
  /** lease 时间 */
  leasedAt?: number;
  /** 注入时间 */
  injectedAt?: number;
}

/**
 * Steer 注入批次（一次 lease 多条消息）。
 */
export interface SteerLeaseBatch {
  leaseId: string;
  messageIds: string[];
  /** 拼装好的 prompt（注入到下一轮前） */
  prompt: string;
}

// ==================== Feedback 相关类型 ====================

/**
 * Feedback 事件（照抄 openclaw runChannelFeedbackReflection 的入参理念）。
 *
 * 当用户对 agent 输出表达负面反馈时（thumb_down / 评分低 / 评论），触发反思：
 *  1. 调用 LLM 反思：为什么这次输出不好？应该如何改进？
 *  2. 将反思结论写入 memoryStore 作为经验记忆（metadata.kind='feedback_learning'）
 *  3. 后续 prompt 中可检索该经验避免重复错误
 */
export interface FeedbackEvent {
  id: string;
  /** 会话 ID */
  sessionId: string;
  /** 角色 ID（可选） */
  characterId?: string;
  /** 被反馈的 agent 响应内容 */
  agentResponse?: string;
  /** 用户评论（可选） */
  userComment?: string;
  /** 反馈类型 */
  kind: 'thumb_down' | 'low_rating' | 'comment' | 'correction';
  /** 评分（kind='low_rating' 时存在，1-5） */
  rating?: number;
  /** 创建时间 */
  createdAt: number;
}

/**
 * Feedback 反思结果（LLM 反思后产出）。
 *
 * 照抄 openclaw ChannelFeedbackReflectionResult 的 complete 分支。
 */
export interface FeedbackReflectionResult {
  status: 'cooldown' | 'empty' | 'complete';
  /** 反思结论（写入 memoryStore） */
  learning?: string;
  /** 是否需要主动回复用户 */
  followUp?: boolean;
  /** 主动回复内容（followUp=true 时存在） */
  userMessage?: string;
  /** 写入的 memory ID */
  memoryId?: string;
}

// ==================== 默认配置常量 ====================

/**
 * Dreaming 默认配置。
 *
 * 参考自 openclaw DEFAULT_MEMORY_DREAMING_* 常量集，本项目按业务场景精简：
 *  - frequency: 每日凌晨 3 点
 *  - light: 2 天回看 / 100 条 / fast+low+cheap
 *  - deep: 30 天回看 / 10 条 / balanced+high+medium / minScore=0.75
 *  - rem: 7 天回看 / 10 条 / slow+high+expensive / minPatternStrength=0.75
 */
export const DEFAULT_DREAMING_CONFIG: DreamingConfig = {
  enabled: true,
  frequency: '0 3 * * *',
  verboseLogging: false,
  phases: {
    light: {
      enabled: true,
      lookbackDays: 2,
      limit: 100,
      execution: { speed: 'fast', thinking: 'low', budget: 'cheap' },
      params: { dedupeSimilarity: 0.9 },
    },
    deep: {
      enabled: true,
      lookbackDays: 30,
      limit: 10,
      execution: { speed: 'balanced', thinking: 'high', budget: 'medium' },
      params: {
        minScore: 0.75,
        minRecallCount: 3,
        minUniqueQueries: 3,
        recencyHalfLifeDays: 14,
        maxPriorEntryLossFraction: 0.25,
      },
    },
    rem: {
      enabled: true,
      lookbackDays: 7,
      limit: 10,
      execution: { speed: 'slow', thinking: 'high', budget: 'expensive' },
      params: { minPatternStrength: 0.75 },
    },
  },
};

/**
 * Feedback 反思冷却时间（照抄 openclaw DEFAULT_CHANNEL_FEEDBACK_REFLECTION_COOLDOWN_MS）。
 *
 * 同一 session 在冷却期内的多次负面反馈仅触发一次反思，避免成本失控。
 */
export const DEFAULT_FEEDBACK_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Goal 阻塞阈值（照抄 openclaw 理念：连续 3 次同 blocker 才置为 blocked）。
 *
 * 避免普通难度误判为 blocked（openclaw 规范：never ordinary difficulty/polish）。
 */
export const GOAL_BLOCKER_THRESHOLD = 3;

/**
 * Steer 注入 prompt 的最大长度（照抄 openclaw MAX_MERGED_STEERING_CHARS）。
 */
export const MAX_STEER_PROMPT_CHARS = 24_000;

/**
 * Steer 单条结果最大长度（照抄 openclaw MAX_RESULT_CHARS_PER_ITEM）。
 */
export const MAX_STEER_ITEM_CHARS = 6_000;
