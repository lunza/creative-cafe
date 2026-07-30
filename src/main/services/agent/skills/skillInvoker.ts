/**
 * 技能调用分发 —— 适配 openclaw runtime/tool-dispatch.ts
 *
 * 来源：参考 openclaw src/skills/runtime/tool-dispatch.ts
 * 决策：自研（openclaw 依赖复杂策略管道：channel/provider/profile/agent/group/
 *       sender/sandbox/subagent，本项目首期仅支持通过 ToolRegistry 直接调用）。
 *
 * 职责：
 *  1. invokeSkill：根据 SkillCommandDispatchSpec 分发技能调用
 *  2. dispatch kind='tool'：委托给 ToolRegistry.executeTool
 *  3. 返回 ToolExecutionResult（成功/失败 + 内容 + continueLoop）
 *
 * 设计约束（openclaw tool-dispatch 设计）：
 *  - 技能调用最终落到工具执行（首期仅支持 kind='tool'）
 *  - 调用前校验技能可用性（exposure + invocation 策略）
 *  - 调用前校验调用方权限（用户调用 vs 模型调用）
 *  - 失败转为 ToolExecutionResult，不抛异常（保持 agentLoop 稳定）
 */

import type { SkillEntry } from './types';
import type { ToolCallContext, ToolExecutionResult, IToolProvider } from '../contracts';
import { resolveSkillCommandSpec } from './skillContract';
import { evaluateSkillAvailability, type SkillAvailabilityContext } from './skillAvailability';

// ==================== 调用方类型 ====================

/**
 * 技能调用方类型（用于权限校验）。
 *
 * - user: 用户通过命令面板手动调用（需 userInvocable=true）
 * - model: 模型自主调用（需 disableModelInvocation=false）
 */
export type SkillInvokeSource = 'user' | 'model';

// ==================== 调用结果 ====================

/**
 * 技能调用结果（扩展 ToolExecutionResult，附加技能级元数据）。
 */
export interface SkillInvokeResult extends ToolExecutionResult {
  /** 被调用的技能名 */
  skillName: string;
  /** 被调用的工具名（若通过工具分发） */
  toolName?: string;
  /** 调用方 */
  invokedBy: SkillInvokeSource;
}

// ==================== 调用分发 ====================

/**
 * 调用技能。
 *
 * 流程：
 *  1. 校验技能是否存在（entry 非空）
 *  2. 校验调用方权限（user 需 userInvocable，model 需 !disableModelInvocation）
 *  3. 校验技能可用性（requires.env/config + skillFilter）
 *  4. 解析 SkillCommandSpec（若无 dispatch 配置，返回错误）
 *  5. 按 dispatch.kind 分发：
 *     - 'tool'：委托 ToolProvider.executeTool(toolName, args, context)
 *
 * @param entry 技能条目
 * @param args 调用参数
 * @param context 工具调用上下文
 * @param options 调用选项（调用方 + 工具提供方 + 可用性上下文）
 * @returns SkillInvokeResult
 */
export async function invokeSkill(
  entry: SkillEntry,
  args: Record<string, unknown>,
  context: ToolCallContext | undefined,
  options: {
    invokedBy: SkillInvokeSource;
    toolProvider: IToolProvider;
    availabilityContext?: SkillAvailabilityContext;
  }
): Promise<SkillInvokeResult> {
  const { invokedBy, toolProvider, availabilityContext } = options;
  const skillName = entry.skill.name;

  // 1. 调用方权限校验
  if (invokedBy === 'user') {
    const userInvocable = entry.exposure?.userInvocable ?? entry.invocation?.userInvocable ?? true;
    if (!userInvocable) {
      return {
        success: false,
        content: `Skill "${skillName}" is not user-invocable.`,
        continueLoop: false,
        skillName,
        invokedBy,
      };
    }
  } else if (invokedBy === 'model') {
    const disableModelInvocation = entry.invocation?.disableModelInvocation ?? false;
    if (disableModelInvocation) {
      return {
        success: false,
        content: `Skill "${skillName}" has model invocation disabled.`,
        continueLoop: false,
        skillName,
        invokedBy,
      };
    }
  }

  // 2. 可用性校验（requires.env/config + skillFilter）
  if (!evaluateSkillAvailability(entry, availabilityContext ?? {})) {
    return {
      success: false,
      content: `Skill "${skillName}" is not available in the current context (missing requires or filtered out).`,
      continueLoop: false,
      skillName,
      invokedBy,
    };
  }

  // 3. 解析命令分发规格
  const commandSpec = resolveSkillCommandSpec(entry);
  if (!commandSpec) {
    // 无 command-name 配置，技能仅注入 prompt，不可调用
    return {
      success: false,
      content: `Skill "${skillName}" has no command dispatch configured (prompt-only skill).`,
      continueLoop: false,
      skillName,
      invokedBy,
    };
  }

  if (!commandSpec.dispatch) {
    // 有 command-name 但无 dispatch 配置
    return {
      success: false,
      content: `Skill "${skillName}" has command "${commandSpec.name}" but no dispatch configuration.`,
      continueLoop: false,
      skillName,
      invokedBy,
    };
  }

  // 4. 按 dispatch.kind 分发
  const dispatch = commandSpec.dispatch;
  if (dispatch.kind === 'tool') {
    return invokeViaTool(entry, dispatch.toolName, args, context, toolProvider, invokedBy);
  }

  // 未知 dispatch kind
  return {
    success: false,
    content: `Skill "${skillName}" has unknown dispatch kind: ${(dispatch as { kind: string }).kind}`,
    continueLoop: false,
    skillName,
    invokedBy,
  };
}

/**
 * 通过工具提供方调用技能。
 *
 * @param entry 技能条目
 * @param toolName 工具名
 * @param args 调用参数
 * @param context 工具调用上下文
 * @param toolProvider 工具提供方
 * @param invokedBy 调用方
 */
async function invokeViaTool(
  entry: SkillEntry,
  toolName: string,
  args: Record<string, unknown>,
  context: ToolCallContext | undefined,
  toolProvider: IToolProvider,
  invokedBy: SkillInvokeSource
): Promise<SkillInvokeResult> {
  const skillName = entry.skill.name;

  // 检查工具是否可用
  if (!toolProvider.isToolAvailable(toolName, context)) {
    return {
      success: false,
      content: `Tool "${toolName}" required by skill "${skillName}" is not available in the current context.`,
      continueLoop: false,
      skillName,
      toolName,
      invokedBy,
    };
  }

  // 执行工具
  try {
    const result = await toolProvider.executeTool(toolName, args, context);
    return {
      ...result,
      skillName,
      toolName,
      invokedBy,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      content: `Skill "${skillName}" invocation failed via tool "${toolName}": ${errMsg}`,
      continueLoop: true, // 让模型知道失败，决定下一步
      skillName,
      toolName,
      invokedBy,
    };
  }
}

// ==================== 批量调用 ====================

/**
 * 批量调用技能（顺序执行，失败不中断后续）。
 *
 * @param entries 技能条目列表
 * @param argsList 参数列表（与 entries 一一对应）
 * @param context 工具调用上下文
 * @param options 调用选项
 * @returns 每个技能的调用结果
 */
export async function invokeSkillsBatch(
  entries: SkillEntry[],
  argsList: Record<string, unknown>[],
  context: ToolCallContext | undefined,
  options: {
    invokedBy: SkillInvokeSource;
    toolProvider: IToolProvider;
    availabilityContext?: SkillAvailabilityContext;
  }
): Promise<SkillInvokeResult[]> {
  if (entries.length !== argsList.length) {
    throw new Error(`Entries length (${entries.length}) does not match args length (${argsList.length})`);
  }

  const results: SkillInvokeResult[] = [];
  for (let i = 0; i < entries.length; i++) {
    const result = await invokeSkill(entries[i], argsList[i], context, options);
    results.push(result);
  }
  return results;
}
