// 角色对话业务逻辑Hooks

import { useState, useReducer, useCallback, useRef, useEffect, useMemo } from 'react';
import { message } from 'antd';
import { useSettingStore } from '../../../stores/settingStore';
import { useCharacterChatStore } from '../../../stores/characterChatStore';
import { useLogStore } from '../../../stores/logStore';
// 表情显示系统状态（Spec: add-character-expression-system / Task 9）
// 使用 useExpressionStore.getState() 在非 React 上下文（requestAIResponse 回调内）命令式读取可用情绪键
import { useExpressionStore } from '../../../stores/expressionStore';
import { ChatMessage, CharacterInfo, UserPersona, EffectiveAIParams, deriveThinkTagMode, ImageAttachment } from './CharacterDialogueChat.types';
import { chatReducer, initialChatState } from './chatReducer';
import { ChatEngineFactory } from '../../Common/ChatEngine/ChatEngine.factory';
import { AIEngineConfig, AIResponse, getDefaultEngineCapabilities } from '../../Common/ChatEngine/ChatEngine.types';
import { usePromptBuilder } from './usePromptBuilder';
import { buildAssistModePrompt, buildAsyncTableOrganizeInstructions, buildStopSequences, buildRoleAnchorMessage, buildContinueNudgePrompt, buildLengthGuidancePrompt, buildLanguagePrompt, buildUserReplySystemPrompt, buildStopSequencesForUserReply, buildPolishInputSystemPrompt, buildExpressionPrompt, parseExpressionFromContent } from './PromptBuilder';
import { TokenCounter, ContextTruncator, DEFAULT_MAX_TOKENS } from './TokenManagement';
import type { TruncationConfig } from './TokenManagement/types';
import {
  shouldCompact,
  splitMessages,
  buildSummaryPrompt,
  createSummaryMessage,
  KEEP_RECENT_ROUNDS,
} from './contextCompactor';
import { nGramJaccard, overlapRate } from './utils/similarityUtils';
import { stripThinkingTags } from './utils/messageProcessor';
import {
  shouldTriggerRagRetrieval,
  shouldTriggerIncrementalVectorize,
  extractRecentMessagesForVectorize,
} from './utils/chatHistoryRagUtils';

// ==================== 去重检测配置（Spec: optimize-chat-ai-intelligence / Task 5） ====================

/**
 * 去重检测配置。
 *
 * 重试 retryMessage 与续写 continueConversation 的去重增强参数，作为
 * requestAIResponse 的可选第 5 参数注入，不改变主流程签名。
 *
 * - previousResponse：重试去重时与新生成回复比较的"上一条 assistant 回复"
 *   （Spec: 与上一条 assistant 回复相似度 > 0.8 时自动重新生成）
 * - retryCount：当前重试次数（0 = 首次生成，1/2 = 第 1/2 次重试）
 * - maxRetries：最大重试次数（默认 2，spec 约定，避免无限循环）
 * - injectContinueNudge：续写去重重试时是否注入 continue_nudge_prompt system 消息
 *   （Task 8.2 已完善：buildContinuationPrompt 末尾已含 nudge 段落，重试时再追加
 *    system 消息形成"system prompt 段落 + 消息数组末尾 system 消息"双重提示）
 *
 * 续写去重（overlapRate > 0.6）的触发不依赖 previousResponse，而是由
 * promptType === 'continuation' && initialContent 非空 自动启用。
 */
interface DedupConfig {
  previousResponse?: string;
  retryCount?: number;
  maxRetries?: number;
  injectContinueNudge?: boolean;
}

/**
 * 默认最大重试次数（spec 约定）。
 *
 * Spec: optimize-chat-ai-intelligence / Scenario: 重试去重
 * "自动重新生成（最多 2 次）" → 总生成次数上限 = 1（首次）+ 2（重试）= 3 次。
 */
const DEFAULT_MAX_DEDUP_RETRIES = 2;

/**
 * 重试去重相似度阈值（spec 约定）。
 *
 * n-gram Jaccard > 0.8 视为"几乎相同的回复"，触发重新生成。
 */
const RETRY_SIMILARITY_THRESHOLD = 0.8;

/**
 * 续写去重重叠率阈值（spec 约定）。
 *
 * overlapRate > 0.6 视为"AI 原样重写已有内容"，触发 continue_nudge_prompt 重新生成。
 */
const CONTINUE_OVERLAP_THRESHOLD = 0.6;

/**
 * 判断是否需要强化回复长度约束。
 *
 * Spec: fix-ai-response-length-degradation / Task 4
 * 当历史记录中最近 3 轮回复字符数均低于阈值时返回 true，
 * 触发 buildLengthGuidancePrompt 的强化模式。
 *
 * 自动恢复机制（Task 4.4）：本函数基于历史动态判定，无需显式清除标志。
 * 当下一轮回复字符数 >= threshold 时，最近 3 轮不再全部低于阈值，
 * shouldStrengthenLength 自动返回 false，强化约束随之失效。
 *
 * @param history 最近 N 轮回复字符数数组（responseLengthHistoryRef.current）
 * @param threshold 最小回复字数阈值（min_response_chars）
 * @returns 是否需要强化约束
 */
export function shouldStrengthenLength(history: number[], threshold: number): boolean {
  if (!Array.isArray(history) || history.length < 3) return false;
  if (!threshold || threshold <= 0) return false;
  const last3 = history.slice(-3);
  return last3.every(len => typeof len === 'number' && len > 0 && len < threshold);
}

// ==================== 旧图片消息迁移（Spec: enhance-conversation-image-bubble / Task 2） ====================

/**
 * 迁移旧的独立图片消息为新格式的 imageAttachment（Spec: enhance-conversation-image-bubble / Task 2）
 *
 * 旧格式：`isImageMessage=true` + `generatedImage=assetId` 的独立 ChatMessage
 * 新格式：父文本消息的 `imageAttachment` 字段（嵌套附属）
 *
 * 迁移规则：
 * - 遍历消息，对每个 `isImageMessage=true` 的消息，定位其**前一条**消息（原列表中紧邻的前一条）。
 * - 若前一条是 `role='assistant'` 且 `!isImageMessage` 的文本消息：
 *     - 若父消息**已有** `imageAttachment`（幂等场景）：直接移除该独立图片消息，不重复写入。
 *     - 否则：将 `generatedImage`（assetId）转换为父消息的 `imageAttachment`：
 *         - `currentAssetId = assetId`
 *         - `emotion = 父消息 emotion || 'default'`
 *         - `createdAt = 图片消息 timestamp`
 *         - `history = [{ assetId, createdAt: 图片消息 timestamp }]`
 *         - `currentIndex = 0`
 *         - `status = 'idle'`
 *       并从列表中移除该独立图片消息。
 * - 若前一条不存在或不是 assistant 非图片消息（如 user/system/图片消息/列表首条）：
 *   跳过迁移，保留该图片消息原样（不丢失数据）。调用方可记录警告日志。
 *
 * 实现要点：
 * - 纯函数，不修改原数组（创建浅拷贝），不依赖 addLog / IPC。
 * - 遍历时维护"上一条 assistant 非图片消息"在结果数组中的索引，用于定位父消息写入 imageAttachment。
 * - 返回 `migrated` 布尔值表示是否发生了迁移（含幂等移除场景）。
 *
 * @param messages 原始消息列表
 * @returns { messages: 迁移后的消息列表, migrated: 是否发生了迁移 }
 */
export function migrateLegacyImageMessages(messages: ChatMessage[]): { messages: ChatMessage[]; migrated: boolean } {
  const result: ChatMessage[] = [];
  let migrated = false;
  // 上一条 assistant 非图片消息在 result 中的索引（用于定位 imageAttachment 写入目标）
  let lastAssistantNonImageIdx = -1;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.isImageMessage) {
      // 定位原列表中紧邻的前一条消息
      const prev = i > 0 ? messages[i - 1] : null;
      const isPrevAssistantNonImage = !!prev && prev.role === 'assistant' && !prev.isImageMessage;

      if (isPrevAssistantNonImage && lastAssistantNonImageIdx >= 0) {
        // 前一条是 assistant 非图片消息 → 找到 result 中的父消息（必然是 lastAssistantNonImageIdx 指向的项）
        const parent = result[lastAssistantNonImageIdx];
        if (parent.imageAttachment) {
          // 幂等场景：父消息已有 imageAttachment，直接移除该图片消息（不重复写入）
          migrated = true;
          continue;
        }
        // 正常迁移：将 generatedImage 转换为父消息的 imageAttachment
        const assetId = msg.generatedImage || '';
        parent.imageAttachment = {
          currentAssetId: assetId,
          emotion: parent.emotion || 'default',
          createdAt: msg.timestamp,
          history: [{ assetId, createdAt: msg.timestamp }],
          currentIndex: 0,
          status: 'idle',
        };
        migrated = true;
        continue;
      }

      // 无前驱 assistant 非图片消息 → 跳过迁移，保留原样（不丢失数据）
      result.push({ ...msg });
      // 注意：保留的图片消息不计入 lastAssistantNonImageIdx（它不是 assistant 非图片消息）
      continue;
    }

    // 非图片消息：浅拷贝后追加，并维护 lastAssistantNonImageIdx
    const newMsg: ChatMessage = { ...msg };
    result.push(newMsg);
    if (newMsg.role === 'assistant') {
      lastAssistantNonImageIdx = result.length - 1;
    }
  }

  return { messages: result, migrated };
}

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
      max_tokens: customParams.max_tokens !== undefined ? customParams.max_tokens : (globalEngine?.max_tokens !== undefined ? globalEngine.max_tokens : DEFAULT_MAX_TOKENS),
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

    // 可选参数：repetition_penalty（Spec: optimize-chat-ai-intelligence / Task 6.1 / 6.3）
    // 借鉴 SillyTavern textgen/Default.json (rep_pen=1.1~1.2)，硬编码默认基线为 1.1。
    // 仅当后端 supportsRepPen=true 时由 ChatEngine 注入请求体（UI 滑块也按 capabilities 显隐）。
    if (customParams.repetition_penalty !== undefined) {
      effectiveParams.repetition_penalty = customParams.repetition_penalty;
    } else if (globalEngine?.rep_pen !== undefined) {
      // 兼容 SillyTavern 风格的 aiEngines.rep_pen 字段
      effectiveParams.repetition_penalty = globalEngine.rep_pen;
    }

    // 可选参数：DRY 采样组（Spec: optimize-chat-ai-intelligence / Task 6.4 / 6.5）
    // 借鉴 SillyTavern textgen-settings.js:143；仅当 supportsDrySampler=true 时由 ChatEngine 注入。
    // 自定义值优先，其次 aiEngines 上的同名字段，最后由 ChatEngine.buildSamplingExtras 兜底默认值。
    if (customParams.dry_multiplier !== undefined) {
      effectiveParams.dry_multiplier = customParams.dry_multiplier;
    } else if (globalEngine?.dry_multiplier !== undefined) {
      effectiveParams.dry_multiplier = globalEngine.dry_multiplier;
    }
    if (customParams.dry_base !== undefined) {
      effectiveParams.dry_base = customParams.dry_base;
    } else if (globalEngine?.dry_base !== undefined) {
      effectiveParams.dry_base = globalEngine.dry_base;
    }
    if (customParams.dry_allowed_length !== undefined) {
      effectiveParams.dry_allowed_length = customParams.dry_allowed_length;
    } else if (globalEngine?.dry_allowed_length !== undefined) {
      effectiveParams.dry_allowed_length = globalEngine.dry_allowed_length;
    }
    if (customParams.no_repeat_ngram_size !== undefined) {
      effectiveParams.no_repeat_ngram_size = customParams.no_repeat_ngram_size;
    } else if (globalEngine?.no_repeat_ngram_size !== undefined) {
      effectiveParams.no_repeat_ngram_size = globalEngine.no_repeat_ngram_size;
    }
    // top_k / min_p 合并
    if (customParams.top_k !== undefined) {
      effectiveParams.top_k = customParams.top_k;
    } else if (globalEngine?.top_k !== undefined) {
      effectiveParams.top_k = globalEngine.top_k;
    }
    if (customParams.min_p !== undefined) {
      effectiveParams.min_p = customParams.min_p;
    } else if (globalEngine?.min_p !== undefined) {
      effectiveParams.min_p = globalEngine.min_p;
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
                    isGeneric: content.isGeneric || false,
                    isSystem: content.isSystem || false,
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
  const saveTestChat = useCharacterChatStore(s => s.saveTestChat);
  // 【Bug 修复】loadChatHistory 在「有历史但无需迁移」或「无历史且无 first_mes」场景下
  // 不会调用 saveChatToStore，导致 currentTestChat 永远为 null，sessionTraits 相关 action
  // （setSessionTraits / updateSessionTrait / addSessionTrait）因 `if (!current) return` 静默 no-op。
  // 引入 setCurrentTestChat 用于在这些场景下显式初始化 currentTestChat。
  const setCurrentTestChat = useCharacterChatStore(s => s.setCurrentTestChat);
  const addLog = useLogStore(state => state.addLog);

  useEffect(() => {
    if (setting === null) {
      useSettingStore.getState().fetchSetting();
    }
  }, []);

  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  // stateRef 在每次渲染后同步更新，供异步回调（engine.onStream/onComplete/onError 等）读取最新 state，
  // 避免闭包陈旧问题（useCallback 闭包中的 state 是渲染时的快照）
  const stateRef = useRef(state);
  stateRef.current = state;

  const { config: characterConfig, updateConfig, resetParameters, getEffectiveParams } = useCharacterConfig(characterInfo.characterCardId);
  const { personas, loading: personasLoading } = usePersonas();

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
  // 用户回复生成状态与累积缓冲（Spec: add-ai-user-reply-button / Task 2.2 + 2.3）
  // - isGeneratingUserReply：state，驱动 UI 按钮态切换与 Send/textarea 禁用
  // - isGeneratingUserReplyRef：ref，cancelRequest 中同步读取避免闭包陈旧
  // - isGeneratingUserReplyAbortRef：ref，cancelRequest 触发后用于 onStream 回调早返
  // - generatedReplyAccumulatedRef：ref，流式累积 chunk，完成后供 Promise resolve 使用
  const [isGeneratingUserReply, setIsGeneratingUserReply] = useState(false);
  const generatedReplyAccumulatedRef = useRef<string>('');
  const isGeneratingUserReplyRef = useRef<boolean>(false);
  const isGeneratingUserReplyAbortRef = useRef<boolean>(false);
  // 润色输入状态与累积缓冲（Spec: refine-user-input-text / Task 2）
  // - isPolishingInput：state，驱动 UI 按钮态切换与输入框禁用
  // - polishedAccumulatedRef：ref，流式累积 chunk，完成后供 Promise resolve 使用
  // - isPolishingInputRef：ref，cancelRequest 中同步读取避免闭包陈旧
  // - isPolishingInputAbortRef：ref，cancelRequest 触发后用于 onStream 回调早返
  const [isPolishingInput, setIsPolishingInput] = useState(false);
  const polishedAccumulatedRef = useRef<string>('');
  const isPolishingInputRef = useRef<boolean>(false);
  const isPolishingInputAbortRef = useRef<boolean>(false);
  const versionListRef = useRef<Array<{ fileName: string; filePath: string; sequenceNumber: number; timestamp: number; messageCount: number; versionLinkId?: string }>>([]);
  const versionIndexRef = useRef<any>(null);
  // 回复长度诊断与强化约束（Spec: fix-ai-response-length-degradation / Task 1 & 4）
  // requestStartTimeRef：记录每轮 requestAIResponse 起始时间戳，供 onComplete 计算生成耗时
  // responseLengthHistoryRef：维护最近 20 轮回复字符数，供 shouldStrengthenLength 检测连续短回复
  const requestStartTimeRef = useRef<number>(0);
  const responseLengthHistoryRef = useRef<number[]>([]);

  const selectedPersonaId = characterConfig?.selectedPersonaId;
  const selectedPersona = useMemo(() => {
    if (personas.length === 0) return null;
    // 已选择人设时优先使用
    if (selectedPersonaId) {
      return personas.find(p => p.id === selectedPersonaId) || null;
    }
    // 未选择人设时回退到通用人设
    return personas.find(p => p.isGeneric) || null;
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
          // 旧图片消息迁移（Spec: enhance-conversation-image-bubble / Task 2）
          // 将 isImageMessage=true + generatedImage 的独立图片消息迁移为父文本消息的 imageAttachment
          const loadedMessages = savedChat.messages as ChatMessage[];
          const { messages: migratedMessages, migrated: didMigrate } = migrateLegacyImageMessages(loadedMessages);
          const finalMessages = didMigrate ? migratedMessages : loadedMessages;
          dispatch({ type: 'UPDATE_MESSAGES', messages: finalMessages });
          messagesRef.current = finalMessages;
          addLog(`[CharacterDialogueChat] Loaded ${finalMessages.length} messages from history`, 'info');
          // 【Bug 修复】显式设置 currentTestChat，确保 sessionTraits 相关 action 可用。
          // 原代码仅在 didMigrate=true 时调用 saveChatToStore（间接设置 currentTestChat），
          // 而 saveChatToStore 在 currentTestChat 为 null 时也不会初始化它（已在 store 同步修复）。
          // 此处直接 setCurrentTestChat(savedChat) 覆盖所有子场景（迁移 / 不迁移），
          // 并做与 store.loadTestChat 一致的 sessionTraits 安全映射（浅拷贝每个 trait 避免共享引用）。
          const loadedSessionTraits = (savedChat as any).sessionTraits;
          if (Array.isArray(loadedSessionTraits)) {
            (savedChat as any).sessionTraits = loadedSessionTraits.map((t: any) => ({ ...t }));
          } else {
            (savedChat as any).sessionTraits = undefined;
          }
          setCurrentTestChat(savedChat);
          if (didMigrate) {
            // 无前驱 assistant 文本的孤立图片消息会被保留原样（SubTask 2.2 兜底），记录警告
            const orphanCount = migratedMessages.filter(m => m.isImageMessage).length;
            if (orphanCount > 0) {
              addLog(`[CharacterDialogueChat] ${orphanCount} legacy image message(s) have no preceding assistant text, kept as-is`, 'warn');
            }
            await saveChatToStore(migratedMessages);
            addLog('[CharacterDialogueChat] migrated legacy image messages to imageAttachment format', 'info');
          }
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
          dispatch({ type: 'UPDATE_MESSAGES', messages: [firstMessage] });
          messagesRef.current = [firstMessage];
          await saveChatToStore([firstMessage]);
          addLog(`[CharacterDialogueChat] First message loaded from character card (${characterInfo.first_mes.length} chars)`, 'info');
        } else {
          // 【Bug 修复】无聊天历史且无 first_mes 时，显式初始化 currentTestChat 为空对话占位对象。
          // 否则 currentTestChat 永远为 null，sessionTraits 相关 action（分类选择框 / 新增 tag）
          // 因 `if (!current) return` 静默 no-op，用户反馈「右侧角色特征分类选择框不生效 + 新增 tag 按钮不生效」。
          // 占位对象 messages 为空数组（与实际状态一致），后续用户编辑特征时 setSessionTraits 会调
          // saveTestChat 将其持久化到后端；用户发送首条消息时 saveChatToStore 也会正常工作。
          setCurrentTestChat({
            id: `temp-${characterInfo.creativeId}-${characterInfo.characterCardId}`,
            creativeId: characterInfo.creativeId,
            characterCardId: characterInfo.characterCardId,
            characterCardName: characterInfo.characterCardName,
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          } as any);
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

  // 订阅故障转移事件
  // provider 切换时展示 toast 通知，重试时提示正在重试。
  useEffect(() => {
    const unsubscribe = window.electronAPI.ai.failover.onFailover((data: {
      type: 'retry' | 'switch';
      toProvider?: string;
      toModel?: string;
      reason: string;
      attempt?: number;
    }) => {
      if (data.type === 'switch') {
        message.info(`已切换到备用模型 ${data.toModel || data.toProvider || '未知'}`);
      } else if (data.type === 'retry') {
        message.warning(`请求失败，正在重试（第 ${data.attempt || 1} 次）…`);
      }
    });
    return () => { unsubscribe(); };
  }, []);

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
      if (engine) return engine as AIEngineConfig;
    }
    return setting.aiEngines[0] as AIEngineConfig;
  }, [setting]);

  const { buildCompleteSystemPrompt, buildDialoguePrompt, buildContinuationPrompt } = usePromptBuilder(characterInfo, selectedPersona || undefined);

  const requestAIResponse = useCallback(async (
    contextMessages: ChatMessage[],
    targetMessageId: string,
    initialContent: string = '',
    promptType: 'dialogue' | 'continuation' = 'dialogue',
    dedupConfig?: DedupConfig,
  ) => {
    console.log('========================================');
    console.log('[DEBUG] requestAIResponse CALLED');
    console.log('[DEBUG] promptType:', promptType);
    console.log('[DEBUG] contextMessages count:', contextMessages.length);
    console.log('========================================');
    console.log('[DEBUG-FLOW] === requestAIResponse START ===');

    try {
    // Spec: fix-ai-response-length-degradation / Task 1.1
    // 记录请求起始时间戳，供 engine.onComplete 计算生成耗时（durationSec）
    requestStartTimeRef.current = Date.now();
    const activeEngine = getActiveEngineConfig();
    console.log('[DEBUG-FLOW] activeEngine check done, has engine:', !!activeEngine);
    if (!activeEngine) {
      message.warning('请先在设置中配置AI引擎');
      const noEngineState = stateRef.current;
      const noEngineMsg = noEngineState.messages.find(m => m.id === targetMessageId);
      dispatch({ type: 'STREAM_ERROR', targetMessageId, content: noEngineMsg?.content || '请先配置AI引擎', error: null });
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

    const streamTimeoutMs = 300000; // 统一 300 秒超时（AI 生成通常较长）

    streamTimeout = setTimeout(() => {
      addLog(`[CharacterDialogueChat] Stream timeout reached (${streamTimeoutMs / 1000}s)`, 'warn');
      engine.cancelRequest();
      const timeoutState = stateRef.current;
      const timeoutMsg = timeoutState.messages.find(m => m.id === targetMessageId);
      dispatch({ type: 'STREAM_ERROR', targetMessageId, content: timeoutMsg?.content || '响应超时，请重试', error: '响应超时' });
      message.error('响应超时，请重试');
      initialContentRef.current = '';
    }, streamTimeoutMs);
    
    console.log(`[CharacterDialogueChat] === Request Assembly ===`);
    console.log(`[CharacterDialogueChat] activeEngine.max_tokens:`, activeEngine.max_tokens);
    console.log(`[CharacterDialogueChat] effectiveParams.max_tokens:`, effectiveParams.max_tokens);
    console.log(`[CharacterDialogueChat] effectiveParams.max_tokens type:`, typeof effectiveParams.max_tokens);
    
    // 辅助模式开启时，为选项块预留额外 token 空间，防止 AI 回复正文占满 max_tokens 后选项被截断
    // 选项块约需 200-300 token（3 个选项 + 标记），预留 512 token 作为安全余量
    // 注意：max_tokens=0 表示不限制，此时不需要 +512（0 会被 ChatEngine 解析为不发送 max_tokens 字段）
    const assistModeNeedsExtraTokens = characterConfig?.customParameters?.assist_mode === true;
    const adjustedMaxTokens = assistModeNeedsExtraTokens && effectiveParams.max_tokens && effectiveParams.max_tokens > 0
      ? effectiveParams.max_tokens + 512
      : effectiveParams.max_tokens;

    const engineConfigWithParams: AIEngineConfig = {
      id: activeEngine.id,
      name: activeEngine.name,
      api_url: activeEngine.api_url,
      api_key: activeEngine.api_key,
      model_name: activeEngine.model_name,
      api_mode: activeEngine.api_mode,
      api_key_transmission: activeEngine.api_key_transmission,
      max_tokens: adjustedMaxTokens,
      system_prompt: activeEngine.system_prompt,
      temperature: effectiveParams.temperature,
      // Stop sequences 防抢话（Spec: optimize-chat-ai-intelligence / Task 3.2 + 3.4）
      // 用户名来自 selectedPersona.name（缺省 'User'），与 PromptBuilder 保持一致；
      // customStopSequences 来自角色会话配置（ParameterPanel 自定义停止序列区）。
      stopSequences: buildStopSequences(
        selectedPersona?.name || 'User',
        characterConfig?.customStopSequencesEnabled
          ? characterConfig.customStopSequences
          : undefined
      ),
      // 后端能力探测（Spec: Task 3.3）：优先用引擎显式配置，缺省按 api_mode 推断默认值
      capabilities: activeEngine.capabilities || getDefaultEngineCapabilities(),
      // 能力感知透传（Spec: upgrade-ai-handler-multimodal-compatibility / Task 3.2 + 3.4）
      // 将用户思维链/工具调用开关透传给 ChatEngine，由其在 sendMessage 中按
      // supportsThinking / supportsToolCalling 做双条件守卫后再决定是否注入参数。
      enable_chain_of_thought: activeEngine.enable_chain_of_thought,
      use_function_calling: activeEngine.use_function_calling,
    };

    console.log(`[CharacterDialogueChat] engineConfigWithParams.max_tokens:`, engineConfigWithParams.max_tokens);
    console.log(`[CharacterDialogueChat] engineConfigWithParams.stopSequences:`, engineConfigWithParams.stopSequences);
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
    // Repetition penalty + DRY 采样参数注入（Spec: optimize-chat-ai-intelligence / Task 6.5）
    // 这些字段在 ChatEngine.buildSamplingExtras 中按 capabilities 决定是否写入请求体；
    // 此处仅透传 effectiveParams 解析后的值（缺省时 buildSamplingExtras 会使用默认值）。
    if (effectiveParams.repetition_penalty !== undefined) {
      engineConfigWithParams.repetition_penalty = Number(effectiveParams.repetition_penalty);
    }
    if (effectiveParams.dry_multiplier !== undefined) {
      engineConfigWithParams.dry_multiplier = Number(effectiveParams.dry_multiplier);
    }
    if (effectiveParams.dry_base !== undefined) {
      engineConfigWithParams.dry_base = Number(effectiveParams.dry_base);
    }
    if (effectiveParams.dry_allowed_length !== undefined) {
      engineConfigWithParams.dry_allowed_length = Number(effectiveParams.dry_allowed_length);
    }
    if (effectiveParams.no_repeat_ngram_size !== undefined) {
      engineConfigWithParams.no_repeat_ngram_size = Number(effectiveParams.no_repeat_ngram_size);
    }
    if (effectiveParams.top_k !== undefined) {
      engineConfigWithParams.top_k = Number(effectiveParams.top_k);
    }
    if (effectiveParams.min_p !== undefined) {
      engineConfigWithParams.min_p = Number(effectiveParams.min_p);
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

    // ========== 步骤 A2：对话历史 RAG 检索（Spec: optimize-chat-ai-intelligence / Task 7.5） ==========
    // 长对话跨轮记忆增强：当对话历史 > 20 轮（即 contextMessages.length > 40，含 user+assistant 配对）时，
    // 调用 ChatVectorizationService.retrieveChatHistory 检索本会话历史向量相似片段（topK=3, minScore=0.6），
    // 结果格式化为"区域 2：本会话相关历史片段"段落，由 buildCompleteSystemPrompt 注入到 system prompt
    //（在"区域 1：相关背景知识"之后）。短对话（≤ 20 轮）跳过此步骤——原始消息已在上下文中。
    // 检索失败时跳过，不阻塞主流程（spec: "对话历史 RAG 检索失败不阻塞对话主流程"）。
    let chatHistoryItems: Array<{ content: string; score: number; timestamp: number }> = [];
    if (shouldTriggerRagRetrieval(contextMessages.length)) {
      try {
        const lastUserMessageForRag = [...contextMessages].reverse().find(m => m.role === 'user');
        if (lastUserMessageForRag && lastUserMessageForRag.content) {
          // chatId 与记忆表格使用的标识同源：characterCardName 优先，缺失时回退 characterCardId
          // 与 ChatVectorizationService.vectorizeChat 的 characterId 一致，保证向量检索命中
          const ragChatId = characterInfo.characterCardName || characterInfo.characterCardId;
          if (ragChatId) {
            addLog(
              `[CharacterDialogueChat] Step A2: RAG retrieval triggered (messages=${contextMessages.length} > threshold), chatId=${ragChatId}`,
              'info'
            );
            chatHistoryItems = await window.electronAPI.chatHistory.retrieve(
              ragChatId,
              lastUserMessageForRag.content,
              3,    // topK
              0.6   // minScore
            );
            addLog(
              `[CharacterDialogueChat] Step A2: RAG retrieval returned ${chatHistoryItems.length} history items`,
              'info'
            );
            if (chatHistoryItems.length > 0) {
              const scoreSummary = chatHistoryItems.map(h => h.score.toFixed(2)).join(', ');
              addLog(`[CharacterDialogueChat] Step A2: history scores=[${scoreSummary}]`, 'info');
            }
          } else {
            addLog('[CharacterDialogueChat] Step A2: chatId is empty, skipping RAG retrieval', 'warn');
          }
        }
      } catch (error) {
        // spec: 检索失败降级——跳过该步骤，对话主流程不受影响
        addLog(
          `[CharacterDialogueChat] Step A2: RAG retrieval failed (degraded, skipping): ${error instanceof Error ? error.message : 'Unknown error'}`,
          'warn'
        );
        console.error('[CharacterDialogueChat] Step A2: RAG retrieval error:', error);
        chatHistoryItems = [];
      }
    } else {
      addLog(
        `[CharacterDialogueChat] Step A2: skipping RAG retrieval (messages=${contextMessages.length} ≤ threshold, short conversation)`,
        'info'
      );
    }

    console.log('[DEBUG-FLOW] Step A2: Chat history RAG retrieval done, items:', chatHistoryItems.length);

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
    const finalSystemPrompt = await buildCompleteSystemPrompt(
      promptType,
      vectorContextItems,
      memoryTableData,
      memoryTableOrganizeModeRef.current,
      tableStructure,
      // Task 7.5: 本会话相关历史片段（仅在长对话时由 Step A2 检索得到，短对话为空数组）
      chatHistoryItems
    );

    // 拼接全局system_prompt到角色提示词
    const globalSystemPrompt = activeEngine.system_prompt?.trim();
    let effectiveSystemPrompt = globalSystemPrompt
      ? globalSystemPrompt + '\n\n' + finalSystemPrompt
      : finalSystemPrompt;

    // Spec: fix-ai-response-length-degradation / Task 3.4 + Task 4.2
    // 注入回复长度引导约束：读取 customParameters.min_response_chars（默认 300），
    // 并基于 responseLengthHistoryRef 判定是否启用强化模式（连续 3 轮短回复时 strengthenLength=true）。
    // buildLengthGuidancePrompt 在 minResponseChars<=0 时返回空串，此处二次守护避免无意义拼接。
    const minResponseChars = characterConfig?.customParameters?.min_response_chars ?? 300;
    const strengthenLength = shouldStrengthenLength(responseLengthHistoryRef.current, minResponseChars);
    if (minResponseChars > 0) {
      const charName = characterInfo.characterCardName || 'Character';
      effectiveSystemPrompt += buildLengthGuidancePrompt(minResponseChars, strengthenLength, charName);
      if (strengthenLength) {
        addLog(
          `[CharacterDialogueChat] Length guidance STRENGTHENED (last 3 rounds < ${minResponseChars} chars threshold)`,
          'warn'
        );
      }
    }

    // 语言要求：默认中文（undefined 视为中文）
    const language = characterConfig?.customParameters?.language ?? 'zh';
    effectiveSystemPrompt += buildLanguagePrompt(language);

    // 辅助模式：默认关闭，显式设为 true 时开启
    const assistMode = characterConfig?.customParameters?.assist_mode === true;
    if (assistMode) {
      const charName = characterInfo.characterCardName || 'Character';
      effectiveSystemPrompt += buildAssistModePrompt(charName);
      addLog(`[CharacterDialogueChat] 辅助模式已开启，已注入提示词约束`, 'info');
    }

    // 表情系统（Spec: add-character-expression-system / Task 9.1 + 9.2）
    // 永久开启：注入 buildExpressionPrompt，要求 AI 在回复末尾输出 <<<EXPRESSION>>>key<<<END_EXPRESSION>>>
    // 解析后写入 ChatMessage.emotion 并驱动表情立绘渲染。
    // 注意：useExpressionStore 不能作为 React hook 在本函数内调用（非组件上下文），
    // 使用 .getState() 命令式读取 store（Zustand 原生支持）。
    {
      const charName = characterInfo.characterCardName || 'Character';
      const availableEmotionKeys = useExpressionStore.getState().getAvailableEmotionKeys();
      effectiveSystemPrompt += buildExpressionPrompt(charName, availableEmotionKeys);
      addLog(`[CharacterDialogueChat] 表情提示词已注入（${availableEmotionKeys.length} 个可用情绪键）`, 'info');
    }

    // Debug: 显示提示词末尾（背景知识注入位置）
    const promptTail = effectiveSystemPrompt.substring(Math.max(0, effectiveSystemPrompt.length - 500));
    addLog(`[CharacterDialogueChat] System prompt length: ${effectiveSystemPrompt.length}, tail: ...${promptTail}`, 'info');
    console.log('[DEBUG-FLOW] Step C: buildCompleteSystemPrompt done, length:', effectiveSystemPrompt.length);

    addLog('[CharacterDialogueChat] 提示词构建完成，开始 Token 管理', 'info');
    console.log('[DEBUG-FLOW] Step D: Starting token management');

    // ========== Token管理与上下文截断 ==========
    const tokenManagementEnabled = characterConfig?.tokenManagementEnabled ?? false;
    const truncationConfig: TruncationConfig = {
      enabled: tokenManagementEnabled,
      maxContextTokens: characterConfig?.maxContextTokens ?? 256000,
      reservedForResponse: characterConfig?.reservedForResponse ?? 4096,
      minMessagesToKeep: characterConfig?.minMessagesToKeep ?? 3,
      maxMessagesToKeep: characterConfig?.maxMessagesToKeep ?? 60,
    };

    let messagesToUse = messagesToSend;

    if (tokenManagementEnabled) {
      // 预热精确 Token 计数缓存（批量 IPC 一次拉取，避免 ContextTruncator 内部逐条 IPC）。
      // 之后同步 countSystemPromptTokens / ContextTruncator.truncateMessages 全部命中缓存，
      // 走 cl100k_base 精确路径；IPC 失败时缓存为空，自动回退字节估算。
      try {
        await Promise.all([
          TokenCounter.precountMessages(messagesToSend),
          TokenCounter.precountSystemPrompt(effectiveSystemPrompt),
        ]);
      } catch (err) {
        console.warn('[TokenManagement] precount failed, falling back to byte estimation:', err);
      }

      const systemPromptTokens = TokenCounter.countSystemPromptTokens(effectiveSystemPrompt);

      // 角色深度锚定（depth_prompt）消息构建（Spec: optimize-chat-ai-intelligence / Task 4.4）
      // 借鉴 SillyTavern `data.extensions.depth_prompt` 机制：当裁剪后对话历史 token > 50% 阈值时，
      // 在 depth=4 位置注入角色精简摘要 system 消息，防止长上下文截断后角色性格漂移。
      // characterInfo 字段映射：characterCardName → name，personality → personality，characterCardContent → description
      const roleAnchorMessage = buildRoleAnchorMessage(
        {
          name: characterInfo.characterCardName,
          personality: characterInfo.personality,
          description: characterInfo.characterCardContent,
        },
        selectedPersona?.name || 'User'
      );

      const truncatedMessages = ContextTruncator.truncateMessages(
        messagesToSend,
        systemPromptTokens,
        truncationConfig,
        undefined, // requiredItems：使用默认必填项（含 roleAnchor=0 占位，ContextTruncator 内部按需注入真实 token）
        roleAnchorMessage
      );

      const truncationAnalysis = ContextTruncator.analyzeTruncation(
        messagesToSend,
        truncatedMessages,
        systemPromptTokens,
        truncationConfig
      );

      // 检测 roleAnchor 是否实际注入（depth=4 位置存在 system 消息即视为注入）
      const hasRoleAnchor = truncatedMessages.some(
        m => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[角色锚定]')
      );
      if (hasRoleAnchor) {
        addLog(
          `[TokenManagement] Role anchor injected at depth=4 (long conversation detected): ` +
          `${truncatedMessages.length} messages after truncation`,
          'info'
        );
      }

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

      // 上下文窗口守卫：dispatch token 用量（Spec: optimize-agent-interaction-from-openclaw / M3-Task11）
      dispatch({
        type: 'SET_TOKEN_USAGE',
        usage: {
          used: truncationAnalysis.truncatedTokens,
          total: truncationConfig.maxContextTokens,
        },
      });

      messagesToUse = truncatedMessages;
    } else {
      // 🐛 Bug修复（重点，2026-07-26）：TokenManagement 关闭时的安全网。
      // 原实现直接发送所有消息，长对话会耗尽模型上下文窗口（如 32K），
      // 导致 finish_reason=length 截断。此处增加消息数量软限制：
      // 超过 maxMessagesToKeep（默认 60）时，仅保留最近 N 条，防止上下文溢出。
      const maxMsgs = characterConfig?.maxMessagesToKeep ?? 60;
      if (messagesToSend.length > maxMsgs) {
        messagesToUse = messagesToSend.slice(-maxMsgs);
        // 确保以 user 消息开头（丢弃开头的 assistant 消息）
        if (messagesToUse.length > 0 && messagesToUse[0].role === 'assistant') {
          messagesToUse = messagesToUse.slice(1);
        }
        addLog(
          `[TokenManagement] Token management disabled but message count (${messagesToSend.length}) exceeds safety limit (${maxMsgs}). ` +
          `Auto-truncated to last ${messagesToUse.length} messages to prevent context window exhaustion.`,
          'warn'
        );
      } else {
        addLog(`[TokenManagement] Token management disabled, sending all ${messagesToSend.length} messages`, 'info');
      }
    }

    console.log('[DEBUG-FLOW] Step D: Token management done, messagesToUse count:', messagesToUse.length);
    console.log('[DEBUG-FLOW] Step E: Creating engine');

    const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(engineConfigWithParams);

    console.log('[DEBUG-FLOW] Step E: Engine created, calling sendMessage');

    engine.onStream((chunk, isDone) => {
      if (chunk) {
        streamContentRef.current += chunk;
        const currentContent = streamContentRef.current;

        const streamState = stateRef.current;
        const targetMsg = streamState.messages.find(m => m.id === targetMessageId);
        if (!targetMsg) return;

        const expectedPrefix = initialContentRef.current;
        if (currentContent !== expectedPrefix && !currentContent.startsWith(expectedPrefix)) {
          addLog(`[CharacterDialogueChat] Content validation warning: content mismatch detected`, 'warn');
        }

        dispatch({ type: 'STREAM_CHUNK', targetMessageId, content: currentContent });
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
        const emptyState = stateRef.current;
        const emptyMsg = emptyState.messages.find(m => m.id === targetMessageId);
        dispatch({ type: 'STREAM_ERROR', targetMessageId, content: emptyMsg?.content || 'AI returned empty response', error: null });
        message.warning('AI returned empty response');
        return;
      }

      // ===== 上下文窗口耗尽检测（finish_reason=length） =====
      // 当 AI 因上下文窗口耗尽或 max_tokens 达到上限被截断时，finish_reason="length"。
      // 此时输出内容不完整，需告知用户并提示启用 TokenManagement 裁剪历史。
      const finishReason = response?.finishReason || 'stop';
      if (finishReason === 'length') {
        const tokenMgmtEnabled = characterConfig?.tokenManagementEnabled === true;
        const hint = tokenMgmtEnabled
          ? '已启用上下文管理但仍被截断，请尝试增大 maxContextTokens 或减小 maxMessagesToKeep'
          : '建议在右侧面板启用「Token 管理」以自动裁剪历史对话，为 AI 输出预留足够空间';
        addLog(`[CharacterDialogueChat] AI 回复被截断（finish_reason=length），上下文窗口或 max_tokens 耗尽。${hint}`, 'warn');
        message.warning({
          content: `AI 回复被截断（达到长度上限）。${hint}`,
          duration: 8,
        });
      }

      // ===== Think 标签后处理（Spec: handle-think-tags-overflow） =====
      // 针对 deepseek3.2 等老模型返回的 think、thinking、thought 推理标签，
      // 在写入存储 / RAG / 回传上下文前剥离其内容。默认开启（undefined 视为开启），
      // 显式设为 false 时跳过剥离（渲染层仍由 processMessage 兜底剥离）。
      // 注意：流式 onStream 阶段不剥离，避免未闭合标签误删后续正文。
      // 【重点标记】修复：记录 thinkTagsStripped 标志，供后续内容保护检查跳过此场景，
      // 否则剥离后 displayContent 变短会触发内容保护检查导致状态不更新、UI 卡死。
      let thinkTagsStripped = false;
      let optionsStripped = false;
      if (deriveThinkTagMode(characterConfig?.customParameters) === 'strip') {
        const beforeStripLen = finalContent.length;
        finalContent = stripThinkingTags(finalContent);
        if (finalContent.length !== beforeStripLen) {
          thinkTagsStripped = true;
          addLog(`[CharacterDialogueChat] think 标签已剥离，原始长度: ${beforeStripLen}, 剥离后: ${finalContent.length}`, 'info');
        }
      }

      // ===== 辅助模式：解析推荐选项（Spec: add-assist-mode-options） =====
      // 【重点标记】修复：原仅匹配 HTML 注释格式，多数 AI 模型不生成 HTML 注释导致功能失效。
      // 改用多格式容错匹配：优先匹配 <<<SUGGESTED_OPTIONS>>> 文本标记格式，
      // 回退匹配 HTML 注释、纯标签、方括号等变体。
      // 【重点标记】修复：增加对缺少结束标记的半截选项块的容错提取，
      // 以及更多编号格式（①②③、-、*、()等）的支持。
      let suggestedOptions: string[] = [];
      const assistModeEnabled = characterConfig?.customParameters?.assist_mode === true;
      if (assistModeEnabled) {
        // 多格式正则匹配，按优先级排列
        const optionPatterns = [
          // 主格式：<<<SUGGESTED_OPTIONS>>> ... <<<END_OPTIONS>>>
          { regex: /<<<SUGGESTED_OPTIONS>>>\s*([\s\S]*?)<<<END_OPTIONS>>>/i, name: 'text-marker' },
          // 容错：仅有开始标记 <<<SUGGESTED_OPTIONS>>> 到文本末尾（AI 遗漏结束标记或被截断）
          { regex: /<<<SUGGESTED_OPTIONS>>>\s*([\s\S]*?)$/i, name: 'text-marker-unclosed' },
          // ⚠️【重点标记 - Bug 修复 - SSE 跨 chunk 标签损坏防御】
          // 兜底：匹配含 OPTIONS 关键字的损坏 <<<...>>> 标记（如 <<<SUGGED_OPTIONS>>>）
          // 根因已在 ChatEngine.handleStream 修复，此处为防御性兜底处理旧消息
          { regex: /<<<[^>]*OPTIONS[^>]*>>>\s*([\s\S]*?)<<<[^>]*END[^>]*OPTIONS[^>]*>>>/i, name: 'text-marker-corrupted' },
          { regex: /<<<[^>]*OPTIONS[^>]*>>>\s*([\s\S]*?)$/i, name: 'text-marker-corrupted-unclosed' },
          // 兼容旧格式：<!-- <suggestedOptions> ... </suggestedOptions> -->
          { regex: /<!--\s*<suggestedOptions>([\s\S]*?)<\/suggestedOptions>\s*-->/i, name: 'html-comment' },
          // 容错：仅有 <suggestedOptions> 开始标签到末尾
          { regex: /<suggestedOptions>([\s\S]*?)$/i, name: 'plain-tag-unclosed' },
          // 兼容变体：纯标签 <suggestedOptions> ... </suggestedOptions>
          { regex: /<suggestedOptions>([\s\S]*?)<\/suggestedOptions>/i, name: 'plain-tag' },
          // 兼容变体：方括号 [suggested_options] ... [/suggested_options]
          { regex: /\[suggested_options\]\s*([\s\S]*?)\[\/suggested_options\]/i, name: 'bracket-tag' },
        ];

        let matchedOptions: string | null = null;
        let matchedPatternName = '';
        let matchedFullText = '';
        for (const pattern of optionPatterns) {
          pattern.regex.lastIndex = 0;
          const m = finalContent.match(pattern.regex);
          if (m) {
            matchedOptions = m[1];
            matchedFullText = m[0];
            matchedPatternName = pattern.name;
            break;
          }
        }

        if (matchedOptions) {
          // 解析选项行，支持多种编号格式：1. / 1) / ① / - / * / ()
          suggestedOptions = matchedOptions
            .split('\n')
            .map(line => line
              .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '')
              .replace(/^\d+[\.\)、\)]\s*/, '')
              .replace(/^[-\*]\s*/, '')
              .replace(/^\(\d+\)\s*/, '')
              .trim()
            )
            .filter(line => line.length > 0 && !/^<<<|^<!--|^<suggestedOptions|^<\/suggestedOptions|^\[\/?suggested|^<<<END/i.test(line))
            .slice(0, 3);
          // 从显示内容和最终内容中剥离选项块
          finalContent = finalContent.replace(matchedFullText, '').trim();
          // 【重点标记】修复：设置 optionsStripped 标志，供后续内容保护检查跳过此场景，
          // 否则剥离后 displayContent 变短会触发内容保护检查导致状态不更新、UI 卡死。
          optionsStripped = true;
          addLog(`[CharacterDialogueChat] 辅助模式：通过 [${matchedPatternName}] 格式解析到 ${suggestedOptions.length} 个推荐选项`, 'info');
        } else {
          addLog(`[CharacterDialogueChat] 辅助模式已开启但未匹配到选项块，回复末尾 200 字: ${finalContent.substring(Math.max(0, finalContent.length - 200))}`, 'warn');
        }
      }

      // ===== 表情显示：解析情绪标记（Spec: add-character-expression-system / Task 9.3 + 9.4 + 9.5） =====
      // 【重点标记】修复：增加 emotionStripped 标志，供后续内容保护检查跳过此场景，
      // 否则剥离标记后 displayContent 变短会触发内容保护检查导致状态不更新、UI 卡死。
      // 模式参照 thinkTagsStripped / optionsStripped。
      // 【重点标记 - 反复修复】增强诊断日志：返回 matchedPattern 用于定位正则匹配情况，
      // 解决用户反复反馈"从第 3 条消息起表情渲染失效"时无法定位根因的问题。
      let emotionStripped = false;
      let parsedEmotion: string | null = null;
      // 表情系统永久开启，始终解析表情标记
      {
        const { emotion, cleanedContent, matchedPattern } = parseExpressionFromContent(finalContent);
        if (emotion) {
          parsedEmotion = emotion;
          const beforeStripLen = finalContent.length;
          finalContent = cleanedContent;
          if (finalContent.length !== beforeStripLen) {
            emotionStripped = true;
          }
          addLog(`[CharacterDialogueChat] 表情系统：解析到情绪键 "${emotion}"（匹配模式: ${matchedPattern}）`, 'info');
        } else {
          // 【重点标记 - 反复修复】详细诊断日志：输出末尾 300 字 + 是否含 EXPRESSION 字样
          // 用于区分"AI 未生成标记"和"生成了标记但正则未匹配"两种场景
          const tailContent = finalContent.substring(Math.max(0, finalContent.length - 300));
          const hasExpressionKeyword = finalContent.includes('EXPRESSION') || finalContent.includes('expression');
          addLog(
            `[CharacterDialogueChat] 未匹配到情绪标记，回退默认表情。` +
            `含 EXPRESSION 关键字: ${hasExpressionKeyword}，回复末尾 300 字: ${JSON.stringify(tailContent)}`,
            'warn'
          );
          console.warn('[ExpressionParse] 未匹配到情绪标记。末尾 300 字:', JSON.stringify(tailContent));
        }
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
          // 松散/变体格式：兼容AI可能产出的各种格式
          { regex: /<\s*tableEdit\s*>([\s\S]*?)<\s*\/\s*tableEdit\s*>/gi, name: '松散标签格式(含空格)' },
          { regex: /\[tableEdit\]\s*([\s\S]*?)\s*\[\/tableEdit\]/gi, name: '方括号标记格式' },
          { regex: /【tableEdit】\s*([\s\S]*?)\s*【\/tableEdit】/gi, name: '中文方括号标记格式' },
          { regex: /tableEdit\s*[:：]\s*([\s\S]*)$/gi, name: '纯文本前缀格式(tableEdit:)' },
          { regex: /命令\s*[:：]\s*([\s\S]*)$/gi, name: '纯文本前缀格式(命令：)' },
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
            .replace(/<\s*tableEdit\s*>[\s\S]*?<\s*\/\s*tableEdit\s*>/gi, '')  // 松散标签格式
            .replace(/\[tableEdit\][\s\S]*?\[\/tableEdit\]/gi, '')  // 方括号标记格式
            .replace(/【tableEdit】[\s\S]*?【\/tableEdit】/gi, '')  // 中文方括号标记格式
            .replace(/tableEdit\s*[:：][\s\S]*$/gi, '')  // 纯文本前缀格式(tableEdit:)
            .replace(/命令\s*[:：][\s\S]*$/gi, '')  // 纯文本前缀格式(命令：)
            // 清理残留的空行和多余空格
            .replace(/\n{3,}/g, '\n\n')
            .replace(/\s+$/g, '')
            .trim();
          
          addLog(`[CharacterDialogueChat] tableEdit标签已从显示内容移除，原始长度: ${beforeLength}, 显示长度: ${displayContent.length}, 移除长度: ${beforeLength - displayContent.length}`, 'info');

          // 检查命令内容是否为空
          if (!rawCommandsText || !rawCommandsText.trim()) {
            addLog('[CharacterDialogueChat] 匹配到tableEdit标签但命令内容为空，跳过异步整理', 'warn');
            // 注意：此处不重置 hasAsyncCommands，标签已从 displayContent 移除，
            // 需保持 isAsyncMode=true 跳过内容保护检查，避免 UI 卡死
          } else {
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

                // 解析失败降级处理：记录日志，不阻塞 UI 更新
                if (!parseResult.success) {
                  addLog(`[CharacterDialogueChat] parseTableEdit 解析失败，降级处理: ${parseResult.errors.join('; ') || '未知错误'}`, 'warn');
                  if (parseResult.commands.length === 0) {
                    return; // 无有效命令，跳过执行
                  }
                }

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
                      let refreshedData = await window.electronAPI.memory.getTableData(chatId);
                      if (refreshedData?.data) {
                        memoryTableDataRef.current = refreshedData.data;
                        addLog('[CharacterDialogueChat] 表格数据已刷新，后续对话将使用最新上下文', 'info');
                      } else {
                        addLog('[CharacterDialogueChat] 刷新表格数据失败: getTableData 返回空数据', 'warn');
                      }
                    } catch (refreshError) {
                      const refreshErrMsg = refreshError instanceof Error ? refreshError.message : String(refreshError);
                      addLog(`[CharacterDialogueChat] 刷新表格数据失败: ${refreshErrMsg}`, 'warn');
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
          }
        } else {
          addLog('[CharacterDialogueChat] 未检测到tableEdit标签（任何格式），跳过异步整理', 'warn');
        }
      }

      // ===== 去重检测（Spec: optimize-chat-ai-intelligence / Task 5.2 + 5.3）=====
      // 在最终 setState 前检查：
      // - 重试去重：nGramJaccard(previousResponse, displayContent) > 0.8 → 重新生成
      // - 续写去重：overlapRate(newPart, initialContent) > 0.6 → 重新生成（注入 continue_nudge_prompt）
      // 最多重试 2 次（spec 约定），耗尽后保留最后一次结果并 toast 提示。
      // 注意：不改变 retryMessage / continueConversation 现有签名，去重作为 onComplete 后的增强。
      const dedupRetryCount = dedupConfig?.retryCount ?? 0;
      const dedupMaxRetries = dedupConfig?.maxRetries ?? DEFAULT_MAX_DEDUP_RETRIES;
      let shouldDedupRetry = false;
      let dedupReason = '';
      let nextDedupConfig: DedupConfig | undefined = undefined;

      if (dedupConfig?.previousResponse && displayContent) {
        // 重试去重：与上一条 assistant 回复比较 4-gram Jaccard 相似度
        const similarity = nGramJaccard(dedupConfig.previousResponse, displayContent, 4);
        addLog(
          `[CharacterDialogueChat] Retry dedup check: similarity=${similarity.toFixed(3)} ` +
          `(threshold=${RETRY_SIMILARITY_THRESHOLD}, attempt ${dedupRetryCount + 1}/${dedupMaxRetries + 1})`,
          'info'
        );
        if (similarity > RETRY_SIMILARITY_THRESHOLD) {
          if (dedupRetryCount < dedupMaxRetries) {
            shouldDedupRetry = true;
            dedupReason = `similarity=${similarity.toFixed(2)}`;
            nextDedupConfig = { ...dedupConfig, retryCount: dedupRetryCount + 1 };
          } else {
            // 重试耗尽：保留最后一次结果，toast 提示
            message.info(`已尝试 ${dedupMaxRetries + 1} 次，回复相似度较高`);
            addLog(
              `[CharacterDialogueChat] Retry dedup exhausted after ${dedupMaxRetries + 1} attempts ` +
              `(similarity=${similarity.toFixed(2)}, keeping last result)`,
              'warn'
            );
          }
        }
      } else if (promptType === 'continuation' && initialContentRef.current && displayContent) {
        // 续写去重：检测 AI 是否原样重写 initialContent（而非添加新内容）
        const initial = initialContentRef.current;
        // 剥离 initialContent 前缀，得到 AI 实际生成的"新部分"
        // 若 displayContent 不以 initial 开头（异常情况），整体作为 newPart 参与计算
        const newPart = displayContent.startsWith(initial) ? displayContent.slice(initial.length) : displayContent;
        const overlap = overlapRate(newPart, initial);
        addLog(
          `[CharacterDialogueChat] Continue dedup check: overlap=${overlap.toFixed(3)} ` +
          `(threshold=${CONTINUE_OVERLAP_THRESHOLD}, attempt ${dedupRetryCount + 1}/${dedupMaxRetries + 1})`,
          'info'
        );
        if (overlap > CONTINUE_OVERLAP_THRESHOLD) {
          if (dedupRetryCount < dedupMaxRetries) {
            shouldDedupRetry = true;
            dedupReason = `overlap=${overlap.toFixed(2)}`;
            // 续写重试注入 continue_nudge_prompt（Task 8.2 已完善：
            // buildContinuationPrompt 末尾已含 nudge 段落，重试时再追加 system 消息）
            nextDedupConfig = { retryCount: dedupRetryCount + 1, injectContinueNudge: true };
          } else {
            message.info(`已尝试 ${dedupMaxRetries + 1} 次，续写重叠率较高`);
            addLog(
              `[CharacterDialogueChat] Continue dedup exhausted after ${dedupMaxRetries + 1} attempts ` +
              `(overlap=${overlap.toFixed(2)}, keeping last result)`,
              'warn'
            );
          }
        }
      }

      if (shouldDedupRetry) {
        addLog(
          `[CharacterDialogueChat] Dedup retry triggered: ${dedupReason} ` +
          `(next attempt ${dedupRetryCount + 2}/${dedupMaxRetries + 1})`,
          'info'
        );
        // 重置流式累积缓冲，使下一次生成从 initialContent 重新开始
        streamContentRef.current = initialContentRef.current;
        // 将目标消息重置为 sending 状态（保留 initialContent 作为内容前缀，避免内容闪烁）
        const dedupRetryState = stateRef.current;
        const dedupRetryMessages = dedupRetryState.messages.map(msg =>
          msg.id === targetMessageId
            ? { ...msg, content: initialContentRef.current, status: 'sending' as const }
            : msg
        );
        dispatch({ type: 'UPDATE_MESSAGES', messages: dedupRetryMessages });
        dispatch({ type: 'SET_LOADING', isLoading: true, isStreaming: true });
        // 触发重试（fire-and-forget，错误由 onError / catch 处理）
        // 注：requestAIResponse 在 useCallback 闭包内可访问自身引用
        requestAIResponse(contextMessages, targetMessageId, initialContentRef.current, promptType, nextDedupConfig).catch(err => {
          const errMsg = err instanceof Error ? err.message : String(err);
          addLog(`[CharacterDialogueChat] Dedup retry failed: ${errMsg}`, 'error');
          message.error(`重试失败: ${errMsg}`);
        });
        // 不进入最终 setState 流程，等待重试完成
        return;
      }

      const completeState = stateRef.current;
      const targetMessage = completeState.messages.find(msg => msg.id === targetMessageId);
      if (!targetMessage) {
        addLog(`[CharacterDialogueChat] Target message ${targetMessageId} not found in current messages`, 'error');
        return;
      }

      const existingContent = targetMessage.content;
      // 异步模式下，tableEdit标签从显示内容中移除导致内容变短，需要跳过内容保护检查
      const isAsyncMode = memoryTableAutoOrganizeRef.current && memoryTableOrganizeModeRef.current === 'async' && hasAsyncCommands;
      // 【重点标记】修复：think 标签剥离导致的合法内容缩短也不应触发保护检查，
      // 否则状态不更新 → UI 卡死在"正在生成中"（Spec: fix-think-strip-content-protection）
      // 【重点标记】修复：辅助模式选项块剥离同样会导致合法内容缩短，需跳过保护检查（Spec: add-assist-mode-options）
      // 【重点标记】修复：表情显示情绪标记剥离同样会导致合法内容缩短，需跳过保护检查
      // （Spec: add-character-expression-system / Task 9.5）
      // 【重点标记】修复：stop sequences 或 max_tokens 截断会导致 finalContent 短于流式累积的
      // existingContent。此时 displayContent 是 AI 实际完成的回复（被后端合法截断），
      // 不应误判为内容丢失。容差阈值：displayContent 不少于 existingContent 的 30% 即视为合法截断。
      const stopTruncated = existingContent.length > 0
        && displayContent.length < existingContent.length
        && displayContent.length >= existingContent.length * 0.3;
      if (!isAsyncMode && !thinkTagsStripped && !optionsStripped && !emotionStripped && !stopTruncated && existingContent.length > 0 && displayContent.length < existingContent.length) {
        addLog(`[CharacterDialogueChat] Content protection: preventing content loss (${existingContent.length} -> ${displayContent.length})`, 'error');
        return;
      }

      const finalMessages = completeState.messages.map(msg =>
        msg.id === targetMessageId ? { ...msg, content: displayContent, status: 'sent' as const, suggestedOptions: suggestedOptions.length > 0 ? suggestedOptions : undefined, emotion: parsedEmotion || undefined } : msg
      );

      // 【重点标记 - 反复修复】诊断日志：确认 emotion 字段在 dispatch 前的最终值
      // 用于排查"表情渲染从第 3 条消息起失效"问题——确认是解析层还是渲染层的问题
      const finalTargetMsg = finalMessages.find(m => m.id === targetMessageId);
      console.log('[ExpressionDebug] STREAM_COMPLETE 即将 dispatch:', {
        messageId: targetMessageId,
        parsedEmotion,
        finalEmotion: finalTargetMsg?.emotion,
        hasContent: !!finalTargetMsg?.content,
        contentLength: finalTargetMsg?.content?.length,
      });

      // 保存聊天记录 - 注意：不在 dispatch 后立即调用异步函数，使用 setTimeout 延迟
      // 使用 clean 副本避免 IPC 序列化错误
      const messagesToSave = finalMessages.map(msg => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        status: msg.status,
        speakerName: msg.speakerName,
        speakerAvatar: msg.speakerAvatar,
        // 保存辅助模式推荐选项，使刷新/重启后仍可展示（Spec: add-assist-mode-options）
        suggestedOptions: msg.suggestedOptions,
        // 保存情绪键名，使刷新/重启后表情仍可还原（Spec: add-character-expression-system / Task 9.4）
        emotion: msg.emotion,
        // 【Bug 4 修复】图片消息字段透传（Spec: fix-conversation-image-generation-bugs）
        generatedImage: msg.generatedImage,
        isImageMessage: msg.isImageMessage,
        // 图片附属内容透传（Spec: enhance-conversation-image-bubble / Task 1）
        // 取代独立图片消息，作为父文本消息的嵌套字段持久化
        imageAttachment: msg.imageAttachment,
      }));

      // 使用 setTimeout 延迟保存，避免在状态更新过程中执行异步操作
      setTimeout(() => {
        saveChatToStore(messagesToSave).catch(err => {
          addLog(`[CharacterDialogueChat] Failed to save chat: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
        });
      }, 0);

      dispatch({ type: 'STREAM_COMPLETE', messages: finalMessages });

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

      // ========== 增量向量化触发（Spec: optimize-chat-ai-intelligence / Task 7.6） ==========
      // 每 5 轮（即 10 条 user+assistant 消息）自动调用 ChatVectorizationService.vectorizeIncremental
      // 增量向量化本会话最近消息，为后续轮次的 RAG 检索（Step A2）积累向量数据。
      //
      // 触发条件：shouldTriggerIncrementalVectorize(contextMessages.length)
      //   = (contextMessages.length + 1) % 10 === 0
      //   - contextMessages = 进入 requestAIResponse 时的消息数组（含本轮 user，不含 AI placeholder）
      //   - +1 = 本轮 AI 响应（displayContent）—— onComplete 时已生成完毕
      //   - 故 (contextMessages.length + 1) = 本轮结束后总消息数（含 user + AI 配对）
      //   - 例：第 5 轮结束 → contextMessages.length=9 → 9+1=10 → 触发；第 10 轮 → 19+1=20 → 触发
      //
      // fire-and-forget（不 await），不阻塞 UI；失败仅记录日志。
      // recentMessages = 最后 10 条消息（contextMessages 末尾 + 本轮 AI 响应）。
      if (shouldTriggerIncrementalVectorize(contextMessages.length)) {
        try {
          const incrementalChatId = characterInfo.characterCardName || characterInfo.characterCardId;
          if (incrementalChatId) {
            // 构造最近 10 条消息：contextMessages 末尾 9 条 + 本轮 AI 响应
            const recentMessagesForVectorize = extractRecentMessagesForVectorize(
              contextMessages,
              displayContent,
              targetMessageId,
              10
            );

            addLog(
              `[CharacterDialogueChat] Step A2-incremental: triggering vectorizeIncremental ` +
              `(total=${contextMessages.length + 1}, recent=${recentMessagesForVectorize.length}, chatId=${incrementalChatId})`,
              'info'
            );
            // fire-and-forget：不 await，错误由 .catch 内部记录
            window.electronAPI.chatHistory
              .vectorizeIncremental(incrementalChatId, recentMessagesForVectorize)
              .catch(err => {
                addLog(
                  `[CharacterDialogueChat] Step A2-incremental: vectorizeIncremental failed (fire-and-forget): ` +
                  `${err instanceof Error ? err.message : String(err)}`,
                  'warn'
                );
              });
          }
        } catch (error) {
          addLog(
            `[CharacterDialogueChat] Step A2-incremental: trigger setup failed: ` +
            `${error instanceof Error ? error.message : 'Unknown error'}`,
            'warn'
          );
        }
      }

      initialContentRef.current = '';
      targetMessageIdRef.current = '';

      // ========== 回复长度诊断与历史记录（Spec: fix-ai-response-length-degradation / Task 1 & 4） ==========
      // Task 4.3：更新回复长度历史（在诊断日志之前 push，供 shouldStrengthenLength 下一轮判定）
      // 维护最近 20 轮字符数，超过 20 轮时 shift 出队（FIFO）
      if (finalContent && finalContent.length > 0) {
        responseLengthHistoryRef.current.push(finalContent.length);
        if (responseLengthHistoryRef.current.length > 20) {
          responseLengthHistoryRef.current.shift();
        }
      }

      // Task 1.2 + 1.3：回复长度诊断日志
      // 记录每轮回复的字符数、token 估算、生成耗时、关键采样参数，便于定位长度递减拐点
      // 自动恢复（Task 4.4）：shouldStrengthenLength 基于 responseLengthHistoryRef 动态判定，
      // 当某轮回复 >= min_response_chars 时，最近 3 轮不再全部低于阈值，强化约束自动失效。
      try {
        const durationSec = requestStartTimeRef.current > 0
          ? (Date.now() - requestStartTimeRef.current) / 1000
          : 0;
        const chars = finalContent.length;
        // 粗略 token 估算（中文约 1.3 token/字）；精确计数为异步，诊断日志用估算即可
        const tokensEstimate = Math.ceil(chars * 1.3);
        const diagEffectiveParams = getEffectiveParams();
        const roundNum = responseLengthHistoryRef.current.length;
        const logMsg = `[ResponseLength] round=${roundNum}, chars=${chars}, tokens≈${tokensEstimate}, duration=${durationSec.toFixed(1)}s, max_tokens=${diagEffectiveParams.max_tokens}, freq_pen=${diagEffectiveParams.frequency_penalty ?? 'N/A'}, pres_pen=${diagEffectiveParams.presence_penalty ?? 'N/A'}, dry=${diagEffectiveParams.dry_multiplier ?? 'N/A'}`;
        console.log(logMsg);
        addLog(logMsg, 'info');
      } catch (e) {
        console.warn('[ResponseLength] diagnostic logging failed:', e);
      }
    });

    engine.onError((error) => {
      clearStreamTimeout();
      const errorState = stateRef.current;
      const errorMsg = errorState.messages.find(m => m.id === targetMessageId);
      dispatch({ type: 'STREAM_ERROR', targetMessageId, content: errorMsg?.content ? `${errorMsg.content}\n\nError: ${error.message}` : `Error: ${error.message}`, error: error.message });
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

    // 续写去重重试：注入 continue_nudge_prompt system 消息到对话末尾
    // Spec: optimize-chat-ai-intelligence / Task 5.3 + Task 8.2 + Scenario: 续写去重
    // Task 8.2 实现：buildContinuationPrompt 末尾已含 nudge 段落（Task 8.1），
    //   重试时通过 injectContinueNudge=true 在消息数组末尾追加 system 消息，
    //   形成"system prompt 段落 + 消息数组末尾 system 消息"双重提示，强化 AI 不重复已有内容。
    // 注：buildContinuationPrompt 在 Step B 已构建 effectiveSystemPrompt 时调用，
    //   重试时 requestAIResponse 重新进入会再次构建（始终含 nudge 段落）。
    let messagesToSendFinal = messagesToUse;
    if (dedupConfig?.injectContinueNudge) {
      const nudgePrompt = buildContinueNudgePrompt();
      messagesToSendFinal = [
        ...messagesToUse,
        {
          id: `continue-nudge-${Date.now()}`,
          role: 'system' as const,
          content: nudgePrompt,
          timestamp: Date.now(),
        },
      ];
      addLog(`[CharacterDialogueChat] Continue dedup retry: injected continue_nudge_prompt as system message (${nudgePrompt.length} chars)`, 'info');
    }

    // 【重点标记 - 推理模型兼容性】注入标签输出提醒
    // 问题：DeepSeek-V4-Pro / x-deepseek-reasoner 等推理模型在长系统提示词下，
    //   生成思考内容 + 故事正文后倾向于直接停止（finish_reason=stop），
    //   不输出 <<<EXPRESSION>>> 和 <<<SUGGESTED_OPTIONS>>> 标签。
    // 修复：将标签提醒追加到最后一条 user 消息末尾（不能用 system 消息，
    //   因为 ChatEngine.sanitizeChatHistory 会剔除所有 system 角色消息）。
    // 测试验证：注入提醒后标签返回率从 0% 提升至 100%。
    if (promptType === 'dialogue' && messagesToSendFinal.length > 0) {
      const assistModeEnabled = characterConfig?.customParameters?.assist_mode === true;
      const tagReminderParts: string[] = [
        '\n\n【系统提醒】请在回复正文末尾严格按格式输出 <<<EXPRESSION>>>情绪键名<<<END_EXPRESSION>>> 标签。',
      ];
      if (assistModeEnabled) {
        tagReminderParts.push('并在表情标签之前输出 <<<SUGGESTED_OPTIONS>>> 选项块（3个选项，含 <<<END_OPTIONS>>> 结束标记）。');
      }
      const tagReminder = tagReminderParts.join('');

      // 找到最后一条 user 消息并追加提醒
      let lastUserIdx = -1;
      for (let i = messagesToSendFinal.length - 1; i >= 0; i--) {
        if (messagesToSendFinal[i].role === 'user') {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx >= 0) {
        const lastMsg = messagesToSendFinal[lastUserIdx];
        messagesToSendFinal = [...messagesToSendFinal];
        messagesToSendFinal[lastUserIdx] = {
          ...lastMsg,
          content: lastMsg.content + tagReminder,
        };
        addLog(`[CharacterDialogueChat] 已注入标签输出提醒到末尾 user 消息 (${tagReminder.length} chars, assistMode=${assistModeEnabled})`, 'info');
      }
    }

    try {
      console.log('[DEBUG-FLOW] Step E: Calling engine.sendMessage');
      await engine.sendMessage(messagesToSendFinal, effectiveSystemPrompt, engineConfigWithParams);
      console.log('[DEBUG-FLOW] Step E: engine.sendMessage returned successfully');
      console.log('[DEBUG-FLOW] === requestAIResponse END ===');
    } catch (error) {
      console.error('[DEBUG-FLOW] Step E: engine.sendMessage threw error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
      const catchState = stateRef.current;
      const catchMsg = catchState.messages.find(m => m.id === targetMessageId);
      dispatch({ type: 'STREAM_ERROR', targetMessageId, content: catchMsg?.content ? `${catchMsg.content}\n\nError: ${errorMessage}` : `Error: ${errorMessage}`, error: errorMessage });
      message.error(`Failed: ${errorMessage}`);
      initialContentRef.current = '';
    }
  } catch (error) {
    console.error('[DEBUG-FLOW] !!! requestAIResponse UNCAUGHT EXCEPTION:', error);
    console.error('[DEBUG-FLOW] !!! error stack:', error instanceof Error ? error.stack : 'N/A');
    dispatch({ type: 'STREAM_ERROR', targetMessageId, content: `错误: ${error instanceof Error ? error.message : '未知错误'}`, error: error instanceof Error ? error.message : '未知错误' });
    message.error(`对话请求失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
  }, [getActiveEngineConfig, getEffectiveParams, buildDialoguePrompt, buildContinuationPrompt, saveChatToStore, addLog, characterConfig, selectedPersona]);

  /**
   * 生成用户回复（Spec: add-ai-user-reply-button / Task 2）
   *
   * 以当前用户人设为基准，调用 AI 模型生成下一句用户侧对话内容。
   * 复用 requestAIResponse 的引擎调用与参数注入模式，但：
   *   - 系统提示改用 buildUserReplySystemPrompt（指示 AI 仅生成用户回复）
   *   - 停止序列改用 buildStopSequencesForUserReply（角色名变体，防止越权生成角色回复）
   *   - 不向 state.messages 添加 placeholder 消息（生成内容仅填入输入框）
   *   - 流式累积到 generatedReplyAccumulatedRef，完成后通过 Promise resolve 返回
   *
   * @returns 生成的用户回复文本；前置校验失败时返回空串
   */
  const generateUserReply = useCallback(async (userInstruction?: string): Promise<string> => {
    // 前置校验：未选择用户人设
    if (!selectedPersona) {
      message.warning('请先在右侧面板选择用户人设');
      return '';
    }
    // 避免并发：流式生成中 / 表格整理中 / 已在生成用户回复中
    if (state.isStreaming || isOrganizing || isGeneratingUserReplyRef.current) {
      return '';
    }

    const activeEngine = getActiveEngineConfig();
    if (!activeEngine) {
      message.warning('请先在设置中配置AI引擎');
      return '';
    }

    // 设置生成中状态：state 用于 UI 重渲染，ref 用于 cancelRequest 同步读取
    setIsGeneratingUserReply(true);
    isGeneratingUserReplyRef.current = true;
    generatedReplyAccumulatedRef.current = '';
    isGeneratingUserReplyAbortRef.current = false;

    const effectiveParams = getEffectiveParams();
    const charName = characterInfo.characterCardName || 'Character';
    const customStopSequencesEnabled = characterConfig?.customStopSequencesEnabled === true;
    const customStopSequences = customStopSequencesEnabled
      ? (characterConfig?.customStopSequences || [])
      : undefined;

    // 构建用户回复专用系统提示（Spec: add-ai-user-reply-button / Task 1.1）
    // 与 requestAIResponse 不同：不拼接全局 system_prompt，避免淡化"仅生成用户回复"约束
    // userInstruction: 输入框中的内容作为用户指令，引导 AI 按用户意图生成回复
    const userReplySystemPrompt = buildUserReplySystemPrompt(
      {
        characterCardName: characterInfo.characterCardName,
        personality: characterInfo.personality,
        characterCardContent: characterInfo.characterCardContent,
        scenario: characterInfo.scenario,
        mes_example: characterInfo.mes_example,
        system_prompt: characterInfo.system_prompt,
        creator_notes: characterInfo.creator_notes,
      },
      selectedPersona,
      characterConfig?.userReplyPerson,  // 人称视角（Spec: add-person-attribute-to-ai-reply / Task 2）
      userInstruction                    // 用户指令（输入框内容，可选）
    );

    // 构造 engineConfigWithParams（复用 requestAIResponse 的参数注入模式）
    // 关键差异：stopSequences 改用 buildStopSequencesForUserReply（角色名变体），
    // 防止 AI 越权代替角色发言；其余字段（含 DRY 采样组）与 requestAIResponse 完全一致。
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
      // Stop sequences（Spec: add-ai-user-reply-button / Task 1.2）
      // 角色名变体阻断 AI 越权生成角色回复；customStopSequences 来自角色会话配置
      stopSequences: buildStopSequencesForUserReply(charName, customStopSequences),
      // 后端能力探测：优先用引擎显式配置，缺省按 api_mode 推断默认值
      capabilities: activeEngine.capabilities || getDefaultEngineCapabilities(),
      // 能力感知透传（Spec: upgrade-ai-handler-multimodal-compatibility / Task 3.2 + 3.4）
      // 将用户思维链/工具调用开关透传给 ChatEngine，由其按 supportsThinking / supportsToolCalling 守卫。
      enable_chain_of_thought: activeEngine.enable_chain_of_thought,
      use_function_calling: activeEngine.use_function_calling,
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
    // Repetition penalty + DRY 采样参数注入（与 requestAIResponse 一致）
    if (effectiveParams.repetition_penalty !== undefined) {
      engineConfigWithParams.repetition_penalty = Number(effectiveParams.repetition_penalty);
    }
    if (effectiveParams.dry_multiplier !== undefined) {
      engineConfigWithParams.dry_multiplier = Number(effectiveParams.dry_multiplier);
    }
    if (effectiveParams.dry_base !== undefined) {
      engineConfigWithParams.dry_base = Number(effectiveParams.dry_base);
    }
    if (effectiveParams.dry_allowed_length !== undefined) {
      engineConfigWithParams.dry_allowed_length = Number(effectiveParams.dry_allowed_length);
    }
    if (effectiveParams.no_repeat_ngram_size !== undefined) {
      engineConfigWithParams.no_repeat_ngram_size = Number(effectiveParams.no_repeat_ngram_size);
    }
    if (effectiveParams.top_k !== undefined) {
      engineConfigWithParams.top_k = Number(effectiveParams.top_k);
    }
    if (effectiveParams.min_p !== undefined) {
      engineConfigWithParams.min_p = Number(effectiveParams.min_p);
    }

    // 取最近对话历史作为 contextMessages（排除 system 消息，避免与 userReplySystemPrompt 冲突）
    let contextMessages = messagesRef.current.filter(msg => msg.role !== 'system');

    // 上下文裁剪（如启用 token 管理）——参考 requestAIResponse 的裁剪调用，
    // 但不注入 roleAnchorMessage（角色锚定仅适用于角色回复生成场景）
    const tokenManagementEnabled = characterConfig?.tokenManagementEnabled ?? false;
    if (tokenManagementEnabled) {
      const truncationConfig: TruncationConfig = {
        enabled: true,
        maxContextTokens: characterConfig?.maxContextTokens ?? 256000,
        reservedForResponse: characterConfig?.reservedForResponse ?? 4096,
        minMessagesToKeep: characterConfig?.minMessagesToKeep ?? 3,
        maxMessagesToKeep: characterConfig?.maxMessagesToKeep ?? 60,
      };
      try {
        // 预热精确 Token 计数缓存（与 requestAIResponse 一致）
        await Promise.all([
          TokenCounter.precountMessages(contextMessages),
          TokenCounter.precountSystemPrompt(userReplySystemPrompt),
        ]);
      } catch (err) {
        console.warn('[TokenManagement] generateUserReply precount failed, falling back to byte estimation:', err);
      }
      const systemPromptTokens = TokenCounter.countSystemPromptTokens(userReplySystemPrompt);
      const truncatedMessages = ContextTruncator.truncateMessages(
        contextMessages,
        systemPromptTokens,
        truncationConfig,
        undefined,
        undefined  // 不注入 roleAnchorMessage（角色锚定不适用于用户回复生成）
      );
      const truncationAnalysis = ContextTruncator.analyzeTruncation(
        contextMessages,
        truncatedMessages,
        systemPromptTokens,
        truncationConfig
      );
      if (truncationAnalysis.wasTruncated) {
        addLog(
          `[CharacterDialogueChat] generateUserReply context truncated: ${truncationAnalysis.originalCount} -> ${truncationAnalysis.truncatedCount} messages`,
          'warn'
        );
      }
      contextMessages = truncatedMessages;
    }

    // 获取引擎实例
    const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(engineConfigWithParams);

    addLog(
      `[CharacterDialogueChat] generateUserReply started (charName=${charName}, persona=${selectedPersona.name}, context=${contextMessages.length} msgs)`,
      'info'
    );

    // 返回 Promise，在 onComplete 中 resolve，onError 中 reject
    return new Promise<string>((resolve, reject) => {
      engine.onStream((chunk: string) => {
        // 取消后忽略后续 chunk，避免污染 generatedReplyAccumulatedRef
        if (isGeneratingUserReplyAbortRef.current) return;
        if (chunk) {
          generatedReplyAccumulatedRef.current += chunk;
        }
      });

      engine.onComplete((response: AIResponse) => {
        // 优先使用 server 返回的 content，回退到本地流式累积（与 requestAIResponse 一致）
        const finalContent = response?.content || generatedReplyAccumulatedRef.current;
        addLog(`[CharacterDialogueChat] generateUserReply completed: ${finalContent.length} chars`, 'info');
        resolve(finalContent);
      });

      engine.onError((error) => {
        console.error('[CharacterDialogueChat] generateUserReply error:', error);
        message.error(`生成用户回复失败: ${error.message}`);
        addLog(`[CharacterDialogueChat] generateUserReply error: ${error.message}`, 'error');
        reject(new Error(error.message));
      });

      // 调用引擎发送消息
      engine.sendMessage(contextMessages, userReplySystemPrompt, engineConfigWithParams).catch((err: any) => {
        console.error('[CharacterDialogueChat] generateUserReply sendMessage threw:', err);
        message.error(`生成用户回复失败: ${err?.message || '未知错误'}`);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    }).finally(() => {
      // 无论成功/失败/取消，都重置生成中状态
      setIsGeneratingUserReply(false);
      isGeneratingUserReplyRef.current = false;
      generatedReplyAccumulatedRef.current = '';
    });
  }, [selectedPersona, state.isStreaming, isOrganizing, characterInfo, characterConfig, getActiveEngineConfig, getEffectiveParams, addLog]);

  /**
   * 润色用户输入文本（Spec: refine-user-input-text / Task 2）
   *
   * 以当前用户人设为基准，调用 AI 模型对用户输入的原始文本进行润色。
   * 复用 generateUserReply 的引擎调用与参数注入模式，但：
   *   - 系统提示改用 buildPolishInputSystemPrompt（指示 AI 仅润色给定文本，
   *     保持原意与视角，不改写为对话回复）
   *   - 停止序列仍使用 buildStopSequencesForUserReply（角色名变体，防止越权生成角色回复）
   *   - 不向 state.messages 添加 placeholder 消息（生成内容仅填入输入框）
   *   - 流式累积到 polishedAccumulatedRef，完成后通过 Promise resolve 返回
   *
   * @param originalText 待润色的原始用户输入文本
   * @returns 润色后的文本；前置校验失败时返回空串
   */
  const polishInput = useCallback(async (originalText: string): Promise<string> => {
    // 前置校验：原始文本为空或仅空白
    if (!originalText || !originalText.trim()) {
      message.warning('请先输入需要润色的文本');
      return '';
    }
    // 前置校验：未选择用户人设
    if (!selectedPersona) {
      message.warning('请先在右侧面板选择用户人设');
      return '';
    }
    // 避免并发：流式生成中 / 表格整理中 / 已在生成用户回复中 / 已在润色输入中
    if (state.isStreaming || isOrganizing || isGeneratingUserReply || isPolishingInputRef.current) {
      return '';
    }

    const activeEngine = getActiveEngineConfig();
    if (!activeEngine) {
      message.warning('请先在设置中配置AI引擎');
      return '';
    }

    // 设置润色中状态：state 用于 UI 重渲染，ref 用于 cancelRequest 同步读取
    setIsPolishingInput(true);
    isPolishingInputRef.current = true;
    polishedAccumulatedRef.current = '';
    isPolishingInputAbortRef.current = false;

    const effectiveParams = getEffectiveParams();
    const charName = characterInfo.characterCardName || 'Character';
    const customStopSequencesEnabled = characterConfig?.customStopSequencesEnabled === true;
    const customStopSequences = customStopSequencesEnabled
      ? (characterConfig?.customStopSequences || [])
      : undefined;

    // 取最近对话历史作为 contextMessages（排除 system 消息，避免与 polishSystemPrompt 冲突）
    // Spec: fix-polish-context-isolation - 对话历史将嵌入系统提示的"## 对话历史参考"段落，
    // 而非作为 messages 数组传给 engine，避免以 assistant 结尾的对话历史触发 AI 续写本能
    let contextMessages = messagesRef.current.filter(msg => msg.role !== 'system');

    // 构建 preliminary 润色系统提示（不含对话历史），仅用于 token 计数与裁剪预算估算
    // Spec: fix-polish-context-isolation - 实际系统提示需在裁剪后构建（含裁剪后的对话历史），
    // 此处先构建不含历史的版本供 TokenCounter 估算 base 系统提示 token 占用
    const polishSystemPromptForCounting = buildPolishInputSystemPrompt(
      {
        characterCardName: characterInfo.characterCardName,
        personality: characterInfo.personality,
        characterCardContent: characterInfo.characterCardContent,
        scenario: characterInfo.scenario,
        mes_example: characterInfo.mes_example,
        system_prompt: characterInfo.system_prompt,
        creator_notes: characterInfo.creator_notes,
      },
      selectedPersona,
      originalText,
      characterConfig?.userReplyPerson  // 人称视角（与 generateUserReply 一致）
      // 故意不传 conversationHistory，用于估算 base 系统提示 token
    );

    // 构造 engineConfigWithParams（复用 generateUserReply 的参数注入模式）
    // 关键差异：stopSequences 仍使用 buildStopSequencesForUserReply（角色名变体），
    // 防止 AI 越权代替角色发言；其余字段（含 DRY 采样组）与 generateUserReply 完全一致。
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
      // Stop sequences：角色名变体阻断 AI 越权生成角色回复
      stopSequences: buildStopSequencesForUserReply(charName, customStopSequences),
      // 后端能力探测：优先用引擎显式配置，缺省按 api_mode 推断默认值
      capabilities: activeEngine.capabilities || getDefaultEngineCapabilities(),
      // 能力感知透传（Spec: upgrade-ai-handler-multimodal-compatibility / Task 3.2 + 3.4）
      // 将用户思维链/工具调用开关透传给 ChatEngine，由其按 supportsThinking / supportsToolCalling 守卫。
      enable_chain_of_thought: activeEngine.enable_chain_of_thought,
      use_function_calling: activeEngine.use_function_calling,
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
    // Repetition penalty + DRY 采样参数注入（与 generateUserReply 一致）
    if (effectiveParams.repetition_penalty !== undefined) {
      engineConfigWithParams.repetition_penalty = Number(effectiveParams.repetition_penalty);
    }
    if (effectiveParams.dry_multiplier !== undefined) {
      engineConfigWithParams.dry_multiplier = Number(effectiveParams.dry_multiplier);
    }
    if (effectiveParams.dry_base !== undefined) {
      engineConfigWithParams.dry_base = Number(effectiveParams.dry_base);
    }
    if (effectiveParams.dry_allowed_length !== undefined) {
      engineConfigWithParams.dry_allowed_length = Number(effectiveParams.dry_allowed_length);
    }
    if (effectiveParams.no_repeat_ngram_size !== undefined) {
      engineConfigWithParams.no_repeat_ngram_size = Number(effectiveParams.no_repeat_ngram_size);
    }
    // top_k / min_p 注入（与 requestAIResponse / generateUserReply 一致）
    if (effectiveParams.top_k !== undefined) {
      engineConfigWithParams.top_k = Number(effectiveParams.top_k);
    }
    if (effectiveParams.min_p !== undefined) {
      engineConfigWithParams.min_p = Number(effectiveParams.min_p);
    }

    // 上下文裁剪（如启用 token 管理）——参考 generateUserReply 的裁剪调用，
    // 但不注入 roleAnchorMessage（角色锚定仅适用于角色回复生成场景）
    // Spec: fix-polish-context-isolation - 裁剪仍针对真实对话历史操作；
    // 使用 polishSystemPromptForCounting 估算 base 系统提示 token 占用，
    // 裁剪后的 contextMessages 将嵌入实际系统提示的"## 对话历史参考"段落
    const tokenManagementEnabled = characterConfig?.tokenManagementEnabled ?? false;
    if (tokenManagementEnabled) {
      const truncationConfig: TruncationConfig = {
        enabled: true,
        maxContextTokens: characterConfig?.maxContextTokens ?? 256000,
        reservedForResponse: characterConfig?.reservedForResponse ?? 4096,
        minMessagesToKeep: characterConfig?.minMessagesToKeep ?? 3,
        maxMessagesToKeep: characterConfig?.maxMessagesToKeep ?? 60,
      };
      try {
        // 预热精确 Token 计数缓存（与 generateUserReply 一致）
        await Promise.all([
          TokenCounter.precountMessages(contextMessages),
          TokenCounter.precountSystemPrompt(polishSystemPromptForCounting),
        ]);
      } catch (err) {
        console.warn('[TokenManagement] polishInput precount failed, falling back to byte estimation:', err);
      }
      const systemPromptTokens = TokenCounter.countSystemPromptTokens(polishSystemPromptForCounting);
      const truncatedMessages = ContextTruncator.truncateMessages(
        contextMessages,
        systemPromptTokens,
        truncationConfig,
        undefined,
        undefined  // 不注入 roleAnchorMessage（角色锚定不适用于用户输入润色）
      );
      const truncationAnalysis = ContextTruncator.analyzeTruncation(
        contextMessages,
        truncatedMessages,
        systemPromptTokens,
        truncationConfig
      );
      if (truncationAnalysis.wasTruncated) {
        addLog(
          `[CharacterDialogueChat] polishInput context truncated: ${truncationAnalysis.originalCount} -> ${truncationAnalysis.truncatedCount} messages`,
          'warn'
        );
      }
      contextMessages = truncatedMessages;
    }

    // 构建实际润色系统提示（含裁剪后的对话历史）
    // Spec: refine-user-input-text / Task 1 - 不拼接全局 system_prompt，避免淡化"仅润色文本"约束
    // Spec: fix-polish-context-isolation - 将裁剪后的对话历史作为 conversationHistory 参数传入，
    // 嵌入"## 对话历史参考"段落，避免以 assistant 结尾的对话历史触发 AI 续写本能
    const polishSystemPrompt = buildPolishInputSystemPrompt(
      {
        characterCardName: characterInfo.characterCardName,
        personality: characterInfo.personality,
        characterCardContent: characterInfo.characterCardContent,
        scenario: characterInfo.scenario,
        mes_example: characterInfo.mes_example,
        system_prompt: characterInfo.system_prompt,
        creator_notes: characterInfo.creator_notes,
      },
      selectedPersona,
      originalText,
      characterConfig?.userReplyPerson,  // 人称视角（与 generateUserReply 一致）
      contextMessages  // 裁剪后的对话历史作为系统提示参考（Spec: fix-polish-context-isolation）
    );

    // 获取引擎实例
    const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(engineConfigWithParams);

    addLog(
      `[CharacterDialogueChat] polishInput started (charName=${charName}, persona=${selectedPersona.name}, context=${contextMessages.length} msgs, original=${originalText.length} chars)`,
      'info'
    );

    // 返回 Promise，在 onComplete 中 resolve，onError 中 reject
    return new Promise<string>((resolve, reject) => {
      engine.onStream((chunk: string) => {
        // 取消后忽略后续 chunk，避免污染 polishedAccumulatedRef
        if (isPolishingInputAbortRef.current) return;
        if (chunk) {
          polishedAccumulatedRef.current += chunk;
        }
      });

      engine.onComplete((response: AIResponse) => {
        // 优先使用 server 返回的 content，回退到本地流式累积（与 generateUserReply 一致）
        let finalContent = response?.content || polishedAccumulatedRef.current;
        // ===== Think 标签后处理 =====
        // 润色结果按 think_tag_mode 处理，避免污染用户输入框。
        if (deriveThinkTagMode(characterConfig?.customParameters) === 'strip') {
          finalContent = stripThinkingTags(finalContent);
        }
        addLog(`[CharacterDialogueChat] polishInput completed: ${finalContent.length} chars`, 'info');
        resolve(finalContent);
      });

      engine.onError((error) => {
        console.error('[CharacterDialogueChat] polishInput error:', error);
        message.error(`润色输入失败: ${error.message}`);
        addLog(`[CharacterDialogueChat] polishInput error: ${error.message}`, 'error');
        reject(new Error(error.message));
      });

      // 润色请求 user 消息：明确指示 AI 执行润色任务，避免对话历史触发"回复"本能
      // （Spec: fix-polish-context-isolation）
      // 真实对话历史已嵌入 polishSystemPrompt 的"## 对话历史参考"段落，
      // engine.sendMessage 的 messages 数组仅含此单条 user 消息，
      // 使 AI 收到的消息结构为 [system(含历史参考+待润色文本+约束), user(润色请求)]
      const polishRequestMessages: ChatMessage[] = [{
        id: `polish-request-${Date.now()}`,
        role: 'user',
        content: '请润色上述 <polish_target> 标签内的文本，直接输出润色后的文本本身。',
        timestamp: Date.now(),
        status: 'sent',
      }];
      engine.sendMessage(polishRequestMessages, polishSystemPrompt, engineConfigWithParams).catch((err: any) => {
        console.error('[CharacterDialogueChat] polishInput sendMessage threw:', err);
        message.error(`润色输入失败: ${err?.message || '未知错误'}`);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    }).finally(() => {
      // 无论成功/失败/取消，都重置润色中状态
      setIsPolishingInput(false);
      isPolishingInputRef.current = false;
      polishedAccumulatedRef.current = '';
    });
  }, [selectedPersona, state.isStreaming, isOrganizing, isGeneratingUserReply, characterInfo, characterConfig, getActiveEngineConfig, getEffectiveParams, addLog]);

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

    dispatch({ type: 'SEND_MESSAGE', messages: newMessages });

    await requestAIResponse(
      [...state.messages, userMessage],
      aiMessageId,
      '',
      'dialogue',
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

    const continueMessages = messagesRef.current.map(msg =>
      msg.id === targetMessageId ? { ...msg, status: 'sending' as const } : msg
    );
    dispatch({ type: 'SEND_MESSAGE', messages: continueMessages });

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

    dispatch({ type: 'UPDATE_MESSAGES', messages: [...messagesBeforeRetry, newRetryMessage] });
    dispatch({ type: 'SET_LOADING', isLoading: true, isStreaming: true });

    // 去重检测配置（Spec: optimize-chat-ai-intelligence / Task 5.2）
    // 捕获原回复内容作为去重比较基准；requestAIResponse 在 onComplete 中
    // 计算 nGramJaccard(原回复, 新回复, 4) > 0.8 时自动重新生成（最多 2 次）。
    const dedupConfig: DedupConfig = {
      previousResponse: existingMessage.content || '',
    };

    await requestAIResponse(messagesBeforeRetry, messageId, '', 'dialogue', dedupConfig);
  }, [state.isStreaming, requestAIResponse]);

  const clearChat = useCallback(async () => {
    if (state.isStreaming) {
      const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(
        getActiveEngineConfig() || {} as AIEngineConfig
      );
      engine.cancelRequest();
    }

    dispatch({ type: 'CLEAR_MESSAGES' });
    messagesRef.current = [];
    await saveChatToStore([]);
    addLog('[CharacterDialogueChat] Chat cleared', 'info');
    message.success('对话已清空');
  }, [state.isStreaming, getActiveEngineConfig, saveChatToStore, addLog]);

  // Task 21: 清除错误状态（错误恢复 UI 的「关闭」按钮使用）
  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  const cancelRequest = useCallback(() => {
    // 中断用户回复生成（Spec: add-ai-user-reply-button / Task 2.6）
    // 先于 engine.cancelRequest() 设置 abort 标志，确保 onStream 回调立即早返，
    // 不再向 generatedReplyAccumulatedRef 累积半截内容；engine.cancelRequest()
    // 会触发 onError 或 onComplete，由 generateUserReply 的 finally 块重置 state。
    if (isGeneratingUserReplyRef.current) {
      isGeneratingUserReplyAbortRef.current = true;
      isGeneratingUserReplyRef.current = false;
      setIsGeneratingUserReply(false);
      addLog('[CharacterDialogueChat] User reply generation cancelled', 'info');
    }
    // 润色中断（Spec: refine-user-input-text / Task 2.6）
    // 仅设置 abort 标志，engine.cancelRequest() 已在下方统一调用，
    // 由 polishInput 的 finally 块重置 isPolishingInput / isPolishingInputRef
    if (isPolishingInputRef.current) {
      isPolishingInputAbortRef.current = true;
      addLog('[CharacterDialogueChat] Polish input cancelled', 'info');
    }
    const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(
      getActiveEngineConfig() || {} as AIEngineConfig
    );
    engine.cancelRequest();
    dispatch({ type: 'SET_LOADING', isLoading: false, isStreaming: false });
    addLog('[CharacterDialogueChat] Request cancelled', 'info');
    initialContentRef.current = '';
  }, [getActiveEngineConfig, addLog]);

  const editMessage = useCallback((messageId: string, newContent: string) => {
    const updatedMessages = messagesRef.current.map(msg =>
      msg.id === messageId ? { ...msg, content: newContent, timestamp: Date.now() } : msg
    );
    saveChatToStore(updatedMessages);
    addLog(`[CharacterDialogueChat] Message ${messageId} edited`, 'info');
    dispatch({ type: 'UPDATE_MESSAGES', messages: updatedMessages });
  }, [saveChatToStore, addLog]);

  /**
   * 插入图片消息到对话流（Spec: add-conversation-image-generation）
   * 在指定消息之后插入一条图片消息，不触发 AI 响应。
   *
   * @deprecated 已被 `updateImageAttachment` 取代（Spec: enhance-conversation-image-bubble / Task 10）。
   * 新架构将图片作为父文本消息的 `imageAttachment` 嵌套字段，而非独立消息插入对话流。
   * 保留函数体仅为向后兼容与旧数据兜底，新代码不应调用此函数。
   */
  const addImageMessage = useCallback(async (afterMessageId: string, imageBase64: string, characterCardId: string) => {
    const currentMessages = messagesRef.current;
    const insertIndex = currentMessages.findIndex(msg => msg.id === afterMessageId);
    if (insertIndex === -1) {
      addLog(`[CharacterDialogueChat] addImageMessage: message ${afterMessageId} not found`, 'warn');
      return;
    }

    // 【Bug 4 修复】将 base64 图片保存到磁盘，消息中仅存储 assetId（Spec: fix-conversation-image-generation-bugs）
    const assetId = `conv_${Date.now()}`;
    let generatedImageRef: string = imageBase64; // fallback: 若保存失败则直接存 base64
    try {
      const saveResult = await window.electronAPI.asset.save({
        characterCardId,
        assetType: 'general',
        assetId,
        imageBase64,
      });
      if (saveResult?.success) {
        generatedImageRef = assetId; // 存储 assetId 而非 base64 data URL
      } else {
        addLog(`[CharacterDialogueChat] addImageMessage: asset save failed, falling back to base64`, 'warn');
      }
    } catch (e) {
      addLog(`[CharacterDialogueChat] addImageMessage: asset save error: ${e}`, 'warn');
    }

    const imageMessage: ChatMessage = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      role: 'assistant',
      content: '[生成图片]',
      timestamp: Date.now(),
      status: 'sent',
      speakerName: characterInfo.characterCardName,
      isImageMessage: true,
      generatedImage: generatedImageRef,
    };
    const updatedMessages = [
      ...currentMessages.slice(0, insertIndex + 1),
      imageMessage,
      ...currentMessages.slice(insertIndex + 1),
    ];
    messagesRef.current = updatedMessages;
    dispatch({ type: 'UPDATE_MESSAGES', messages: updatedMessages });
    saveChatToStore(updatedMessages);
  }, [saveChatToStore, addLog, characterInfo.characterCardName]);

  /**
   * 通用工具：更新指定消息的 imageAttachment 字段（Spec: enhance-conversation-image-bubble / Task 10.1）
   *
   * 读取消息 → 应用 updater → dispatch UPDATE_MESSAGES → saveChatToStore。
   * 供 Task 9（handleGenerateImage 阶段状态更新）以及 deleteImageAttachment /
   * navigateImageHistory 等内部函数复用。
   *
   * @param messageId 父文本消息 ID
   * @param updater 接收旧 imageAttachment（可能 undefined），返回新的 imageAttachment
   *                （返回 undefined 表示清除该字段）
   */
  const updateImageAttachment = useCallback(async (
    messageId: string,
    updater: (prev: ImageAttachment | undefined) => ImageAttachment | undefined
  ) => {
    const currentMessages = messagesRef.current;
    const msgIndex = currentMessages.findIndex(m => m.id === messageId);
    if (msgIndex === -1) {
      addLog(`[CharacterDialogueChat] updateImageAttachment: message ${messageId} not found`, 'warn');
      return;
    }
    const msg = currentMessages[msgIndex];
    const nextAttachment = updater(msg.imageAttachment);
    const updatedMessages = currentMessages.map((m, i) =>
      i === msgIndex ? { ...m, imageAttachment: nextAttachment } : m
    );
    messagesRef.current = updatedMessages;
    dispatch({ type: 'UPDATE_MESSAGES', messages: updatedMessages });
    saveChatToStore(updatedMessages);
  }, [saveChatToStore, addLog]);

  /**
   * 删除图片附件（Spec: enhance-conversation-image-bubble / Task 10.3）
   *
   * 遍历 `imageAttachment.history` 逐个调用 `asset:delete` 删除磁盘 PNG 文件 + manifest 条目，
   * 然后清空父消息的 `imageAttachment` 字段（设为 undefined）。
   * 单个 asset 删除失败仅记录警告，不中断流程（尽力删除）。
   *
   * @param messageId 父文本消息 ID
   */
  const deleteImageAttachment = useCallback(async (messageId: string) => {
    const currentMessages = messagesRef.current;
    const msg = currentMessages.find(m => m.id === messageId);
    if (!msg?.imageAttachment) {
      addLog(`[CharacterDialogueChat] deleteImageAttachment: no imageAttachment on message ${messageId}`, 'warn');
      return;
    }
    const attachment = msg.imageAttachment;
    const characterCardId = characterInfo.characterCardId;
    // 遍历 history 逐个删除磁盘文件 + manifest
    for (const item of attachment.history) {
      try {
        await window.electronAPI.asset.delete({
          characterCardId,
          assetType: 'general',
          assetId: item.assetId,
        });
      } catch (e) {
        addLog(`[CharacterDialogueChat] deleteImageAttachment: failed to delete asset ${item.assetId}: ${e}`, 'warn');
      }
    }
    // 清空 imageAttachment 字段
    await updateImageAttachment(messageId, () => undefined);
    addLog(`[CharacterDialogueChat] deleteImageAttachment: deleted ${attachment.history.length} image(s) for message ${messageId}`, 'info');
  }, [updateImageAttachment, addLog, characterInfo.characterCardId]);

  /**
   * 历史图片导航（Spec: enhance-conversation-image-bubble / Task 10.4）
   *
   * 切换 `currentIndex` 与 `currentAssetId`，用于查看重新生成历史中的过往图片。
   * 边界保护：越界时保持当前索引不变（不报错、不抛异常）。
   *
   * @param messageId 父文本消息 ID
   * @param direction 'prev' 上一张 | 'next' 下一张
   */
  const navigateImageHistory = useCallback(async (messageId: string, direction: 'prev' | 'next') => {
    await updateImageAttachment(messageId, (prev) => {
      if (!prev) return prev;
      const newIndex = direction === 'prev' ? prev.currentIndex - 1 : prev.currentIndex + 1;
      // 边界保护：越界时保持不变
      if (newIndex < 0 || newIndex >= prev.history.length) return prev;
      return {
        ...prev,
        currentIndex: newIndex,
        currentAssetId: prev.history[newIndex].assetId,
      };
    });
  }, [updateImageAttachment]);

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

  const rollbackToMessage = useCallback(async (messageId: string): Promise<string> => {
    const currentMessages = messagesRef.current;
    const messageIndex = currentMessages.findIndex(msg => msg.id === messageId);
    if (messageIndex === -1) {
      addLog(`[CharacterDialogueChat] Rollback failed: message ${messageId} not found`, 'warn');
      return '';
    }

    const targetMessage = currentMessages[messageIndex];
    if (targetMessage.role !== 'user') {
      addLog(`[CharacterDialogueChat] Rollback failed: message ${messageId} is not a user message`, 'warn');
      return '';
    }

    const rolledBackContent = targetMessage.content;
    const updatedMessages = currentMessages.slice(0, messageIndex);
    const removedCount = currentMessages.length - messageIndex;

    // 若正在流式生成，先取消
    if (state.isStreaming) {
      cancelRequest();
    }

    // 同步更新 messagesRef（避免闭包陈旧）
    messagesRef.current = updatedMessages;

    dispatch({ type: 'UPDATE_MESSAGES', messages: updatedMessages });
    dispatch({ type: 'SET_LOADING', isLoading: false, isStreaming: false });
    dispatch({ type: 'CLEAR_ERROR' });

    saveChatToStore(updatedMessages);
    addLog(`[CharacterDialogueChat] Rolled back to message ${messageId}, removed ${removedCount} messages`, 'info');

    // ===== 表格跟随回退：查找对应版本并恢复表格快照 =====
    try {
      const chatId = characterInfo.characterCardName || characterInfo.characterCardId;
      if (chatId && versionIndexRef.current?.versions) {
        const targetTimestamp = targetMessage.timestamp;
        const index = versionIndexRef.current;
        // 从版本索引中查找时间匹配（±1000ms）的联动版本
        const matchedRecord = index.versions.find((v: any) => {
          return v.tableSnapshot?.exists && 
            Math.abs(v.timestamp - targetTimestamp) <= 1000;
        });
        if (matchedRecord) {
          addLog(`[CharacterDialogueChat] 卷回时找到匹配的联动版本: ${matchedRecord.versionLinkId}，准备恢复表格快照`, 'info');
          const restoreResult = await window.electronAPI.memory.restoreTableFromSnapshot(chatId, matchedRecord.versionLinkId);
          if (restoreResult.success) {
            addLog(`[CharacterDialogueChat] 卷回时表格快照恢复成功: ${matchedRecord.versionLinkId}`, 'info');
            // 刷新 memoryTableDataRef
            await fetchMemoryTableData();
          } else {
            addLog(`[CharacterDialogueChat] 卷回时表格快照恢复失败: ${restoreResult.error}`, 'warn');
          }
        } else {
          addLog(`[CharacterDialogueChat] 卷回时未找到匹配的联动版本，跳过表格回退`, 'debug');
        }
      }
    } catch (tableError) {
      addLog(`[CharacterDialogueChat] 卷回时表格回退异常: ${tableError}`, 'warn');
      // 不阻塞卷回主流程
    }

    return rolledBackContent;
  }, [state.isStreaming, cancelRequest, saveChatToStore, addLog, characterInfo, fetchMemoryTableData]);

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
    enabled: characterConfig?.tokenManagementEnabled ?? false,
    maxContextTokens: characterConfig?.maxContextTokens ?? 256000,
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

      // ===== 表格跟随回退：恢复对应版本的表格快照 =====
      try {
        const chatId = characterInfo.characterCardName || characterInfo.characterCardId;
        if (chatId && versionData.versionLinkId) {
          addLog(`[CharacterDialogueChat] 重新生成时恢复表格快照: versionLinkId=${versionData.versionLinkId}`, 'info');
          const restoreResult = await window.electronAPI.memory.restoreTableFromSnapshot(chatId, versionData.versionLinkId);
          if (restoreResult.success) {
            addLog(`[CharacterDialogueChat] 重新生成时表格快照恢复成功`, 'info');
            // 刷新内存中的表格数据
            await fetchMemoryTableData();
          } else {
            addLog(`[CharacterDialogueChat] 重新生成时表格快照恢复失败: ${restoreResult.error}`, 'warn');
          }
        }
      } catch (tableError) {
        addLog(`[CharacterDialogueChat] 重新生成时表格回退异常: ${tableError}`, 'warn');
        // 不阻塞重新生成主流程
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
      dispatch({ type: 'SEND_MESSAGE', messages: [...messagesBeforeRetry, newEmptyMessage] });

      await requestAIResponse(messagesBeforeRetry, newEmptyMessage.id, '', 'dialogue');
    } catch (error) {
      addLog(`[CharacterDialogueChat] Failed to restore from version: ${error}`, 'error');
      message.error('从版本恢复失败');
    }
  }, [state.isStreaming, requestAIResponse, addLog, characterInfo, fetchMemoryTableData]);

  const stateWithVersionInfo = useMemo(() => {
    const messagesWithVersion = state.messages.map((msg) => {
      const versionInfo = getVersionInfoForMessage(msg);
      return { ...msg, versionInfo };
    });

    return { ...state, messages: messagesWithVersion };
  }, [state, getVersionInfoForMessage]);

  // 手动触发上下文压缩（Spec: optimize-agent-interaction-from-openclaw / M3-Task9）
  const [isCompressing, setIsCompressing] = useState(false);
  const compressContext = useCallback(async () => {
    setIsCompressing(true);
    try {
      const currentMessages = messagesRef.current;
      if (currentMessages.length === 0) {
        message.info('没有可压缩的对话历史');
        return;
      }

      // 获取当前 token 用量
      const tokenUsage = stateRef.current.tokenUsage;
      if (!tokenUsage) {
        message.info('请先发送消息后再使用压缩功能');
        return;
      }

      // 检查是否需要压缩（SubTask 9.2：token > maxContextTokens * 0.7 时触发）
      if (!shouldCompact(tokenUsage.used, tokenUsage.total)) {
        message.info('当前对话历史在合理范围内，无需压缩');
        return;
      }

      addLog(
        `[Context] Starting context compaction: ${currentMessages.length} messages, ` +
        `${tokenUsage.used}/${tokenUsage.total} tokens`,
        'info'
      );

      // 分割消息：保留近期 N 轮原文，较早消息生成摘要（SubTask 9.2）
      const { toSummarize, toKeep } = splitMessages(currentMessages, KEEP_RECENT_ROUNDS);

      if (toSummarize.length === 0) {
        message.info('没有需要压缩的旧对话');
        return;
      }

      // 获取引擎配置
      const activeEngine = getActiveEngineConfig();
      if (!activeEngine) {
        message.warning('请先配置 AI 引擎');
        return;
      }

      // 构建摘要 prompt（SubTask 9.3）
      const summaryPrompt = buildSummaryPrompt(toSummarize);

      // 构建引擎配置（使用低 temperature 保证摘要质量）
      const engineConfig: AIEngineConfig = {
        id: activeEngine.id,
        name: activeEngine.name,
        api_url: activeEngine.api_url,
        api_key: activeEngine.api_key,
        model_name: activeEngine.model_name,
        api_mode: activeEngine.api_mode,
        api_key_transmission: activeEngine.api_key_transmission,
        max_tokens: 2000, // 摘要不需要太长
        system_prompt: activeEngine.system_prompt,
        temperature: 0.3, // 低温度保证摘要忠实度
        capabilities: activeEngine.capabilities || getDefaultEngineCapabilities(),
      };

      // 调用 AI 生成摘要（复用 ChatEngine 基础设施）
      const engine = ChatEngineFactory.getInstance().getOrCreateDefaultEngine(engineConfig);

      const summary = await new Promise<string>((resolve, reject) => {
        let accumulated = '';
        engine.onStream((chunk: string) => {
          if (chunk) accumulated += chunk;
        });
        engine.onComplete((response: AIResponse) => {
          resolve(response?.content || accumulated);
        });
        engine.onError((error) => {
          reject(new Error(error.message));
        });

        // 发送摘要请求：system prompt 为摘要指令，user 消息为待摘要的对话内容
        const requestMessages: ChatMessage[] = [{
          id: `compaction-request-${Date.now()}`,
          role: 'user',
          content: summaryPrompt,
          timestamp: Date.now(),
          status: 'sent',
        }];
        engine.sendMessage(
          requestMessages,
          '你是一个对话摘要助手。请严格按照要求总结对话内容。',
          engineConfig
        ).catch((err: unknown) => {
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      });

      // 构建压缩后的消息列表（SubTask 9.4：摘要作为 system 消息注入，替换原始消息）
      const summaryMessage = createSummaryMessage(summary);
      const compactedMessages = [summaryMessage, ...toKeep];

      addLog(
        `[Context] Compaction complete: ${currentMessages.length} -> ${compactedMessages.length} messages, ` +
        `summarized ${toSummarize.length} messages, kept ${toKeep.length} recent messages`,
        'info'
      );

      // 更新状态
      dispatch({ type: 'UPDATE_MESSAGES', messages: compactedMessages });
      messagesRef.current = compactedMessages;
      await saveChatToStore(compactedMessages);

      // 更新 token 用量
      const newUsed = TokenCounter.countMessagesTokens(compactedMessages);
      dispatch({ type: 'SET_TOKEN_USAGE', usage: { used: newUsed, total: tokenUsage.total } });

      message.success(`对话历史已压缩：${currentMessages.length} → ${compactedMessages.length} 条消息`);
    } catch (error) {
      // SubTask 9.5：压缩失败降级为直接裁剪（ContextTruncator 会在下次请求时自动裁剪）
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLog(`[Context] Compaction failed, falling back to truncation: ${errorMsg}`, 'warn');
      message.warning(`压缩失败，已降级为裁剪模式：${errorMsg}`);
    } finally {
      setIsCompressing(false);
    }
  }, [getActiveEngineConfig, addLog, saveChatToStore]);

  return {
    state,
    stateWithVersionInfo,
    sendMessage,
    continueConversation,
    retryMessage,
    retryMessageFromVersion,
    editMessage,
    rollbackToMessage,
    addImageMessage,
    // 图片附件管理（Spec: enhance-conversation-image-bubble / Task 10）
    // - updateImageAttachment：通用工具，更新指定消息的 imageAttachment 字段（供 Task 9 阶段状态更新调用）
    // - deleteImageAttachment：删除图片附件（磁盘文件 + manifest + 清空字段）
    // - navigateImageHistory：历史图片导航（切换 currentIndex / currentAssetId）
    updateImageAttachment,
    deleteImageAttachment,
    navigateImageHistory,
    clearChat,
    clearError,
    cancelRequest,
    selectedPersona,
    personas,
    personasLoading,
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
    // 用户回复生成（Spec: add-ai-user-reply-button / Task 2.5）
    generateUserReply,
    isGeneratingUserReply,
    // 用户输入润色（Spec: refine-user-input-text / Task 2）
    polishInput,
    isPolishingInput,
    fetchMemoryTableData,
    handleMemoryTableToggle,
    handleMemoryTableAutoOrganizeToggle,
    handleMemoryTableOrganizeModeChange,
    handleMemoryTableTemplateAssociate,
    tokenManagementConfig,
    handleTokenManagementConfigChange,
    handleStopOrganizing,
    getMemoryTableData: () => memoryTableDataRef.current,
    // Token 用量与上下文压缩
    tokenUsage: state.tokenUsage,
    compressContext,
    isCompressing,
  };
}
