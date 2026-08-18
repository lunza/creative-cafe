import { create } from 'zustand';
import { genTraitId } from '@shared/types';
import type { CharacterTraitItem } from '@shared/types';
// 【Spec: enhance-conversation-image-auditability / Task 7】
// updateSessionTrait / addSessionTrait 在 sessionTraits 未初始化时，
// 需要从 characterTraitStore.traits 深拷贝初始化（lazy initialization）。
// 采用动态 import 避免循环依赖风险（characterTraitStore 不依赖本 store，但保持解耦）。
import { useCharacterTraitStore } from './characterTraitStore';

// 聊天消息接口
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  suggestedOptions?: string[];
  emotion?: string;
}

// 角色卡测试对话
interface CharacterTestChat {
  id: string;
  creativeId: string;
  characterCardId: string;
  characterCardName: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  /**
   * 当前对话的临时特征覆盖。
   * Spec: enhance-conversation-image-auditability / Task 1.2
   * 不写入角色卡 manifest（仅随对话持久化），存在时 executeImageGeneration 优先从此读取，
   * 而非 characterTraitStore.traits。用于支持 ConfigPanel 在会话内即时编辑特征组合，
   * 不影响角色卡原始 manifest 数据。未设置时回退到角色卡 traits。
   */
  sessionTraits?: CharacterTraitItem[];
}

interface CharacterChatStore {
  // 测试对话
  testChats: CharacterTestChat[];
  // 加载状态
  isLoading: boolean;
  // 当前选中的对话
  currentTestChat: CharacterTestChat | null;

  // 加载所有对话
  loadAllChats: () => Promise<void>;

  // 测试对话操作
  loadTestChat: (creativeId: string, characterCardId: string) => Promise<void>;
  saveTestChat: (creativeId: string, characterCardId: string, characterCardName: string, messages: ChatMessage[]) => Promise<void>;
  deleteTestChat: (creativeId: string, characterCardId: string) => Promise<void>;

  // 辅助方法
  setCurrentTestChat: (chat: CharacterTestChat | null) => void;
  addTestMessage: (creativeId: string, characterCardId: string, characterCardName: string, message: ChatMessage) => Promise<void>;

  // ===== Spec: enhance-conversation-image-auditability / Task 7.3-7.7 =====
  // 会话级临时特征（sessionTraits）actions：
  // - sessionTraits 是 currentTestChat 上的对话级字段，不写入角色卡 manifest
  // - 所有 actions 均通过 saveTestChat 持久化（先更新 currentTestChat.sessionTraits，再调 saveTestChat）
  // - 深拷贝入参，避免与 characterTraitStore.traits 共享引用

  /**
   * 设置当前对话的 sessionTraits（深拷贝入参）。
   * - 用于「另存为临时方案」/ 全量替换场景
   * - 深拷贝避免外部引用后续变更污染 sessionTraits
   * - 触发 saveTestChat 持久化
   */
  setSessionTraits: (traits: CharacterTraitItem[]) => Promise<void>;

  /**
   * 重置当前对话的 sessionTraits 为 undefined。
   * - 用于「恢复为角色卡特征」场景
   * - 触发 saveTestChat 持久化（IPC 透传 undefined，主进程省略字段）
   */
  resetSessionTraits: () => Promise<void>;

  /**
   * 更新 sessionTraits 中指定 id 的单个 trait（合并 updates）。
   * - 若 sessionTraits 不存在，先从 characterTraitStore.traits 深拷贝初始化（lazy init）
   * - 找不到对应 id 时静默 no-op（仅记录 warn 日志）
   * - 触发 saveTestChat 持久化
   */
  updateSessionTrait: (traitId: string, updates: Partial<CharacterTraitItem>) => Promise<void>;

  /**
   * 向 sessionTraits 追加新特征。
   * - 若 sessionTraits 不存在，先从 characterTraitStore.traits 深拷贝初始化（lazy init）
   * - 使用 genTraitId() 生成新 id，enabled 默认 true，weight 默认 1.0
   * - 触发 saveTestChat 持久化
   */
  addSessionTrait: (categoryId: string, text: string) => Promise<void>;

  /**
   * 从 sessionTraits 移除指定 id 的 trait。
   * - 若 sessionTraits 不存在，no-op
   * - 触发 saveTestChat 持久化
   */
  removeSessionTrait: (traitId: string) => Promise<void>;
}

export const useCharacterChatStore = create<CharacterChatStore>((set, get) => ({
  testChats: [],
  isLoading: false,
  currentTestChat: null,

  // 加载所有对话
  loadAllChats: async () => {
    set({ isLoading: true });
    try {
      if (window.electronAPI && window.electronAPI.characterChat) {
        const testChats = await window.electronAPI.characterChat.getAllTestChats();
        set({ testChats, isLoading: false });
      }
    } catch (error) {
      console.error('[CharacterChatStore] Failed to load all chats:', error);
      set({ isLoading: false });
    }
  },

  // 测试对话操作
  loadTestChat: async (creativeId: string, characterCardId: string) => {
    set({ isLoading: true });
    try {
      if (window.electronAPI && window.electronAPI.characterChat) {
        const chat = await window.electronAPI.characterChat.getTestChat(creativeId, characterCardId);
        if (chat) {
          // 安全转换消息内容
          chat.messages = chat.messages.map(msg => ({
            ...msg,
            content: String(msg.content || '')
          }));

          // 【Spec: enhance-conversation-image-auditability / Task 7.8】
          // 安全映射 sessionTraits：每个 trait 浅拷贝为新对象，避免与主进程缓存或
          // characterTraitStore 共享引用（主进程 getTestChat 已做同样映射，此处为双保险）。
          // undefined / 非数组时显式置为 undefined，确保回退到角色卡 traits。
          // 注意：先用局部变量承载 chat.sessionTraits，使 Array.isArray 的类型收窄
          // （any → any[]）能保持到 .map 调用（直接在 any 基对象的属性上收窄不会保持）。
          const loadedSessionTraits = chat.sessionTraits;
          if (Array.isArray(loadedSessionTraits)) {
            chat.sessionTraits = loadedSessionTraits.map(t => ({ ...t }));
          } else {
            chat.sessionTraits = undefined;
          }

          set((state) => {
            // 更新或添加到列表
            const exists = state.testChats.some(c => c.id === chat.id);
            const newTestChats = exists
              ? state.testChats.map(c => c.id === chat.id ? chat : c)
              : [...state.testChats, chat];

            return {
              testChats: newTestChats,
              currentTestChat: chat,
              isLoading: false
            };
          });
        } else {
          // 如果不存在，设置为 null
          set({ currentTestChat: null, isLoading: false });
        }
      }
    } catch (error) {
      console.error('[CharacterChatStore] Failed to load test chat:', error);
      set({ currentTestChat: null, isLoading: false });
    }
  },

  saveTestChat: async (creativeId: string, characterCardId: string, characterCardName: string, messages: ChatMessage[]) => {
    try {
      if (window.electronAPI && window.electronAPI.characterChat) {
        // 安全转换消息内容 - 避免循环引用导致 Maximum call stack size exceeded
        const safeMessages = messages.map(msg => {
          // 只提取纯数据字段，避免 React 对象或循环引用
          const cleanMsg = {
            id: String(msg.id || ''),
            role: String(msg.role || ''),
            content: String(msg.content || ''),
            timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
            status: String(msg.status || 'sent'),
            speakerName: msg.speakerName ? String(msg.speakerName) : undefined,
            speakerAvatar: msg.speakerAvatar ? String(msg.speakerAvatar) : undefined,
            // 保存辅助模式推荐选项，使刷新/重启后仍可展示（Spec: add-assist-mode-options）
            suggestedOptions: Array.isArray(msg.suggestedOptions) ? msg.suggestedOptions.filter((s: any) => typeof s === 'string') : undefined,
            emotion: msg.emotion ? String(msg.emotion) : undefined,
            // 【Bug 4 修复】图片消息字段透传（Spec: fix-conversation-image-generation-bugs）
            generatedImage: msg.generatedImage ? String(msg.generatedImage) : undefined,
            isImageMessage: msg.isImageMessage === true ? true : undefined,
            // 图片附属内容透传（Spec: enhance-conversation-image-bubble / Task 1）
            // 取代独立图片消息，作为父文本消息的嵌套字段持久化
            imageAttachment: msg.imageAttachment,
          };

          // 使用 JSON 序列化来检测循环引用
          try {
            JSON.stringify(cleanMsg);
          } catch (error) {
            console.warn('[characterChatStore] Detected circular reference in message, cleaning:', error);
            // 如果仍有循环引用，只保留最基本字段
            return {
              id: cleanMsg.id,
              role: cleanMsg.role,
              content: cleanMsg.content,
              timestamp: cleanMsg.timestamp,
              status: cleanMsg.status,
              generatedImage: cleanMsg.generatedImage,
              isImageMessage: cleanMsg.isImageMessage,
              // 图片附属内容透传（Spec: enhance-conversation-image-bubble / Task 1）
              imageAttachment: cleanMsg.imageAttachment,
            };
          }

          return cleanMsg;
        });

        // 【Spec: enhance-conversation-image-auditability / Task 7.2】
        // sessionTraits 是对话级字段（不在 messages 内），从 currentTestChat 读取后透传给 IPC。
        // 仅当 currentTestChat 匹配当前保存的 creativeId/characterCardId 时才读取，
        // 避免在跨对话保存场景下串用其他对话的 sessionTraits。
        // 注意：setSessionTraits / resetSessionTrait 等新 action 会在调用 saveTestChat 之前
        // 先更新 currentTestChat.sessionTraits，因此此处能读到最新值。
        const current = get().currentTestChat;
        const sessionTraitsMatchesCurrent =
          current &&
          current.creativeId === creativeId &&
          current.characterCardId === characterCardId;
        const sessionTraitsToSave = sessionTraitsMatchesCurrent
          ? current!.sessionTraits
          : undefined;

        const chat = await window.electronAPI.characterChat.saveTestChat(
          creativeId,
          characterCardId,
          characterCardName,
          safeMessages,
          // 第 5 个参数：sessionTraits（undefined 表示重置，数组表示替换）
          sessionTraitsToSave
        );

        if (chat) {
          // 安全转换返回的消息内容
          chat.messages = chat.messages.map(msg => ({
            ...msg,
            content: String(msg.content || '')
          }));

          // 同步安全映射 sessionTraits（与 loadTestChat 保持一致）
          const savedSessionTraits = chat.sessionTraits;
          if (Array.isArray(savedSessionTraits)) {
            chat.sessionTraits = savedSessionTraits.map(t => ({ ...t }));
          } else {
            chat.sessionTraits = undefined;
          }

          set((state) => {
            const exists = state.testChats.some(c => c.id === chat.id);
            const newTestChats = exists
              ? state.testChats.map(c => c.id === chat.id ? chat : c)
              : [...state.testChats, chat];

            // 只有当前正在查看这个对话时（或 currentTestChat 尚未初始化时）才更新 currentTestChat。
            // 【Bug 修复】原逻辑 `state.currentTestChat && ...` 在 currentTestChat 为 null 时
            // updateCurrent 恒为 falsy，导致 currentTestChat 永远无法从 null 初始化，
            // 进而使 sessionTraits 相关 action（setSessionTraits / updateSessionTrait /
            // addSessionTrait 等）因 `if (!current) return` 静默 no-op，
            // 表现为「右侧角色特征分类选择框不生效 + 新增 tag 按钮不生效」。
            // 修复：currentTestChat 为 null 时也更新（null 表示尚未加载任何对话，
            // 而 saveTestChat 一定来自当前正在查看的角色卡，初始化是安全的）。
            const updateCurrent =
              !state.currentTestChat ||
              (state.currentTestChat.creativeId === creativeId &&
               state.currentTestChat.characterCardId === characterCardId);

            return {
              testChats: newTestChats,
              currentTestChat: updateCurrent ? chat : state.currentTestChat
            };
          });
        }
      }
    } catch (error) {
      console.error('[CharacterChatStore] Failed to save test chat:', error);
    }
  },

  deleteTestChat: async (creativeId: string, characterCardId: string) => {
    try {
      if (window.electronAPI && window.electronAPI.characterChat) {
        await window.electronAPI.characterChat.deleteTestChat(creativeId, characterCardId);
        set((state) => {
          const newTestChats = state.testChats.filter(
            c => !(c.creativeId === creativeId && c.characterCardId === characterCardId)
          );
          const shouldClearCurrent = 
            state.currentTestChat && 
            state.currentTestChat.creativeId === creativeId && 
            state.currentTestChat.characterCardId === characterCardId;
            
          return {
            testChats: newTestChats,
            currentTestChat: shouldClearCurrent ? null : state.currentTestChat
          };
        });
      }
    } catch (error) {
      console.error('[CharacterChatStore] Failed to delete test chat:', error);
    }
  },

  // 辅助方法
  setCurrentTestChat: (chat: CharacterTestChat | null) => {
    set({ currentTestChat: chat });
  },

  addTestMessage: async (creativeId: string, characterCardId: string, characterCardName: string, message: ChatMessage) => {
    const current = get().currentTestChat;
    let messages: ChatMessage[] = [];
    if (current && current.creativeId === creativeId && current.characterCardId === characterCardId) {
      messages = [...current.messages, message];
    } else {
      messages = [message];
    }
    await get().saveTestChat(creativeId, characterCardId, characterCardName, messages);
  },

  // ===== Spec: enhance-conversation-image-auditability / Task 7.3-7.7 =====
  // sessionTraits actions 实现
  //
  // 通用约定：
  // - 所有 actions 先检查 currentTestChat 是否存在，不存在时静默 no-op（仅 warn 日志）
  // - 深拷贝使用 JSON.parse(JSON.stringify(obj))，与代码库现有模式一致
  //   （characterTraitStore.saveCombination 用 { ...t } 浅拷贝，但 sessionTraits 需要
  //    完全隔离于 characterTraitStore.traits，浅拷贝不足以切断嵌套引用，故用深拷贝）
  // - 所有 actions 通过 saveTestChat 持久化（saveTestChat 内部从 currentTestChat 读取
  //   sessionTraits 并透传给 IPC，因此 actions 必须先更新 currentTestChat.sessionTraits）
  // - 不调用 characterTraitStore.saveTraits（sessionTraits 是对话级，不写 manifest）

  setSessionTraits: async (traits: CharacterTraitItem[]) => {
    const current = get().currentTestChat;
    if (!current) {
      console.warn('[characterChatStore] setSessionTraits: currentTestChat 为空，跳过');
      return;
    }
    try {
      // 深拷贝入参，避免外部引用后续变更污染 sessionTraits
      const deepCopy: CharacterTraitItem[] = JSON.parse(JSON.stringify(traits));
      set((state) => {
        if (!state.currentTestChat) return {};
        const updatedChat: CharacterTestChat = {
          ...state.currentTestChat,
          sessionTraits: deepCopy,
        };
        const newTestChats = state.testChats.map(c =>
          c.id === updatedChat.id ? updatedChat : c
        );
        return {
          currentTestChat: updatedChat,
          testChats: newTestChats,
        };
      });
      await get().saveTestChat(
        current.creativeId,
        current.characterCardId,
        current.characterCardName,
        current.messages
      );
    } catch (error) {
      console.error('[characterChatStore] setSessionTraits failed:', error);
    }
  },

  resetSessionTraits: async () => {
    const current = get().currentTestChat;
    if (!current) {
      console.warn('[characterChatStore] resetSessionTraits: currentTestChat 为空，跳过');
      return;
    }
    try {
      set((state) => {
        if (!state.currentTestChat) return {};
        const updatedChat: CharacterTestChat = {
          ...state.currentTestChat,
          sessionTraits: undefined,
        };
        const newTestChats = state.testChats.map(c =>
          c.id === updatedChat.id ? updatedChat : c
        );
        return {
          currentTestChat: updatedChat,
          testChats: newTestChats,
        };
      });
      await get().saveTestChat(
        current.creativeId,
        current.characterCardId,
        current.characterCardName,
        current.messages
      );
    } catch (error) {
      console.error('[characterChatStore] resetSessionTraits failed:', error);
    }
  },

  updateSessionTrait: async (traitId: string, updates: Partial<CharacterTraitItem>) => {
    const current = get().currentTestChat;
    if (!current) {
      console.warn('[characterChatStore] updateSessionTrait: currentTestChat 为空，跳过');
      return;
    }
    try {
      // lazy initialization：sessionTraits 不存在时从 characterTraitStore.traits 深拷贝初始化。
      // 使用 ?? + 显式类型标注，避免 let + 条件赋值导致 TS 无法收窄 undefined。
      // 总是深拷贝：既隔离 characterTraitStore.traits，也避免直接引用 current.sessionTraits
      // 的内部对象（后续 .map 创建新数组，但未更新项的 trait 对象仍共享引用，深拷贝消除该风险）。
      const sourceTraits = current.sessionTraits ?? useCharacterTraitStore.getState().traits;
      const baseTraits: CharacterTraitItem[] = JSON.parse(JSON.stringify(sourceTraits));

      const idx = baseTraits.findIndex(t => t.id === traitId);
      if (idx === -1) {
        console.warn(`[characterChatStore] updateSessionTrait: traitId ${traitId} 不存在于 sessionTraits，跳过`);
        return;
      }

      // 合并 updates（浅合并即可，Partial<CharacterTraitItem> 是扁平结构）
      const newTraits = baseTraits.map(t =>
        t.id === traitId ? { ...t, ...updates } : t
      );

      set((state) => {
        if (!state.currentTestChat) return {};
        const updatedChat: CharacterTestChat = {
          ...state.currentTestChat,
          sessionTraits: newTraits,
        };
        const newTestChats = state.testChats.map(c =>
          c.id === updatedChat.id ? updatedChat : c
        );
        return {
          currentTestChat: updatedChat,
          testChats: newTestChats,
        };
      });
      await get().saveTestChat(
        current.creativeId,
        current.characterCardId,
        current.characterCardName,
        current.messages
      );
    } catch (error) {
      console.error('[characterChatStore] updateSessionTrait failed:', error);
    }
  },

  addSessionTrait: async (categoryId: string, text: string) => {
    const current = get().currentTestChat;
    if (!current) {
      console.warn('[characterChatStore] addSessionTrait: currentTestChat 为空，跳过');
      return;
    }
    try {
      // lazy initialization：sessionTraits 不存在时从 characterTraitStore.traits 深拷贝初始化。
      // 使用 ?? + 显式类型标注，避免 let + 条件赋值导致 TS 无法收窄 undefined。
      const sourceTraits = current.sessionTraits ?? useCharacterTraitStore.getState().traits;
      const baseTraits: CharacterTraitItem[] = JSON.parse(JSON.stringify(sourceTraits));

      const newTrait: CharacterTraitItem = {
        id: genTraitId(),
        text,
        categoryId,
        enabled: true,
        weight: 1.0,
      };
      const newTraits = [...baseTraits, newTrait];

      set((state) => {
        if (!state.currentTestChat) return {};
        const updatedChat: CharacterTestChat = {
          ...state.currentTestChat,
          sessionTraits: newTraits,
        };
        const newTestChats = state.testChats.map(c =>
          c.id === updatedChat.id ? updatedChat : c
        );
        return {
          currentTestChat: updatedChat,
          testChats: newTestChats,
        };
      });
      await get().saveTestChat(
        current.creativeId,
        current.characterCardId,
        current.characterCardName,
        current.messages
      );
    } catch (error) {
      console.error('[characterChatStore] addSessionTrait failed:', error);
    }
  },

  removeSessionTrait: async (traitId: string) => {
    const current = get().currentTestChat;
    if (!current) {
      console.warn('[characterChatStore] removeSessionTrait: currentTestChat 为空，跳过');
      return;
    }
    // sessionTraits 不存在时 no-op（无内容可移除）
    if (!current.sessionTraits) {
      return;
    }
    try {
      const newTraits = current.sessionTraits.filter(t => t.id !== traitId);

      set((state) => {
        if (!state.currentTestChat) return {};
        const updatedChat: CharacterTestChat = {
          ...state.currentTestChat,
          sessionTraits: newTraits,
        };
        const newTestChats = state.testChats.map(c =>
          c.id === updatedChat.id ? updatedChat : c
        );
        return {
          currentTestChat: updatedChat,
          testChats: newTestChats,
        };
      });
      await get().saveTestChat(
        current.creativeId,
        current.characterCardId,
        current.characterCardName,
        current.messages
      );
    } catch (error) {
      console.error('[characterChatStore] removeSessionTrait failed:', error);
    }
  }
}));

export type { ChatMessage, CharacterTestChat };
