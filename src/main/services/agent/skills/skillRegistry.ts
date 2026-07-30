/**
 * 技能注册中心 —— ISkillRegistry 实现
 *
 * 来源：spec §二 Task 14.1f（ISkillRegistry 实现：register/get/list/buildSnapshot/invoke）
 * 决策：自研（openclaw 的技能注册分散在 discovery/skill-index + loading/workspace，
 *       本项目按 ISkillRegistry 契约自研精简注册中心）。
 *
 * 职责：
 *  1. register/unregister：技能注册与注销
 *  2. get/list：技能查询
 *  3. buildSnapshot：构建会话快照（委托 skillSnapshot.resolveSkillSnapshot）
 *  4. invoke：调用技能（委托 skillInvoker.invokeSkill）
 *
 * 设计约束（contracts.ts ISkillRegistry）：
 *  - 工具名唯一：防止重复注册（与 ToolRegistry 一致）
 *  - 快照缓存：进程级 LRU（避免重复构建 prompt）
 *  - 调用分发：委托 IToolProvider，不直接执行工具
 */

import type {
  ISkillRegistry,
  IToolProvider,
  ToolCallContext,
  ToolExecutionResult,
} from '../contracts';
import type { SkillEntry } from './types';
import { resolveSkillSnapshot, clearSkillSnapshotCache } from './skillSnapshot';
import { invokeSkill, type SkillInvokeSource, type SkillInvokeResult } from './skillInvoker';
import type { SkillAvailabilityContext } from './skillAvailability';
import { resolveSkillKey } from './skillContract';

// ==================== SkillRegistry 实现 ====================

/**
 * 技能注册中心。
 *
 * 实现 ISkillRegistry 接口，管理 SKILL.md 技能的注册、查询、快照、调用。
 *
 * 用法：
 * ```ts
 * const registry = new SkillRegistry();
 * registry.setToolProvider(toolRegistry);
 *
 * // 加载内置技能
 * const entries = await loadBuiltinSkills();
 * for (const entry of entries) {
 *   registry.register(entry);
 * }
 *
 * // 构建快照注入 prompt
 * const snapshotPrompt = registry.buildSnapshot(['plot-check', 'chapter-write']);
 *
 * // 调用技能
 * const result = await registry.invoke('plot-check', { chapterId: 'ch1' }, context);
 * ```
 */
export class SkillRegistry implements ISkillRegistry {
  private readonly skills = new Map<string, SkillEntry>();
  private toolProvider: IToolProvider | null = null;
  private availabilityContext: SkillAvailabilityContext = {};

  /**
   * 设置工具提供方（技能调用分发依赖）。
   *
   * 由 AgentCore 或 IPC handler 在初始化时注入。
   */
  setToolProvider(provider: IToolProvider): void {
    this.toolProvider = provider;
  }

  /**
   * 设置可用性上下文（requires.env/config 校验用）。
   */
  setAvailabilityContext(ctx: SkillAvailabilityContext): void {
    this.availabilityContext = ctx;
  }

  /**
   * 注册技能。
   *
   * @param entry 技能条目
   * @throws Error 若技能名已存在
   */
  register(entry: SkillEntry): void {
    const key = entry.skill.name;
    if (this.skills.has(key)) {
      throw new Error(`Skill already registered: ${key}`);
    }
    this.skills.set(key, entry);
    clearSkillSnapshotCache(); // 注册变更，清空快照缓存
  }

  /**
   * 注销技能。
   */
  unregister(skillName: string): void {
    if (this.skills.delete(skillName)) {
      clearSkillSnapshotCache(); // 注销变更，清空快照缓存
    }
  }

  /**
   * 获取技能条目。
   */
  get(skillName: string): SkillEntry | undefined {
    return this.skills.get(skillName);
  }

  /**
   * 按 skillKey 获取技能条目（备选查找路径）。
   */
  getBySkillKey(skillKey: string): SkillEntry | undefined {
    for (const entry of this.skills.values()) {
      if (resolveSkillKey(entry) === skillKey) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * 列出所有技能条目。
   */
  list(): SkillEntry[] {
    return Array.from(this.skills.values());
  }

  /**
   * 构建会话快照（注入 prompt 的可用技能列表）。
   *
   * 委托 skillSnapshot.resolveSkillSnapshot（带进程级 LRU 缓存）。
   *
   * @param filter 技能过滤白名单（undefined 表示不过滤）
   * @returns 快照 prompt 文本（直接拼接到 system prompt 末尾）
   */
  buildSnapshot(filter?: string[]): string {
    const entries = this.list();
    const snapshot = resolveSkillSnapshot(entries, {
      ...this.availabilityContext,
      skillFilter: filter ?? this.availabilityContext.skillFilter,
    });
    return snapshot.prompt;
  }

  /**
   * 构建完整快照对象（含 skills 列表 + 元数据）。
   *
   * 与 buildSnapshot 的差异：返回完整 SkillSnapshot 对象，便于持久化或比对。
   */
  buildFullSnapshot(filter?: string[]) {
    const entries = this.list();
    return resolveSkillSnapshot(entries, {
      ...this.availabilityContext,
      skillFilter: filter ?? this.availabilityContext.skillFilter,
    });
  }

  /**
   * 调用技能（双调用策略：模型调用 / 用户调用）。
   *
   * 委托 skillInvoker.invokeSkill，需先设置 toolProvider。
   *
   * @param skillName 技能名
   * @param args 调用参数
   * @param context 工具调用上下文
   * @returns 执行结果
   */
  async invoke(
    skillName: string,
    args: Record<string, unknown>,
    context?: ToolCallContext
  ): Promise<ToolExecutionResult> {
    const entry = this.get(skillName);
    if (!entry) {
      return {
        success: false,
        content: `Skill not found: ${skillName}. Available skills: ${this.list().map(e => e.skill.name).join(', ')}`,
        continueLoop: false,
      };
    }

    if (!this.toolProvider) {
      return {
        success: false,
        content: `Skill registry has no tool provider configured. Cannot invoke skill "${skillName}".`,
        continueLoop: false,
      };
    }

    // 默认视为模型调用（agentLoop 主路径）
    const invokedBy: SkillInvokeSource = 'model';
    const result = await invokeSkill(entry, args, context, {
      invokedBy,
      toolProvider: this.toolProvider,
      availabilityContext: this.availabilityContext,
    });

    // 剥离 SkillInvokeResult 的额外字段，返回 ToolExecutionResult 契约
    return {
      success: result.success,
      content: result.content,
      continueLoop: result.continueLoop,
    };
  }

  /**
   * 用户手动调用技能（命令面板触发）。
   *
   * 与 invoke 的差异：invokedBy='user'，校验 userInvocable 权限。
   */
  async invokeByUser(
    skillName: string,
    args: Record<string, unknown>,
    context?: ToolCallContext
  ): Promise<SkillInvokeResult> {
    const entry = this.get(skillName);
    if (!entry) {
      return {
        success: false,
        content: `Skill not found: ${skillName}.`,
        continueLoop: false,
        skillName,
        invokedBy: 'user',
      };
    }

    if (!this.toolProvider) {
      return {
        success: false,
        content: `Skill registry has no tool provider configured.`,
        continueLoop: false,
        skillName,
        invokedBy: 'user',
      };
    }

    return invokeSkill(entry, args, context, {
      invokedBy: 'user',
      toolProvider: this.toolProvider,
      availabilityContext: this.availabilityContext,
    });
  }

  /**
   * 批量注册技能。
   */
  registerAll(entries: SkillEntry[]): void {
    for (const entry of entries) {
      try {
        this.register(entry);
      } catch (err) {
        console.warn(`[SkillRegistry] Failed to register skill "${entry.skill.name}":`, err);
      }
    }
  }

  /**
   * 清空所有注册的技能。
   */
  clear(): void {
    this.skills.clear();
    clearSkillSnapshotCache();
  }

  /**
   * 获取已注册技能数量。
   */
  size(): number {
    return this.skills.size;
  }
}

// ==================== 单例 ====================

let registryInstance: SkillRegistry | null = null;

/**
 * 获取 SkillRegistry 单例。
 */
export function getSkillRegistry(): SkillRegistry {
  if (!registryInstance) {
    registryInstance = new SkillRegistry();
  }
  return registryInstance;
}

/**
 * 重置 SkillRegistry 单例（仅测试用）。
 */
export function resetSkillRegistry(): void {
  registryInstance = null;
}
