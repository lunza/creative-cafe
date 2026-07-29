/**
 * 写作模式工具集
 *
 * 工具调用智能体引擎（方向 0）的验证用真实工具集。
 * 当前为占位实现，写作模式将在方向 B（写作智能体）完善。
 *
 * 导出 writingTools: AgentTool[]，由 tools/index.ts 的 registerBuiltinTools
 * 统一通过 toolRegistry.registerGroup('writing', ...) 注册。
 *
 * 含工具：
 * - readOutline：读取写作项目大纲（占位，真实注册以证明 writing 组可用）
 */

import type { AgentTool, ToolCallResult } from '../agentTypes'

/**
 * 工具：readOutline —— 读取写作项目大纲
 *
 * 占位实现：真实注册到 writing 组，证明引擎可按组拉取写作工具。
 * 实际写作大纲读取逻辑将在方向 B 实现，当前明确返回"未对接"错误（不抛错）。
 *
 * 参数 schema 为空对象（`{type:'object', properties:{}}`），不接收任何参数。
 */
const readOutlineTool: AgentTool = {
  name: 'readOutline',
  description: '读取写作大纲。（占位：写作模式对接将在方向 B 完善）',
  parameters: {
    type: 'object',
    properties: {},
  },
  async handler(): Promise<ToolCallResult> {
    // 占位实现：方向 B 接入后替换为真实读取逻辑
    // 明确返回结构化"未对接"信息，不抛错（任务约束：handler 必须 try-catch，失败返回 {success:false, error}）
    return {
      success: false,
      error: '写作模式尚未对接，readOutline 工具为占位实现，将在方向 B（写作智能体）完善',
    }
  },
}

/** 写作模式工具集（供 registerBuiltinTools 通过 registerGroup 批量注册） */
export const writingTools: AgentTool[] = [readOutlineTool]
