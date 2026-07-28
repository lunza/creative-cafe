import { ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import { createLogger } from '../../services/logger';
import { BoundedQueue } from './utils/boundedQueue';
import { aiService } from '../../services/AIService';

/**
 * AI 请求处理器
 * 用于处理 AI 翻译、润色等请求，避免前端直接发送请求导致的 CORS 问题
 */

const logger = createLogger('ai-handler');

/**
 * 生成短请求 ID，用于贯穿单次 AI 调用的所有日志条目，便于关联入参与出参。
 * 格式：req-xxxxxxxxxxxx（12 位 hex）
 */
function generateRequestId(): string {
  return `req-${randomUUID().replace(/-/g, '').substring(0, 12)}`;
}

/**
 * 流式转发背压控制配置
 *
 * - QUEUE_MAX_SIZE: 队列硬上限，防御性保护，避免极端情况下内存爆炸
 * - QUEUE_HIGH_WATERMARK: 高水位，超过此值暂停 reader.read()（生产者）
 * - QUEUE_LOW_WATERMARK: 低水位，消费者 drain 后低于此值恢复生产者
 *
 * 这些值控制 main process 与 renderer 之间 IPC 消息的 in-flight 数量，
 * 避免在 renderer 处理慢时无限堆积导致内存增长。
 */
const QUEUE_MAX_SIZE = 100;
const QUEUE_HIGH_WATERMARK = 80;
const QUEUE_LOW_WATERMARK = 40;

/**
 * 流式请求的连接超时（毫秒）。
 *
 * 流式 AI 请求的 TTFB（time to first byte）可能较长（冷启动、长 prompt），
 * 此处设为 120 秒。仅用于等待响应头到达，响应头到达后立即清除。
 * 提高到 120 秒以兼容深度思考模型（首字延迟可能较长）。
 */
const STREAMING_CONNECTION_TIMEOUT = 120000;

/**
 * 非流式请求的连接超时（毫秒）。
 *
 * 非流式请求需等待完整响应，连接超时设为 120 秒以兼容深度思考模型。
 */
const NON_STREAMING_CONNECTION_TIMEOUT = 120000;

// 存储活跃请求的 AbortController 和 timeoutId
interface ActiveRequest {
  controller: AbortController;
  timeoutId?: NodeJS.Timeout;
  connectionTimeoutId?: NodeJS.Timeout;
}
const activeRequests = new Map<number, ActiveRequest>();

// 处理取消 AI 请求
ipcMain.handle('ai:cancel', async (event) => {
  const senderId = event.sender.id;
  const activeRequest = activeRequests.get(senderId);
  if (activeRequest) {
    activeRequest.controller.abort();
    if (activeRequest.timeoutId) {
      clearTimeout(activeRequest.timeoutId);
    }
    if (activeRequest.connectionTimeoutId) {
      clearTimeout(activeRequest.connectionTimeoutId);
    }
    activeRequests.delete(senderId);
    logger.info('AI 请求已被用户取消', undefined, { senderId });
    return { success: true };
  }
  logger.warn('没有找到活跃的 AI 请求可取消', undefined, { senderId });
  return { success: false };
});

// 处理 AI 请求
// 【多模态兼容性审计】ai:request 通用转发器透传 requestConfig.body，
// 不检查也不修改 messages 内容，对 content 类型（string | 多模态数组）完全透明。
// 多模态请求由调用方（如 characterTraitAIService）构建 body，转发器仅负责 HTTP 传输。
ipcMain.handle('ai:request', async (event, requestConfig: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
  timeout?: number;
  streaming?: boolean;
}) => {
  // 生成请求 ID，贯穿本次调用的所有日志条目
  const requestId = generateRequestId();
  // 记录开始时间
  const startTime = new Date();
  const startTimeStr = startTime.toISOString();
  
  try {
    const { url, method, headers, body, timeout, streaming = false } = requestConfig;
    
    // 脱敏处理请求头
    const sanitizedHeaders = { ...headers };
    if (sanitizedHeaders['Authorization']) {
      sanitizedHeaders['Authorization'] = 'Bearer [REDACTED]';
    }
    
    // 脱敏处理请求体
    const sanitizedBody = { ...body };
    if (sanitizedBody.api_key) {
      sanitizedBody.api_key = '[REDACTED]';
    }
    
    // ===== 入参日志：完整记录请求信息（不截断） =====
    logger.info(`[${requestId}] 收到AI请求: ${method} ${url}`, undefined, {
      requestId,
      timestamp: startTimeStr,
      method: method,
      url: url,
      timeout: timeout,
      streaming: streaming
    });
    logger.debug(`[${requestId}] 请求头`, undefined, sanitizedHeaders);
    
    // 记录完整的请求体（包含完整 messages 内容，不截断）
    if (sanitizedBody.messages && Array.isArray(sanitizedBody.messages)) {
      logger.debug(`[${requestId}] 请求体摘要`, undefined, {
        model: sanitizedBody.model || 'N/A',
        stream: sanitizedBody.stream || false,
        messages_count: sanitizedBody.messages.length,
        messages_structure: sanitizedBody.messages.map((msg: any, idx: number) => ({
          index: idx,
          role: msg.role,
          content_length: msg.content ? msg.content.length : 0
        }))
      });
      // 完整 JSON 请求体写入日志文件（不受 DevTools 截断影响，不截断大文本）
      const fullBodyStr = JSON.stringify(sanitizedBody, null, 2);
      logger.info(`[${requestId}] 请求体（完整JSON，不截断）`, fullBodyStr);
    } else {
      logger.info(`[${requestId}] 请求体（完整JSON）`, undefined, sanitizedBody);
    }
    
    // 输入验证
    if (!url || typeof url !== 'string') {
      const errorMsg = '无效的API URL';
      logger.error(`[${requestId}] ${errorMsg}`, undefined, {
        requestId,
        errorType: 'ValidationError',
        errorLocation: 'aiHandlers.ts:handleRequest:urlValidation',
        timestamp: startTimeStr,
        url: url,
        method: method
      });
      return {
        success: false,
        error: errorMsg,
        details: 'API URL不能为空且必须是字符串格式'
      };
    }
    
    if (!method || !['GET', 'POST', 'PUT', 'DELETE'].includes(method.toUpperCase())) {
      const errorMsg = '无效的HTTP方法';
      logger.error(`[${requestId}] ${errorMsg}`, undefined, {
        requestId,
        errorType: 'ValidationError',
        errorLocation: 'aiHandlers.ts:handleRequest:methodValidation',
        timestamp: startTimeStr,
        method: method,
        url: url
      });
      return {
        success: false,
        error: errorMsg,
        details: 'HTTP方法必须是GET、POST、PUT或DELETE'
      };
    }
    
    // 如果启用流式响应
    if (streaming) {
      // 使用 Node.js 的 fetch (Electron 支持)
      const controller = new AbortController();
      let timeoutId: NodeJS.Timeout | undefined;
      let connectionTimeoutId: NodeJS.Timeout | undefined;

      // 存储 AbortController 以便外部取消
      const senderId = event.sender.id;

      // 超时策略：连接超时（120s TTFB 兜底）+ 请求超时（默认 300s，调用方可覆盖）
      const CONNECTION_TIMEOUT = STREAMING_CONNECTION_TIMEOUT;
      const effectiveTimeout = timeout === 0 ? 0 : (timeout || 300000); // 默认 300 秒请求超时

      activeRequests.set(senderId, { controller, timeoutId: undefined, connectionTimeoutId: undefined });
      
      logger.info(`[${requestId}] 正在发送流式请求到 ${url}...`, undefined, {
        requestId,
        timestamp: startTimeStr,
        url: url,
        method: method,
        connectionTimeout: CONNECTION_TIMEOUT,
        requestTimeout: effectiveTimeout > 0 ? effectiveTimeout : '无限制'
      });
      
      // 设置连接超时检测
      if (CONNECTION_TIMEOUT > 0) {
        connectionTimeoutId = setTimeout(() => {
          logger.warn(`[${requestId}] AI 请求连接超时 (${CONNECTION_TIMEOUT}ms)，正在中止请求`, undefined, {
            requestId,
            timestamp: new Date().toISOString(),
            url: url,
            connectionTimeout: CONNECTION_TIMEOUT
          });
          controller?.abort();
        }, CONNECTION_TIMEOUT);
      }

      // 设置请求超时
      if (effectiveTimeout > 0) {
        timeoutId = setTimeout(() => {
          logger.warn(`[${requestId}] AI 请求响应超时 (${effectiveTimeout}ms)，正在中止请求`, undefined, {
            requestId,
            timestamp: new Date().toISOString(),
            url: url,
            requestTimeout: effectiveTimeout
          });
          controller?.abort();
        }, effectiveTimeout);
      }
      
      // 更新 Map 中的 timeoutId
      activeRequests.set(senderId, { controller, timeoutId, connectionTimeoutId });
      
      try {
        const response = await fetch(url, {
          method,
          headers,
          body: JSON.stringify(body),
          signal: controller?.signal
        });
        
        // 连接成功，清除连接超时
        if (connectionTimeoutId) {
          clearTimeout(connectionTimeoutId);
          connectionTimeoutId = undefined;
        }
        
        if (timeoutId) {
          clearTimeout(timeoutId);
          // 清理 timeoutId，但保留 controller 直到请求完成
          activeRequests.set(senderId, { controller, timeoutId: undefined, connectionTimeoutId: undefined });
        }
        
        // 记录响应时间
        const endTime = new Date();
        const endTimeStr = endTime.toISOString();
        const responseTime = endTime.getTime() - startTime.getTime();
        
        const contentType = response.headers.get('content-type') || 'unknown';
        const contentLength = response.headers.get('content-length') || 'unknown';
        
        logger.info(`[${requestId}] 收到响应，状态码: ${response.status}`, undefined, {
          requestId,
          timestamp: endTimeStr,
          status: response.status,
          statusText: response.statusText,
          url: url,
          response_time_ms: responseTime,
          content_type: contentType,
          content_length: contentLength,
          headers: Object.fromEntries(response.headers.entries())
        });
        
        if (!response.ok) {
          try {
            const errorText = await response.text();
            logger.error(`[${requestId}] 响应失败: ${response.status} ${response.statusText}`, undefined, {
              requestId,
              errorType: 'NetworkError',
              errorLocation: 'aiHandlers.ts:handleRequest:streaming:responseNotOk',
              timestamp: endTimeStr,
              status: response.status,
              statusText: response.statusText,
              url: url,
              method: method,
              response_time_ms: responseTime,
              errorText: errorText
            });
            
            // 尝试解析错误响应
            let errorDetails = errorText;
            try {
              const errorJson = JSON.parse(errorText);
              errorDetails = JSON.stringify(errorJson, null, 2);
            } catch (e) {
              // 非JSON错误响应，使用原始文本
            }
            
            return {
              success: false,
              error: `HTTP ${response.status}: ${response.statusText}`,
              details: errorDetails,
              statusCode: response.status,
              statusText: response.statusText
            };
          } catch (textError) {
            logger.error(`[${requestId}] 读取错误响应失败: ${textError instanceof Error ? textError.message : '未知错误'}`, textError instanceof Error ? textError.stack || textError.message : undefined, {
              requestId,
              timestamp: new Date().toISOString(),
              status: response.status,
              url: url,
              response_time_ms: responseTime
            });
            return {
              success: false,
              error: `HTTP ${response.status}: ${response.statusText}`,
              details: '无法读取错误响应内容',
              statusCode: response.status,
              statusText: response.statusText
            };
          }
        }
        
        // 处理流式响应
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }
        
        let accumulatedData = '';
        let chunkCount = 0;
        let totalBytesReceived = 0;
        const streamReadStartTime = Date.now();
        
        logger.info(`[${requestId}] 开始读取流式响应数据...`, undefined, {
          requestId,
          timestamp: new Date().toISOString(),
          url: url
        });

        // 背压控制：有界队列 + 高/低水位机制
        //
        // 背景：原实现直接在 reader.read() 循环中调用 event.sender.send()，
        // 该方法是 fire-and-forget，无法感知 renderer 的消费速度。当网络读取
        // 速度 > renderer 处理速度时，IPC 消息会在 main/renderer 之间的
        // 内部缓冲区无限堆积，导致内存增长。
        //
        // 方案：在 reader（生产者）和 event.sender.send（消费者）之间引入
        // 有界队列。生产者 push 时若超过 highWaterMark 则 await 等待；
        // 消费者通过 setImmediate 异步 drain 队列并批量发送 IPC，
        // drain 后低于 lowWaterMark 时唤醒被阻塞的生产者。
        //
        // 这样保证了 in-flight 的 IPC 消息数 <= QUEUE_MAX_SIZE，
        // 内存使用有上界。
        const backpressureQueue = new BoundedQueue<{
          chunk: string;
          chunkIndex: number;
          chunkSize: number;
          accumulatedData: string;
        }>({
          maxSize: QUEUE_MAX_SIZE,
          highWaterMark: QUEUE_HIGH_WATERMARK,
          lowWaterMark: QUEUE_LOW_WATERMARK
        });

        let drainScheduled = false;
        let backpressurePauseCount = 0;
        const sendQueuedItems = (items: Array<{
          chunk: string;
          chunkIndex: number;
          chunkSize: number;
          accumulatedData: string;
        }>, phase: string): void => {
          if (items.length === 0) return;
          // renderer 已销毁时丢弃数据，避免 throw
          if (event.sender.isDestroyed()) {
            logger.warn(`[${requestId}] 渲染进程已销毁，丢弃流式数据`, undefined, {
              requestId,
              phase,
              chunk_count: items.length
            });
            return;
          }
          for (const item of items) {
            try {
              event.sender.send('ai:stream', item);
            } catch (sendError) {
              logger.error(
                `[${requestId}] 发送流式数据到渲染进程失败 (chunk ${item.chunkIndex}, phase=${phase})`,
                sendError instanceof Error ? sendError.stack || sendError.message : undefined,
                {
                  requestId,
                  timestamp: new Date().toISOString(),
                  chunk_index: item.chunkIndex,
                  error: sendError instanceof Error ? sendError.message : String(sendError)
                }
              );
            }
          }
        };

        const scheduleDrain = (): void => {
          if (drainScheduled) return;
          drainScheduled = true;
          setImmediate(() => {
            drainScheduled = false;
            const items = backpressureQueue.drain();
            sendQueuedItems(items, 'drain');
          });
        };

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            logger.info(`[${requestId}] 流式数据读取完成 (done=true)`, undefined, {
              requestId,
              timestamp: new Date().toISOString(),
              total_chunks: chunkCount,
              total_bytes: totalBytesReceived,
              accumulated_data_length: accumulatedData.length,
              total_time_ms: Date.now() - streamReadStartTime,
              backpressure_pause_count: backpressurePauseCount
            });
            break;
          }

          chunkCount++;
          const chunkSize = value.length;
          totalBytesReceived += chunkSize;

          // 解码响应数据
          const chunk = new TextDecoder().decode(value);
          accumulatedData += chunk;

          // 入队（带背压）：高水位时 await，暂停 reader.read() 生产者
          // 直到消费者 drain 后低于低水位才唤醒
          if (backpressureQueue.isPaused) {
            backpressurePauseCount++;
            logger.debug(`[${requestId}] 流式队列触发背压，暂停读取`, undefined, {
              requestId,
              chunk_index: chunkCount,
              queue_size: backpressureQueue.size,
              high_watermark: QUEUE_HIGH_WATERMARK
            });
          }
          await backpressureQueue.push({
            chunk,
            chunkIndex: chunkCount,
            chunkSize,
            accumulatedData
          });

          // 调度异步消费者：drain 队列并发送 IPC
          scheduleDrain();
        }

        // 循环结束后，确保所有积压消息已发送至 renderer
        // 再发送 ai:stream:complete，避免 complete 先于部分 chunk 到达
        scheduleDrain();
        // 让出一次 macrotask，等待可能仍在排队的 setImmediate drain 执行
        await new Promise<void>(resolve => setImmediate(resolve));
        // 最终兜底 drain：捕获"最后一次 push 在 drain 之后"的边界情况
        const finalItems = backpressureQueue.drain();
        sendQueuedItems(finalItems, 'final');

        // 记录响应完成时间
        const completeTime = new Date();
        const completeTimeStr = completeTime.toISOString();
        const totalTime = completeTime.getTime() - startTime.getTime();
        const streamReadTime = Date.now() - streamReadStartTime;
        
        logger.info(`[${requestId}] 流式响应完成`, undefined, {
          requestId,
          timestamp: completeTimeStr,
          total_chunks: chunkCount,
          total_bytes: totalBytesReceived,
          accumulated_data_length: accumulatedData.length,
          stream_read_time_ms: streamReadTime,
          total_request_time_ms: totalTime
        });
        
        // ===== 出参日志：完整记录原始 SSE 累积数据（不截断） =====
        logger.info(`[${requestId}] 流式响应原始数据（完整，不截断）`, accumulatedData);
        
        // 解析最终数据 - 修复：改进 SSE 解析逻辑
        let data;
        try {
          // 处理 SSE 格式
          if (accumulatedData.startsWith('data: ')) {
            const lines = accumulatedData.split('\n');
            // 收集所有非 [DONE] 的 data: 行
            const jsonLines = lines
              .filter(line => line.trim().startsWith('data: '))
              .map(line => line.trim().substring(6))
              .filter(line => line && line !== '[DONE]');
            
            if (jsonLines.length > 0) {
              // 先合并所有 data: 行获取完整内容（用于日志）
              let fullContent = '';
              for (const line of jsonLines) {
                try {
                  const parsed = JSON.parse(line);
                  if (parsed.choices?.[0]?.delta?.content) {
                    fullContent += parsed.choices[0].delta.content;
                  } else if (parsed.choices?.[0]?.message?.content) {
                    fullContent = parsed.choices[0].message.content;
                  }
                } catch (e) { /* ignore */ }
              }

              // 尝试解析最后一个有效行
              const lastLine = jsonLines[jsonLines.length - 1];
              try {
                data = JSON.parse(lastLine);
                // ===== 出参日志：完整记录 AI 解析后的回复内容（不截断） =====
                logger.info(`[${requestId}] SSE 解析成功 - AI完整回复内容`, undefined, {
                  requestId,
                  lineCount: jsonLines.length,
                  fullContentLength: fullContent.length,
                  fullContent: fullContent,
                  parsedData: data
                });
              } catch (parseError) {
                logger.warn(`[${requestId}] SSE 最后一个 data: 行解析失败，尝试合并所有 data: 行`, undefined, {
                  requestId,
                  error: parseError instanceof Error ? parseError.message : String(parseError)
                });
                
                // 降级方案：尝试合并所有 data: 行的内容
                // 这在某些 AI 服务返回分块内容时很有用
                try {
                  let combinedContent = '';
                  for (const line of jsonLines) {
                    try {
                      const parsed = JSON.parse(line);
                      if (parsed.choices?.[0]?.delta?.content) {
                        combinedContent += parsed.choices[0].delta.content;
                      } else if (parsed.choices?.[0]?.message?.content) {
                        combinedContent = parsed.choices[0].message.content;
                      }
                    } catch (e) {
                      // 忽略单个解析错误
                    }
                  }
                  
                  if (combinedContent) {
                    data = {
                      choices: [{
                        message: { content: combinedContent },
                        finish_reason: 'stop'
                      }]
                    };
                    logger.info(`[${requestId}] SSE 解析成功（合并所有 data: 行）- AI完整回复内容`, undefined, {
                      requestId,
                      combinedLength: combinedContent.length,
                      fullContent: combinedContent,
                      parsedData: data
                    });
                  } else {
                    logger.warn(`[${requestId}] SSE 合并所有 data: 行后仍无有效内容`, undefined, { requestId });
                    data = null;
                  }
                } catch (mergeError) {
                  logger.error(`[${requestId}] SSE 合并 data: 行失败`, mergeError instanceof Error ? mergeError.stack || mergeError.message : undefined, { requestId });
                  data = null;
                }
              }
            } else {
              logger.warn(`[${requestId}] SSE 解析：未找到有效的 data: 行`, undefined, { requestId });
              data = null;
            }
          } else {
            // 处理普通 JSON 格式
            try {
              data = JSON.parse(accumulatedData);
              logger.info(`[${requestId}] 普通 JSON 解析成功 - AI完整回复内容`, undefined, {
                requestId,
                parsedData: data
              });
            } catch (parseError) {
              logger.warn(`[${requestId}] 普通 JSON 解析失败`, undefined, {
                requestId,
                error: parseError instanceof Error ? parseError.message : String(parseError),
                rawDataLength: accumulatedData.length
              });
              data = null;
            }
          }
        } catch (e) {
          // ===== 出参日志：解析失败时记录完整原始数据（不截断） =====
          logger.error(`[${requestId}] 解析响应数据失败: ${e instanceof Error ? e.message : '未知错误'}`, e instanceof Error ? e.stack || e.message : undefined, {
            requestId,
            timestamp: completeTimeStr,
            rawData: accumulatedData
          });
          data = null;
        }
        
        // 修复：如果解析失败但有累积的原始数据，尝试从原始数据中提取内容
        if (!data && accumulatedData.length > 0) {
          logger.debug(`[${requestId}] 数据解析失败，尝试从原始累积数据中恢复`, undefined, { requestId });
          try {
            // 尝试直接解析原始数据中的内容部分
            const contentMatch = accumulatedData.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g);
            if (contentMatch && contentMatch.length > 0) {
              const lastContentMatch = contentMatch[contentMatch.length - 1];
              const contentValue = lastContentMatch.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
              if (contentValue) {
                const unescapedContent = contentValue.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                data = {
                  choices: [{
                    message: { content: unescapedContent },
                    finish_reason: 'stop'
                  }]
                };
                // ===== 出参日志：恢复的内容完整记录（不截断） =====
                logger.info(`[${requestId}] 从原始数据中恢复内容成功 - AI完整回复内容`, undefined, {
                  requestId,
                  restoredLength: unescapedContent.length,
                  fullContent: unescapedContent,
                  parsedData: data
                });
              }
            }
          } catch (recoveryError) {
            logger.warn(`[${requestId}] 从原始数据恢复内容失败`, undefined, {
              requestId,
              error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
            });
          }
        }
        
        // 发送流式响应完成信号
        // 【重点标记】修复：此前检查 data?.content?.length，但 SSE 解析后内容在
        // data?.choices?.[0]?.message?.content，导致日志永远显示 0 chars，误导诊断。
        const completeContentLength = data?.choices?.[0]?.message?.content?.length
          || data?.choices?.[0]?.text?.length
          || data?.content?.length
          || 0;
        console.log(`[ai-handler] [${requestId}] Sending ai:stream:complete event to renderer (content length: ${completeContentLength} chars, data is null: ${data === null})`);
        event.sender.send('ai:stream:complete', { data });
        console.log(`[ai-handler] [${requestId}] ai:stream:complete event sent`);
        
        // 清理 AbortController
        activeRequests.delete(senderId);
        
        return {
          success: true,
          data
        };
      } catch (fetchError) {
        // 清理 AbortController 和超时定时器
        activeRequests.delete(senderId);
        
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (connectionTimeoutId) {
          clearTimeout(connectionTimeoutId);
        }
        throw fetchError;
      }
    } else {
      // 普通响应
      // 使用 Node.js 的 fetch (Electron 支持)
      const controller = new AbortController();
      let timeoutId: NodeJS.Timeout | undefined;
      
      // 超时策略：连接超时（120s 兜底）+ 请求超时（默认 300s，调用方可覆盖）
      const CONNECTION_TIMEOUT = NON_STREAMING_CONNECTION_TIMEOUT;
      const effectiveTimeout = timeout === 0 ? 0 : (timeout || 300000); // 默认 300 秒请求超时

      // 设置连接超时检测
      let connectionTimeoutId: NodeJS.Timeout | undefined;
      if (CONNECTION_TIMEOUT > 0) {
        connectionTimeoutId = setTimeout(() => {
          logger.warn(`[${requestId}] AI 请求连接超时 (${CONNECTION_TIMEOUT}ms)，正在中止请求`, undefined, {
            requestId,
            timestamp: new Date().toISOString(),
            url: url,
            connectionTimeout: CONNECTION_TIMEOUT
          });
          controller.abort();
        }, CONNECTION_TIMEOUT);
      }
      
      // 设置请求超时（无超时限制）
      if (effectiveTimeout > 0) {
        timeoutId = setTimeout(() => {
          logger.warn(`[${requestId}] AI 请求响应超时 (${effectiveTimeout}ms)，正在中止请求`, undefined, {
            requestId,
            timestamp: new Date().toISOString(),
            url: url,
            requestTimeout: effectiveTimeout
          });
          controller.abort();
        }, effectiveTimeout);
      }
      
      logger.info(`[${requestId}] 正在发送请求到 ${url}...`, undefined, {
        requestId,
        timestamp: startTimeStr,
        url: url,
        method: method,
        connectionTimeout: CONNECTION_TIMEOUT,
        requestTimeout: effectiveTimeout > 0 ? effectiveTimeout : '无限制'
      });
      try {
        const response = await fetch(url, {
          method,
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
        
        // 连接成功，清除连接超时
        clearTimeout(connectionTimeoutId);
        
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        
        // 记录响应时间
        const endTime = new Date();
        const endTimeStr = endTime.toISOString();
        const responseTime = endTime.getTime() - startTime.getTime();
        
        logger.info(`[${requestId}] 收到响应，状态码: ${response.status}`, undefined, {
          requestId,
          timestamp: endTimeStr,
          status: response.status,
          statusText: response.statusText,
          url: url,
          response_time_ms: responseTime
        });
        
        if (!response.ok) {
          try {
            const errorText = await response.text();
            logger.error(`[${requestId}] 响应失败: ${response.status} ${response.statusText}`, undefined, {
              requestId,
              errorType: 'NetworkError',
              errorLocation: 'aiHandlers.ts:handleRequest:nonStreaming:responseNotOk',
              timestamp: endTimeStr,
              status: response.status,
              statusText: response.statusText,
              url: url,
              method: method,
              response_time_ms: responseTime,
              errorText: errorText
            });
            
            // 尝试解析错误响应
            let errorDetails = errorText;
            try {
              const errorJson = JSON.parse(errorText);
              errorDetails = JSON.stringify(errorJson, null, 2);
            } catch (e) {
              // 非JSON错误响应，使用原始文本
            }
            
            return {
              success: false,
              error: `HTTP ${response.status}: ${response.statusText}`,
              details: errorDetails,
              statusCode: response.status,
              statusText: response.statusText
            };
          } catch (textError) {
            logger.error(`[${requestId}] 读取错误响应失败: ${textError instanceof Error ? textError.message : '未知错误'}`, textError instanceof Error ? textError.stack || textError.message : undefined, {
              requestId,
              timestamp: new Date().toISOString(),
              status: response.status,
              url: url,
              response_time_ms: responseTime
            });
            return {
              success: false,
              error: `HTTP ${response.status}: ${response.statusText}`,
              details: '无法读取错误响应内容',
              statusCode: response.status,
              statusText: response.statusText
            };
          }
        }
        
        try {
          const data = await response.json();
          // ===== 出参日志：完整记录非流式响应数据（不截断） =====
          logger.info(`[${requestId}] 响应成功 - AI完整回复内容`, undefined, {
            requestId,
            timestamp: new Date().toISOString(),
            data_length: JSON.stringify(data).length,
            response_time_ms: responseTime,
            parsedData: data
          });
          return {
            success: true,
            data
          };
        } catch (jsonError) {
          logger.error(`[${requestId}] 解析JSON响应失败: ${jsonError instanceof Error ? jsonError.message : '未知错误'}`, jsonError instanceof Error ? jsonError.stack || jsonError.message : undefined, {
            requestId,
            errorType: 'SyntaxError',
            errorLocation: 'aiHandlers.ts:handleRequest:nonStreaming:jsonParse',
            timestamp: new Date().toISOString(),
            url: url,
            method: method,
            response_time_ms: responseTime
          });
          return {
            success: false,
            error: '解析响应失败',
            details: `无法解析API响应为JSON: ${jsonError instanceof Error ? jsonError.message : '未知错误'}`
          };
        }
      } catch (fetchError) {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        throw fetchError;
      }
    }
  } catch (error) {
    // 记录异常时间
    const endTime = new Date();
    const endTimeStr = endTime.toISOString();
    const responseTime = endTime.getTime() - startTime.getTime();
    
    logger.error(`[${requestId}] 请求异常: ${error instanceof Error ? error.message : '未知错误'}`, error instanceof Error ? error.stack || error.message : undefined, {
      requestId,
      errorType: error instanceof Error ? error.name : 'UnknownError',
      errorLocation: 'aiHandlers.ts:handleRequest:catch',
      timestamp: endTimeStr,
      response_time_ms: responseTime,
      requestConfig: {
        url: requestConfig.url,
        method: requestConfig.method,
        timeout: requestConfig.timeout,
        streaming: requestConfig.streaming
      }
    });
    
    // 检查是否为网络错误
    if (error instanceof Error) {
      if (error.message.includes('fetch failed')) {
        logger.error(`[${requestId}] 网络错误: 无法连接到API服务器`, error.stack || error.message, {
          requestId,
          errorType: 'NetworkError',
          errorLocation: 'aiHandlers.ts:handleRequest:catch:networkError',
          timestamp: endTimeStr,
          url: requestConfig.url,
          method: requestConfig.method,
          response_time_ms: responseTime
        });
        return {
          success: false,
          error: '网络错误: 无法连接到API服务器',
          details: '请检查服务器是否运行或网络连接是否正常。如果使用本地服务器，请确保服务器已启动并监听在指定端口。',
          errorType: 'network'
        };
      } else if (error.message.includes('abort')) {
        logger.error(`[${requestId}] 请求超时: API请求超过了设定的超时时间`, error.stack || error.message, {
          requestId,
          errorType: 'TimeoutError',
          errorLocation: 'aiHandlers.ts:handleRequest:catch:timeoutError',
          timestamp: endTimeStr,
          url: requestConfig.url,
          method: requestConfig.method,
          timeout: requestConfig.timeout,
          response_time_ms: responseTime
        });
        return {
          success: false,
          error: '请求超时',
          details: 'API请求超过了设定的超时时间，请检查服务器响应速度或增加超时设置。',
          errorType: 'timeout'
        };
      } else if (error.message.includes('No response body')) {
        logger.error(`[${requestId}] 响应错误: API服务器没有返回响应体`, error.stack || error.message, {
          requestId,
          errorType: 'ResponseError',
          errorLocation: 'aiHandlers.ts:handleRequest:catch:responseError',
          timestamp: endTimeStr,
          url: requestConfig.url,
          method: requestConfig.method,
          response_time_ms: responseTime
        });
        return {
          success: false,
          error: '响应错误',
          details: 'API服务器没有返回响应体，请检查服务器配置。',
          errorType: 'response'
        };
      }
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
      details: String(error),
      errorType: 'unknown'
    };
  }
});

// 获取 AI 引擎可用模型列表（OpenAI 兼容 /v1/models 端点）
ipcMain.handle('ai:listModels', async (_event, params: { apiUrl?: string; apiKey?: string; apiKeyTransmission?: string }) => {
  try {
    const { apiUrl, apiKey } = params;
    if (!apiUrl) {
      return { success: false, models: [], error: '未配置 API 地址' };
    }

    const baseUrl = apiUrl
      .replace(/\/chat\/completions$/, '')
      .replace(/\/completions$/, '')
      .replace(/\/embeddings$/, '')
      .replace(/\/models$/, '')
      .replace(/\/$/, '');
    const modelsUrl = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }

    logger.info(`Fetching AI models from: ${modelsUrl}`);
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, models: [], error: `获取模型列表失败 (${response.status}): ${errorText}` };
    }

    const data = await response.json();
    if (data.data && Array.isArray(data.data)) {
      const modelIds = data.data
        .map((item: any) => item.id || item.model || item.name)
        .filter(Boolean);
      logger.info(`Found ${modelIds.length} AI models`);
      return { success: true, models: modelIds };
    }

    return { success: false, models: [], error: 'API 响应格式不正确' };
  } catch (error) {
    return { success: false, models: [], error: error instanceof Error ? error.message : '未知错误' };
  }
});

// 探测 AI 模型能力（Spec: add-model-capability-detection-and-image-recognition / Task 3）
// 并行探测 vision / thinking / tool-calling 等能力，供前端在连通性测试后展示徽章
ipcMain.handle('ai:probeCapabilities', async (_event, args: {
  apiUrl: string;
  apiKey: string;
  apiKeyTransmission: string;
  modelName: string;
}) => {
  try {
    const capabilities = await aiService.probeAllCapabilities({
      baseUrl: args.apiUrl,
      apiKey: args.apiKey,
      apiKeyTransmission: args.apiKeyTransmission,
      modelName: args.modelName,
    });
    return { success: true, capabilities };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

export default {};
