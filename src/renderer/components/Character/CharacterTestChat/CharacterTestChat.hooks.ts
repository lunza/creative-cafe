// 角色测试聊天业务逻辑Hooks

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { message } from 'antd';
import { useSettingStore } from '../../../stores/settingStore';
import { useCharacterChatStore } from '../../../stores/characterChatStore';
import { useLogStore } from '../../../stores/logStore';
import { ChatMessage, CharacterInfo, ChatState, UserPersona, EffectiveAIParams } from './CharacterTestChat.types';
import { ChatEngineFactory } from '../../Common/ChatEngine/ChatEngine.factory';
import { AIEngineConfig, AIResponse } from '../../Common/ChatEngine/ChatEngine.types';
import { replaceTemplates, buildCharacterContext, buildPersonaSection } from './CharacterTestChat.utils';

const DEFAULT_USER_NAME = 'User';

// ==================== 角色配置 Hook ====================

const STORAGE_KEY_PREFIX = 'character-session-';

function getStoredConfig(characterCardId: string) {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${characterCardId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveStoredConfig(characterCardId: string, config: any) {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${characterCardId}`, JSON.stringify(config));
  } catch {
    // localStorage may be full or unavailable
  }
}

export function useCharacterConfig(characterCardId: string) {
  const [config, setConfig] = useState(() => getStoredConfig(characterCardId));

  useEffect(() => {
    const stored = getStoredConfig(characterCardId);
    setConfig(stored);
  }, [characterCardId]);

  const updateConfig = useCallback((updates: Partial<typeof config>) => {
    setConfig(prev => {
      const next = {
        ...prev,
        ...updates,
        characterCardId,
        lastUpdated: Date.now(),
      };
      saveStoredConfig(characterCardId, next);
      return next;
    });
  }, [characterCardId]);

  const clearConfig = useCallback(() => {
    try {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${characterCardId}`);
    } catch { /* ignore */ }
    setConfig(null);
  }, [characterCardId]);

  const resetParameters = useCallback(() => {
    setConfig(prev => {
      const next = prev ? { ...prev, customParameters: undefined, lastUpdated: Date.now() } : null;
      saveStoredConfig(characterCardId, next);
      return next;
    });
  }, [characterCardId]);

  const getEffectiveParams = useCallback((): EffectiveAIParams => {
    const customParams = config?.customParameters || {};
    const source = Object.keys(customParams).length > 0 ? 'custom' : 'global';
    
    return {
      temperature: customParams.temperature ?? 0.7,
      top_p: customParams.top_p !== undefined ? customParams.top_p : undefined,
      max_tokens: customParams.max_tokens !== undefined ? customParams.max_tokens : 8192,
      frequency_penalty: customParams.frequency_penalty !== undefined ? customParams.frequency_penalty : undefined,
      presence_penalty: customParams.presence_penalty !== undefined ? customParams.presence_penalty : undefined,
      source,
    };
  }, [config]);

  return { config, updateConfig, clearConfig, resetParameters, getEffectiveParams };
}

// ==================== 人设加载 Hook ====================

export function usePersonas() {
  const [personas, setPersonas] = useState<UserPersona[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const loadPersonas = async () => {
      setLoading(true);
      try {
        const avatars = await window.electronAPI.avatar.list();
        if (mounted) {
          const loadedPersonas: UserPersona[] = [];
          for (const avatar of avatars) {
            if (avatar.path?.endsWith('.json') && !avatar.path.includes('user-profile.json')) {
              try {
                const content = await window.electronAPI.avatar.read(avatar.path);
                if (content) {
                  loadedPersonas.push({
                    id: content.id || avatar.name.replace('.json', ''),
                    name: content.name || '未命名',
                    description: content.description || '',
                    avatarPath: content.avatarPath || '',
                    createdAt: content.createdAt || Date.now(),
                    updatedAt: content.updatedAt || Date.now(),
                  });
                }
              } catch { /* skip failed items */ }
            }
          }
          loadedPersonas.sort((a, b) => b.updatedAt - a.updatedAt);
          setPersonas(loadedPersonas);
        }
      } catch { /* ignore */ }
      finally { if (mounted) setLoading(false); }
    };
    loadPersonas();
    return () => { mounted = false; };
  }, []);

  return { personas, loading };
}

export function useCharacterTestChat(characterInfo: CharacterInfo) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    isLoading: false,
    isStreaming: false,
    error: null,
  });

  // 新增：角色配置和人设状态
  const { config: characterConfig, updateConfig, resetParameters, getEffectiveParams } = useCharacterConfig(characterInfo.characterCardId);
  const { personas } = usePersonas();
  
  const selectedPersona = useMemo(() => {
    if (!characterConfig?.selectedPersonaId) return undefined;
    return personas.find(p => p.id === characterConfig.selectedPersonaId);
  }, [personas, characterConfig?.selectedPersonaId]);

  const { setting, fetchSetting } = useSettingStore();
  const { saveTestChat } = useCharacterChatStore();
  const { addLog } = useLogStore();
  const streamContentRef = useRef<string>('');
  const initialContentRef = useRef<string>('');
  const messagesRef = useRef<ChatMessage[]>([]);
  const targetMessageIdRef = useRef<string>('');
  const firstMessageSentRef = useRef<boolean>(false);

  useEffect(() => {
    fetchSetting();
  }, [fetchSetting]);

  useEffect(() => {
    const loadChatHistory = async () => {
      try {
        const chat = await window.electronAPI?.characterChat?.getTestChat(
          characterInfo.creativeId,
          characterInfo.characterCardId
        );
        if (chat && chat.messages && chat.messages.length > 0) {
          const safeMessages = chat.messages.map((msg: any) => ({
            id: msg.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
            role: msg.role || 'user',
            content: String(msg.content || ''),
            timestamp: msg.timestamp || Date.now(),
            status: msg.status || 'sent' as const,
          }));
          setState(prev => ({ ...prev, messages: safeMessages }));
          messagesRef.current = safeMessages;
          firstMessageSentRef.current = true;
          addLog('[CharacterTestChat] Loaded chat history', 'info');
        } else {
          const firstMes = characterInfo.first_mes;
          if (firstMes && firstMes.trim()) {
            const processedFirstMes = replaceTemplates(firstMes, characterInfo.characterCardName, DEFAULT_USER_NAME);
            const firstMessage: ChatMessage = {
              id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
              role: 'assistant',
              content: processedFirstMes,
              timestamp: Date.now(),
              status: 'sent',
            };
            setState(prev => ({ ...prev, messages: [firstMessage] }));
            messagesRef.current = [firstMessage];
            firstMessageSentRef.current = true;
            await saveTestChat(
              characterInfo.creativeId,
              characterInfo.characterCardId,
              characterInfo.characterCardName,
              [firstMessage]
            );
            addLog('[CharacterTestChat] Auto-sent first message from character card', 'info');
          }
        }
      } catch (error) {
        addLog(`[CharacterTestChat] Failed to load chat history: ${error}`, 'error');
      }
    };
    loadChatHistory();
  }, [characterInfo.creativeId, characterInfo.characterCardId, characterInfo.first_mes, characterInfo.characterCardName, saveTestChat, addLog]);

  useEffect(() => {
    messagesRef.current = state.messages;
  }, [state.messages]);

  const getActiveEngineConfig = useCallback((): AIEngineConfig | null => {
    if (!setting || !setting.aiEngines || setting.aiEngines.length === 0) {
      return null;
    }
    if (setting.activeEngineId) {
      const engine = setting.aiEngines.find((e: any) => e.id === setting.activeEngineId);
      if (engine) return engine;
    }
    return setting.aiEngines[0];
  }, [setting]);

  const buildDialoguePrompt = useCallback((): string => {
    const charName = characterInfo.characterCardName || 'Character';
    const characterContext = buildCharacterContext({
      name: charName,
      personality: characterInfo.personality,
      description: characterInfo.characterCardContent,
      scenario: characterInfo.scenario,
      mes_example: characterInfo.mes_example,
      system_prompt: characterInfo.system_prompt,
      creator_notes: characterInfo.creator_notes,
    }, DEFAULT_USER_NAME);

    const personaSection = buildPersonaSection(selectedPersona);

    return `【任务类型：角色扮演对话】

【角色信息】
${characterContext}
${personaSection}
【对话任务说明】
你正在扮演 {{char}} 这个角色，与 ${selectedPersona?.name || DEFAULT_USER_NAME} 进行角色扮演对话。
在提示词中，{{char}} 代表 ${charName}，${selectedPersona?.name || DEFAULT_USER_NAME} 代表当前对话用户。
你需要完全代入角色，以角色的身份与用户进行自然的交流。

【对话约束规则】
1. 你就是 ${charName} 这个角色本人，不是AI助手，不是翻译工具，不是任何系统
2. 以角色的口吻、性格特点和语言习惯与用户交流
3. 积极回应用户的问题和行为，推动对话自然发展
4. 根据对话上下文和情境调整语气和态度
5. 使用符合角色身份的语言风格
6. 在回复中使用 ${charName} 代替 {{char}}，使用 ${selectedPersona?.name || DEFAULT_USER_NAME} 代替 {{user}}
7. 【强制要求】角色直接说出的对话内容必须用标准英文双引号（" "）完整包裹，确保引号准确包裹对话文本的起始与结束位置

【严格禁止】
- 禁止输出任何格式标记、标签或前缀（如"Plain:"、"Article:"、"Terminate:"、"System:"等）
- 禁止输出任何元信息、系统说明或格式说明
- 禁止输出技术术语、模型名称（如"Transformers"、"Oracle"等）
- 禁止输出与角色扮演无关的任何内容
- 禁止打破角色设定或承认自己是AI
- 禁止输出任何随机字符或无意义字符串
- 禁止在输出中包含 {{char}} 或 {{user}} 等模板变量，必须替换为实际名称
- 禁止在角色对话中使用其他引号格式（如中文引号"「」"、"『』'等），必须使用英文双引号

【输出格式】
直接输出角色的对话和行动描写，像真实的人在说话一样。不要添加任何额外的标记或说明。`;
  }, [
    characterInfo.characterCardName,
    characterInfo.personality,
    characterInfo.characterCardContent,
    characterInfo.scenario,
    characterInfo.mes_example,
    characterInfo.system_prompt,
    characterInfo.creator_notes,
    selectedPersona,
  ]);

  const buildContinuationPrompt = useCallback((): string => {
    const charName = characterInfo.characterCardName || 'Character';
    const characterContext = buildCharacterContext({
      name: charName,
      personality: characterInfo.personality,
      description: characterInfo.characterCardContent,
      scenario: characterInfo.scenario,
      mes_example: characterInfo.mes_example,
      system_prompt: characterInfo.system_prompt,
      creator_notes: characterInfo.creator_notes,
    }, DEFAULT_USER_NAME);

    const personaSection = buildPersonaSection(selectedPersona);

    return `【任务类型：内容续写】

【角色信息】
${characterContext}
${personaSection}
【续写任务说明】
你需要续写以下角色的叙述内容。请仔细阅读前文，然后自然地继续写下去，保持风格和上下文的连贯性。
在提示词中，{{char}} 代表 ${charName}，${selectedPersona?.name || DEFAULT_USER_NAME} 代表当前对话用户。

【续写约束规则】
1. 自然地从已有内容继续，不要重复已写过的部分
2. 保持与原文相同的叙述风格、语气和节奏
3. 确保续写内容与前面的情节逻辑衔接
4. 严格遵守角色设定，不偏离角色性格
5. 像小说作者一样续写，直接输出故事内容
6. 在回复中使用 ${charName} 代替 {{char}}，使用 ${selectedPersona?.name || DEFAULT_USER_NAME} 代替 {{user}}
7. 【强制要求】角色直接说出的对话内容必须用标准英文双引号（" "）完整包裹，确保引号准确包裹对话文本的起始与结束位置

【严格禁止】
- 禁止添加任何标签、前缀或格式标记（如"Plain:"、"Article:"、"Terminate:"等）
- 禁止输出任何元说明文字（如"续写"、"继续"、"接下来"等）
- 禁止输出技术术语、模型名称
- 禁止输出与故事无关的任何内容
- 禁止解释、评论或总结已写内容
- 禁止输出任何随机字符或无意义字符串
- 禁止在输出中包含 {{char}} 或 {{user}} 等模板变量
- 禁止在角色对话中使用其他引号格式（如中文引号"「」"、"『』'等），必须使用英文双引号

【输出格式】
只输出纯粹的续写内容，不要有任何开场白、结束语或其他多余文字。直接从故事断点处继续叙述，保持原文的视角和时态。`;
  }, [
    characterInfo.characterCardName,
    characterInfo.personality,
    characterInfo.characterCardContent,
    characterInfo.scenario,
    characterInfo.mes_example,
    characterInfo.system_prompt,
    characterInfo.creator_notes,
    selectedPersona,
  ]);

  const saveChatToStore = useCallback(async (messages: ChatMessage[]) => {
    try {
      await saveTestChat(
        characterInfo.creativeId,
        characterInfo.characterCardId,
        characterInfo.characterCardName,
        messages
      );
    } catch (error) {
      addLog(`[CharacterTestChat] Failed to save chat: ${error}`, 'error');
    }
  }, [characterInfo, saveTestChat, addLog]);

  const requestAIResponse = useCallback(async (
    contextMessages: ChatMessage[],
    targetMessageId: string,
    initialContent: string = '',
    promptType: 'dialogue' | 'continuation' = 'dialogue'
  ) => {
    const activeEngine = getActiveEngineConfig();
    if (!activeEngine) {
      message.warning('请先在设置中配置AI引擎');
      setState(prev => ({
        ...prev,
        messages: prev.messages.map(msg =>
          msg.id === targetMessageId
            ? { ...msg, content: msg.content || '请先配置AI引擎', status: 'error' as const }
            : msg
        ),
        isLoading: false,
        isStreaming: false,
      }));
      return;
    }

    const effectiveParams = getEffectiveParams();
    const engineConfigWithParams: AIEngineConfig = {
      id: activeEngine.id,
      name: activeEngine.name,
      api_url: activeEngine.api_url,
      api_key: activeEngine.api_key,
      model_name: activeEngine.model_name,
      api_mode: activeEngine.api_mode,
      api_key_transmission: activeEngine.api_key_transmission,
      max_tokens: effectiveParams.max_tokens ?? activeEngine.max_tokens ?? 8192,
      system_prompt: activeEngine.system_prompt,
      temperature: effectiveParams.temperature ?? activeEngine.temperature,
    };

    if (effectiveParams.top_p !== undefined) {
      engineConfigWithParams.top_p = Number(effectiveParams.top_p);
    }
    if (effectiveParams.frequency_penalty !== undefined) {
      engineConfigWithParams.frequency_penalty = Number(effectiveParams.frequency_penalty);
    }
    if (effectiveParams.presence_penalty !== undefined) {
      engineConfigWithParams.presence_penalty = Number(effectiveParams.presence_penalty);
    }

    initialContentRef.current = initialContent;
    streamContentRef.current = initialContent;
    targetMessageIdRef.current = targetMessageId;

    let vectorContextSection = '';
    try {
      const lastUserMessage = [...contextMessages].reverse().find(m => m.role === 'user');
      if (lastUserMessage && lastUserMessage.content) {
        const contextResult = await window.electronAPI.context.retrieve(
          [...contextMessages.slice(-20), { role: 'user', content: lastUserMessage.content }],
          { topK: 5, minScore: 0.3, sources: ['worldbook', 'knowledge', 'memory'] }
        );

        if (contextResult.success && contextResult.items && contextResult.items.length > 0) {
          vectorContextSection = contextResult.items
            .map((item: any, index: number) => {
              return `[相关上下文 ${index + 1}] (来源: ${item.source}, 相关性: ${(item.score * 100).toFixed(1)}%)\n${item.content}`;
            })
            .join('\n\n');
          addLog(`[CharacterTestChat] Retrieved ${contextResult.items.length} vector context items`, 'info');
        }
      }
    } catch (error) {
      addLog(`[CharacterTestChat] Vector context retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'warn');
    }

    const systemPrompt = promptType === 'continuation' 
      ? buildContinuationPrompt() 
      : buildDialoguePrompt();
    
    const finalSystemPrompt = vectorContextSection 
      ? `${systemPrompt}\n\n--- 相关背景知识 ---\n\n${vectorContextSection}\n\n--- 请结合以上背景知识进行回应 ---`
      : systemPrompt;
    
    addLog(`[CharacterTestChat] Using ${promptType} prompt with params: temp=${effectiveParams.temperature}`, 'info');

    const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(engineConfigWithParams);

    engine.onStream((chunk, isDone) => {
      if (chunk) {
        streamContentRef.current += chunk;
        const currentContent = streamContentRef.current;

        setState(prev => {
          const targetMsg = prev.messages.find(m => m.id === targetMessageId);
          if (!targetMsg) return prev;

          const expectedPrefix = initialContentRef.current;
          if (currentContent !== expectedPrefix && !currentContent.startsWith(expectedPrefix)) {
            addLog(`[CharacterTestChat] Content validation warning: content mismatch detected`, 'warn');
          }

          return {
            ...prev,
            messages: prev.messages.map(msg =>
              msg.id === targetMessageId ? { ...msg, content: currentContent, status: 'sending' as const } : msg
            ),
          };
        });
      }
    });

    engine.onComplete((response: AIResponse) => {
      const accumulatedContent = streamContentRef.current;
      const serverContent = response?.content || '';
      const hasInitialContent = initialContentRef.current.length > 0;

      let finalContent: string;

      if (hasInitialContent) {
        if (accumulatedContent.length > initialContentRef.current.length) {
          finalContent = accumulatedContent;
          addLog(`[CharacterTestChat] Continue: preserved ${initialContentRef.current.length} chars, added ${accumulatedContent.length - initialContentRef.current.length} chars`, 'info');
        } else if (serverContent.length > 0) {
          finalContent = initialContentRef.current + serverContent;
          addLog(`[CharacterTestChat] Continue: used initial content + server response fallback`, 'info');
        } else {
          finalContent = initialContentRef.current;
          addLog(`[CharacterTestChat] Continue: no new content received, keeping original`, 'warn');
        }
      } else {
        finalContent = serverContent || accumulatedContent;
      }

      if (!finalContent) {
        setState(prev => ({
          ...prev,
          messages: prev.messages.map(msg =>
            msg.id === targetMessageId
              ? { ...msg, content: msg.content || 'AI returned empty response', status: 'error' as const }
              : msg
          ),
          isLoading: false,
          isStreaming: false,
        }));
        message.warning('AI returned empty response');
        return;
      }

      setState(prev => {
        const targetMessage = prev.messages.find(msg => msg.id === targetMessageId);
        if (!targetMessage) {
          addLog(`[CharacterTestChat] Target message ${targetMessageId} not found in current messages`, 'error');
          return prev;
        }

        const existingContent = targetMessage.content;
        if (existingContent.length > 0 && finalContent.length < existingContent.length) {
          addLog(`[CharacterTestChat] Content protection: preventing content loss (${existingContent.length} -> ${finalContent.length})`, 'error');
          return prev;
        }

        const finalMessages = prev.messages.map(msg =>
          msg.id === targetMessageId ? { ...msg, content: finalContent, status: 'sent' as const } : msg
        );

        saveChatToStore(finalMessages);

        return {
          ...prev,
          messages: finalMessages,
          isLoading: false,
          isStreaming: false,
        };
      });

      initialContentRef.current = '';
      targetMessageIdRef.current = '';
    });

    engine.onError((error) => {
      setState(prev => ({
        ...prev,
        messages: prev.messages.map(msg =>
          msg.id === targetMessageId
            ? { ...msg, content: msg.content ? `${msg.content}\n\nError: ${error.message}` : `Error: ${error.message}`, status: 'error' as const }
            : msg
        ),
        isLoading: false,
        isStreaming: false,
        error: error.message,
      }));
      message.error(`AI response failed: ${error.message}`);
      initialContentRef.current = '';
    });

    try {
      await engine.sendMessage(contextMessages, finalSystemPrompt, activeEngine);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
      setState(prev => ({
        ...prev,
        messages: prev.messages.map(msg =>
          msg.id === targetMessageId
            ? { ...msg, content: msg.content ? `${msg.content}\n\nError: ${errorMessage}` : `Error: ${errorMessage}`, status: 'error' as const }
            : msg
        ),
        isLoading: false,
        isStreaming: false,
        error: errorMessage,
      }));
      message.error(`Failed: ${errorMessage}`);
      initialContentRef.current = '';
    }
  }, [getActiveEngineConfig, buildDialoguePrompt, buildContinuationPrompt, saveChatToStore, addLog]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || state.isStreaming) return;

    const userId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const userMessage: ChatMessage = {
      id: userId,
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
      status: 'sent',
    };

    const aiMessageId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const newMessages = [...state.messages, userMessage, {
      id: aiMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'sending' as const,
    }];

    setState(prev => ({
      ...prev,
      messages: newMessages,
      isLoading: true,
      isStreaming: true,
      error: null,
    }));

    await requestAIResponse(
      [...state.messages, userMessage],
      aiMessageId,
      '',
      'dialogue'
    );
  }, [state.messages, state.isStreaming, requestAIResponse]);

  const continueConversation = useCallback(async () => {
    if (state.isStreaming) {
      message.warning('请等待当前回复完成');
      return;
    }

    const currentMessages = messagesRef.current;
    if (currentMessages.length === 0) {
      message.warning('请先开始对话');
      return;
    }

    const lastMessage = currentMessages[currentMessages.length - 1];
    if (lastMessage.role !== 'assistant') {
      message.warning('请先发送消息，等待AI回复后再使用续写功能');
      return;
    }

    if (lastMessage.status === 'sending') {
      message.warning('请等待当前回复完成');
      return;
    }

    const targetMessageId = lastMessage.id;
    const existingContent = lastMessage.content || '';

    addLog(`[CharacterTestChat] Continue conversation: message has ${existingContent.length} chars`, 'info');

    setState(prev => ({
      ...prev,
      messages: prev.messages.map(msg =>
        msg.id === targetMessageId ? { ...msg, status: 'sending' as const } : msg
      ),
      isLoading: true,
      isStreaming: true,
      error: null,
    }));

    await requestAIResponse(currentMessages, targetMessageId, existingContent, 'continuation');
  }, [state.isStreaming, requestAIResponse, addLog]);

  const retryMessage = useCallback(async (messageId: string) => {
    if (state.isStreaming) {
      message.warning('请等待当前回复完成');
      return;
    }

    const existingMessage = messagesRef.current.find(m => m.id === messageId);
    if (!existingMessage) {
      message.error('Message not found');
      return;
    }

    const messagesBeforeRetry = messagesRef.current.filter(m => m.id !== messageId);

    const newRetryMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'sending',
    };

    setState(prev => ({
      ...prev,
      messages: [...messagesBeforeRetry, newRetryMessage],
      isLoading: true,
      isStreaming: true,
    }));

    await requestAIResponse(messagesBeforeRetry, messageId, '', 'dialogue');
  }, [state.isStreaming, requestAIResponse]);

  const clearChat = useCallback(async () => {
    if (state.isStreaming) {
      const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(
        getActiveEngineConfig() || {} as AIEngineConfig
      );
      engine.cancelRequest();
    }

    firstMessageSentRef.current = false;

    setState({
      messages: [],
      isLoading: false,
      isStreaming: false,
      error: null,
    });
    messagesRef.current = [];
    await saveChatToStore([]);
    addLog('[CharacterTestChat] Chat cleared', 'info');
    message.success('对话已清空');
  }, [state.isStreaming, getActiveEngineConfig, saveChatToStore, addLog]);

  const cancelRequest = useCallback(() => {
    const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(
      getActiveEngineConfig() || {} as AIEngineConfig
    );
    engine.cancelRequest();
    setState(prev => ({
      ...prev,
      isLoading: false,
      isStreaming: false,
    }));
    addLog('[CharacterTestChat] Request cancelled', 'info');
    initialContentRef.current = '';
  }, [getActiveEngineConfig, addLog]);

  const editMessage = useCallback((messageId: string, newContent: string) => {
    setState(prev => {
      const updatedMessages = prev.messages.map(msg =>
        msg.id === messageId ? { ...msg, content: newContent, timestamp: Date.now() } : msg
      );
      saveChatToStore(updatedMessages);
      addLog(`[CharacterTestChat] Message ${messageId} edited`, 'info');
      return { ...prev, messages: updatedMessages };
    });
  }, [saveChatToStore, addLog]);

  return {
    state,
    sendMessage,
    continueConversation,
    retryMessage,
    editMessage,
    clearChat,
    cancelRequest,
    // 新增返回
    selectedPersona,
    personas,
    characterConfig,
    updateConfig,
    resetParameters,
    getEffectiveParams,
    getActiveEngineConfig,
  };
}
