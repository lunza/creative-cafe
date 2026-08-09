// 角色卡对话状态管理 Reducer
//
// 将 useCharacterDialogueChat hook 中分散的 setState 调用收敛为统一的 reducer 模式，
// 降低异步回调中状态管理的复杂度，预留 tokenUsage 状态字段。

import type { ChatMessage } from './CharacterDialogueChat.types';

// ==================== Reducer State ====================

/**
 * 对话 Reducer 状态（现有 ChatState 的超集）。
 *
 * - tokenUsage：token 用量信息，为 Task 11 上下文窗口守卫预留
 *
 * 注意：CharacterDialogueChat.types.ts 中的 ChatState 接口保留不动（其他地方可能引用），
 * 此处 ChatReducerState 是独立的超集类型。
 */
export interface ChatReducerState {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  // 新增字段（为后续 Task 预留）
  tokenUsage: { used: number; total: number } | null;
}

// ==================== ChatAction 联合类型 ====================

/**
 * 对话状态变更 Action 联合类型。
 *
 * 设计原则：
 * - 每个 action 对应一种语义明确的状态变更，避免一个 action 做过多事情
 * - STREAM_ERROR 的 error 支持 null，用于"设置错误消息内容但不设置全局 error"的场景
 *   （如无引擎配置、空回复等非流式错误）
 */
export type ChatAction =
  | { type: 'SEND_MESSAGE'; messages: ChatMessage[] }
  | { type: 'STREAM_CHUNK'; targetMessageId: string; content: string }
  | { type: 'STREAM_COMPLETE'; messages: ChatMessage[] }
  | { type: 'STREAM_ERROR'; targetMessageId: string; content: string; error: string | null }
  | { type: 'SET_LOADING'; isLoading: boolean; isStreaming: boolean }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'CLEAR_ERROR' }
  | { type: 'UPDATE_MESSAGES'; messages: ChatMessage[] }
  | { type: 'SET_TOKEN_USAGE'; usage: { used: number; total: number } | null };

// ==================== 初始状态 ====================

export const initialChatState: ChatReducerState = {
  messages: [],
  isLoading: false,
  isStreaming: false,
  error: null,
  tokenUsage: null,
};

// ==================== Reducer 函数 ====================

/**
 * 对话状态 Reducer。
 *
 * 纯函数：相同输入始终产生相同输出，无副作用。
 * 所有异步操作（保存聊天记录、触发重试等）在 dispatch 调用前完成。
 */
export function chatReducer(state: ChatReducerState, action: ChatAction): ChatReducerState {
  switch (action.type) {
    case 'SEND_MESSAGE':
      // 发送消息：替换消息列表，进入加载+流式状态，清除错误
      return { ...state, messages: action.messages, isLoading: true, isStreaming: true, error: null };

    case 'STREAM_CHUNK':
      // 流式 chunk 更新：更新目标消息内容和状态为 sending
      return {
        ...state,
        messages: state.messages.map(msg =>
          msg.id === action.targetMessageId
            ? { ...msg, content: action.content, status: 'sending' as const }
            : msg
        ),
      };

    case 'STREAM_COMPLETE':
      // 流式完成：替换消息列表（含最终内容），退出加载+流式状态
      return { ...state, messages: action.messages, isLoading: false, isStreaming: false };

    case 'STREAM_ERROR':
      // 流式错误：更新目标消息内容为错误状态，退出加载+流式状态，设置全局 error
      // error 为 null 时不设置全局 error（用于无引擎/空回复等非流式错误场景）
      return {
        ...state,
        messages: state.messages.map(msg =>
          msg.id === action.targetMessageId
            ? { ...msg, content: action.content, status: 'error' as const }
            : msg
        ),
        isLoading: false,
        isStreaming: false,
        error: action.error,
      };

    case 'SET_LOADING':
      // 仅更新加载/流式状态（不改变消息和 error）
      return { ...state, isLoading: action.isLoading, isStreaming: action.isStreaming };

    case 'CLEAR_MESSAGES':
      // 清空对话：消息清空，退出加载+流式状态，清除错误
      return { ...state, messages: [], isLoading: false, isStreaming: false, error: null };

    case 'CLEAR_ERROR':
      // 清除错误状态
      return { ...state, error: null };

    case 'UPDATE_MESSAGES':
      // 仅更新消息列表（不改变 loading/streaming/error）
      return { ...state, messages: action.messages };

    case 'SET_TOKEN_USAGE':
      // Token 用量更新（为 Task 11 预留）
      return { ...state, tokenUsage: action.usage };

    default:
      return state;
  }
}
