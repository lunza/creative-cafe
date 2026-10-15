/**
 * 对话模式会话 Store（对齐 V2 useV2ProjectStore 范式）
 *
 * Spec: conversation-mode-optimization-report / Phase 1 / H2
 *
 * 收纳原先散落在 useCharacterConfig / usePersonas hook 中的会话级状态：
 * - config：角色对话配置（原 useState + configRef 双轨，改为 store 单一来源，
 *   非 React 上下文通过 getState() 读取最新值，彻底消除闭包陈旧问题）
 * - personas：用户人设列表（原 usePersonas 的 useState + loading）
 *
 * 会话生命周期：对话框打开时 initSession(characterCardId)，关闭时 endSession()。
 */

import { create } from 'zustand';
import type { UserPersona } from '../CharacterDialogueChat.types';

export interface ChatSessionStoreState {
  /** 当前会话对应的角色卡 ID（同一时间仅一个对话窗口打开） */
  activeCharacterCardId: string | null;
  /**
   * 角色对话配置（localStorage 持久化的内存投影）。
   * 【Phase 1 / H2】保持 any：配置由 JSON.parse 产生且字段异构（20+ 字段，
   * 如 customParameters 下的 assist_mode/min_response_chars 等），与迁移前
   * useState 推断类型一致，避免 spread 后丢失索引签名引入新类型错误。
   */
  config: any;
  /** 用户人设列表 */
  personas: UserPersona[];
  /** 人设加载中标志 */
  personasLoading: boolean;

  initSession: (characterCardId: string) => void;
  setConfig: (config: any) => void;
  setPersonas: (personas: UserPersona[]) => void;
  setPersonasLoading: (loading: boolean) => void;
  endSession: () => void;
}

export const useChatSessionStore = create<ChatSessionStoreState>((set) => ({
  activeCharacterCardId: null,
  config: null,
  personas: [],
  personasLoading: true,

  initSession: (characterCardId) => set({ activeCharacterCardId: characterCardId }),
  setConfig: (config) => set({ config }),
  setPersonas: (personas) => set({ personas }),
  setPersonasLoading: (personasLoading) => set({ personasLoading }),
  endSession: () =>
    set({
      activeCharacterCardId: null,
      config: null,
      personas: [],
      personasLoading: true,
    }),
}));
