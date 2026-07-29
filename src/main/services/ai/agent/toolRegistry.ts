/**
 * 工具注册中心
 *
 * 工具调用智能体引擎（方向 0）的核心组件之一。
 * 负责按组（AgentToolGroup）注册、查询工具定义（AgentTool），
 * 供 toolProtocolAdapter 在构造模型请求时拉取可用工具列表，
 * 供 agentLoop 在收到工具调用请求时按名称解析到具体执行器。
 *
 * 设计要点：
 * - 同名工具禁止重复注册（register 时抛错，让调用方尽早发现问题）
 * - 组内工具保持注册顺序，多组查询时按组顺序合并并去重
 * - 导出单例 toolRegistry，全局共享；测试可用 clear() 重置
 */

import type { AgentTool, AgentToolGroup } from './agentTypes'
import { createLogger } from '../../logger'

const logger = createLogger('agent-registry')

class ToolRegistry {
  /** 工具名 → 工具定义 */
  private tools = new Map<string, AgentTool>()
  /** 工具名 → 所属组 */
  private toolGroups = new Map<string, AgentToolGroup>()
  /** 组名 → 工具名列表（保持注册顺序） */
  private groupTools = new Map<AgentToolGroup, string[]>()

  /** 注册单个工具到指定组 */
  register(group: AgentToolGroup, tool: AgentTool): void {
    // 防重复注册：同名工具抛错，让调用方尽早发现问题
    if (this.tools.has(tool.name)) {
      throw new Error(`工具「${tool.name}」已注册，不可重复注册`)
    }
    this.tools.set(tool.name, tool)
    this.toolGroups.set(tool.name, group)
    const list = this.groupTools.get(group) ?? []
    list.push(tool.name)
    this.groupTools.set(group, list)
    logger.info(`已注册工具: ${tool.name} (组: ${group})`)
  }

  /** 批量注册工具到指定组 */
  registerGroup(group: AgentToolGroup, tools: AgentTool[]): void {
    for (const tool of tools) {
      this.register(group, tool)
    }
  }

  /** 获取单个工具定义 */
  getTool(name: string): AgentTool | undefined {
    return this.tools.get(name)
  }

  /** 判断工具是否存在 */
  hasTool(name: string): boolean {
    return this.tools.has(name)
  }

  /** 按组获取工具定义列表（保持注册顺序，多个组时按组顺序合并并去重） */
  getTools(groups: AgentToolGroup[]): AgentTool[] {
    const result: AgentTool[] = []
    const seen = new Set<string>()
    for (const group of groups) {
      const names = this.groupTools.get(group) ?? []
      for (const name of names) {
        // 多组查询去重：同一工具名只输出一次
        if (!seen.has(name)) {
          const tool = this.tools.get(name)
          if (tool) {
            result.push(tool)
            seen.add(name)
          }
        }
      }
    }
    return result
  }

  /** 列出所有已注册工具（调试用） */
  listAll(): Array<{ tool: AgentTool; group: AgentToolGroup }> {
    const result: Array<{ tool: AgentTool; group: AgentToolGroup }> = []
    for (const [name, tool] of this.tools) {
      const group = this.toolGroups.get(name)
      if (group) {
        result.push({ tool, group })
      }
    }
    return result
  }

  /** 清空所有注册（主要供测试用） */
  clear(): void {
    this.tools.clear()
    this.toolGroups.clear()
    this.groupTools.clear()
  }
}

/** 工具注册中心单例，全局共享 */
export const toolRegistry = new ToolRegistry()
