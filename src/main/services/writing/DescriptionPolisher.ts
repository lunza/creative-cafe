import { promptBuilder } from './PromptBuilder';
import { aiConfigProvider } from '../ai/AIConfigProvider';

// 【多模态兼容性审计】本服务使用字符串 content 构造消息（buildPolishDescriptionPrompt 返回纯文本），
// 不导入 AIService.ts 的联合类型 ChatMessage，不受多模态 content 扩展影响。
// 所有消息 content 均为纯文本字符串，适用于描述润色等非视觉任务。
interface PolishDescriptionRequest {
  description: string;
  resourceContext?: string;
  instruction?: string;
  modelConfig: {
    model: string;
    temperature: number;
    maxTokens: number;
  };
}

export class DescriptionPolisher {
  async polishStream(
    request: PolishDescriptionRequest,
    onStream: (chunk: string) => void,
    abortSignal: AbortSignal
  ): Promise<string> {
    const { description, resourceContext, instruction, modelConfig } = request;

    const aiConfig = aiConfigProvider.getAIConfig();
    const baseUrl = aiConfig.baseUrl;
    const apiKey = aiConfig.apiKey;
    const modelName = aiConfig.modelName || modelConfig.model;

    if (!baseUrl) {
      throw new Error('AI 服务地址未配置');
    }

    const messages = promptBuilder.buildPolishDescriptionPrompt(description, resourceContext, instruction);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const requestBody = {
      model: modelName,
      messages,
      temperature: modelConfig.temperature,
      max_tokens: modelConfig.maxTokens,
      stream: true,
    };

    let fullContent = '';

    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: abortSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI 请求失败: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法获取响应流');
      }

      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:') || trimmed.includes('[DONE]')) {
            continue;
          }

          const jsonStr = trimmed.substring(6).trim();
          if (!jsonStr) continue;

          try {
            const chunkData = JSON.parse(jsonStr);
            if (chunkData.choices?.[0]?.delta?.content) {
              const content = chunkData.choices[0].delta.content;
              fullContent += content;
              onStream(content);
            }
          } catch {
            // 忽略解析错误
          }
        }
      }

      return fullContent;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('润色请求已取消');
      }
      throw error;
    }
  }
}

export const descriptionPolisher = new DescriptionPolisher();
