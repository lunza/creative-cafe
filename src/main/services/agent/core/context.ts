/**
 * Agent 运行时上下文 —— 适配 openclaw AgentContext / createContextSnapshot 理念
 *
 * 来源：g:\AI\creative-cafe\sillytavern-source\openclaw-main\packages\agent-core\src\agent.ts
 *       （L487-L493 createContextSnapshot）
 *       + packages/agent-core/src/types.ts（AgentContext 接口）
 * 决策：适配（spec §三）。openclaw 通过 createContextSnapshot() 在每次 run 时
 *       生成不可变上下文快照，避免运行中状态被意外修改。本项目照搬其快照理念，
 *       扩展为本项目特有字段（characterId / mode / sessionId 等）。
 *
 * 职责：
 *  1. AgentRunContext：agentLoop 运行时的完整上下文（systemPrompt + messages + tools + context）
 *  2. createContextSnapshot：生成不可变快照（防止运行中状态被修改）
 *  3. AgentContextBuilder：流式构建上下文（支持链式调用 + 默认值填充）
 *
 * 设计约束（openclaw AGENTS.md）：
 *  - 上下文是 prompt：每次迭代携带已准备的事实，不在循环内重新发现
 *  - 快照不可变：运行中 tools / messages 不会被外部修改
 *  - 上下文分层：global（进程级配置）> run（单次运行）> tool（单次工具调用）
 */

import type {
  ToolCallContext,
  ToolDefinition,
} from '../contracts';
import type { ToolDescriptor } from '../tools/types';
import type { ModelCapabilities } from '../llm/capabilityDetector';

// ==================== AgentRunContext ====================

/**
 * Agent 运行时上下文（完整快照）。
 *
 * agentLoop.run() 入口接收 AgentRunIntent（用户意图），
 * 内部转换为 AgentRunContext（运行时快照），
 * 快照包含 LLM 调用所需的全部信息（systemPrompt + messages + tools + capabilities）。
 *
 * 参考 openclaw AgentContext：
 *  - systemPrompt: 系统提示词
 *  - messages: 对话历史（已清洗）
 *  - tools: 可用工具定义（OpenAI tools 格式）
 *  - 扩展字段：context（业务上下文）/ capabilities（模型能力）/ mode（模式）
 */
export interface AgentRunContext {
  /** 系统提示词（已由 promptBuilder 组装） */
  readonly systemPrompt: string;
  /** 对话历史（已清洗，不含 system 角色） */
  readonly messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  /** 可用工具定义（OpenAI tools 格式，注入请求体） */
  readonly tools: ReadonlyArray<ToolDefinition>;
  /** 工具描述符（含可用性、权限等元数据） */
  readonly toolDescriptors: ReadonlyArray<ToolDescriptor>;
  /** 业务上下文（sessionId / characterId / mode 等） */
  readonly context: Readonly<ToolCallContext>;
  /** 模型能力（决定是否启用 tool calling 等） */
  readonly capabilities: Readonly<ModelCapabilities>;
  /** 最大迭代次数 */
  readonly maxIterations: number;
  /** 超时毫秒 */
  readonly timeoutMs: number;
  /** 创建时间戳 */
  readonly createdAt: number;
}

// ==================== 上下文构建器 ====================

/**
 * Agent 上下文构建器选项。
 */
export interface AgentContextBuilderOptions {
  /** 默认最大迭代次数 */
  defaultMaxIterations?: number;
  /** 默认超时 */
  defaultTimeoutMs?: number;
}

/**
 * Agent 上下文构建器。
 *
 * 流式构建 AgentRunContext，支持链式调用与默认值填充。
 *
 * 用法：
 * ```ts
 * const ctx = new AgentContextBuilder({ defaultMaxIterations: 8 })
 *   .setSystemPrompt('You are a writer')
 *   .setMessages(history)
 *   .setTools(toolDefs, toolDescriptors)
 *   .setContext({ sessionId: 's1', mode: 'writing' })
 *   .setCapabilities(caps)
 *   .build();
 * ```
 */
export class AgentContextBuilder {
  private systemPrompt = '';
  private messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private tools: ToolDefinition[] = [];
  private toolDescriptors: ToolDescriptor[] = [];
  private context: ToolCallContext = {};
  private capabilities: ModelCapabilities = {
    supportsStopArray: false,
    supportsRepPen: false,
    supportsDrySampler: false,
    supportsVision: false,
    supportsThinking: false,
    supportsToolCalling: false,
  };
  private maxIterations: number;
  private timeoutMs: number;

  constructor(options: AgentContextBuilderOptions = {}) {
    this.maxIterations = options.defaultMaxIterations ?? 8;
    this.timeoutMs = options.defaultTimeoutMs ?? 300_000;
  }

  setSystemPrompt(prompt: string): this {
    this.systemPrompt = prompt;
    return this;
  }

  setMessages(messages: Array<{ role: 'user' | 'assistant'; content: string }>): this {
    this.messages = messages.slice();
    return this;
  }

  setTools(tools: ToolDefinition[], descriptors: ToolDescriptor[] = []): this {
    this.tools = tools.slice();
    this.toolDescriptors = descriptors.slice();
    return this;
  }

  setContext(context: ToolCallContext): this {
    this.context = { ...context };
    return this;
  }

  setCapabilities(caps: ModelCapabilities): this {
    this.capabilities = { ...caps };
    return this;
  }

  setMaxIterations(n: number): this {
    this.maxIterations = n;
    return this;
  }

  setTimeoutMs(ms: number): this {
    this.timeoutMs = ms;
    return this;
  }

  /**
   * 构建不可变快照。
   *
   * 返回的 AgentRunContext 所有数组/对象字段均为只读（ReadonlyArray/Readonly），
   * 防止 agentLoop 运行中外部修改导致状态不一致。
   */
  build(): AgentRunContext {
    return {
      systemPrompt: this.systemPrompt,
      messages: Object.freeze(this.messages.slice()),
      tools: Object.freeze(this.tools.slice()),
      toolDescriptors: Object.freeze(this.toolDescriptors.slice()),
      context: Object.freeze({ ...this.context }),
      capabilities: Object.freeze({ ...this.capabilities }),
      maxIterations: this.maxIterations,
      timeoutMs: this.timeoutMs,
      createdAt: Date.now(),
    };
  }
}

// ==================== 快照工具 ====================

/**
 * 从 AgentRunContext 派生工具调用上下文（ToolCallContext）。
 *
 * 工具执行时仅需 ToolCallContext（业务上下文），
 * 不需要完整的 systemPrompt / messages / tools。
 */
export function deriveToolCallContext(ctx: AgentRunContext): ToolCallContext {
  return {
    sessionId: ctx.context.sessionId,
    characterId: ctx.context.characterId,
    mode: ctx.context.mode,
    userId: ctx.context.userId,
  };
}

/**
 * 判断当前上下文是否启用工具调用。
 *
 * 双条件：模型支持 + 有可用工具。
 * 用于 agentLoop 决定是否在请求中注入 tools 字段。
 */
export function isToolCallingEnabled(ctx: AgentRunContext): boolean {
  return ctx.capabilities.supportsToolCalling === true && ctx.tools.length > 0;
}
