/**
 * AI 客户端
 * 负责：
 * - getEngineAIParams：获取 AI 引擎配置参数
 * - buildOrganizeConfig：整理流程的 AI 配置与 endpoint 拼装
 * - callAIAPI / callAIAPIWithRetry：调用 AI API（带重试）
 * - parseAIResponse / parseAIOperations：解析 AI 响应
 */

import { getStorageService } from '../storageService';
import { addLog, AIProcessingResult } from './logger';

/**
 * AI 引擎记录的最小结构（仅声明本模块实际访问的字段）。
 * storageService.getSettings() 返回 any，这里通过结构化类型约束对引擎字段的访问。
 */
interface AIEngineRecord {
  id: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

/**
 * AI 返回的表格操作指令最小结构（与 tableOperationExecutor.executeTableOperations 的解构一致）。
 */
export interface TableOperation {
  sheetName: string;
  operation: string;
  data?: Record<string, unknown>;
  condition?: Record<string, unknown>;
  description?: string;
}

/**
 * 整理流程的 AI 配置构造：合并用户传入 config 与默认值，
 * 并根据 apiMode 拼接出最终的 completions 端点。
 */
export function buildOrganizeConfig(
  config?: { apiKey: string; apiUrl: string; modelName: string; apiMode: string }
): { aiConfig: { apiKey: string; apiUrl: string; modelName: string; apiMode: string }; apiEndpoint: string } {
  const aiConfig = {
    apiKey: config?.apiKey || '',
    apiUrl: config?.apiUrl || 'http://127.0.0.1:5000',
    modelName: config?.modelName || (() => { throw new Error('未配置 AI 模型名称'); })(),
    apiMode: config?.apiMode || 'chat_completion'
  };

  let apiEndpoint = aiConfig.apiUrl;
  if (!apiEndpoint.endsWith('/v1/chat/completions')) {
    apiEndpoint += '/v1/chat/completions';
  }

  return { aiConfig, apiEndpoint };
}

/**
 * 获取 AI 引擎配置参数
 */
export function getEngineAIParams(): { temperature: number; max_tokens?: number; top_p: number; frequency_penalty: number; presence_penalty: number } | null {
  try {
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    const engines = settings?.aiEngines || [];
    if (engines.length > 0) {
      const activeEngine = engines.find((e: AIEngineRecord) => e.id === settings?.activeEngineId) as AIEngineRecord | undefined || (engines[0] as AIEngineRecord | undefined);

      if (activeEngine?.temperature !== undefined &&
          activeEngine?.max_tokens !== undefined &&
          activeEngine?.top_p !== undefined &&
          activeEngine?.frequency_penalty !== undefined &&
          activeEngine?.presence_penalty !== undefined) {
        return {
          temperature: activeEngine.temperature,
          max_tokens: undefined,
          top_p: activeEngine.top_p,
          frequency_penalty: activeEngine.frequency_penalty,
          presence_penalty: activeEngine.presence_penalty
        };
      }
    }
  } catch (error) {
    console.error('[chatLogService] getEngineAIParams error:', error);
  }
  return null;
}

/**
 * 调用 AI API
 *
 * 【多模态兼容性审计】本模块 callAIAPI 使用内联 { role, content: string } 构造 messages，
 * 不导入 AIService.ts 的联合类型 ChatMessage，不受多模态 content 扩展影响。
 * 所有消息 content 均为纯文本字符串，适用于记忆整理等非视觉任务。
 */
export async function callAIAPI(
  prompt: string,
  apiKey: string,
  apiUrl: string,
  modelName: string,
  signal?: AbortSignal,
  aiParams?: { temperature: number; max_tokens: number; top_p: number; frequency_penalty: number; presence_penalty: number }
): Promise<string> {
  addLog('调用 AI API', 'debug');
  addLog(`API 地址: ${apiUrl}`, 'debug');
  addLog(`模型名称: ${modelName}`, 'debug');
  addLog(`提示词长度: ${prompt.length} 字符`, 'debug');
  addLog('===== AI 请求入参 =====', 'debug');
  addLog(prompt, 'debug');

  if (!aiParams) {
    throw new Error('AI 引擎参数配置不完整，请在设置中配置 temperature、max_tokens 等参数');
  }

  try {
    const isChatCompletion = apiUrl.includes('/chat/completions');
    addLog(`API 模式: ${isChatCompletion ? '聊天补全' : '文本补全'}`, 'debug');

    let requestBody: Record<string, unknown>;
    if (isChatCompletion) {
      requestBody = {
        model: modelName,
        messages: [
          {
            role: "system",
            content: "你是一个专业的信息提取和表格整理助手，能够根据聊天记录和表格模板结构，准确提取关键信息并生成表格操作指令。"
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: aiParams.temperature,
        max_tokens: aiParams.max_tokens,
        top_p: aiParams.top_p,
        frequency_penalty: aiParams.frequency_penalty,
        presence_penalty: aiParams.presence_penalty
      };
    } else {
      requestBody = {
        model: modelName,
        prompt: prompt,
        temperature: aiParams.temperature,
        max_tokens: aiParams.max_tokens,
        top_p: aiParams.top_p,
        frequency_penalty: aiParams.frequency_penalty,
        presence_penalty: aiParams.presence_penalty
      };
    }

    addLog('发送 AI API 请求...', 'info');
    const trimmedApiKey = apiKey?.trim() || '';
    let authHeader: Record<string, string> = {};
    if (trimmedApiKey) {
      if (trimmedApiKey.startsWith('Bearer ')) {
        authHeader['Authorization'] = trimmedApiKey;
        addLog('API密钥已包含Bearer前缀，直接使用', 'debug');
      } else {
        authHeader['Authorization'] = `Bearer ${trimmedApiKey}`;
        addLog('API密钥不包含Bearer前缀，自动添加', 'debug');
      }
    }

    const timeoutSignal = AbortSignal.timeout(300000);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader
      },
      body: JSON.stringify(requestBody),
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      addLog(`API 调用失败: ${response.status} ${response.statusText}`, 'error');
      addLog(`错误详情: ${errorText}`, 'error');
      throw new Error(`API 调用失败: ${response.status} ${response.statusText} - ${errorText}`);
    }

    addLog('等待 AI API 响应...', 'info');
    const data = await response.json();
    addLog('收到 AI API 完整响应', 'debug');
    addLog('===== AI 完整响应对象 =====', 'debug');
    addLog(JSON.stringify(data, null, 2), 'debug');

    if (!data.choices || data.choices.length === 0) {
      throw new Error('API 响应格式错误: 没有返回 choices');
    }

    // 提取响应内容
    let aiResponse: string;
    if (isChatCompletion) {
      aiResponse = data.choices[0].message?.content?.trim() || '';
    } else {
      aiResponse = data.choices[0].text?.trim() || '';
    }

    // 验证响应内容
    if (!aiResponse) {
      throw new Error('AI 响应内容为空');
    }

    addLog('===== AI 回参文本 =====', 'debug');
    addLog(aiResponse, 'debug');
    addLog(`AI API 响应长度: ${aiResponse.length} 字符`, 'debug');

    return aiResponse;
  } catch (error) {
    addLog(`调用 AI API 失败: ${error}`, 'error');
    if (error instanceof Error) {
      addLog(`错误堆栈: ${error.stack}`, 'error');
    }
    throw error;
  }
}

/**
 * 带重试机制的 AI API 调用
 */
export async function callAIAPIWithRetry(
  prompt: string,
  apiKey: string,
  apiUrl: string,
  modelName: string,
  maxRetries: number = 3,
  retryDelay: number = 2000,
  signal?: AbortSignal,
  aiParams?: { temperature: number; max_tokens: number; top_p: number; frequency_penalty: number; presence_penalty: number }
): Promise<string> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      addLog(`尝试调用 AI API (${i + 1}/${maxRetries})...`, 'debug');
      const response = await callAIAPI(prompt, apiKey, apiUrl, modelName, signal, aiParams);
      addLog('AI API 调用成功', 'info');
      return response;
    } catch (error) {
      lastError = error as Error;
      console.error(`AI API 调用失败 (${i + 1}/${maxRetries}):`, lastError);

      if (signal?.aborted) {
        throw new Error('整理任务已取消');
      }

      if (i < maxRetries - 1) {
        addLog(`等待 ${retryDelay}ms 后重试...`, 'debug');
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error('AI API 调用失败，已达到最大重试次数');
}

/**
 * 解析 AI 响应
 */
export function parseAIResponse(response: string): AIProcessingResult[] {
  try {
    const data = JSON.parse(response);
    const results: AIProcessingResult[] = [];

    Object.keys(data).forEach(sheetName => {
      const updates = data[sheetName];
      if (Array.isArray(updates)) {
        results.push({
          sheetName,
          updates,
          preview: `${sheetName}: ${updates.length} 条记录`
        });
      }
    });

    return results;
  } catch (error) {
    console.error('解析 AI 响应失败:', error);
    return [];
  }
}

/**
 * 解析 AI 操作指令
 */
export function parseAIOperations(response: string): TableOperation[] {
  addLog('开始解析 AI 操作指令', 'debug');
  addLog('原始响应内容:', 'debug');
  addLog(response, 'debug');

  try {
    // 清理响应内容，移除可能的前缀或后缀
    let cleanedResponse = response.trim();
    addLog(`清理后响应长度: ${cleanedResponse.length}`, 'debug');

    // 处理可能的JSON格式问题
    // 移除可能的代码块标记
    if (cleanedResponse.startsWith('```json')) {
      addLog('检测到 ```json 前缀，正在移除', 'debug');
      cleanedResponse = cleanedResponse.substring(7);
    }
    if (cleanedResponse.endsWith('```')) {
      addLog('检测到 ``` 后缀，正在移除', 'debug');
      cleanedResponse = cleanedResponse.substring(0, cleanedResponse.length - 3);
    }

    // 再次清理
    cleanedResponse = cleanedResponse.trim();
    addLog(`最终清理后响应: ${cleanedResponse}`, 'debug');

    // 尝试解析JSON
    addLog('尝试解析 JSON', 'debug');
    const operations = JSON.parse(cleanedResponse) as TableOperation[];
    addLog('JSON 解析成功', 'debug');

    // 确保返回的是数组
    if (Array.isArray(operations)) {
      addLog(`成功解析 ${operations.length} 个操作指令`, 'info');

      // 如果是空数组，记录警告但不抛出错误
      if (operations.length === 0) {
        addLog('警告: AI 返回了空操作指令数组', 'warn');
        // 这里不抛出错误，而是返回空数组，让上层处理
      }

      addLog('操作指令详情:', 'debug');
      operations.forEach((op, index) => {
        addLog(`  ${index + 1}. ${op.operation} - ${op.sheetName}`, 'debug');
      });

      return operations;
    } else {
      addLog(`AI 响应不是数组格式，类型: ${typeof operations}`, 'error');
      addLog(`响应内容: ${JSON.stringify(operations)}`, 'error');
      throw new Error('AI 响应不是数组格式');
    }
  } catch (error) {
    addLog(`解析 AI 操作指令失败: ${error}`, 'error');
    if (error instanceof Error) {
      addLog(`错误堆栈: ${error.stack}`, 'error');
    }
    addLog('AI 响应原始内容:', 'error');
    addLog(response, 'error');
    throw error;
  }
}
