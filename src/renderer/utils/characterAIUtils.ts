import { AIService, defaultAIService } from '../components/Common/AIService';
import type { AIRequestOptions, AIResult } from '../components/Common/AIService.types';
import type { AIEngine } from '../types/setting';
import { ensurePositiveInteger } from './requestParamUtils';

function buildAIRequestOptions(
  engine: AIEngine,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
): AIRequestOptions {
  return {
    model: engine.model_name || 'gpt-3.5-turbo',
    baseUrl: engine.api_url,
    apiKey: engine.api_key,
    messages,
    temperature: Number(engine.temperature) ?? 0.7,
    maxTokens: ensurePositiveInteger(engine.max_tokens, 4096)
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
