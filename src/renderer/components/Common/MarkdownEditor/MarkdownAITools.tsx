import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button, Dropdown, Space, Tooltip, message, Modal, Input, Spin, Progress } from 'antd';
import type { InputRef } from 'antd';
import { useSettingStore } from '../../../stores/settingStore';
import { useLogStore } from '../../../stores/logStore';
import { AIService, AIServiceConfig } from '../AIService';
import {
  AIToolType,
  SUPPORTED_LANGUAGES,
  TranslationLanguage,
  AIToolState,
  ModalState,
  SelectionInfo
} from './MarkdownAITools.types';
import {
  generateSystemPrompt,
  getSelectedText,
  getSelectionInfo,
  HistoryManager,
  createErrorMessage,
  validateSelectedText,
  cleanThoughtChain
} from './MarkdownAITools.utils';

interface MarkdownAIToolsProps {
  getEditorContent: () => string;
  setEditorContent: (content: string) => void;
  editorElement: HTMLElement | null;
}

const MarkdownAITools: React.FC<MarkdownAIToolsProps> = ({
  getEditorContent,
  setEditorContent
}) => {
  const setting = useSettingStore(s => s.setting);
  const addLog = useLogStore(s => s.addLog);
  
  const [toolState, setToolState] = useState<AIToolState>({
    isProcessing: false,
    currentTool: null,
    error: null
  });
  
  const [targetLanguage, setTargetLanguage] = useState<TranslationLanguage>(
    SUPPORTED_LANGUAGES[0]
  );
  
  const [hasSelection, setHasSelection] = useState(false);
  const historyManagerRef = useRef(new HistoryManager<string>(50));
  
  // 流式响应状态
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  // 当前正在处理的文本
  const [processingText, setProcessingText] = useState('');
  
  // 模态框状态
  const [modalState, setModalState] = useState<ModalState & { selectionInfo: SelectionInfo }>({
    isOpen: false,
    toolType: null,
    selectedText: '',
    selectionInfo: { text: '', from: 0, to: 0, isEmpty: true }
  });
  const [customRequirements, setCustomRequirements] = useState('');
  const inputRef = useRef<InputRef>(null);

  // 用于流式替换时保存原始编辑器内容和替换起始位置
  const originalContentRef = useRef<string>('');
  const replacementStartIndexRef = useRef<number>(-1);

  // 用于中断请求
  const currentRequestIdRef = useRef<string | null>(null);
  const aiServiceRef = useRef<AIService | null>(null);

  // 初始化 AIService
  const getAIServiceConfig = useCallback((): { config: AIServiceConfig | null; error: string | null } => {
    addLog(`[MarkdownAI] 构建 AIService 配置...`);
    
    if (!setting) {
      addLog(`[MarkdownAI] ⚠️ 设置尚未加载，无法构建 AIService 配置`, 'warn');
      return { 
        config: null, 
        error: '系统设置尚未加载完成，请稍后再试。如果问题持续，请刷新页面。' 
      };
    }
    
    const activeEngine = setting?.aiEngines?.find(engine => engine.id === setting?.activeEngineId) 
      || setting?.aiEngines?.[0];
    
    if (!activeEngine) {
      addLog(`[MarkdownAI] ⚠️ 没有找到活跃引擎`, 'warn');
      addLog(`[MarkdownAI] ⚠️ 提示: 请在设置中配置 AI 引擎以使用 AI 功能`, 'warn');
      return { 
        config: null, 
        error: '未配置 AI 引擎。请先在设置页面添加并启用 AI 引擎。' 
      };
    }

    if (!activeEngine.api_url || activeEngine.api_url.trim() === '') {
      addLog(`[MarkdownAI] ⚠️ 引擎 "${activeEngine.name || activeEngine.id}" 的 API 地址为空`, 'warn');
      return { 
        config: null, 
        error: `AI 引擎 "${activeEngine.name || activeEngine.id}" 的 API 地址未配置。请在设置中配置有效的 API 地址。` 
      };
    }

    addLog(`[MarkdownAI] ✅ 构建 AIService 配置，使用引擎: ${activeEngine.name || activeEngine.id}`);
    addLog(`[MarkdownAI]    API 地址: ${activeEngine.api_url}`);
    addLog(`[MarkdownAI]    模型名称: ${activeEngine.model_name || '未设置'}`);
    
    const engineMaxTokens = activeEngine.max_tokens;
    const safeMaxTokens = (typeof engineMaxTokens === 'number' && engineMaxTokens > 0) 
      ? engineMaxTokens 
      : 10240;
    
    if (typeof engineMaxTokens === 'number' && engineMaxTokens <= 0) {
      addLog(`[MarkdownAI] ⚠️ 引擎 max_tokens 值无效 (${engineMaxTokens})，请检查配置`, 'warn');
    }
    
    const engineTemp = activeEngine.temperature;
    const safeTemperature = (typeof engineTemp === 'number' && engineTemp >= 0 && engineTemp <= 2) 
      ? engineTemp 
      : 0.7;
    
    if (typeof engineTemp === 'number' && (engineTemp < 0 || engineTemp > 2)) {
      addLog(`[MarkdownAI] ⚠️ 引擎 temperature 值无效 (${engineTemp})，请检查配置`, 'warn');
    }
    
    return {
      config: {
        defaultModel: activeEngine.model_name,
        defaultBaseUrl: activeEngine.api_url,
        defaultApiKey: activeEngine.api_key || '',
        defaultApiKeyTransmission: (activeEngine.api_key_transmission as 'header' | 'body') || 'header',
        defaultTemperature: safeTemperature,
        defaultMaxTokens: safeMaxTokens,
        retryAttempts: 0,
        retryDelay: 1000,
        timeout: 600000,
        systemPrompt: activeEngine.system_prompt
      },
      error: null
    };
  }, [setting, addLog]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selectedText = getSelectedText();
      setHasSelection(selectedText.length > 0);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, []);

  // 键盘事件处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!modalState.isOpen) return;
      
      if (e.key === 'Escape') {
        handleCancel();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        handleConfirm();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [modalState.isOpen]);

  // 自动聚焦输入框
  useEffect(() => {
    if (modalState.isOpen && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [modalState.isOpen]);

  const saveToHistory = useCallback(() => {
    const currentContent = getEditorContent();
    historyManagerRef.current.push(currentContent);
  }, [getEditorContent]);

  const undo = useCallback(() => {
    const previousContent = historyManagerRef.current.pop();
    if (previousContent !== undefined) {
      setEditorContent(previousContent);
      message.success('已撤销');
    } else {
      message.info('没有可撤销的操作');
    }
  }, [setEditorContent]);

  const getToolName = (toolType: AIToolType): string => {
    switch (toolType) {
      case AIToolType.Polish:
        return '润色';
      case AIToolType.Expand:
        return '扩写';
      case AIToolType.Translate:
        return '翻译';
      default:
        return '处理';
    }
  };

  const getPlaceholder = (toolType: AIToolType): string => {
    switch (toolType) {
      case AIToolType.Polish:
        return '请输入润色要求(选填)';
      case AIToolType.Expand:
        return '请输入扩写要求(选填)';
      default:
        return '请输入要求(选填)';
    }
  };

  // 处理润色/扩写按钮点击
  const handlePolishOrExpandClick = useCallback((toolType: AIToolType) => {
    const selectedText = getSelectedText();
    
    const validation = validateSelectedText(selectedText);
    if (!validation.valid) {
      if (validation.error?.includes('Please select')) {
        message.warning('请先选择需要处理的文本');
      } else {
        message.warning(validation.error);
      }
      return;
    }

    // 获取编辑器元素以计算精确选区位置
    const editorElement = document.querySelector('[data-testid="milkdown-editor"]') as HTMLElement;
    const selectionInfo = getSelectionInfo(editorElement || document.body);

    // 检查文本长度
    if (selectedText.length > 500) {
      message.warning(`文本较长(${selectedText.length}字)，处理可能需要一些时间`);
    }

    // 打开模态框，同时保存选区位置信息
    setModalState({
      isOpen: true,
      toolType,
      selectedText,
      selectionInfo
    });
    setCustomRequirements('');
  }, []);

  // 处理翻译按钮点击（直接执行）
  const handleTranslateClick = useCallback(async () => {
    const selectedText = getSelectedText();
    
    const validation = validateSelectedText(selectedText);
    if (!validation.valid) {
      if (validation.error?.includes('Please select')) {
        message.warning('请先选择需要处理的文本');
      } else {
        message.warning(validation.error);
      }
      return;
    }

    // 获取编辑器元素以计算精确选区位置
    const editorElement = document.querySelector('[data-testid="milkdown-editor"]') as HTMLElement;
    const selectionInfo = getSelectionInfo(editorElement || document.body);

    await executeAITool(AIToolType.Translate, selectedText, selectionInfo, undefined);
  }, [targetLanguage]);

  // 取消按钮
  const handleCancel = useCallback(() => {
    setModalState({
      isOpen: false,
      toolType: null,
      selectedText: '',
      selectionInfo: { text: '', from: 0, to: 0, isEmpty: true }
    });
    setCustomRequirements('');
    originalContentRef.current = '';
    replacementStartIndexRef.current = -1;
  }, []);

  // 中断AI请求
  const handleCancelRequest = useCallback(() => {
    if (currentRequestIdRef.current && aiServiceRef.current) {
      aiServiceRef.current.cancelRequest(currentRequestIdRef.current);
      currentRequestIdRef.current = null;
      aiServiceRef.current = null;
    }
    
    setIsStreaming(false);
    setStreamingContent('');
    setProcessingText('');
    setToolState({
      isProcessing: false,
      currentTool: null,
      error: null
    });
    
    message.info('已中断AI请求');
    addLog(`[MarkdownAI] ⚠️ 用户主动中断AI请求`, 'warn');
  }, [addLog]);

  // 使用默认设置
  const handleUseDefault = useCallback(async () => {
    if (!modalState.toolType) return;
    
    await executeAITool(modalState.toolType, modalState.selectedText, modalState.selectionInfo, undefined);
    handleCancel();
  }, [modalState]);

  // 确认按钮
  const handleConfirm = useCallback(async () => {
    if (!modalState.toolType) return;
    
    await executeAITool(modalState.toolType, modalState.selectedText, modalState.selectionInfo, customRequirements);
    handleCancel();
  }, [modalState, customRequirements]);

  // 基于位置的文本替换函数 - 修复选区替换逻辑
  const replaceByPosition = useCallback((
    content: string,
    from: number,
    to: number,
    newText: string
  ): string => {
    if (from < 0 || to > content.length || from > to) {
      addLog(`[MarkdownAI] ⚠️ 位置索引无效: from=${from}, to=${to}, contentLength=${content.length}`, 'warn');
      return content;
    }
    return content.substring(0, from) + newText + content.substring(to);
  }, [addLog]);

  // 执行AI工具 - 流式响应版本（基于位置索引替换）
  const executeAITool = useCallback(async (
    toolType: AIToolType, 
    selectedText: string,
    selectionInfo: SelectionInfo,
    customRequirements?: string
  ) => {
    const startTime = Date.now();
    const toolName = getToolName(toolType);
    const toolTypeStr = AIToolType[toolType];
    const requestId = `md_ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 获取当前编辑器内容，并使用 indexOf 找到选中文本的精确位置
    const currentContent = getEditorContent();
    originalContentRef.current = currentContent;
    
    // 使用 indexOf 在原始内容中查找选中文本的起始位置
    const replaceFrom = currentContent.indexOf(selectedText);
    const replaceTo = replaceFrom !== -1 ? replaceFrom + selectedText.length : -1;
    const isValidPosition = replaceFrom !== -1;
    
    addLog(`[MarkdownAI] ======================================`);
    addLog(`[MarkdownAI] 🚀 开始执行 ${toolName} 工具 (流式响应)`, 'debug');
    addLog(`[MarkdownAI] 请求 ID: ${requestId}`, 'debug');
    addLog(`[MarkdownAI] ======================================`, 'debug');
    
    // ==================== 输入参数日志 ====================
    addLog(`[MarkdownAI] 【输入参数】工具类型: ${toolName} (${toolTypeStr})`, 'debug');
    addLog(`[MarkdownAI] 【输入参数】目标语言: ${toolType === AIToolType.Translate ? targetLanguage.nativeName : 'N/A'}`, 'debug');
    addLog(`[MarkdownAI] 【输入参数】自定义要求: ${customRequirements || '无'}`, 'debug');
    addLog(`[MarkdownAI] 【输入参数】选中文本长度: ${selectedText.length} 字符`, 'debug');
    addLog(`[MarkdownAI] 【输入参数】查找到的替换位置: from=${replaceFrom}, to=${replaceTo}`, 'debug');
    addLog(`[MarkdownAI] 【输入参数】位置有效性: ${isValidPosition ? '有效' : '无效'}`, 'debug');
    addLog(`[MarkdownAI] 【输入参数】选中文本内容:`, 'debug');
    addLog(`[MarkdownAI] --- 开始 ---`, 'debug');
    addLog(selectedText, 'debug');
    addLog(`[MarkdownAI] --- 结束 (${selectedText.length} 字符) ---`, 'debug');
    
    setToolState({
      isProcessing: true,
      currentTool: toolType,
      error: null
    });
    setIsStreaming(true);
    setStreamingContent('');
    setProcessingText(selectedText);

    saveToHistory();
    addLog(`[MarkdownAI] 已保存当前内容到历史记录`, 'debug');

    currentRequestIdRef.current = requestId;

    try {
      addLog(`[MarkdownAI] 正在构建 AIService 配置...`, 'debug');
      const configResult = getAIServiceConfig();
      
      if (configResult.error || !configResult.config) {
        throw new Error(configResult.error || '配置构建失败');
      }
      
      const aiConfig = configResult.config;
      
      // ==================== AI 服务配置日志 ====================
      addLog(`[MarkdownAI] 【AI 配置】API 地址: ${aiConfig.defaultBaseUrl}`, 'debug');
      addLog(`[MarkdownAI] 【AI 配置】模型名称: ${aiConfig.defaultModel}`, 'debug');
      addLog(`[MarkdownAI] 【AI 配置】Temperature: ${aiConfig.defaultTemperature}`, 'debug');
      addLog(`[MarkdownAI] 【AI 配置】MaxTokens: ${aiConfig.defaultMaxTokens}`, 'debug');
      addLog(`[MarkdownAI] 【AI 配置】SystemPrompt: ${aiConfig.systemPrompt ? `有 (${aiConfig.systemPrompt.length} 字符)` : '无'}`, 'debug');
      addLog(`[MarkdownAI] 【AI 配置】Timeout: ${(aiConfig as any).timeout || 600000}ms`, 'debug');
      
      let aiService: AIService;
      try {
        aiService = new AIService(aiConfig);
        aiServiceRef.current = aiService;
        addLog(`[MarkdownAI] ✅ AIService 初始化完成`, 'debug');
      } catch (configError) {
        const configErrorMsg = configError instanceof Error ? configError.message : '配置验证失败';
        addLog(`[MarkdownAI] ❌ AIService 配置错误: ${configErrorMsg}`, 'error');
        addLog(`[MarkdownAI] 💡 提示: 请检查设置中的 AI 引擎配置是否正确`, 'error');
        throw new Error(`AI 引擎配置无效: ${configErrorMsg}`);
      }

      // ==================== 提示词生成日志 ====================
      addLog(`[MarkdownAI] 【提示词生成】开始生成系统提示词...`, 'debug');
      const generatedPrompt = generateSystemPrompt(
        toolType, 
        toolType === AIToolType.Translate ? targetLanguage.nativeName : undefined,
        customRequirements
      );
      addLog(`[MarkdownAI] 【提示词生成】工具特定提示词长度: ${generatedPrompt.length} 字符`, 'debug');
      
      let systemPrompt = generatedPrompt;
      
      // 如果配置中有全局 systemPrompt，把它放在最前面
      if (aiConfig.systemPrompt && aiConfig.systemPrompt.trim()) {
        addLog(`[MarkdownAI] 【提示词生成】检测到全局 SystemPrompt，正在拼接...`, 'debug');
        systemPrompt = `${aiConfig.systemPrompt.trim()}\n\n${generatedPrompt}`;
      }

      addLog(`[MarkdownAI] 【提示词生成】最终系统提示词长度: ${systemPrompt.length} 字符`, 'debug');
      addLog(`[MarkdownAI] 【提示词生成】完整系统提示词:`, 'debug');
      addLog(`[MarkdownAI] --- 开始 ---`, 'debug');
      addLog(systemPrompt, 'debug');
      addLog(`[MarkdownAI] --- 结束 (${systemPrompt.length} 字符) ---`, 'debug');

      // ==================== 请求消息日志 ====================
      addLog(`[MarkdownAI] 【请求消息】构建 AI 请求消息...`, 'debug');
      addLog(`[MarkdownAI] 【请求消息】System 角色消息长度: ${systemPrompt.length} 字符`, 'debug');
      addLog(`[MarkdownAI] 【请求消息】User 角色消息长度: ${selectedText.length} 字符`, 'debug');

      const messages = [
        {
          role: 'system' as const,
          content: systemPrompt
        },
        {
          role: 'user' as const,
          content: selectedText
        }
      ];

      // ==================== 流式请求日志 ====================
      addLog(`[MarkdownAI] ⏳ 开始发送流式请求到 AI 服务器...`, 'debug');
      
      let accumulatedContent = '';
      let responseComplete = false;
      let streamChunkCount = 0;
      const streamStartTime = Date.now();

      await aiService.sendStreamChatRequest(
        { messages, model: aiConfig.defaultModel },
        {
          onStream: (chunk, done) => {
            if (chunk) {
              streamChunkCount++;
              accumulatedContent += chunk;
              setStreamingContent(accumulatedContent);
              
              // 流式响应期间，节流更新编辑器内容
              // 每 5 个 chunk 或完成时更新一次编辑器
              const shouldUpdateEditor = streamChunkCount % 5 === 0 || done;
              if (shouldUpdateEditor) {
                if (isValidPosition) {
                  // 使用精确位置替换 - 只替换用户选中的部分
                  const newContent = replaceByPosition(
                    originalContentRef.current,
                    replaceFrom,
                    replaceTo,
                    accumulatedContent
                  );
                  setEditorContent(newContent);
                } else {
                  addLog(`[MarkdownAI] ⚠️ 无法找到选中文本在编辑器中的位置`, 'warn');
                }
              }

              // 每 10 个 chunk 记录一次进度
              if (streamChunkCount % 10 === 0) {
                const elapsed = ((Date.now() - streamStartTime) / 1000).toFixed(2);
                addLog(`[MarkdownAI] 【流式响应】已接收 ${streamChunkCount} 个 chunk，累计 ${accumulatedContent.length} 字符，耗时 ${elapsed}s`, 'debug');
              }
            }
            
            if (done) {
              responseComplete = true;
              const totalElapsed = ((Date.now() - streamStartTime) / 1000).toFixed(2);
              addLog(`[MarkdownAI] ✅ 流式响应完成`, 'debug');
              addLog(`[MarkdownAI] 【流式响应】总计 ${streamChunkCount} 个 chunk`, 'debug');
              addLog(`[MarkdownAI] 【流式响应】总耗时: ${totalElapsed}s`, 'debug');
            }
          },
          onError: (error) => {
            const errorMsg = typeof error === 'string' ? error : error.message;
            addLog(`[MarkdownAI] ❌ 流式响应错误: ${errorMsg}`, 'error');
            throw new Error(errorMsg);
          },
          onComplete: (response) => {
            addLog(`[MarkdownAI] ✅ 响应完成回调触发`, 'debug');
            if (response?.content && response.content.length > 0) {
              addLog(`[MarkdownAI] 【响应完成】收到有效内容，长度: ${response.content.length} 字符`, 'debug');
              accumulatedContent = response.content;
              setStreamingContent(accumulatedContent);
            } else {
              addLog(`[MarkdownAI] 【响应完成】未收到有效内容，保留流式累积内容 (${accumulatedContent.length} 字符)`, 'debug');
            }
            if (response?.usage) {
              addLog(`[MarkdownAI] 【响应完成】Token 使用量: ${JSON.stringify(response.usage)}`, 'debug');
            }
          }
        }
      );

      // ==================== 响应处理日志 ====================
      addLog(`[MarkdownAI] 【响应处理】开始处理 AI 响应...`, 'debug');
      
      // 确保最终清理
      if (!responseComplete && accumulatedContent.length > 0) {
        addLog(`[MarkdownAI] ⚠️ 流式响应提前结束，但有部分内容可用 (${accumulatedContent.length} 字符)`, 'debug');
      }

      // ==================== 输出内容清理日志 ====================
      addLog(`[MarkdownAI] 【输出处理】开始清理响应内容...`, 'debug');
      const cleanedText = cleanThoughtChain(accumulatedContent, toolType);
      addLog(`[MarkdownAI] 【输出处理】清理前长度: ${accumulatedContent.length} 字符`, 'debug');
      addLog(`[MarkdownAI] 【输出处理】清理后长度: ${cleanedText.length} 字符`, 'debug');
      addLog(`[MarkdownAI] 【输出处理】清理掉的字符数: ${accumulatedContent.length - cleanedText.length} 字符`, 'debug');
      
      // ==================== 最终输出日志 ====================
      addLog(`[MarkdownAI] ======================================`, 'debug');
      addLog(`[MarkdownAI] 【输出结果】${toolName} 完成 - 完整输出内容:`, 'debug');
      addLog(`[MarkdownAI] --- 开始 (${toolName}输出) ---`, 'debug');
      addLog(cleanedText, 'debug');
      addLog(`[MarkdownAI] --- 结束 (${toolName}输出, ${cleanedText.length} 字符) ---`, 'debug');
      
      // 根据工具类型记录特定日志
      switch (toolType) {
        case AIToolType.Polish:
          addLog(`[MarkdownAI] 【润色结果】输入长度: ${selectedText.length} 字符`, 'debug');
          addLog(`[MarkdownAI] 【润色结果】输出长度: ${cleanedText.length} 字符`, 'debug');
          addLog(`[MarkdownAI] 【润色结果】字符变化: ${cleanedText.length - selectedText.length > 0 ? '+' : ''}${cleanedText.length - selectedText.length}`, 'debug');
          break;
        case AIToolType.Expand:
          addLog(`[MarkdownAI] 【扩写结果】输入长度: ${selectedText.length} 字符`, 'debug');
          addLog(`[MarkdownAI] 【扩写结果】输出长度: ${cleanedText.length} 字符`, 'debug');
          addLog(`[MarkdownAI] 【扩写结果】扩写增加: ${cleanedText.length - selectedText.length > 0 ? '+' : ''}${cleanedText.length - selectedText.length} 字符`, 'debug');
          addLog(`[MarkdownAI] 【扩写结果】扩写倍数: ${(cleanedText.length / Math.max(selectedText.length, 1)).toFixed(2)}x`, 'debug');
          break;
        case AIToolType.Translate:
          addLog(`[MarkdownAI] 【翻译结果】输入语言: 原始文本`, 'debug');
          addLog(`[MarkdownAI] 【翻译结果】目标语言: ${targetLanguage.nativeName} (${targetLanguage.name})`, 'debug');
          addLog(`[MarkdownAI] 【翻译结果】输入长度: ${selectedText.length} 字符`, 'debug');
          addLog(`[MarkdownAI] 【翻译结果】输出长度: ${cleanedText.length} 字符`, 'debug');
          break;
      }
      
      // 最终更新编辑器 - 使用固定位置替换
      if (isValidPosition) {
        const finalContent = replaceByPosition(originalContentRef.current, replaceFrom, replaceTo, cleanedText);
        setEditorContent(finalContent);
        addLog(`[MarkdownAI] 【最终替换】使用固定位置替换 (from=${replaceFrom}, to=${replaceTo})`, 'debug');
      } else {
        addLog(`[MarkdownAI] 【最终替换】无法找到选中文本位置，跳过替换`, 'error');
        message.error('无法定位选中文本，请重试');
      }
      addLog(`[MarkdownAI] 【最终替换】内容已更新到编辑器`, 'debug');
      
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      addLog(`[MarkdownAI] ======================================`);
      addLog(`[MarkdownAI] ✅ ${toolName}完成 (流式)!`);
      addLog(`[MarkdownAI] ======================================`);
      addLog(`[MarkdownAI] 总耗时: ${duration.toFixed(2)}秒`);
      addLog(`[MarkdownAI] 输入长度: ${selectedText.length} 字符`);
      addLog(`[MarkdownAI] 输出长度: ${cleanedText.length} 字符`);
      addLog(`[MarkdownAI] 内容变化: ${cleanedText.length - selectedText.length > 0 ? '+' : ''}${cleanedText.length - selectedText.length} 字符`);
      
      setToolState({
        isProcessing: false,
        currentTool: null,
        error: null
      });
      setIsStreaming(false);
      setStreamingContent('');
      setProcessingText('');
      currentRequestIdRef.current = null;
      
      message.success(`${toolName}成功 (流式)`);
      
    } catch (error) {
      addLog(`[MarkdownAI] ======================================`, 'error');
      addLog(`[MarkdownAI] ❌ ${getToolName(toolType)}失败`, 'error');
      addLog(`[MarkdownAI] ======================================`, 'error');
      addLog(`[MarkdownAI] 错误类型: ${error instanceof Error ? error.name : 'Unknown Error'}`, 'error');
      
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      
      if (error instanceof Error && (error.name === 'AbortError' || errorMessage.includes('aborted'))) {
        addLog(`[MarkdownAI] ⚠️ AI请求已被中断`, 'warn');
        setToolState({
          isProcessing: false,
          currentTool: null,
          error: null
        });
        setIsStreaming(false);
        setStreamingContent('');
        setProcessingText('');
        currentRequestIdRef.current = null;
        message.info('已中断AI请求');
        return;
      }
      
      if (errorMessage.includes('未配置 AI 引擎')) {
        addLog(`[MarkdownAI] 💡 提示: 请前往设置页面配置 AI 引擎`, 'error');
      } else if (errorMessage.includes('API 基础 URL')) {
        addLog(`[MarkdownAI] 💡 提示: 请检查 AI 引擎的 API 地址配置`, 'error');
      } else if (errorMessage.includes('无法连接到 AI 服务')) {
        addLog(`[MarkdownAI] 💡 提示: 请检查网络连接和 API 地址是否正确`, 'error');
      }
      
      addLog(`[MarkdownAI] 错误信息: ${errorMessage}`, 'error');
      
      if (error instanceof Error && error.stack) {
        addLog(`[MarkdownAI] 堆栈跟踪: ${error.stack}`, 'error');
      }
      
      message.error(`${getToolName(toolType)}失败: ${errorMessage}`);
      setToolState({
        isProcessing: false,
        currentTool: null,
        error: createErrorMessage(error)
      });
      setIsStreaming(false);
      setStreamingContent('');
      setProcessingText('');
      currentRequestIdRef.current = null;
    }
  }, [getEditorContent, setEditorContent, saveToHistory, targetLanguage, getAIServiceConfig, addLog, replaceByPosition]);

  const getLanguageMenuItems = () => {
    return SUPPORTED_LANGUAGES.map((lang) => ({
      key: lang.code,
      label: `${lang.nativeName} (${lang.name})`,
      onClick: () => setTargetLanguage(lang)
    }));
  };

  return (
    <>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        backgroundColor: 'rgba(0, 0, 0, 0.02)',
        borderRadius: '8px',
        marginBottom: '12px',
        flexWrap: 'wrap'
      }}>
        <Space size="small">
          <Tooltip title="优化文本的表达流畅度、语法准确性和可读性（流式响应）">
            <Button
              type="text"
              size="small"
              disabled={!hasSelection || toolState.isProcessing}
              loading={toolState.isProcessing && toolState.currentTool === AIToolType.Polish}
              onClick={() => handlePolishOrExpandClick(AIToolType.Polish)}
              style={{
                fontWeight: 500,
                color: hasSelection ? '#1890ff' : '#ccc'
              }}
            >
              ✨ AI润色
            </Button>
          </Tooltip>

          <Tooltip title="在保留核心意思的基础上，对文本进行内容扩展和细节补充（流式响应）">
            <Button
              type="text"
              size="small"
              disabled={!hasSelection || toolState.isProcessing}
              loading={toolState.isProcessing && toolState.currentTool === AIToolType.Expand}
              onClick={() => handlePolishOrExpandClick(AIToolType.Expand)}
              style={{
                fontWeight: 500,
                color: hasSelection ? '#722ed1' : '#ccc'
              }}
            >
              📝 AI扩写
            </Button>
          </Tooltip>

          <Dropdown menu={{ items: getLanguageMenuItems() }} trigger={['click']}>
            <Button
              type="text"
              size="small"
              disabled={!hasSelection || toolState.isProcessing}
              loading={toolState.isProcessing && toolState.currentTool === AIToolType.Translate}
              onClick={handleTranslateClick}
              style={{
                fontWeight: 500,
                color: hasSelection ? '#13c2c2' : '#ccc'
              }}
            >
              🌐 AI翻译 {targetLanguage.nativeName}
            </Button>
          </Dropdown>
        </Space>

        <div style={{ flex: 1 }} />

        <Button
          type="text"
          size="small"
          onClick={undo}
          disabled={historyManagerRef.current.size === 0 || isStreaming}
          style={{ color: '#666' }}
        >
          ↩️ 撤销
        </Button>

        {toolState.isProcessing && (
          <span style={{ 
            fontSize: '12px', 
            color: '#999',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Spin size="small" />
            AI正在处理中 (流式)...
            {isStreaming && streamingContent.length > 0 && processingText.length > 0 && (
              <Progress
                percent={Math.min((streamingContent.length / (processingText.length * 2)) * 100, 95)}
                size="small"
                style={{ width: 80 }}
                strokeColor="#1890ff"
              />
            )}
            <Button
              type="link"
              size="small"
              danger
              onClick={handleCancelRequest}
              style={{ padding: '0 4px', fontSize: '12px' }}
            >
              中断
            </Button>
          </span>
        )}
      </div>

      {/* 润色/扩写模态框 */}
      <Modal
        title={
          <span>
            {modalState.toolType === AIToolType.Polish ? '✨ AI润色 (流式)' : '📝 AI扩写 (流式)'}
            {modalState.selectedText.length > 500 && (
              <span style={{ 
                marginLeft: '8px', 
                fontSize: '12px', 
                color: '#faad14' 
              }}>
                ⚠️ 文本较长({modalState.selectedText.length}字)
              </span>
            )}
          </span>
        }
        open={modalState.isOpen}
        onCancel={handleCancel}
        mask={{ closable: false }}
        footer={[
          <Button key="default" onClick={handleUseDefault} style={{ marginRight: 'auto' }} loading={toolState.isProcessing && toolState.currentTool === modalState.toolType}>
            使用默认设置
          </Button>,
          <Button key="cancel" onClick={handleCancel} disabled={toolState.isProcessing && toolState.currentTool === modalState.toolType}>
            取消
          </Button>,
          toolState.isProcessing && toolState.currentTool === modalState.toolType ? (
            <Button key="interrupt" danger onClick={handleCancelRequest}>
              中断请求
            </Button>
          ) : (
            <Button key="confirm" type="primary" onClick={handleConfirm}>
              确认
            </Button>
          )
        ]}
        centered
        destroyOnHidden
      >
        <div style={{ marginBottom: '16px' }}>
          <p style={{ color: '#666', marginBottom: '8px' }}>
            已选择文本: <strong>{modalState.selectedText.length}</strong> 字
          </p>
          <div style={{
            maxHeight: '120px',
            overflow: 'auto',
            padding: '12px',
            backgroundColor: 'var(--card-bg-color, #f5f5f5)',
            borderRadius: '6px',
            fontSize: '13px',
            color: 'var(--text-color, #333)',
            border: '1px solid var(--border-color, #e8e8e8)'
          }}>
            {modalState.selectedText}
          </div>
        </div>
        
        <Input
          ref={inputRef}
          placeholder={modalState.toolType ? getPlaceholder(modalState.toolType) : ''}
          value={customRequirements}
          onChange={(e) => setCustomRequirements(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              handleConfirm();
            }
          }}
          style={{ width: '100%' }}
          maxLength={200}
          showCount
        />
        
        <p style={{ marginTop: '12px', fontSize: '12px', color: '#999' }}>
          💡 未输入要求时将使用默认处理逻辑
        </p>
        <p style={{ marginTop: '8px', fontSize: '12px', color: '#1890ff' }}>
          ✨ 流式响应将实时更新编辑器内容
        </p>
      </Modal>
    </>
  );
};

export default MarkdownAITools;
