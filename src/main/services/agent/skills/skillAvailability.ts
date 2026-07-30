/**
 * 技能声明式可用性 —— 适配 openclaw discovery/status.ts
 *
 * 来源：参考 openclaw src/skills/discovery/status.ts + filter.ts
 * 决策：自研（openclaw 依赖 bins 探测/远程仓库等，本项目仅校验 requires.env/config）。
 *
 * 职责：
 *  1. 校验 SkillEntry 的 requires.env / requires.config 是否满足
 *  2. 校验 SkillExposure 是否允许在当前上下文可见
 *  3. 提供 agent 级过滤（skillFilter 白名单）
 *
 * 设计约束：
 *  - requires.bins/anyBins 首期不做实际探测（本项目无外部可执行文件依赖）
 *  - requires.env 校验环境变量存在性
 *  - requires.config 校验配置项存在性（通过 getConfig 回调）
 *  - 与 tools/types.ts 的 evaluateAvailability 解耦（技能可用性更复杂，含可见性判断）
 */

import type { SkillEntry } from './types';
import { resolveSkillKey, normalizeSkillName } from './skillContract';

// ==================== 可用性上下文 ====================

/**
 * 技能可用性求值上下文。
 */
export interface SkillAvailabilityContext {
  /** 环境变量读取函数（默认 process.env） */
  getEnv?: (name: string) => string | undefined;
  /** 配置项读取函数（requires.config 校验用） */
  getConfig?: (key: string) => unknown;
  /** agent 级技能过滤白名单（undefined 表示不过滤） */
  skillFilter?: string[];
  /** 会话级覆盖（按技能名/skillKey 启用/禁用） */
  skillOverrides?: Record<string, boolean>;
}

// ==================== 可用性求值 ====================

/**
 * 求值技能在当前上下文是否可用。
 *
 * 求值顺序（任一失败即返回 false）：
 *  1. exposure.includeInRuntimeRegistry（是否注册到运行时）
 *  2. requires.env（环境变量存在性）
 *  3. requires.config（配置项存在性）
 *  4. skillFilter（agent 级白名单）
 *  5. skillOverrides（会话级覆盖）
 *
 * @param entry 技能条目
 * @param ctx 可用性上下文
 * @returns true 表示技能可用
 */
export function evaluateSkillAvailability(
  entry: SkillEntry,
  ctx: SkillAvailabilityContext = {}
): boolean {
  // 1. 运行时注册检查
  if (entry.exposure?.includeInRuntimeRegistry === false) {
    return false;
  }

  // 2. requires.env 校验
  const requiresEnv = entry.metadata?.requires?.env;
  if (requiresEnv && requiresEnv.length > 0) {
    const getEnv = ctx.getEnv ?? ((name: string) => process.env[name]);
    for (const envName of requiresEnv) {
      if (getEnv(envName) === undefined) {
        return false;
      }
    }
  }

  // 3. requires.config 校验
  const requiresConfig = entry.metadata?.requires?.config;
  if (requiresConfig && requiresConfig.length > 0 && ctx.getConfig) {
    for (const configKey of requiresConfig) {
      const value = ctx.getConfig(configKey);
      if (value === undefined || value === null || value === '') {
        return false;
      }
    }
  }

  // 4. agent 级 skillFilter 白名单
  if (ctx.skillFilter !== undefined && ctx.skillFilter.length >= 0) {
    const filterSet = new Set(ctx.skillFilter.map(normalizeSkillName));
    if (filterSet.size > 0) {
      const skillKey = normalizeSkillName(resolveSkillKey(entry));
      const skillName = normalizeSkillName(entry.skill.name);
      // 白名单匹配 skillKey 或 name
      if (!filterSet.has(skillKey) && !filterSet.has(skillName)) {
        return false;
      }
    }
  }

  // 5. 会话级 skillOverrides 覆盖
  if (ctx.skillOverrides) {
    const skillKey = resolveSkillKey(entry);
    const skillName = entry.skill.name;
    // 优先按 skillKey 覆盖，其次按 name
    if (skillKey in ctx.skillOverrides) {
      return ctx.skillOverrides[skillKey];
    }
    if (skillName in ctx.skillOverrides) {
      return ctx.skillOverrides[skillName];
    }
  }

  return true;
}

// ==================== 可见性过滤 ====================

/**
 * 判断技能是否对模型可见（注入 available-skills prompt）。
 *
 * 参考 openclaw isSkillPromptVisible：
 *  - exposure.includeInAvailableSkillsPrompt 优先
 *  - 否则 fallback 到 !invocation.disableModelInvocation
 */
export function isSkillPromptVisible(entry: SkillEntry): boolean {
  if (entry.exposure) {
    return entry.exposure.includeInAvailableSkillsPrompt ?? true;
  }
  if (entry.invocation) {
    return !entry.invocation.disableModelInvocation;
  }
  return true;
}

/**
 * 判断技能是否对用户可见（命令面板）。
 *
 * 参考 openclaw isSkillUserInvocable：
 *  - exposure.userInvocable 优先
 *  - 否则 fallback 到 invocation.userInvocable
 */
export function isSkillUserInvocable(entry: SkillEntry): boolean {
  if (entry.exposure) {
    return entry.exposure.userInvocable ?? true;
  }
  if (entry.invocation) {
    return entry.invocation.userInvocable ?? true;
  }
  return true;
}

/**
 * 判断技能是否注册到运行时（可被 invoke）。
 */
export function isSkillRuntimeVisible(entry: SkillEntry): boolean {
  return entry.exposure?.includeInRuntimeRegistry ?? true;
}

// ==================== 过滤辅助 ====================

/**
 * 过滤出对模型可见的技能条目（用于 prompt 注入）。
 */
export function filterPromptVisibleSkills(entries: readonly SkillEntry[]): SkillEntry[] {
  return entries.filter(isSkillPromptVisible);
}

/**
 * 过滤出用户可调用的技能条目（用于命令面板）。
 */
export function filterUserInvocableSkills(entries: readonly SkillEntry[]): SkillEntry[] {
  return entries.filter(isSkillUserInvocable);
}

/**
 * 过滤出运行时可用的技能条目（用于 invoke 调用）。
 */
export function filterRuntimeVisibleSkills(entries: readonly SkillEntry[]): SkillEntry[] {
  return entries.filter(isSkillRuntimeVisible);
}

/**
 * 按可用性上下文过滤技能（综合 requires + skillFilter + skillOverrides）。
 */
export function filterAvailableSkills(
  entries: readonly SkillEntry[],
  ctx: SkillAvailabilityContext = {}
): SkillEntry[] {
  return entries.filter(entry => evaluateSkillAvailability(entry, ctx));
}

/**
 * 比较两个 skillFilter 是否一致（用于快照缓存判断）。
 *
 * 参考 openclaw matchesSkillFilter。
 */
export function matchesSkillFilter(
  cached?: readonly string[],
  next?: readonly string[]
): boolean {
  const normalize = (arr?: readonly string[]) => {
    if (arr === undefined) return undefined;
    return [...arr].map(normalizeSkillName).sort();
  };
  const a = normalize(cached);
  const b = normalize(next);
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
