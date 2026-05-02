import { create } from 'zustand';

// 聊天消息接口
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
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

// 角色卡生成对话
interface CharacterGenerationChat {
  id: string;
  creativeId: string;
  targetType: 'character' | 'worldbook';
  name: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface CharacterChatStore {
  // 测试对话
  testChats: CharacterTestChat[];
  // 生成对话
  generationChats: CharacterGenerationChat[];
  // 加载状态
  isLoading: boolean;
  // 当前选中的对话
  currentTestChat: CharacterTestChat | null;
  currentGenerationChat: CharacterGenerationChat | null;

  // 加载所有对话
  loadAllChats: () => Promise<void>;

  // 测试对话操作
  loadTestChat: (creativeId: string, characterCardId: string) => Promise<void>;
  saveTestChat: (creativeId: string, characterCardId: string, characterCardName: string, messages: ChatMessage[]) => Promise<void>;
  deleteTestChat: (creativeId: string, characterCardId: string) => Promise<void>;

  // 生成对话操作
  loadGenerationChat: (creativeId: string, targetType: 'character' | 'worldbook', name: string) => Promise<void>;
  saveGenerationChat: (creativeId: string, targetType: 'character' | 'worldbook', name: string, messages: ChatMessage[]) => Promise<void>;
  deleteGenerationChat: (creativeId: string, targetType: 'character' | 'worldbook', name: string) => Promise<void>;

  // 辅助方法
  setCurrentTestChat: (chat: CharacterTestChat | null) => void;
  setCurrentGenerationChat: (chat: CharacterGenerationChat | null) => void;
  addTestMessage: (creativeId: string, characterCardId: string, characterCardName: string, message: ChatMessage) => Promise<void>;
  addGenerationMessage: (creativeId: string, targetType: 'character' | 'worldbook', name: string, message: ChatMessage) => Promise<void>;
}

export const useCharacterChatStore = create<CharacterChatStore>((set, get) => ({
  testChats: [],
  generationChats: [],
  isLoading: false,
  currentTestChat: null,
  currentGenerationChat: null,

  // 加载所有对话
  loadAllChats: async () => {
    set({ isLoading: true });
    try {
      if (window.electronAPI && window.electronAPI.characterChat) {
        const [testChats, generationChats] = await Promise.all([
          window.electronAPI.characterChat.getAllTestChats(),
          window.electronAPI.characterChat.getAllGenerationChats()
        ]);
        set({ testChats, generationChats, isLoading: false });
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
        // 安全转换消息内容
        const safeMessages = messages.map(msg => ({
          ...msg,
          content: String(msg.content || '')
        }));
        
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

  // 生成对话操作
  loadGenerationChat: async (creativeId: string, targetType: 'character' | 'worldbook', name: string) => {
    set({ isLoading: true });
    try {
      if (window.electronAPI && window.electronAPI.characterChat) {
        const chat = await window.electronAPI.characterChat.getGenerationChat(creativeId, targetType, name);
        if (chat) {
          // 安全转换消息内容
          chat.messages = chat.messages.map(msg => ({
            ...msg,
            content: String(msg.content || '')
          }));
          
          set((state) => {
            const exists = state.generationChats.some(c => c.id === chat.id);
            const newGenerationChats = exists
              ? state.generationChats.map(c => c.id === chat.id ? chat : c)
              : [...state.generationChats, chat];
              
            return {
              generationChats: newGenerationChats,
              currentGenerationChat: chat,
              isLoading: false
            };
          });
        } else {
          set({ currentGenerationChat: null, isLoading: false });
        }
      }
    } catch (error) {
      console.error('[CharacterChatStore] Failed to load generation chat:', error);
      set({ currentGenerationChat: null, isLoading: false });
    }
  },

  saveGenerationChat: async (creativeId: string, targetType: 'character' | 'worldbook', name: string, messages: ChatMessage[]) => {
    try {
      if (window.electronAPI && window.electronAPI.characterChat) {
        // 安全转换消息内容
        const safeMessages = messages.map(msg => ({
          ...msg,
          content: String(msg.content || '')
        }));
        
        const chat = await window.electronAPI.characterChat.saveGenerationChat(
          creativeId,
          targetType,
          name,
          safeMessages
        );
        
        if (chat) {
          // 安全转换返回的消息内容
          chat.messages = chat.messages.map(msg => ({
            ...msg,
            content: String(msg.content || '')
          }));
          
          set((state) => {
            const exists = state.generationChats.some(c => c.id === chat.id);
            const newGenerationChats = exists
              ? state.generationChats.map(c => c.id === chat.id ? chat : c)
              : [...state.generationChats, chat];
              
            const updateCurrent = 
              state.currentGenerationChat && 
              state.currentGenerationChat.creativeId === creativeId && 
              state.currentGenerationChat.targetType === targetType && 
              state.currentGenerationChat.name === name;
              
            return {
              generationChats: newGenerationChats,
              currentGenerationChat: updateCurrent ? chat : state.currentGenerationChat
            };
          });
        }
      }
    } catch (error) {
      console.error('[CharacterChatStore] Failed to save generation chat:', error);
    }
  },

  deleteGenerationChat: async (creativeId: string, targetType: 'character' | 'worldbook', name: string) => {
    try {
      if (window.electronAPI && window.electronAPI.characterChat) {
        await window.electronAPI.characterChat.deleteGenerationChat(creativeId, targetType, name);
        set((state) => {
          const newGenerationChats = state.generationChats.filter(
            c => !(c.creativeId === creativeId && c.targetType === targetType && c.name === name)
          );
          const shouldClearCurrent = 
            state.currentGenerationChat && 
            state.currentGenerationChat.creativeId === creativeId && 
            state.currentGenerationChat.targetType === targetType && 
            state.currentGenerationChat.name === name;
            
          return {
            generationChats: newGenerationChats,
            currentGenerationChat: shouldClearCurrent ? null : state.currentGenerationChat
          };
        });
      }
    } catch (error) {
      console.error('[CharacterChatStore] Failed to delete generation chat:', error);
    }
  },

  // 辅助方法
  setCurrentTestChat: (chat: CharacterTestChat | null) => {
    set({ currentTestChat: chat });
  },

  setCurrentGenerationChat: (chat: CharacterGenerationChat | null) => {
    set({ currentGenerationChat: chat });
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

  addGenerationMessage: async (creativeId: string, targetType: 'character' | 'worldbook', name: string, message: ChatMessage) => {
    const current = get().currentGenerationChat;
    let messages: ChatMessage[] = [];
    if (current && current.creativeId === creativeId && current.targetType === targetType && current.name === name) {
      messages = [...current.messages, message];
    } else {
      messages = [message];
    }
    await get().saveGenerationChat(creativeId, targetType, name, messages);
  }
}));

export type { ChatMessage, CharacterTestChat, CharacterGenerationChat };
