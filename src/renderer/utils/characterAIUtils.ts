import { defaultAIService } from '../components/Common/AIService';
import type { AIRequestOptions, AIResult } from '../components/Common/AIService.types';
import type { AIEngine } from '../types/setting';

// 【多模态兼容性审计】本工具使用 { role, content: string }[] 构造消息，
// 经 defaultAIService（AIChatMessage，content: string）发送，不含多模态联合类型。
// 不受 AIService.ts 主进程联合类型 ChatMessage 扩展影响，适用于角色卡 AI 等非视觉任务。
function buildAIRequestOptions(
  engine: AIEngine,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
): AIRequestOptions {
  const temperature = (typeof engine.temperature === 'number' && engine.temperature >= 0 && engine.temperature <= 2)
    ? engine.temperature
    : 0.7;

  return {
    model: engine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })(),
    baseUrl: engine.api_url,
    apiKey: engine.api_key,
    messages,
    temperature
  };
}

export async function sendCharacterAIRequest(
  engine: AIEngine,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const options = buildAIRequestOptions(engine, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]);

  const result: AIResult = await defaultAIService.sendChatRequest(options);

  if (result.status === 'error') {
    throw new Error(result.error?.message || 'AI 请求失败');
  }

  return result.response?.content || '';
}

/**
 * 智能助手专用 AI 请求方法（Spec: add-ai-assistant-for-character-card-editor / Task 7）
 *
 * 与 sendCharacterAIRequest 的区别：
 * 1. 接受完整 messages 数组（支持多轮对话历史）
 * 2. 不依赖 prompt.build IPC（提示词模板在前端定义）
 * 3. 专供 useCharacterCardAssistant hook 调用
 */
export async function sendAssistantAIRequest(
  engine: AIEngine,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
): Promise<string> {
  const options = buildAIRequestOptions(engine, messages);

  const result: AIResult = await defaultAIService.sendChatRequest(options);

  if (result.status === 'error') {
    throw new Error(result.error?.message || 'AI 请求失败');
  }

  return result.response?.content || '';
}

/**
 * 智能助手流式 AI 请求（Spec: add-ai-assistant-for-character-card-editor，流式增强）
 *
 * 基于 defaultAIService.sendStreamChatRequest 的 SSE 流式转发：
 * - onStream(chunk, isDone)：chunk 为增量文本，完成时回调 ('', true)
 * - onError(message)：请求失败（含用户取消导致的中止）
 * - onComplete(fullContent)：主进程汇总的完整内容（可能比流式累积更完整）
 * 取消：调用 window.electronAPI.ai.cancel() 由主进程 abort，随后触发 onError。
 */
export interface AssistantStreamCallbacks {
  onStream: (chunk: string, isDone: boolean) => void;
  onError?: (message: string) => void;
  onComplete?: (fullContent: string) => void;
}

export async function sendAssistantAIStreamRequest(
  engine: AIEngine,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  callbacks: AssistantStreamCallbacks
): Promise<void> {
  const options = buildAIRequestOptions(engine, messages);

  await defaultAIService.sendStreamChatRequest(options, {
    onStream: callbacks.onStream,
    onError: (error) => {
      callbacks.onError?.(error?.message || 'AI 流式请求失败');
    },
    onComplete: (response) => {
      callbacks.onComplete?.(response?.content || '');
    },
  });
}
