/**
 * SSE Stream Parser - 统一的 SSE 流式响应解析器
 *
 * 独立工具类，处理 Server-Sent Events (SSE) 格式的流式响应解析。
 * 被所有需要流式 AI 调用的服务复用，消除 ContentGenerator / OutlineGenerator /
 * WritingStyleLearningService / promptTemplateService 等模块中的重复 SSE 解析逻辑。
 *
 * 主要功能：
 * - 处理 `data:` 前缀
 * - 跳过 `[DONE]` 标记
 * - 维护 buffer 拼接，处理跨 chunk 的不完整 SSE 行
 * - 多种消费方式：parseStream (callback) / iterateChunks (async iterator)
 * - 容错回退：从原始数据中正则提取 content 字段
 */

// ==================== Types ====================

/**
 * 流式 chunk 回调函数类型
 */
export type StreamChunkCallback = (chunk: string) => void;

/**
 * parseStream 返回结果
 */
export interface StreamParseResult {
  /** 累积的完整内容 */
  content: string;
  /** 生成耗时（毫秒） */
  generationTime: number;
}

// ==================== SSEStreamParser ====================

export class SSEStreamParser {
  /**
   * 解析 SSE 单行数据，提取 content 字段
   *
   * 支持两种格式：
   * - 流式 delta: `parsed.choices[0].delta.content`
   * - 完整 message: `parsed.choices[0].message.content`
   *
   * @param line 单行 SSE 数据（如 `data: {"choices":[{"delta":{"content":"hello"}}]}`）
   * @returns 解析出的 content 片段；如非 data 行、为 [DONE]、或解析失败则返回 null
   */
  parseSSELine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return null;

    const jsonStr = trimmed.substring(6).trim();
    if (!jsonStr || jsonStr === '[DONE]') return null;

    try {
      const parsed = JSON.parse(jsonStr);
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) return delta;

      const message = parsed.choices?.[0]?.message?.content;
      if (message) return message;

      return null;
    } catch {
      return null;
    }
  }

  /**
   * 从原始 SSE 数据中提取 content（容错回退方案）
   *
   * 当流式解析未能成功提取完整内容时使用：
   * - Strategy 1: 正则匹配所有 `data:` 行并解析 JSON
   * - Strategy 2: 直接正则提取 `"content":"..."` 字段
   *
   * @param rawData 原始累积数据
   * @returns 提取出的完整 content
   */
  extractContentFromRawData(rawData: string): string {
    let extracted = '';

    // Strategy 1: 匹配所有 data: 行
    const dataLineRegex = /^data:\s+(.+)$/gm;
    let match;
    while ((match = dataLineRegex.exec(rawData)) !== null) {
      const jsonStr = match[1].trim();
      if (jsonStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) extracted += delta;
        else if (parsed.choices?.[0]?.message?.content) {
          extracted += parsed.choices[0].message.content;
        }
      } catch {
        // Skip malformed JSON
      }
    }

    // Strategy 2: 直接正则提取 content 字段
    if (!extracted) {
      const contentRegex = /"content"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/g;
      let contentMatch;
      while ((contentMatch = contentRegex.exec(rawData)) !== null) {
        const rawContent = contentMatch[1];
        extracted += rawContent.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
      }
    }

    return extracted;
  }

  /**
   * 解析 Response 流式响应体，实时调用回调
   *
   * 这是主要的消费方式之一。每次解析出 content 片段时立即调用 `onChunk`，
   * 最终返回累积的完整内容与耗时。
   *
   * 行为：
   * - 维护 buffer，按 `\n` 分割，保留最后一个不完整行
   * - 流结束时处理 buffer 中残留的不完整 SSE 行
   * - 若累积内容过短（< 100 字符），尝试从原始 buffer 回退提取
   * - 支持 AbortSignal 中止（返回已累积的内容）
   *
   * @param response fetch 返回的 Response 对象（需有可读 body）
   * @param onChunk 每个 content 片段的回调
   * @param abortSignal 可选的中止信号
   */
  async parseStream(
    response: Response,
    onChunk: StreamChunkCallback,
    abortSignal?: AbortSignal
  ): Promise<StreamParseResult> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法获取响应流');
    }

    const decoder = new TextDecoder('utf-8');
    let fullContent = '';
    let buffer = '';
    const startTime = Date.now();

    // 若调用方已取消，立即返回（abortSignal 通常与 fetch 共享，
    // fetch 已被中止；此处仅做防御性检查，避免无谓的 reader.read() 调用）
    if (abortSignal?.aborted) {
      reader.releaseLock();
      return { content: fullContent, generationTime: Date.now() - startTime };
    }

    try {
      while (true) {
        // 主动检测取消（fetch 已通过 signal 中止时 reader.read() 会抛 AbortError，
        // 此检查处理 abortSignal 被触发但底层 reader 尚未抛错的边界情况）
        if (abortSignal?.aborted) {
          break;
        }

        const { done, value } = await reader.read();

        if (done) {
          // 处理 buffer 中残留的不完整 SSE 数据行
          if (buffer.trim()) {
            buffer = buffer.trim();
            if (buffer.startsWith('data:') && !buffer.includes('[DONE]')) {
              const jsonStr = buffer.substring(6).trim();
              if (jsonStr) {
                try {
                  const chunkData = JSON.parse(jsonStr);
                  if (chunkData.choices?.[0]) {
                    const content = chunkData.choices[0].delta?.content || chunkData.choices[0].message?.content || '';
                    if (content) {
                      fullContent += content;
                      onChunk(content);
                    }
                  }
                } catch {
                  // 忽略解析错误
                }
              }
            }
          }
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // 按行分割，保留最后一个不完整的行在 buffer 中
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const parsed = this.parseSSELine(line);
          if (parsed) {
            fullContent += parsed;
            onChunk(parsed);
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { content: fullContent, generationTime: Date.now() - startTime };
      }
      throw error;
    } finally {
      reader.releaseLock();
    }

    // 回退提取
    if (fullContent.length < 100 && buffer.length > 0) {
      const fallbackContent = this.extractContentFromRawData(buffer);
      if (fallbackContent.length > fullContent.length) {
        fullContent = fallbackContent;
      }
    }

    return { content: fullContent, generationTime: Date.now() - startTime };
  }

  /**
   * 解析 ReadableStream（直接接收 Uint8Array 流）
   *
   * 与 parseStream 类似，但接收 ReadableStream 而非 Response，
   * 适用于已剥离 HTTP 层的场景。
   */
  async parseReadableStream(
    stream: ReadableStream<Uint8Array>,
    onChunk: StreamChunkCallback,
    abortSignal?: AbortSignal
  ): Promise<StreamParseResult> {
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullContent = '';
    let buffer = '';
    const startTime = Date.now();

    if (abortSignal?.aborted) {
      reader.releaseLock();
      return { content: fullContent, generationTime: Date.now() - startTime };
    }

    try {
      while (true) {
        if (abortSignal?.aborted) {
          break;
        }

        const { done, value } = await reader.read();

        if (done) {
          if (buffer.trim()) {
            buffer = buffer.trim();
            if (buffer.startsWith('data:') && !buffer.includes('[DONE]')) {
              const jsonStr = buffer.substring(6).trim();
              if (jsonStr) {
                try {
                  const chunkData = JSON.parse(jsonStr);
                  if (chunkData.choices?.[0]) {
                    const content = chunkData.choices[0].delta?.content || chunkData.choices[0].message?.content || '';
                    if (content) {
                      fullContent += content;
                      onChunk(content);
                    }
                  }
                } catch {
                  // 忽略解析错误
                }
              }
            }
          }
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const parsed = this.parseSSELine(line);
          if (parsed) {
            fullContent += parsed;
            onChunk(parsed);
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { content: fullContent, generationTime: Date.now() - startTime };
      }
      throw error;
    } finally {
      reader.releaseLock();
    }

    if (fullContent.length < 100 && buffer.length > 0) {
      const fallbackContent = this.extractContentFromRawData(buffer);
      if (fallbackContent.length > fullContent.length) {
        fullContent = fallbackContent;
      }
    }

    return { content: fullContent, generationTime: Date.now() - startTime };
  }

  /**
   * 异步迭代器：逐个 yield 解析出的 content 片段
   *
   * 提供符合 ergonomics 的 async iteration 消费方式：
   *
   * ```ts
   * const parser = new SSEStreamParser();
   * for await (const chunk of parser.iterateChunks(response, abortSignal)) {
   *   // 处理 chunk
   * }
   * ```
   *
   * 注意：迭代器只 yield content 片段，不提供完整内容汇总。
   * 如需汇总，请使用 parseStream。
   */
  async *iterateChunks(
    response: Response,
    abortSignal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法获取响应流');
    }

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    if (abortSignal?.aborted) {
      reader.releaseLock();
      return;
    }

    try {
      while (true) {
        if (abortSignal?.aborted) {
          break;
        }

        const { done, value } = await reader.read();

        if (done) {
          if (buffer.trim()) {
            buffer = buffer.trim();
            if (buffer.startsWith('data:') && !buffer.includes('[DONE]')) {
              const jsonStr = buffer.substring(6).trim();
              if (jsonStr) {
                try {
                  const chunkData = JSON.parse(jsonStr);
                  if (chunkData.choices?.[0]) {
                    const content = chunkData.choices[0].delta?.content || chunkData.choices[0].message?.content || '';
                    if (content) {
                      yield content;
                    }
                  }
                } catch {
                  // 忽略解析错误
                }
              }
            }
          }
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const parsed = this.parseSSELine(line);
          if (parsed) {
            yield parsed;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// 单例导出，方便直接 import 使用
let singletonInstance: SSEStreamParser | null = null;

/**
 * 获取 SSEStreamParser 单例
 *
 * SSEStreamParser 是无状态的纯解析工具，可全局复用。
 */
export function getSSEStreamParser(): SSEStreamParser {
  if (!singletonInstance) {
    singletonInstance = new SSEStreamParser();
  }
  return singletonInstance;
}

export default SSEStreamParser;
