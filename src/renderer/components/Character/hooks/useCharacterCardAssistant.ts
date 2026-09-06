import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AIEngine } from '../../../types/setting';
import { sendAssistantAIStreamRequest } from '../../../utils/characterAIUtils';
import { ASSISTANT_SYSTEM_PROMPT, buildAssistantCharacterContext } from '../../../utils/promptTemplates';
import type { AssistantMessage } from '@shared/types';

export interface UseCharacterCardAssistantArgs {
  /** 角色卡当前表单值（所有已填字段） */
  characterData: Record<string, any>;
  /** 获取当前激活的 AI 引擎配置 */
  getActiveEngineConfig: () => AIEngine | null;
  /** 日志回调 */
  addLog: (msg: string, level?: 'info' | 'error' | 'warn' | 'debug') => void;
  /** 编辑弹窗是否打开（关闭时销毁面板状态） */
  modalOpen?: boolean;
}

export interface UseCharacterCardAssistantResult {
  /** 面板是否展开 */
  isOpen: boolean;
  /** 打开面板 */
  openPanel: () => void;
  /** 关闭面板（同时清空对话历史与缓存） */
  closePanel: () => void;
  /** 切换面板显隐 */
  togglePanel: () => void;
  /** 对话消息列表 */
  messages: AssistantMessage[];
  /** 是否正在请求 AI */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 发送提问 */
  sendQuestion: (question: string, options?: { forceRegenerate?: boolean; replaceLastUser?: boolean }) => Promise<void>;
  /** 取消进行中的请求 */
  cancel: () => void;
  /** 重试最近一次失败的提问 */
  retry: () => Promise<void>;
  /** 重新生成最后一条回复（绕过缓存，替换最后一轮） */
  regenerate: () => Promise<void>;
  /** 卷回到指定用户消息：截断该消息及之后的所有消息，返回该消息内容（供回填输入框） */
  rollbackToMessage: (timestamp: number) => string | null;
  /** 清空对话与缓存 */
  clear: () => void;
}

/**
 * 计算角色卡内容签名，用于缓存失效判断。
 * 任一字段内容变化都会改变签名，从而清空历史缓存。
 */
function computeCharacterSignature(characterData: Record<string, any>): string {
  const FIELDS = [
    'name', 'nickname', 'description', 'personality', 'scenario',
    'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions',
    'creator_notes', 'alternate_greetings', 'tags',
  ];
  return FIELDS.map((k) => {
    const v = characterData?.[k];
    return Array.isArray(v) ? v.join('\n') : (v || '');
  }).join('|').trim();
}

/** 归一化提问文本：去首尾空白、统一标点，用于缓存键匹配 */
function normalizeQuestion(question: string): string {
  return question.trim().replace(/[，。！？、；：,.!?;:]/g, '').toLowerCase();
}

const MAX_HISTORY_ROUNDS = 6;

/**
 * 移除最后一轮对话（最后一条 user 消息及其之后的所有消息）。
 * 用于重试（replaceLastUser）场景：无论上一轮以成功/失败/取消结束，都能正确回退。
 */
function stripLastRound(msgs: AssistantMessage[]): AssistantMessage[] {
  const lastUserIdx = msgs.map((m) => m.role).lastIndexOf('user');
  return lastUserIdx >= 0 ? msgs.slice(0, lastUserIdx) : msgs;
}

export function useCharacterCardAssistant(args: UseCharacterCardAssistantArgs): UseCharacterCardAssistantResult {
  const { characterData, getActiveEngineConfig, addLog, modalOpen } = args;

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // 请求生命周期控制：isProcessingRef 用于并发重入防护（React state 是异步批处理的，不能用于并发控制）
  const isProcessingRef = useRef<boolean>(false);
  const cancelledRef = useRef<boolean>(false);
  // 回复缓存：key=归一化提问，value=AI 回复文本 + 当时的角色卡签名
  const cacheRef = useRef<Map<string, { content: string; signature: string }>>(new Map());
  const lastSignatureRef = useRef<string>(computeCharacterSignature(characterData));

  // 角色卡内容变化时清空缓存（缓存失效逻辑）
  useEffect(() => {
    const sig = computeCharacterSignature(characterData);
    if (sig !== lastSignatureRef.current) {
      lastSignatureRef.current = sig;
      cacheRef.current.clear();
      addLog('[Assistant] 检测到角色卡内容变化，已清空建议缓存', 'info');
    }
  }, [characterData, addLog]);

  // 编辑弹窗关闭时销毁面板状态（对话历史 + 缓存 + 进行中的请求）
  useEffect(() => {
    if (modalOpen === false) {
      cancelledRef.current = true;
      isProcessingRef.current = false;
      cacheRef.current.clear();
      setMessages([]);
      setIsLoading(false);
      setError(null);
      setIsOpen(false);
    }
  }, [modalOpen]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    isProcessingRef.current = false;
    window.electronAPI?.ai?.cancel?.();
    setIsLoading(false);
    addLog('[Assistant] 用户主动取消请求', 'warn');
  }, [addLog]);

  const clear = useCallback(() => {
    isProcessingRef.current = false;
    cacheRef.current.clear();
    setMessages([]);
    setIsLoading(false);
    setError(null);
    addLog('[Assistant] 已清空对话与缓存', 'info');
  }, [addLog]);

  const closePanel = useCallback(() => {
    // 关闭面板同时清空对话历史与缓存（Spec: 多轮对话能力 / 对话历史在关闭面板时清空）
    clear();
    setIsOpen(false);
  }, [clear]);

  const openPanel = useCallback(() => {
    setError(null);
    setIsOpen(true);
  }, []);

  const togglePanel = useCallback(() => {
    if (isOpen) {
      closePanel();
    } else {
      setIsOpen(true);
      setError(null);
    }
  }, [isOpen, closePanel]);

  /**
   * 发送提问：构建角色卡上下文 + 多轮历史 → 缓存查询 → AI 请求 → 结构化解析。
   */
  const sendQuestion = useCallback(async (question: string, options?: { forceRegenerate?: boolean; replaceLastUser?: boolean }) => {
    const trimmedQuestion = (question || '').trim();
    if (!trimmedQuestion) return;
    if (isProcessingRef.current) {
      // 并发重入防护（使用 ref 而非 state，避免异步批处理导致双发）
      addLog('[Assistant] 已有请求进行中，忽略新提问', 'warn');
      return;
    }

    const activeEngine = getActiveEngineConfig();
    if (!activeEngine) {
      setError('请先在配置管理中设置AI引擎');
      addLog('[Assistant] 未配置 AI 引擎', 'error');
      return;
    }
    if (!activeEngine.api_url) {
      setError('API地址不能为空');
      addLog('[Assistant] AI 引擎 API 地址为空', 'error');
      return;
    }

    isProcessingRef.current = true;
    cancelledRef.current = false;
    setError(null);

    const userMessage: AssistantMessage = {
      role: 'user',
      content: trimmedQuestion,
      timestamp: Date.now(),
    };
    // replaceLastUser（重试场景）：移除最后一轮后追加新问题，避免重复/残缺消息干扰历史
    setMessages((prev) => options?.replaceLastUser
      ? [...stripLastRound(prev), userMessage]
      : [...prev, userMessage]
    );

    // 生成角色卡上下文（跟随当前最新内容，保证相关性）
    const contextBlock = `【当前角色卡内容】\n${buildAssistantCharacterContext(characterData)}`;
    const currentSignature = computeCharacterSignature(characterData);

    try {
      const cacheKey = normalizeQuestion(trimmedQuestion);

      // 缓存命中：相同提问 + 角色卡内容未变化
      if (!options?.forceRegenerate) {
        const cached = cacheRef.current.get(cacheKey);
        if (cached && cached.signature === currentSignature && cached.content) {
          addLog('[Assistant] 命中回复缓存，直接返回', 'info');
          const cachedMessage: AssistantMessage = {
            role: 'assistant',
            content: cached.content,
            timestamp: Date.now(),
            fromCache: true,
          };
          setMessages((prev) => [...prev, cachedMessage]);
          isProcessingRef.current = false;
          return;
        }
      }

      // 构建多轮对话消息：system（引擎全局 system_prompt + 助手提示词 + 角色卡上下文）+ 最近 N 轮历史 + 当前问题
      // replaceLastUser 时：取回退后的消息（不含当前重试的问题）作为历史
      const baseMessages = options?.replaceLastUser ? stripLastRound(messages) : messages;
      const recentHistory = baseMessages.slice(-MAX_HISTORY_ROUNDS * 2);
      // 拼接 AI 引擎中配置的全局 system_prompt（与 useWorldBookAIOperations 等模块保持同一惯例）
      const globalSystemPrompt = activeEngine.system_prompt?.trim();
      const assistantSystemPrompt = `${ASSISTANT_SYSTEM_PROMPT}\n\n${contextBlock}`;
      const systemPrompt = globalSystemPrompt
        ? `${globalSystemPrompt}\n\n${assistantSystemPrompt}`
        : assistantSystemPrompt;
      const historyMessages = recentHistory.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      const chatMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
        { role: 'user', content: trimmedQuestion },
      ];

      // 插入流式占位 assistant 消息，随 chunk 增量更新
      setMessages((prev) => [...prev, { role: 'assistant', content: '', timestamp: Date.now() }]);
      setIsLoading(true);
      addLog(`[Assistant] 发送提问(流式): "${trimmedQuestion.slice(0, 50)}..."，上下文消息数: ${chatMessages.length}，全局system_prompt: ${globalSystemPrompt ? `✅ 已携带(${globalSystemPrompt.length}字符)` : '❌ 未配置'}`, 'info');

      let accumulated = '';
      let streamError: string | null = null;
      let chunkCount = 0;

      /** 用累积文本更新最后一条 assistant 消息 */
      const updateLastAssistant = (content: string) => {
        setMessages((prev) => {
          if (prev.length === 0 || prev[prev.length - 1].role !== 'assistant') return prev;
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], content };
          return next;
        });
      };

      await sendAssistantAIStreamRequest(activeEngine, chatMessages, {
        onStream: (chunk, isDone) => {
          if (cancelledRef.current || isDone || !chunk) return;
          accumulated += chunk;
          chunkCount++;
          updateLastAssistant(accumulated);
        },
        onError: (message) => {
          streamError = message;
        },
        onComplete: (fullContent) => {
          // 主进程汇总的完整内容可能比流式累积更完整（如最后 chunk 解析失败）
          if (cancelledRef.current) return;
          if (fullContent && fullContent.length > accumulated.length) {
            accumulated = fullContent;
            updateLastAssistant(accumulated);
          }
        },
      });

      if (cancelledRef.current) {
        // 用户取消：保留已流出的内容；完全为空则移除占位消息
        if (!accumulated) {
          setMessages((prev) => prev.slice(0, -1));
        }
        addLog(`[Assistant] 流式请求已取消，保留已生成 ${accumulated.length} 字符`, 'warn');
        return;
      }

      if (streamError) {
        if (accumulated) {
          // 已有部分内容：保留内容，仅提示错误
          setError(`${streamError}（已保留部分生成内容）`);
          addLog(`[Assistant] 流式请求失败(保留部分内容): ${streamError}`, 'error');
        } else {
          // 无任何内容：移除占位消息并报错（保留用户问题便于重试）
          setMessages((prev) => prev.slice(0, -1));
          setError(streamError);
          addLog(`[Assistant] 流式请求失败: ${streamError}`, 'error');
        }
        return;
      }

      if (!accumulated) {
        setMessages((prev) => prev.slice(0, -1));
        throw new Error('AI未返回有效内容，请重试');
      }

      // 缓存本次结果（供后续相同提问复用）
      cacheRef.current.set(cacheKey, {
        content: accumulated,
        signature: currentSignature,
      });
      addLog(`[Assistant] 流式回复完成: ${accumulated.length} 字符 / ${chunkCount} 个chunk`, 'info');
    } catch (err) {
      if (cancelledRef.current) {
        addLog('[Assistant] 请求已取消', 'warn');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        addLog(`[Assistant] 请求失败: ${msg}`, 'error');
      }
    } finally {
      isProcessingRef.current = false;
      cancelledRef.current = false;
      setIsLoading(false);
    }
  }, [addLog, characterData, getActiveEngineConfig, messages]);

  const retry = useCallback(async () => {
    if (isLoading || isProcessingRef.current) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      setError(null);
      // 复用 sendQuestion 的 replaceLastUser 选项：替换最后一条用户消息后重新请求
      await sendQuestion(lastUserMsg.content, { replaceLastUser: true });
    }
  }, [isLoading, messages, sendQuestion]);

  /** 重新生成最后一条回复：绕过缓存 + 替换最后一轮（成功/失败/取消后均可调用） */
  const regenerate = useCallback(async () => {
    if (isLoading || isProcessingRef.current) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) return;
    setError(null);
    await sendQuestion(lastUserMsg.content, { replaceLastUser: true, forceRegenerate: true });
  }, [isLoading, messages, sendQuestion]);

  /**
   * 卷回到指定用户消息（与主对话 rollbackToMessage 语义一致）：
   * 截断该消息及其之后的所有消息，返回该消息内容供调用方回填输入框。
   * 流式进行中会先取消请求。
   */
  const rollbackToMessage = useCallback((timestamp: number): string | null => {
    const idx = messages.findIndex((m) => m.timestamp === timestamp && m.role === 'user');
    if (idx === -1) return null;

    // 流式进行中先取消
    if (isProcessingRef.current) {
      cancelledRef.current = true;
      window.electronAPI?.ai?.cancel?.();
      isProcessingRef.current = false;
    }

    const content = messages[idx].content;
    setMessages(messages.slice(0, idx));
    setIsLoading(false);
    setError(null);
    addLog(`[Assistant] 卷回到第 ${idx + 1} 条用户消息，移除 ${messages.length - idx} 条消息`, 'info');
    return content;
  }, [messages, addLog]);

  const value = useMemo<UseCharacterCardAssistantResult>(() => ({
    isOpen,
    openPanel,
    closePanel,
    togglePanel,
    messages,
    isLoading,
    error,
    sendQuestion,
    cancel,
    retry,
    regenerate,
    rollbackToMessage,
    clear,
  }), [isOpen, openPanel, closePanel, togglePanel, messages, isLoading, error, sendQuestion, cancel, retry, regenerate, rollbackToMessage, clear]);

  return value;
}