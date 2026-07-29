/**
 * 工具协议适配层
 *
 * 工具调用智能体引擎（方向 0）的协议适配组件。
 * 统一不同厂商工具调用协议差异，提供三个核心能力：
 * - buildToolsParam：将内部 AgentTool[] 转为 OpenAI 兼容的 tools 请求体
 * - parseToolCalls：从模型响应中解析出统一格式的 ToolCallRequest[]（兼容新版 tool_calls 与旧版 function_call）
 * - buildToolResultMessage：将工具执行结果转为 role:'tool' 的 ChatMessage，用于回填 messages
 *
 * 供 toolRegistry / agentLoop 共用。本模块为无状态纯函数集合，导出单例对象。
 */

import type { ChatMessage } from '../../AIService';
import type { AgentTool, ToolCallRequest, ToolCallResult } from './agentTypes';

/** OpenAI 兼容的 tools 请求体元素类型 */
interface OpenaiToolParam {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

/**
 * 安全解析工具调用 arguments 字符串
 *
 * 【容错要点】arguments 在协议中是 JSON 字符串，但部分模型可能返回：
 * - 非法 JSON（截断、转义错误等）
 * - 空字符串 / undefined / null
 * - 解析后为非对象类型（数组、原始值）
 *
 * 本函数任何情况下都不抛错：
 * - 空/非字符串：返回 `{}`
 * - 合法对象：返回解析后的对象
 * - 非对象（数组/原始值）或解析失败：返回 `{ _raw: 原始字符串 }`，交由工具 handler 自行处理
 */
function safeParseArguments(argsStr: unknown): Record<string, any> {
  // 非字符串或空字符串：统一返回空对象
  if (typeof argsStr !== 'string' || argsStr === '') {
    return {};
  }

  try {
    const parsed = JSON.parse(argsStr);
    // 仅当解析结果为普通对象时直接采用；数组与原始值（数字/字符串/布尔/null）兜底为 _raw
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
    return { _raw: argsStr };
  } catch {
    // JSON 解析失败：保留原始字符串，不抛错，让工具 handler 决定如何处理
    return { _raw: argsStr };
  }
}

/**
 * 将 AgentTool[] 转换为 OpenAI 兼容的 tools 请求体格式
 *
 * 每个工具转为 `{ type:'function', function:{ name, description, parameters } }`，
 * 直接透传 AgentTool.parameters（JSONSchema）。空数组时返回空数组（调用方据此
 * 决定是否在请求体中写入 tools 字段）。
 */
function buildToolsParam(tools: AgentTool[]): OpenaiToolParam[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * 从模型响应中解析出统一格式的 ToolCallRequest[]
 *
 * 必须兼容两种协议格式：
 * - 格式 A（OpenAI 新版，tool_calls 数组）：
 *     `response.choices[0].message.tool_calls` 为数组，每项含
 *     `{ id, type:'function', function:{ name, arguments(JSON 字符串) } }`
 * - 格式 B（旧版 function_call，单工具）：
 *     `response.choices[0].message.function_call` 为对象，含
 *     `{ name, arguments(JSON 字符串) }`；无 id 字段，构造 fallback id
 *
 * 优先尝试格式 A；若无 tool_calls 再尝试格式 B；两者皆无返回空数组 `[]`。
 *
 * 入参 response 为 fetch 返回的完整 JSON（含 choices[0].message）。
 * 每个返回项含 `{ id, name, arguments, raw }`，raw 保留原始 tool_call/function_call
 * 对象供调试；arguments 解析失败时容错为 `{ _raw: 原始字符串 }`，不抛错。
 */
function parseToolCalls(response: any): ToolCallRequest[] {
  // 防御性：response 结构异常（无 choices[0].message）时直接返回空数组
  const message = response?.choices?.[0]?.message;
  if (!message || typeof message !== 'object') {
    return [];
  }

  const result: ToolCallRequest[] = [];

  // 格式 A：OpenAI 新版 tool_calls 数组
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    for (let i = 0; i < message.tool_calls.length; i++) {
      const tc = message.tool_calls[i];
      // 缺少 function.name 的异常元素跳过（不阻断其余正常元素解析）
      const name = tc?.function?.name;
      if (!name) {
        continue;
      }
      result.push({
        id: tc?.id ?? `fallback_${Date.now()}_${i}`,
        name,
        arguments: safeParseArguments(tc?.function?.arguments),
        raw: tc,
      });
    }
    return result;
  }

  // 格式 B：旧版 function_call（单工具）
  if (message.function_call && typeof message.function_call === 'object') {
    const fc = message.function_call;
    const name = fc.name;
    if (!name) {
      return [];
    }
    result.push({
      id: `fallback_${Date.now()}_0`,
      name,
      arguments: safeParseArguments(fc.arguments),
      raw: fc,
    });
    return result;
  }

  // 两种格式均未命中：无工具调用
  return [];
}

/**
 * 将工具执行结果转为 role:'tool' 的 ChatMessage，用于回填到 messages 数组
 *
 * OpenAI 协议要求 tool 消息 content 为字符串，故对 result 做 JSON.stringify。
 * result 形如 `{ success:true, data:... }` 或 `{ success:false, error:'...' }`。
 */
function buildToolResultMessage(
  toolCallId: string,
  toolName: string,
  result: ToolCallResult
): ChatMessage {
  return {
    role: 'tool',
    content: JSON.stringify(result),
    tool_call_id: toolCallId,
    name: toolName,
  };
}

/**
 * 工具协议适配器单例
 *
 * 三个方法均为无状态纯函数，直接以对象形式导出，供 agentLoop / toolRegistry 调用：
 * - buildToolsParam(tools)
 * - parseToolCalls(response)
 * - buildToolResultMessage(toolCallId, toolName, result)
 */
export const toolProtocolAdapter = {
  buildToolsParam,
  parseToolCalls,
  buildToolResultMessage,
};
