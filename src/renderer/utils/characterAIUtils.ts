import { AIService, defaultAIService } from '../components/Common/AIService';
import type { AIRequestOptions, AIResult } from '../components/Common/AIService.types';
import type { AIEngine } from '../types/setting';

function ensurePositiveInteger(value: unknown, defaultValue: number): number {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : defaultValue;
}

function buildAIRequestOptions(
  engine: AIEngine,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
): AIRequestOptions {
  const temperature = (typeof engine.temperature === 'number' && engine.temperature >= 0 && engine.temperature <= 2)
    ? engine.temperature
    : (() => { throw new Error('未配置 temperature 参数') })();

  return {
    model: engine.model_name ?? (() => { throw new Error('未配置 AI 模型名称') })(),
    baseUrl: engine.api_url,
    apiKey: engine.api_key,
    messages,
    temperature,
    maxTokens: Number(engine.max_tokens) ?? (() => { throw new Error('未配置 max_tokens 参数') })()
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
