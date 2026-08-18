/**
 * 统一 AI HTTP 调用工具函数
 *
 * 提供基于 fetch 的 AI API 调用，支持：
 * - chat_completion / text_completion 两种模式
 * - header / body 两种鉴权传输方式
 * - 300s 超时控制
 * - 指数退避重试（1s→2s→4s，最多 3 次，仅对 5xx 和网络错误重试）
 * - 响应解析兼容 choices[0].message.content 和 choices[0].text
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export interface AIAPIConfig {
  apiKey: string;
  apiUrl: string;
  modelName: string;
  apiKeyTransmission: string;
  apiMode: string;
}

export interface AIAPIParams {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  /** 自定义 system prompt，未提供时使用默认值 */
  systemPrompt?: string;
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/**
 * 构建请求鉴权头
 */
/** @internal 导出以供单元测试 */
export function buildAuthHeaders(apiKey: string, transmission: string): Record<string, string> {
  const headers: Record<string, string> = {};

  if (transmission === 'header' && apiKey) {
    const trimmed = apiKey.trim();
    if (trimmed.startsWith('Bearer ')) {
      headers['Authorization'] = trimmed;
    } else {
      headers['Authorization'] = `Bearer ${trimmed}`;
    }
  }

  return headers;
}

/**
 * 构建请求体
 */
/** @internal 导出以供单元测试 */
export function buildRequestBody(
  prompt: string,
  config: AIAPIConfig,
  params?: AIAPIParams
): Record<string, unknown> {
  const isChat = config.apiMode === 'chat_completion';

  const body: Record<string, unknown> = {
    model: config.modelName,
    ...(params?.temperature !== undefined && { temperature: params.temperature }),
    ...(params?.max_tokens !== undefined && { max_tokens: params.max_tokens }),
    ...(params?.top_p !== undefined && { top_p: params.top_p }),
    ...(params?.frequency_penalty !== undefined && { frequency_penalty: params.frequency_penalty }),
    ...(params?.presence_penalty !== undefined && { presence_penalty: params.presence_penalty }),
  };

  if (isChat) {
    const systemContent = params?.systemPrompt || '系统提示';
    body.messages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: prompt },
    ];
  } else {
    body.prompt = prompt;
  }

  // body 鉴权方式：将 apiKey 放入请求体
  if (config.apiKeyTransmission === 'body' && config.apiKey) {
    body.api_key = config.apiKey;
  }

  return body;
}

/**
 * 从响应中提取文本内容
 * 兼容 choices[0].message.content 和 choices[0].text
 */
/** @internal 导出以供单元测试 */
export function extractResponseContent(data: any, isChat: boolean): string {
  if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new Error('API 响应格式错误：没有返回 choices');
  }

  const choice = data.choices[0];
  let content: string | undefined;

  if (isChat) {
    content = choice.message?.content;
  } else {
    content = choice.text;
  }

  if (!content || typeof content !== 'string') {
    throw new Error('AI 响应内容为空或格式错误');
  }

  return content.trim();
}

/**
 * 判断错误是否为可重试类型
 * - 网络错误（TypeError）：如 DNS 解析失败、连接重置等
 * - 5xx 服务端错误
 */
/** @internal 导出以供单元测试 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) {
    // 网络错误（fetch 在网络故障时抛出 TypeError）
    return true;
  }
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status;
    return status >= 500 && status < 600;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 核心导出函数
// ---------------------------------------------------------------------------

/**
 * 统一 AI HTTP 调用函数
 *
 * @param prompt  - 用户提示词
 * @param config  - AI 引擎配置（apiKey / apiUrl / modelName / apiKeyTransmission / apiMode）
 * @param params  - 可选参数（temperature / max_tokens / top_p / frequency_penalty / presence_penalty）
 * @returns       - AI 响应的文本内容
 *
 * @throws 当所有重试均失败时抛出最后一次的错误
 */
export async function callAIAPIWithFetch(
  prompt: string,
  config: AIAPIConfig,
  params?: AIAPIParams
): Promise<string> {
  const isChat = config.apiMode === 'chat_completion';

  console.log(`[aiHttpClient] 开始调用 AI API`);
  console.log(`[aiHttpClient]   模式: ${config.apiMode}`);
  console.log(`[aiHttpClient]   地址: ${config.apiUrl}`);
  console.log(`[aiHttpClient]   模型: ${config.modelName}`);
  console.log(`[aiHttpClient]   鉴权传输: ${config.apiKeyTransmission}`);
  console.log(`[aiHttpClient]   提示词长度: ${prompt.length} 字符`);

  const resolvedUrl = config.apiUrl;
  const requestBody = buildRequestBody(prompt, config, params);
  const authHeaders = buildAuthHeaders(config.apiKey, config.apiKeyTransmission);

  console.log(`[aiHttpClient] 请求体: ${JSON.stringify(requestBody, null, 2)}`);

  // 重试参数
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 1000; // 1s
  const TIMEOUT_MS = 300000;  // 300s

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[aiHttpClient] 尝试第 ${attempt + 1}/${MAX_RETRIES + 1} 次调用...`);

      const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);

      const response = await fetch(resolvedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(requestBody),
        signal: timeoutSignal,
      });

      console.log(`[aiHttpClient] 响应状态: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '无法读取错误响应体');
        console.log(`[aiHttpClient] 错误详情: ${errorText}`);

        const httpError = new Error(`API 调用失败: ${response.status} ${response.statusText} - ${errorText}`);
        (httpError as any).status = response.status;

        // 仅对 5xx 重试
        if (response.status >= 500 && response.status < 600 && attempt < MAX_RETRIES) {
          lastError = httpError;
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          console.log(`[aiHttpClient] 服务端错误，${delay}ms 后重试...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw httpError;
      }

      const data = await response.json();
      console.log(`[aiHttpClient] 收到响应: ${JSON.stringify(data, null, 2)}`);

      const content = extractResponseContent(data, isChat);
      console.log(`[aiHttpClient] 提取内容长度: ${content.length} 字符`);
      console.log(`[aiHttpClient] 调用成功`);

      return content;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log(`[aiHttpClient] 调用失败 (${attempt + 1}/${MAX_RETRIES + 1}): ${lastError.message}`);

      // 判断是否应当重试
      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(`[aiHttpClient] 可重试错误，${delay}ms 后重试...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // 不可重试或已用完重试次数
      if (attempt >= MAX_RETRIES) {
        console.log(`[aiHttpClient] 已达最大重试次数，放弃`);
      } else {
        console.log(`[aiHttpClient] 非可重试错误，不再重试`);
      }

      throw lastError;
    }
  }

  // 不应该到达这里，但 TypeScript 需要返回值
  throw lastError ?? new Error('AI API 调用失败，未知错误');
}