import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AIEngine } from '../../../types/setting';
import { sendAssistantAIRequest } from '../../../utils/characterAIUtils';
import { ASSISTANT_SYSTEM_PROMPT, buildAssistantCharacterContext } from '../../../utils/promptTemplates';
import type { AssistantMessage, Suggestion, SuggestionType } from '@shared/types';

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
  /** 清空对话与缓存 */
  clear: () => void;
}

/** 建议类型文本 → 枚举映射（兼容模型输出差异） */
const TYPE_ALIASES: Record<string, SuggestionType> = {
  description: 'description',
  描述: 'description',
  角色描述: 'description',
  角色描述优化: 'description',
  dialogue: 'dialogue',
  对话: 'dialogue',
  对话样例: 'dialogue',
  对话示例: 'dialogue',
  system_prompt: 'system_prompt',
  系统提示: 'system_prompt',
  系统提示词: 'system_prompt',
  提示词: 'system_prompt',
  personality: 'personality',
  性格: 'personality',
  个性: 'personality',
  角色性格: 'personality',
  scenario: 'scenario',
  场景: 'scenario',
  场景设定: 'scenario',
  first_message: 'first_message',
  初始消息: 'first_message',
  开场白: 'first_message',
};

function parseType(raw: string): SuggestionType {
  const key = raw.trim().toLowerCase();
  return TYPE_ALIASES[key] ?? 'description';
}

/**
 * 从 AI 响应文本解析结构化建议列表。
 *
 * 解析格式（与 ASSISTANT_SYSTEM_PROMPT 输出格式对应）：
 * ```
 * 【建议】
 * 类型：description
 * 标题：xxx
 * 说明：xxx
 * 内容：<多行可复制内容>
 * 操作：xxx
 * ```
 * 兼容【建议1】/【建议 2】等变体编号，以及 内容 与 操作 顺序互换的情况。
 */
export function parseAssistantSuggestions(text: string): Suggestion[] {
  if (!text) return [];

  const suggestions: Suggestion[] = [];
  // 按【建议】标记切块（支持编号变体）
  const blocks = text.split(/【建议[\d\s]*】/).map((b) => b.trim()).filter(Boolean);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    let typeRaw = '';
    let title = '';
    const descriptionParts: string[] = [];
    let content = '';
    let actionTip = '';

    let mode: 'header' | 'description' | 'content' | 'action' = 'header';
    for (const line of lines) {
      const trimmed = line.trim();
      const typeMatch = trimmed.match(/^类型[：:]\s*(.*)$/);
      const titleMatch = trimmed.match(/^标题[：:]\s*(.*)$/);
      const descMatch = trimmed.match(/^说明[：:]\s*(.*)$/);
      const contentMatch = trimmed.match(/^内容[：:]\s*(.*)$/);
      const actionMatch = trimmed.match(/^操作[：:]\s*(.*)$/);
      const endMatch = /^---\s*内容结束\s*---$/.test(trimmed);

      if (typeMatch) {
        typeRaw = typeMatch[1].trim();
        mode = 'header';
      } else if (titleMatch) {
        title = titleMatch[1].trim();
        mode = 'header';
      } else if (descMatch) {
        descriptionParts.push(descMatch[1].trim());
        mode = 'description';
      } else if (contentMatch) {
        content = contentMatch[1].trim();
        mode = 'content';
      } else if (actionMatch) {
        actionTip = actionMatch[1].trim();
        mode = 'action';
      } else if (endMatch) {
        mode = 'header';
      } else if (mode === 'description' && trimmed) {
        descriptionParts.push(trimmed);
      } else if (mode === 'content' && trimmed) {
        // 多行内容：追加到 content（保持换行）
        content = content ? `${content}\n${trimmed}` : trimmed;
      } else if (mode === 'action' && trimmed) {
        // 多行操作说明追加
        actionTip = actionTip ? `${actionTip}\n${trimmed}` : trimmed;
      }
    }

    if (!title && !content && !actionTip) continue; // 跳过空块

    suggestions.push({
      type: parseType(typeRaw),
      title: title || '编辑建议',
      description: descriptionParts.join('\n'),
      editContent: content,
      actionTip,
    });
  }

  return suggestions;
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

export function useCharacterCardAssistant(args: UseCharacterCardAssistantArgs): UseCharacterCardAssistantResult {
  const { characterData, getActiveEngineConfig, addLog, modalOpen } = args;

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // 请求生命周期控制：isProcessingRef 用于并发重入防护（React state 是异步批处理的，不能用于并发控制）
  const isProcessingRef = useRef<boolean>(false);
  const cancelledRef = useRef<boolean>(false);
  // 建议缓存：key=归一化提问，value=AI 响应内容 + 解析后的建议 + 当时的角色卡签名
  const cacheRef = useRef<Map<string, { content: string; suggestions: Suggestion[]; signature: string }>>(new Map());
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
    // replaceLastUser：替换最后一条用户消息（用于重试场景），避免重复追加
    setMessages((prev) => options?.replaceLastUser
      ? [...prev.slice(0, -1), userMessage]
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
          addLog('[Assistant] 命中建议缓存，直接返回', 'info');
          const cachedMessage: AssistantMessage = {
            role: 'assistant',
            content: cached.content,
            suggestions: cached.suggestions,
            timestamp: Date.now(),
            fromCache: true,
          };
          setMessages((prev) => [...prev, cachedMessage]);
          isProcessingRef.current = false;
          return;
        }
      }

      // 构建多轮对话消息：system（提示词 + 角色卡上下文）+ 最近 N 轮历史 + 当前问题
      // replaceLastUser 时：取替换前的消息（不含当前重试的问题）作为历史
      const baseMessages = options?.replaceLastUser ? messages.slice(0, -1) : messages;
      const recentHistory = baseMessages.slice(-MAX_HISTORY_ROUNDS * 2);
      const systemPrompt = `${ASSISTANT_SYSTEM_PROMPT}\n\n${contextBlock}`;
      const historyMessages = recentHistory.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      const chatMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
        { role: 'user', content: trimmedQuestion },
      ];

      setIsLoading(true);
      addLog(`[Assistant] 发送提问: "${trimmedQuestion.slice(0, 50)}..."，上下文消息数: ${chatMessages.length}`, 'info');

      const responseText = await sendAssistantAIRequest(activeEngine, chatMessages);

      if (cancelledRef.current) {
        addLog('[Assistant] 请求已取消，丢弃响应', 'warn');
        return;
      }
      if (!responseText) {
        throw new Error('AI未返回有效内容，请重试');
      }

      const suggestions = parseAssistantSuggestions(responseText);
      const assistantMessage: AssistantMessage = {
        role: 'assistant',
        content: responseText,
        suggestions,
        timestamp: Date.now(),
      };

      // 缓存本次结果（供后续相同提问复用）
      cacheRef.current.set(cacheKey, {
        content: responseText,
        suggestions,
        signature: currentSignature,
      });

      setMessages((prev) => [...prev, assistantMessage]);
      addLog(`[Assistant] 收到回复: ${responseText.length} 字符，解析出 ${suggestions.length} 条建议`, 'info');
    } catch (err) {
      if (cancelledRef.current) {
        // 用户取消：移除未获回答的问题，保持对话干净
        setMessages((prev) => prev.slice(0, -1));
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
    clear,
  }), [isOpen, openPanel, closePanel, togglePanel, messages, isLoading, error, sendQuestion, cancel, retry, clear]);

  return value;
}