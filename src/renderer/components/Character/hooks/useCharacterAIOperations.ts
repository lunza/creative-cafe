import { useCallback, useRef, useState } from 'react';
import { message } from 'antd';
import type { AIEngine } from '../../../types/setting';
import { sendAssistantAIStreamRequest } from '../../../utils/characterAIUtils';
// Spec: polish-deai-humanizer（润色去AI味规则运行时注入）
import { withHumanizerRules, withHumanizerTextgenRules } from '../../../../shared/prompts/humanizerPolish';
// Spec: fix-character-card-field-scope-flash-models — 字段元数据与输出越界防御
import { FIELD_DESCRIPTIONS, extractTargetFieldContent } from './characterFieldScope';

/**
 * AI 操作（翻译 / 润色 / 生成）从 `CharacterManager` 迁出，集中在此 hook 中。
 *
 * 行为与原实现保持一致：
 * - `translatingField` / `polishingField` / `generatingField` 由统一的
 *   `aiOperation` state 派生，向后兼容外部 FieldEditor 的 props。
 * - `isProcessingRef` 用 ref 跟踪长请求生命周期，便于用户中断。
 * - 翻译/润色结果会清理模型常见的"思考过程"前缀；标签字段会处理顿号分隔。
 */
export type AIOperationType = 'translate' | 'polish' | 'generate';

export interface AIOperationState {
  type: AIOperationType;
  field: string;
}

export interface UseCharacterAIOperationsArgs {
  formValues: any;
  setFormValues: React.Dispatch<React.SetStateAction<any>>;
  originalValues: any;
  addLog: (msg: string, level?: 'info' | 'error' | 'warn' | 'debug') => void;
  getActiveEngineConfig: () => AIEngine | null;
}

export interface UseCharacterAIOperationsResult {
  // unified state + backward-compatible derived getters/setters
  aiOperation: AIOperationState | null;
  setAiOperation: React.Dispatch<React.SetStateAction<AIOperationState | null>>;
  translatingField: string | null;
  setTranslatingField: (field: string | null) => void;
  polishingField: string | null;
  setPolishingField: (field: string | null) => void;
  generatingField: string | null;
  setGeneratingField: (field: string | null) => void;

  // polish modal state
  isPolishModalOpen: boolean;
  setIsPolishModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  polishRequirements: string;
  setPolishRequirements: React.Dispatch<React.SetStateAction<string>>;
  currentPolishField: string | null;
  setCurrentPolishField: React.Dispatch<React.SetStateAction<string | null>>;
  currentPolishText: string;
  setCurrentPolishText: React.Dispatch<React.SetStateAction<string>>;
  /** Spec: polish-deai-humanizer — 润色"去AI味"开关（默认开启） */
  polishDeAiFlavor: boolean;
  setPolishDeAiFlavor: React.Dispatch<React.SetStateAction<boolean>>;

  // generate modal state
  isGenerateModalOpen: boolean;
  setIsGenerateModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  generateRequirements: string;
  setGenerateRequirements: React.Dispatch<React.SetStateAction<string>>;
  currentGenerateField: string | null;
  setCurrentGenerateField: React.Dispatch<React.SetStateAction<string | null>>;

  // handlers
  handleTranslate: (field: string) => Promise<void>;
  handlePolish: (field: string) => void;
  performPolish: () => Promise<void>;
  performGenerate: () => Promise<void>;
  openGenerateModal: (field: string) => void;
  handleCancelAIRequest: () => void;
  handleRestore: (field: string) => void;
  isProcessingRef: React.MutableRefObject<boolean>;
}

const THOUGHT_PATTERNS_TRANSLATE = [
  /思考[:：]\s*[^]*?(?=译文:|翻译:|\n\n|$)/gi,
  /Thought[:\s]+[^]*?(?=Translation:|\n\n|$)/gi,
  /Thinking[:\s]+[^]*?(?=Translation:|\n\n|$)/gi,
  /\(思考\)\s*[^]*?(?=\(译文\)|\n\n|$)/gi,
  /思考过程[:：]\s*[^]*?(?=\n\n|$)/gi,
  /让我思考一下[:：]\s*[^]*?(?=\n\n|$)/gi,
  /我需要思考[:：]\s*[^]*?(?=\n\n|$)/gi,
  /Reasoning:\s*[^]*?(?=\n\n|$)/gi,
  /思考:\s*[^]*?(?=\n\n|$)/gi
];

const THOUGHT_PATTERNS_POLISH = [
  /思考[:：]\s*[^]*?(?=润色:|\n\n|$)/gi,
  /Thought[:\s]+[^]*?(?=Polished:|\n\n|$)/gi,
  /Thinking[:\s]+[^]*?(?=Polished:|\n\n|$)/gi,
  /\(思考\)\s*[^]*?(?=\(润色\)|\n\n|$)/gi,
  /思考过程[:：]\s*[^]*?(?=\n\n|$)/gi,
  /让我思考一下[:：]\s*[^]*?(?=\n\n|$)/gi,
  /我需要思考[:：]\s*[^]*?(?=\n\n|$)/gi,
  /Reasoning:\s*[^]*?(?=\n\n|$)/gi,
  /思考:\s*[^]*?(?=\n\n|$)/gi
];

// Spec: fix-character-card-field-scope-flash-models — FIELD_DESCRIPTIONS 与
// extractTargetFieldContent 已抽到同目录纯模块 characterFieldScope.ts（便于单测，
// 规避本 hook 依赖 antd/AIService 导致测试导入链路过重）

/**
 * 构建角色卡其他字段的上下文信息，供翻译和润色操作参考。
 * 与 generate 操作的 existingFieldsInfo 构建逻辑一致：
 * 遍历 FIELD_DESCRIPTIONS 中除目标字段外的已填字段，完整传递每个字段的值。
 * 当所有其他字段都为空时返回空字符串。
 */
function buildCharacterContext(formValues: Record<string, any>, excludeField: string): string {
  return Object.entries(FIELD_DESCRIPTIONS)
    .filter(([key]) => key !== excludeField)
    .map(([key, info]) => {
      const value = formValues[key];
      const displayValue = Array.isArray(value) ? value.join('\n') : (value || '');
      if (!displayValue) return null;
      return `- ${info.label}：${displayValue}`;
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * 处理标签字段中的顿号分隔：转换为逗号分隔。
 */
function normalizeTagsField(cleanedText: string, field: string, addLog: (msg: string, level?: 'info' | 'error' | 'warn' | 'debug') => void): string {
  if (field === 'tags' && cleanedText.includes('、')) {
    const parts = cleanedText.split('、').map(p => p.trim()).filter(p => p);
    const joined = parts.join(', ');
    addLog(`[Character] 检测到顿号分隔，已转换为逗号分隔: ${joined}`);
    return joined;
  }
  return cleanedText;
}

export function useCharacterAIOperations(args: UseCharacterAIOperationsArgs): UseCharacterAIOperationsResult {
  const { formValues, setFormValues, originalValues, addLog, getActiveEngineConfig } = args;

  const [aiOperation, setAiOperation] = useState<AIOperationState | null>(null);

  // 向后兼容的getter/setter
  const translatingField = aiOperation?.type === 'translate' ? aiOperation.field : null;
  const setTranslatingField = useCallback((field: string | null) => {
    setAiOperation(field ? { type: 'translate', field } : null);
  }, []);
  const polishingField = aiOperation?.type === 'polish' ? aiOperation.field : null;
  const setPolishingField = useCallback((field: string | null) => {
    setAiOperation(field ? { type: 'polish', field } : null);
  }, []);
  const generatingField = aiOperation?.type === 'generate' ? aiOperation.field : null;
  const setGeneratingField = useCallback((field: string | null) => {
    setAiOperation(field ? { type: 'generate', field } : null);
  }, []);

  const [polishRequirements, setPolishRequirements] = useState<string>('');
  const [isPolishModalOpen, setIsPolishModalOpen] = useState<boolean>(false);
  const [currentPolishField, setCurrentPolishField] = useState<string | null>(null);
  const [currentPolishText, setCurrentPolishText] = useState<string>('');
  // Spec: polish-deai-humanizer — 润色"去AI味"开关（默认开启）
  const [polishDeAiFlavor, setPolishDeAiFlavor] = useState<boolean>(true);

  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState<boolean>(false);
  const [generateRequirements, setGenerateRequirements] = useState<string>('');
  const [currentGenerateField, setCurrentGenerateField] = useState<string | null>(null);

  const isProcessingRef = useRef<boolean>(false);

  /**
   * 【流式改造 - 用户需求：去掉 TimeoutError 并改为流式响应】
   *
   * 背景：原实现用非流式 sendCharacterAIRequest，主进程需等待完整响应体（含思维链）
   * 才返回响应头，qwen 等思考模型的长生成超过请求超时（AIService 默认 600s）被中止，
   * 报 `TimeoutError: timed out`。
   *
   * 流式优势：响应头立即返回，主进程收到首包后即清除连接/请求超时定时器
   * （aiHandlers.ts 流式分支 284-293 行），长生成不再超时；且 onStream 增量
   * 实时写入表单字段，用户可见打字机效果，可随时取消。
   *
   * @returns text = 服务器合并内容（优先）或流式累积内容；error = 请求失败信息
   *          （用户取消时两者均为空，由调用方通过 isProcessingRef 判定）
   */
  const runStreamingAI = useCallback(async (
    engine: AIEngine,
    systemPrompt: string,
    userPrompt: string,
    field: string
  ): Promise<{ text: string; error: string | null }> => {
    let accumulated = '';
    let serverFinal = '';
    let streamError: string | null = null;
    await sendAssistantAIStreamRequest(engine, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], {
      onStream: (chunk) => {
        if (!chunk) return;
        accumulated += chunk;
        // 流式实时预览：增量写入目标字段
        setFormValues((prev: any) => ({ ...prev, [field]: accumulated }));
      },
      onError: (msg) => {
        streamError = msg;
      },
      onComplete: (full) => {
        if (full) serverFinal = full;
      },
    });
    return { text: serverFinal || accumulated, error: streamError };
  }, [setFormValues]);

  const handleTranslate = useCallback(async (field: string) => {
    const startTime = Date.now();
    addLog(`[Character] 开始翻译字段: ${field}`);
    isProcessingRef.current = true;

    try {
      setTranslatingField(field);

      const text = formValues[field as keyof typeof formValues];

      if (!text) {
        message.warning('请先输入要翻译的内容');
        setTranslatingField(null);
        isProcessingRef.current = false;
        return;
      }

      addLog(`[Character] 翻译内容长度: ${text.length} 字符`);

      const activeEngine = getActiveEngineConfig();

      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        setTranslatingField(null);
        isProcessingRef.current = false;
        return;
      }

      if (!activeEngine.api_url) {
        message.error('API地址不能为空');
        setTranslatingField(null);
        isProcessingRef.current = false;
        return;
      }

      addLog(`[Character] ====== 翻译 - AI引擎配置 ======`, 'info');
      addLog(`[Character] API地址: ${activeEngine.api_url}`, 'info');
      addLog(`[Character] 模型: ${activeEngine.model_name ?? '未配置'}`, 'info');
      addLog(`[Character] ===================================`, 'info');

      const fieldLabel = FIELD_DESCRIPTIONS[field]?.label || field;
      const variables: Record<string, string> = {
        target_field_label: fieldLabel,
      };

      const promptResult = await window.electronAPI.prompt.build('character-card.translate', variables);
      if (!promptResult.success || !promptResult.data) {
        throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
      }
      const finalSystemPrompt = promptResult.data.systemPrompt;

      addLog(`[Character] 系统提示词长度: ${finalSystemPrompt.length} 字符`, 'info');

      // Spec: fix-character-card-field-scope-flash-models — 目标文本标签包裹 + 上下文隔离：
      // 原实现将目标文本与其他字段完整内容平铺拼接（无边界标识），Flash 模型会将其
      // 理解为"翻译整张角色卡"并输出全字段内容。现用 <translate_target> 明确翻译对象，
      // 其他字段收进 <context_reference> 并声明禁止输出。
      const characterContext = buildCharacterContext(formValues, field);
      const contextFieldCount = characterContext ? characterContext.split('\n').length : 0;
      addLog(`[Character] 角色卡上下文参考: ${characterContext.length} 字符, ${contextFieldCount} 个字段`, 'info');
      const enhancedUserPrompt = characterContext
        ? `请翻译以下 <translate_target> 标签内的文本（仅此文本，其他内容一律忽略）：\n\n<translate_target>\n${text}\n</translate_target>\n\n<context_reference>\n以下为角色卡其他字段，仅作翻译用词参考，禁止翻译或输出其中任何内容：\n${characterContext}\n</context_reference>`
        : `请翻译以下 <translate_target> 标签内的文本：\n\n<translate_target>\n${text}\n</translate_target>`;
      addLog(`[Character] user prompt 总长度: ${enhancedUserPrompt.length} 字符 (原文 ${text.length} + 上下文 ${characterContext.length})`, 'info');

      // 【流式改造】实时预览写入表单字段；中断/失败时恢复原值
      const originalText = text;
      const { text: translatedText, error: streamError } = await runStreamingAI(activeEngine, finalSystemPrompt, enhancedUserPrompt, field);

      if (!isProcessingRef.current) {
        addLog('[Character] 翻译请求已被用户中断', 'warn');
        setFormValues((prev: any) => ({ ...prev, [field]: originalText }));
        return;
      }

      if (streamError) {
        setFormValues((prev: any) => ({ ...prev, [field]: originalText }));
        throw new Error(streamError);
      }

      if (!translatedText) {
        setFormValues((prev: any) => ({ ...prev, [field]: originalText }));
        message.error('AI未返回有效内容，请重试');
        setTranslatingField(null);
        isProcessingRef.current = false;
        return;
      }

      addLog(`[Character] 收到翻译响应，长度: ${translatedText.length} 字符`, 'info');

      let cleanedText = translatedText;
      for (const pattern of THOUGHT_PATTERNS_TRANSLATE) {
        cleanedText = cleanedText.replace(pattern, '').trim();
      }

      // 移除可能的"译文:"、"Translation:"等前缀
      cleanedText = cleanedText.replace(/^(译文:|翻译:|Translation:)\s*/i, '').trim();

      // Spec: fix-character-card-field-scope-flash-models — 输出越界防御（写回前净化）
      const defenseResult = extractTargetFieldContent(cleanedText, field, addLog);
      if (defenseResult.overflow) {
        setFormValues((prev: any) => ({ ...prev, [field]: originalText }));
        message.warning('模型输出越界（包含其他字段内容），已保留原文，建议重试或更换模型');
        setTranslatingField(null);
        isProcessingRef.current = false;
        return;
      }
      cleanedText = defenseResult.content;

      cleanedText = normalizeTagsField(cleanedText, field, addLog);

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      addLog(`[Character] 翻译完成: 字段=${field}, 耗时=${duration}秒, 结果长度=${cleanedText.length} 字符`, 'info');

      setFormValues((prev: any) => ({
        ...prev,
        [field]: cleanedText
      }));

      message.success('翻译成功');
      setTranslatingField(null);
      isProcessingRef.current = false;
    } catch (error) {
      addLog(`[Character] 翻译失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`翻译失败: ${error instanceof Error ? error.message : '未知错误'}`);
      setTranslatingField(null);
      isProcessingRef.current = false;
    }
  }, [addLog, formValues, getActiveEngineConfig, setFormValues, setTranslatingField]);

  const handleRestore = useCallback((field: string) => {
    addLog(`[Character] 还原字段: ${field}`);
    setFormValues((prev: any) => ({
      ...prev,
      [field]: originalValues[field]
    }));
    message.success('已还原为原始值');
  }, [addLog, originalValues, setFormValues]);

  const openGenerateModal = useCallback((field: string) => {
    addLog(`[Character] 打开生成指导弹窗，字段: ${field}`);
    setCurrentGenerateField(field);
    setGenerateRequirements('');
    setIsGenerateModalOpen(true);
  }, [addLog]);

  const performGenerate = useCallback(async () => {
    if (!currentGenerateField) return;

    const field = currentGenerateField;
    const requirements = generateRequirements;

    addLog(`[Character] 开始AI生成字段: ${field}`);
    isProcessingRef.current = true;
    setGeneratingField(field);

    try {
      const activeEngine = getActiveEngineConfig();
      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        setGeneratingField(null);
        isProcessingRef.current = false;
        setIsGenerateModalOpen(false);
        return;
      }

      if (!activeEngine.api_url) {
        message.error('API地址不能为空');
        setGeneratingField(null);
        isProcessingRef.current = false;
        setIsGenerateModalOpen(false);
        return;
      }

      addLog(`[Character] ====== 生成 - AI引擎配置 ======`, 'info');
      addLog(`[Character] API地址: ${activeEngine.api_url}`, 'info');
      addLog(`[Character] 模型: ${activeEngine.model_name ?? '未配置'}`, 'info');
      addLog(`[Character] ===================================`, 'info');

      const characterData = formValues;

      const targetField = FIELD_DESCRIPTIONS[field];
      if (!targetField) {
        message.error(`不支持的字段: ${field}`);
        setGeneratingField(null);
        isProcessingRef.current = false;
        setIsGenerateModalOpen(false);
        return;
      }

      const existingFieldsInfo = Object.entries(FIELD_DESCRIPTIONS)
        .filter(([key]) => key !== field)
        .map(([key, info]) => {
          const value = characterData[key];
          const displayValue = Array.isArray(value) ? value.join('\n') : (value || '');
          if (!displayValue) return null;
          return `- ${info.label}：${displayValue}`;
        })
        .filter(Boolean)
        .join('\n');

      const characterVersionLine = characterData.character_version ? `【角色版本】${characterData.character_version}\n` : '';
      const characterCreatorLine = characterData.creator ? `【创建者】${characterData.creator}\n` : '';
      const characterNicknameLine = characterData.nickname ? `【昵称】${characterData.nickname}\n` : '';
      const characterTagsLine = characterData.tags ? `【标签】${Array.isArray(characterData.tags) ? characterData.tags.join('、') : characterData.tags}\n` : '';
      const userRequirementsSection = requirements && requirements.trim() ? `\n\n【用户生成指导】\n${requirements.trim()}` : '';

      const variables: Record<string, string> = {
        target_field_label: targetField.label,
        target_field_guide: targetField.guide,
        existing_fields_info: existingFieldsInfo || '暂无其他字段信息，请基于角色名称和基本设定进行合理推断。',
        character_name: characterData.name || '未设置',
        character_version_line: characterVersionLine,
        character_creator_line: characterCreatorLine,
        character_nickname_line: characterNicknameLine,
        character_tags_line: characterTagsLine,
        user_requirements_section: userRequirementsSection,
      };

      const promptResult = await window.electronAPI.prompt.build('character-card.generate', variables);
      if (!promptResult.success || !promptResult.data) {
        throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
      }
      // Spec: polish-deai-humanizer v3 — 字段生成为直接文本输出（非 JSON），
      // 注入文本生成变体去AI味规则（完整指南 + RP 词表，默认开启无开关，
      // 与世界书生成策略一致；不用 JSON-aware 生成变体以免误导模型输出 JSON）
      const finalSystemPrompt = withHumanizerTextgenRules(promptResult.data.systemPrompt);
      addLog(`[Character] 去AI味规则: 已注入`, 'info');
      const userPrompt = promptResult.data.userPrompt;

      addLog(`[Character] 系统提示词长度: ${finalSystemPrompt.length} 字符`, 'info');
      addLog(`[Character] 用户提示词长度: ${userPrompt.length} 字符`, 'info');
      addLog(`[Character] existingFieldsInfo 长度: ${existingFieldsInfo.length} 字符`, 'info');
      addLog(`[Character] 用户生成指导: ${requirements || '无'}`, 'info');

      // 【流式改造】实时预览写入表单字段；中断/失败时恢复原值
      const originalText = formValues[field];
      const { text: generatedContent, error: streamError } = await runStreamingAI(activeEngine, finalSystemPrompt, userPrompt, field);

      if (!isProcessingRef.current) {
        addLog('[Character] 生成请求已被用户中断', 'warn');
        setFormValues((prev: any) => ({ ...prev, [field]: originalText }));
        return;
      }

      if (streamError) {
        setFormValues((prev: any) => ({ ...prev, [field]: originalText }));
        throw new Error(streamError);
      }

      if (!generatedContent) {
        setFormValues((prev: any) => ({ ...prev, [field]: originalText }));
        message.error('AI未返回有效内容，请重试');
        setGeneratingField(null);
        isProcessingRef.current = false;
        return;
      }

      addLog(`[Character] 生成成功，内容长度: ${generatedContent.length} 字符`, 'info');

      // Spec: fix-character-card-field-scope-flash-models — 输出越界防御（写回前净化）
      const defenseResult = extractTargetFieldContent(generatedContent, field, addLog);
      if (defenseResult.overflow) {
        setFormValues((prev: any) => ({ ...prev, [field]: originalText }));
        message.warning('模型输出越界（包含其他字段内容），已保留原文，建议重试或更换模型');
        setGeneratingField(null);
        isProcessingRef.current = false;
        return;
      }
      const finalContent = defenseResult.content;

      setFormValues((prev: any) => ({
        ...prev,
        [field]: finalContent
      }));

      message.success('生成成功');
      isProcessingRef.current = false;
      setIsGenerateModalOpen(false);
      setCurrentGenerateField(null);
      setGenerateRequirements('');
    } catch (error) {
      addLog(`[Character] 生成失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
      isProcessingRef.current = false;
    } finally {
      setGeneratingField(null);
    }
  }, [addLog, currentGenerateField, formValues, generateRequirements, getActiveEngineConfig, setFormValues, setGeneratingField]);

  const handleCancelAIRequest = useCallback(() => {
    isProcessingRef.current = false;
    window.electronAPI?.ai?.cancel?.();
    setAiOperation(null);
    message.info('已中断AI请求');
    addLog('[Character] 用户主动中断AI请求', 'warn');
  }, [addLog]);

  const handlePolish = useCallback((field: string) => {
    addLog(`[Character] 准备润色字段: ${field}`);

    const text = formValues[field as keyof typeof formValues];

    if (!text) {
      message.warning('请先输入要润色的内容');
      return;
    }

    addLog(`[Character] 润色内容长度: ${text.length} 字符`);

    const activeEngine = getActiveEngineConfig();

    if (!activeEngine) {
      message.error('请先在配置管理中设置AI引擎');
      return;
    }

    if (!activeEngine.api_url) {
      message.error('API地址不能为空');
      return;
    }

    addLog(`[Character] ====== 润色 - AI引擎完整配置 ======`, 'info');
    addLog(`[Character] API地址: ${activeEngine.api_url}`);
    addLog(`[Character] 模型名称: ${activeEngine.model_name ?? '未配置'}`);
    addLog(`[Character] API密钥传输方式: ${activeEngine.api_key_transmission || 'header'}`);
    addLog(`[Character] API模式: ${activeEngine.api_mode}`);
    addLog(`[Character] 是否有全局system_prompt: ${activeEngine.system_prompt ? '✅ 有' : '❌ 无'}`);
    if (activeEngine.system_prompt) {
      addLog(`[Character] 全局system_prompt内容长度: ${activeEngine.system_prompt.length} 字符`);
      addLog(`[Character] 全局system_prompt内容:\n${activeEngine.system_prompt}`);
    }
    addLog(`[Character] ===================================`, 'info');

    setCurrentPolishField(field);
    setCurrentPolishText(text);
    setPolishRequirements('');
    setIsPolishModalOpen(true);
  }, [addLog, formValues, getActiveEngineConfig]);

  const performPolish = useCallback(async () => {
    if (!currentPolishField || !currentPolishText) {
      return;
    }

    const startTime = Date.now();
    addLog(`[Character] 开始润色字段: ${currentPolishField}`);
    isProcessingRef.current = true;

    setPolishingField(currentPolishField);

    try {
      const activeEngine = getActiveEngineConfig();

      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        setPolishingField(null);
        isProcessingRef.current = false;
        setIsPolishModalOpen(false);
        return;
      }

      if (!activeEngine.api_url) {
        message.error('API地址不能为空');
        setPolishingField(null);
        isProcessingRef.current = false;
        setIsPolishModalOpen(false);
        return;
      }

      addLog(`[Character] API配置: URL=${activeEngine.api_url}, Model=${activeEngine.model_name ?? '未配置'}`);
      addLog(`[Character] 用户润色要求: ${polishRequirements || '无'}`, 'info');

      const polishFieldLabel = FIELD_DESCRIPTIONS[currentPolishField]?.label || currentPolishField;
      const variables: Record<string, string> = {
        // Spec: polish-deai-humanizer — 默认要求措辞中性化：
        // 原"更加通顺自然"对 LLM 等价于"请堆砌华丽辞藻"，是"禁忌之美"式浮夸的直接诱因
        polish_requirements: polishRequirements || '优化表达使其自然流畅、细节具体，保持原意不变。',
        target_field_label: polishFieldLabel,
      };

      const promptResult = await window.electronAPI.prompt.build('character-card.polish', variables);
      if (!promptResult.success || !promptResult.data) {
        throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
      }
      // Spec: polish-deai-humanizer — 按开关状态注入去AI味规则块（运行时注入，
      // 不烘焙进模板：开关关闭时可完全撤下，且规避存量 DB 模板不更新的坑）
      const finalSystemPrompt = withHumanizerRules(promptResult.data.systemPrompt, polishDeAiFlavor);
      addLog(`[Character] 去AI味规则: ${polishDeAiFlavor ? '已注入' : '已关闭（开关）'}`, 'info');

      addLog(`[Character] 系统提示词长度: ${finalSystemPrompt.length} 字符`, 'info');

      // Spec: fix-character-card-field-scope-flash-models — 目标文本标签包裹 + 上下文隔离
      // （与翻译操作同构：防止 Flash 模型把全字段上下文理解为"润色整张角色卡"）
      const characterContext = buildCharacterContext(formValues, currentPolishField);
      const contextFieldCount = characterContext ? characterContext.split('\n').length : 0;
      addLog(`[Character] 角色卡上下文参考: ${characterContext.length} 字符, ${contextFieldCount} 个字段`, 'info');
      const enhancedUserPrompt = characterContext
        ? `请润色以下 <polish_target> 标签内的文本（仅此文本，其他内容一律忽略）：\n\n<polish_target>\n${currentPolishText}\n</polish_target>\n\n<context_reference>\n以下为角色卡其他字段，仅作润色参考，禁止润色或输出其中任何内容：\n${characterContext}\n</context_reference>`
        : `请润色以下 <polish_target> 标签内的文本：\n\n<polish_target>\n${currentPolishText}\n</polish_target>`;
      addLog(`[Character] user prompt 总长度: ${enhancedUserPrompt.length} 字符 (原文 ${currentPolishText.length} + 上下文 ${characterContext.length})`, 'info');

      // 【流式改造】实时预览写入表单字段；中断/失败时恢复原值
      const originalText = currentPolishText;
      const { text: polishedText, error: streamError } = await runStreamingAI(activeEngine, finalSystemPrompt, enhancedUserPrompt, currentPolishField);

      if (!isProcessingRef.current) {
        addLog('[Character] 润色请求已被用户中断', 'warn');
        setFormValues((prev: any) => ({ ...prev, [currentPolishField]: originalText }));
        return;
      }

      if (streamError) {
        setFormValues((prev: any) => ({ ...prev, [currentPolishField]: originalText }));
        throw new Error(streamError);
      }

      if (!polishedText) {
        setFormValues((prev: any) => ({ ...prev, [currentPolishField]: originalText }));
        message.error('AI未返回有效内容，请重试');
        setPolishingField(null);
        isProcessingRef.current = false;
        return;
      }

      addLog(`[Character] 收到润色响应，原始长度: ${polishedText.length} 字符`);

      let cleanedText = polishedText;
      for (const pattern of THOUGHT_PATTERNS_POLISH) {
        cleanedText = cleanedText.replace(pattern, '').trim();
      }

      cleanedText = cleanedText.replace(/^(润色:|Polished:)\s*/i, '').trim();

      // Spec: fix-character-card-field-scope-flash-models — 输出越界防御（写回前净化）
      const defenseResult = extractTargetFieldContent(cleanedText, currentPolishField, addLog);
      if (defenseResult.overflow) {
        setFormValues((prev: any) => ({ ...prev, [currentPolishField]: originalText }));
        message.warning('模型输出越界（包含其他字段内容），已保留原文，建议重试或更换模型');
        setPolishingField(null);
        isProcessingRef.current = false;
        return;
      }
      cleanedText = defenseResult.content;

      cleanedText = normalizeTagsField(cleanedText, currentPolishField, addLog);

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      addLog(`[Character] 润色完成: 字段=${currentPolishField}, 耗时=${duration}秒, 结果长度=${cleanedText.length} 字符`, 'info');

      setFormValues((prev: any) => ({
        ...prev,
        [currentPolishField]: cleanedText
      }));

      message.success('润色成功');
      setPolishingField(null);
      isProcessingRef.current = false;
      setIsPolishModalOpen(false);
      setCurrentPolishField(null);
      setCurrentPolishText('');
      setPolishRequirements('');

    } catch (error) {
      addLog(`[Character] 润色失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`润色失败: ${error instanceof Error ? error.message : '未知错误'}`);
      setPolishingField(null);
      isProcessingRef.current = false;
    }
  }, [addLog, currentPolishField, currentPolishText, formValues, getActiveEngineConfig, polishDeAiFlavor, polishRequirements, runStreamingAI, setFormValues, setPolishingField]);

  return {
    aiOperation,
    setAiOperation,
    translatingField,
    setTranslatingField,
    polishingField,
    setPolishingField,
    generatingField,
    setGeneratingField,
    isPolishModalOpen,
    setIsPolishModalOpen,
    polishRequirements,
    setPolishRequirements,
    currentPolishField,
    setCurrentPolishField,
    currentPolishText,
    setCurrentPolishText,
    polishDeAiFlavor,
    setPolishDeAiFlavor,
    isGenerateModalOpen,
    setIsGenerateModalOpen,
    generateRequirements,
    setGenerateRequirements,
    currentGenerateField,
    setCurrentGenerateField,
    handleTranslate,
    handlePolish,
    performPolish,
    performGenerate,
    openGenerateModal,
    handleCancelAIRequest,
    handleRestore,
    isProcessingRef,
  };
}
