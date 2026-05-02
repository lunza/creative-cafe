import { useCallback } from 'react';
import { useSettingStore } from '../../../stores/settingStore';
import { useLogStore } from '../../../stores/logStore';
import { buildEngineApiUrl } from '../../../utils/apiUtils';
import { getTemplateById } from '../../../utils/promptTemplates';
import { ensurePositiveInteger } from '../../../utils/requestParamUtils';

interface CreativeAIRequestParams {
  creativeContent: string;
  type: 'character' | 'worldbook';
  templateId: string;
  userRequirements?: string;
  streaming?: boolean;
  onStream?: (chunk: string) => void;
  onStreamComplete?: (data: any) => void;
  customPrompt?: string;
}

interface CreativeAIResponse {
  success: boolean;
  data?: any;
  error?: string;
  details?: string;
}

interface UseCreativeAIReturn {
  generate: (params: CreativeAIRequestParams) => Promise<CreativeAIResponse>;
  optimize: (currentContent: string, userPrompt: string, chatHistory?: any[]) => Promise<CreativeAIResponse>;
  getActiveEngine: () => any;
  isEngineConfigured: boolean;
}

export const useCreativeAI = (): UseCreativeAIReturn => {
  const { setting } = useSettingStore();
  const { addLog } = useLogStore();

  const getActiveEngine = useCallback(() => {
    if (!setting) return null;

    if (setting.aiEngines && setting.activeEngineId) {
      const activeEngine = setting.aiEngines.find((engine: any) => engine.id === setting.activeEngineId);
      if (activeEngine) return activeEngine;
    }

    if (setting.aiEngines && setting.aiEngines.length > 0) {
      return setting.aiEngines[0];
    }

    return null;
  }, [setting]);

  const isEngineConfigured = useCallback(() => {
    const engine = getActiveEngine();
    return engine && engine.api_url;
  }, [getActiveEngine]);

  const buildRequestBody = useCallback((engine: any, messages: any[], customPrompt?: string) => {
    const apiMode = engine.api_mode || 'chat_completion';
    const modelName = engine.model_name || 'gpt-3.5-turbo';
    const apiKey = engine.api_key;
    const apiKeyTransmission = engine.api_key_transmission || 'body';

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    let requestBody: any;
    if (apiMode === 'chat_completion') {
      requestBody = {
        model: modelName,
        messages,
        max_tokens: ensurePositiveInteger(engine.max_tokens, 10240),
        temperature: Number(engine.temperature) || 0.7
      };
    } else {
      requestBody = {
        model: modelName,
        prompt: messages.map((m: any) => `${m.role}: ${m.content}`).join('\n\n'),
        max_tokens: ensurePositiveInteger(engine.max_tokens, 10240),
        temperature: Number(engine.temperature) || 0.7
      };
    }

    if (apiKey) {
      const trimmedApiKey = apiKey.trim();
      if (apiKeyTransmission === 'header') {
        requestHeaders['Authorization'] = trimmedApiKey.startsWith('Bearer ') ? trimmedApiKey : `Bearer ${trimmedApiKey}`;
      } else {
        requestBody.api_key = apiKey;
      }
    }

    return { requestHeaders, requestBody, apiUrl: buildEngineApiUrl(engine), apiMode };
  }, []);

  const sendRequest = useCallback(async (engine: any, messages: any[], customPrompt?: string, streaming = false) => {
    const { requestHeaders, requestBody, apiUrl, apiMode } = buildRequestBody(engine, messages, customPrompt);

    addLog('[CreativeAI] 发送请求', 'info', {
      category: 'creative',
      context: {
        engineId: engine.id,
        engineName: engine.name,
        apiUrl,
        apiMode,
        streaming
      }
    });

    const result = await window.electronAPI.ai.request({
      url: apiUrl,
      method: 'POST',
      headers: requestHeaders,
      body: requestBody,
      timeout: 600000,
      streaming
    });

    addLog('[CreativeAI] 请求完成', 'info', {
      category: 'creative',
      context: {
        success: result.success,
        error: result.error
      }
    });

    return result;
  }, [buildRequestBody, addLog]);

  const generate = useCallback(async (params: CreativeAIRequestParams): Promise<CreativeAIResponse> => {
    const engine = getActiveEngine();
    if (!engine || !engine.api_url) {
      return { success: false, error: 'AI引擎未配置' };
    }

    const { type, templateId, userRequirements, streaming, onStream, onStreamComplete, customPrompt } = params;

    let systemPrompt = '';
    let userPrompt = '';

    if (customPrompt) {
      userPrompt = customPrompt;
      systemPrompt = type === 'character'
        ? '你是一个专业的角色卡创建助手。'
        : '你是一个专业的世界书创建助手。';
    } else {
      // 使用模板系统构建提示词
      const template = getTemplateById(templateId);

      if (template) {
        // 使用模板的系统提示词和用户提示词构建逻辑
        systemPrompt = template.systemPrompt;

        // 组合创意内容和用户需求
        let creativeWithRequirements = params.creativeContent;
        if (userRequirements && userRequirements.trim()) {
          creativeWithRequirements = `${params.creativeContent}

【用户额外需求】
${userRequirements.trim()}`;
        }

        userPrompt = template.buildPrompt(creativeWithRequirements);
      } else {
        // 模板未找到，使用默认逻辑
        if (type === 'character') {
          systemPrompt = `你是一个专业的角色卡创建助手，正在为SillyTavern生成角色卡内容。
请根据用户提供的创意，生成详细、生动、符合要求的角色卡。`;
          let creativeWithRequirements = params.creativeContent;
          if (userRequirements && userRequirements.trim()) {
            creativeWithRequirements = `${params.creativeContent}

【用户额外需求】
${userRequirements.trim()}`;
          }
          userPrompt = `基于以下创意，生成一个详细的角色卡：

创意内容：${creativeWithRequirements}

请生成一个完整的角色卡，包括：
1. 角色名称
2. 角色描述
3. 角色背景
4. 角色性格
5. 角色能力
6. 角色关系
7. 其他相关信息

请确保生成的内容详细、生动、符合创意要求，使用Markdown格式。`;
        } else {
          systemPrompt = `你是一个专业的世界书创建助手，正在为SillyTavern生成世界书内容。
请根据用户提供的创意，生成详细、生动、完整的世界背景设定。`;
          let creativeWithRequirements = params.creativeContent;
          if (userRequirements && userRequirements.trim()) {
            creativeWithRequirements = `${params.creativeContent}

【用户额外需求】
${userRequirements.trim()}`;
          }
          userPrompt = `基于以下创意，生成一个详细的世界书：

创意内容：${creativeWithRequirements}

请生成一个完整的世界书，包括：
1. 世界名称
2. 世界概述
3. 地理环境
4. 主要势力
5. 重要地点
6. 历史事件
7. 文化习俗
8. 其他相关信息

请确保生成的内容详细、生动、符合创意要求，使用Markdown格式。`;
        }
      }
    }

    let removeStreamListener: (() => void) | null = null;
    let removeStreamCompleteListener: (() => void) | null = null;
    let tempContent = '';

    if (streaming) {
      // 节流更新：记录上次更新时间，避免过于频繁的 onStream 回调
      let lastUpdateTime = 0;
      const THROTTLE_INTERVAL = 100; // 每 100ms 最多触发一次 onStream
      let bufferedContent = '';

      const handleStream = (data: any) => {
        if (data?.chunk) {
          const lines = data.chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const content = line.substring(6);
              if (content === '[DONE]') continue;
              try {
                const json = JSON.parse(content);
                if (json.choices?.[0]?.delta?.content) {
                  tempContent += json.choices[0].delta.content;
                  bufferedContent += json.choices[0].delta.content;
                }
              } catch {
                // 忽略解析错误
              }
            }
          }

          // 节流触发 onStream：只有达到时间间隔才回调
          const now = Date.now();
          if (now - lastUpdateTime >= THROTTLE_INTERVAL && bufferedContent) {
            lastUpdateTime = now;
            onStream?.(bufferedContent);
            bufferedContent = '';
          }
        }
      };

      const handleStreamComplete = (data: any) => {
        // 先处理缓冲区中的剩余内容
        if (bufferedContent) {
          onStream?.(bufferedContent);
          bufferedContent = '';
        }

        let finalContent = tempContent;
        if (!finalContent && data?.data) {
          if (engine.api_mode === 'chat_completion' && data.data.choices?.[0]) {
            finalContent = data.data.choices[0].message?.content || '';
          } else if (engine.api_mode === 'text_completion' && data.data.choices?.[0]) {
            finalContent = data.data.choices[0].text || '';
          }
        }
        onStreamComplete?.({ content: finalContent, data: data.data });
      };

      removeStreamListener = window.electronAPI.on('ai:stream', handleStream);
      removeStreamCompleteListener = window.electronAPI.on('ai:stream:complete', handleStreamComplete);
    }

    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      const result = await sendRequest(engine, messages, undefined, streaming);

      if (result.success) {
        let generated = '';
        if (engine.api_mode === 'chat_completion' && result.data?.choices?.[0]) {
          generated = result.data.choices[0].message?.content || '';
        } else if (engine.api_mode === 'text_completion' && result.data?.choices?.[0]) {
          generated = result.data.choices[0].text || '';
        } else {
          generated = JSON.stringify(result.data);
        }

        return { success: true, data: { content: generated } };
      } else {
        return { success: false, error: result.error, details: result.details };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '生成失败';
      addLog('[CreativeAI] 生成失败', 'error', {
        category: 'creative',
        error: error instanceof Error ? error : undefined,
        details: errorMessage
      });
      return { success: false, error: errorMessage };
    } finally {
      if (removeStreamListener) {
        try { removeStreamListener(); } catch {}
      }
      if (removeStreamCompleteListener) {
        try { removeStreamCompleteListener(); } catch {}
      }
    }
  }, [getActiveEngine, sendRequest, addLog]);

  const optimize = useCallback(async (currentContent: string, userPrompt: string, chatHistory: any[] = []): Promise<CreativeAIResponse> => {
    const engine = getActiveEngine();
    if (!engine || !engine.api_url) {
      return { success: false, error: 'AI引擎未配置' };
    }

    const systemPrompt = `你是一个创意内容优化助手。请根据用户的要求，对以下内容进行优化：\n${currentContent}`;
    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory
    ];

    try {
      const result = await sendRequest(engine, messages, undefined, true);

      if (result.success) {
        let optimized = '';
        if (engine.api_mode === 'chat_completion' && result.data?.choices?.[0]) {
          optimized = result.data.choices[0].message?.content || '';
        } else if (engine.api_mode === 'text_completion' && result.data?.choices?.[0]) {
          optimized = result.data.choices[0].text || '';
        } else {
          optimized = JSON.stringify(result.data);
        }

        return { success: true, data: { content: optimized } };
      } else {
        return { success: false, error: result.error, details: result.details };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '优化失败';
      addLog('[CreativeAI] 优化失败', 'error', {
        category: 'creative',
        error: error instanceof Error ? error : undefined,
        details: errorMessage
      });
      return { success: false, error: errorMessage };
    }
  }, [getActiveEngine, sendRequest, addLog]);

  return {
    generate,
    optimize,
    getActiveEngine,
    isEngineConfigured: isEngineConfigured()
  };
};
