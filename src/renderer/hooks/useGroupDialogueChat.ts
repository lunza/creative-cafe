import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { message } from 'antd';
import { useGroupChatStore } from '../stores/groupChatStore';
import {
  Group,
  GroupChatMessage,
  GroupChatHeader,
  ActivationStrategy,
  GenerationMode,
} from '../types/groupChat.types';
import { ChatEngineFactory } from '../components/Common/ChatEngine/ChatEngine.factory';
import { AIEngineConfig, AIResponse } from '../components/Common/ChatEngine/ChatEngine.types';
import { useGroupGeneration, CharacterCard } from './useGroupGeneration';
import { selectNextSpeaker, ActivationCandidate } from './useGroupActivation';

interface GroupDialogueMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status: 'sending' | 'sent' | 'error';
  speakerName?: string;
  speakerAvatar?: string;
}

interface GroupDialogueState {
  messages: GroupDialogueMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  isAutoMode: boolean;
  error: string | null;
}

interface GroupDialogueChatProps {
  group: Group | null;
  characters: Map<string, CharacterCard>;
  userName?: string;
  userAvatar?: string;
  engineConfig?: AIEngineConfig | null;
}

const STORAGE_KEY_PREFIX = 'group-session-';

function getStoredConfig(groupId: string) {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${groupId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveStoredConfig(groupId: string, config: any) {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${groupId}`, JSON.stringify(config));
  } catch {
    // localStorage may be full or unavailable
  }
}

function convertGroupMessagesToDialogue(
  messages: (GroupChatHeader | GroupChatMessage)[],
  characters: Map<string, CharacterCard>
): GroupDialogueMessage[] {
  const dialogueMessages: GroupDialogueMessage[] = [];

  for (const msg of messages) {
    if ('chat_metadata' in msg) continue;

    const chatMsg = msg as GroupChatMessage;
    dialogueMessages.push({
      id: chatMsg.id || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: chatMsg.is_user ? 'user' : 'assistant',
      content: chatMsg.mes || '',
      timestamp: chatMsg.send_date ? new Date(chatMsg.send_date).getTime() : Date.now(),
      status: 'sent',
      speakerName: chatMsg.name || '',
      speakerAvatar: chatMsg.force_avatar || chatMsg.original_avatar,
    });
  }

  return dialogueMessages;
}

function convertDialogueToGroupMessages(
  messages: GroupDialogueMessage[],
  userName?: string
): (GroupChatHeader | GroupChatMessage)[] {
  const groupMessages: (GroupChatHeader | GroupChatMessage)[] = [];

  groupMessages.push({
    chat_metadata: { integrity: 'ok' },
    user_name: userName || 'User',
    character_name: 'Group',
  } as GroupChatHeader);

  for (const msg of messages) {
    groupMessages.push({
      id: msg.id,
      name: msg.speakerName || (msg.role === 'user' ? userName || 'User' : ''),
      is_user: msg.role === 'user',
      is_system: false,
      send_date: new Date(msg.timestamp).toISOString(),
      mes: msg.content,
      force_avatar: msg.speakerAvatar,
    } as GroupChatMessage);
  }

  return groupMessages;
}

export function useGroupDialogueChat({ group, characters, userName, userAvatar, engineConfig }: GroupDialogueChatProps) {
  const { loadChatMessages, saveChatMessages, clearChatMessages, chatMessages: storeMessages, isChatLoading } = useGroupChatStore();
  const { buildSystemPrompt, applyJoinTemplate } = useGroupGeneration();

  const [state, setState] = useState<GroupDialogueState>({
    messages: [],
    isLoading: false,
    isStreaming: false,
    isAutoMode: false,
    error: null,
  });

  const messagesRef = useRef<GroupDialogueMessage[]>([]);
  const streamContentRef = useRef('');
  const targetMessageIdRef = useRef('');
  const isSavingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const autoModeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSpeakerNameRef = useRef<string | null>(null);
  const lastListIndexRef = useRef(0);
  const spokenMembersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!group) {
      setState({ messages: [], isLoading: false, isStreaming: false, isAutoMode: false, error: null });
      messagesRef.current = [];
      return;
    }

    let cancelled = false;
    const loadChat = async () => {
      try {
        await loadChatMessages(group.chat_id);
        if (cancelled) return;
      } catch (error) {
        console.error(`[GroupDialogueChat] Failed to load chat history: ${error}`);
      }
    };
    loadChat();
    return () => { cancelled = true; };
  }, [group?.chat_id, loadChatMessages]);

  useEffect(() => {
    if (!group) return;
    const dialogueMessages = convertGroupMessagesToDialogue(storeMessages, characters);
    setState((prev) => ({ ...prev, messages: dialogueMessages }));
    messagesRef.current = dialogueMessages;
  }, [storeMessages, group?.chat_id, characters]);

  useEffect(() => {
    messagesRef.current = state.messages;
  }, [state.messages]);

  const saveChatToStore = useCallback(async (messages: GroupDialogueMessage[]) => {
    if (!group || isSavingRef.current) return;
    try {
      isSavingRef.current = true;
      const groupMessages = convertDialogueToGroupMessages(messages, userName);
      await saveChatMessages(group.chat_id, groupMessages);
    } catch (error) {
      console.error(`[GroupDialogueChat] Failed to save chat: ${error}`);
    } finally {
      isSavingRef.current = false;
    }
  }, [group, userName, saveChatMessages]);

  const requestAIResponse = useCallback(async (
    contextMessages: GroupDialogueMessage[],
    targetMessageId: string,
    systemPrompt: string,
    abortSignal: AbortSignal
  ) => {
    const activeEngine = engineConfig;
    if (!activeEngine) {
      message.warning('请先在设置中配置AI引擎');
      setState((prev) => ({
        ...prev,
        messages: prev.messages.map((msg) =>
          msg.id === targetMessageId
            ? { ...msg, content: '请先配置AI引擎', status: 'error' as const }
            : msg
        ),
        isLoading: false,
        isStreaming: false,
      }));
      return;
    }

    const engineConfigWithParams: AIEngineConfig = {
      id: activeEngine.id,
      name: activeEngine.name,
      api_url: activeEngine.api_url,
      api_key: activeEngine.api_key,
      model_name: activeEngine.model_name,
      api_mode: activeEngine.api_mode,
      api_key_transmission: activeEngine.api_key_transmission,
      max_tokens: activeEngine.max_tokens ?? 8192,
      system_prompt: systemPrompt,
      temperature: activeEngine.temperature ?? 0.7,
    };

    const messagesToSend = contextMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      name: msg.role === 'user' ? undefined : msg.speakerName,
    }));

    const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(engineConfigWithParams);

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        engine.cancelRequest();
      }, { once: true });
    }

    engine.onStream((chunk) => {
      if (chunk) {
        streamContentRef.current += chunk;
        const currentContent = streamContentRef.current;
        setState((prev) => ({
          ...prev,
          messages: prev.messages.map((msg) =>
            msg.id === targetMessageId
              ? { ...msg, content: currentContent, status: 'sending' as const }
              : msg
          ),
        }));
      }
    });

    engine.onComplete(() => {
      const finalContent = streamContentRef.current;
      if (!finalContent) {
        setState((prev) => ({
          ...prev,
          messages: prev.messages.map((msg) =>
            msg.id === targetMessageId
              ? { ...msg, content: 'AI returned empty response', status: 'error' as const }
              : msg
          ),
          isLoading: false,
          isStreaming: false,
        }));
        return;
      }

      setState((prev) => {
        const finalMessages = prev.messages.map((msg) =>
          msg.id === targetMessageId
            ? { ...msg, content: finalContent, status: 'sent' as const }
            : msg
        );
        setTimeout(() => {
          saveChatToStore(finalMessages).catch((err) => {
            console.error(`[GroupDialogueChat] Failed to save chat: ${err}`);
          });
        }, 0);

        return {
          ...prev,
          messages: finalMessages,
          isLoading: false,
          isStreaming: false,
        };
      });
      streamContentRef.current = '';
      targetMessageIdRef.current = '';
    });

    engine.onError((error) => {
      setState((prev) => ({
        ...prev,
        messages: prev.messages.map((msg) =>
          msg.id === targetMessageId
            ? { ...msg, content: `Error: ${error.message}`, status: 'error' as const }
            : msg
        ),
        isLoading: false,
        isStreaming: false,
        error: error.message,
      }));
      streamContentRef.current = '';
    });

    try {
      await engine.sendMessage(messagesToSend, systemPrompt, engineConfigWithParams);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
      setState((prev) => ({
        ...prev,
        messages: prev.messages.map((msg) =>
          msg.id === targetMessageId
            ? { ...msg, content: `错误: ${errorMessage}`, status: 'error' as const }
            : msg
        ),
        isLoading: false,
        isStreaming: false,
        error: errorMessage,
      }));
    }
  }, [engineConfig, saveChatToStore]);

  const generateGroupWrapper = useCallback(async (
    speakerName: string,
    systemPrompt: string
  ) => {
    if (!group || state.isStreaming) return false;

    const character = characters.get(speakerName);
    if (!character) {
      console.error(`[GroupDialogueChat] Character not found: ${speakerName}`);
      return false;
    }

    abortControllerRef.current = new AbortController();

    const aiMessageId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const aiMessage: GroupDialogueMessage = {
      id: aiMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'sending',
      speakerName: speakerName,
    };

    const newMessages = [...state.messages, aiMessage];
    setState((prev) => ({
      ...prev,
      messages: newMessages,
      isLoading: true,
      isStreaming: true,
      error: null,
    }));
    messagesRef.current = newMessages;

    await requestAIResponse(
      newMessages,
      aiMessageId,
      systemPrompt,
      abortControllerRef.current.signal
    );

    return true;
  }, [group, characters, state.messages, state.isStreaming, requestAIResponse]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || state.isStreaming || !group) return;

    const userId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const userMessage: GroupDialogueMessage = {
      id: userId,
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
      status: 'sent',
      speakerName: userName || 'User',
      speakerAvatar: userAvatar,
    };

    const newMessages = [...state.messages, userMessage];
    setState((prev) => ({
      ...prev,
      messages: newMessages,
    }));
    messagesRef.current = newMessages;

    saveChatToStore(newMessages).catch((err) => {
      console.error(`[GroupDialogueChat] Failed to save user message: ${err}`);
    });

    console.log(`[GroupDialogueChat] User message sent: ${content.substring(0, 50)}...`);
  }, [state.messages, state.isStreaming, group, userName, userAvatar, saveChatToStore]);

  const generateNextResponse = useCallback(async () => {
    if (!group || state.isStreaming) return;

    const currentMessages = messagesRef.current;
    const lastMessage = currentMessages[currentMessages.length - 1];
    const lastSpeaker = lastMessage?.role === 'assistant' ? lastMessage.speakerName : null;

    if (group.members.length === 0) return;

    const candidates: ActivationCandidate[] = group.members.map((name) => ({
      name,
      lastSpeakerOrder: group.members.indexOf(name),
      talkativeness: 1,
    }));

    const { name: nextSpeaker } = selectNextSpeaker(
      group.activation_strategy,
      lastMessage?.content || '',
      candidates,
      lastSpeaker,
      lastListIndexRef.current,
      spokenMembersRef.current,
      true
    );

    if (!nextSpeaker) return;

    if (group.activation_strategy === ActivationStrategy.LIST) {
      lastListIndexRef.current = (lastListIndexRef.current + 1) % group.members.length;
    } else {
      spokenMembersRef.current.add(nextSpeaker);
    }
    lastSpeakerNameRef.current = nextSpeaker;

    const activeCharacter = characters.get(nextSpeaker);
    const systemPrompt = buildSystemPrompt(
      group.generation_mode,
      activeCharacter || null,
      group,
      characters
    );

    await generateGroupWrapper(nextSpeaker, systemPrompt);
  }, [group, state.isStreaming, characters, buildSystemPrompt, generateGroupWrapper]);

  const stopAutoMode = useCallback(() => {
    if (autoModeTimerRef.current) {
      clearInterval(autoModeTimerRef.current);
      autoModeTimerRef.current = null;
    }
    setState((prev) => ({ ...prev, isAutoMode: false }));
    console.log('[GroupDialogueChat] Auto mode stopped');
  }, []);

  const clearChat = useCallback(async () => {
    if (state.isStreaming) {
      abortControllerRef.current?.abort();
    }

    stopAutoMode();
    setState({ messages: [], isLoading: false, isStreaming: false, isAutoMode: false, error: null });
    messagesRef.current = [];
    lastSpeakerNameRef.current = null;
    lastListIndexRef.current = 0;
    spokenMembersRef.current = new Set();
    clearChatMessages();
    console.log('[GroupDialogueChat] Chat cleared');
    message.success('对话已清空');
  }, [state.isStreaming, clearChatMessages, stopAutoMode]);

  const cancelRequest = useCallback(() => {
    abortControllerRef.current?.abort();
    setState((prev) => ({
      ...prev,
      isLoading: false,
      isStreaming: false,
    }));
    console.log('[GroupDialogueChat] Request cancelled');
  }, []);

  const startAutoMode = useCallback(() => {
    if (!group || state.isAutoMode) return;

    const delay = (group.auto_mode_delay || 5) * 1000;
    setState((prev) => ({ ...prev, isAutoMode: true }));
    console.log(`[GroupDialogueChat] Auto mode started (delay: ${delay / 1000}s)`);

    autoModeTimerRef.current = setInterval(() => {
      if (!state.isStreaming && !state.isLoading) {
        generateNextResponse();
      }
    }, delay);
  }, [group, state.isAutoMode, state.isStreaming, state.isLoading, generateNextResponse]);

  const retryMessage = useCallback(async (messageId: string) => {
    if (state.isStreaming) {
      message.warning('请等待当前回复完成');
      return;
    }

    const existingMessage = messagesRef.current.find((m) => m.id === messageId);
    if (!existingMessage) {
      message.error('Message not found');
      return;
    }

    const messagesBeforeRetry = messagesRef.current.filter((m) => m.id !== messageId);

    const newRetryMessage: GroupDialogueMessage = {
      id: messageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'sending',
      speakerName: existingMessage.speakerName,
    };

    setState((prev) => ({
      ...prev,
      messages: [...messagesBeforeRetry, newRetryMessage],
      isLoading: true,
      isStreaming: true,
    }));

    const activeCharacter = characters.get(existingMessage.speakerName || '');
    const systemPrompt = buildSystemPrompt(
      group?.generation_mode || GenerationMode.SWAP,
      activeCharacter || null,
      group!,
      characters
    );

    await requestAIResponse(
      messagesBeforeRetry,
      messageId,
      systemPrompt,
      new AbortController().signal
    );
  }, [state.isStreaming, group, characters, buildSystemPrompt, requestAIResponse]);

  const editMessage = useCallback((messageId: string, newContent: string) => {
    setState((prev) => {
      const updatedMessages = prev.messages.map((msg) =>
        msg.id === messageId ? { ...msg, content: newContent, timestamp: Date.now() } : msg
      );
      saveChatToStore(updatedMessages);
      console.log(`[GroupDialogueChat] Message ${messageId} edited`);
      return { ...prev, messages: updatedMessages };
    });
  }, [saveChatToStore]);

  const groupedMessages = useMemo(() => {
    const grouped: Array<{ speaker: string; messages: GroupDialogueMessage[] }> = [];
    let currentGroup: { speaker: string; messages: GroupDialogueMessage[] } | null = null;

    for (const msg of state.messages) {
      if (msg.role === 'user') {
        if (currentGroup) {
          grouped.push(currentGroup);
          currentGroup = null;
        }
        grouped.push({ speaker: msg.speakerName || 'User', messages: [msg] });
      } else {
        if (currentGroup && currentGroup.speaker === msg.speakerName) {
          currentGroup.messages.push(msg);
        } else {
          if (currentGroup) grouped.push(currentGroup);
          currentGroup = { speaker: msg.speakerName || '', messages: [msg] };
        }
      }
    }

    if (currentGroup) grouped.push(currentGroup);
    return grouped;
  }, [state.messages]);

  return {
    state,
    sendMessage,
    generateNextResponse,
    generateGroupWrapper,
    retryMessage,
    editMessage,
    clearChat,
    cancelRequest,
    startAutoMode,
    stopAutoMode,
    groupedMessages,
    lastSpeakerName: lastSpeakerNameRef.current,
  };
}

export type { GroupDialogueMessage, GroupDialogueState };
