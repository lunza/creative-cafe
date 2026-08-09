import { create } from 'zustand';

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
            };
          }
          
          return cleanMsg;
        });
        
        const chat = await window.electronAPI.characterChat.saveTestChat(
          creativeId,
          characterCardId,
          characterCardName,
          safeMessages
        );
        
        if (chat) {
          // 安全转换返回的消息内容
          chat.messages = chat.messages.map(msg => ({
            ...msg,
            content: String(msg.content || '')
          }));
          
          set((state) => {
            const exists = state.testChats.some(c => c.id === chat.id);
            const newTestChats = exists
              ? state.testChats.map(c => c.id === chat.id ? chat : c)
              : [...state.testChats, chat];
              
            // 只有当前正在查看这个对话时才更新 currentTestChat
            const updateCurrent = 
              state.currentTestChat && 
              state.currentTestChat.creativeId === creativeId && 
              state.currentTestChat.characterCardId === characterCardId;
              
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
  }
}));

export type { ChatMessage, CharacterTestChat };
