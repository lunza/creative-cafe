/**
 * LLM 提供方适配器 —— 包装现有 AIService 实现 ILLMProvider 接口
 *
 * 来源：spec §二 Task 6.1（llmProvider.ts + AIServiceAdapter）
 * 决策：适配（spec §三）。openclaw 的 llm/stream.ts 抽象理念照搬，对接项目 AIService
 *       （已 OpenAI 兼容）。不推倒重来，通过 adapter 桥接（spec §5.1 双轨并行）。
 *
 * 职责：
 *  1. AIServiceAdapter：将 AIService.streamChatAPI 适配为 ILLMProvider.streamChat
 *  2. 屏蔽 OpenAI/Anthropic/本地模型差异（AIService 已处理）
 *  3. 复用 AIService 的重试/超时/错误分类（不重复造轮子）
 *  4. 工具调用全链路：tools → 请求体 → 流式 tool_calls 解析 → StreamChatResult
 *
 * 设计约束：
 *  - 不修改 AIService 源码（降级保护：底座异常时 AIService 仍可独立使用）
 *  - 流式 onChunk 回调透传给调用方（agentLoop 可边生成边推送 UI）
 */

import { AIService, type ChatMessage, type ToolDefinition } from '../../AIService';
import type { StreamChunkCallback } from '../../ai/SSEStreamParser';
import type {
  ILLMProvider,
  StreamChatRequest,
  StreamChatResult,
} from '../contracts';
import type { ToolCall } from '../contracts';
import { toAgentError } from '../infra/errors';

// ==================== AIServiceAdapter ====================

/**
 * AIService 适配器，实现 ILLMProvider 接口。
 *
 * 将现有 AIService.streamChatAPI（回调式流式）适配为 ILLMProvider.streamChat（Promise 式）。
 * agentLoop 通过此适配器调用 LLM，无需直接依赖 AIService 具体实现。
 */
export class AIServiceAdapter implements ILLMProvider {
  constructor(
    private readonly aiService: AIService,
    /** 可选的流式 chunk 回调（agentLoop 用于边生成边推送 UI） */
    private readonly onStreamChunk?: StreamChunkCallback
  ) {}

  /**
   * 流式聊天（支持工具调用）。
   *
   * 将 StreamChatRequest 转换为 AIService.streamChatAPI 的参数格式：
   *  - systemPrompt → 合并到 messages[0]（AIService.enrichSystemPrompt 处理）
   *  - messages → ChatMessage[] 格式
   *  - tools/parallelToolCalls → 透传（F1 修复后全链路打通）
   *  - temperature/maxTokens → 透传
   *
   * 返回 StreamChatResult，包含 content / toolCalls / finishReason / usage。
   */
  async streamChat(request: StreamChatRequest): Promise<StreamChatResult> {
    try {
      // 构建 AIService 格式的 messages（systemPrompt 作为首条 system 消息）
      const messages: ChatMessage[] = [
        { role: 'system', content: request.systemPrompt },
        ...request.messages.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
      ];

      // 调用 AIService.streamChatAPI（复用其重试/超时/错误分类）
      const response = await this.aiService.streamChatAPI(
        messages,
        {
          model: request.modelName,
          temperature: request.temperature ?? 0.8,
          maxTokens: request.maxTokens ?? 4096,
          tools: request.tools as ToolDefinition[] | undefined,
          parallelToolCalls: request.parallelToolCalls,
          supportsToolCalling: request.tools && request.tools.length > 0,
        },
        this.onStreamChunk ?? (() => {})
      );

      // 转换为 StreamChatResult
      return {
        content: response.content,
        toolCalls: response.toolCalls as ToolCall[] | undefined,
        finishReason: response.finishReason,
        usage: undefined, // AIService.streamChatAPI 当前未返回 usage，后续可扩展
      };
    } catch (err) {
      // 规范化为 AgentError，保留原始 cause
      throw toAgentError(err, 'AIServiceAdapter.streamChat failed');
    }
  }

  /**
   * 探测模型能力（复用 AIService.probeAllCapabilities，F1 修复后结果真正生效）。
   */
  async probeCapabilities(config: {
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
  }> {
    return this.aiService.probeAllCapabilities(config);
  }
}

// ==================== 工厂函数 ====================

/**
 * 创建默认的 AIServiceAdapter 实例。
 *
 * 使用 AIService 单例，不传 onStreamChunk（非流式场景）。
 * agentLoop 如需流式推送 UI，应直接 new AIServiceAdapter(aiService, onChunk)。
 */
export function createDefaultLLMProvider(
  aiService?: AIService,
  onStreamChunk?: StreamChunkCallback
): ILLMProvider {
  const service = aiService ?? new AIService();
  return new AIServiceAdapter(service, onStreamChunk);
}
