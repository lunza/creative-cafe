// 角色对话业务逻辑Hooks

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { message } from 'antd';
import { useSettingStore } from '../../../stores/settingStore';
import { useCharacterChatStore } from '../../../stores/characterChatStore';
import { useLogStore } from '../../../stores/logStore';
import { ChatMessage, CharacterInfo, ChatState, UserPersona, EffectiveAIParams } from './CharacterDialogueChat.types';
import { ChatEngineFactory } from '../../Common/ChatEngine/ChatEngine.factory';
import { AIEngineConfig, AIResponse } from '../../Common/ChatEngine/ChatEngine.types';
import { usePromptBuilder } from './usePromptBuilder';
import { buildAsyncTableOrganizeInstructions } from './PromptBuilder';
import { TokenCounter, ContextTruncator } from './TokenManagement';
import type { TruncationConfig } from './TokenManagement/types';

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
  const setting = useSettingStore(state => state.setting);
  const [config, setConfig] = useState(() => getStoredConfig(characterCardId));
  const configRef = useRef(config);

  // 同步更新 ref，确保在状态更新的同一时刻 ref 也是最新的
  // 不依赖 useEffect（useEffect 在渲染完成后才执行，会导致闭包陈旧问题）

  useEffect(() => {
    const stored = getStoredConfig(characterCardId);
    setConfig(stored);
    configRef.current = stored; // 同步更新 ref
  }, [characterCardId]);

  const updateConfig = useCallback((updates: Partial<typeof config> | ((prev: typeof config | null) => Partial<typeof config>)) => {
    // 立即计算下一个状态，不依赖 setConfig 的异步回调
    const currentConfig = configRef.current;
    const resolvedUpdates = typeof updates === 'function' ? updates(currentConfig) : updates;
    const next = {
      ...currentConfig,
      ...resolvedUpdates,
      characterCardId,
      lastUpdated: Date.now(),
    };
    
    // 同步更新 ref，确保 sendMessage 能立即读取到最新配置
    configRef.current = next;
    
    // 触发 React 状态更新
    setConfig(next);
    saveStoredConfig(characterCardId, next);
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
    const currentConfig = configRef.current;
    const customParams = currentConfig?.customParameters || {};
    
    console.log(`[CharacterDialogueChat] getEffectiveParams - raw config:`, currentConfig);
    console.log(`[CharacterDialogueChat] getEffectiveParams - config.customParameters:`, currentConfig?.customParameters);
    console.log(`[CharacterDialogueChat] getEffectiveParams - customParams (processed):`, customParams);
    console.log(`[CharacterDialogueChat] getEffectiveParams - hasCustomParams:`, Object.keys(customParams).length > 0);
    
    // 获取全局配置的AI引擎参数
    const globalEngine = (() => {
      if (!setting || !setting.aiEngines || setting.aiEngines.length === 0) return null;
      if (setting.activeEngineId) {
        return setting.aiEngines.find((e: any) => e.id === setting.activeEngineId) || setting.aiEngines[0];
      }
      return setting.aiEngines[0];
    })();

    // 参数优先级：用户自定义参数 > 全局配置 > 默认值
    const hasCustomParams = Object.keys(customParams).length > 0;
    const source = hasCustomParams ? 'custom' : 'global';

    const effectiveParams: EffectiveAIParams = {
      temperature: customParams.temperature ?? globalEngine?.temperature ?? 0.7,
      max_tokens: customParams.max_tokens !== undefined ? customParams.max_tokens : (globalEngine?.max_tokens !== undefined ? globalEngine.max_tokens : 8192),
      source,
    };

    // 可选参数：top_p
    if (customParams.top_p !== undefined) {
      effectiveParams.top_p = customParams.top_p;
    } else if (globalEngine?.top_p !== undefined) {
      effectiveParams.top_p = globalEngine.top_p;
    }

    // 可选参数：frequency_penalty
    if (customParams.frequency_penalty !== undefined) {
      effectiveParams.frequency_penalty = customParams.frequency_penalty;
    } else if (globalEngine?.frequency_penalty !== undefined) {
      effectiveParams.frequency_penalty = globalEngine.frequency_penalty;
    }

    // 可选参数：presence_penalty
    if (customParams.presence_penalty !== undefined) {
      effectiveParams.presence_penalty = customParams.presence_penalty;
    } else if (globalEngine?.presence_penalty !== undefined) {
      effectiveParams.presence_penalty = globalEngine.presence_penalty;
    }

    console.log(`[CharacterDialogueChat] === Effective Parameters ===`);
    console.log(`[CharacterDialogueChat] Parameter source: ${source}`);
    if (hasCustomParams) {
      console.log(`[CharacterDialogueChat] Custom parameters:`, customParams);
    }
    if (globalEngine) {
      console.log(`[CharacterDialogueChat] Global engine config:`, {
        id: globalEngine.id,
        name: globalEngine.name,
        max_tokens: globalEngine.max_tokens,
        temperature: globalEngine.temperature,
      });
    }
    console.log(`[CharacterDialogueChat] Effective params:`, effectiveParams);
    console.log(`[CharacterDialogueChat] ===========================`);

    return effectiveParams;
  }, [config, setting]);

  return { config, updateConfig, clearConfig, resetParameters, getEffectiveParams };
}

// ==================== 人设加载 Hook ====================

export function usePersonas() {
  const [personas, setPersonas] = useState<UserPersona[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const loadPersonas = async () => {
      try {
        console.log('[CharacterDialogueChat] Loading personas from file system...');
        const avatarList = await window.electronAPI.avatar.list();
        console.log('[CharacterDialogueChat] Avatar list:', avatarList);
        
        if (mounted) {
          const loadedPersonas: UserPersona[] = [];
          
          for (const avatar of avatarList) {
            if (avatar.path.endsWith('.json') && !avatar.path.includes('user-profile.json')) {
              try {
                const content = await window.electronAPI.avatar.read(avatar.path);
                if (content) {
                  loadedPersonas.push({
                    id: content.id || avatar.name.replace('.json', ''),
                    name: content.name || '未命名',
                    description: content.description || '',
                    avatarPath: content.avatarPath || '',
                  });
                }
              } catch (error) {
                console.error(`[CharacterDialogueChat] Failed to read persona ${avatar.name}:`, error);
              }
            }
          }
          
          console.log('[CharacterDialogueChat] Loaded personas:', loadedPersonas);
          setPersonas(loadedPersonas);
        }
      } catch (error) {
        console.error('[CharacterDialogueChat] Failed to load personas:', error);
        if (mounted) {
          setPersonas([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    loadPersonas();
    return () => { mounted = false; };
  }, []);

  return { personas, loading };
}

// ==================== 主对话 Hook ====================

export function useCharacterDialogueChat(characterInfo: CharacterInfo) {
  const setting = useSettingStore(state => state.setting);
  const { saveTestChat } = useCharacterChatStore();
  const addLog = useLogStore(state => state.addLog);

  useEffect(() => {
    if (setting === null) {
      useSettingStore.getState().fetchSetting();
    }
  }, []);

  const [state, setState] = useState<ChatState>({
    messages: [],
    isLoading: false,
    isStreaming: false,
    error: null,
  });

  const { config: characterConfig, updateConfig, resetParameters, getEffectiveParams } = useCharacterConfig(characterInfo.characterCardId);
  const { personas } = usePersonas();

  const messagesRef = useRef<ChatMessage[]>([]);
  const firstMessageSentRef = useRef(false);
  const initialContentRef = useRef('');
  const streamContentRef = useRef('');
  const targetMessageIdRef = useRef('');
  const isSavingRef = useRef(false);
  const memoryTableEnabledRef = useRef(false);
  const memoryTableAutoOrganizeRef = useRef(false);
  const memoryTableOrganizeModeRef = useRef<'sync' | 'async'>('sync');
  const memoryTableDataRef = useRef<string>('');
  const isOrganizingRef = useRef(false);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const versionListRef = useRef<Array<{ fileName: string; filePath: string; sequenceNumber: number; timestamp: number; messageCount: number; versionLinkId?: string }>>([]);
  const versionIndexRef = useRef<any>(null);

  const selectedPersonaId = characterConfig?.selectedPersonaId;
  const selectedPersona = useMemo(() => {
    if (!selectedPersonaId || personas.length === 0) return null;
    return personas.find(p => p.id === selectedPersonaId) || null;
  }, [selectedPersonaId, personas]);

  const saveChatToStore = useCallback(async (messages: ChatMessage[]) => {
    if (isSavingRef.current) {
      return;
    }
    try {
      isSavingRef.current = true;
      await saveTestChat(
        characterInfo.creativeId,
        characterInfo.characterCardId,
        characterInfo.characterCardName,
        messages
      );
    } catch (error) {
      addLog(`[CharacterDialogueChat] Failed to save chat: ${error}`, 'error');
    } finally {
      isSavingRef.current = false;
    }
  }, [characterInfo, saveTestChat, addLog]);

  const saveConfig = useCallback(async () => {
    try {
      const configToSave = {
        ...characterConfig,
        characterCardId: characterInfo.characterCardId,
        characterCardName: characterInfo.characterCardName,
        lastUpdated: Date.now(),
      };

      saveStoredConfig(characterInfo.characterCardId, configToSave);

      const result = await window.electronAPI.characterConfig.save(characterInfo.characterCardId, configToSave);
      if (result.success) {
        const timestamp = new Date().toLocaleString('zh-CN');
        const summary = JSON.stringify({
          selectedPersonaId: configToSave.selectedPersonaId,
          boundKnowledgeBaseIds: configToSave.boundKnowledgeBaseIds,
          customParameters: configToSave.customParameters,
          lastUpdated: timestamp,
        }, null, 2);

        console.log(`[CharacterDialogueChat] === Config Saved ===`);
        console.log(`[CharacterDialogueChat] Time: ${timestamp}`);
        console.log(`[CharacterDialogueChat] Character: ${characterInfo.characterCardName} (${characterInfo.characterCardId})`);
        console.log(`[CharacterDialogueChat] Config Summary:\n${summary}`);
        console.log(`[CharacterDialogueChat] ======================`);

        addLog(`[CharacterDialogueChat] Config saved for ${characterInfo.characterCardName}`, 'info');
        message.success('设置已保存');
      } else {
        message.error(`保存失败: ${result.error}`);
        addLog(`[CharacterDialogueChat] Failed to save config: ${result.error}`, 'error');
      }
    } catch (error) {
      message.error('保存设置失败');
      addLog(`[CharacterDialogueChat] Failed to save config: ${error}`, 'error');
    }
  }, [characterConfig, characterInfo, addLog]);

  const bindKnowledgeBase = useCallback((documentId: string) => {
    const currentBoundIds = characterConfig?.boundKnowledgeBaseIds || [];
    if (currentBoundIds.includes(documentId)) {
      message.info('该知识库已绑定');
      return;
    }
    updateConfig({ boundKnowledgeBaseIds: [...currentBoundIds, documentId] });
    message.success('知识库绑定成功');
    addLog(`[CharacterDialogueChat] Knowledge base bound: ${documentId}`, 'info');
  }, [characterConfig, updateConfig, addLog]);

  const unbindKnowledgeBase = useCallback((documentId: string) => {
    const currentBoundIds = characterConfig?.boundKnowledgeBaseIds || [];
    updateConfig({ boundKnowledgeBaseIds: currentBoundIds.filter(id => id !== documentId) });
    message.success('知识库解绑成功');
    addLog(`[CharacterDialogueChat] Knowledge base unbound: ${documentId}`, 'info');
  }, [characterConfig, updateConfig, addLog]);

  useEffect(() => {
    let cancelled = false;
    console.log('[CharacterDialogueChat] === useEffect triggered ===');
    console.log('[CharacterDialogueChat] creativeId:', characterInfo.creativeId);
    console.log('[CharacterDialogueChat] characterCardId:', characterInfo.characterCardId);
    console.log('[CharacterDialogueChat] first_mes exists:', !!characterInfo.first_mes);
    console.log('[CharacterDialogueChat] first_mes length:', characterInfo.first_mes?.length || 0);
    const loadChatHistory = async () => {
      try {
        const savedChat = await window.electronAPI.characterChat.getTestChat(characterInfo.creativeId, characterInfo.characterCardId);
        if (cancelled) return;
        console.log('[CharacterDialogueChat] savedChat:', savedChat);
        if (savedChat && savedChat.messages && savedChat.messages.length > 0) {
          setState(prev => ({
            ...prev,
            messages: savedChat.messages,
          }));
          messagesRef.current = savedChat.messages;
          addLog(`[CharacterDialogueChat] Loaded ${savedChat.messages.length} messages from history`, 'info');
        } else if (characterInfo.first_mes && characterInfo.first_mes.trim()) {
          console.log('[CharacterDialogueChat] Setting first_mes as initial message');
          const firstMessage: ChatMessage = {
            id: 'first-' + Date.now(),
            role: 'assistant',
            content: characterInfo.first_mes,
            timestamp: Date.now(),
            status: 'sent',
            speakerName: characterInfo.characterCardName,
          };
          setState(prev => ({
            ...prev,
            messages: [firstMessage],
          }));
          messagesRef.current = [firstMessage];
          await saveChatToStore([firstMessage]);
          addLog(`[CharacterDialogueChat] First message loaded from character card (${characterInfo.first_mes.length} chars)`, 'info');
        } else {
          addLog(`[CharacterDialogueChat] No chat history and no first_mes, showing empty state`, 'info');
        }
      } catch (error) {
        addLog(`[CharacterDialogueChat] Failed to load chat history: ${error}`, 'error');
      }
    };
    loadChatHistory();
    return () => { cancelled = true; };
  }, [characterInfo.creativeId, characterInfo.characterCardId]);

  useEffect(() => {
    messagesRef.current = state.messages;
  }, [state.messages]);

  useEffect(() => {
    memoryTableEnabledRef.current = characterConfig?.memoryTableEnabled ?? false;
    memoryTableAutoOrganizeRef.current = characterConfig?.memoryTableAutoOrganize ?? false;
    memoryTableOrganizeModeRef.current = characterConfig?.memoryTableOrganizeMode ?? 'sync';
  }, [characterConfig?.memoryTableEnabled, characterConfig?.memoryTableAutoOrganize, characterConfig?.memoryTableOrganizeMode]);

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

  const { buildCompleteSystemPrompt, buildDialoguePrompt, buildContinuationPrompt } = usePromptBuilder(characterInfo, selectedPersona || undefined);

  const requestAIResponse = useCallback(async (
    contextMessages: ChatMessage[],
    targetMessageId: string,
    initialContent: string = '',
    promptType: 'dialogue' | 'continuation' = 'dialogue'
  ) => {
    console.log('========================================');
    console.log('[DEBUG] requestAIResponse CALLED');
    console.log('[DEBUG] promptType:', promptType);
    console.log('[DEBUG] contextMessages count:', contextMessages.length);
    console.log('========================================');
    console.log('[DEBUG-FLOW] === requestAIResponse START ===');

    try {
    const activeEngine = getActiveEngineConfig();
    console.log('[DEBUG-FLOW] activeEngine check done, has engine:', !!activeEngine);
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
    let streamTimeout: NodeJS.Timeout | null = null;

    const clearStreamTimeout = () => {
      if (streamTimeout) {
        clearTimeout(streamTimeout);
        streamTimeout = null;
      }
    };

    const streamTimeoutMs = activeEngine.max_tokens && Number(activeEngine.max_tokens) > 8192 ? 300000 : 120000;

    streamTimeout = setTimeout(() => {
      addLog(`[CharacterDialogueChat] Stream timeout reached (${streamTimeoutMs / 1000}s)`, 'warn');
      engine.cancelRequest();
      setState(prev => ({
        ...prev,
        messages: prev.messages.map(msg =>
          msg.id === targetMessageId
            ? { ...msg, content: msg.content || '响应超时，请重试', status: 'error' as const }
            : msg
        ),
        isLoading: false,
        isStreaming: false,
        error: '响应超时',
      }));
      message.error('响应超时，请重试');
      initialContentRef.current = '';
    }, streamTimeoutMs);
    
    console.log(`[CharacterDialogueChat] === Request Assembly ===`);
    console.log(`[CharacterDialogueChat] activeEngine.max_tokens:`, activeEngine.max_tokens);
    console.log(`[CharacterDialogueChat] effectiveParams.max_tokens:`, effectiveParams.max_tokens);
    console.log(`[CharacterDialogueChat] effectiveParams.max_tokens type:`, typeof effectiveParams.max_tokens);
    console.log(`[CharacterDialogueChat] effectiveParams object:`, JSON.stringify(effectiveParams, null, 2));
    
    const engineConfigWithParams: AIEngineConfig = {
      id: activeEngine.id,
      name: activeEngine.name,
      api_url: activeEngine.api_url,
      api_key: activeEngine.api_key,
      model_name: activeEngine.model_name,
      api_mode: activeEngine.api_mode,
      api_key_transmission: activeEngine.api_key_transmission,
      max_tokens: effectiveParams.max_tokens,
      system_prompt: activeEngine.system_prompt,
      temperature: effectiveParams.temperature,
    };

    console.log(`[CharacterDialogueChat] engineConfigWithParams.max_tokens:`, engineConfigWithParams.max_tokens);
    console.log(`[CharacterDialogueChat] engineConfigWithParams object:`, JSON.stringify(engineConfigWithParams, null, 2));
    console.log(`[CharacterDialogueChat] ===========================`);

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

    // 步骤A：向量知识库检索 + 关键词匹配（限定在已绑定的知识库范围内）
    let vectorContextItems: Array<{ source: string; score: number; content: string }> = [];
    try {
      const boundKnowledgeBaseIds = characterConfig?.boundKnowledgeBaseIds || [];
      const lastUserMessage = [...contextMessages].reverse().find(m => m.role === 'user');
      if (lastUserMessage && lastUserMessage.content) {
        // 使用综合检索 API：同时执行向量检索和关键词匹配
        addLog(`[CharacterDialogueChat] Calling retrieveWithKeywords with scopeIds: ${JSON.stringify(boundKnowledgeBaseIds)}`, 'info');

        // 安全的序列化全局扫描数据，避免循环引用导致 Maximum call stack size exceeded
        // 注意：不包含 characterDescription/personality/depthPrompt，因为角色卡片中嵌入了完整的
        // 世界书条目表格，会导致所有关键词都产生假阳性匹配
        const safeGlobalScanData = {
          personaDescription: typeof characterConfig?.personaDescription === 'string' ? characterConfig.personaDescription : undefined,
          scenario: typeof characterConfig?.scenario === 'string' ? characterConfig.scenario : undefined,
          creatorNotes: typeof characterConfig?.creatorNotes === 'string' ? characterConfig.creatorNotes : undefined,
        };

        const contextResult = await window.electronAPI.context.retrieveWithKeywords(
          [...contextMessages.slice(-20), { role: 'user', content: lastUserMessage.content }],
          { topK: 5, minScore: 0.3, sources: ['worldbook', 'knowledge', 'memory'], scopeIds: boundKnowledgeBaseIds.length > 0 ? boundKnowledgeBaseIds : undefined },
          true,  // 启用关键词匹配
          4,     // 扫描深度：最近4条消息
          safeGlobalScanData
        );

        if (contextResult.success && contextResult.items && contextResult.items.length > 0) {
          vectorContextItems = contextResult.items.map((item: any) => ({
            source: item.source,
            score: item.score,
            content: item.content,
            metadata: item.metadata,  // 保留 metadata 用于世界书条目格式化
          }));
          const vectorCount = contextResult.vectorItems?.length || 0;
          const keywordCount = contextResult.keywordItems?.length || 0;
          addLog(`[CharacterDialogueChat] Retrieved ${vectorContextItems.length} context items (vector: ${vectorCount}, keyword: ${keywordCount})`, 'info');
          if (keywordCount > 0) {
            addLog(`[CharacterDialogueChat] Keyword matches: ${JSON.stringify(contextResult.keywordItems.map((item: any) => ({ name: item.metadata?.entryName, keys: item.metadata?.matchedKeys })))}`, 'info');
          }
        } else {
          addLog(`[CharacterDialogueChat] retrieveWithKeywords returned no items`, 'info');
        }
      }
    } catch (error) {
      addLog(`[CharacterDialogueChat] Context retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'warn');
      console.error('[CharacterDialogueChat] Context retrieval error:', error);
    }

    console.log('[DEBUG-FLOW] Step A: Context retrieval done, items:', vectorContextItems.length);

    // ========== 记忆表格数据获取 ==========
    console.log('[DEBUG-FLOW] Step B: Starting memory table data fetch');
    console.log('[DEBUG-MEMORY-TABLE] Step 1: Checking memory table enable status');
    console.log('[DEBUG-MEMORY-TABLE] memoryTableEnabledRef.current =', memoryTableEnabledRef.current);
    console.log('[DEBUG-MEMORY-TABLE] characterConfig.memoryTableEnabled =', characterConfig?.memoryTableEnabled);
    
    addLog(`[CharacterDialogueChat] memoryTableEnabledRef.current = ${memoryTableEnabledRef.current}, characterConfig.memoryTableEnabled = ${characterConfig?.memoryTableEnabled}`, 'info');
    
    let memoryTableData = '';
    let tableStructure: { sheets: string[]; headers: Record<string, string[]>; descriptions: Record<string, string> } | undefined;
    if (memoryTableEnabledRef.current) {
      console.log('[DEBUG-MEMORY-TABLE] Step 2: Memory table is ENABLED, fetching data...');
      try {
        addLog('[CharacterDialogueChat] Memory table enabled, fetching data...', 'info');
        const chatId = characterInfo.characterCardName || characterInfo.characterCardId;
        addLog(`[CharacterDialogueChat] Requesting table data for chatId: ${chatId}`, 'info');
        console.log('[DEBUG-MEMORY-TABLE] Using chatId:', chatId);
        const tableResult = await window.electronAPI.memory.getTableData(chatId);
        console.log('[DEBUG-MEMORY-TABLE] tableResult:', tableResult);
        console.log('[DEBUG-MEMORY-TABLE] tableResult.data:', tableResult?.data);
        console.log('[DEBUG-MEMORY-TABLE] tableResult.data type:', typeof tableResult?.data);
        console.log('[DEBUG-MEMORY-TABLE] tableResult.data keys:', tableResult?.data ? Object.keys(tableResult.data) : 'N/A');
        console.log('[DEBUG-FLOW] Step B: getTableData returned successfully');
        addLog(`[CharacterDialogueChat] tableResult received: ${JSON.stringify({ hasResult: !!tableResult, sheets: tableResult?.sheets, hasHeaders: !!tableResult?.headers, hasData: !!tableResult?.data, hasDescriptions: !!tableResult?.sheetDescriptions }, null, 2)}`, 'info');
        
        // 提取表格结构信息（供异步整理模式使用，包含描述）
        if (tableResult && tableResult.sheets && tableResult.sheets.length > 0 && tableResult.headers) {
          tableStructure = {
            sheets: [...tableResult.sheets],
            headers: { ...tableResult.headers },
            descriptions: { ...(tableResult.sheetDescriptions || {}) }
          };
          addLog(`[CharacterDialogueChat] 表格结构信息已提取: ${tableStructure.sheets.join(', ')}`, 'info');
          if (tableStructure.descriptions && Object.keys(tableStructure.descriptions).length > 0) {
            addLog(`[CharacterDialogueChat] 表格描述信息已提取: ${JSON.stringify(tableStructure.descriptions)}`, 'info');
          }
        }
        
        if (tableResult && tableResult.sheets && tableResult.sheets.length > 0 && tableResult.data) {
          memoryTableData = '# 记忆表格数据\n\n';
          for (const sheetName of tableResult.sheets) {
            const sheetHeaders = tableResult.headers?.[sheetName] || [];
            const sheetRows = tableResult.data?.[sheetName] || [];
            console.log(`[DEBUG-MEMORY-TABLE] Sheet "${sheetName}":`, {
              headers: sheetHeaders,
              rows: sheetRows,
              rawRowData: tableResult.data?.[sheetName],
              rowDataType: typeof tableResult.data?.[sheetName],
              isArray: Array.isArray(tableResult.data?.[sheetName])
            });
            memoryTableData += `## 表格: ${sheetName}\n\n`;
            if (sheetHeaders.length > 0) {
              memoryTableData += '| ' + sheetHeaders.join(' | ') + ' |\n';
              memoryTableData += '| ' + sheetHeaders.map(() => '---').join(' | ') + ' |\n';
            }
            if (sheetRows.length > 0) {
              for (const row of sheetRows) {
                console.log(`[DEBUG-MEMORY-TABLE] Row data for sheet "${sheetName}":`, JSON.stringify(row));
                console.log(`[DEBUG-MEMORY-TABLE] Row keys:`, Object.keys(row));
                
                const cells = sheetHeaders.map((h, columnIndex) => {
                  // Access data by numeric index (0, 1, 2, etc.) since that's how it's stored in JSON
                  const val = row[columnIndex.toString()];
                  console.log(`[DEBUG-MEMORY-TABLE]   Header "${h}" (column ${columnIndex}) value:`, val, `(type: ${typeof val})`);
                  return val !== undefined && val !== null ? String(val) : '';
                });
                
                console.log(`[DEBUG-MEMORY-TABLE] Generated cells:`, cells);
                memoryTableData += '| ' + cells.join(' | ') + ' |\n';
              }
            }
            memoryTableData += '\n';
          }
          const totalRows = tableResult.sheets.reduce((sum: number, sn: string) => sum + (tableResult.data?.[sn]?.length || 0), 0);
          addLog(`[CharacterDialogueChat] Memory table data included: ${tableResult.sheets.length} sheets, ${totalRows} rows, final data length: ${memoryTableData.length}`, 'info');
        } else {
          addLog(`[CharacterDialogueChat] Memory table data is empty or invalid: sheets=${tableResult?.sheets?.length || 0}, hasData=${!!tableResult?.data}`, 'warn');
        }
      } catch (error) {
        addLog(`[CharacterDialogueChat] Failed to load memory table data (will use empty data): ${error}`, 'error');
        // 继续执行，memoryTableData 为空字符串，不影响对话
      }
    } else {
      addLog('[CharacterDialogueChat] Memory table is disabled, skipping data fetch', 'info');
    }

    console.log('[DEBUG-FLOW] Step B: Memory table data fetch complete, memoryTableData length:', memoryTableData.length);

    addLog('[CharacterDialogueChat] 记忆表格数据处理完成，继续构建系统提示词', 'info');

    // 准备发送给 AI 的上下文消息（不修改 messages state，仅修改发送给 AI 的内容）
    let messagesToSend = [...contextMessages];

    // 构建完整的 system prompt
    console.log('[DEBUG-FLOW] Step C: Starting buildCompleteSystemPrompt');
    const finalSystemPrompt = buildCompleteSystemPrompt(
      promptType,
      vectorContextItems,
      memoryTableData,
      memoryTableOrganizeModeRef.current,
      tableStructure
    );

    // 拼接全局system_prompt到角色提示词
    const globalSystemPrompt = activeEngine.system_prompt?.trim();
    const effectiveSystemPrompt = globalSystemPrompt 
      ? globalSystemPrompt + '\n\n' + finalSystemPrompt
      : finalSystemPrompt;

    // Debug: 显示提示词末尾（背景知识注入位置）
    const promptTail = effectiveSystemPrompt.substring(Math.max(0, effectiveSystemPrompt.length - 500));
    addLog(`[CharacterDialogueChat] System prompt length: ${effectiveSystemPrompt.length}, tail: ...${promptTail}`, 'info');
    console.log('[DEBUG-FLOW] Step C: buildCompleteSystemPrompt done, length:', effectiveSystemPrompt.length);

    addLog('[CharacterDialogueChat] 提示词构建完成，开始 Token 管理', 'info');
    console.log('[DEBUG-FLOW] Step D: Starting token management');

    // ========== Token管理与上下文截断 ==========
    const tokenManagementEnabled = characterConfig?.tokenManagementEnabled ?? true;
    const truncationConfig: TruncationConfig = {
      enabled: tokenManagementEnabled,
      maxContextTokens: characterConfig?.maxContextTokens ?? 32000,
      reservedForResponse: characterConfig?.reservedForResponse ?? 4096,
      minMessagesToKeep: characterConfig?.minMessagesToKeep ?? 3,
      maxMessagesToKeep: characterConfig?.maxMessagesToKeep ?? 60,
    };

    let messagesToUse = messagesToSend;

    if (tokenManagementEnabled) {
      const systemPromptTokens = TokenCounter.countSystemPromptTokens(effectiveSystemPrompt);
      
      const truncatedMessages = ContextTruncator.truncateMessages(
        messagesToSend,
        systemPromptTokens,
        truncationConfig
      );

      const truncationAnalysis = ContextTruncator.analyzeTruncation(
        messagesToSend,
        truncatedMessages,
        systemPromptTokens,
        truncationConfig
      );

      if (truncationAnalysis.wasTruncated) {
        addLog(
          `[TokenManagement] Context truncated: ${truncationAnalysis.originalCount} -> ${truncationAnalysis.truncatedCount} messages, ` +
          `tokens: ${truncationAnalysis.originalTokens} -> ${truncationAnalysis.truncatedTokens} ` +
          `(system: ${systemPromptTokens}, budget: ${truncationConfig.maxContextTokens})`,
          'warn'
        );
      } else {
        addLog(
          `[TokenManagement] Context within budget: ${truncatedMessages.length} messages, ` +
          `${truncationAnalysis.truncatedTokens} tokens (system: ${systemPromptTokens}, budget: ${truncationConfig.maxContextTokens})`,
          'info'
        );
      }

      messagesToUse = truncatedMessages;
    } else {
      addLog(`[TokenManagement] Token management disabled, sending all ${messagesToSend.length} messages`, 'info');
    }

    console.log('[DEBUG-FLOW] Step D: Token management done, messagesToUse count:', messagesToUse.length);
    console.log('[DEBUG-FLOW] Step E: Creating engine');

    const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(engineConfigWithParams);

    console.log('[DEBUG-FLOW] Step E: Engine created, calling sendMessage');

    engine.onStream((chunk, isDone) => {
      if (chunk) {
        streamContentRef.current += chunk;
        const currentContent = streamContentRef.current;

        setState(prev => {
          const targetMsg = prev.messages.find(m => m.id === targetMessageId);
          if (!targetMsg) return prev;

          const expectedPrefix = initialContentRef.current;
          if (currentContent !== expectedPrefix && !currentContent.startsWith(expectedPrefix)) {    
            addLog(`[CharacterDialogueChat] Content validation warning: content mismatch detected`, 'warn');
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
      console.log('[DEBUG-COMPLETE] === engine.onComplete called ===');
      console.log('[DEBUG-COMPLETE] response?.content length:', response?.content?.length || 0);
      console.log('[DEBUG-COMPLETE] response?.content contains tableEdit:', response?.content?.includes('tableEdit') || false);
      console.log('[DEBUG-COMPLETE] streamContentRef.current length:', streamContentRef.current?.length || 0);
      clearStreamTimeout();
      const accumulatedContent = streamContentRef.current;
      const serverContent = response?.content || '';
      const hasInitialContent = initialContentRef.current.length > 0;

      let finalContent: string;

      if (hasInitialContent) {
        if (accumulatedContent.length > initialContentRef.current.length) {
          finalContent = accumulatedContent;
          addLog(`[CharacterDialogueChat] Continue: preserved ${initialContentRef.current.length} chars, added ${accumulatedContent.length - initialContentRef.current.length} chars`, 'info');
        } else if (serverContent.length > 0) {
          finalContent = initialContentRef.current + serverContent;
          addLog(`[CharacterDialogueChat] Continue: used initial content + server response fallback`, 'info');
        } else {
          finalContent = initialContentRef.current;
          addLog(`[CharacterDialogueChat] Continue: no new content received, keeping original`, 'warn');
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

      // ===== 异步整理模式：检测并执行tableEdit命令（保留原始内容，HTML注释对用户不可见） =====
      let displayContent = finalContent;
      let hasAsyncCommands = false;

      console.log('[DEBUG-ASYNC-ORG] memoryTableAutoOrganizeRef.current:', memoryTableAutoOrganizeRef.current);
      console.log('[DEBUG-ASYNC-ORG] memoryTableOrganizeModeRef.current:', memoryTableOrganizeModeRef.current);
      console.log('[DEBUG-ASYNC-ORG] characterConfig?.memoryTableAutoOrganize:', characterConfig?.memoryTableAutoOrganize);
      console.log('[DEBUG-ASYNC-ORG] characterConfig?.memoryTableOrganizeMode:', characterConfig?.memoryTableOrganizeMode);
      console.log('[DEBUG-ASYNC-ORG] Condition check:', memoryTableAutoOrganizeRef.current && memoryTableOrganizeModeRef.current === 'async');

      if (memoryTableAutoOrganizeRef.current && memoryTableOrganizeModeRef.current === 'async') {
        addLog('[CharacterDialogueChat] 进入异步整理模式，开始检测tableEdit标签...', 'info');
        console.log('[DEBUG-ASYNC-ORG] 进入异步整理模式分支');

        // 多种正则模式按优先级匹配，兼容AI可能的变体输出
        const tableEditPatterns = [
          { regex: /<!--\s*<tableEdit>([\s\S]*?)<\/tableEdit>\s*-->/gi, name: '标准格式(HTML注释+标签)' },
          { regex: /<tableEdit>([\s\S]*?)<\/tableEdit>/gi, name: '无注释格式(纯标签)' },
          { regex: /<!--\s*tableEdit\s*-->([\s\S]*?)<!--\s*\/tableEdit\s*-->/gi, name: '注释分隔格式' },
        ];

        let match: RegExpExecArray | null = null;
        let matchedPatternName = '';
        for (const pattern of tableEditPatterns) {
          pattern.regex.lastIndex = 0;
          const m = pattern.regex.exec(finalContent);
          if (m) {
            match = m;
            matchedPatternName = pattern.name;
            break;
          }
        }

        if (match) {
          addLog(`[CharacterDialogueChat] 正则匹配成功 [${matchedPatternName}]，匹配到的命令文本: ${match[1].substring(0, 200)}...`, 'info');
          hasAsyncCommands = true;
          const rawCommandsText = match[1];
          // 从显示内容中移除tableEdit标签（用户不可见）
          // 直接使用正则替换移除，更可靠且兼容各种格式变体
          const beforeLength = finalContent.length;
          displayContent = finalContent
            // 尝试移除所有可能存在的tableEdit标签格式
            .replace(/<!--\s*<tableEdit>[\s\S]*?<\/tableEdit>\s*-->/gi, '')
            .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '')
            .replace(/<!--\s*tableEdit\s*-->[\s\S]*?<!--\s*\/tableEdit\s*-->/gi, '')
            // 清理残留的空行和多余空格
            .replace(/\n{3,}/g, '\n\n')
            .replace(/\s+$/g, '')
            .trim();
          
          addLog(`[CharacterDialogueChat] tableEdit标签已从显示内容移除，原始长度: ${beforeLength}, 显示长度: ${displayContent.length}, 移除长度: ${beforeLength - displayContent.length}`, 'info');

          // 异步解析和执行（不阻塞UI更新）
          (async () => {
            try {
              const chatId = characterInfo.characterCardName || characterInfo.characterCardId;
              if (!chatId) {
                addLog('[CharacterDialogueChat] 异步整理失败: chatId为空', 'error');
                return;
              }

              // 重新包装为标准格式供解析器处理
              const wrappedContent = `<tableEdit><!--\n${rawCommandsText}\n--></tableEdit>`;
              addLog(`[CharacterDialogueChat] 调用parseTableEdit, 包装后长度: ${wrappedContent.length}`, 'info');
              const parseResult = await window.electronAPI.memory.parseTableEdit(wrappedContent);
              addLog(`[CharacterDialogueChat] parseTableEdit结果: 成功=${parseResult.success}, 命令数=${parseResult.commands.length}, 错误数=${parseResult.errors.length}`, 'info');

              if (parseResult.errors.length > 0) {
                addLog(`[CharacterDialogueChat] 解析错误详情: ${parseResult.errors.join('; ')}`, 'warn');
              }

              if (parseResult.commands.length > 0) {
                addLog(`[CharacterDialogueChat] 解析到 ${parseResult.commands.length} 个tableEdit命令，chatId=${chatId}，开始执行...`, 'info');
                const execResult = await window.electronAPI.memory.executeTableEditCommands(chatId, parseResult.commands);
                if (execResult.success) {
                  addLog(`[CharacterDialogueChat] 异步整理完成: 成功执行 ${execResult.executed} 个命令`, 'info');

                  // 刷新表格数据，确保后续对话使用最新上下文
                  try {
                    const refreshedData = await window.electronAPI.memory.getTableData(chatId);
                    if (refreshedData?.data) {
                      memoryTableDataRef.current = refreshedData.data;
                      addLog('[CharacterDialogueChat] 表格数据已刷新，后续对话将使用最新上下文', 'info');
                    }
                  } catch (refreshError) {
                    addLog(`[CharacterDialogueChat] 刷新表格数据失败: ${refreshError}`, 'warn');
                  }
                } else {
                  addLog(`[CharacterDialogueChat] 异步整理有错误: ${execResult.errors?.join('; ') || '未知错误'}`, 'warn');
                }
              } else {
                addLog('[CharacterDialogueChat] 未解析到有效的tableEdit命令（AI可能未生成整理指令）', 'info');
              }
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              addLog(`[CharacterDialogueChat] 异步整理异常: ${errorMsg}`, 'error');
            }
          })();
        } else {
          addLog('[CharacterDialogueChat] 未检测到tableEdit标签（任何格式），跳过异步整理', 'warn');
        }
      }

      setState(prev => {
        const targetMessage = prev.messages.find(msg => msg.id === targetMessageId);
        if (!targetMessage) {
          addLog(`[CharacterDialogueChat] Target message ${targetMessageId} not found in current messages`, 'error');
          return prev;
        }

        const existingContent = targetMessage.content;
        // 异步模式下，tableEdit标签从显示内容中移除导致内容变短，需要跳过内容保护检查
        const isAsyncMode = memoryTableAutoOrganizeRef.current && memoryTableOrganizeModeRef.current === 'async' && hasAsyncCommands;
        if (!isAsyncMode && existingContent.length > 0 && displayContent.length < existingContent.length) {
          addLog(`[CharacterDialogueChat] Content protection: preventing content loss (${existingContent.length} -> ${displayContent.length})`, 'error');
          return prev;
        }

        const finalMessages = prev.messages.map(msg =>
          msg.id === targetMessageId ? { ...msg, content: displayContent, status: 'sent' as const } : msg
        );

        // 保存聊天记录 - 注意：不在 setState 内部调用异步函数，避免 React 状态管理产生循环引用
        // 使用 clean 副本避免 IPC 序列化错误
        const messagesToSave = finalMessages.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          status: msg.status,
          speakerName: msg.speakerName,
          speakerAvatar: msg.speakerAvatar,
        }));
        
        // 使用 setTimeout 延迟保存，避免在 setState 回调中执行异步操作
        setTimeout(() => {
          saveChatToStore(messagesToSave).catch(err => {
            addLog(`[CharacterDialogueChat] Failed to save chat: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
          });
        }, 0);

        return {
          ...prev,
          messages: finalMessages,
          isLoading: false,
          isStreaming: false,
        };
      });

      if (memoryTableAutoOrganizeRef.current && memoryTableOrganizeModeRef.current === 'sync' && !isOrganizingRef.current) {
        addLog('[CharacterDialogueChat] Auto-organize triggered for memory table (sync mode)', 'info');
        // 防抖：延迟 2000ms 触发，避免高频请求
        setTimeout(async () => {
          try {
            isOrganizingRef.current = true;
            setIsOrganizing(true);
            const chatId = characterInfo.characterCardName || characterInfo.characterCardId;
            const activeEngine = getActiveEngineConfig();
            if (activeEngine) {
              // 使用新的 options 参数，继续从上次位置处理，最小间隔 3000ms
              await window.electronAPI.memory.processChatProgressive(chatId, '', {
                apiKey: activeEngine.api_key || '',
                apiUrl: activeEngine.api_url || '',
                modelName: activeEngine.model_name || '',
                apiMode: activeEngine.api_mode || 'chat_completion'
              }, { continueFromLast: true, minInterval: 3000 });
              addLog('[CharacterDialogueChat] Memory table auto-organization completed', 'info');
            } else {
              addLog('[CharacterDialogueChat] Skip auto-organize: no active engine configured', 'warn');
            }
          } catch (error) {
            addLog(`[CharacterDialogueChat] Memory table auto-organization failed: ${error}`, 'error');
          } finally {
            isOrganizingRef.current = false;
            setIsOrganizing(false);
          }
        }, 2000);
      }

      initialContentRef.current = '';
      targetMessageIdRef.current = '';
    });

    engine.onError((error) => {
      clearStreamTimeout();
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

    // 异步整理模式：在用户消息末尾拼接简短的整理指令
    if (memoryTableAutoOrganizeRef.current && memoryTableOrganizeModeRef.current === 'async') {
      addLog('[CharacterDialogueChat] 异步整理模式：在用户消息末尾拼接固定整理指令', 'info');

      // 找到最后一条用户消息的索引
      let lastUserMsgIndex = -1;
      for (let i = messagesToSend.length - 1; i >= 0; i--) {
        if (messagesToSend[i].role === 'user') {
          lastUserMsgIndex = i;
          break;
        }
      }

      if (lastUserMsgIndex >= 0) {
        const lastMsg = messagesToSend[lastUserMsgIndex];
        const fixedCommand = `\n\n然后进行表格整理`;

        messagesToSend[lastUserMsgIndex] = {
          ...lastMsg,
          content: lastMsg.content + fixedCommand
        };

        addLog(`[CharacterDialogueChat] 固定指令已拼接到用户消息，长度: ${lastMsg.content.length} -> ${messagesToSend[lastUserMsgIndex].content.length}`, 'info');
      } else {
        addLog('[CharacterDialogueChat] 警告：未找到用户消息，跳过指令拼接', 'warn');
      }
    }

    try {
      console.log('[DEBUG-FLOW] Step E: Calling engine.sendMessage');
      await engine.sendMessage(messagesToUse, effectiveSystemPrompt, engineConfigWithParams);
      console.log('[DEBUG-FLOW] Step E: engine.sendMessage returned successfully');
      console.log('[DEBUG-FLOW] === requestAIResponse END ===');
    } catch (error) {
      console.error('[DEBUG-FLOW] Step E: engine.sendMessage threw error:', error);
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
  } catch (error) {
    console.error('[DEBUG-FLOW] !!! requestAIResponse UNCAUGHT EXCEPTION:', error);
    console.error('[DEBUG-FLOW] !!! error stack:', error instanceof Error ? error.stack : 'N/A');
    setState(prev => ({
      ...prev,
      messages: prev.messages.map(msg =>
        msg.id === targetMessageId
          ? { ...msg, content: `错误: ${error instanceof Error ? error.message : '未知错误'}`, status: 'error' as const }
          : msg
      ),
      isLoading: false,
      isStreaming: false,
      error: error instanceof Error ? error.message : '未知错误',
    }));
    message.error(`对话请求失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
  }, [getActiveEngineConfig, getEffectiveParams, buildDialoguePrompt, buildContinuationPrompt, saveChatToStore, addLog, characterConfig]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || state.isStreaming) return;

    const userId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const userMessage: ChatMessage = {
      id: userId,
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
      status: 'sent',
      speakerName: selectedPersona?.name || characterInfo.characterCardName,
    };

    const aiMessageId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const newMessages = [...state.messages, userMessage, {
      id: aiMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'sending' as const,
      speakerName: characterInfo.characterCardName,
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
  }, [state.messages, state.isStreaming, requestAIResponse, selectedPersona, characterInfo.characterCardName]);

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

    addLog(`[CharacterDialogueChat] Continue conversation: message has ${existingContent.length} chars`, 'info');

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

    setState({
      messages: [],
      isLoading: false,
      isStreaming: false,
      error: null,
    });
    messagesRef.current = [];
    await saveChatToStore([]);
    addLog('[CharacterDialogueChat] Chat cleared', 'info');
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
    addLog('[CharacterDialogueChat] Request cancelled', 'info');
    initialContentRef.current = '';
  }, [getActiveEngineConfig, addLog]);

  const editMessage = useCallback((messageId: string, newContent: string) => {
    setState(prev => {
      const updatedMessages = prev.messages.map(msg =>
        msg.id === messageId ? { ...msg, content: newContent, timestamp: Date.now() } : msg
      );
      saveChatToStore(updatedMessages);
      addLog(`[CharacterDialogueChat] Message ${messageId} edited`, 'info');
      return { ...prev, messages: updatedMessages };
    });
  }, [saveChatToStore, addLog]);

  const memoryTableEnabled = characterConfig?.memoryTableEnabled ?? false;
  const memoryTableAutoOrganize = characterConfig?.memoryTableAutoOrganize ?? false;
  const memoryTableOrganizeMode = (characterConfig?.memoryTableOrganizeMode ?? 'sync') as 'sync' | 'async';

  const fetchMemoryTableData = useCallback(async () => {
    if (!memoryTableEnabled) {
      memoryTableDataRef.current = '';
      return;
    }
    try {
      // 使用 characterCardName 而不是 characterCardId，因为表格整理功能使用 characterCardName 保存文件
      const chatId = characterInfo.characterCardName || characterInfo.characterCardId;
      console.log('[DEBUG-MEMORY-TABLE] fetchMemoryTableData using chatId:', chatId);
      const tableResult = await window.electronAPI.memory.getTableData(chatId);
      if (tableResult && tableResult.sheets && tableResult.sheets.length > 0 && tableResult.data) {
        let formattedData = '# 记忆表格数据\n\n';
        for (const sheetName of tableResult.sheets) {
          const sheetHeaders = tableResult.headers?.[sheetName] || [];
          const sheetRows = tableResult.data?.[sheetName] || [];
          formattedData += `## 表格: ${sheetName}\n\n`;
          if (sheetHeaders.length > 0) {
            formattedData += '| ' + sheetHeaders.join(' | ') + ' |\n';
            formattedData += '| ' + sheetHeaders.map(() => '---').join(' | ') + ' |\n';
          }
          if (sheetRows.length > 0) {
            for (const row of sheetRows) {
              const cells = sheetHeaders.map(h => {
                const val = row[h];
                return val !== undefined && val !== null ? String(val) : '';
              });
              formattedData += '| ' + cells.join(' | ') + ' |\n';
            }
          }
          formattedData += '\n';
        }
        memoryTableDataRef.current = formattedData;
        const totalRows = tableResult.sheets.reduce((sum: number, sn: string) => sum + (tableResult.data?.[sn]?.length || 0), 0);
        addLog(`[CharacterDialogueChat] Memory table data loaded: ${tableResult.sheets.length} sheets, ${totalRows} rows`, 'info');
      } else {
        memoryTableDataRef.current = '';
        addLog('[CharacterDialogueChat] No memory table data found', 'info');
      }
    } catch (error) {
      memoryTableDataRef.current = '';
      addLog(`[CharacterDialogueChat] Failed to load memory table data: ${error}`, 'warn');
    }
  }, [memoryTableEnabled, characterInfo.characterCardId, addLog]);

  const handleMemoryTableToggle = useCallback((enabled: boolean) => {
    updateConfig({ memoryTableEnabled: enabled });
    addLog(`[CharacterDialogueChat] Memory table ${enabled ? 'enabled' : 'disabled'}`, 'info');
  }, [updateConfig, addLog]);

  const handleMemoryTableAutoOrganizeToggle = useCallback((enabled: boolean) => {
    updateConfig({ memoryTableAutoOrganize: enabled });
    addLog(`[CharacterDialogueChat] Memory table auto-organize ${enabled ? 'enabled' : 'disabled'}`, 'info');
  }, [updateConfig, addLog]);

  const handleMemoryTableOrganizeModeChange = useCallback((mode: 'sync' | 'async') => {
    updateConfig({ memoryTableOrganizeMode: mode });
    addLog(`[CharacterDialogueChat] Memory table organize mode changed to ${mode === 'sync' ? '同步整理' : '异步整理'}`, 'info');
  }, [updateConfig, addLog]);

  const handleMemoryTableTemplateAssociate = useCallback((templateId: string, templateName: string) => {
    updateConfig({ memoryTableTemplateId: templateId, memoryTableTemplateName: templateName });
    addLog(`[CharacterDialogueChat] Memory table template associated: ${templateName} (${templateId})`, 'info');
  }, [updateConfig, addLog]);

  const tokenManagementConfig = useMemo(() => ({
    enabled: characterConfig?.tokenManagementEnabled ?? true,
    maxContextTokens: characterConfig?.maxContextTokens ?? 32000,
    reservedForResponse: characterConfig?.reservedForResponse ?? 4096,
    minMessagesToKeep: characterConfig?.minMessagesToKeep ?? 3,
    maxMessagesToKeep: characterConfig?.maxMessagesToKeep ?? 60,
  }), [characterConfig]);

  const handleTokenManagementConfigChange = useCallback((config: Partial<typeof tokenManagementConfig>) => {
    const { enabled, ...rest } = config;
    const mappedConfig: Partial<typeof characterConfig> = {
      ...rest,
      ...(enabled !== undefined && { tokenManagementEnabled: enabled }),
    };
    updateConfig(mappedConfig);
    addLog(`[CharacterDialogueChat] Token management config updated: enabled=${enabled ?? characterConfig?.tokenManagementEnabled}`, 'info');
  }, [updateConfig, addLog, characterConfig]);

  const handleStopOrganizing = useCallback(async () => {
    const chatId = characterInfo.characterCardName || characterInfo.characterCardId;
    try {
      addLog(`[CharacterDialogueChat] Stopping organize task for: ${chatId}`, 'info');
      const result = await window.electronAPI.memory.stopOrganizing(chatId);
      if (result.success) {
        isOrganizingRef.current = false;
        setIsOrganizing(false);
        addLog('[CharacterDialogueChat] Organize task stopped successfully', 'info');
        message.success('已停止表格整理');
      } else {
        addLog('[CharacterDialogueChat] No active organize task to stop', 'warn');
        message.warning('当前没有正在执行的整理任务');
      }
    } catch (error) {
      addLog(`[CharacterDialogueChat] Failed to stop organizing: ${error}`, 'error');
      message.error('停止整理失败');
    }
  }, [characterInfo.characterCardName, characterInfo.characterCardId, addLog]);

  const loadVersions = useCallback(async () => {
    try {
      const versions = await window.electronAPI.chatVersion.getVersions(characterInfo.characterCardName);
      versionListRef.current = versions.sort((a, b) => a.timestamp - b.timestamp);
      
      try {
        const index = await window.electronAPI.chatVersion.getVersionIndex(characterInfo.characterCardName);
        versionIndexRef.current = index;
      } catch {
        versionIndexRef.current = null;
      }
      
      addLog(`[CharacterDialogueChat] Loaded ${versions.length} versions`, 'info');
    } catch (error) {
      addLog(`[CharacterDialogueChat] Failed to load versions: ${error}`, 'warn');
      versionListRef.current = [];
      versionIndexRef.current = null;
    }
  }, [characterInfo.characterCardName, addLog]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  const getVersionInfoForMessage = useCallback((message: ChatMessage): typeof message['versionInfo'] => {
    if (message.role !== 'assistant') return undefined;
    if (!versionListRef.current || versionListRef.current.length === 0) return undefined;

    const versions = versionListRef.current;
    const latestVersion = versions[versions.length - 1];
    const index = versionIndexRef.current;

    const getTableSnapshotExists = (vlid: string | undefined) => {
      if (!vlid || !index?.versions) return false;
      const record = index.versions.find((vr: any) => vr.versionLinkId === vlid);
      return record?.tableSnapshot?.exists ?? false;
    };

    const getConsistencyStatus = (vlid: string | undefined) => {
      if (!vlid || !index?.versions) return undefined;
      const record = index.versions.find((vr: any) => vr.versionLinkId === vlid);
      return record?.consistencyStatus as 'matched' | 'mismatched' | 'partial' | undefined;
    };

    for (let i = versions.length - 1; i >= 0; i--) {
      const v = versions[i];
      if (v.timestamp <= message.timestamp + 1000 && v.timestamp >= message.timestamp - 1000) {
        return {
          versionFilePath: v.filePath,
          isLatestVersion: v === latestVersion,
          versionSequenceNumber: v.sequenceNumber,
          versionLinkId: v.versionLinkId,
          tableSnapshotExists: getTableSnapshotExists(v.versionLinkId),
          consistencyStatus: getConsistencyStatus(v.versionLinkId),
          allVersions: versions.map(vv => ({
            fileName: vv.fileName,
            filePath: vv.filePath,
            sequenceNumber: vv.sequenceNumber,
            timestamp: vv.timestamp,
            messageCount: vv.messageCount,
            versionLinkId: vv.versionLinkId,
            tableSnapshotExists: getTableSnapshotExists(vv.versionLinkId),
          })),
        };
      }
    }

    if (message === messagesRef.current[messagesRef.current.length - 1] && message.status === 'sent') {
      return {
        versionFilePath: latestVersion?.filePath || '',
        isLatestVersion: true,
        versionSequenceNumber: latestVersion?.sequenceNumber || 0,
        versionLinkId: latestVersion?.versionLinkId,
        tableSnapshotExists: getTableSnapshotExists(latestVersion?.versionLinkId),
        consistencyStatus: getConsistencyStatus(latestVersion?.versionLinkId),
        allVersions: versions.map(vv => ({
          fileName: vv.fileName,
          filePath: vv.filePath,
          sequenceNumber: vv.sequenceNumber,
          timestamp: vv.timestamp,
          messageCount: vv.messageCount,
          versionLinkId: vv.versionLinkId,
          tableSnapshotExists: getTableSnapshotExists(vv.versionLinkId),
        })),
      };
    }

    return undefined;
  }, []);

  const retryMessageFromVersion = useCallback(async (versionFilePath: string) => {
    if (state.isStreaming) {
      message.warning('请等待当前回复完成');
      return;
    }

    try {
      addLog(`[CharacterDialogueChat] Restoring from version: ${versionFilePath}`, 'info');
      const versionData = await window.electronAPI.chatVersion.getVersionContent(versionFilePath);
      if (!versionData || !versionData.messages) {
        message.error('版本数据无效');
        return;
      }

      const restoredMessages: ChatMessage[] = versionData.messages.map((msg: any) => ({
        ...msg,
        status: msg.status || 'sent',
      }));

      const messagesBeforeRetry = restoredMessages.slice(0, -1);
      const lastMessage = restoredMessages[restoredMessages.length - 1];

      if (!lastMessage || lastMessage.role !== 'assistant') {
        message.warning('版本数据格式不正确');
        return;
      }

      const newEmptyMessage: ChatMessage = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        status: 'sending',
        speakerName: characterInfo.characterCardName,
      };

      messagesRef.current = [...messagesBeforeRetry, newEmptyMessage];
      setState({
        messages: [...messagesBeforeRetry, newEmptyMessage],
        isLoading: true,
        isStreaming: true,
        error: null,
      });

      await requestAIResponse(messagesBeforeRetry, newEmptyMessage.id, '', 'dialogue');
    } catch (error) {
      addLog(`[CharacterDialogueChat] Failed to restore from version: ${error}`, 'error');
      message.error('从版本恢复失败');
    }
  }, [state.isStreaming, requestAIResponse, addLog, characterInfo.characterCardName]);

  const stateWithVersionInfo = useMemo(() => {
    const messagesWithVersion = state.messages.map((msg, index) => {
      const versionInfo = getVersionInfoForMessage(msg);
      return { ...msg, versionInfo };
    });
    return { ...state, messages: messagesWithVersion };
  }, [state, getVersionInfoForMessage]);

  return {
    state,
    stateWithVersionInfo,
    sendMessage,
    continueConversation,
    retryMessage,
    retryMessageFromVersion,
    editMessage,
    clearChat,
    cancelRequest,
    selectedPersona,
    personas,
    characterConfig,
    updateConfig,
    saveConfig,
    resetParameters,
    getEffectiveParams,
    getActiveEngineConfig,
    bindKnowledgeBase,
    unbindKnowledgeBase,
    memoryTableEnabled,
    memoryTableAutoOrganize,
    memoryTableOrganizeMode,
    memoryTableTemplateId: characterConfig?.memoryTableTemplateId ?? null,
    memoryTableTemplateName: characterConfig?.memoryTableTemplateName ?? '',
    isOrganizing,
    fetchMemoryTableData,
    handleMemoryTableToggle,
    handleMemoryTableAutoOrganizeToggle,
    handleMemoryTableOrganizeModeChange,
    handleMemoryTableTemplateAssociate,
    tokenManagementConfig,
    handleTokenManagementConfigChange,
    handleStopOrganizing,
    getMemoryTableData: () => memoryTableDataRef.current,
  };
}
