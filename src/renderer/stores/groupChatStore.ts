import { create } from 'zustand';
import { Group, GroupChatMessage, GroupChatHeader } from '../types/groupChat.types';

interface GroupChatStore {
  groups: Group[];
  selectedGroup: Group | null;
  openGroupId: string | null;

  chatMessages: (GroupChatHeader | GroupChatMessage)[];
  isChatLoading: boolean;

  loadGroups: () => Promise<void>;
  selectGroup: (group: Group | null) => void;
  openGroup: (groupId: string | null) => void;
  createGroup: (data: Partial<Group>) => Promise<Group | null>;
  editGroup: (group: Group) => Promise<boolean>;
  deleteGroup: (id: string) => Promise<boolean>;

  loadChatMessages: (chatId: string) => Promise<void>;
  saveChatMessages: (chatId: string, messages: (GroupChatHeader | GroupChatMessage)[]) => Promise<boolean>;
  clearChatMessages: () => void;
}

export const useGroupChatStore = create<GroupChatStore>((set, get) => ({
  groups: [],
  selectedGroup: null,
  openGroupId: null,

  chatMessages: [],
  isChatLoading: false,

  loadGroups: async () => {
    try {
      const groups = await window.electronAPI.invoke('group:getAll');
      set({ groups });
    } catch (error) {
      console.error('[GroupChatStore] Failed to load groups:', error);
    }
  },

  selectGroup: (group: Group | null) => {
    set({ selectedGroup: group });
  },

  openGroup: (groupId: string | null) => {
    set({ openGroupId: groupId });
  },

  createGroup: async (data: Partial<Group>) => {
    try {
      const group = await window.electronAPI.invoke('group:create', data);
      if (group) {
        set((state) => ({
          groups: [...state.groups, group],
          selectedGroup: group,
        }));
        return group;
      }
      return null;
    } catch (error) {
      console.error('[GroupChatStore] Failed to create group:', error);
      return null;
    }
  },

  editGroup: async (group: Group) => {
    try {
      const success = await window.electronAPI.invoke('group:edit', group);
      if (success) {
        set((state) => ({
          groups: state.groups.map((g) => (g.id === group.id ? group : g)),
          selectedGroup: state.selectedGroup?.id === group.id ? group : state.selectedGroup,
        }));
        return true;
      }
      return false;
    } catch (error) {
      console.error('[GroupChatStore] Failed to edit group:', error);
      return false;
    }
  },

  deleteGroup: async (id: string) => {
    try {
      const success = await window.electronAPI.invoke('group:delete', id);
      if (success) {
        set((state) => ({
          groups: state.groups.filter((g) => g.id !== id),
          selectedGroup: state.selectedGroup?.id === id ? null : state.selectedGroup,
          openGroupId: state.openGroupId === id ? null : state.openGroupId,
        }));
        return true;
      }
      return false;
    } catch (error) {
      console.error('[GroupChatStore] Failed to delete group:', error);
      return false;
    }
  },

  loadChatMessages: async (chatId: string) => {
    set({ isChatLoading: true });
    try {
      const messages = await window.electronAPI.invoke('group-chat:get', chatId);
      if (messages) {
        const safeMessages = messages.map((msg: any) => ({
          ...msg,
          mes: String(msg.mes || ''),
          name: String(msg.name || ''),
        }));
        set({ chatMessages: safeMessages, isChatLoading: false });
      } else {
        set({ chatMessages: [], isChatLoading: false });
      }
    } catch (error) {
      console.error('[GroupChatStore] Failed to load chat messages:', error);
      set({ chatMessages: [], isChatLoading: false });
    }
  },

  saveChatMessages: async (chatId: string, messages: (GroupChatHeader | GroupChatMessage)[]) => {
    try {
      const safeMessages = messages.map((msg: any) => {
        const cleanMsg: any = {
          id: msg.id ? String(msg.id) : undefined,
          name: msg.name ? String(msg.name) : undefined,
          is_user: msg.is_user || false,
          is_system: msg.is_system || false,
          send_date: msg.send_date || new Date().toISOString(),
          mes: String(msg.mes || ''),
        };
        if (msg.original_avatar) cleanMsg.original_avatar = String(msg.original_avatar);
        if (msg.force_avatar) cleanMsg.force_avatar = String(msg.force_avatar);
        if (msg.extra) cleanMsg.extra = msg.extra;
        if (msg.chat_metadata) cleanMsg.chat_metadata = msg.chat_metadata;
        if (msg.user_name) cleanMsg.user_name = msg.user_name;
        if (msg.character_name) cleanMsg.character_name = msg.character_name;
        return cleanMsg;
      });

      const result = await window.electronAPI.invoke('group-chat:save', chatId, safeMessages, false);
      return !('error' in result);
    } catch (error) {
      console.error('[GroupChatStore] Failed to save chat messages:', error);
      return false;
    }
  },

  clearChatMessages: () => {
    set({ chatMessages: [] });
  },
}));

export type { GroupChatMessage, GroupChatHeader };
