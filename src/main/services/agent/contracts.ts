/**
 * 跨模块接口契约 —— 智能体底座五大模块之间的低耦合契约层
 *
 * 来源：spec §二 Task 5.1（定义 ILLMProvider/IMemoryProvider/IToolProvider/
 *       ISkillRegistry/ILearningScheduler）
 * 决策：自研（spec §三无对应 openclaw 文件）。openclaw 的模块间通信分散在
 *       runtime/agents，本项目按 OpenAI tool_calls 协议自研精简契约层。
 *
 * 职责：
 *  1. 定义五大模块间的接口契约，确保 core/llm/memory/skills/learning 低耦合
 *  2. 现有资产（AIService/worldBookService/ChatVectorizationService）通过 adapter
 *     实现这些接口，而非推倒重来（spec §5.1 双轨并行）
 *  3. 接口稳定性：实现可替换，契约不变（如 LLMProvider 可从 AIService 切换到直连）
 *
 * 设计约束：
 *  - 接口尽量窄：仅暴露 agentLoop 真正需要的方法
 *  - 返回 Promise：所有 I/O 异步化（spec §4.2 P3/P4 配套）
 *  - 错误统一用 AgentError（infra/errors.ts）
 */

import type { ToolDefinition } from '../AIService';
import type { ToolDescriptor } from './tools/types';
import type { SkillEntry } from './skills/types';

// 重导出 ToolDefinition，供 core/llm/memory 等模块统一从 contracts 引入
export type { ToolDefinition } from '../AIService';

/**
 * OpenAI tool_calls 协议中的单个工具调用。
 *
 * 结构遵循 OpenAI tool_calls 规范：
 *   { id: 'call_xxx', type: 'function', function: { name: 'foo', arguments: '{"key":"value"}' } }
 * - id: 调用唯一标识（回填 role='tool' 消息时需匹配）
 * - type: 固定 'function'
 * - function.name: 要调用的工具名
 * - function.arguments: JSON 字符串形式的参数（需 JSON.parse 后使用）
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// ==================== 模块一：ILLMProvider（LLM 提供方） ====================

/**
 * 流式聊天请求参数。
 *
 * 封装 agentLoop 调用 LLM 时所需的所有信息，与 AIService.streamChatAPI 对齐。
 */
export interface StreamChatRequest {
  /** 系统提示词（已由 promptBuilder 组装完毕） */
  systemPrompt: string;
  /** 对话历史（已清洗，不含 system 角色） */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** 模型名称 */
  modelName: string;
  /** 可用工具定义（支持 tool calling 时注入） */
  tools?: ToolDefinition[];
  /** 是否禁用并行工具调用（默认 true，简化 agentLoop 顺序执行） */
  parallelToolCalls?: boolean;
  /** 采样参数 */
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  /** 停止序列 */
  stop?: string[];
}

/**
 * 流式聊天响应结果。
 */
export interface StreamChatResult {
  /** 生成的文本内容 */
  content: string;
  /** 工具调用（finishReason='tool_calls' 时存在） */
  toolCalls?: ToolCall[];
  /** 结束原因：stop / length / tool_calls / content_filter */
  finishReason?: string;
  /** token 用量统计 */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * LLM 提供方接口。
 *
 * 实现方：AIServiceAdapter（包装现有 AIService.streamChatAPI）
 * 职责：为 agentLoop 提供统一的 LLM 调用入口，屏蔽 OpenAI/Anthropic/本地模型差异。
 */
export interface ILLMProvider {
  /** 流式聊天（支持工具调用） */
  streamChat(request: StreamChatRequest): Promise<StreamChatResult>;

  /** 探测模型能力（复用 AIService.probeAllCapabilities，F1 修复后结果真正生效） */
  probeCapabilities(config: {
    baseUrl: string;
    apiKey: string;
    apiKeyTransmission: string;
    modelName: string;
  }): Promise<{
    supportsStopArray: boolean;
    supportsRepPen: boolean;
    supportsDrySampler: boolean;
    supportsVision: boolean;
    supportsThinking: boolean;
    supportsToolCalling: boolean;
  }>;
}

// ==================== 模块二：IToolProvider（工具提供方） ====================

/**
 * 工具执行结果。
 */
export interface ToolExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 结果内容（成功时为数据，失败时为错误信息） */
  content: string;
  /** 是否需要将结果回传给 LLM 继续决策（默认 true） */
  continueLoop?: boolean;
}

/**
 * 工具提供方接口。
 *
 * 实现方：ToolRegistry（core/agentLoop 的工具注册中心）
 * 职责：管理工具注册、查询、执行。工具分三组：dialogue / writing / worldbook。
 */
export interface IToolProvider {
  /** 获取所有已注册工具的描述符（供 LLM tools 参数注入） */
  listTools(): ToolDescriptor[];

  /** 获取可用工具的 OpenAI 格式定义（过滤后） */
  getToolDefinitions(context?: ToolCallContext): ToolDefinition[];

  /** 执行工具调用 */
  executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context?: ToolCallContext
  ): Promise<ToolExecutionResult>;

  /** 检查工具是否可用（声明式可用性，参考 openclaw ToolAvailabilityExpression） */
  isToolAvailable(toolName: string, context?: ToolCallContext): boolean;
}

/**
 * 工具调用上下文（传递给工具执行器，提供运行时信息）。
 */
export interface ToolCallContext {
  /** 当前会话 ID */
  sessionId?: string;
  /** 当前角色卡 ID */
  characterId?: string;
  /** 当前模式：dialogue / writing / game / worldbook（Task 17 新增 worldbook 模式） */
  mode?: 'dialogue' | 'writing' | 'game' | 'worldbook';
  /** 用户 ID（用于权限隔离） */
  userId?: string;
  /**
   * 沙盒约束（Task 17 新增）。
   * 限制 worldbook 模式下 agent 可写入的世界书路径白名单，
   * 越权写入 → 拒绝并返回错误（spec §5.4 沙盒隔离）。
   */
  allowedWorldBookPaths?: string[];
}

// ==================== 模块三：IMemoryProvider（记忆提供方） ====================

/**
 * 记忆条目类型（与现有资产对齐）。
 */
export type MemoryType =
  | 'lore' // 世界书条目
  | 'persona' // 角色卡信息
  | 'dialogue' // 对话历史
  | 'chapter' // 写作章节
  | 'agent' // agent 自主记忆（dreaming 摘要等，走 SQLite）
  | 'skill'; // 技能执行记录

/**
 * 记忆检索查询。
 */
export interface MemoryQuery {
  /** 检索关键词 */
  query: string;
  /** 记忆类型过滤（不指定则全部） */
  types?: MemoryType[];
  /** 限制返回条数 */
  limit?: number;
  /** 相似度阈值 [0, 1] */
  threshold?: number;
  /** 关联的角色卡 ID */
  characterId?: string;
  /** 关联的会话 ID */
  sessionId?: string;
}

/**
 * 记忆条目。
 */
export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  /** 来源标识（worldBook:entryId / character:cardId / chatHistory:msgId） */
  source: string;
  /** 相似度分数（向量检索时填充） */
  score?: number;
  /** 元数据（关键词、标签等） */
  metadata?: Record<string, unknown>;
  /** 关联的角色卡 ID（可选，用于按角色过滤） */
  characterId?: string;
  /** 关联的会话 ID（可选，用于按会话过滤） */
  sessionId?: string;
  /** 创建时间戳 */
  timestamp: number;
}

/**
 * 记忆提供方接口。
 *
 * 实现方：memoryStore（通过 adapters/ 桥接现有资产）
 * 职责：为 agentLoop 提供统一的记忆检索/写入入口，透明桥接旧 JSON 存储 + 新 SQLite。
 */
export interface IMemoryProvider {
  /** 检索相关记忆（向量 + 关键词混合检索） */
  search(query: MemoryQuery): Promise<MemoryEntry[]>;

  /** 写入记忆（带写溯源，spec §二 memory/writeProvenance.ts） */
  write(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): Promise<string>;

  /** 读取指定 ID 的记忆 */
  read(id: string): Promise<MemoryEntry | null>;

  /** 删除记忆 */
  delete(id: string): Promise<boolean>;
}

// ==================== 模块四：ISkillRegistry（技能注册中心） ====================

/**
 * 技能注册中心接口。
 *
 * 实现方：skillRegistry（skills/ 模块）
 * 职责：管理 SKILL.md 技能的注册、查询、快照、调用分发。
 */
export interface ISkillRegistry {
  /** 注册技能 */
  register(entry: SkillEntry): void;

  /** 注销技能 */
  unregister(skillName: string): void;

  /** 获取技能条目 */
  get(skillName: string): SkillEntry | undefined;

  /** 列出所有技能 */
  list(): SkillEntry[];

  /** 构建会话快照（注入 prompt 的可用技能列表） */
  buildSnapshot(filter?: string[]): string;

  /** 调用技能（双调用策略：模型调用 / 用户调用） */
  invoke(
    skillName: string,
    args: Record<string, unknown>,
    context?: ToolCallContext
  ): Promise<ToolExecutionResult>;
}

// ==================== 模块五：ILearningScheduler（学习调度器） ====================

/**
 * 学习调度器接口。
 *
 * 实现方：cronScheduler（learning/ 模块）
 * 职责：自主调度 dreaming（短期→长期摘要）、goalTracker、feedbackLoop。
 *       照抄 openclaw pacing/stagger 防失控。
 */
export interface ILearningScheduler {
  /** 启动调度器 */
  start(): void;

  /** 停止调度器 */
  stop(): void;

  /** 手动触发 dreaming（短期→长期记忆摘要） */
  dreamNow(sessionId?: string): Promise<void>;

  /** 注册定时任务 */
  schedule(cron: string, task: () => Promise<void>, options?: ScheduleOptions): string;

  /** 取消定时任务 */
  cancel(taskId: string): void;

  /** 获取待执行任务状态 */
  getPendingTasks(): Array<{ id: string; nextRun: number; label?: string }>;
}

/**
 * 调度选项（照抄 openclaw pacing/stagger 理念）。
 */
export interface ScheduleOptions {
  /** 任务标签（用于日志） */
  label?: string;
  /** 防失控：单任务最小执行间隔（pacing） */
  minIntervalMs?: number;
  /** 防锁步：执行时间抖动窗口（stagger） */
  staggerMs?: number;
  /** 是否允许并发执行（默认 false） */
  allowConcurrent?: boolean;
}

// ==================== AgentRunIntent / AgentRunResult ====================

/**
 * Agent 运行意图（AgentCore.run 入口参数）。
 */
export interface AgentRunIntent {
  /** 系统提示词 */
  systemPrompt: string;
  /** 对话历史 */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** 工具调用上下文 */
  context?: ToolCallContext;
  /** 最大迭代次数（默认 8，spec §二 core/agentLoop） */
  maxIterations?: number;
  /** 超时毫秒（默认 300000 = 5 分钟） */
  timeoutMs?: number;
}

/**
 * Agent 运行结果。
 */
export interface AgentRunResult {
  /** 最终生成的文本内容 */
  content: string;
  /** 执行的工具调用记录（审计用） */
  toolCallHistory: Array<{
    name: string;
    args: Record<string, unknown>;
    result: ToolExecutionResult;
    durationMs: number;
  }>;
  /** 总迭代次数 */
  iterations: number;
  /** 结束原因 */
  finishReason: 'stop' | 'length' | 'maxIterations' | 'timeout' | 'error';
  /** token 用量 */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  /** 错误信息（finishReason='error' 时存在） */
  error?: string;
}
