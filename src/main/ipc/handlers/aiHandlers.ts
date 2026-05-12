import { ipcMain } from 'electron';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

/**
 * AI 请求处理器
 * 用于处理 AI 翻译、润色等请求，避免前端直接发送请求导致的 CORS 问题
 */

// 日志配置
const LOG_CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_FILES: 5,
  LOG_DIR: 'logs',
  LOG_FILE: 'ai-handler.log'
};

// 日志级别
const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG'
};

// 获取日志目录路径
const getLogDir = (): string => {
  return path.join(process.cwd(), LOG_CONFIG.LOG_DIR);
};

// 获取日志文件路径
const getLogPath = (): string => {
  return path.join(getLogDir(), LOG_CONFIG.LOG_FILE);
};

// 检查并执行日志文件轮转
const rotateLogFile = () => {
  try {
    const logPath = getLogPath();
    if (!fs.existsSync(logPath)) {
      return;
    }

    const stats = fs.statSync(logPath);
    if (stats.size >= LOG_CONFIG.MAX_FILE_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = path.join(getLogDir(), `ai-handler-${timestamp}.log`);

      fs.renameSync(logPath, rotatedPath);

      const existingLogs = fs.readdirSync(getLogDir())
        .filter(file => file.startsWith('ai-handler-') && file.endsWith('.log'))
        .sort()
        .reverse();

      while (existingLogs.length >= LOG_CONFIG.MAX_FILES) {
        const oldestLog = existingLogs.pop();
        if (oldestLog) {
          fs.unlinkSync(path.join(getLogDir(), oldestLog));
        }
      }
    }
  } catch (e) {
    console.error('Failed to rotate log file:', e);
  }
};

// 简单日志函数
const logToFile = (level: string, message: string, details?: string) => {
  try {
    const logDir = getLogDir();
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    rotateLogFile();

    const logPath = getLogPath();
    const timestamp = new Date().toISOString();
    const displayTime = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const levelPrefix = `[${level.padEnd(5)}]`;
    const timePrefix = `[${displayTime}]`;
    let logMessage = `${timePrefix} ${levelPrefix} ${message}`;

    if (details) {
      logMessage += `\n${' '.repeat(20)}${details.split('\n').join('\n' + ' '.repeat(20))}`;
    }

    fs.appendFileSync(logPath, logMessage + '\n\n');
  } catch (e) {
    console.error('Failed to write to log file:', e);
  }
};

// 详细日志函数
const logDetailed = (level: string, title: string, data: any) => {
  try {
    const details = JSON.stringify(data, null, 2);
    logToFile(level, `${title}`, details);
  } catch (e) {
    logToFile(level, `${title}: ${String(data)}`);
  }
};

// 错误日志
const logError = (message: string, error?: Error, context?: any) => {
  const errorDetails = error ? `Error: ${error.message}\nStack: ${error.stack || 'No stack'}` : '';
  const contextDetails = context ? `Context: ${JSON.stringify(context, null, 2)}` : '';
  const details = [errorDetails, contextDetails].filter(Boolean).join('\n');
  logToFile(LOG_LEVELS.ERROR, message, details);
  console.error(`[AI Handler] ${message}`, error, context);
};

// 警告日志
const logWarn = (message: string, context?: any) => {
  const contextDetails = context ? `Context: ${JSON.stringify(context, null, 2)}` : '';
  logToFile(LOG_LEVELS.WARN, message, contextDetails);
  console.warn(`[AI Handler] ${message}`, context);
};

// 信息日志
const logInfo = (message: string, context?: any) => {
  const contextDetails = context ? `Context: ${JSON.stringify(context, null, 2)}` : '';
  logToFile(LOG_LEVELS.INFO, message, contextDetails);
  console.info(`[AI Handler] ${message}`, context);
};

// 调试日志
const logDebug = (message: string, context?: any) => {
  const contextDetails = context ? `Context: ${JSON.stringify(context, null, 2)}` : '';
  logToFile(LOG_LEVELS.DEBUG, message, contextDetails);
  console.debug(`[AI Handler] ${message}`, context);
};

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
    logInfo('AI 请求已被用户取消', { senderId });
    return { success: true };
  }
  logWarn('没有找到活跃的 AI 请求可取消', { senderId });
  return { success: false };
});

// 处理 AI 请求
ipcMain.handle('ai:request', async (event, requestConfig: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
  timeout?: number;
  streaming?: boolean;
}) => {
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
    
    logInfo(`收到AI请求: ${method} ${url}`, {
      timestamp: startTimeStr,
      method: method,
      url: url,
      timeout: timeout,
      streaming: streaming
    });
    logDebug('请求头', sanitizedHeaders);
    
    // 打印完整请求体摘要（消息列表结构）
    if (sanitizedBody.messages && Array.isArray(sanitizedBody.messages)) {
      console.debug(`[AI Handler] === 请求体（完整messages） ===`);
      console.debug(`[AI Handler] model: ${sanitizedBody.model || 'N/A'}`);
      console.debug(`[AI Handler] stream: ${sanitizedBody.stream || false}`);
      console.debug(`[AI Handler] messages 数量: ${sanitizedBody.messages.length}`);

      // 打印system消息的前缀日志（方便确认拼接状态）
      const systemMsg = sanitizedBody.messages.find((m: any) => m.role === 'system');
      if (systemMsg && systemMsg.content) {
        const systemContent = systemMsg.content;
        const systemPreviewLen = Math.min(500, systemContent.length);
        const systemPreview = systemContent.substring(0, systemPreviewLen).replace(/\n/g, '\\n');
        const systemSuffix = systemContent.length > systemPreviewLen ? `... (${systemContent.length - systemPreviewLen} more chars)` : '';
        logDebug(`System消息摘要`, `长度=${systemContent.length}, 预览: ${systemPreview}${systemSuffix}`);
      }

      sanitizedBody.messages.forEach((msg: any, idx: number) => {
        const contentLen = msg.content ? msg.content.length : 0;
        const previewLen = Math.min(500, contentLen);
        const preview = msg.content ? msg.content.substring(0, previewLen).replace(/\n/g, '\\n') : '(empty)';
        const suffix = contentLen > previewLen ? `... (${contentLen - previewLen} more chars)` : '';
        console.debug(`[AI Handler]   message[${idx}] role=${msg.role}, content长度=${contentLen}: ${preview}${suffix}`);
      });
      // 同时输出完整 JSON 字符串到日志文件（不受 DevTools 截断影响）
      const fullBodyStr = JSON.stringify(sanitizedBody, null, 2);
      logToFile(LOG_LEVELS.DEBUG, '请求体（完整JSON）', fullBodyStr);
      console.debug(`[AI Handler] === 请求体结束（完整JSON已写入日志文件） ===`);
    } else {
      logDebug('请求体', sanitizedBody);
    }
    
    // 输入验证
    if (!url || typeof url !== 'string') {
      const errorMsg = '无效的API URL';
      logError(errorMsg, undefined, {
        errorType: 'ValidationError',
        errorLocation: 'aiHandlers.ts:186:handleRequest',
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
      logError(errorMsg, undefined, {
        errorType: 'ValidationError',
        errorLocation: 'aiHandlers.ts:200:handleRequest',
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
      
      // 超时策略
      const CONNECTION_TIMEOUT = 0; // 无连接超时限制
      const effectiveTimeout = timeout === 0 ? 0 : (timeout || 0); // timeout为0或undefined时无超时限制
      
      activeRequests.set(senderId, { controller, timeoutId: undefined, connectionTimeoutId: undefined });
      
      logInfo(`正在发送流式请求到 ${url}...`, {
        timestamp: startTimeStr,
        url: url,
        method: method,
        connectionTimeout: CONNECTION_TIMEOUT,
        requestTimeout: effectiveTimeout > 0 ? effectiveTimeout : '无限制'
      });
      
      // 设置连接超时检测（无超时限制）
      if (CONNECTION_TIMEOUT > 0) {
        connectionTimeoutId = setTimeout(() => {
          logWarn(`AI 请求连接超时 (${CONNECTION_TIMEOUT}ms)，正在中止请求`, {
            timestamp: new Date().toISOString(),
            url: url,
            connectionTimeout: CONNECTION_TIMEOUT
          });
          controller?.abort();
        }, CONNECTION_TIMEOUT);
      }
      
      // 设置请求超时（无超时限制）
      if (effectiveTimeout > 0) {
        timeoutId = setTimeout(() => {
          logWarn(`AI 请求响应超时 (${effectiveTimeout}ms)，正在中止请求`, {
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
        
        logInfo(`收到响应，状态码: ${response.status}`, {
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
            logError(`响应失败: ${response.status} ${response.statusText}`, undefined, {
              errorType: 'NetworkError',
              errorLocation: 'aiHandlers.ts:256:handleRequest',
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
            logError(`读取错误响应失败: ${textError instanceof Error ? textError.message : '未知错误'}`, textError, {
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
        
        logInfo('开始读取流式响应数据...', {
          timestamp: new Date().toISOString(),
          url: url
        });
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            logInfo('流式数据读取完成 (done=true)', {
              timestamp: new Date().toISOString(),
              total_chunks: chunkCount,
              total_bytes: totalBytesReceived,
              accumulated_data_length: accumulatedData.length,
              total_time_ms: Date.now() - streamReadStartTime
            });
            break;
          }
          
          chunkCount++;
          const chunkSize = value.length;
          totalBytesReceived += chunkSize;
          
          // 解码响应数据
          const chunk = new TextDecoder().decode(value);
          accumulatedData += chunk;
          
          // 发送流式数据到渲染进程
          try {
            event.sender.send('ai:stream', {
              chunk,
              chunkIndex: chunkCount,
              chunkSize,
              accumulatedData
            });
          } catch (sendError) {
            logError(`发送流式数据到渲染进程失败 (chunk ${chunkCount})`, sendError instanceof Error ? sendError : undefined, {
              timestamp: new Date().toISOString(),
              chunk_index: chunkCount,
              error: sendError instanceof Error ? sendError.message : String(sendError)
            });
          }
        }
        
        // 记录响应完成时间
        const completeTime = new Date();
        const completeTimeStr = completeTime.toISOString();
        const totalTime = completeTime.getTime() - startTime.getTime();
        const streamReadTime = Date.now() - streamReadStartTime;
        
        logInfo(`流式响应完成`, {
          timestamp: completeTimeStr,
          total_chunks: chunkCount,
          total_bytes: totalBytesReceived,
          accumulated_data_length: accumulatedData.length,
          stream_read_time_ms: streamReadTime,
          total_request_time_ms: totalTime
        });
        
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
                logInfo('[AI Handler] SSE 解析成功 - AI完整回复内容', {
                  lineCount: jsonLines.length,
                  fullContentLength: fullContent.length,
                  fullContent: fullContent
                });
              } catch (parseError) {
                logWarn('SSE 最后一个 data: 行解析失败，尝试合并所有 data: 行', {
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
                    logDebug('SSE 解析成功（合并所有 data: 行）', {
                      combinedLength: combinedContent.length
                    });
                  } else {
                    logWarn('SSE 合并所有 data: 行后仍无有效内容');
                    data = null;
                  }
                } catch (mergeError) {
                  logError('SSE 合并 data: 行失败', mergeError instanceof Error ? mergeError : undefined);
                  data = null;
                }
              }
            } else {
              logWarn('SSE 解析：未找到有效的 data: 行');
              data = null;
            }
          } else {
            // 处理普通 JSON 格式
            try {
              data = JSON.parse(accumulatedData);
              logDebug('普通 JSON 解析成功');
            } catch (parseError) {
              logWarn('普通 JSON 解析失败', {
                error: parseError instanceof Error ? parseError.message : String(parseError),
                rawDataLength: accumulatedData.length
              });
              data = null;
            }
          }
        } catch (e) {
          logError(`解析响应数据失败: ${e instanceof Error ? e.message : '未知错误'}`, e as Error, {
            timestamp: completeTimeStr,
            rawData: accumulatedData.substring(0, 500) + '...'
          });
          data = null;
        }
        
        // 修复：如果解析失败但有累积的原始数据，尝试从原始数据中提取内容
        if (!data && accumulatedData.length > 0) {
          logDebug('数据解析失败，尝试从原始累积数据中恢复');
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
                logDebug('从原始数据中恢复内容成功', {
                  restoredLength: unescapedContent.length
                });
              }
            }
          } catch (recoveryError) {
            logWarn('从原始数据恢复内容失败', {
              error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
            });
          }
        }
        
        // 发送流式响应完成信号
        event.sender.send('ai:stream:complete', { data });
        
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
      
      // 超时策略
      const CONNECTION_TIMEOUT = 0; // 无连接超时限制
      const effectiveTimeout = timeout === 0 ? 0 : (timeout || 0); // timeout为0或undefined时无超时限制
      
      // 设置连接超时检测（无超时限制）
      let connectionTimeoutId: NodeJS.Timeout | undefined;
      if (CONNECTION_TIMEOUT > 0) {
        connectionTimeoutId = setTimeout(() => {
          logWarn(`AI 请求连接超时 (${CONNECTION_TIMEOUT}ms)，正在中止请求`, {
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
          logWarn(`AI 请求响应超时 (${effectiveTimeout}ms)，正在中止请求`, {
            timestamp: new Date().toISOString(),
            url: url,
            requestTimeout: effectiveTimeout
          });
          controller.abort();
        }, effectiveTimeout);
      }
      
      logInfo(`正在发送请求到 ${url}...`, {
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
        
        logInfo(`收到响应，状态码: ${response.status}`, {
          timestamp: endTimeStr,
          status: response.status,
          statusText: response.statusText,
          url: url,
          response_time_ms: responseTime
        });
        
        if (!response.ok) {
          try {
            const errorText = await response.text();
            logError(`响应失败: ${response.status} ${response.statusText}`, undefined, {
              errorType: 'NetworkError',
              errorLocation: 'aiHandlers.ts:414:handleRequest',
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
            logError(`读取错误响应失败: ${textError instanceof Error ? textError.message : '未知错误'}`, textError, {
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
          logInfo(`响应成功，返回数据长度: ${JSON.stringify(data).length} 字符`, {
            timestamp: new Date().toISOString(),
            length: JSON.stringify(data).length,
            response_time_ms: responseTime
          });
          return {
            success: true,
            data
          };
        } catch (jsonError) {
          logError(`解析JSON响应失败: ${jsonError instanceof Error ? jsonError.message : '未知错误'}`, jsonError, {
            errorType: 'SyntaxError',
            errorLocation: 'aiHandlers.ts:468:handleRequest',
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
    
    logError(`请求异常: ${error instanceof Error ? error.message : '未知错误'}`, error instanceof Error ? error : undefined, {
      errorType: error instanceof Error ? error.name : 'UnknownError',
      errorLocation: 'aiHandlers.ts:492:handleRequest',
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
        logError('网络错误: 无法连接到API服务器', error, {
          errorType: 'NetworkError',
          errorLocation: 'aiHandlers.ts:506:handleRequest',
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
        logError('请求超时: API请求超过了设定的超时时间', error, {
          errorType: 'TimeoutError',
          errorLocation: 'aiHandlers.ts:519:handleRequest',
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
        logError('响应错误: API服务器没有返回响应体', error, {
          errorType: 'ResponseError',
          errorLocation: 'aiHandlers.ts:532:handleRequest',
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

export default {};
