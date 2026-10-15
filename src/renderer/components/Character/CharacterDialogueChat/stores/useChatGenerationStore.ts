/**
 * 对话模式生成状态 Store（zustand 单一真相源）
 *
 * Spec: conversation-mode-optimization-report / Phase 1 / H2 + H3
 *
 * 迁移背景：
 * - 原 useCharacterDialogueChat hook 用 useReducer(chatReducer) 管理消息/流式状态，
 *   与 characterChatStore（持久化）构成消息双真相源（F2），流式中断时可能漂移。
 * - 本 store 将消息/流式状态收敛为 zustand 单一真相源：内存中的消息以本 store 为准，
 *   characterChatStore 仅作为持久化投影（由 saveChatToStore 同步），消除双真相源。
 * - chatReducer 纯函数保留为本 store 的状态迁移函数（可单测），useReducer 从 hook 中移除。
 */

import { create } from 'zustand';
import { chatReducer, initialChatState, ChatAction, ChatReducerState } from '../chatReducer';
import type { ChatMessage } from '../CharacterDialogueChat.types';

export interface ChatGenerationStoreState extends ChatReducerState {
  /**
   * 状态迁移入口：与旧 useReducer 的 dispatch 签名完全一致，
   * 调用方无需改动即可从 useReducer 平滑迁移到本 store。
   */
  dispatch: (action: ChatAction) => void;
  /** 重置为初始状态（对话框关闭/切换角色时调用） */
  reset: () => void;
}

export const useChatGenerationStore = create<ChatGenerationStoreState>((set) => ({
  ...initialChatState,
  dispatch: (action) =>
    set((state) => chatReducer(state as ChatReducerState, action)),
  reset: () => set({ ...initialChatState }),
}));

/** 非 React 上下文（IPC 回调 / 工具函数）读取最新消息 */
export function getChatMessages(): ChatMessage[] {
  return useChatGenerationStore.getState().messages;
}
