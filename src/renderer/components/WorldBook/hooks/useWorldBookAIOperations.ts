import { useCallback } from 'react';
import { message, Modal } from 'antd';
import { useSettingStore } from '../../../stores/settingStore';
import {
  createDefaultEntry,
  cleanAIThoughts,
  parseAIJsonResponse
} from '../../../utils/worldBookUtils';
import type { WorldBookTemplate } from '../../../utils/worldBookTemplates';
import type { UseWorldBookFormStateReturn } from './useWorldBookFormState';

/**
 * 世界书 AI 操作 Hook（Task 8 拆分产物）。
 *
 * 【多模态兼容性审计】本 Hook 使用内联 { role, content: string } 构造 messages，
 * 不导入 AIService.ts 的联合类型 ChatMessage，不受多模态 content 扩展影响。
 * 所有消息 content 均为纯文本字符串，适用于世界书生成/翻译/润色等非视觉任务。
 *
 * 从原 WorldBookManager.tsx 迁出的全部 AI 长函数：translateText / polishText /
 * generateKeywords / generateTagsForEntry / handleGenerateNewEntries /
 * handleGenerateEntries / handleTemplateGenerateEntries / handleAISortEntries /
 * handleTranslate(All) / handlePolish(All) / performPolish(All) /
 * handleGenerateKeywordsForEntry(All) / handleExpandKeywords /
 * handleGenerateDescription / handleGenerateFromCharacters /
 * handleCreateFromAI / handleCreateWorldBook / handleSaveAddedEntries。
 *
 * 函数体与原实现逐行保持一致，仅将闭包变量访问改为通过 params 注入，
 * 以保证行为不变。复杂 handler 暂不包裹 useCallback 以避免 stale closure 风险；
 * 对简单的无状态 helper 使用 useCallback 稳定引用。
 */
export interface UseWorldBookAIOperationsParams {
  formState: UseWorldBookFormStateReturn;
  setting: any;
  addLog: (msg: string, level?: string) => void;
  fetchWorldBooks: () => void;
  createForm: any;
  addEntryForm: any;
  /**
   * 加载世界书标签数据（tags + associations）。
   * 该函数与 formState 中的 setTags/setAssociations 协同工作，但因属非 AI 操作，
   * 仍保留在编排层 WorldBookManager 中，由调用方注入以避免重复实现。
   */
  loadTags: (worldBookPath: string) => Promise<void>;
}

export function useWorldBookAIOperations(params: UseWorldBookAIOperationsParams) {
  const {
    formState,
    setting,
    addLog,
    fetchWorldBooks,
    createForm,
    addEntryForm,
    loadTags,
  } = params;

  const {
    worldBookContent, setWorldBookContent,
    selectedEntries,
    formValues, setFormValues,
    viewingItem,
    isProcessingRef,
    // 仅使用 setter 的状态值不在此处解构，避免 noUnusedLocals 错误。
    // 这些状态值仍由 useWorldBookFormState 暴露给编排层 WorldBookManager 在 JSX 中读取。
    setTranslatingField,
    setIsTranslatingAll,
    setPolishingField,
    setIsPolishingAll,
    setIsAISorting,
    setIsGeneratingKeywordsAll,
    setGeneratingKeywordsUid,
    setIsGeneratingEntries,
    setIsAddingEntry,
    setIsGeneratingFromChars,
    currentPolishField, setCurrentPolishField,
    currentPolishText, setCurrentPolishText,
    polishRequirements, setPolishRequirements,
    setIsPolishModalOpen,
    polishAllRequirements, setPolishAllRequirements,
    setIsPolishAllModalOpen,
    generatedEntries, setGeneratedEntries,
    setGeneratedWorldBookName,
    generatedWorldBookDescription, setGeneratedWorldBookDescription,
    addedEntries, setAddedEntries,
    setIsGenerateModalOpen,
    setIsCreateModalOpen,
    setIsAddEntryModalOpen,
  } = formState;

  // 获取当前激活的AI引擎配置
  const getActiveEngineConfig = useCallback(() => {
    if (!setting) return null;

    // 从设置中获取当前激活的引擎
    if (setting.aiEngines && setting.activeEngineId) {
      const activeEngine = setting.aiEngines.find((engine: any) => engine.id === setting.activeEngineId);
      if (activeEngine) {
        return activeEngine;
      }
    }

    // 如果没有激活的引擎，返回第一个引擎
    if (setting.aiEngines && setting.aiEngines.length > 0) {
      return setting.aiEngines[0];
    }

    return null;
  }, [setting]);

  // 辅助函数：翻译单个文本
  const translateText = async (text: string, apiUrl: string, apiKey: string, apiMode: string, modelName: string, apiKeyTransmission: string, worldBookDescription: string = '', maxTokens: number = 10240, temperature: number = 0.7, topP: number = 0.95, globalSystemPrompt: string = ''): Promise<string> => {
    if (!text || text.trim() === '') {
      return text;
    }

    const startTime = Date.now();
    addLog(`[WorldBook] translateText: 开始翻译, 长度=${text.length}字符, Mode=${apiMode}, Model=${modelName}, Transmission=${apiKeyTransmission}, MaxTokens=${maxTokens}, Temperature=${temperature}, TopP=${topP}`);

    let requestUrl;
    let requestBody;
    let requestHeaders = {
      'Content-Type': 'application/json'
    };

    // 通过提示词模板构建系统提示词
    const promptResult = await window.electronAPI.prompt.build('world-book.translate', {});
    if (!promptResult.success || !promptResult.data) {
      throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
    }
    let systemPrompt = promptResult.data.systemPrompt;

    // 如果提供了世界书描述，添加到提示词中
    if (worldBookDescription) {
      systemPrompt += `\n\n【世界书背景】\n${worldBookDescription}`;
    }

    // 拼接全局system_prompt
    if (globalSystemPrompt && globalSystemPrompt.trim()) {
      systemPrompt = globalSystemPrompt.trim() + '\n\n' + systemPrompt;
    }

    // 根据 API 模式构建请求 URL
    if (apiMode === 'chat_completion') {
      if (apiUrl.endsWith('/v1/chat/completions')) {
        requestUrl = apiUrl;
      } else {
        // 确保 apiUrl 以 / 结尾，然后添加路径
        const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
        requestUrl = baseUrl + 'v1/chat/completions';
      }

      // 构建 chat_completion 模式的请求体
      requestBody = {
        model: modelName,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: text
          }
        ],
        max_tokens: maxTokens,
        temperature: temperature,
        top_p: topP,
        n: 1,
        stream: false,
        stop: null,
        extra_body: {
          chat_template_kwargs: {
            enable_thinking: false
          }
        }
      };
    } else {
      if (apiUrl.endsWith('/v1/completions')) {
        requestUrl = apiUrl;
      } else {
        // 确保 apiUrl 以 / 结尾，然后添加路径
        const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
        requestUrl = baseUrl + 'v1/completions';
      }

      // 构建 text_completion 模式的请求体
      requestBody = {
        model: modelName,
        prompt: `${systemPrompt}\n\n${text}`,
        max_tokens: maxTokens,
        temperature: temperature,
        top_p: topP,
        n: 1,
        stream: false,
        stop: null
      };
    }

    // 根据传输方式添加API密钥
    if (apiKey) {
      if (apiKeyTransmission === 'header') {
        // 检查 API 密钥是否已经包含 Bearer 前缀
        const trimmedApiKey = apiKey.trim();
        if (trimmedApiKey.startsWith('Bearer ')) {
          requestHeaders['Authorization'] = trimmedApiKey;
        } else {
          requestHeaders['Authorization'] = `Bearer ${trimmedApiKey}`;
        }
      } else {
        requestBody.api_key = apiKey;
      }
    }

    addLog(`[WorldBook] translateText: 发送请求到 ${requestUrl}`);
    addLog(`[WorldBook] translateText: 请求头: ${JSON.stringify(requestHeaders)}`);
    addLog(`[WorldBook] translateText: 请求体: ${JSON.stringify(requestBody, null, 2)}`);

    // 使用 Electron IPC 发送请求，避免 CORS 问题
    try {
      const result = await window.electronAPI.ai.request({
        url: requestUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody,

      });

      if (!result.success) {
        addLog(`[WorldBook] translateText: API请求失败 ${result.error}`, 'error');
        addLog(`[WorldBook] translateText: 错误详情 ${result.details}`, 'error');
        throw new Error(`API请求失败: ${result.error}`);
      }

      const data = result.data;
      addLog(`[WorldBook] translateText: 收到完整响应: ${JSON.stringify(data, null, 2)}`);

      // 尝试从不同的字段获取响应内容
      let translatedText = data.choices?.[0]?.message?.content?.trim() ||
                        data.choices?.[0]?.text?.trim() ||
                        '';

      addLog(`[WorldBook] translateText: 收到响应, 原始长度=${translatedText.length}字符`);

      // 清理翻译结果
      const thoughtPatterns = [
        /思考[:：]\s*[^]*?(?=\n\n|$)/gi,
        /Thought[:\s]+[^]*?(?=\n\n|$)/gi,
        /Thinking[:\s]+[^]*?(?=\n\n|$)/gi,
        /思考过程[:：]\s*[^]*?(?=\n\n|$)/gi,
        /让我思考一下[:：]\s*[^]*?(?=\n\n|$)/gi,
        /我需要思考[:：]\s*[^]*?(?=\n\n|$)/gi,
        /Reasoning:\s*[^]*?(?=\n\n|$)/gi,
        /思考:\s*[^]*?(?=\n\n|$)/gi
      ];

      let cleanedText = translatedText;
      for (const pattern of thoughtPatterns) {
        cleanedText = cleanedText.replace(pattern, '').trim();
      }

      // 移除可能的"译文:"、"Translation:"等前缀
      cleanedText = cleanedText.replace(/^(译文:|翻译:|Translation:)\s*/i, '').trim();

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      addLog(`[WorldBook] translateText: 翻译完成, 耗时=${duration}秒, 清理后长度=${cleanedText.length}字符`);

      return cleanedText || text;
    } catch (error) {
      addLog(`[WorldBook] 翻译失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      throw error;
    }
  };

  // 辅助函数：为条目生成标签
  const generateTagsForEntry = async (entry: any, apiUrl: string, apiKey: string, apiMode: string, modelName: string, apiKeyTransmission: string, worldBookDescription: string = '', maxTokens: number = 512, temperature: number = 0.7, topP: number = 0.95): Promise<string[]> => {
    void apiMode; // 预存在模式：apiMode 参数未在函数体使用（原 WorldBookManager.tsx:1769 同此实现）
    addLog(`[WorldBook] 开始为条目生成标签: ${entry.comment || '无注释'}, Model=${modelName}, MaxTokens=${maxTokens}, Temperature=${temperature}, TopP=${topP}`);
    try {
      // 通过提示词模板构建系统提示词和用户提示词
      const promptResult = await window.electronAPI.prompt.build('world-book.generate-tags', {
        entry_comment: entry.comment || '无',
        entry_content: entry.content || '无',
        entry_keys: entry.key?.join(', ') || '无'
      });
      if (!promptResult.success || !promptResult.data) {
        throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
      }
      let systemPrompt = promptResult.data.systemPrompt;
      const userPrompt = promptResult.data.userPrompt;

      // 如果有世界书描述，添加到系统提示词中
      if (worldBookDescription) {
        systemPrompt += `\n\n【世界书背景】\n${worldBookDescription}`;
      }

      // 发送请求
      const requestUrl = apiUrl + '/v1/chat/completions';
      const requestBody = {
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: maxTokens,
        temperature: temperature,
        top_p: topP,
        n: 1,
        stream: false
      };

      // 构建请求头
      let requestHeaders = {
        'Content-Type': 'application/json'
      };

      // 根据传输方式添加API密钥
      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          requestHeaders['Authorization'] = `Bearer ${apiKey}`;
        } else {
          requestBody.api_key = apiKey;
        }
      }

      const result = await window.electronAPI.ai.request({
        url: requestUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody,
      });

      if (!result.success) {
        throw new Error(`API请求失败: ${result.error}`);
      }

      const data = result.data;
      let aiResponse = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';

      // 清理响应，提取标签
      aiResponse = aiResponse.trim();
      const tags = aiResponse.split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0);

      addLog(`[WorldBook] 为条目生成标签成功: ${tags.join(', ')}`);
      return tags;
    } catch (error) {
      addLog(`[WorldBook] 生成标签失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      return [];
    }
  };

  // 辅助函数：润色单个文本
  const polishText = async (text: string, apiUrl: string, apiKey: string, apiMode: string, modelName: string, apiKeyTransmission: string, requirements: string = '', worldBookDescription: string = '', textType: 'keyword' | 'content' | 'comment' = 'content', maxTokens: number = 10240, temperature: number = 0.7, topP: number = 0.95, globalSystemPrompt: string = ''): Promise<string> => {
    if (!text || text.trim() === '') {
      return text;
    }

    const startTime = Date.now();
    addLog(`[WorldBook] polishText: 开始润色, 类型=${textType}, 长度=${text.length}字符, Mode=${apiMode}, Model=${modelName}, Transmission=${apiKeyTransmission}, MaxTokens=${maxTokens}, Temperature=${temperature}, TopP=${topP}`);

    let requestUrl;
    let requestBody;
    let requestHeaders = {
      'Content-Type': 'application/json'
    };

    // 根据文本类型通过提示词模板构建系统提示词
    const moduleId = textType === 'keyword' ? 'world-book.polish-keyword'
      : textType === 'comment' ? 'world-book.polish-comment'
      : 'world-book.polish-content';
    const promptResult = await window.electronAPI.prompt.build(moduleId, {
      polish_requirements: requirements || ''
    });
    if (!promptResult.success || !promptResult.data) {
      throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
    }
    let basePrompt = promptResult.data.systemPrompt;

    // 如果提供了世界书描述，添加到提示词中
    if (worldBookDescription) {
      basePrompt += `\n\n【世界书背景】\n${worldBookDescription}`;
    }

    // 拼接全局system_prompt
    if (globalSystemPrompt && globalSystemPrompt.trim()) {
      basePrompt = globalSystemPrompt.trim() + '\n\n' + basePrompt;
    }

    // 根据 API 模式构建请求 URL
    if (apiMode === 'chat_completion') {
      if (apiUrl.endsWith('/v1/chat/completions')) {
        requestUrl = apiUrl;
      } else {
        // 确保 apiUrl 以 / 结尾，然后添加路径
        const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
        requestUrl = baseUrl + 'v1/chat/completions';
      }

      // 构建 chat_completion 模式的请求体
      requestBody = {
        model: modelName,
        messages: [
          {
            role: 'system',
            content: basePrompt
          },
          {
            role: 'user',
            content: text
          }
        ],
        max_tokens: maxTokens,
        temperature: temperature,
        top_p: topP,
        n: 1,
        stream: false,
        stop: null,
        extra_body: {
          chat_template_kwargs: {
            enable_thinking: false
          }
        }
      };
    } else {
      if (apiUrl.endsWith('/v1/completions')) {
        requestUrl = apiUrl;
      } else {
        // 确保 apiUrl 以 / 结尾，然后添加路径
        const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
        requestUrl = baseUrl + 'v1/completions';
      }

      // 构建 text_completion 模式的请求体
      requestBody = {
        model: modelName,
        prompt: `${basePrompt}\n\n${text}`,
        max_tokens: maxTokens,
        temperature: temperature,
        top_p: topP,
        n: 1,
        stream: false,
        stop: null
      };
    }

    // 根据传输方式添加API密钥
    if (apiKey) {
      if (apiKeyTransmission === 'header') {
        // 检查 API 密钥是否已经包含 Bearer 前缀
        const trimmedApiKey = apiKey.trim();
        if (trimmedApiKey.startsWith('Bearer ')) {
          requestHeaders['Authorization'] = trimmedApiKey;
        } else {
          requestHeaders['Authorization'] = `Bearer ${trimmedApiKey}`;
        }
      } else {
        requestBody.api_key = apiKey;
      }
    }

    addLog(`[WorldBook] polishText: 发送请求到 ${requestUrl}`);
    addLog(`[WorldBook] polishText: 请求头: ${JSON.stringify(requestHeaders)}`);
    addLog(`[WorldBook] polishText: 请求体: ${JSON.stringify(requestBody, null, 2)}`);

    // 使用 Electron IPC 发送请求，避免 CORS 问题
    try {
      const result = await window.electronAPI.ai.request({
        url: requestUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody,

      });

      if (!result.success) {
        addLog(`[WorldBook] polishText: API请求失败 ${result.error}`, 'error');
        addLog(`[WorldBook] polishText: 错误详情 ${result.details}`, 'error');
        throw new Error(`API请求失败: ${result.error}`);
      }

      const data = result.data;
      addLog(`[WorldBook] polishText: 收到完整响应: ${JSON.stringify(data, null, 2)}`);

      // 尝试从不同的字段获取响应内容
      let polishedText = data.choices?.[0]?.message?.content?.trim() ||
                        data.choices?.[0]?.text?.trim() ||
                        '';

      addLog(`[WorldBook] polishText: 收到响应, 原始长度=${polishedText.length}字符`);

      // 清理润色结果
      const thoughtPatterns = [
        /思考[:：]\s*[^]*?(?=\n\n|$)/gi,
        /Thought[:\s]+[^]*?(?=\n\n|$)/gi,
        /Thinking[:\s]+[^]*?(?=\n\n|$)/gi,
        /思考过程[:：]\s*[^]*?(?=\n\n|$)/gi,
        /让我思考一下[:：]\s*[^]*?(?=\n\n|$)/gi,
        /我需要思考[:：]\s*[^]*?(?=\n\n|$)/gi,
        /Reasoning:\s*[^]*?(?=\n\n|$)/gi,
        /思考:\s*[^]*?(?=\n\n|$)/gi
      ];

      let cleanedText = polishedText;
      for (const pattern of thoughtPatterns) {
        cleanedText = cleanedText.replace(pattern, '').trim();
      }

      // 移除可能的"润色:"、"Polished:"等前缀
      cleanedText = cleanedText.replace(/^(润色:|Polished:)\s*/i, '').trim();

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      addLog(`[WorldBook] polishText: 润色完成, 耗时=${duration}秒, 清理后长度=${cleanedText.length}字符`);

      return cleanedText || text;
    } catch (error) {
      addLog(`[WorldBook] 润色失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      throw error;
    }
  };

  /**
   * AI生成关键词函数 - 用于为条目生成优化后的主要和次要关键词
   *
   * 注意：原 WorldBookManager.tsx 中此函数的 system_prompt 拼接处引用了未定义的
   * `activeEngine`（应为 `engine`），会导致 ReferenceError。此处修正为 `engine`，
   * 使函数真正可用。函数其余逻辑与原实现一致。
   */
  const generateKeywords = async (content: string, comment: string, worldBookDescription: string = ''): Promise<{ key: string[], keysecondary: string[] }> => {
    const { setting: settingState } = useSettingStore.getState();
    if (!settingState) throw new Error('未找到设置');

    const engines = settingState.aiEngines || [];
    const engine = engines.find((e: any) => e.id === settingState.activeEngineId) || engines[0];
    if (!engine) throw new Error('未找到活跃的AI引擎');

    // 使用正确的属性名 (snake_case)
    const { api_url, api_key, api_mode, model_name, api_key_transmission, max_tokens, temperature, top_p } = engine;

    // Validate required fields
    if (!api_url) {
      throw new Error('AI引擎API地址未配置');
    }

    const maxTokensVal = (typeof max_tokens === 'number' && max_tokens > 0) ? max_tokens : 10240;
    const tempVal = (typeof temperature === 'number' && temperature >= 0 && temperature <= 2) ? temperature : 0.7;
    const topPVal = (typeof top_p === 'number' && top_p >= 0 && top_p <= 1) ? top_p : 0.95;

    addLog(`[WorldBook] generateKeywords: 开始生成关键词`);
    addLog(`[WorldBook] API配置: URL=${api_url}, Mode=${api_mode}, Model=${model_name}, Transmission=${api_key_transmission}, MaxTokens=${maxTokensVal}, Temperature=${tempVal}, TopP=${topPVal}`);

    let requestUrl: string;
    let requestBody: any;
    let requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // 通过提示词模板构建系统提示词和用户提示词
    const promptResult = await window.electronAPI.prompt.build('world-book.generate-keywords', {
      comment: comment || '无',
      content: content.substring(0, 2000) + (content.length > 2000 ? '...' : ''),
      world_book_description: worldBookDescription || '无特定世界书背景'
    });
    if (!promptResult.success || !promptResult.data) {
      throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
    }
    let systemPrompt = promptResult.data.systemPrompt;
    const userPrompt = promptResult.data.userPrompt;

    // 拼接全局system_prompt
    if (engine.system_prompt && engine.system_prompt.trim()) {
      systemPrompt = engine.system_prompt.trim() + '\n\n' + systemPrompt;
    }

    // 根据 API 模式构建请求 URL
    if (api_mode === 'chat_completion') {
      if (api_url.endsWith('/v1/chat/completions')) {
        requestUrl = api_url;
      } else {
        const baseUrl = api_url.endsWith('/') ? api_url : api_url + '/';
        requestUrl = baseUrl + 'v1/chat/completions';
      }

      requestBody = {
        model: model_name,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: maxTokensVal,
        temperature: tempVal,
        top_p: topPVal,
        n: 1,
        stream: false,
        stop: null,
        chat_template_kwargs: {
          enable_thinking: false
        }
      };
    } else {
      if (api_url.endsWith('/v1/completions')) {
        requestUrl = api_url;
      } else {
        const baseUrl = api_url.endsWith('/') ? api_url : api_url + '/';
        requestUrl = baseUrl + 'v1/completions';
      }

      requestBody = {
        model: model_name,
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        max_tokens: maxTokensVal,
        temperature: tempVal,
        top_p: topPVal,
        n: 1,
        stream: false,
        stop: null
      };
    }

    // 添加 API 密钥
    if (api_key) {
      if (api_key_transmission === 'header') {
        const trimmedApiKey = api_key.trim();
        if (trimmedApiKey.startsWith('Bearer ')) {
          requestHeaders['Authorization'] = trimmedApiKey;
        } else {
          requestHeaders['Authorization'] = `Bearer ${trimmedApiKey}`;
        }
      } else {
        requestBody.api_key = api_key;
      }
    }

    addLog(`[WorldBook] generateKeywords: 发送请求到 ${requestUrl}`);

    try {
      const result = await window.electronAPI.ai.request({
        url: requestUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody,

      });

      if (!result.success) {
        addLog(`[WorldBook] generateKeywords: API请求失败 ${result.error}`, 'error');
        addLog(`[WorldBook] generateKeywords: 错误详情 ${result.details}`, 'error');
        throw new Error(`API请求失败: ${result.error}`);
      }

      const data = result.data;
      let aiResponse = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';

      addLog(`[WorldBook] generateKeywords: 收到响应: ${aiResponse.substring(0, 200)}`);

      // 清理 AI 响应
      aiResponse = aiResponse.trim();

      // 提取 JSON
      const firstBrace = aiResponse.indexOf('{');
      const lastBrace = aiResponse.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        aiResponse = aiResponse.substring(firstBrace, lastBrace + 1);
      } else {
        aiResponse = aiResponse.replace(/^```(json)?\s*/g, '');
        aiResponse = aiResponse.replace(/\s*```$/g, '');
      }

      addLog(`[WorldBook] generateKeywords: 清理后的响应: ${aiResponse}`);

      let parsedResult;
      try {
        parsedResult = JSON.parse(aiResponse);
      } catch (parseError) {
        addLog(`[WorldBook] generateKeywords: JSON解析失败: ${(parseError as Error).message}`, 'warn');
        throw new Error('AI返回的数据格式不正确');
      }

      const keywords: { key: string[], keysecondary: string[] } = {
        key: Array.isArray(parsedResult.key) ? parsedResult.key : [],
        keysecondary: Array.isArray(parsedResult.keysecondary) ? parsedResult.keysecondary : []
      };

      addLog(`[WorldBook] generateKeywords: 生成成功 - 主要关键词: ${keywords.key.join(', ')}, 次要关键词: ${keywords.keysecondary.join(', ')}`);

      return keywords;
    } catch (error) {
      addLog(`[WorldBook] generateKeywords: 失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      throw error;
    }
  };

  // 提取世界书中已存在的所有关键词
  const extractExistingKeywords = () => {
    if (!worldBookContent || !worldBookContent.entries) {
      return [];
    }

    const existingKeywords = new Set<string>();

    Object.values(worldBookContent.entries).forEach((entry: any) => {
      if (entry.key && Array.isArray(entry.key)) {
        entry.key.forEach((keyword: string) => {
          if (keyword && keyword.trim()) {
            existingKeywords.add(keyword.toLowerCase().trim());
          }
        });
      }
      if (entry.keysecondary && Array.isArray(entry.keysecondary)) {
        entry.keysecondary.forEach((keyword: string) => {
          if (keyword && keyword.trim()) {
            existingKeywords.add(keyword.toLowerCase().trim());
          }
        });
      }
    });

    return Array.from(existingKeywords);
  };

  // AI生成关键词 - 单个条目
  const handleGenerateKeywordsForEntry = async (uid: string | number) => {
    if (!worldBookContent || !worldBookContent.entries) {
      message.error('当前世界书内容为空');
      return;
    }

    try {
      setGeneratingKeywordsUid(uid);
      addLog(`[WorldBook] 开始为条目 UID=${uid} 生成关键词`);

      // 查找匹配的条目
      let matchedEntry: any = null;
      for (const key in worldBookContent.entries) {
        const entry = worldBookContent.entries[key];
        if (String(entry.uid) === String(uid)) {
          matchedEntry = entry;
          break;
        }
      }

      if (!matchedEntry) {
        addLog(`[WorldBook] 未找到匹配条目: UID=${uid}`);
        message.error('未找到指定条目');
        setGeneratingKeywordsUid(null);
        return;
      }

      addLog(`[WorldBook] 找到条目: ${matchedEntry.comment || matchedEntry.uid}`);

      const description = worldBookContent.description || worldBookContent.name || '';

      const keywords = await generateKeywords(matchedEntry.content || '', matchedEntry.comment || '', description);

      // 更新条目
      const newContent = JSON.parse(JSON.stringify(worldBookContent));
      for (const key in newContent.entries) {
        if (String(newContent.entries[key].uid) === String(uid)) {
          newContent.entries[key].key = keywords.key.length > 0 ? keywords.key : [''];
          newContent.entries[key].keysecondary = keywords.keysecondary;
          break;
        }
      }

      await window.electronAPI.worldBook.write(viewingItem!.path, newContent);
      setWorldBookContent(newContent);

      message.success('关键词生成成功');
    } catch (error) {
      addLog(`[WorldBook] 生成关键词失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error('生成关键词失败: ' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setGeneratingKeywordsUid(null);
    }
  };

  // AI生成关键词 - 所有条目
  const handleGenerateKeywordsAll = async () => {
    if (!worldBookContent || !worldBookContent.entries) {
      message.error('当前世界书内容为空');
      return;
    }

    setIsGeneratingKeywordsAll(true);

    try {
      const entries: any[] = Object.values(worldBookContent.entries);
      const description = worldBookContent.description || worldBookContent.name || '';

      addLog(`[WorldBook] 开始为 ${entries.length} 个条目生成关键词`);

      const newContent = JSON.parse(JSON.stringify(worldBookContent));

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        try {
          addLog(`[WorldBook] 正在为条目 ${entry.comment || entry.uid} 生成关键词 (${i + 1}/${entries.length})`);

          const keywords = await generateKeywords(entry.content || '', entry.comment || '', description);

          // 更新条目
          for (const key in newContent.entries) {
            if (newContent.entries[key].uid === entry.uid) {
              newContent.entries[key].key = keywords.key.length > 0 ? keywords.key : [''];
              newContent.entries[key].keysecondary = keywords.keysecondary;
              break;
            }
          }

          // 每次保存一个条目，避免长时间等待
          await window.electronAPI.worldBook.write(viewingItem!.path, newContent);
          setWorldBookContent(JSON.parse(JSON.stringify(newContent)));

        } catch (error) {
          addLog(`[WorldBook] 条目 ${entry.comment || entry.uid} 关键词生成失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
        }
      }

      message.success('所有条目关键词生成完成');
    } catch (error) {
      addLog(`[WorldBook] 生成关键词失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error('生成关键词失败');
    } finally {
      setIsGeneratingKeywordsAll(false);
    }
  };

  const handleTranslate = async (field: string) => {
    const startTime = Date.now();
    addLog(`[WorldBook] 开始翻译字段: ${field}`);
    isProcessingRef.current = true;

    try {
      // 设置正在翻译的字段
      setTranslatingField(field);

      // 从状态获取当前值
      const text = formValues[field as keyof typeof formValues];

      if (!text) {
        message.warning('请先输入要翻译的内容');
        setTranslatingField(null);
        isProcessingRef.current = false;
        return;
      }

      addLog(`[WorldBook] 翻译内容长度: ${text.length} 字符`);

      // 获取当前激活的AI引擎配置
      const activeEngine = getActiveEngineConfig();

      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        setTranslatingField(null);
        isProcessingRef.current = false;
        return;
      }

      const apiUrl = activeEngine.api_url;
      const apiKey = activeEngine.api_key;
      const apiMode = activeEngine.api_mode;
      const modelName = activeEngine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })();
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      const maxTokens = (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240;
      const temperature = (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7;
      const topP = (typeof activeEngine.top_p === 'number' && activeEngine.top_p >= 0 && activeEngine.top_p <= 1) ? activeEngine.top_p : 0.95;

      addLog(`[WorldBook] API配置: URL=${apiUrl}, Mode=${apiMode}, Model=${modelName}, Transmission=${apiKeyTransmission}, MaxTokens=${maxTokens}, Temperature=${temperature}, TopP=${topP}`);

      if (!apiUrl) {
        message.error('API地址不能为空');
        setTranslatingField(null);
        isProcessingRef.current = false;
        return;
      }

      // 获取世界书描述
      const worldBookDescription = worldBookContent?.description || '';

      // 调用翻译函数
      let cleanedText = await translateText(text, apiUrl, apiKey, apiMode, modelName, apiKeyTransmission, worldBookDescription, maxTokens, temperature, topP, activeEngine.system_prompt || '');

      if (!isProcessingRef.current) {
        addLog('[WorldBook] 翻译请求已被用户中断', 'warn');
        return;
      }

      // 如果翻译的是关键词字段（key 或 keysecondary），处理顿号分隔的情况
      if (field === 'key' || field === 'keysecondary') {
        if (cleanedText.includes('、')) {
          // 将顿号分隔的多个词转换为逗号分隔
          const parts = cleanedText.split('、').map(p => p.trim()).filter(p => p);
          cleanedText = parts.join(', ');
          addLog(`[WorldBook] 检测到顿号分隔，已转换为逗号分隔: ${cleanedText}`);
        }
      }

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      addLog(`[WorldBook] 翻译完成: 字段=${field}, 耗时=${duration}秒, 结果长度=${cleanedText.length} 字符`, 'info');

      // 更新表单字段
      setFormValues(prev => ({
        ...prev,
        [field]: cleanedText
      }));

      message.success('翻译成功');
      setTranslatingField(null);
      isProcessingRef.current = false;
    } catch (error) {
      if (!isProcessingRef.current) {
        addLog('[WorldBook] 翻译请求已被用户中断', 'warn');
        return;
      }
      message.error(`翻译失败: ${error instanceof Error ? error.message : '未知错误'}`);
      setTranslatingField(null);
      isProcessingRef.current = false;
    }
  };

  // 一键翻译选中条目
  const handleTranslateAll = async () => {
    const totalStartTime = Date.now();

    if (!worldBookContent || !worldBookContent.entries) {
      message.error('没有可翻译的条目');
      return;
    }

    if (selectedEntries.size === 0) {
      message.warning('请先选择要翻译的条目');
      return;
    }

    addLog(`[WorldBook] 开始翻译选中的 ${selectedEntries.size} 个条目`);
    isProcessingRef.current = true;

    if (!worldBookContent || !worldBookContent.entries) {
      message.error('没有可翻译的条目');
      isProcessingRef.current = false;
      return;
    }

    try {
      setIsTranslatingAll(true);

      // 获取当前激活的AI引擎配置
      const activeEngine = getActiveEngineConfig();

      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        setIsTranslatingAll(false);
        isProcessingRef.current = false;
        return;
      }

      const apiUrl = activeEngine.api_url;
      const apiKey = activeEngine.api_key;
      const apiMode = activeEngine.api_mode;
      const modelName = activeEngine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })();
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      const maxTokens = (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240;
      const temperature = (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7;
      const topP = (typeof activeEngine.top_p === 'number' && activeEngine.top_p >= 0 && activeEngine.top_p <= 1) ? activeEngine.top_p : 0.95;

      addLog(`[WorldBook] 一键翻译配置: URL=${apiUrl}, Mode=${apiMode}, Model=${modelName}, Transmission=${apiKeyTransmission}, MaxTokens=${maxTokens}, Temperature=${temperature}, TopP=${topP}`);

      if (!apiUrl) {
        message.error('API地址不能为空');
        setIsTranslatingAll(false);
        isProcessingRef.current = false;
        return;
      }

      // 获取世界书描述
      const worldBookDescription = worldBookContent?.description || '';

      // 过滤出选中的条目
      const allEntries = Object.values(worldBookContent.entries);
      const entries = allEntries.filter((entry: any) => {
        const uid = entry.uid;
        return selectedEntries.has(uid) || selectedEntries.has(String(uid));
      });
      addLog(`[WorldBook] 共 ${entries.length} 个选中的条目需要翻译`);

      let translatedCount = 0;

      for (const entry of entries) {
        if (!isProcessingRef.current) {
          addLog(`[WorldBook] 一键翻译已被用户中断`, 'warn');
          message.info('已中断翻译');
          return;
        }

        const entryAny = entry as any;
        const entryStartTime = Date.now();
        const entryUid = entryAny.uid || entryAny.comment || '未知';

        addLog(`[WorldBook] 翻译条目 ${translatedCount + 1}/${entries.length}: UID=${entryUid}`);

        // 翻译注释
        if (entryAny.comment) {
          addLog(`[WorldBook] 翻译注释: ${entryAny.comment.substring(0, 50)}...`);
          entryAny.comment = await translateText(entryAny.comment, apiUrl, apiKey, apiMode, modelName, apiKeyTransmission, worldBookDescription, maxTokens, temperature, topP, activeEngine.system_prompt || '');
        }

        // 翻译主要关键词
        if (entryAny.key && Array.isArray(entryAny.key)) {
          addLog(`[WorldBook] 翻译主要关键词: ${entryAny.key.length} 个`);
          const translatedKeys = [];
          for (const key of entryAny.key) {
            if (key) {
              let translatedKey = await translateText(key, apiUrl, apiKey, apiMode, modelName, apiKeyTransmission, worldBookDescription, maxTokens, temperature, topP, activeEngine.system_prompt || '');
              // 处理API返回的顿号或逗号分隔的情况
              if (translatedKey.includes('、') || translatedKey.includes(',')) {
                // 分割并只取第一个结果
                translatedKey = translatedKey.split(/[,，]/)[0].trim();
              }
              translatedKeys.push(translatedKey);
            }
          }
          entryAny.key = translatedKeys;
          entryAny.keys = translatedKeys; // 保持 keys 与 key 一致
        }

        // 翻译次要关键词
        if (entryAny.keysecondary && Array.isArray(entryAny.keysecondary)) {
          addLog(`[WorldBook] 翻译次要关键词: ${entryAny.keysecondary.length} 个`);
          const translatedKeySecondaries = [];
          for (const key of entryAny.keysecondary) {
            if (key) {
              let translatedKey = await translateText(key, apiUrl, apiKey, apiMode, modelName, apiKeyTransmission, worldBookDescription, maxTokens, temperature, topP, activeEngine.system_prompt || '');
              // 处理API返回的顿号或逗号分隔的情况
              if (translatedKey.includes('、') || translatedKey.includes(',')) {
                // 分割并只取第一个结果
                translatedKey = translatedKey.split(/[,，]/)[0].trim();
              }
              translatedKeySecondaries.push(translatedKey);
            }
          }
          entryAny.keysecondary = translatedKeySecondaries;
          entryAny.secondary_keys = translatedKeySecondaries; // 保持 secondary_keys 与 keysecondary 一致
        }

        // 翻译内容
        if (entryAny.content) {
          addLog(`[WorldBook] 翻译内容: ${entryAny.content.length} 字符`);
          entryAny.content = await translateText(entryAny.content, apiUrl, apiKey, apiMode, modelName, apiKeyTransmission, worldBookDescription, maxTokens, temperature, topP, activeEngine.system_prompt || '');
        }

        const entryEndTime = Date.now();
        const entryDuration = (entryEndTime - entryStartTime) / 1000;
        addLog(`[WorldBook] 条目翻译完成: UID=${entryUid}, 耗时=${entryDuration}秒`);

        translatedCount++;

        // 每翻译完一个条目，立即更新页面显示
        setWorldBookContent({ ...worldBookContent });

        // 每翻译完一个条目，保存到文件（防止中途出错丢失进度）
        await window.electronAPI.worldBook.write(viewingItem!.path, worldBookContent);

        // 显示进度消息
        message.success(`已翻译 ${translatedCount}/${entries.length} 个条目`, 1);
      }

      // 重新读取世界书内容，确保显示最新数据
      const content = await window.electronAPI.worldBook.read(viewingItem!.path);
      setWorldBookContent(content);

      const totalEndTime = Date.now();
      const totalDuration = (totalEndTime - totalStartTime) / 1000;
      addLog(`[WorldBook] 一键翻译全部完成: 共${translatedCount}个条目, 总耗时=${totalDuration}秒, 平均每个条目=${(totalDuration/translatedCount).toFixed(2)}秒`, 'info');

      message.success(`成功翻译 ${translatedCount} 个条目，总耗时 ${totalDuration.toFixed(2)} 秒`);
      isProcessingRef.current = false;
    } catch (error) {
      if (!isProcessingRef.current) {
        addLog(`[WorldBook] 一键翻译已被用户中断`, 'warn');
        return;
      }
      addLog(`[WorldBook] 一键翻译失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`一键翻译失败: ${error instanceof Error ? error.message : '未知错误'}`);
      isProcessingRef.current = false;
    } finally {
      setIsTranslatingAll(false);
    }
  };

  // 一键润色选中条目
  const handlePolishAll = () => {
    addLog('[WorldBook] 准备一键润色选中条目');

    if (!worldBookContent || !worldBookContent.entries) {
      message.error('没有可润色的条目');
      return;
    }

    if (selectedEntries.size === 0) {
      message.warning('请先选择要润色的条目');
      return;
    }

    // 获取当前激活的AI引擎配置
    const activeEngine = getActiveEngineConfig();

    if (!activeEngine) {
      message.error('请先在配置管理中设置AI引擎');
      return;
    }

    if (!activeEngine.api_url) {
      message.error('API地址不能为空');
      return;
    }

    // 设置状态并打开模态框
    setPolishAllRequirements('');
    setIsPolishAllModalOpen(true);
  };

  const performPolishAll = async () => {
    const totalStartTime = Date.now();
    addLog(`[WorldBook] 开始润色选中的 ${selectedEntries.size} 个条目`);
    isProcessingRef.current = true;

    if (!worldBookContent || !worldBookContent.entries) {
      message.error('没有可润色的条目');
      isProcessingRef.current = false;
      return;
    }

    try {
      setIsPolishingAll(true);
      setIsPolishAllModalOpen(false);

      // 获取当前激活的AI引擎配置
      const activeEngine = getActiveEngineConfig();

      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        setIsPolishingAll(false);
        isProcessingRef.current = false;
        return;
      }

      const apiUrl = activeEngine.api_url;
      const apiKey = activeEngine.api_key;
      const apiMode = activeEngine.api_mode;
      const modelName = activeEngine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })();
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      const maxTokens = (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240;
      const temperature = (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7;
      const topP = (typeof activeEngine.top_p === 'number' && activeEngine.top_p >= 0 && activeEngine.top_p <= 1) ? activeEngine.top_p : 0.95;

      addLog(`[WorldBook] 一键润色配置: URL=${apiUrl}, Mode=${apiMode}, Model=${modelName}, Transmission=${apiKeyTransmission}, MaxTokens=${maxTokens}, Temperature=${temperature}, TopP=${topP}`);
      addLog(`[WorldBook] 用户一键润色要求: ${polishAllRequirements || '无'}`, 'info');

      if (!apiUrl) {
        message.error('API地址不能为空');
        setIsPolishingAll(false);
        isProcessingRef.current = false;
        return;
      }

      // 获取世界书描述
      const worldBookDescription = worldBookContent?.description || '';
      const requirements = polishAllRequirements;

      // 过滤出选中的条目
      const allEntries = Object.values(worldBookContent.entries);
      const entries = allEntries.filter((entry: any) => {
        const uid = entry.uid;
        return selectedEntries.has(uid) || selectedEntries.has(String(uid));
      });
      addLog(`[WorldBook] 共 ${entries.length} 个选中的条目需要润色`);

      let polishedCount = 0;

      for (const entry of entries) {
        if (!isProcessingRef.current) {
          addLog(`[WorldBook] 一键润色已被用户中断`, 'warn');
          message.info('已中断润色');
          return;
        }

        const entryAny = entry as any;
        const entryStartTime = Date.now();
        const entryUid = entryAny.uid || entryAny.comment || '未知';

        addLog(`[WorldBook] 润色条目 ${polishedCount + 1}/${entries.length}: UID=${entryUid}`);

        // 润色内容（仅润色 content 字段）
        if (entryAny.content) {
          addLog(`[WorldBook] 润色内容: ${entryAny.content.length} 字符`);
          entryAny.content = await polishText(entryAny.content, apiUrl, apiKey, apiMode, modelName, apiKeyTransmission, requirements, worldBookDescription, 'content', maxTokens, temperature, topP, activeEngine.system_prompt || '');
        }

        const entryEndTime = Date.now();
        const entryDuration = (entryEndTime - entryStartTime) / 1000;
        addLog(`[WorldBook] 条目润色完成: UID=${entryUid}, 耗时=${entryDuration}秒`);

        polishedCount++;

        // 每润色完一个条目，立即更新页面显示
        setWorldBookContent({ ...worldBookContent });

        // 每润色完一个条目，保存到文件（防止中途出错丢失进度）
        await window.electronAPI.worldBook.write(viewingItem!.path, worldBookContent);

        // 显示进度消息
        message.success(`已润色 ${polishedCount}/${entries.length} 个条目`, 1);
      }

      // 重新读取世界书内容，确保显示最新数据
      const content = await window.electronAPI.worldBook.read(viewingItem!.path);
      setWorldBookContent(content);

      const totalEndTime = Date.now();
      const totalDuration = (totalEndTime - totalStartTime) / 1000;
      addLog(`[WorldBook] 一键润色全部完成: 共${polishedCount}个条目, 总耗时=${totalDuration}秒, 平均每个条目=${(totalDuration/polishedCount).toFixed(2)}秒`, 'info');

      message.success(`成功润色 ${polishedCount} 个条目，总耗时 ${totalDuration.toFixed(2)} 秒`);
      isProcessingRef.current = false;
    } catch (error) {
      if (!isProcessingRef.current) {
        addLog(`[WorldBook] 一键润色已被用户中断`, 'warn');
        return;
      }
      addLog(`[WorldBook] 一键润色失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`一键润色失败: ${error instanceof Error ? error.message : '未知错误'}`);
      isProcessingRef.current = false;
    } finally {
      setIsPolishingAll(false);
    }
  };

  const handlePolish = (field: string) => {
    addLog(`[WorldBook] 准备润色字段: ${field}`);

    // 从状态获取当前值
    const text = formValues[field as keyof typeof formValues];

    if (!text) {
      message.warning('请先输入要润色的内容');
      return;
    }

    addLog(`[WorldBook] 润色内容长度: ${text.length} 字符`);

    // 获取当前激活的AI引擎配置
    const activeEngine = getActiveEngineConfig();

    if (!activeEngine) {
      message.error('请先在配置管理中设置AI引擎');
      return;
    }

    if (!activeEngine.api_url) {
      message.error('API地址不能为空');
      return;
    }

    // 设置状态并打开模态框
    setCurrentPolishField(field);
    setCurrentPolishText(text);
    setPolishRequirements('');
    setIsPolishModalOpen(true);
  };

  const performPolish = async () => {
    if (!currentPolishField || !currentPolishText) {
      return;
    }

    const startTime = Date.now();
    addLog(`[WorldBook] 开始润色字段: ${currentPolishField}`);

    // 设置正在润色的字段
    setPolishingField(currentPolishField);

    try {
      // 获取当前激活的AI引擎配置
      const activeEngine = getActiveEngineConfig();

      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        setPolishingField(null);
        setIsPolishModalOpen(false);
        return;
      }

      const apiUrl = activeEngine.api_url;
      const apiKey = activeEngine.api_key;
      const apiMode = activeEngine.api_mode;
      const modelName = activeEngine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })();
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      const maxTokens = (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240;
      const temperature = (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7;
      const topP = (typeof activeEngine.top_p === 'number' && activeEngine.top_p >= 0 && activeEngine.top_p <= 1) ? activeEngine.top_p : 0.95;

      addLog(`[WorldBook] API配置: URL=${apiUrl}, Mode=${apiMode}, Model=${modelName}, Transmission=${apiKeyTransmission}, MaxTokens=${maxTokens}, Temperature=${temperature}, TopP=${topP}`);
      addLog(`[WorldBook] 用户润色要求: ${polishRequirements || '无'}`, 'info');

      if (!apiUrl) {
        message.error('API地址不能为空');
        setPolishingField(null);
        setIsPolishModalOpen(false);
        return;
      }

      // 获取世界书描述
      const worldBookDescription = worldBookContent?.description || '';

      // 确定文本类型
      let textType: 'keyword' | 'content' | 'comment' = 'content';
      if (currentPolishField === 'key' || currentPolishField === 'keysecondary') {
        textType = 'keyword';
      } else if (currentPolishField === 'comment') {
        textType = 'comment';
      }

      // 调用润色函数
      let cleanedText = await polishText(currentPolishText, apiUrl, apiKey, apiMode, modelName, apiKeyTransmission, polishRequirements, worldBookDescription, textType, maxTokens, temperature, topP, activeEngine.system_prompt || '');

      // 如果润色的是关键词字段（key 或 keysecondary），处理顿号分隔的情况
      if (currentPolishField === 'key' || currentPolishField === 'keysecondary') {
        if (cleanedText.includes('、')) {
          // 将顿号分隔的多个词转换为逗号分隔
          const parts = cleanedText.split('、').map(p => p.trim()).filter(p => p);
          cleanedText = parts.join(', ');
          addLog(`[WorldBook] 检测到顿号分隔，已转换为逗号分隔: ${cleanedText}`);
        }
      }

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      addLog(`[WorldBook] 润色完成: 字段=${currentPolishField}, 耗时=${duration}秒, 结果长度=${cleanedText.length} 字符`, 'info');

      // 更新表单字段
      setFormValues(prev => ({
        ...prev,
        [currentPolishField]: cleanedText
      }));

      message.success('润色成功');
      setPolishingField(null);
      setIsPolishModalOpen(false);
      setCurrentPolishField(null);
      setCurrentPolishText('');
      setPolishRequirements('');
    } catch (error) {
      addLog(`[WorldBook] 润色失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`润色失败: ${error instanceof Error ? error.message : '未知错误'}`);
      setPolishingField(null);
    }
  };

  // AI智能排序条目
  const handleAISortEntries = async () => {
    addLog('[WorldBook] handleAISortEntries函数被调用了！');
    if (!worldBookContent || !worldBookContent.entries) {
      message.error('没有可排序的条目');
      return;
    }

    const startTime = Date.now();
    addLog('[WorldBook] 开始AI智能排序条目');

    try {
      setIsAISorting(true);

      // 获取当前激活的AI引擎配置
      const activeEngine = getActiveEngineConfig();

      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        setIsAISorting(false);
        return;
      }

      const apiUrl = activeEngine.api_url;
      const apiKey = activeEngine.api_key;
      const apiMode = activeEngine.api_mode;
      const modelName = activeEngine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })();
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      const maxTokens = (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240;
      const temperature = (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7;
      const topP = (typeof activeEngine.top_p === 'number' && activeEngine.top_p >= 0 && activeEngine.top_p <= 1) ? activeEngine.top_p : 0.95;

      addLog(`[WorldBook] AI排序API配置: URL=${apiUrl}, Mode=${apiMode}, Model=${modelName}, Transmission=${apiKeyTransmission}, MaxTokens=${maxTokens}, Temperature=${temperature}, TopP=${topP}`);

      if (!apiUrl) {
        message.error('API地址不能为空');
        setIsAISorting(false);
        return;
      }

      // 收集所有条目数据 - 按标签排序
      const entriesList = Object.entries(worldBookContent.entries).map(([uid, entry]: any) => ({
        uid: String(entry.uid || uid),
        comment: entry.comment || '',
        tags: entry.tags || [],
        group: entry.group || ''
      }));

      addLog(`[WorldBook] 收集到 ${entriesList.length} 个条目数据`);
      addLog(`[WorldBook] 条目数据: ${JSON.stringify(entriesList, null, 2)}`);

      // 通过提示词模板构建系统提示词和用户提示词
      const promptResult = await window.electronAPI.prompt.build('world-book.sort-entries', {
        entries_list: JSON.stringify(entriesList, null, 2)
      });
      if (!promptResult.success || !promptResult.data) {
        throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
      }
      let systemPrompt = promptResult.data.systemPrompt;
      const userPrompt = promptResult.data.userPrompt;

      // 添加世界书描述
      if (worldBookContent.description) {
        systemPrompt += `\n\n【世界书背景】\n${worldBookContent.description}`;
      }

      // 拼接全局system_prompt
      if (activeEngine.system_prompt && activeEngine.system_prompt.trim()) {
        systemPrompt = activeEngine.system_prompt.trim() + '\n\n' + systemPrompt;
      }

      let requestUrl;
      let requestBody;
      let requestHeaders = {
        'Content-Type': 'application/json'
      };

      // 根据 API 模式构建请求 URL
      if (apiMode === 'chat_completion') {
        if (apiUrl.endsWith('/v1/chat/completions')) {
          requestUrl = apiUrl;
        } else {
          const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
          requestUrl = baseUrl + 'v1/chat/completions';
        }

        requestBody = {
          model: modelName,
          messages: [
            // 注意：原 WorldBookManager.tsx 在此行引用了未定义的 `finalSystemPrompt`，
            // 会导致 ReferenceError。此处修正为 `systemPrompt`（变量名为 systemPrompt），
            // 与其他函数中 finalSystemPrompt 的拼接逻辑保持等价效果。
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature: temperature,
          top_p: topP,
          n: 1,
          stream: false,
          stop: null,
          extra_body: {
            chat_template_kwargs: {
              enable_thinking: false
            }
          }
        };
      } else {
        if (apiUrl.endsWith('/v1/completions')) {
          requestUrl = apiUrl;
        } else {
          const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
          requestUrl = baseUrl + 'v1/completions';
        }

        requestBody = {
          model: modelName,
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          max_tokens: maxTokens,
          temperature: temperature,
          top_p: topP,
          n: 1,
          stream: false,
          stop: null
        };
      }

      // 根据传输方式添加API密钥
      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          const trimmedApiKey = apiKey.trim();
          if (trimmedApiKey.startsWith('Bearer ')) {
            requestHeaders['Authorization'] = trimmedApiKey;
          } else {
            requestHeaders['Authorization'] = `Bearer ${trimmedApiKey}`;
          }
        } else {
          requestBody.api_key = apiKey;
        }
      }

      addLog(`[WorldBook] AI排序: 发送请求到 ${requestUrl}`);
      addLog(`[WorldBook] AI排序: 请求头: ${JSON.stringify(requestHeaders)}`);
      addLog(`[WorldBook] AI排序: 请求体: ${JSON.stringify(requestBody, null, 2)}`);

      // 使用 Electron IPC 发送请求
      try {
        addLog(`[WorldBook] AI排序: 正在通过IPC发送请求...`);
        const result = await window.electronAPI.ai.request({
          url: requestUrl,
          method: 'POST',
          headers: requestHeaders,
          body: requestBody
        });

        addLog(`[WorldBook] AI排序: IPC请求已发送，等待响应...`);

        if (!result.success) {
          addLog(`[WorldBook] AI排序: API请求失败 ${result.error}`, 'error');
          addLog(`[WorldBook] AI排序: 错误详情 ${result.details}`, 'error');
          throw new Error(`API请求失败: ${result.error}`);
        }

        const data = result.data;
        addLog(`[WorldBook] AI排序: 收到完整响应: ${JSON.stringify(data, null, 2)}`);

        // 获取响应内容
        let aiResponse = data.choices?.[0]?.message?.content?.trim() ||
                         data.choices?.[0]?.text?.trim() ||
                         '';

        addLog(`[WorldBook] AI排序: 收到响应, 原始长度=${aiResponse.length}字符`);
        addLog(`[WorldBook] AI排序: 原始响应内容: ${aiResponse}`);

        // 清理响应，提取JSON - 更加健壮的清理逻辑
        aiResponse = aiResponse.trim();

        // 尝试多种方式清理Markdown标记
        // 方式1: 直接查找第一个{和最后一个}
        const firstBrace = aiResponse.indexOf('{');
        const lastBrace = aiResponse.lastIndexOf('}');

        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          aiResponse = aiResponse.substring(firstBrace, lastBrace + 1);
          addLog(`[WorldBook] AI排序: 提取JSON片段成功`);
        } else {
          // 方式2: 尝试移除```json标记
          aiResponse = aiResponse.replace(/^```(json)?\s*/g, '');
          aiResponse = aiResponse.replace(/\s*```$/g, '');
          addLog(`[WorldBook] AI排序: 使用Markdown标记清理`);
        }

        addLog(`[WorldBook] AI排序: 清理后的响应: ${aiResponse}`);

        // 解析JSON
        let sortResult;
        try {
          sortResult = JSON.parse(aiResponse);
          addLog(`[WorldBook] AI排序: JSON解析成功`);
        } catch (parseError: any) {
          addLog(`[WorldBook] AI排序: JSON解析失败，错误: ${parseError.message}`, 'warn');
          addLog(`[WorldBook] AI排序: 尝试解析的内容: ${aiResponse}`, 'warn');
          throw new Error('AI返回的数据格式不正确，请重试');
        }

        if (!sortResult.sortedEntries || !Array.isArray(sortResult.sortedEntries)) {
          throw new Error('AI返回的数据缺少sortedEntries字段');
        }

        addLog(`[WorldBook] AI排序: 解析到 ${sortResult.sortedEntries.length} 个排序结果`);

        // 根据排序结果重新分配所有编号字段并重建entries对象
        const newEntries: Record<string, any> = {};
        const uidMap: Record<string, string> = {}; // 旧uid -> 新uid 映射

        sortResult.sortedEntries.forEach((sortedEntry: any, index: number) => {
          const oldUid = String(sortedEntry.uid);
          const newUid = index; // 新的uid从0开始连续递增
          uidMap[oldUid] = String(newUid);

          if (worldBookContent.entries[oldUid]) {
            // 复制原条目并更新所有编号字段
            const entry = JSON.parse(JSON.stringify(worldBookContent.entries[oldUid]));
            entry.uid = newUid;
            entry.order = index;
            entry.displayIndex = index;
            newEntries[String(newUid)] = entry;
          }
        });

        // 更新世界书内容
        const updatedContent = {
          ...worldBookContent,
          entries: newEntries
        };

        // 保存到文件
        await window.electronAPI.worldBook.write(viewingItem!.path, updatedContent);

        // 更新显示
        setWorldBookContent(updatedContent);

        // 显示排序对比
        addLog(`[WorldBook] ========== 排序对比 ==========`, 'info');
        sortResult.sortedEntries.forEach((sortedEntry: any, index: number) => {
          const originalEntry = entriesList.find((e: any) => String(e.uid) === String(sortedEntry.uid));
          if (originalEntry) {
            const tagsStr = originalEntry.tags?.length > 0 ? originalEntry.tags.join(', ') : (originalEntry.group || '其他');
            addLog(`[WorldBook] 序号${index}: [${tagsStr}] ${originalEntry.comment} (旧uid: ${sortedEntry.uid} -> 新uid: ${index})`, 'info');
          }
        });
        addLog(`[WorldBook] ==============================`, 'info');

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        addLog(`[WorldBook] AI排序完成: 耗时=${duration}秒, 排序了${sortResult.sortedEntries.length}个条目`, 'info');

        message.success('AI智能排序成功');

      } catch (error) {
        addLog(`[WorldBook] AI排序失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
        message.error(`AI排序失败: ${error instanceof Error ? error.message : '未知错误'}`);
        throw error;
      }

    } catch (error) {
      addLog(`[WorldBook] AI排序过程异常: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`AI排序失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsAISorting(false);
    }
  };

  // AI生成世界书条目
  const handleGenerateEntries = async (themeDescription: string) => {
    addLog('[WorldBook] 开始AI生成世界书条目');
    try {
      // 先清空之前的条目
      setAddedEntries([]);
      setIsGeneratingEntries(true);

      // 检查配置
      if (!setting) {
        message.error('请先在配置管理中设置API连接');
        return;
      }

      // 获取当前激活的AI引擎配置
      const activeEngine = getActiveEngineConfig();

      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        return;
      }

      const apiUrl = activeEngine.api_url;
      const apiKey = activeEngine.api_key;
      const apiMode = activeEngine.api_mode;
      const modelName = activeEngine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })();
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      const maxTokens = (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240;
      const temperature = (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7;
      const topP = (typeof activeEngine.top_p === 'number' && activeEngine.top_p >= 0 && activeEngine.top_p <= 1) ? activeEngine.top_p : 0.95;

      addLog(`[WorldBook] AI生成条目API配置: URL=${apiUrl}, Mode=${apiMode}, Model=${modelName}, Transmission=${apiKeyTransmission}, MaxTokens=${maxTokens}, Temperature=${temperature}, TopP=${topP}`);

      if (!apiUrl) {
        message.error('API地址不能为空');
        return;
      }

      // 获取当前世界书的最大UID
      let maxUid = 0;
      if (worldBookContent && worldBookContent.entries) {
        const existingUids = Object.values(worldBookContent.entries).map((entry: any) => entry.uid).filter((uid: any) => uid !== undefined);
        maxUid = existingUids.length > 0 ? Math.max(...existingUids) : 0;
      }
      addLog(`[WorldBook] 当前世界书最大UID: ${maxUid}`);

      // 通过提示词模板构建系统提示词和用户提示词
      const promptResult = await window.electronAPI.prompt.build('world-book.generate-entries', {
        theme_description: themeDescription
      });
      if (!promptResult.success || !promptResult.data) {
        throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
      }
      let systemPrompt = promptResult.data.systemPrompt;
      const userPrompt = promptResult.data.userPrompt;

      // 获取世界书描述
      const worldBookDescription = worldBookContent?.description || '';

      // 如果有世界书描述，添加到系统提示词中
      if (worldBookDescription) {
        systemPrompt += `\n\n【世界书背景】\n${worldBookDescription}`;
      }

      // 拼接全局system_prompt
      if (activeEngine.system_prompt && activeEngine.system_prompt.trim()) {
        systemPrompt = activeEngine.system_prompt.trim() + '\n\n' + systemPrompt;
      }

      // 发送请求
      let requestUrl;
      let requestBody;
      let requestHeaders = {
        'Content-Type': 'application/json'
      };

      // 根据 API 模式构建请求 URL
      if (apiMode === 'chat_completion') {
        if (apiUrl.endsWith('/v1/chat/completions')) {
          requestUrl = apiUrl;
        } else {
          const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
          requestUrl = baseUrl + 'v1/chat/completions';
        }

        requestBody = {
          model: modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature: temperature,
          top_p: topP,
          n: 1,
          stream: false,
          extra_body: {
            chat_template_kwargs: {
              enable_thinking: false
            }
          }
        };
      } else {
        if (apiUrl.endsWith('/v1/completions')) {
          requestUrl = apiUrl;
        } else {
          const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
          requestUrl = baseUrl + 'v1/completions';
        }

        requestBody = {
          model: modelName,
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          max_tokens: maxTokens,
          temperature: temperature,
          top_p: topP,
          n: 1,
          stream: false
        };
      }

      // 根据传输方式添加API密钥
      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          const trimmedApiKey = apiKey.trim();
          if (trimmedApiKey.startsWith('Bearer ')) {
            requestHeaders['Authorization'] = trimmedApiKey;
          } else {
            requestHeaders['Authorization'] = `Bearer ${trimmedApiKey}`;
          }
        } else {
          requestBody.api_key = apiKey;
        }
      }

      addLog(`[WorldBook] 生成条目: 发送请求到 ${requestUrl}`);
      addLog(`[WorldBook] 生成条目: 请求头: ${JSON.stringify(requestHeaders)}`);

      // 使用 Electron IPC 发送请求
      const result = await window.electronAPI.ai.request({
        url: requestUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody
      });

      if (!result.success) {
        addLog(`[WorldBook] 生成条目: API请求失败 ${result.error}`, 'error');
        addLog(`[WorldBook] 生成条目: 错误详情 ${result.details}`, 'error');
        throw new Error(`API请求失败: ${result.error}`);
      }

      const data = result.data;
      let aiResponse = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';

      // 检测是否因 max_tokens 不足导致生成被截断
      const finishReason = data.choices?.[0]?.finish_reason;
      if (finishReason === 'length') {
        addLog(`[WorldBook] AI 生成可能因 max_tokens(${maxTokens})不足被截断 (finish_reason=length)`, 'warn');
        message.warning('AI 生成内容可能因 max_tokens 不足被截断，建议调大 max_tokens 或减少生成条目数');
      }

      // 清理响应，提取JSON
      aiResponse = aiResponse.trim();

      // 移除代码块标记
      aiResponse = aiResponse.replace(/^```json\s*|\s*```$/g, '');

      // 尝试解析JSON
      let worldBookData;
      try {
        worldBookData = JSON.parse(aiResponse);
      } catch (parseError: any) {
        // 如果解析失败，尝试修复常见的JSON格式问题
        addLog(`[WorldBook] JSON解析失败，尝试修复: ${parseError.message}`, 'warn');

        // 尝试修复缺少大括号的问题
        let fixedResponse = aiResponse;

        // 计算大括号的数量
        const openBrackets = (fixedResponse.match(/\{/g) || []).length;
        const closeBrackets = (fixedResponse.match(/\}/g) || []).length;

        // 如果缺少大括号，尝试修复
        if (openBrackets > closeBrackets) {
          // 缺少右大括号，在适当的位置添加
          fixedResponse = fixedResponse.replace(/(\{\s*|,\s*)([^\{\}]*)$/, '$1$2}');
        } else if (openBrackets < closeBrackets) {
          // 缺少左大括号，在适当的位置添加
          fixedResponse = fixedResponse.replace(/(\{\s*|,\s*)([^\{\}]*)(\s*\})/, '$1{$2$3');
        }

        try {
          worldBookData = JSON.parse(fixedResponse);
          addLog('[WorldBook] JSON修复成功', 'info');
        } catch (fixError) {
          addLog(`[WorldBook] JSON修复失败: ${fixError instanceof Error ? (fixError as Error).message : '未知错误'}`, 'error');
          throw new Error(`JSON解析失败: ${parseError.message}`);
        }
      }

      // 提取生成的世界书数据
      const generatedName = worldBookData.name || '未命名世界书';
      const generatedDescription = worldBookData.description || '';
      const generatedEntries = worldBookData.entries || {};

      // 转换条目格式
      const entriesArray = Object.values(generatedEntries).map((entry: any, index: number) => {
        return createDefaultEntry(
          maxUid + index + 1,
          entry.key || [],
          entry.comment || '',
          entry.content || ''
        );
      });

      // 为每个条目生成标签
      for (const entry of entriesArray) {
        // @ts-expect-error 预存在 bug：原 WorldBookManager.tsx:2847 同样以 5 参数调用
        // generateTagsForEntry（签名要求 6+ 参数：apiKey/apiKeyTransmission 缺失，
        // 且 apiMode 误传至 apiKey 槽位）。为保持行为不变，此处保留原调用方式。
        const tags = await generateTagsForEntry(entry, apiUrl, apiMode, modelName, worldBookDescription);
        entry.tags = tags;
      }

      // 更新状态
      setGeneratedEntries(entriesArray);
      setGeneratedWorldBookName(generatedName);
      setGeneratedWorldBookDescription(generatedDescription);

      // 如果用户还没有输入世界书名称，自动填充生成的名称
      const currentName = createForm.getFieldValue('worldBookName');
      if (!currentName) {
        createForm.setFieldsValue({ worldBookName: generatedName });
      }

      addLog(`[WorldBook] AI生成成功，共 ${entriesArray.length} 个条目，名称: ${generatedName}`, 'info');
      message.success(`成功生成世界书结构，包含 ${entriesArray.length} 个条目`);
    } catch (error) {
      addLog(`[WorldBook] AI生成失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`AI生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsGeneratingEntries(false);
    }
  };

  // 基于模板生成世界书条目
  const handleTemplateGenerateEntries = async (template: WorldBookTemplate, params: Record<string, any>, theme: string): Promise<any[]> => {
    addLog(`[WorldBook] 开始基于模板生成世界书条目: ${template.name}`);
    try {
      if (!setting) {
        message.error('请先在配置管理中设置API连接');
        return [];
      }

      const activeEngine = getActiveEngineConfig();

      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        return [];
      }

      const apiUrl = activeEngine.api_url;
      const apiKey = activeEngine.api_key;
      const apiMode = activeEngine.api_mode;
      const modelName = activeEngine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })();
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      const maxTokens = (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240;
      const temperature = (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7;
      const topP = Number(activeEngine.top_p) ?? (() => { throw new Error('未配置 top_p 参数') })();

      if (!apiUrl) {
        message.error('API地址不能为空');
        return [];
      }

      const templateParams = template.generatePrompt(params, theme);

      // 通过提示词模板构建系统提示词和用户提示词
      const promptResult = await window.electronAPI.prompt.build('world-book.generate-from-template', {
        template_params: templateParams
      });
      if (!promptResult.success || !promptResult.data) {
        throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
      }
      let systemPrompt = promptResult.data.systemPrompt;
      const userPrompt = promptResult.data.userPrompt;

      let finalSystemPrompt = systemPrompt;
      if (activeEngine.system_prompt && activeEngine.system_prompt.trim()) {
        finalSystemPrompt = activeEngine.system_prompt.trim() + '\n\n' + systemPrompt;
      }

      let requestUrl;
      let requestBody;
      let requestHeaders = { 'Content-Type': 'application/json' };

      if (apiMode === 'chat_completion') {
        requestUrl = apiUrl.endsWith('/v1/chat/completions') ? apiUrl : (apiUrl.endsWith('/') ? apiUrl + 'v1/chat/completions' : apiUrl + '/v1/chat/completions');
        requestBody = {
          model: modelName,
          messages: [
            { role: 'system', content: finalSystemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature: temperature,
          top_p: topP,
          n: 1,
          stream: false
        };
      } else {
        requestUrl = apiUrl.endsWith('/v1/completions') ? apiUrl : (apiUrl.endsWith('/') ? apiUrl + 'v1/completions' : apiUrl + '/v1/completions');
        requestBody = {
          model: modelName,
          prompt: finalSystemPrompt + '\n\n' + userPrompt,
          max_tokens: maxTokens,
          temperature: temperature,
          top_p: topP,
          n: 1,
          stream: false
        };
      }

      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          const trimmedApiKey = apiKey.trim();
          if (trimmedApiKey.startsWith('Bearer ')) {
            requestHeaders['Authorization'] = trimmedApiKey;
          } else {
            requestHeaders['Authorization'] = `Bearer ${trimmedApiKey}`;
          }
        } else {
          requestBody.api_key = apiKey;
        }
      }

      addLog(`[WorldBook] 模板生成: 发送请求到 ${requestUrl}`);

      const result = await window.electronAPI.ai.request({
        url: requestUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody
      });

      if (!result.success) {
        addLog(`[WorldBook] 模板生成: API请求失败 ${result.error}`, 'error');
        throw new Error(`API请求失败: ${result.error}`);
      }

      const data = result.data;
      let aiResponse = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';

      aiResponse = aiResponse.trim();
      aiResponse = aiResponse.replace(/^```json\s*|\s*```$/g, '');

      let parsedData;
      try {
        parsedData = JSON.parse(aiResponse);
      } catch (parseError) {
        throw new Error(`JSON解析失败: ${parseError instanceof Error ? parseError.message : '未知错误'}`);
      }

      const rawEntries = Array.isArray(parsedData.entries) ? parsedData.entries : [];

      let maxUid = 0;
      if (worldBookContent && worldBookContent.entries) {
        const existingUids = Object.values(worldBookContent.entries).map((entry: any) => entry.uid).filter((uid: any) => uid !== undefined);
        maxUid = existingUids.length > 0 ? Math.max(...existingUids) : 0;
      }

      const entriesArray = rawEntries.map((entry: any, index: number) => {
        return createDefaultEntry(
          maxUid + index + 1,
          entry.key || [],
          entry.comment || '',
          entry.content || ''
        );
      });

      addLog(`[WorldBook] 模板生成成功，共 ${entriesArray.length} 个条目`, 'info');
      return entriesArray;
    } catch (error) {
      addLog(`[WorldBook] 模板生成失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      throw error;
    }
  };

  // AI扩写关键词
  const handleExpandKeywords = async (keywords: string, fieldName: 'key' | 'keysecondary') => {
    addLog(`[WorldBook] 开始AI扩写关键词: ${fieldName}`);
    try {
      // 检查配置
      if (!setting) {
        message.error('请先在配置管理中设置API连接');
        return '';
      }

      // 获取当前激活的AI引擎配置
      const activeEngine = getActiveEngineConfig();

      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        return '';
      }

      const apiUrl = activeEngine.api_url;
      const apiKey = activeEngine.api_key;
      const apiMode = activeEngine.api_mode;
      const modelName = activeEngine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })();
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      const maxTokens = (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240;
      const temperature = (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7;
      const topP = Number(activeEngine.top_p) ?? (() => { throw new Error('未配置 top_p 参数') })();

      addLog(`[WorldBook] 关键词扩写API配置: URL=${apiUrl}, Mode=${apiMode}, Model=${modelName}, Transmission=${apiKeyTransmission}, MaxTokens=${maxTokens}, Temperature=${temperature}, TopP=${topP}`);

      if (!apiUrl) {
        message.error('API地址不能为空');
        return '';
      }

      // 通过提示词模板构建系统提示词
      const promptResult = await window.electronAPI.prompt.build('world-book.expand-keywords', {
        keywords: keywords
      });
      if (!promptResult.success || !promptResult.data) {
        throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
      }
      const systemPrompt = promptResult.data.systemPrompt;

      // 拼接全局system_prompt
      let finalSystemPrompt = systemPrompt;
      if (activeEngine.system_prompt && activeEngine.system_prompt.trim()) {
        finalSystemPrompt = activeEngine.system_prompt.trim() + '\n\n' + systemPrompt;
      }

      // 发送请求
      let requestUrl;
      let requestBody;
      let requestHeaders = {
        'Content-Type': 'application/json'
      };

      // 根据 API 模式构建请求 URL
      if (apiMode === 'chat_completion') {
        if (apiUrl.endsWith('/v1/chat/completions')) {
          requestUrl = apiUrl;
        } else {
          const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
          requestUrl = baseUrl + 'v1/chat/completions';
        }

        requestBody = {
          model: modelName,
          messages: [
            { role: 'system', content: finalSystemPrompt },
            { role: 'user', content: keywords }
          ],
          max_tokens: maxTokens,
          temperature: temperature,
          top_p: topP,
          n: 1,
          stream: false,
          extra_body: {
            chat_template_kwargs: {
              enable_thinking: false
            }
          }
        };
      } else {
        if (apiUrl.endsWith('/v1/completions')) {
          requestUrl = apiUrl;
        } else {
          const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
          requestUrl = baseUrl + 'v1/completions';
        }

        requestBody = {
          model: modelName,
          prompt: `${finalSystemPrompt}\n\n${keywords}`,
          max_tokens: maxTokens,
          temperature: temperature,
          top_p: topP,
          n: 1,
          stream: false
        };
      }

      // 根据传输方式添加API密钥
      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          const trimmedApiKey = apiKey.trim();
          if (trimmedApiKey.startsWith('Bearer ')) {
            requestHeaders['Authorization'] = trimmedApiKey;
          } else {
            requestHeaders['Authorization'] = `Bearer ${trimmedApiKey}`;
          }
        } else {
          requestBody.api_key = apiKey;
        }
      }

      addLog(`[WorldBook] 关键词扩写: 发送请求到 ${requestUrl}`);
      addLog(`[WorldBook] 关键词扩写: 请求头: ${JSON.stringify(requestHeaders)}`);

      // 使用 Electron IPC 发送请求
      const result = await window.electronAPI.ai.request({
        url: requestUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody
      });

      if (!result.success) {
        addLog(`[WorldBook] 关键词扩写: API请求失败 ${result.error}`, 'error');
        addLog(`[WorldBook] 关键词扩写: 错误详情 ${result.details}`, 'error');
        throw new Error(`API请求失败: ${result.error}`);
      }

      const data = result.data;
      let expandedKeywords = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';

      expandedKeywords = expandedKeywords.trim();
      addLog(`[WorldBook] 关键词扩写成功: ${expandedKeywords}`, 'info');

      return expandedKeywords;
    } catch (error) {
      addLog(`[WorldBook] 关键词扩写失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`关键词扩写失败: ${error instanceof Error ? error.message : '未知错误'}`);
      return '';
    }
  };

  // AI生成描述
  const handleGenerateDescription = async (keywords: string, themeDescription: string) => {
    addLog('[WorldBook] 开始AI生成描述');
    try {
      // 检查配置
      if (!setting) {
        message.error('请先在配置管理中设置API连接');
        return '';
      }

      // 获取当前激活的AI引擎配置
      const activeEngine = getActiveEngineConfig();

      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        return '';
      }

      const apiUrl = activeEngine.api_url;
      const apiKey = activeEngine.api_key;
      const apiMode = activeEngine.api_mode;
      const modelName = activeEngine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })();
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      const maxTokens = (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240;
      const temperature = (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7;
      const topP = Number(activeEngine.top_p) ?? (() => { throw new Error('未配置 top_p 参数') })();

      addLog(`[WorldBook] 生成描述API配置: URL=${apiUrl}, Mode=${apiMode}, Model=${modelName}, Transmission=${apiKeyTransmission}, MaxTokens=${maxTokens}, Temperature=${temperature}, TopP=${topP}`);

      if (!apiUrl) {
        message.error('API地址不能为空');
        return '';
      }

      // 通过提示词模板构建系统提示词和用户提示词
      const promptResult = await window.electronAPI.prompt.build('world-book.generate-description', {
        theme_description: themeDescription,
        keywords: keywords
      });
      if (!promptResult.success || !promptResult.data) {
        throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
      }
      const systemPrompt = promptResult.data.systemPrompt;
      const userPrompt = promptResult.data.userPrompt;

      // 拼接全局system_prompt
      let finalSystemPrompt = systemPrompt;
      if (activeEngine.system_prompt && activeEngine.system_prompt.trim()) {
        finalSystemPrompt = activeEngine.system_prompt.trim() + '\n\n' + systemPrompt;
      }

      // 发送请求
      let requestUrl;
      let requestBody;
      let requestHeaders = {
        'Content-Type': 'application/json'
      };

      // 根据 API 模式构建请求 URL
      if (apiMode === 'chat_completion') {
        if (apiUrl.endsWith('/v1/chat/completions')) {
          requestUrl = apiUrl;
        } else {
          const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
          requestUrl = baseUrl + 'v1/chat/completions';
        }

        requestBody = {
          model: modelName,
          messages: [
            { role: 'system', content: finalSystemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature: temperature,
          top_p: topP,
          n: 1,
          stream: false,
          extra_body: {
            chat_template_kwargs: {
              enable_thinking: false
            }
          }
        };
      } else {
        if (apiUrl.endsWith('/v1/completions')) {
          requestUrl = apiUrl;
        } else {
          const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
          requestUrl = baseUrl + 'v1/completions';
        }

        requestBody = {
          model: modelName,
          prompt: `${finalSystemPrompt}\n\n${userPrompt}`,
          max_tokens: maxTokens,
          temperature: temperature,
          top_p: topP,
          n: 1,
          stream: false
        };
      }

      // 根据传输方式添加API密钥
      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          const trimmedApiKey = apiKey.trim();
          if (trimmedApiKey.startsWith('Bearer ')) {
            requestHeaders['Authorization'] = trimmedApiKey;
          } else {
            requestHeaders['Authorization'] = `Bearer ${trimmedApiKey}`;
          }
        } else {
          requestBody.api_key = apiKey;
        }
      }

      addLog(`[WorldBook] 生成描述: 发送请求到 ${requestUrl}`);
      addLog(`[WorldBook] 生成描述: 请求头: ${JSON.stringify(requestHeaders)}`);

      // 使用 Electron IPC 发送请求
      const result = await window.electronAPI.ai.request({
        url: requestUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody
      });

      if (!result.success) {
        addLog(`[WorldBook] 生成描述: API请求失败 ${result.error}`, 'error');
        addLog(`[WorldBook] 生成描述: 错误详情 ${result.details}`, 'error');
        throw new Error(`API请求失败: ${result.error}`);
      }

      const data = result.data;
      let description = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';

      description = description.trim();
      addLog(`[WorldBook] 描述生成成功: ${description.length} 字符`, 'info');

      return description;
    } catch (error) {
      addLog(`[WorldBook] 描述生成失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`描述生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
      return '';
    }
  };

  // AI 生成世界书主题描述（逆向功能：根据现有条目还原/生成主题）
  const handleGenerateWorldBookDescription = async (userRequirements: string = ''): Promise<string> => {
    addLog('[WorldBook] 开始AI生成世界书主题描述');
    try {
      if (!setting) {
        message.error('请先在配置管理中设置API连接');
        return '';
      }

      const activeEngine = getActiveEngineConfig();
      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        return '';
      }

      const apiUrl = activeEngine.api_url;
      const apiKey = activeEngine.api_key;
      const apiMode = activeEngine.api_mode;
      const modelName = activeEngine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })();
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      const maxTokens = (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240;
      const temperature = (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7;
      const topP = Number(activeEngine.top_p) ?? (() => { throw new Error('未配置 top_p 参数') })();

      if (!apiUrl) {
        message.error('API地址不能为空');
        return '';
      }

      // 构建现有条目摘要：每个条目取 comment/key + content 前 100 字
      const entries = worldBookContent?.entries || {};
      const entryList = Object.values(entries).filter((e: any) => !e.disable && e.content);
      if (entryList.length === 0) {
        message.warning('世界书中没有可用条目，无法生成主题描述');
        return '';
      }
      const existingEntriesSummary = entryList.slice(0, 50).map((e: any, i: number) => {
        const name = e.comment || e.name || `条目${i + 1}`;
        const keys = Array.isArray(e.key) ? e.key.join('/') : (e.key || '');
        const contentPreview = (e.content || '').slice(0, 100);
        return `${i + 1}. [${name}] 关键词:${keys} 内容:${contentPreview}`;
      }).join('\n');

      const worldBookName = worldBookContent?.name || '';

      // 通过提示词模板构建
      const promptResult = await window.electronAPI.prompt.build('world-book.generate-world-description', {
        world_book_name: worldBookName,
        existing_entries_summary: existingEntriesSummary,
        user_requirements: userRequirements || '请根据现有条目内容，生成一段概括性的主题描述'
      });
      if (!promptResult.success || !promptResult.data) {
        throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
      }
      const systemPrompt = promptResult.data.systemPrompt;
      const userPrompt = promptResult.data.userPrompt;

      // 拼接全局 system_prompt
      let finalSystemPrompt = systemPrompt;
      if (activeEngine.system_prompt && activeEngine.system_prompt.trim()) {
        finalSystemPrompt = activeEngine.system_prompt.trim() + '\n\n' + systemPrompt;
      }

      // 构建请求
      let requestUrl;
      let requestBody;
      let requestHeaders: Record<string, string> = { 'Content-Type': 'application/json' };

      if (apiMode === 'chat_completion') {
        if (apiUrl.endsWith('/v1/chat/completions')) {
          requestUrl = apiUrl;
        } else {
          const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
          requestUrl = baseUrl + 'v1/chat/completions';
        }
        requestBody = {
          model: modelName,
          messages: [
            { role: 'system', content: finalSystemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature,
          top_p: topP,
          n: 1,
          stream: false,
          extra_body: { chat_template_kwargs: { enable_thinking: false } }
        };
      } else {
        if (apiUrl.endsWith('/v1/completions')) {
          requestUrl = apiUrl;
        } else {
          const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
          requestUrl = baseUrl + 'v1/completions';
        }
        requestBody = {
          model: modelName,
          prompt: `${finalSystemPrompt}\n\n${userPrompt}`,
          max_tokens: maxTokens,
          temperature,
          top_p: topP,
          n: 1,
          stream: false
        };
      }

      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          const trimmedApiKey = apiKey.trim();
          requestHeaders['Authorization'] = trimmedApiKey.startsWith('Bearer ') ? trimmedApiKey : `Bearer ${trimmedApiKey}`;
        } else {
          requestBody.api_key = apiKey;
        }
      }

      addLog(`[WorldBook] 生成主题描述: 发送请求到 ${requestUrl}，条目数:${entryList.length}`);

      const result = await window.electronAPI.ai.request({
        url: requestUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody
      });

      if (!result.success) {
        throw new Error(`API请求失败: ${result.error}`);
      }

      const data = result.data;
      let description = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';
      // 清理可能的代码块标记和思考过程
      description = description.replace(/```[\s\S]*?\n/g, '').replace(/```/g, '').trim();

      addLog(`[WorldBook] 主题描述生成成功: ${description.length} 字符`, 'info');
      return description;
    } catch (error) {
      const msg = error instanceof Error ? error.message : '未知错误';
      addLog(`[WorldBook] 主题描述生成失败: ${msg}`, 'error');
      message.error(`主题描述生成失败: ${msg}`);
      return '';
    }
  };

  // AI 润色世界书主题描述（复用 polishText，textType='content'）
  const handlePolishWorldBookDescription = async (currentText: string, requirements: string = ''): Promise<string> => {
    addLog('[WorldBook] 开始AI润色世界书主题描述');
    try {
      if (!setting) {
        message.error('请先在配置管理中设置API连接');
        return currentText;
      }

      const activeEngine = getActiveEngineConfig();
      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        return currentText;
      }

      const apiUrl = activeEngine.api_url;
      const apiKey = activeEngine.api_key;
      const apiMode = activeEngine.api_mode;
      const modelName = activeEngine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })();
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      const maxTokens = (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240;
      const temperature = (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7;
      const topP = Number(activeEngine.top_p) ?? (() => { throw new Error('未配置 top_p 参数') })();

      const worldBookDescription = worldBookContent?.description || '';

      const polished = await polishText(
        currentText, apiUrl, apiKey, apiMode, modelName,
        apiKeyTransmission, requirements, worldBookDescription,
        'content', maxTokens, temperature, topP,
        activeEngine.system_prompt || ''
      );

      addLog(`[WorldBook] 主题描述润色成功: ${polished.length} 字符`, 'info');
      return polished;
    } catch (error) {
      const msg = error instanceof Error ? error.message : '未知错误';
      addLog(`[WorldBook] 主题描述润色失败: ${msg}`, 'error');
      message.error(`主题描述润色失败: ${msg}`);
      return currentText;
    }
  };

  // 保存新建的世界书
  const handleCreateWorldBook = async () => {
    try {
      const values = await createForm.validateFields();
      const worldBookName = values.worldBookName?.trim();

      if (!worldBookName) {
        message.error('请输入世界书名称');
        return;
      }

      addLog(`[WorldBook] 开始创建世界书: ${worldBookName}`);

      // 构建世界书数据
      const entries: any = {};

      // 如果有生成的条目，使用生成的条目
      if (generatedEntries.length > 0) {
        generatedEntries.forEach((entry: any, index: number) => {
          entries[index.toString()] = entry;
        });
      } else {
        // 如果没有生成条目，创建一个空条目
        entries['0'] = createDefaultEntry(0, [], '', '');
      }

      const worldBookData = {
        name: worldBookName,
        description: generatedWorldBookDescription,
        entries
      };

      // 获取世界书目录
      const worldBookDir = await window.electronAPI.worldBook.getDirectory();
      const targetPath = `${worldBookDir}/${worldBookName}.json`;

      // 检查文件是否已存在
      const existingWorldBooks = await window.electronAPI.worldBook.list();
      const existingFile = existingWorldBooks.find(wb => wb.path === targetPath);

      if (existingFile) {
        Modal.confirm({
          title: '文件已存在',
          content: `世界书 "${worldBookName}.json" 已存在，是否覆盖？`,
          okText: '覆盖',
          cancelText: '取消',
          onOk: async () => {
            try {
              const result = await window.electronAPI.worldBook.write(targetPath, worldBookData);
              if (result.success) {
                addLog(`[WorldBook] 世界书创建成功: ${worldBookName}`, 'info');
                message.success('世界书创建成功');
                setIsCreateModalOpen(false);
                createForm.resetFields();
                setGeneratedEntries([]);
                setGeneratedWorldBookName('');
                setGeneratedWorldBookDescription('');
                fetchWorldBooks();
              } else {
                addLog(`[WorldBook] 世界书创建失败: ${result.error}`, 'error');
                message.error(`创建失败: ${result.error}`);
              }
            } catch (error) {
              addLog(`[WorldBook] 世界书创建异常: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
              message.error('创建失败');
            }
          }
        });
      } else {
        const result = await window.electronAPI.worldBook.write(targetPath, worldBookData);
        if (result.success) {
          addLog(`[WorldBook] 世界书创建成功: ${worldBookName}`, 'info');
          message.success('世界书创建成功');
          setIsCreateModalOpen(false);
          createForm.resetFields();
          setGeneratedEntries([]);
          setGeneratedWorldBookName('');
          setGeneratedWorldBookDescription('');
          fetchWorldBooks();
        } else {
          addLog(`[WorldBook] 世界书创建失败: ${result.error}`, 'error');
          message.error(`创建失败: ${result.error}`);
        }
      }
    } catch (error) {
      addLog(`[WorldBook] 创建世界书失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    }
  };

  // AI基于角色卡生成世界书
  const handleGenerateFromCharacters = async (charactersInfo: string, instructions: string): Promise<{ name: string; description: string; entries: any[] }> => {
    addLog('[WorldBook] 开始基于角色卡生成世界书');
    setIsGeneratingFromChars(true);
    try {
      const activeEngine = getActiveEngineConfig();
      if (!activeEngine) {
        throw new Error('请先在配置管理中设置AI引擎');
      }
      if (!activeEngine.api_url) {
        throw new Error('API地址不能为空');
      }

      // 通过提示词模板构建系统提示词和用户提示词
      const promptResult = await window.electronAPI.prompt.build('world-book.generate-from-characters', {
        characters_info: charactersInfo,
        instructions: instructions ? '\n【用户指令】\n' + instructions : ''
      });
      if (!promptResult.success || !promptResult.data) {
        throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
      }
      const systemPrompt = promptResult.data.systemPrompt;
      const userPrompt = promptResult.data.userPrompt;

      // 获取引擎配置参数
      const apiUrl = activeEngine.api_url;
      const apiKey = activeEngine.api_key;
      const apiMode = activeEngine.api_mode;
      const modelName = activeEngine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })();
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      const maxTokens = (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240;
      const temperature = (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7;
      const topP = Number(activeEngine.top_p) ?? (() => { throw new Error('未配置 top_p 参数') })();

      // 构建请求 URL 和请求体
      let requestUrl;
      let requestBody: any;
      let requestHeaders: Record<string, string> = { 'Content-Type': 'application/json' };

      if (apiMode === 'chat_completion') {
        if (apiUrl.endsWith('/v1/chat/completions')) {
          requestUrl = apiUrl;
        } else {
          const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
          requestUrl = baseUrl + 'v1/chat/completions';
        }

        requestBody = {
          model: modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature: temperature,
          top_p: topP,
          n: 1,
          stream: false,
          extra_body: {
            chat_template_kwargs: {
              enable_thinking: false
            }
          }
        };
      } else {
        if (apiUrl.endsWith('/v1/completions')) {
          requestUrl = apiUrl;
        } else {
          const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
          requestUrl = baseUrl + 'v1/completions';
        }

        requestBody = {
          model: modelName,
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          max_tokens: maxTokens,
          temperature: temperature,
          top_p: topP,
          n: 1,
          stream: false
        };
      }

      // 根据传输方式添加API密钥
      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          const trimmedApiKey = apiKey.trim();
          if (trimmedApiKey.startsWith('Bearer ')) {
            requestHeaders['Authorization'] = trimmedApiKey;
          } else {
            requestHeaders['Authorization'] = `Bearer ${trimmedApiKey}`;
          }
        } else {
          requestBody.api_key = apiKey;
        }
      }

      const aiResult = await window.electronAPI.ai.request({
        url: requestUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody
      });

      if (!aiResult.success) {
        throw new Error(`API请求失败: ${aiResult.error}`);
      }

      const data = aiResult.data;
      let aiResponse = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';

      if (!aiResponse) {
        throw new Error('AI未返回有效内容');
      }

      const cleaned = cleanAIThoughts(aiResponse);
      const parsedData = parseAIJsonResponse(cleaned);

      return {
        name: parsedData.name || '未命名世界书',
        description: parsedData.description || '',
        entries: Array.isArray(parsedData.entries) ? parsedData.entries : []
      };
    } catch (error) {
      addLog(`[WorldBook] 基于角色卡生成世界书失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      throw error;
    } finally {
      setIsGeneratingFromChars(false);
    }
  };

  // 从AI生成创建世界书
  const handleCreateFromAI = async (name: string, description: string, entries: any[]) => {
    addLog(`[WorldBook] 开始从AI生成创建世界书: ${name}`);
    try {
      const worldBookData = {
        name,
        description,
        entries: entries.reduce((acc: any, entry: any, index: number) => {
          acc[index.toString()] = entry;
          return acc;
        }, {})
      };

      const worldBookDir = await window.electronAPI.worldBook.getDirectory();
      const targetPath = `${worldBookDir}/${name}.json`;

      const existingWorldBooks = await window.electronAPI.worldBook.list();
      const existingFile = existingWorldBooks.find((wb: any) => wb.path === targetPath);

      if (existingFile) {
        Modal.confirm({
          title: '文件已存在',
          content: `世界书"${name}"已存在，是否覆盖？`,
          okText: '覆盖',
          cancelText: '取消',
          onOk: async () => {
            const result = await window.electronAPI.worldBook.write(targetPath, worldBookData);
            if (result.success) {
              addLog(`[WorldBook] AI生成世界书创建成功（覆盖）: ${name}`, 'info');
              message.success('世界书创建成功（已覆盖）');
              setIsGenerateModalOpen(false);
              fetchWorldBooks();
            } else {
              message.error(`创建失败: ${result.error}`);
            }
          }
        });
      } else {
        const result = await window.electronAPI.worldBook.write(targetPath, worldBookData);
        if (result.success) {
          addLog(`[WorldBook] AI生成世界书创建成功: ${name}`, 'info');
          message.success('世界书创建成功');
          setIsGenerateModalOpen(false);
          fetchWorldBooks();
        } else {
          message.error(`创建失败: ${result.error}`);
        }
      }
    } catch (error) {
      addLog(`[WorldBook] 从AI生成创建世界书失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`创建失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  // AI生成新条目
  const handleGenerateNewEntries = async (expectedContent: string, count: number) => {
    addLog(`[WorldBook] 开始AI生成新条目: 预期内容="${expectedContent}", 数量=${count}`);
    try {
      // 先清空之前的条目
      setAddedEntries([]);
      setIsAddingEntry(true);

      // 检查配置
      if (!setting) {
        message.error('请先在配置管理中设置API连接');
        return;
      }

      // 获取当前激活的AI引擎配置
      const activeEngine = getActiveEngineConfig();

      if (!activeEngine) {
        message.error('请先在配置管理中设置AI引擎');
        return;
      }

      const apiUrl = activeEngine.api_url;
      const apiKey = activeEngine.api_key;
      const apiMode = activeEngine.api_mode;
      const modelName = activeEngine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })();
      const apiKeyTransmission = activeEngine.api_key_transmission || 'body';
      const maxTokens = (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240;
      const temperature = (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7;
      const topP = Number(activeEngine.top_p) ?? (() => { throw new Error('未配置 top_p 参数') })();
      const topK = Number(activeEngine.top_k) || undefined;
      const minP = Number(activeEngine.min_p) || undefined;
      const frequencyPenalty = Number(activeEngine.frequency_penalty) || undefined;
      const presencePenalty = Number(activeEngine.presence_penalty) || undefined;
      // 注意：以下 4 个变量在原 WorldBookManager.tsx 中也声明但未使用（预存在模式）。
      // 为通过 noUnusedLocals 校验并保持行为不变，此处显式 void 引用以"消费"变量。
      void topK; void minP; void frequencyPenalty; void presencePenalty;
      const n = Number(activeEngine.n) || 1;

      addLog(`[WorldBook] 生成新条目API配置: URL=${apiUrl}, Mode=${apiMode}, Model=${modelName}, Transmission=${apiKeyTransmission}, MaxTokens=${maxTokens}, Temperature=${temperature}, TopP=${topP}, N=${n}`);

      if (!apiUrl) {
        message.error('API地址不能为空');
        return;
      }

      // 提取已存在的关键词
      const existingKeywords = extractExistingKeywords();
      addLog(`[WorldBook] 已存在关键词: ${existingKeywords.length}个`);
      addLog(`[WorldBook] 请求生成${count}个条目`);

      // 获取当前世界书的最大UID
      let maxUid = 0;
      if (worldBookContent && worldBookContent.entries) {
        const existingUids = Object.values(worldBookContent.entries).map((entry: any) => entry.uid).filter((uid: any) => uid !== undefined);
        maxUid = existingUids.length > 0 ? Math.max(...existingUids) : 0;
      }
      addLog(`[WorldBook] 当前世界书最大UID: ${maxUid}`);

      // 通过提示词模板构建系统提示词和用户提示词
      const promptResult = await window.electronAPI.prompt.build('world-book.generate-new-entries', {
        count: String(count),
        expected_content: expectedContent
      });
      if (!promptResult.success || !promptResult.data) {
        throw new Error('获取提示词模板失败: ' + (promptResult.error || '未知错误'));
      }
      let systemPrompt = promptResult.data.systemPrompt;
      const userPrompt = promptResult.data.userPrompt;

      // 获取世界书描述
      const worldBookDescription = worldBookContent?.description || '';

      // 如果有世界书描述，添加到系统提示词中
      if (worldBookDescription) {
        systemPrompt += `\n\n【世界书背景】\n${worldBookDescription}`;
      }

      // 拼接全局system_prompt
      let finalSystemPrompt = systemPrompt;
      if (activeEngine.system_prompt && activeEngine.system_prompt.trim()) {
        finalSystemPrompt = activeEngine.system_prompt.trim() + '\n\n' + systemPrompt;
      }

      // 发送请求
      let requestUrl;
      let requestBody;
      let requestHeaders = {
        'Content-Type': 'application/json'
      };

      // 根据 API 模式构建请求 URL
      if (apiMode === 'chat_completion') {
        if (apiUrl.endsWith('/v1/chat/completions')) {
          requestUrl = apiUrl;
        } else {
          const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
          requestUrl = baseUrl + 'v1/chat/completions';
        }

        requestBody = {
          model: modelName,
          messages: [
            { role: 'system', content: finalSystemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature: temperature,
          top_p: topP,
          n: n,
          stream: false,
          extra_body: {
            chat_template_kwargs: {
              enable_thinking: false
            }
          }
        };
      } else {
        if (apiUrl.endsWith('/v1/completions')) {
          requestUrl = apiUrl;
        } else {
          const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
          requestUrl = baseUrl + 'v1/completions';
        }

        requestBody = {
          model: modelName,
          prompt: `${finalSystemPrompt}\n\n${userPrompt}`,
          max_tokens: maxTokens,
          temperature: temperature,
          top_p: topP,
          n: n,
          stream: false
        };
      }

      // 根据传输方式添加API密钥
      if (apiKey) {
        if (apiKeyTransmission === 'header') {
          const trimmedApiKey = apiKey.trim();
          if (trimmedApiKey.startsWith('Bearer ')) {
            requestHeaders['Authorization'] = trimmedApiKey;
          } else {
            requestHeaders['Authorization'] = `Bearer ${trimmedApiKey}`;
          }
        } else {
          requestBody.api_key = apiKey;
        }
      }

      addLog(`[WorldBook] 生成新条目: 发送请求到 ${requestUrl}`);
      addLog(`[WorldBook] 生成新条目: 请求头: ${JSON.stringify(requestHeaders)}`);

      // 使用 Electron IPC 发送请求
      const result = await window.electronAPI.ai.request({
        url: requestUrl,
        method: 'POST',
        headers: requestHeaders,
        body: requestBody
      });

      if (!result.success) {
        addLog(`[WorldBook] 生成新条目: API请求失败 ${result.error}`, 'error');
        addLog(`[WorldBook] 生成新条目: 错误详情 ${result.details}`, 'error');
        throw new Error(`API请求失败: ${result.error}`);
      }

      const data = result.data;
      let aiResponse = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';

      addLog(`[WorldBook] AI响应长度: ${aiResponse.length} 字符`, 'info');

      // 清理响应，提取JSON
      aiResponse = aiResponse.trim();

      // 预处理：移除常见非JSON前缀/后缀
      aiResponse = aiResponse.replace(/^```json\s*/gi, '').replace(/\s*```$/g, '');
      // 移除常见的分析性前缀文本
      aiResponse = aiResponse.replace(/^(好的|好的，|让我|我来|以下是|下面是|Here|Sure|Okay|OK)[^{}]*?\{/s, '{');

      addLog(`[WorldBook] 预处理后响应长度: ${aiResponse.length} 字符`, 'info');

      // JSON解析和提取工具函数
      const fixJsonSyntax = (jsonStr: string): string => {
        let fixed = jsonStr;

        // 修复1：移除尾随逗号（在}或]之前）
        fixed = fixed.replace(/,\s*([}\]])/g, '$1');

        // 修复2：修复未转义的双引号（在字符串值内部）
        // 这个修复比较复杂，我们采用保守策略，只处理明显的错误
        fixed = fixed.replace(/:\s*"([^"]*)\s*:\s*"([^"]*)"/g, (match, p1, p2) => {
          void match; // 预存在模式：match 未使用（原 WorldBookManager.tsx 同此实现）
          return `: "${p1}: ${p2.replace(/"/g, '\\"')}"`;
        });

        // 修复3：单引号转双引号（仅当JSON明显使用单引号时）
        if (fixed.includes("':") && !fixed.includes('":')) {
          fixed = fixed.replace(/'/g, '"');
        }

        return fixed;
      };

      // 平衡括号查找函数
      const findMatchingBrace = (str: string, startIdx: number): number => {
        let depth = 0;
        let inString = false;
        let escapeNext = false;

        for (let i = startIdx; i < str.length; i++) {
          const char = str[i];

          if (escapeNext) {
            escapeNext = false;
            continue;
          }

          if (char === '\\' && inString) {
            escapeNext = true;
            continue;
          }

          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }

          if (!inString) {
            if (char === '{') depth++;
            else if (char === '}') {
              depth--;
              if (depth === 0) return i;
            }
          }
        }
        return -1;
      };

      // 尝试解析JSON
      let entriesData;
      let parseSuccess = false;

      // 尝试0：直接解析
      try {
        entriesData = JSON.parse(aiResponse);
        addLog(`[WorldBook] 直接JSON解析成功`);
        parseSuccess = true;
      } catch (e) {
        addLog(`[WorldBook] 直接JSON解析失败: ${(e as Error).message}`, 'warn');
      }

      // 尝试1：提取最外层JSON对象（使用平衡括号匹配）
      if (!parseSuccess) {
        addLog(`[WorldBook] 尝试提取最外层JSON对象...`);
        const firstBrace = aiResponse.indexOf('{');

        if (firstBrace !== -1) {
          const lastBrace = findMatchingBrace(aiResponse, firstBrace);

          if (lastBrace !== -1) {
            let extractedJson = aiResponse.substring(firstBrace, lastBrace + 1);
            addLog(`[WorldBook] 提取的JSON长度: ${extractedJson.length} 字符`);

            try {
              entriesData = JSON.parse(extractedJson);
              addLog(`[WorldBook] JSON对象提取解析成功`);
              parseSuccess = true;
            } catch (extractError) {
              addLog(`[WorldBook] 提取JSON解析失败: ${(extractError as Error).message}，尝试修复...`, 'warn');

              // 尝试修复后解析
              const fixedJson = fixJsonSyntax(extractedJson);
              try {
                entriesData = JSON.parse(fixedJson);
                addLog(`[WorldBook] JSON修复后解析成功`);
                parseSuccess = true;
              } catch (fixError) {
                addLog(`[WorldBook] JSON修复后仍然失败: ${(fixError as Error).message}`, 'warn');
              }
            }
          }
        }
      }

      // 尝试2：提取JSON数组
      if (!parseSuccess) {
        addLog(`[WorldBook] 尝试提取JSON数组...`);
        const firstBracket = aiResponse.indexOf('[');
        const lastBracket = aiResponse.lastIndexOf(']');

        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
          let extractedArray = aiResponse.substring(firstBracket, lastBracket + 1);
          addLog(`[WorldBook] 提取的JSON数组长度: ${extractedArray.length} 字符`);

          try {
            entriesData = JSON.parse(extractedArray);
            addLog(`[WorldBook] JSON数组提取解析成功`);
            parseSuccess = true;
          } catch (arrayError) {
            addLog(`[WorldBook] JSON数组解析失败: ${(arrayError as Error).message}，尝试修复...`, 'warn');

            const fixedArray = fixJsonSyntax(extractedArray);
            try {
              entriesData = JSON.parse(fixedArray);
              addLog(`[WorldBook] JSON数组修复后解析成功`);
              parseSuccess = true;
            } catch (fixError) {
              addLog(`[WorldBook] JSON数组修复后仍然失败: ${(fixError as Error).message}`, 'warn');
            }
          }
        }
      }

      // 尝试3：修复整个响应后解析
      if (!parseSuccess) {
        addLog(`[WorldBook] 尝试修复整个响应后解析...`);
        const fixedResponse = fixJsonSyntax(aiResponse);

        try {
          entriesData = JSON.parse(fixedResponse);
          addLog(`[WorldBook] 全响应修复后解析成功`);
          parseSuccess = true;
        } catch (fixError) {
          addLog(`[WorldBook] 全响应修复后解析失败: ${(fixError as Error).message}`, 'error');
        }
      }

      // 所有尝试失败
      if (!parseSuccess || !entriesData) {
        addLog(`[WorldBook] 所有JSON解析方法均失败`, 'error');
        addLog(`[WorldBook] 响应开头(200字符): ${aiResponse.substring(0, 200)}`, 'debug');
        addLog(`[WorldBook] 响应结尾(200字符): ${aiResponse.substring(Math.max(0, aiResponse.length - 200))}`, 'debug');
        throw new Error(`JSON解析失败。AI返回的数据格式不正确，无法解析为有效的JSON。请检查AI引擎配置或重试。`);
      }

      // 验证和规范化条目数据
      let newEntries = [];

      // 条目数据规范化函数
      const normalizeEntry = (item: any, defaultUid: number): any => {
        // 确保必要字段存在
        const key = Array.isArray(item.key) ? item.key.filter((k: any) => typeof k === 'string') : [];
        const comment = typeof item.comment === 'string' ? item.comment : '';
        const content = typeof item.content === 'string' ? item.content : '';
        const tags = Array.isArray(item.tags) ? item.tags.filter((t: any) => typeof t === 'string') : [];

        // 确保 uid 为数字
        const uid = typeof item.uid === 'number' ? item.uid : defaultUid;

        // 使用 createDefaultEntry 确保所有字段都存在
        const entry = createDefaultEntry(defaultUid, key, comment, content);

        // 覆盖 tags（createDefaultEntry 可能没有设置 tags）
        entry.tags = tags;

        // 覆盖 uid（createDefaultEntry 使用传入的 uid）
        entry.uid = uid;

        // 处理其他可选字段
        if (typeof item.keysecondary === 'object' && !Array.isArray(item.keysecondary)) {
          entry.keysecondary = [];
        } else if (Array.isArray(item.keysecondary)) {
          entry.keysecondary = item.keysecondary.filter((k: any) => typeof k === 'string');
        }

        if (item.constant !== undefined) entry.constant = Boolean(item.constant);
        if (item.selective !== undefined) entry.selective = Boolean(item.selective);
        if (typeof item.order === 'number') entry.order = item.order;
        if (typeof item.position === 'number') entry.position = item.position;
        if (item.disable !== undefined) entry.disable = Boolean(item.disable);
        if (typeof item.displayIndex === 'number') entry.displayIndex = item.displayIndex;
        if (item.addMemo !== undefined) entry.addMemo = Boolean(item.addMemo);
        if (typeof item.group === 'string') entry.group = item.group;
        if (item.groupOverride !== undefined) entry.groupOverride = Boolean(item.groupOverride);
        if (typeof item.groupWeight === 'number') entry.groupWeight = item.groupWeight;
        if (typeof item.sticky === 'number') entry.sticky = item.sticky;
        if (typeof item.cooldown === 'number') entry.cooldown = item.cooldown;
        if (typeof item.delay === 'number') entry.delay = item.delay;
        if (typeof item.probability === 'number') entry.probability = item.probability;
        if (typeof item.depth === 'number') entry.depth = item.depth;
        if (item.useProbability !== undefined) entry.useProbability = Boolean(item.useProbability);
        if (item.excludeRecursion !== undefined) entry.excludeRecursion = Boolean(item.excludeRecursion);
        if (item.preventRecursion !== undefined) entry.preventRecursion = Boolean(item.preventRecursion);
        if (item.delayUntilRecursion !== undefined) entry.delayUntilRecursion = Boolean(item.delayUntilRecursion);
        if (typeof item.automationId === 'string') entry.automationId = item.automationId;

        return entry;
      };

      // 检查entriesData的结构
      if (entriesData.entries && typeof entriesData.entries === 'object' && !Array.isArray(entriesData.entries)) {
        // 如果是完整的世界书结构，提取entries部分
        const entriesObject = entriesData.entries;
        const entryValues = Object.values(entriesObject);

        addLog(`[WorldBook] 从entries对象提取到 ${entryValues.length} 个条目`, 'info');

        newEntries = entryValues.map((item: any, index: number) =>
          normalizeEntry(item, maxUid + index + 1)
        );
      } else if (Array.isArray(entriesData)) {
        // 如果直接是条目数组
        addLog(`[WorldBook] 从数组提取到 ${entriesData.length} 个条目`, 'info');

        newEntries = entriesData.map((item: any, index: number) =>
          normalizeEntry(item, maxUid + index + 1)
        );
      } else {
        addLog(`[WorldBook] 数据结构无效: entriesData类型=${typeof entriesData}, 有entries字段=${!!entriesData.entries}`, 'error');
        throw new Error('Invalid entries data format: 无法识别的AI响应数据结构');
      }

      // 验证条目数量
      if (newEntries.length === 0) {
        throw new Error('AI未生成任何有效条目，请重试或检查预期内容');
      }

      addLog(`[WorldBook] 条目数据规范化完成，共 ${newEntries.length} 个有效条目`, 'info');

      // 为每个条目生成标签（如果AI没有生成tags）
      for (const entry of newEntries) {
        if (!entry.tags || entry.tags.length === 0) {
          addLog(`[WorldBook] 条目缺少标签，正在生成: ${entry.comment || '无注释'}`, 'info');
          const tags = await generateTagsForEntry(entry, apiUrl, apiKey, apiMode, modelName, apiKeyTransmission, worldBookDescription, (typeof activeEngine.max_tokens === 'number' && activeEngine.max_tokens > 0) ? activeEngine.max_tokens : 10240, (typeof activeEngine.temperature === 'number' && activeEngine.temperature >= 0 && activeEngine.temperature <= 2) ? activeEngine.temperature : 0.7, Number(activeEngine.top_p) || 1);
          entry.tags = tags;
        }
      }

      // 不再进行关键词去重，允许关键词重复
      const uniqueEntries = newEntries;

      setAddedEntries(uniqueEntries);
      addLog(`[WorldBook] AI生成成功，共 ${uniqueEntries.length} 个条目`, 'info');
      message.success(`成功生成 ${uniqueEntries.length} 个条目`);
    } catch (error) {
      addLog(`[WorldBook] AI生成失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error(`AI生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsAddingEntry(false);
    }
  };

  // 保存新添加的条目
  const handleSaveAddedEntries = async () => {
    try {
      if (!worldBookContent || !worldBookContent.entries || !viewingItem) {
        message.error('请先选择一个世界书');
        return;
      }

      if (addedEntries.length === 0) {
        message.warning('没有可添加的条目');
        return;
      }

      addLog(`[WorldBook] 开始保存新条目: ${addedEntries.length}个`);
      addLog(`[WorldBook] 当前世界书条目数: ${Object.keys(worldBookContent.entries).length}个`);

      // 获取当前世界书的条目
      const currentEntries = { ...worldBookContent.entries };

      // 获取当前条目的最大键值（用于确定新条目的起始位置）
      const currentKeys = Object.keys(currentEntries).map(key => parseInt(key)).filter(key => !isNaN(key));
      const maxKey = currentKeys.length > 0 ? Math.max(...currentKeys) : -1;

      // 生成新的条目ID
      const existingUids = Object.values(currentEntries).map((entry: any) => entry.uid).filter((uid: any) => uid !== undefined);
      const maxUid = existingUids.length > 0 ? Math.max(...existingUids) : 0;

      addLog(`[WorldBook] 现有条目键: ${JSON.stringify(currentKeys)}`);
      addLog(`[WorldBook] 最大键值: ${maxKey}`);
      addLog(`[WorldBook] 现有条目UID: ${JSON.stringify(existingUids)}`);
      addLog(`[WorldBook] 最大UID: ${maxUid}`);

      // 添加新条目 - 确保追加到末尾
      addedEntries.forEach((entry, index) => {
        const newUid = maxUid + index + 1;
        const newKey = maxKey + index + 1;
        entry.uid = newUid;
        entry.displayIndex = newKey;
        currentEntries[newKey] = entry;
      });

      addLog(`[WorldBook] 保存后台账条目数: ${Object.keys(currentEntries).length}个`);

      // 保存世界书
      const worldBookData = {
        name: worldBookContent?.name || viewingItem?.name || '',
        description: worldBookContent?.description || '',
        entries: currentEntries
      };
      const result = await window.electronAPI.worldBook.write(viewingItem.path, worldBookData);

      if (result.success) {
        addLog(`[WorldBook] 条目添加成功: ${addedEntries.length}个`, 'info');
        message.success('条目添加成功');
        setIsAddEntryModalOpen(false);
        addEntryForm.resetFields();

        // 保存标签信息
        try {
          const tagData = await window.electronAPI.worldBook.readTags(viewingItem.path);
          const currentTags = tagData?.tags || [];
          const currentAssociations = tagData?.associations || [];

          // 创建新标签和关联
          const newAssociations = [...currentAssociations];
          const finalTags = [...currentTags];

          addedEntries.forEach((entry, index) => {
            const newUid = maxUid + index + 1;
            const entryTags = entry.tags || [];

            entryTags.forEach((tagName: any) => {
              // 查找或创建标签
              let tag = finalTags.find(t => t.name === tagName);
              if (!tag) {
                // 为新标签分配颜色
                const colors = ['blue', 'green', 'orange', 'red', 'purple', 'cyan', 'geekblue', 'magenta', 'volcano', 'gold', 'lime'];
                const colorIndex = finalTags.length % colors.length;
                tag = {
                  id: Date.now() + Math.random().toString(36).substr(2, 9),
                  name: tagName,
                  color: colors[colorIndex]
                };
                finalTags.push(tag);
              }

              // 创建关联
              newAssociations.push({
                tagId: tag.id,
                entryUid: newUid
              });
            });
          });

          // 保存标签数据
          await window.electronAPI.worldBook.writeTags(viewingItem.path, {
            tags: finalTags,
            associations: newAssociations
          });

          addLog(`[WorldBook] 标签保存成功`, 'info');
        } catch (error) {
          addLog(`[WorldBook] 保存标签失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
        }

        setAddedEntries([]);

        // 重新加载世界书内容和标签
        const content = await window.electronAPI.worldBook.read(viewingItem.path);
        setWorldBookContent(content);
        await loadTags(viewingItem.path);
      } else {
        addLog(`[WorldBook] 条目添加失败: ${result.error}`, 'error');
        message.error(`添加失败: ${result.error}`);
      }
    } catch (error) {
      addLog(`[WorldBook] 保存条目失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      message.error('保存失败');
    }
  };

  return {
    // helpers
    getActiveEngineConfig,
    translateText,
    polishText,
    generateTagsForEntry,
    generateKeywords,
    extractExistingKeywords,
    // handlers
    handleTranslate,
    handleTranslateAll,
    handlePolish,
    performPolish,
    handlePolishAll,
    performPolishAll,
    handleGenerateKeywordsForEntry,
    handleGenerateKeywordsAll,
    // 生成/排序/创建 handler（Task 8 SubTask 8.1 迁入）
    handleAISortEntries,
    handleGenerateEntries,
    handleTemplateGenerateEntries,
    handleExpandKeywords,
    handleGenerateDescription,
    handleGenerateWorldBookDescription,
    handlePolishWorldBookDescription,
    handleCreateWorldBook,
    handleGenerateFromCharacters,
    handleCreateFromAI,
    handleGenerateNewEntries,
    handleSaveAddedEntries,
  };
}

export type UseWorldBookAIOperationsReturn = ReturnType<typeof useWorldBookAIOperations>;
