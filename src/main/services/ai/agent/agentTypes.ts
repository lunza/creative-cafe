/**
 * 智能体引擎核心类型定义
 *
 * 工具调用智能体引擎（方向 0）的类型基础。
 * 供 toolRegistry / toolProtocolAdapter / agentLoop 共用。
 */

import type { ChatMessage } from '../../AIService';

/** 工具组（按模式分组） */
// 'foundation' = 技能库与记忆系统基础工具组（invokeSkill/searchMemories/recordMemory/discoverSkills）
export type AgentToolGroup = 'dialogue' | 'writing' | 'worldbook' | 'foundation';

/** 工具执行上下文（传递角色卡ID/项目ID/会话ID等，供工具定位数据） */
export interface AgentToolContext {
  characterId?: string;
  projectId?: string;
  chatId?: string;
  [key: string]: any;
}

/** 工具执行结果 */
export interface ToolCallResult {
  success: boolean;
  data?: any;
  error?: string;
}

/** 工具定义 */
export interface AgentTool {
  name: string;
  description: string;
  /** JSONSchema 参数定义 */
  parameters: Record<string, any>;
  /** 工具执行器 */
  handler: (args: Record<string, any>, context?: AgentToolContext) => Promise<ToolCallResult>;
}

/** 模型发起的工具调用（统一内部格式） */
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, any>;
  raw?: any;
}

/** 工具调用事件（推送给前端，可观测性） */
export interface ToolCallEvent {
  iteration: number;
  toolName: string;
  arguments: Record<string, any>;
  result: ToolCallResult;
  durationMs: number;
}

/** agentLoop 最终结果 */
export interface AgentLoopResult {
  finalContent: string;
  toolCallHistory: ToolCallEvent[];
  iterations: number;
  stoppedReason: 'completed' | 'max_iterations' | 'aborted' | 'error';
  error?: string;
}

/** 回调 */
export interface AgentLoopCallbacks {
  onToolCall?: (event: ToolCallEvent) => void;
  onFinalChunk?: (chunk: string) => void;
  onIteration?: (iteration: number) => void;
  /** Agent 轮次完成后触发（供学习服务记录经验，可选；不传则零影响） */
  onTurnComplete?: (result: AgentLoopResult, context?: AgentToolContext) => void;
}

/** agentLoop 运行选项 */
export interface AgentLoopOptions {
  model: string;
  temperature: number;
  maxTokens: number;
  maxIterations?: number; // 默认 8
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  abortSignal?: AbortSignal;
  /** 引擎是否支持工具调用；false 时降级为纯文本 */
  supportsToolCalling?: boolean;
  /** 降级/最终回复是否流式 */
  streamFinal?: boolean;
}

/** agentLoop 入参 */
export interface AgentLoopParams {
  messages: ChatMessage[];
  toolGroups: AgentToolGroup[];
  context?: AgentToolContext;
  options: AgentLoopOptions;
  callbacks?: AgentLoopCallbacks;
}
