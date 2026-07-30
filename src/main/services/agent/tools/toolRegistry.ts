/**
 * ToolRegistry —— IToolProvider 实现（工具注册中心）
 *
 * 来源：spec §二 Task 7.3 + Task 10（tableEdit 注册为 updateStateTable 工具）
 * 决策：自研（spec §三）。openclaw 的工具注册分散在 plugin 系统，本项目按
 *       IToolProvider 契约自研精简版，支持三组工具（dialogue/writing/worldbook）。
 *
 * 职责：
 *  1. 注册/注销工具（含描述符 + 执行器）
 *  2. 按可用性表达式过滤工具（evaluateAvailability）
 *  3. 将 ToolDescriptor 转换为 OpenAI ToolDefinition 格式
 *  4. 执行工具调用（通过 sandbox 隔离）
 *
 * 设计约束（openclaw AGENTS.md）：
 *  - 工具描述是 prompt：description 返回模型下一步需要的信息
 *  - 声明式可用性：通过 availability 表达式 gating，而非运行时试错
 *  - 工具名唯一：防止重复注册（spec §5.1 双轨并行，三组工具不冲突）
 *  - 降级保护：工具执行失败转为 ToolExecutionResult，不中断 agentLoop
 */

import type {
  IToolProvider,
  ToolCallContext,
  ToolExecutionResult,
  ToolDefinition,
} from '../contracts';
import type { ToolDescriptor, AvailabilityContext } from './types';
import { evaluateAvailability } from './types';

// ==================== 类型定义 ====================

/**
 * 工具执行器函数签名。
 *
 * 接收解析后的参数和上下文，返回执行结果。
 * 由 sandbox 包装（超时 + 异常捕获）。
 */
export type ToolExecutor = (
  args: Record<string, unknown>,
  context?: ToolCallContext
) => Promise<ToolExecutionResult>;

/**
 * 已注册工具条目（描述符 + 执行器）。
 */
interface RegisteredTool {
  descriptor: ToolDescriptor;
  executor: ToolExecutor;
}

// ==================== ToolRegistry 实现 ====================

/**
 * 工具注册中心。
 *
 * 实现 IToolProvider 接口，管理工具的注册、查询、执行。
 *
 * 工具分组：
 *  - dialogue: 对话模式工具（searchWorldbook / searchHistory / updateStateTable / addMemoryNote）
 *  - writing: 写作模式工具（updateStateTable / plotCheck / outlineGenerate / ...）
 *  - worldbook: 世界书模式工具（createEntry / expandFromContext / ...）
 *
 * 用法：
 * ```ts
 * const registry = new ToolRegistry();
 * registry.register(updateStateTableDescriptor, updateStateTableExecutor);
 * registry.register(searchWorldbookDescriptor, searchWorldbookExecutor);
 *
 * // agentLoop 使用
 * const tools = registry.getToolDefinitions({ mode: 'dialogue' });
 * const result = await registry.executeTool('updateStateTable', args, context);
 * ```
 */
export class ToolRegistry implements IToolProvider {
  private readonly tools = new Map<string, RegisteredTool>();
  /** 可用性求值上下文（含配置/环境变量/能力） */
  private availabilityContext: AvailabilityContext = {};

  /**
   * 设置可用性求值上下文。
   *
   * 由调用方（AgentCore 或 IPC handler）在运行前注入：
   *  - getConfig: 读取配置项
   *  - getEnv: 读取环境变量
   *  - context: 业务上下文（mode / characterId 等）
   *  - capabilities: 模型能力
   */
  setAvailabilityContext(ctx: AvailabilityContext): void {
    this.availabilityContext = ctx;
  }

  /**
   * 注册工具。
   *
   * @param descriptor 工具描述符（含 name / description / inputSchema / availability）
   * @param executor 工具执行器
   * @throws Error 若工具名已存在
   */
  register(descriptor: ToolDescriptor, executor: ToolExecutor): void {
    if (this.tools.has(descriptor.name)) {
      throw new Error(`Tool already registered: ${descriptor.name}`);
    }
    this.tools.set(descriptor.name, { descriptor, executor });
  }

  /**
   * 注销工具。
   */
  unregister(toolName: string): void {
    this.tools.delete(toolName);
  }

  /**
   * 列出所有已注册工具的描述符。
   *
   * 不过滤可用性（用于 UI 展示或调试）。
   */
  listTools(): ToolDescriptor[] {
    return Array.from(this.tools.values()).map(t => t.descriptor);
  }

  /**
   * 获取可用工具的 OpenAI 格式定义。
   *
   * 按 availability 表达式过滤，仅返回当前上下文可用的工具。
   * 转换为 OpenAI tools 格式：{ type: 'function', function: { name, description, parameters } }
   *
   * @param context 工具调用上下文（用于可用性求值）
   */
  getToolDefinitions(context?: ToolCallContext): ToolDefinition[] {
    const mergedContext = this.mergeContext(context);
    const definitions: ToolDefinition[] = [];

    for (const { descriptor } of this.tools.values()) {
      // 求值可用性
      if (descriptor.availability) {
        const available = evaluateAvailability(descriptor.availability, mergedContext);
        if (!available) continue;
      }

      // 转换为 OpenAI 格式
      definitions.push({
        type: 'function',
        function: {
          name: descriptor.name,
          description: descriptor.description,
          parameters: descriptor.inputSchema as Record<string, unknown>,
        },
      });
    }

    return definitions;
  }

  /**
   * 执行工具调用。
   *
   * @param toolName 工具名
   * @param args 参数（已由 agentLoop 从 JSON 字符串解析）
   * @param context 工具调用上下文
   * @returns 执行结果
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context?: ToolCallContext
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        success: false,
        content: `Tool not found: ${toolName}. Available tools: ${this.listAvailableToolNames(context).join(', ')}`,
        continueLoop: false,
      };
    }

    // 检查可用性（运行时守卫，防止模型调用不可用工具）
    if (tool.descriptor.availability) {
      const mergedContext = this.mergeContext(context);
      if (!evaluateAvailability(tool.descriptor.availability, mergedContext)) {
        return {
          success: false,
          content: `Tool ${toolName} is not available in the current context.`,
          continueLoop: false,
        };
      }
    }

    // 执行工具（sandbox 由 agentLoop/lanes 负责，此处直接调用）
    return tool.executor(args, context);
  }

  /**
   * 检查工具是否可用。
   */
  isToolAvailable(toolName: string, context?: ToolCallContext): boolean {
    const tool = this.tools.get(toolName);
    if (!tool) return false;
    if (!tool.descriptor.availability) return true;
    return evaluateAvailability(tool.descriptor.availability, this.mergeContext(context));
  }

  /**
   * 列出当前上下文可用的工具名。
   */
  private listAvailableToolNames(context?: ToolCallContext): string[] {
    const mergedContext = this.mergeContext(context);
    const names: string[] = [];
    for (const { descriptor } of this.tools.values()) {
      if (!descriptor.availability || evaluateAvailability(descriptor.availability, mergedContext)) {
        names.push(descriptor.name);
      }
    }
    return names;
  }

  /**
   * 合并可用性求值上下文。
   *
   * 将 ToolCallContext（业务上下文）合并到 AvailabilityContext。
   * 过滤 undefined 值（JsonPrimitive 不包含 undefined）。
   */
  private mergeContext(context?: ToolCallContext): AvailabilityContext {
    const ctx: AvailabilityContext = { ...this.availabilityContext };
    if (context) {
      // 仅添加非 undefined 的值（AvailabilityContext.context 不含 undefined）
      const merged: Record<string, string | number | boolean | null> = {
        ...(ctx.context ?? {}),
      };
      if (context.sessionId !== undefined) merged.sessionId = context.sessionId;
      if (context.characterId !== undefined) merged.characterId = context.characterId;
      if (context.mode !== undefined) merged.mode = context.mode;
      if (context.userId !== undefined) merged.userId = context.userId;
      ctx.context = merged;
    }
    return ctx;
  }
}

// ==================== 单例 ====================

let registryInstance: ToolRegistry | null = null;

/**
 * 获取 ToolRegistry 单例。
 */
export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = new ToolRegistry();
  }
  return registryInstance;
}

/**
 * 重置 ToolRegistry 单例（仅测试用）。
 */
export function resetToolRegistry(): void {
  registryInstance = null;
}
