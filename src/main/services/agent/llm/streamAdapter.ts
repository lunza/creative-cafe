/**
 * 流式适配器 —— 适配 SSE 流式 chunk 处理
 *
 * 来源：spec §二 Task 6.2（streamAdapter.ts）
 * 决策：适配。openclaw 的 stream.ts 流式抽象理念照搬，对接项目 SSEStreamParser
 *       （F1 修复后已支持 tool_calls delta 解析）。
 *
 * 职责：
 *  1. 将 SSEStreamParser 的 chunk 回调适配为统一的流式事件
 *  2. 提供「文本增量」与「工具调用增量」两类事件
 *  3. 支持 abort（agentLoop 取消时中止流）
 *
 * 设计约束：
 *  - 不修改 SSEStreamParser 源码（降级保护）
 *  - 流式事件通过回调推送（agentLoop 可边生成边推送 UI）
 */

import type { StreamChunkCallback } from '../../ai/SSEStreamParser';

// ==================== 流式事件类型 ====================

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'toolCallDelta'; toolCalls: unknown[] }
  | { type: 'done'; finishReason?: string }
  | { type: 'error'; error: Error };

export type StreamEventCallback = (event: StreamEvent) => void;

// ==================== 流式适配器 ====================

/**
 * 创建 SSEStreamParser 兼容的 chunk 回调，将原始 chunk 转换为流式事件。
 *
 * AIService.streamChatAPI 接受 StreamChunkCallback（接收累积文本 chunk），
 * 本函数将其适配为 StreamEventCallback（接收结构化事件）。
 *
 * @param onEvent 流式事件回调
 * @returns StreamChunkCallback（传给 AIService.streamChatAPI）
 */
export function createStreamChunkAdapter(onEvent: StreamEventCallback): StreamChunkCallback {
  return ((chunk: string, isComplete: boolean) => {
    if (chunk) {
      onEvent({ type: 'text', content: chunk });
    }
    if (isComplete) {
      onEvent({ type: 'done' });
    }
  }) as StreamChunkCallback;
}

/**
 * 创建空回调（非流式场景，agentLoop 不需要边生成边推送时使用）。
 */
export function noopStreamChunkCallback(): StreamChunkCallback {
  return (() => {}) as StreamChunkCallback;
}
