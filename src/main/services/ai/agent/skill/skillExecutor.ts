/**
 * 技能执行器
 *
 * Agent 技能库（对标 OpenClaw skill 管理体系）的执行核心。
 * 根据技能类型（SkillType）分发执行：
 * - prompt：渲染提示词模板（{{var}} 插值），返回渲染后的 systemPrompt / userPrompt
 * - tool-sequence：按步骤顺序调用 toolRegistry 中注册的工具，结果可被后续步骤引用
 * - composite：调用通过 registerCompositeHandler 注册的代码 handler
 *
 * 设计要点：
 * - 模板插值防御式实现：缺失键 → 空字符串，不抛错（与 spec 约束一致）
 * - tool-sequence 每步耗时追踪，构建 trace 数组供调用方观测执行过程
 * - 非可选步骤（optional !== true）失败时立即中止整个序列，返回已执行的 trace
 * - 工具未注册时返回结构化错误（与 agentLoop 的 `工具「name」未注册` 风格一致），不抛错
 * - composite handler 缺失时返回结构化错误，不抛错
 *
 * 与 agentLoop 的区别：
 * - agentLoop 是「模型决策 → 工具执行 → 再决策」的多轮循环，工具由模型选择；
 * - skillExecutor 是「按预定义步骤序列执行」，步骤在 SkillManifest 中静态声明，
 *   适合可复用、可版本化的结构化能力（如「角色设定核查」= 检索世界书 + 检索历史 + 比对）。
 */

import type { AgentToolContext } from '../agentTypes'
import { toolRegistry } from '../toolRegistry'
import type {
  SkillManifest,
  SkillResult,
} from './skillTypes'
import { createLogger } from '../../../logger'

const logger = createLogger('skill-executor')

/** composite 类型的代码 handler 签名 */
type CompositeHandler = (
  input: Record<string, any>,
  context?: AgentToolContext
) => Promise<SkillResult>

class SkillExecutor {
  /** composite handler 引用名 → 代码 handler 映射 */
  private compositeHandlers = new Map<string, CompositeHandler>()

  /**
   * 注册 composite 类型的代码 handler
   *
   * composite 技能在 manifest 中通过 implementation.handlerRef 声明引用名，
   * 实际的代码逻辑由调用方通过本方法注册。这样技能清单（数据）与 handler（代码）解耦，
   * 清单可序列化为 JSON 持久化，handler 在代码中注册。
   *
   * @param handlerRef 引用名（与 manifest.implementation.handlerRef 对应）
   * @param handler 代码 handler，接收 input 与 context，返回 SkillResult
   */
  registerCompositeHandler(handlerRef: string, handler: CompositeHandler): void {
    this.compositeHandlers.set(handlerRef, handler)
    logger.info(`已注册 composite handler: ${handlerRef}`)
  }

  /**
   * 调用技能
   *
   * 按 manifest.type 分发到对应的执行路径，统一返回 SkillResult。
   * 任何执行路径都不向调用方抛错（除非 toolRegistry.getTool 等基础设施异常），
   * 失败时返回 { success: false, error }。
   *
   * @param manifest 技能清单
   * @param input 输入参数（供模板插值与工具调用使用）
   * @param context 工具执行上下文（角色卡ID/项目ID/会话ID 等，透传给工具 handler）
   */
  async invoke(
    manifest: SkillManifest,
    input: Record<string, any>,
    context?: AgentToolContext
  ): Promise<SkillResult> {
    // 防御：implementation 缺失
    if (!manifest.implementation) {
      return { success: false, error: `技能「${manifest.id}」未定义 implementation` }
    }

    switch (manifest.type) {
      case 'prompt':
        return this.invokePrompt(manifest, input)
      case 'tool-sequence':
        return this.invokeToolSequence(manifest, input, context)
      case 'composite':
        return this.invokeComposite(manifest, input, context)
      default:
        return {
          success: false,
          error: `技能「${manifest.id}」类型未知: ${(manifest as { type: string }).type}`,
        }
    }
  }

  /**
   * 执行 prompt 类型技能
   *
   * 渲染 implementation.prompt.systemPrompt（插值 {{var}} / {{input.xxx}}），
   * 若存在 userPromptTemplate 则一并渲染。返回渲染后的提示词供调用方拼装消息。
   *
   * 注意：prompt 类型不调用任何工具，results 为空对象。
   */
  private invokePrompt(
    manifest: SkillManifest,
    input: Record<string, any>
  ): SkillResult {
    const promptDef = manifest.implementation.prompt
    if (!promptDef) {
      return { success: false, error: `技能「${manifest.id}」类型为 prompt 但未定义 implementation.prompt` }
    }
    // prompt 类型无前序结果，results 传空对象
    const results: Record<string, any> = {}
    const systemPrompt = this.renderTemplate(promptDef.systemPrompt, input, results)
    const data: Record<string, any> = { systemPrompt }
    if (promptDef.userPromptTemplate) {
      data.userPrompt = this.renderTemplate(promptDef.userPromptTemplate, input, results)
    }
    return { success: true, data }
  }

  /**
   * 执行 tool-sequence 类型技能
   *
   * 按 implementation.steps 顺序执行：
   * 1. 渲染 step.argsTemplate（插值 {{input.xxx}} 与 {{<resultKey>}} / {{<resultKey>.data.field}}）
   * 2. JSON.parse 渲染后的字符串为工具参数对象
   * 3. 通过 toolRegistry.getTool(step.toolName) 获取工具
   * 4. 调用 tool.handler(args, context)，将结果存入 results[step.resultKey]
   * 5. 非可选步骤（optional !== true）失败时中止，返回已执行的 trace
   * 6. 全部成功后返回 { success: true, data: results, trace }
   *
   * 每步记录耗时，构建 trace 数组供调用方观测执行过程。
   */
  private async invokeToolSequence(
    manifest: SkillManifest,
    input: Record<string, any>,
    context?: AgentToolContext
  ): Promise<SkillResult> {
    const steps = manifest.implementation.steps
    if (!steps || steps.length === 0) {
      return { success: false, error: `技能「${manifest.id}」类型为 tool-sequence 但未定义 implementation.steps` }
    }

    /** 各步骤结果按 resultKey 索引（供后续步骤模板引用） */
    const results: Record<string, any> = {}
    /** 执行轨迹（每步结果 + 耗时） */
    const trace: Array<{ step: string; result: any; durationMs: number }> = []

    for (const step of steps) {
      const startTime = Date.now()

      // 1. 渲染参数模板
      const renderedArgs = this.renderTemplate(step.argsTemplate, input, results)
      // 2. 解析为参数对象
      let args: Record<string, any>
      try {
        args = JSON.parse(renderedArgs)
      } catch {
        // 渲染后非合法 JSON：包装为原始字符串（防御式，不抛错）
        logger.warn(
          `技能「${manifest.id}」步骤「${step.resultKey}」argsTemplate 渲染后非合法 JSON，以原始字符串包装传递`
        )
        args = { _raw: renderedArgs }
      }

      // 3. 获取工具
      const tool = toolRegistry.getTool(step.toolName)
      if (!tool) {
        // 工具未注册：与 agentLoop 风格一致，返回结构化错误
        const result = { success: false, error: `工具「${step.toolName}」未注册` }
        trace.push({ step: step.resultKey, result, durationMs: Date.now() - startTime })
        // 工具缺失视为步骤失败，按 optional 规则决定是否中止
        if (step.optional !== true) {
          return { success: false, error: result.error, trace }
        }
        // 可选步骤失败：记录空结果后继续
        results[step.resultKey] = result
        continue
      }

      // 4. 调用工具 handler
      let result: any
      try {
        result = await tool.handler(args, context)
      } catch (err) {
        // handler 抛错：捕获为结构化失败结果，不崩序列（与 agentLoop 一致）
        result = {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }

      const durationMs = Date.now() - startTime
      trace.push({ step: step.resultKey, result, durationMs })
      results[step.resultKey] = result

      // 5. 非可选步骤失败 → 中止
      if (!result.success && step.optional !== true) {
        logger.warn(
          `技能「${manifest.id}」步骤「${step.resultKey}」失败，中止序列: ${result.error}`
        )
        return { success: false, error: result.error, trace }
      }
    }

    return { success: true, data: results, trace }
  }

  /**
   * 执行 composite 类型技能
   *
   * 按 implementation.handlerRef 查找已注册的代码 handler 并调用。
   * handler 缺失时返回结构化错误（不抛错）。
   */
  private async invokeComposite(
    manifest: SkillManifest,
    input: Record<string, any>,
    context?: AgentToolContext
  ): Promise<SkillResult> {
    const handlerRef = manifest.implementation.handlerRef
    if (!handlerRef) {
      return {
        success: false,
        error: `技能「${manifest.id}」类型为 composite 但未定义 implementation.handlerRef`,
      }
    }
    const handler = this.compositeHandlers.get(handlerRef)
    if (!handler) {
      return {
        success: false,
        error: `composite handler「${handlerRef}」未注册`,
      }
    }
    return await handler(input, context)
  }

  /**
   * 模板插值：替换 {{...}} 占位符
   *
   * 支持的占位符格式：
   * - {{varName}}：顶层输入变量（input.varName）；若 results 中有同名 key 则优先取 results
   * - {{input.xxx}}：嵌套输入访问（input.xxx，支持多级 dot 路径）
   * - {{input}}：整个 input 对象
   * - {{resultKey}}：前序步骤的完整结果（results.resultKey）
   * - {{resultKey.data.field}}：前序步骤结果的嵌套字段（results.resultKey.data.field）
   *
   * 防御式行为：
   * - 缺失键 → 替换为空字符串（不抛错）
   * - 对象值 → JSON.stringify
   * - 原始值 → String(value)
   *
   * @param template 模板字符串
   * @param input 技能输入参数
   * @param results 前序步骤结果映射（resultKey → ToolCallResult）
   */
  private renderTemplate(
    template: string,
    input: Record<string, any>,
    results: Record<string, any>
  ): string {
    if (!template) return ''
    // 匹配 {{ ... }} 占位符（非贪婪，允许内部空格）
    // callback 签名 (match, p1, ...)；仅需 p1（捕获组=键名），故首参以下划线前缀标记未使用
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key: string) => {
      const value = this.resolveTemplateValue(key.trim(), input, results)
      if (value === undefined || value === null) return ''
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
    })
  }

  /**
   * 解析模板占位符键为实际值
   *
   * 解析优先级：
   * 1. key === 'input' → 整个 input 对象
   * 2. key 以 'input.' 开头 → input 的嵌套路径访问
   * 3. key 无点：
   *    - 若在 results 中 → 返回 results[key]（前序步骤结果）
   *    - 否则若在 input 中 → 返回 input[key]（顶层输入变量）
   * 4. key 有点：
   *    - 第一段若在 results 中 → results[firstSegment] 的嵌套路径访问
   *    - 第一段若在 input 中 → input[firstSegment] 的嵌套路径访问
   *    - 否则 undefined（缺失）
   */
  private resolveTemplateValue(
    key: string,
    input: Record<string, any>,
    results: Record<string, any>
  ): any {
    // 1. 整个 input 对象
    if (key === 'input') return input
    // 2. input.xxx 嵌套路径
    if (key.startsWith('input.')) {
      const pathSegments = key.slice('input.'.length).split('.')
      return this.resolvePath(input, pathSegments)
    }
    const dotIndex = key.indexOf('.')
    // 3. 无点：resultKey 或顶层输入变量
    if (dotIndex === -1) {
      if (key in results) return results[key]
      if (key in input) return input[key]
      return undefined
    }
    // 4. 有点：第一段是 resultKey 或 input 顶层键
    const firstSegment = key.substring(0, dotIndex)
    const restPath = key.substring(dotIndex + 1).split('.')
    if (firstSegment in results) {
      return this.resolvePath(results[firstSegment], restPath)
    }
    if (firstSegment in input) {
      return this.resolvePath(input[firstSegment], restPath)
    }
    return undefined
  }

  /** 按路径段数组逐级访问对象字段（任一级为 null/undefined 即返回 undefined） */
  private resolvePath(obj: any, pathSegments: string[]): any {
    let current = obj
    for (const seg of pathSegments) {
      if (current === null || current === undefined) return undefined
      current = current[seg]
    }
    return current
  }
}

/** 技能执行器单例，全局共享 */
export const skillExecutor = new SkillExecutor()
