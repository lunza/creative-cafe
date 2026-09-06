// 角色对话业务逻辑Hooks — 新管线架构版本
// Spec: redesign-dialogue-pipeline-architecture / Task 14
// 使用 DialoguePipeline 替代单体 requestAIResponse / generateUserReply / polishInput。
// 返回值接口与旧版本完全一致，UI 层无需修改。

import { useState, useReducer, useCallback, useRef, useEffect, useMemo } from 'react';
import { message } from 'antd';
import { useSettingStore } from '../../../stores/settingStore';
import { useCharacterChatStore } from '../../../stores/characterChatStore';
import { useLogStore } from '../../../stores/logStore';
import { ChatMessage, CharacterInfo, UserPersona, EffectiveAIParams, deriveThinkTagMode } from './CharacterDialogueChat.types';
import { chatReducer, initialChatState } from './chatReducer';
import { AIEngineConfig, AIResponse, getDefaultEngineCapabilities } from '../../Common/ChatEngine/ChatEngine.types';
import { TokenCounter, ContextTruncator, DEFAULT_MAX_TOKENS } from './TokenManagement';
// Spec: analyze-llamacpp-model-compatibility（兜底值与模型系列模板同源）
import { GENERIC_MODEL_PARAMS } from '../../../../shared/modelParameterPresets';
import type { TruncationConfig } from './TokenManagement/types';
import { shouldCompact, splitMessages, buildSummaryPrompt, createSummaryMessage, KEEP_RECENT_ROUNDS } from './contextCompactor';
import { ChatEngineFactory } from '../../Common/ChatEngine/ChatEngine.factory';
import { buildStopSequencesForUserReply, buildUserReplySystemPrompt, buildPolishInputSystemPrompt } from './PromptBuilder';
import { stripThinkingTags } from './utils/messageProcessor';
import { DialoguePipeline } from './pipeline/DialoguePipeline';
import type { PipelineInput, PipelineCallbacks } from './pipeline/DialoguePipeline';
import type { SuggestedOption } from './pipeline/pipeline.types';

export function shouldStrengthenLength(history: number[], threshold: number): boolean {
  if (!Array.isArray(history) || history.length < 3) return false;
  if (!threshold || threshold <= 0) return false;
  const last3 = history.slice(-3);
  return last3.every(len => typeof len === 'number' && len > 0 && len < threshold);
}

// ==================== 角色配置 Hook（保持不变） ====================

const STORAGE_KEY_PREFIX = 'character-session-';

function getStoredConfig(characterCardId: string) {
  try { const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${characterCardId}`); if (!raw) return null; return JSON.parse(raw); } catch { return null; }
}
function saveStoredConfig(characterCardId: string, config: any) {
  try { localStorage.setItem(`${STORAGE_KEY_PREFIX}${characterCardId}`, JSON.stringify(config)); } catch { /* ignore */ }
}

export function useCharacterConfig(characterCardId: string) {
  const setting = useSettingStore(state => state.setting);
  const [config, setConfig] = useState(() => getStoredConfig(characterCardId));
  const configRef = useRef(config);
  useEffect(() => { const stored = getStoredConfig(characterCardId); setConfig(stored); configRef.current = stored; }, [characterCardId]);
  const updateConfig = useCallback((updates: Partial<typeof config> | ((prev: typeof config | null) => Partial<typeof config>)) => {
    const currentConfig = configRef.current;
    const resolvedUpdates = typeof updates === 'function' ? updates(currentConfig) : updates;
    const next = { ...currentConfig, ...resolvedUpdates, characterCardId, lastUpdated: Date.now() };
    configRef.current = next; setConfig(next); saveStoredConfig(characterCardId, next);
  }, [characterCardId]);
  const clearConfig = useCallback(() => { try { localStorage.removeItem(`${STORAGE_KEY_PREFIX}${characterCardId}`); } catch { /* ignore */ } setConfig(null); }, [characterCardId]);
  const resetParameters = useCallback(() => { setConfig(prev => { const next = prev ? { ...prev, customParameters: undefined, lastUpdated: Date.now() } : null; saveStoredConfig(characterCardId, next); return next; }); }, [characterCardId]);
  const getEffectiveParams = useCallback((): EffectiveAIParams => {
    const currentConfig = configRef.current;
    const customParams = currentConfig?.customParameters || {};
    const globalEngine = (() => { if (!setting || !setting.aiEngines || setting.aiEngines.length === 0) return null; if (setting.activeEngineId) { return setting.aiEngines.find((e: any) => e.id === setting.activeEngineId) || setting.aiEngines[0]; } return setting.aiEngines[0]; })();
    const hasCustomParams = Object.keys(customParams).length > 0;
    const source = hasCustomParams ? 'custom' : 'global';
    const effectiveParams: EffectiveAIParams = { temperature: customParams.temperature ?? globalEngine?.temperature ?? GENERIC_MODEL_PARAMS.temperature, max_tokens: customParams.max_tokens !== undefined ? customParams.max_tokens : (globalEngine?.max_tokens !== undefined ? globalEngine.max_tokens : DEFAULT_MAX_TOKENS), source };
    if (customParams.top_p !== undefined) effectiveParams.top_p = customParams.top_p; else if (globalEngine?.top_p !== undefined) effectiveParams.top_p = globalEngine.top_p;
    if (customParams.frequency_penalty !== undefined) effectiveParams.frequency_penalty = customParams.frequency_penalty; else if (globalEngine?.frequency_penalty !== undefined) effectiveParams.frequency_penalty = globalEngine.frequency_penalty;
    if (customParams.presence_penalty !== undefined) effectiveParams.presence_penalty = customParams.presence_penalty; else if (globalEngine?.presence_penalty !== undefined) effectiveParams.presence_penalty = globalEngine.presence_penalty;
    if (customParams.repetition_penalty !== undefined) effectiveParams.repetition_penalty = customParams.repetition_penalty; else if (globalEngine?.rep_pen !== undefined) effectiveParams.repetition_penalty = globalEngine.rep_pen;
    if (customParams.dry_multiplier !== undefined) effectiveParams.dry_multiplier = customParams.dry_multiplier; else if (globalEngine?.dry_multiplier !== undefined) effectiveParams.dry_multiplier = globalEngine.dry_multiplier;
    if (customParams.dry_base !== undefined) effectiveParams.dry_base = customParams.dry_base; else if (globalEngine?.dry_base !== undefined) effectiveParams.dry_base = globalEngine.dry_base;
    if (customParams.dry_allowed_length !== undefined) effectiveParams.dry_allowed_length = customParams.dry_allowed_length; else if (globalEngine?.dry_allowed_length !== undefined) effectiveParams.dry_allowed_length = globalEngine.dry_allowed_length;
    if (customParams.no_repeat_ngram_size !== undefined) effectiveParams.no_repeat_ngram_size = customParams.no_repeat_ngram_size; else if (globalEngine?.no_repeat_ngram_size !== undefined) effectiveParams.no_repeat_ngram_size = globalEngine.no_repeat_ngram_size;
    if (customParams.top_k !== undefined) effectiveParams.top_k = customParams.top_k; else if (globalEngine?.top_k !== undefined) effectiveParams.top_k = globalEngine.top_k;
    if (customParams.min_p !== undefined) effectiveParams.min_p = customParams.min_p; else if (globalEngine?.min_p !== undefined) effectiveParams.min_p = globalEngine.min_p;
    return effectiveParams;
  }, [config, setting]);
  return { config, updateConfig, clearConfig, resetParameters, getEffectiveParams };
}

// ==================== 人设加载 Hook（保持不变） ====================

export function usePersonas() {
  const [personas, setPersonas] = useState<UserPersona[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    const loadPersonas = async () => {
      try {
        const avatarList = await window.electronAPI.avatar.list();
        if (mounted) {
          const loadedPersonas: UserPersona[] = [];
          for (const avatar of avatarList) {
            if (avatar.path.endsWith('.json') && !avatar.path.includes('user-profile.json')) {
              try { const content = await window.electronAPI.avatar.read(avatar.path); if (content) { loadedPersonas.push({ id: content.id || avatar.name.replace('.json', ''), name: content.name || '未命名', description: content.description || '', avatarPath: content.avatarPath || '', isGeneric: content.isGeneric || false, isSystem: content.isSystem || false }); } } catch (error) { console.error(`[CharacterDialogueChat] Failed to read persona ${avatar.name}:`, error); }
            }
          }
          setPersonas(loadedPersonas);
        }
      } catch (error) { console.error('[CharacterDialogueChat] Failed to load personas:', error); if (mounted) setPersonas([]); }
      finally { if (mounted) setLoading(false); }
    };
    loadPersonas();
    return () => { mounted = false; };
  }, []);
  return { personas, loading };
}

// ==================== 主对话 Hook（管线架构重写） ====================

export function useCharacterDialogueChat(characterInfo: CharacterInfo) {
  const setting = useSettingStore(state => state.setting);
  const saveTestChat = useCharacterChatStore(s => s.saveTestChat);
  const addLog = useLogStore(state => state.addLog);

  useEffect(() => { if (setting === null) { useSettingStore.getState().fetchSetting(); } }, []);

  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const { config: characterConfig, updateConfig, resetParameters, getEffectiveParams } = useCharacterConfig(characterInfo.characterCardId);
  const { personas, loading: personasLoading } = usePersonas();

  const messagesRef = useRef<ChatMessage[]>([]);
  const initialContentRef = useRef('');
  const isSavingRef = useRef(false);
  const memoryTableEnabledRef = useRef(false);
  const memoryTableAutoOrganizeRef = useRef(false);
  const memoryTableOrganizeModeRef = useRef<'sync' | 'async'>('sync');
  const memoryTableDataRef = useRef<string>('');
  const isOrganizingRef = useRef(false);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [isGeneratingUserReply, setIsGeneratingUserReply] = useState(false);
  const generatedReplyAccumulatedRef = useRef<string>('');
  const isGeneratingUserReplyRef = useRef<boolean>(false);
  const isGeneratingUserReplyAbortRef = useRef<boolean>(false);
  const [isPolishingInput, setIsPolishingInput] = useState(false);
  const polishedAccumulatedRef = useRef<string>('');
  const isPolishingInputRef = useRef<boolean>(false);
  const isPolishingInputAbortRef = useRef<boolean>(false);
  const versionListRef = useRef<Array<{ fileName: string; filePath: string; sequenceNumber: number; timestamp: number; messageCount: number; versionLinkId?: string }>>([]);
  const versionIndexRef = useRef<any>(null);
  const requestStartTimeRef = useRef<number>(0);
  const responseLengthHistoryRef = useRef<number[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);

  // DialoguePipeline 实例（组件生命周期内复用）
  const pipelineRef = useRef<DialoguePipeline | null>(null);
  if (pipelineRef.current === null) { pipelineRef.current = new DialoguePipeline(); }
  const pipeline = pipelineRef.current;

  const selectedPersonaId = characterConfig?.selectedPersonaId;
  const selectedPersona = useMemo(() => {
    if (personas.length === 0) return null;
    if (selectedPersonaId) { return personas.find(p => p.id === selectedPersonaId) || null; }
    return personas.find(p => p.isGeneric) || null;
  }, [selectedPersonaId, personas]);

  const saveChatToStore = useCallback(async (messages: ChatMessage[]) => {
    if (isSavingRef.current) return;
    try { isSavingRef.current = true; await saveTestChat(characterInfo.creativeId, characterInfo.characterCardId, characterInfo.characterCardName, messages); }
    catch (error) { addLog(`[CharacterDialogueChat] Failed to save chat: ${error}`, 'error'); }
    finally { isSavingRef.current = false; }
  }, [characterInfo, saveTestChat, addLog]);

  const saveConfig = useCallback(async () => {
    try {
      const configToSave = { ...characterConfig, characterCardId: characterInfo.characterCardId, characterCardName: characterInfo.characterCardName, lastUpdated: Date.now() };
      saveStoredConfig(characterInfo.characterCardId, configToSave);
      const result = await window.electronAPI.characterConfig.save(characterInfo.characterCardId, configToSave);
      if (result.success) { addLog(`[CharacterDialogueChat] Config saved for ${characterInfo.characterCardName}`, 'info'); message.success('设置已保存'); }
      else { message.error(`保存失败: ${result.error}`); addLog(`[CharacterDialogueChat] Failed to save config: ${result.error}`, 'error'); }
    } catch (error) { message.error('保存设置失败'); addLog(`[CharacterDialogueChat] Failed to save config: ${error}`, 'error'); }
  }, [characterConfig, characterInfo, addLog]);

  const bindKnowledgeBase = useCallback((documentId: string) => {
    const currentBoundIds = characterConfig?.boundKnowledgeBaseIds || [];
    if (currentBoundIds.includes(documentId)) { message.info('该知识库已绑定'); return; }
    updateConfig({ boundKnowledgeBaseIds: [...currentBoundIds, documentId] }); message.success('知识库绑定成功');
  }, [characterConfig, updateConfig]);

  const unbindKnowledgeBase = useCallback((documentId: string) => {
    const currentBoundIds = characterConfig?.boundKnowledgeBaseIds || [];
    updateConfig({ boundKnowledgeBaseIds: currentBoundIds.filter(id => id !== documentId) }); message.success('知识库解绑成功');
  }, [characterConfig, updateConfig]);

  useEffect(() => {
    let cancelled = false;
    const loadChatHistory = async () => {
      try {
        const savedChat = await window.electronAPI.characterChat.getTestChat(characterInfo.creativeId, characterInfo.characterCardId);
        if (cancelled) return;
        if (savedChat && savedChat.messages && savedChat.messages.length > 0) { dispatch({ type: 'UPDATE_MESSAGES', messages: savedChat.messages }); messagesRef.current = savedChat.messages; }
        else if (characterInfo.first_mes && characterInfo.first_mes.trim()) {
          const firstMessage: ChatMessage = { id: 'first-' + Date.now(), role: 'assistant', content: characterInfo.first_mes, timestamp: Date.now(), status: 'sent', speakerName: characterInfo.characterCardName };
          dispatch({ type: 'UPDATE_MESSAGES', messages: [firstMessage] }); messagesRef.current = [firstMessage]; await saveChatToStore([firstMessage]);
        }
      } catch (error) { addLog(`[CharacterDialogueChat] Failed to load chat history: ${error}`, 'error'); }
    };
    loadChatHistory();
    return () => { cancelled = true; };
  }, [characterInfo.creativeId, characterInfo.characterCardId]);

  useEffect(() => { messagesRef.current = state.messages; }, [state.messages]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.ai.failover.onFailover((data: { type: 'retry' | 'switch'; toProvider?: string; toModel?: string; reason: string; attempt?: number }) => {
      if (data.type === 'switch') message.info(`已切换到备用模型 ${data.toModel || data.toProvider || '未知'}`);
      else if (data.type === 'retry') message.warning(`请求失败，正在重试（第 ${data.attempt || 1} 次）…`);
    });
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    memoryTableEnabledRef.current = characterConfig?.memoryTableEnabled ?? false;
    memoryTableAutoOrganizeRef.current = characterConfig?.memoryTableAutoOrganize ?? false;
    memoryTableOrganizeModeRef.current = characterConfig?.memoryTableOrganizeMode ?? 'sync';
  }, [characterConfig?.memoryTableEnabled, characterConfig?.memoryTableAutoOrganize, characterConfig?.memoryTableOrganizeMode]);

  const getActiveEngineConfig = useCallback((): AIEngineConfig | null => {
    if (!setting || !setting.aiEngines || setting.aiEngines.length === 0) return null;
    if (setting.activeEngineId) { const engine = setting.aiEngines.find((e: any) => e.id === setting.activeEngineId); if (engine) return engine as AIEngineConfig; }
    return setting.aiEngines[0] as AIEngineConfig;
  }, [setting]);

  // ===== 辅助：构建 sessionConfig =====
  const buildSessionConfig = useCallback(() => ({
    characterCardId: characterInfo.characterCardId,
    customParameters: characterConfig?.customParameters,
    boundKnowledgeBaseIds: characterConfig?.boundKnowledgeBaseIds,
    memoryTableEnabled: characterConfig?.memoryTableEnabled,
    memoryTableAutoOrganize: characterConfig?.memoryTableAutoOrganize,
    memoryTableOrganizeMode: characterConfig?.memoryTableOrganizeMode,
    tokenManagementEnabled: characterConfig?.tokenManagementEnabled,
    maxContextTokens: characterConfig?.maxContextTokens,
    reservedForResponse: characterConfig?.reservedForResponse,
    minMessagesToKeep: characterConfig?.minMessagesToKeep,
    maxMessagesToKeep: characterConfig?.maxMessagesToKeep,
    customStopSequencesEnabled: characterConfig?.customStopSequencesEnabled,
    customStopSequences: characterConfig?.customStopSequences,
    userReplyPerson: characterConfig?.userReplyPerson,
    selectedPersonaId: characterConfig?.selectedPersonaId,
    lastUpdated: Date.now(),
  }), [characterInfo.characterCardId, characterConfig]);

  // ===== 辅助：构建 PipelineCallbacks =====
  const createPipelineCallbacks = useCallback((_targetMessageId: string): PipelineCallbacks => ({
    onStreamUpdate: (msgId: string, accumulatedContent: string) => { dispatch({ type: 'STREAM_CHUNK', targetMessageId: msgId, content: accumulatedContent }); },
    onMessageUpdate: (msgId: string, content: string, options?: { emotion?: string | null; suggestedOptions?: SuggestedOption[] | null }) => {
      const currentState = stateRef.current;
      const finalMessages = currentState.messages.map(msg => msg.id === msgId ? { ...msg, content, status: 'sent' as const, suggestedOptions: options?.suggestedOptions && options.suggestedOptions.length > 0 ? options.suggestedOptions.map(o => o.text) : undefined, emotion: options?.emotion || undefined } : msg);
      dispatch({ type: 'STREAM_COMPLETE', messages: finalMessages });
    },
    onError: (msgId: string, error: string) => {
      const currentState = stateRef.current;
      const targetMsg = currentState.messages.find(m => m.id === msgId);
      dispatch({ type: 'STREAM_ERROR', targetMessageId: msgId, content: targetMsg?.content || error, error });
      message.error(`AI 回复失败: ${error}`);
    },
    onEmotionUpdate: (msgId: string, emotion: string) => {
      const currentState = stateRef.current;
      dispatch({ type: 'UPDATE_MESSAGES', messages: currentState.messages.map(msg => msg.id === msgId ? { ...msg, emotion } : msg) });
    },
    onOptionsRender: (msgId: string, options: SuggestedOption[]) => {
      const currentState = stateRef.current;
      dispatch({ type: 'UPDATE_MESSAGES', messages: currentState.messages.map(msg => msg.id === msgId ? { ...msg, suggestedOptions: options.map(o => o.text) } : msg) });
    },
    onSaveChat: (messages: ChatMessage[]) => {
      const messagesToSave = messages.map(msg => ({ id: msg.id, role: msg.role, content: msg.content, timestamp: msg.timestamp, status: msg.status, speakerName: msg.speakerName, suggestedOptions: msg.suggestedOptions, emotion: msg.emotion }));
      saveChatToStore(messagesToSave).catch(err => { addLog(`[CharacterDialogueChat] Failed to save chat: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error'); });
    },
    onSyncOrganize: () => {
      if (isOrganizingRef.current) return;
      setTimeout(async () => {
        try {
          isOrganizingRef.current = true; setIsOrganizing(true);
          const chatId = characterInfo.characterCardName || characterInfo.characterCardId;
          const activeEngine = getActiveEngineConfig();
          if (activeEngine) { await window.electronAPI.memory.processChatProgressive(chatId, '', { apiKey: activeEngine.api_key || '', apiUrl: activeEngine.api_url || '', modelName: activeEngine.model_name || '', apiMode: activeEngine.api_mode || 'chat_completion' }, { continueFromLast: true, minInterval: 3000 }); }
        } catch (error) { addLog(`[CharacterDialogueChat] Memory table auto-organization failed: ${error}`, 'error'); }
        finally { isOrganizingRef.current = false; setIsOrganizing(false); }
      }, 2000);
    },
    onTokenUsageUpdate: (used: number, total: number) => { dispatch({ type: 'SET_TOKEN_USAGE', usage: { used, total } }); },
  }), [characterInfo, getActiveEngineConfig, saveChatToStore, addLog]);

  const getTruncationConfig = useCallback((): TruncationConfig => ({
    enabled: characterConfig?.tokenManagementEnabled ?? false, maxContextTokens: characterConfig?.maxContextTokens ?? 256000, reservedForResponse: characterConfig?.reservedForResponse ?? 4096, minMessagesToKeep: characterConfig?.minMessagesToKeep ?? 3, maxMessagesToKeep: characterConfig?.maxMessagesToKeep ?? 60,
  }), [characterConfig]);

  // ===== sendMessage =====
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || state.isStreaming) return;
    const userId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const userMessage: ChatMessage = { id: userId, role: 'user', content: content.trim(), timestamp: Date.now(), status: 'sent', speakerName: selectedPersona?.name || characterInfo.characterCardName };
    const aiMessageId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const newMessages: ChatMessage[] = [...state.messages, userMessage, { id: aiMessageId, role: 'assistant', content: '', timestamp: Date.now(), status: 'sending' as const, speakerName: characterInfo.characterCardName }];
    dispatch({ type: 'SEND_MESSAGE', messages: newMessages });
    const activeEngine = getActiveEngineConfig();
    if (!activeEngine) { message.warning('请先在设置中配置AI引擎'); dispatch({ type: 'STREAM_ERROR', targetMessageId: aiMessageId, content: '请先配置AI引擎', error: null }); return; }
    const contextMessages = [...state.messages, userMessage];
    const callbacks = createPipelineCallbacks(aiMessageId);
    const messagesToSave = [...contextMessages, { id: aiMessageId, role: 'assistant' as const, content: '', timestamp: Date.now(), status: 'sending' as const, speakerName: characterInfo.characterCardName }];
    const chatId = characterInfo.characterCardName || characterInfo.characterCardId;
    const isSyncMode = memoryTableAutoOrganizeRef.current && memoryTableOrganizeModeRef.current === 'sync';
    const pipelineInput: PipelineInput = { userInput: content.trim(), userAction: { type: 'sendMessage', text: content.trim() }, characterInfo, sessionConfig: buildSessionConfig(), activeEngine, pipelineMode: 'dialogue', selectedPersona, contextMessages, targetMessageId: aiMessageId, knowledgeBaseScopeIds: characterConfig?.boundKnowledgeBaseIds ?? [], truncationConfig: getTruncationConfig(), callbacks, taskRuntimeData: { messagesToSave, messageCount: contextMessages.length + 1, chatId, characterCardId: characterInfo.characterCardId, isSyncMode, maxDedupRetries: 2 } };
    requestStartTimeRef.current = Date.now();
    const result = await pipeline.execute(pipelineInput);
    if (!result.success) addLog(`[CharacterDialogueChat] Pipeline failed: ${result.error}`, 'error');
    else responseLengthHistoryRef.current = [...responseLengthHistoryRef.current, result.context.processedContent.length].slice(-20);
  }, [state.messages, state.isStreaming, selectedPersona, characterInfo, characterConfig, getActiveEngineConfig, createPipelineCallbacks, getTruncationConfig, buildSessionConfig, pipeline, addLog]);

  // ===== continueConversation =====
  const continueConversation = useCallback(async () => {
    if (state.isStreaming) { message.warning('请等待当前回复完成'); return; }
    const currentMessages = messagesRef.current;
    if (currentMessages.length === 0) { message.warning('请先开始对话'); return; }
    const lastMessage = currentMessages[currentMessages.length - 1];
    if (lastMessage.role !== 'assistant') { message.warning('请先发送消息，等待AI回复后再使用续写功能'); return; }
    if (lastMessage.status === 'sending') { message.warning('请等待当前回复完成'); return; }
    const targetMessageId = lastMessage.id;
    const existingContent = lastMessage.content || '';
    addLog(`[CharacterDialogueChat] Continue conversation: message has ${existingContent.length} chars`, 'info');
    const continueMessages = messagesRef.current.map(msg => msg.id === targetMessageId ? { ...msg, status: 'sending' as const } : msg);
    dispatch({ type: 'SEND_MESSAGE', messages: continueMessages });
    const activeEngine = getActiveEngineConfig();
    if (!activeEngine) { message.warning('请先在设置中配置AI引擎'); return; }
    const callbacks = createPipelineCallbacks(targetMessageId);
    const chatId = characterInfo.characterCardName || characterInfo.characterCardId;
    const isSyncMode = memoryTableAutoOrganizeRef.current && memoryTableOrganizeModeRef.current === 'sync';
    const pipelineInput: PipelineInput = { userInput: '', userAction: { type: 'continueConversation' }, characterInfo, sessionConfig: buildSessionConfig(), activeEngine, pipelineMode: 'continuation', selectedPersona, contextMessages: currentMessages, targetMessageId, initialContent: existingContent, knowledgeBaseScopeIds: characterConfig?.boundKnowledgeBaseIds ?? [], truncationConfig: getTruncationConfig(), callbacks, taskRuntimeData: { messagesToSave: continueMessages, messageCount: currentMessages.length, chatId, characterCardId: characterInfo.characterCardId, isSyncMode, maxDedupRetries: 2 } };
    requestStartTimeRef.current = Date.now();
    const result = await pipeline.execute(pipelineInput);
    if (!result.success) addLog(`[CharacterDialogueChat] Pipeline failed: ${result.error}`, 'error');
  }, [state.isStreaming, selectedPersona, characterInfo, characterConfig, getActiveEngineConfig, createPipelineCallbacks, getTruncationConfig, buildSessionConfig, pipeline, addLog]);

  // ===== generateUserReply（直接使用 ChatEngineFactory，自定义系统提示与停止序列） =====
  const generateUserReply = useCallback(async (userInstruction?: string): Promise<string> => {
    if (!selectedPersona) { message.warning('请先在右侧面板选择用户人设'); return ''; }
    if (state.isStreaming || isOrganizing || isGeneratingUserReplyRef.current) return '';
    const activeEngine = getActiveEngineConfig();
    if (!activeEngine) { message.warning('请先在设置中配置AI引擎'); return ''; }
    setIsGeneratingUserReply(true); isGeneratingUserReplyRef.current = true; generatedReplyAccumulatedRef.current = ''; isGeneratingUserReplyAbortRef.current = false;
    const effectiveParams = getEffectiveParams();
    const charName = characterInfo.characterCardName || 'Character';
    const customStopSequencesEnabled = characterConfig?.customStopSequencesEnabled === true;
    const customStopSequences = customStopSequencesEnabled ? (characterConfig?.customStopSequences || []) : undefined;
    const userReplySystemPrompt = buildUserReplySystemPrompt({ characterCardName: characterInfo.characterCardName, personality: characterInfo.personality, characterCardContent: characterInfo.characterCardContent, scenario: characterInfo.scenario, mes_example: characterInfo.mes_example, system_prompt: characterInfo.system_prompt, creator_notes: characterInfo.creator_notes }, selectedPersona, characterConfig?.userReplyPerson, userInstruction);
    const engineConfigWithParams: AIEngineConfig = { id: activeEngine.id, name: activeEngine.name, api_url: activeEngine.api_url, api_key: activeEngine.api_key, model_name: activeEngine.model_name, api_mode: activeEngine.api_mode, api_key_transmission: activeEngine.api_key_transmission, max_tokens: effectiveParams.max_tokens, system_prompt: activeEngine.system_prompt, temperature: effectiveParams.temperature, stopSequences: buildStopSequencesForUserReply(charName, customStopSequences), capabilities: activeEngine.capabilities || getDefaultEngineCapabilities(), enable_chain_of_thought: activeEngine.enable_chain_of_thought, use_function_calling: activeEngine.use_function_calling };
    if (effectiveParams.top_p !== undefined) engineConfigWithParams.top_p = Number(effectiveParams.top_p);
    if (effectiveParams.frequency_penalty !== undefined) engineConfigWithParams.frequency_penalty = Number(effectiveParams.frequency_penalty);
    if (effectiveParams.presence_penalty !== undefined) engineConfigWithParams.presence_penalty = Number(effectiveParams.presence_penalty);
    if (effectiveParams.repetition_penalty !== undefined) engineConfigWithParams.repetition_penalty = Number(effectiveParams.repetition_penalty);
    if (effectiveParams.dry_multiplier !== undefined) engineConfigWithParams.dry_multiplier = Number(effectiveParams.dry_multiplier);
    if (effectiveParams.dry_base !== undefined) engineConfigWithParams.dry_base = Number(effectiveParams.dry_base);
    if (effectiveParams.dry_allowed_length !== undefined) engineConfigWithParams.dry_allowed_length = Number(effectiveParams.dry_allowed_length);
    if (effectiveParams.no_repeat_ngram_size !== undefined) engineConfigWithParams.no_repeat_ngram_size = Number(effectiveParams.no_repeat_ngram_size);
    if (effectiveParams.top_k !== undefined) engineConfigWithParams.top_k = Number(effectiveParams.top_k);
    if (effectiveParams.min_p !== undefined) engineConfigWithParams.min_p = Number(effectiveParams.min_p);
    let contextMessages = messagesRef.current.filter(msg => msg.role !== 'system');
    const tokenManagementEnabled = characterConfig?.tokenManagementEnabled ?? false;
    if (tokenManagementEnabled) {
      const truncationConfig: TruncationConfig = { enabled: true, maxContextTokens: characterConfig?.maxContextTokens ?? 256000, reservedForResponse: characterConfig?.reservedForResponse ?? 4096, minMessagesToKeep: characterConfig?.minMessagesToKeep ?? 3, maxMessagesToKeep: characterConfig?.maxMessagesToKeep ?? 60 };
      try { await Promise.all([TokenCounter.precountMessages(contextMessages), TokenCounter.precountSystemPrompt(userReplySystemPrompt)]); } catch (err) { console.warn('[TokenManagement] generateUserReply precount failed:', err); }
      const systemPromptTokens = TokenCounter.countSystemPromptTokens(userReplySystemPrompt);
      const truncatedMessages = ContextTruncator.truncateMessages(contextMessages, systemPromptTokens, truncationConfig, undefined, undefined);
      const truncationAnalysis = ContextTruncator.analyzeTruncation(contextMessages, truncatedMessages, systemPromptTokens, truncationConfig);
      if (truncationAnalysis.wasTruncated) addLog(`[CharacterDialogueChat] generateUserReply context truncated: ${truncationAnalysis.originalCount} -> ${truncationAnalysis.truncatedCount} messages`, 'warn');
      contextMessages = truncatedMessages;
    }
    const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(engineConfigWithParams);
    addLog(`[CharacterDialogueChat] generateUserReply started (charName=${charName}, persona=${selectedPersona.name}, context=${contextMessages.length} msgs)`, 'info');
    return new Promise<string>((resolve, reject) => {
      engine.onStream((chunk: string) => { if (isGeneratingUserReplyAbortRef.current) return; if (chunk) generatedReplyAccumulatedRef.current += chunk; });
      engine.onComplete((response: AIResponse) => { const finalContent = response?.content || generatedReplyAccumulatedRef.current; addLog(`[CharacterDialogueChat] generateUserReply completed: ${finalContent.length} chars`, 'info'); resolve(finalContent); });
      engine.onError((error) => { console.error('[CharacterDialogueChat] generateUserReply error:', error); message.error(`生成用户回复失败: ${error.message}`); addLog(`[CharacterDialogueChat] generateUserReply error: ${error.message}`, 'error'); reject(new Error(error.message)); });
      engine.sendMessage(contextMessages, userReplySystemPrompt, engineConfigWithParams).catch((err: any) => { console.error('[CharacterDialogueChat] generateUserReply sendMessage threw:', err); message.error(`生成用户回复失败: ${err?.message || '未知错误'}`); reject(err instanceof Error ? err : new Error(String(err))); });
    }).finally(() => { setIsGeneratingUserReply(false); isGeneratingUserReplyRef.current = false; generatedReplyAccumulatedRef.current = ''; });
  }, [selectedPersona, state.isStreaming, isOrganizing, characterInfo, characterConfig, getActiveEngineConfig, getEffectiveParams, addLog]);

  // ===== polishInput（直接使用 ChatEngineFactory，自定义系统提示与停止序列） =====
  const polishInput = useCallback(async (originalText: string): Promise<string> => {
    if (!originalText || !originalText.trim()) { message.warning('请先输入需要润色的文本'); return ''; }
    if (!selectedPersona) { message.warning('请先在右侧面板选择用户人设'); return ''; }
    if (state.isStreaming || isOrganizing || isGeneratingUserReply || isPolishingInputRef.current) return '';
    const activeEngine = getActiveEngineConfig();
    if (!activeEngine) { message.warning('请先在设置中配置AI引擎'); return ''; }
    setIsPolishingInput(true); isPolishingInputRef.current = true; polishedAccumulatedRef.current = ''; isPolishingInputAbortRef.current = false;
    const effectiveParams = getEffectiveParams();
    const charName = characterInfo.characterCardName || 'Character';
    const customStopSequencesEnabled = characterConfig?.customStopSequencesEnabled === true;
    const customStopSequences = customStopSequencesEnabled ? (characterConfig?.customStopSequences || []) : undefined;
    let contextMessages = messagesRef.current.filter(msg => msg.role !== 'system');
    const polishSystemPromptForCounting = buildPolishInputSystemPrompt({ characterCardName: characterInfo.characterCardName, personality: characterInfo.personality, characterCardContent: characterInfo.characterCardContent, scenario: characterInfo.scenario, mes_example: characterInfo.mes_example, system_prompt: characterInfo.system_prompt, creator_notes: characterInfo.creator_notes }, selectedPersona, originalText, characterConfig?.userReplyPerson);
    const engineConfigWithParams: AIEngineConfig = { id: activeEngine.id, name: activeEngine.name, api_url: activeEngine.api_url, api_key: activeEngine.api_key, model_name: activeEngine.model_name, api_mode: activeEngine.api_mode, api_key_transmission: activeEngine.api_key_transmission, max_tokens: effectiveParams.max_tokens, system_prompt: activeEngine.system_prompt, temperature: effectiveParams.temperature, stopSequences: buildStopSequencesForUserReply(charName, customStopSequences), capabilities: activeEngine.capabilities || getDefaultEngineCapabilities(), enable_chain_of_thought: activeEngine.enable_chain_of_thought, use_function_calling: activeEngine.use_function_calling };
    if (effectiveParams.top_p !== undefined) engineConfigWithParams.top_p = Number(effectiveParams.top_p);
    if (effectiveParams.frequency_penalty !== undefined) engineConfigWithParams.frequency_penalty = Number(effectiveParams.frequency_penalty);
    if (effectiveParams.presence_penalty !== undefined) engineConfigWithParams.presence_penalty = Number(effectiveParams.presence_penalty);
    if (effectiveParams.repetition_penalty !== undefined) engineConfigWithParams.repetition_penalty = Number(effectiveParams.repetition_penalty);
    if (effectiveParams.dry_multiplier !== undefined) engineConfigWithParams.dry_multiplier = Number(effectiveParams.dry_multiplier);
    if (effectiveParams.dry_base !== undefined) engineConfigWithParams.dry_base = Number(effectiveParams.dry_base);
    if (effectiveParams.dry_allowed_length !== undefined) engineConfigWithParams.dry_allowed_length = Number(effectiveParams.dry_allowed_length);
    if (effectiveParams.no_repeat_ngram_size !== undefined) engineConfigWithParams.no_repeat_ngram_size = Number(effectiveParams.no_repeat_ngram_size);
    if (effectiveParams.top_k !== undefined) engineConfigWithParams.top_k = Number(effectiveParams.top_k);
    if (effectiveParams.min_p !== undefined) engineConfigWithParams.min_p = Number(effectiveParams.min_p);
    const tokenManagementEnabled = characterConfig?.tokenManagementEnabled ?? false;
    if (tokenManagementEnabled) {
      const truncationConfig: TruncationConfig = { enabled: true, maxContextTokens: characterConfig?.maxContextTokens ?? 256000, reservedForResponse: characterConfig?.reservedForResponse ?? 4096, minMessagesToKeep: characterConfig?.minMessagesToKeep ?? 3, maxMessagesToKeep: characterConfig?.maxMessagesToKeep ?? 60 };
      try { await Promise.all([TokenCounter.precountMessages(contextMessages), TokenCounter.precountSystemPrompt(polishSystemPromptForCounting)]); } catch (err) { console.warn('[TokenManagement] polishInput precount failed:', err); }
      const systemPromptTokens = TokenCounter.countSystemPromptTokens(polishSystemPromptForCounting);
      const truncatedMessages = ContextTruncator.truncateMessages(contextMessages, systemPromptTokens, truncationConfig, undefined, undefined);
      const truncationAnalysis = ContextTruncator.analyzeTruncation(contextMessages, truncatedMessages, systemPromptTokens, truncationConfig);
      if (truncationAnalysis.wasTruncated) addLog(`[CharacterDialogueChat] polishInput context truncated: ${truncationAnalysis.originalCount} -> ${truncationAnalysis.truncatedCount} messages`, 'warn');
      contextMessages = truncatedMessages;
    }
    const polishSystemPrompt = buildPolishInputSystemPrompt({ characterCardName: characterInfo.characterCardName, personality: characterInfo.personality, characterCardContent: characterInfo.characterCardContent, scenario: characterInfo.scenario, mes_example: characterInfo.mes_example, system_prompt: characterInfo.system_prompt, creator_notes: characterInfo.creator_notes }, selectedPersona, originalText, characterConfig?.userReplyPerson, contextMessages);
    const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(engineConfigWithParams);
    addLog(`[CharacterDialogueChat] polishInput started (charName=${charName}, persona=${selectedPersona.name}, context=${contextMessages.length} msgs, original=${originalText.length} chars)`, 'info');
    return new Promise<string>((resolve, reject) => {
      engine.onStream((chunk: string) => { if (isPolishingInputAbortRef.current) return; if (chunk) polishedAccumulatedRef.current += chunk; });
      engine.onComplete((response: AIResponse) => { let finalContent = response?.content || polishedAccumulatedRef.current; if (deriveThinkTagMode(characterConfig?.customParameters) === 'strip') { finalContent = stripThinkingTags(finalContent); } addLog(`[CharacterDialogueChat] polishInput completed: ${finalContent.length} chars`, 'info'); resolve(finalContent); });
      engine.onError((error) => { console.error('[CharacterDialogueChat] polishInput error:', error); message.error(`润色输入失败: ${error.message}`); addLog(`[CharacterDialogueChat] polishInput error: ${error.message}`, 'error'); reject(new Error(error.message)); });
      const polishRequestMessages: ChatMessage[] = [{ id: `polish-request-${Date.now()}`, role: 'user', content: '请润色上述 <polish_target> 标签内的文本，直接输出润色后的文本本身。', timestamp: Date.now(), status: 'sent' }];
      engine.sendMessage(polishRequestMessages, polishSystemPrompt, engineConfigWithParams).catch((err: any) => { console.error('[CharacterDialogueChat] polishInput sendMessage threw:', err); message.error(`润色输入失败: ${err?.message || '未知错误'}`); reject(err instanceof Error ? err : new Error(String(err))); });
    }).finally(() => { setIsPolishingInput(false); isPolishingInputRef.current = false; polishedAccumulatedRef.current = ''; });
  }, [selectedPersona, state.isStreaming, isOrganizing, isGeneratingUserReply, characterInfo, characterConfig, getActiveEngineConfig, getEffectiveParams, addLog]);
  // ===== retryMessage =====
  const retryMessage = useCallback(async (messageId: string) => {
    if (state.isStreaming) { message.warning('请等待当前回复完成'); return; }
    const existingMessage = messagesRef.current.find(m => m.id === messageId);
    if (!existingMessage) { message.error('Message not found'); return; }
    const messagesBeforeRetry = messagesRef.current.filter(m => m.id !== messageId);
    const newRetryMessage: ChatMessage = { id: messageId, role: 'assistant', content: '', timestamp: Date.now(), status: 'sending' };
    dispatch({ type: 'UPDATE_MESSAGES', messages: [...messagesBeforeRetry, newRetryMessage] });
    dispatch({ type: 'SET_LOADING', isLoading: true, isStreaming: true });
    const activeEngine = getActiveEngineConfig();
    if (!activeEngine) { message.warning('请先在设置中配置AI引擎'); return; }
    const callbacks = createPipelineCallbacks(messageId);
    const chatId = characterInfo.characterCardName || characterInfo.characterCardId;
    const isSyncMode = memoryTableAutoOrganizeRef.current && memoryTableOrganizeModeRef.current === 'sync';
    const pipelineInput: PipelineInput = { userInput: '', userAction: { type: 'retryMessage', targetMessageId: messageId }, characterInfo, sessionConfig: buildSessionConfig(), activeEngine, pipelineMode: 'retry', selectedPersona, contextMessages: messagesBeforeRetry, targetMessageId: messageId, knowledgeBaseScopeIds: characterConfig?.boundKnowledgeBaseIds ?? [], truncationConfig: getTruncationConfig(), callbacks, taskRuntimeData: { messagesToSave: [...messagesBeforeRetry, newRetryMessage], messageCount: messagesBeforeRetry.length + 1, chatId, characterCardId: characterInfo.characterCardId, isSyncMode, maxDedupRetries: 2 } };
    requestStartTimeRef.current = Date.now();
    const result = await pipeline.execute(pipelineInput);
    if (!result.success) addLog(`[CharacterDialogueChat] Pipeline failed: ${result.error}`, 'error');
  }, [state.isStreaming, selectedPersona, characterInfo, characterConfig, getActiveEngineConfig, createPipelineCallbacks, getTruncationConfig, buildSessionConfig, pipeline, addLog]);

  // ===== clearChat / clearError / cancelRequest =====
  const clearChat = useCallback(async () => {
    if (state.isStreaming) { pipeline.getAIService().cancel(); }
    dispatch({ type: 'CLEAR_MESSAGES' });
    messagesRef.current = [];
    await saveChatToStore([]);
    addLog('[CharacterDialogueChat] Chat cleared', 'info');
    message.success('对话已清空');
  }, [state.isStreaming, pipeline, saveChatToStore, addLog]);

  const clearError = useCallback(() => { dispatch({ type: 'CLEAR_ERROR' }); }, []);

  const cancelRequest = useCallback(() => {
    if (isGeneratingUserReplyRef.current) { isGeneratingUserReplyAbortRef.current = true; isGeneratingUserReplyRef.current = false; setIsGeneratingUserReply(false); addLog('[CharacterDialogueChat] User reply generation cancelled', 'info'); }
    if (isPolishingInputRef.current) { isPolishingInputAbortRef.current = true; addLog('[CharacterDialogueChat] Polish input cancelled', 'info'); }
    pipeline.getAIService().cancel();
    const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(getActiveEngineConfig() || {} as AIEngineConfig);
    engine.cancelRequest();
    dispatch({ type: 'SET_LOADING', isLoading: false, isStreaming: false });
    addLog('[CharacterDialogueChat] Request cancelled', 'info');
    initialContentRef.current = '';
  }, [pipeline, getActiveEngineConfig, addLog]);

  // ===== editMessage / rollbackToMessage =====
  const editMessage = useCallback((messageId: string, newContent: string) => {
    const updatedMessages = messagesRef.current.map(msg => msg.id === messageId ? { ...msg, content: newContent, timestamp: Date.now() } : msg);
    saveChatToStore(updatedMessages);
    addLog(`[CharacterDialogueChat] Message ${messageId} edited`, 'info');
    dispatch({ type: 'UPDATE_MESSAGES', messages: updatedMessages });
  }, [saveChatToStore, addLog]);

  const rollbackToMessage = useCallback((messageId: string): string => {
    const currentMessages = messagesRef.current;
    const messageIndex = currentMessages.findIndex(msg => msg.id === messageId);
    if (messageIndex === -1) { addLog(`[CharacterDialogueChat] Rollback failed: message ${messageId} not found`, 'warn'); return ''; }
    const targetMessage = currentMessages[messageIndex];
    if (targetMessage.role !== 'user') { addLog(`[CharacterDialogueChat] Rollback failed: message ${messageId} is not a user message`, 'warn'); return ''; }
    const rolledBackContent = targetMessage.content;
    const updatedMessages = currentMessages.slice(0, messageIndex);
    const removedCount = currentMessages.length - messageIndex;
    if (state.isStreaming) { cancelRequest(); }
    messagesRef.current = updatedMessages;
    dispatch({ type: 'UPDATE_MESSAGES', messages: updatedMessages });
    dispatch({ type: 'SET_LOADING', isLoading: false, isStreaming: false });
    dispatch({ type: 'CLEAR_ERROR' });
    saveChatToStore(updatedMessages);
    addLog(`[CharacterDialogueChat] Rolled back to message ${messageId}, removed ${removedCount} messages`, 'info');
    return rolledBackContent;
  }, [state.isStreaming, cancelRequest, saveChatToStore, addLog]);

  // ===== 记忆表格 =====
  const memoryTableEnabled = characterConfig?.memoryTableEnabled ?? false;
  const memoryTableAutoOrganize = characterConfig?.memoryTableAutoOrganize ?? false;
  const memoryTableOrganizeMode = (characterConfig?.memoryTableOrganizeMode ?? 'sync') as 'sync' | 'async';

  const fetchMemoryTableData = useCallback(async () => {
    if (!memoryTableEnabled) { memoryTableDataRef.current = ''; return; }
    try {
      const chatId = characterInfo.characterCardName || characterInfo.characterCardId;
      const tableResult = await window.electronAPI.memory.getTableData(chatId);
      if (tableResult && tableResult.sheets && tableResult.sheets.length > 0 && tableResult.data) {
        let formattedData = '# 记忆表格数据\n\n';
        for (const sheetName of tableResult.sheets) {
          const sheetHeaders = tableResult.headers?.[sheetName] || [];
          const sheetRows = tableResult.data?.[sheetName] || [];
          formattedData += `## 表格: ${sheetName}\n\n`;
          if (sheetHeaders.length > 0) { formattedData += '| ' + sheetHeaders.join(' | ') + ' |\n'; formattedData += '| ' + sheetHeaders.map(() => '---').join(' | ') + ' |\n'; }
          if (sheetRows.length > 0) { for (const row of sheetRows) { const cells = sheetHeaders.map(h => { const val = row[h]; return val !== undefined && val !== null ? String(val) : ''; }); formattedData += '| ' + cells.join(' | ') + ' |\n'; } }
          formattedData += '\n';
        }
        memoryTableDataRef.current = formattedData;
        const totalRows = tableResult.sheets.reduce((sum: number, sn: string) => sum + (tableResult.data?.[sn]?.length || 0), 0);
        addLog(`[CharacterDialogueChat] Memory table data loaded: ${tableResult.sheets.length} sheets, ${totalRows} rows`, 'info');
      } else { memoryTableDataRef.current = ''; addLog('[CharacterDialogueChat] No memory table data found', 'info'); }
    } catch (error) { memoryTableDataRef.current = ''; addLog(`[CharacterDialogueChat] Failed to load memory table data: ${error}`, 'warn'); }
  }, [memoryTableEnabled, characterInfo.characterCardId, addLog]);

  const handleMemoryTableToggle = useCallback((enabled: boolean) => { updateConfig({ memoryTableEnabled: enabled }); addLog(`[CharacterDialogueChat] Memory table ${enabled ? 'enabled' : 'disabled'}`, 'info'); }, [updateConfig, addLog]);
  const handleMemoryTableAutoOrganizeToggle = useCallback((enabled: boolean) => { updateConfig({ memoryTableAutoOrganize: enabled }); addLog(`[CharacterDialogueChat] Memory table auto-organize ${enabled ? 'enabled' : 'disabled'}`, 'info'); }, [updateConfig, addLog]);
  const handleMemoryTableOrganizeModeChange = useCallback((mode: 'sync' | 'async') => { updateConfig({ memoryTableOrganizeMode: mode }); addLog(`[CharacterDialogueChat] Memory table organize mode changed to ${mode === 'sync' ? '同步整理' : '异步整理'}`, 'info'); }, [updateConfig, addLog]);
  const handleMemoryTableTemplateAssociate = useCallback((templateId: string, templateName: string) => { updateConfig({ memoryTableTemplateId: templateId, memoryTableTemplateName: templateName }); addLog(`[CharacterDialogueChat] Memory table template associated: ${templateName} (${templateId})`, 'info'); }, [updateConfig, addLog]);

  // ===== Token 管理 =====
  const tokenManagementConfig = useMemo(() => ({ enabled: characterConfig?.tokenManagementEnabled ?? false, maxContextTokens: characterConfig?.maxContextTokens ?? 256000, reservedForResponse: characterConfig?.reservedForResponse ?? 4096, minMessagesToKeep: characterConfig?.minMessagesToKeep ?? 3, maxMessagesToKeep: characterConfig?.maxMessagesToKeep ?? 60 }), [characterConfig]);
  const handleTokenManagementConfigChange = useCallback((config: Partial<typeof tokenManagementConfig>) => {
    const { enabled, ...rest } = config;
    const mappedConfig: Partial<typeof characterConfig> = { ...rest, ...(enabled !== undefined && { tokenManagementEnabled: enabled }) };
    updateConfig(mappedConfig);
    addLog(`[CharacterDialogueChat] Token management config updated: enabled=${enabled ?? characterConfig?.tokenManagementEnabled}`, 'info');
  }, [updateConfig, addLog, characterConfig]);

  const handleStopOrganizing = useCallback(async () => {
    const chatId = characterInfo.characterCardName || characterInfo.characterCardId;
    try {
      addLog(`[CharacterDialogueChat] Stopping organize task for: ${chatId}`, 'info');
      const result = await window.electronAPI.memory.stopOrganizing(chatId);
      if (result.success) { isOrganizingRef.current = false; setIsOrganizing(false); addLog('[CharacterDialogueChat] Organize task stopped successfully', 'info'); message.success('已停止表格整理'); }
      else { addLog('[CharacterDialogueChat] No active organize task to stop', 'warn'); message.warning('当前没有正在执行的整理任务'); }
    } catch (error) { addLog(`[CharacterDialogueChat] Failed to stop organizing: ${error}`, 'error'); message.error('停止整理失败'); }
  }, [characterInfo.characterCardName, characterInfo.characterCardId, addLog]);

  // ===== 版本管理 =====
  const loadVersions = useCallback(async () => {
    try {
      const versions = await window.electronAPI.chatVersion.getVersions(characterInfo.characterCardName);
      versionListRef.current = versions.sort((a, b) => a.timestamp - b.timestamp);
      try { const index = await window.electronAPI.chatVersion.getVersionIndex(characterInfo.characterCardName); versionIndexRef.current = index; } catch { versionIndexRef.current = null; }
      addLog(`[CharacterDialogueChat] Loaded ${versions.length} versions`, 'info');
    } catch (error) { addLog(`[CharacterDialogueChat] Failed to load versions: ${error}`, 'warn'); versionListRef.current = []; versionIndexRef.current = null; }
  }, [characterInfo.characterCardName, addLog]);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  const getVersionInfoForMessage = useCallback((message: ChatMessage): typeof message['versionInfo'] => {
    if (message.role !== 'assistant') return undefined;
    if (!versionListRef.current || versionListRef.current.length === 0) return undefined;
    const versions = versionListRef.current;
    const latestVersion = versions[versions.length - 1];
    const index = versionIndexRef.current;
    const getTableSnapshotExists = (vlid: string | undefined) => { if (!vlid || !index?.versions) return false; const record = index.versions.find((vr: any) => vr.versionLinkId === vlid); return record?.tableSnapshot?.exists ?? false; };
    const getConsistencyStatus = (vlid: string | undefined) => { if (!vlid || !index?.versions) return undefined; const record = index.versions.find((vr: any) => vr.versionLinkId === vlid); return record?.consistencyStatus as 'matched' | 'mismatched' | 'partial' | undefined; };
    for (let i = versions.length - 1; i >= 0; i--) {
      const v = versions[i];
      if (v.timestamp <= message.timestamp + 1000 && v.timestamp >= message.timestamp - 1000) {
        return { versionFilePath: v.filePath, isLatestVersion: v === latestVersion, versionSequenceNumber: v.sequenceNumber, versionLinkId: v.versionLinkId, tableSnapshotExists: getTableSnapshotExists(v.versionLinkId), consistencyStatus: getConsistencyStatus(v.versionLinkId), allVersions: versions.map(vv => ({ fileName: vv.fileName, filePath: vv.filePath, sequenceNumber: vv.sequenceNumber, timestamp: vv.timestamp, messageCount: vv.messageCount, versionLinkId: vv.versionLinkId, tableSnapshotExists: getTableSnapshotExists(vv.versionLinkId) })) };
      }
    }
    if (message === messagesRef.current[messagesRef.current.length - 1] && message.status === 'sent') {
      return { versionFilePath: latestVersion?.filePath || '', isLatestVersion: true, versionSequenceNumber: latestVersion?.sequenceNumber || 0, versionLinkId: latestVersion?.versionLinkId, tableSnapshotExists: getTableSnapshotExists(latestVersion?.versionLinkId), consistencyStatus: getConsistencyStatus(latestVersion?.versionLinkId), allVersions: versions.map(vv => ({ fileName: vv.fileName, filePath: vv.filePath, sequenceNumber: vv.sequenceNumber, timestamp: vv.timestamp, messageCount: vv.messageCount, versionLinkId: vv.versionLinkId, tableSnapshotExists: getTableSnapshotExists(vv.versionLinkId) })) };
    }
    return undefined;
  }, []);

  const retryMessageFromVersion = useCallback(async (versionFilePath: string) => {
    if (state.isStreaming) { message.warning('请等待当前回复完成'); return; }
    try {
      addLog(`[CharacterDialogueChat] Restoring from version: ${versionFilePath}`, 'info');
      const versionData = await window.electronAPI.chatVersion.getVersionContent(versionFilePath);
      if (!versionData || !versionData.messages) { message.error('版本数据无效'); return; }
      const restoredMessages: ChatMessage[] = versionData.messages.map((msg: any) => ({ ...msg, status: msg.status || 'sent' }));
      const messagesBeforeRetry = restoredMessages.slice(0, -1);
      const lastMessage = restoredMessages[restoredMessages.length - 1];
      if (!lastMessage || lastMessage.role !== 'assistant') { message.warning('版本数据格式不正确'); return; }
      const newEmptyMessage: ChatMessage = { id: Date.now().toString() + Math.random().toString(36).substr(2, 9), role: 'assistant', content: '', timestamp: Date.now(), status: 'sending', speakerName: characterInfo.characterCardName };
      messagesRef.current = [...messagesBeforeRetry, newEmptyMessage];
      dispatch({ type: 'SEND_MESSAGE', messages: [...messagesBeforeRetry, newEmptyMessage] });
      const activeEngine = getActiveEngineConfig();
      if (!activeEngine) { message.warning('请先在设置中配置AI引擎'); return; }
      const callbacks = createPipelineCallbacks(newEmptyMessage.id);
      const chatId = characterInfo.characterCardName || characterInfo.characterCardId;
      const isSyncMode = memoryTableAutoOrganizeRef.current && memoryTableOrganizeModeRef.current === 'sync';
      const pipelineInput: PipelineInput = { userInput: '', userAction: { type: 'retryMessage', targetMessageId: newEmptyMessage.id }, characterInfo, sessionConfig: buildSessionConfig(), activeEngine, pipelineMode: 'retry', selectedPersona, contextMessages: messagesBeforeRetry, targetMessageId: newEmptyMessage.id, knowledgeBaseScopeIds: characterConfig?.boundKnowledgeBaseIds ?? [], truncationConfig: getTruncationConfig(), callbacks, taskRuntimeData: { messagesToSave: [...messagesBeforeRetry, newEmptyMessage], messageCount: messagesBeforeRetry.length + 1, chatId, characterCardId: characterInfo.characterCardId, isSyncMode, maxDedupRetries: 2 } };
      requestStartTimeRef.current = Date.now();
      const result = await pipeline.execute(pipelineInput);
      if (!result.success) addLog(`[CharacterDialogueChat] Pipeline failed: ${result.error}`, 'error');
    } catch (error) { addLog(`[CharacterDialogueChat] Failed to restore from version: ${error}`, 'error'); message.error('从版本恢复失败'); }
  }, [state.isStreaming, selectedPersona, characterInfo, characterConfig, getActiveEngineConfig, createPipelineCallbacks, getTruncationConfig, buildSessionConfig, pipeline, addLog]);

  const stateWithVersionInfo = useMemo(() => {
    const messagesWithVersion = state.messages.map((msg) => { const versionInfo = getVersionInfoForMessage(msg); return { ...msg, versionInfo }; });
    return { ...state, messages: messagesWithVersion };
  }, [state, getVersionInfoForMessage]);

  // ===== 上下文压缩 =====
  const compressContext = useCallback(async () => {
    setIsCompressing(true);
    try {
      const currentMessages = messagesRef.current;
      if (currentMessages.length === 0) { message.info('没有可压缩的对话历史'); return; }
      const tokenUsage = stateRef.current.tokenUsage;
      if (!tokenUsage) { message.info('请先发送消息后再使用压缩功能'); return; }
      if (!shouldCompact(tokenUsage.used, tokenUsage.total)) { message.info('当前对话历史在合理范围内，无需压缩'); return; }
      addLog(`[Context] Starting context compaction: ${currentMessages.length} messages, ${tokenUsage.used}/${tokenUsage.total} tokens`, 'info');
      const { toSummarize, toKeep } = splitMessages(currentMessages, KEEP_RECENT_ROUNDS);
      if (toSummarize.length === 0) { message.info('没有需要压缩的旧对话'); return; }
      const activeEngine = getActiveEngineConfig();
      if (!activeEngine) { message.warning('请先配置 AI 引擎'); return; }
      const summaryPrompt = buildSummaryPrompt(toSummarize);
      const engineConfig: AIEngineConfig = { id: activeEngine.id, name: activeEngine.name, api_url: activeEngine.api_url, api_key: activeEngine.api_key, model_name: activeEngine.model_name, api_mode: activeEngine.api_mode, api_key_transmission: activeEngine.api_key_transmission, max_tokens: 2000, system_prompt: activeEngine.system_prompt, temperature: 0.3, capabilities: activeEngine.capabilities || getDefaultEngineCapabilities() };
      const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(engineConfig);
      const summary = await new Promise<string>((resolve, reject) => {
        let accumulated = '';
        engine.onStream((chunk: string) => { if (chunk) accumulated += chunk; });
        engine.onComplete((response: AIResponse) => { resolve(response?.content || accumulated); });
        engine.onError((error) => { reject(new Error(error.message)); });
        const requestMessages: ChatMessage[] = [{ id: `compaction-request-${Date.now()}`, role: 'user', content: summaryPrompt, timestamp: Date.now(), status: 'sent' }];
        engine.sendMessage(requestMessages, '你是一个对话摘要助手。请严格按照要求总结对话内容。', engineConfig).catch((err: unknown) => { reject(err instanceof Error ? err : new Error(String(err))); });
      });
      const summaryMessage = createSummaryMessage(summary);
      const compactedMessages = [summaryMessage, ...toKeep];
      addLog(`[Context] Compaction complete: ${currentMessages.length} -> ${compactedMessages.length} messages, summarized ${toSummarize.length} messages, kept ${toKeep.length} recent messages`, 'info');
      dispatch({ type: 'UPDATE_MESSAGES', messages: compactedMessages });
      messagesRef.current = compactedMessages;
      await saveChatToStore(compactedMessages);
      const newUsed = TokenCounter.countMessagesTokens(compactedMessages);
      dispatch({ type: 'SET_TOKEN_USAGE', usage: { used: newUsed, total: tokenUsage.total } });
      message.success(`对话历史已压缩：${currentMessages.length} → ${compactedMessages.length} 条消息`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLog(`[Context] Compaction failed, falling back to truncation: ${errorMsg}`, 'warn');
      message.warning(`压缩失败，已降级为裁剪模式：${errorMsg}`);
    } finally { setIsCompressing(false); }
  }, [getActiveEngineConfig, addLog, saveChatToStore]);

  return {
    state, stateWithVersionInfo, sendMessage, continueConversation, retryMessage,
    retryMessageFromVersion, editMessage, rollbackToMessage, clearChat, clearError,
    cancelRequest, selectedPersona, personas, personasLoading, characterConfig,
    updateConfig, saveConfig, resetParameters, getEffectiveParams, getActiveEngineConfig,
    bindKnowledgeBase, unbindKnowledgeBase, memoryTableEnabled, memoryTableAutoOrganize,
    memoryTableOrganizeMode, memoryTableTemplateId: characterConfig?.memoryTableTemplateId ?? null,
    memoryTableTemplateName: characterConfig?.memoryTableTemplateName ?? '', isOrganizing,
    generateUserReply, isGeneratingUserReply, polishInput, isPolishingInput,
    fetchMemoryTableData, handleMemoryTableToggle, handleMemoryTableAutoOrganizeToggle,
    handleMemoryTableOrganizeModeChange, handleMemoryTableTemplateAssociate,
    tokenManagementConfig, handleTokenManagementConfigChange, handleStopOrganizing,
    getMemoryTableData: () => memoryTableDataRef.current,
    tokenUsage: state.tokenUsage, compressContext, isCompressing,
  };
}
