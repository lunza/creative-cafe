/**
 * 工具调用智能体引擎核心循环
 *
 * 工具调用智能体引擎（方向 0）的心脏。
 * 实现「模型决策 → 工具执行 → 结果回填 → 再决策」的多轮循环，
 * 直到模型给出最终文本回复、触达迭代上限、或被外部取消。
 *
 * 核心约束：
 * - 降级路径零行为变更：当 `supportsToolCalling=false`（或 undefined）或工具集为空时，
 *   直接调用 `aiService.streamChatAPI`（不带 tools），返回
 *   `{ toolCallHistory: [], iterations: 0, stoppedReason: 'completed' }`，
 *   与扩展前的纯文本生成行为完全等价。
 * - 工具 handler 抛错不崩循环：每个工具调用 try-catch，失败时回填
 *   `{ success: false, error }` 给模型，循环继续。
 * - 同工具+同参数去重：以 `${toolName}:${JSON.stringify(args)}` 为 key
 *   缓存首次执行结果，命中缓存直接复用，不重复执行。
 *
 * 依赖：
 * - `aiService.callChatWithTools`：非流式带 tools 的模型调用
 * - `aiService.streamChatAPI`：降级路径 / 最终回复的流式纯文本生成
 * - `toolRegistry`：按组拉取工具定义 / 按名解析工具
 * - `toolProtocolAdapter`：构造 tools 请求体、解析 tool_calls、构造 tool 结果消息
 */

import { aiService } from '../../AIService'
import type { ChatMessage } from '../../AIService'
import { toolRegistry } from './toolRegistry'
import { toolProtocolAdapter } from './toolProtocolAdapter'
import type {
  AgentLoopParams,
  AgentLoopResult,
  AgentLoopOptions,
  AgentLoopCallbacks,
  ToolCallEvent,
} from './agentTypes'
import { createLogger } from '../../logger'

const logger = createLogger('agent-loop')

/** 默认最大迭代次数（模型决策 → 工具执行 → 再决策 计一轮） */
const DEFAULT_MAX_ITERATIONS = 8

/**
 * 运行工具调用智能体循环
 *
 * @param params.messages 初始消息（含 system / user 等），不会被修改
 * @param params.toolGroups 启用的工具组（如 ['dialogue', 'worldbook']）
 * @param params.context 工具执行上下文（角色卡ID / 项目ID / 会话ID 等）
 * @param params.options 运行选项（模型、温度、最大迭代、abortSignal 等）
 * @param params.callbacks 回调（onToolCall / onFinalChunk / onIteration）
 * @returns AgentLoopResult（含最终文本、工具调用历史、迭代次数、停止原因）
 */
export async function runAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
  const { messages, toolGroups, context, options, callbacks } = params
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const toolCallHistory: ToolCallEvent[] = []

  // ===== 降级检查 1：引擎/模型不支持工具调用 =====
  // supportsToolCalling=false 或 undefined 时直接走纯文本路径，零行为变更
  if (!options.supportsToolCalling) {
    logger.info('Agent 模式未启用或模型不支持工具调用，降级为纯文本生成')
    // onTurnComplete hook 在所有返回路径触发（供学习服务记录经验，可选回调，不传则零影响）
    const result = await runPlainTextFallback(messages, options, callbacks)
    callbacks?.onTurnComplete?.(result, context)
    return result
  }

  // ===== 降级检查 2：工具集为空 =====
  // 避免无工具可调却带空 tools 数组请求模型，仍走纯文本路径
  const tools = toolRegistry.getTools(toolGroups)
  if (tools.length === 0) {
    logger.warn(`未注册任何工具组 [${toolGroups.join(', ')}] 的工具，降级为纯文本生成`)
    const result = await runPlainTextFallback(messages, options, callbacks)
    callbacks?.onTurnComplete?.(result, context)
    return result
  }

  const toolsParam = toolProtocolAdapter.buildToolsParam(tools)

  // 去重缓存：key = `${toolName}:${JSON.stringify(args)}`，value = ToolCallEvent
  // 同工具+同参数命中缓存直接复用上次结果，不重复执行（避免模型重复调用相同工具）
  const dedupCache = new Map<string, ToolCallEvent>()

  // 工作副本 messages：循环中追加 assistant tool_calls 与 tool 结果消息
  // 用副本避免修改入参（防止调用方复用 messages 时被污染）
  const workingMessages: ChatMessage[] = [...messages]

  // 跟踪最后一次响应内容（max_iterations 时作为 fallback 返回，避免空内容丢失信息）
  let lastResponseContent = ''
  // 跟踪当前迭代序号（异常时作为 iterations 返回，告知调用方中断位置）
  let currentIteration = 0

  // ===== 整个循环过程 try-catch =====
  // 任何未预期错误（callChatWithTools / streamChatAPI / parseToolCalls 等抛错）
  // 统一返回 stoppedReason='error'，不向调用方抛出。
  // 注意：工具 handler 抛错已在循环内 try-catch 捕获并转为 {success:false,error}，
  //       不会触发此处 catch；此处捕获的是循环控制流本身的未预期错误。
  try {
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      currentIteration = iteration

      // 取消检查：每轮迭代开始前检查 abortSignal
      if (options.abortSignal?.aborted) {
        const result: AgentLoopResult = {
          finalContent: '',
          toolCallHistory,
          iterations: iteration - 1,
          stoppedReason: 'aborted',
        }
        callbacks?.onTurnComplete?.(result, context)
        return result
      }

      callbacks?.onIteration?.(iteration)
      logger.info(`Agent 循环迭代 ${iteration}/${maxIterations}`)

      // 1. 调用模型（带 tools，非流式）
      // callChatWithTools 返回 { content, tool_calls?, finish_reason, model }
      const response = await aiService.callChatWithTools(workingMessages, toolsParam, {
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        tool_choice: options.tool_choice,
        abortSignal: options.abortSignal,
        maxRetries: 2,
      })

      // 记录最后一次响应内容，供 max_iterations / 异常诊断使用
      lastResponseContent = response.content || ''

      // 2. 解析 tool_calls
      // 注意：callChatWithTools 已将 message.tool_calls 提取到顶层返回，
      // 但 parseToolCalls 期望原始 { choices:[{ message:{ tool_calls, function_call } }] } 结构，
      // 故需包装为兼容格式后再交给 parseToolCalls（统一 arguments 解析与容错逻辑）
      const wrappedResponse = {
        choices: [
          {
            message: {
              content: response.content,
              tool_calls: response.tool_calls,
            },
          },
        ],
      }
      const toolCalls = toolProtocolAdapter.parseToolCalls(wrappedResponse)

      // 3. 若无 tool_calls —— 最终回复
      if (toolCalls.length === 0) {
        // streamFinal !== false（含 undefined 默认为 true）：用 streamChatAPI 重新流式生成最终回复，
        //   让前端获得真实流式体验（多一次 API 调用，但保证流式输出）。
        // streamFinal === false：直接用 callChatWithTools 已返回的 content（省一次调用，无流式），
        //   仍通过 onFinalChunk 推送一次完整内容，保证订阅者收到内容。
        let finalContent: string
        if (options.streamFinal !== false) {
          const streamResult = await aiService.streamChatAPI(
            workingMessages,
            {
              model: options.model,
              temperature: options.temperature,
              maxTokens: options.maxTokens,
              abortSignal: options.abortSignal,
            },
            (chunk: string) => {
              callbacks?.onFinalChunk?.(chunk)
            }
          )
          finalContent = streamResult.content
        } else {
          finalContent = response.content || ''
          if (callbacks?.onFinalChunk) {
            callbacks.onFinalChunk(finalContent)
          }
        }
        const result: AgentLoopResult = {
          finalContent,
          toolCallHistory,
          iterations: iteration,
          stoppedReason: 'completed',
        }
        callbacks?.onTurnComplete?.(result, context)
        return result
      }

      // 4. 有 tool_calls —— 追加 assistant 消息（含原始 tool_calls 供模型回看上下文）
      // OpenAI 协议要求：回填 tool 结果前，assistant 消息必须含原始 tool_calls 结构（id/type/function）。
      // callChatWithTools 返回的 tool_calls 即为原始 OpenAI 格式数组，直接透传。
      workingMessages.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.tool_calls,
      })

      // 5. 并行执行所有 tool_calls（每个 handler 独立 try-catch，互不影响）
      const toolResults = await Promise.all(
        toolCalls.map(async (tc) => {
          const cacheKey = `${tc.name}:${JSON.stringify(tc.arguments)}`

          // 去重缓存命中：直接复用上次结果（不重复执行），仅更新 iteration 标记
          const cached = dedupCache.get(cacheKey)
          if (cached) {
            return { tc, event: { ...cached, iteration } }
          }

          const tool = toolRegistry.getTool(tc.name)
          const startTime = Date.now()
          let event: ToolCallEvent

          if (!tool) {
            // 工具未注册：返回 error 给模型，不崩循环
            event = {
              iteration,
              toolName: tc.name,
              arguments: tc.arguments,
              result: { success: false, error: `工具「${tc.name}」未注册` },
              durationMs: Date.now() - startTime,
            }
          } else {
            try {
              const result = await tool.handler(tc.arguments, context)
              // result.success=true 时保留 data；失败时统一为 { success:false, error }
              event = {
                iteration,
                toolName: tc.name,
                arguments: tc.arguments,
                result: result.success
                  ? result
                  : { success: false, error: result.error ?? '工具执行失败' },
                durationMs: Date.now() - startTime,
              }
            } catch (err) {
              // 关键：handler 抛错不崩循环，返回 error 给模型让其自行处理
              event = {
                iteration,
                toolName: tc.name,
                arguments: tc.arguments,
                result: {
                  success: false,
                  error: err instanceof Error ? err.message : String(err),
                },
                durationMs: Date.now() - startTime,
              }
            }
          }

          dedupCache.set(cacheKey, event)
          return { tc, event }
        })
      )

      // 6. 触发回调 + 追加 tool 结果消息
      for (const { tc, event } of toolResults) {
        toolCallHistory.push(event)
        callbacks?.onToolCall?.(event)
        workingMessages.push(toolProtocolAdapter.buildToolResultMessage(tc.id, tc.name, event.result))
      }

      // 继续下一轮迭代：模型基于已回填的 tool 结果再次决策
    }

    // 达到 maxIterations 仍未给出最终回复
    // 返回最后一次响应的 content（可能含部分文本），避免空内容丢失信息
    logger.warn(`Agent 循环达到最大迭代 ${maxIterations}，停止`)
    const maxIterResult: AgentLoopResult = {
      finalContent: lastResponseContent,
      toolCallHistory,
      iterations: maxIterations,
      stoppedReason: 'max_iterations',
    }
    callbacks?.onTurnComplete?.(maxIterResult, context)
    return maxIterResult
  } catch (err) {
    // 整个过程 try-catch：任何未预期错误返回 error 状态，不向调用方抛出
    // finalContent 置空（错误状态下内容不可靠）；调用方可通过 toolCallHistory 查看部分进度
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error(`Agent 循环异常（迭代 ${currentIteration}）: ${errMsg}`)
    const errResult: AgentLoopResult = {
      finalContent: '',
      toolCallHistory,
      iterations: currentIteration,
      stoppedReason: 'error',
      error: errMsg,
    }
    callbacks?.onTurnComplete?.(errResult, context)
    return errResult
  }
}

/**
 * 纯文本降级路径
 *
 * 直接调用 `aiService.streamChatAPI`（不带 tools），行为与现有完全一致：
 * - 通过 onChunk 回调推送流式 chunk
 * - 返回 toolCallHistory=[] / iterations=0 / stoppedReason='completed'
 *
 * 此路径是「增量零影响」的保证：不支持工具调用的模型 / 未注册工具的场景下，
 * 调用方得到的体验与扩展前完全相同。
 *
 * 注意：此函数不捕获 streamChatAPI 的异常——保持与现有调用方一致的错误传播行为
 * （streamChatAPI 内部已有重试逻辑，重试耗尽后抛错由调用方处理）。
 */
async function runPlainTextFallback(
  messages: ChatMessage[],
  options: AgentLoopOptions,
  callbacks?: AgentLoopCallbacks
): Promise<AgentLoopResult> {
  const result = await aiService.streamChatAPI(
    messages,
    {
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      abortSignal: options.abortSignal,
    },
    (chunk: string) => {
      callbacks?.onFinalChunk?.(chunk)
    }
  )

  return {
    finalContent: result.content,
    toolCallHistory: [],
    iterations: 0,
    stoppedReason: 'completed',
  }
}
