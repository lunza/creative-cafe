/**
 * 工具入口聚合
 *
 * 工具调用智能体引擎（方向 0）。
 * 统一通过 registerBuiltinTools() 将各工具组的 AgentTool[] 数组批量注册到 toolRegistry，
 * 避免在模块导入时产生 side-effect 注册带来的初始化时序不确定性。
 *
 * 调用方（如 agentLoop 初始化处）只需调用 registerBuiltinTools() 即可将全部验证用工具注册到 toolRegistry。
 *
 * 当前注册的工具：
 * - dialogue 组：searchWorldbook / searchChatHistory
 * - worldbook 组：searchEntries
 * - writing 组：readOutline（占位）
 * - foundation 组：invokeSkill / searchMemories / recordMemory / discoverSkills
 *   （技能库与记忆系统基础工具组，供 Agent 自主调用技能与读写长期记忆）
 */

import { toolRegistry } from '../toolRegistry'
import { dialogueTools } from './dialogueTools'
import { worldbookTools } from './worldbookTools'
import { writingTools } from './writingTools'
import { agentFoundationTools } from './agentFoundationTools'

let registered = false

/**
 * 注册所有内置工具到 toolRegistry（幂等，仅注册一次）。
 *
 * 通过 module-level `registered` 标志保证多次调用不会触发重复注册
 * （toolRegistry.register 同名工具会抛错，幂等标志从源头避免该路径）。
 * 测试场景如需重新注册，可先 toolRegistry.clear() 后重置本模块状态
 * （当前未导出重置接口，测试可通过 toolRegistry.clear() + 重新加载模块实现）。
 */
export function registerBuiltinTools(): void {
  if (registered) return
  toolRegistry.registerGroup('dialogue', dialogueTools)
  toolRegistry.registerGroup('worldbook', worldbookTools)
  toolRegistry.registerGroup('writing', writingTools)
  toolRegistry.registerGroup('foundation', agentFoundationTools)
  registered = true
}
