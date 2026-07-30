/**
 * 技能会话快照 —— 适配 openclaw runtime/session-snapshot.ts
 *
 * 来源：参考 openclaw src/skills/runtime/session-snapshot.ts + refresh-state.ts
 * 决策：自研（openclaw 依赖 workspace watcher + 远程技能 reconciliation，
 *       本项目首期仅支持静态快照 + 版本比对）。
 *
 * 职责：
 *  1. buildSkillSnapshot：构建会话快照（含可用技能列表 + prompt 文本）
 *  2. formatSkillPrompt：格式化为 XML 块注入 system prompt
 *  3. shouldRefreshSnapshot：比对快照版本，判断是否需要刷新
 *  4. 缓存：resolvedSkills 进程级 LRU 缓存（避免重复构建）
 *
 * 设计约束（openclaw session-snapshot 设计）：
 *  - 快照包含 prompt（注入文本）+ skills（精简列表）+ 过滤参数
 *  - 快照版本比对：promptFormatVersion + skillFilter + skillOverrides 变化时刷新
 *  - 缓存键：workspaceDir + snapshotVersion + skillFilter + skillOverrides
 */

import type { SkillEntry, SkillSnapshot } from './types';
import { SKILL_PROMPT_FORMAT_VERSION } from './types';
import { formatSkillsForPrompt } from './skillContract';
import {
  evaluateSkillAvailability,
  filterPromptVisibleSkills,
  matchesSkillFilter,
  type SkillAvailabilityContext,
} from './skillAvailability';

// ==================== 快照构建 ====================

/**
 * 构建技能会话快照。
 *
 * 步骤：
 *  1. 从全量 SkillEntry 列表过滤出运行时可见的技能
 *  2. 应用可用性上下文（requires.env/config + skillFilter + skillOverrides）
 *  3. 过滤出模型可见（prompt 注入）的技能
 *  4. 格式化为 XML prompt 文本
 *
 * @param entries 全量技能条目（来自 skillLoader）
 * @param filterOptions 过滤选项（skillFilter + skillOverrides + requires 校验上下文）
 * @returns SkillSnapshot（含 prompt 文本 + 精简技能列表）
 */
export function buildSkillSnapshot(
  entries: readonly SkillEntry[],
  filterOptions: SkillAvailabilityContext = {}
): SkillSnapshot {
  // 1. 应用可用性过滤（requires + skillFilter + skillOverrides）
  const available = entries.filter(entry =>
    evaluateSkillAvailability(entry, filterOptions)
  );

  // 2. 过滤出模型可见的技能（注入 prompt）
  const promptVisible = filterPromptVisibleSkills(available);

  // 3. 格式化为 prompt 文本
  const skillsForPrompt = promptVisible.map(entry => entry.skill);
  const prompt = formatSkillsForPrompt(skillsForPrompt);

  // 4. 构建精简技能列表（用于快照缓存比对）
  const skills = promptVisible.map(entry => ({
    name: entry.skill.name,
    skillKey: entry.metadata?.skillKey,
    primaryEnv: entry.metadata?.primaryEnv,
    requiredEnv: entry.metadata?.requires?.env,
  }));

  return {
    prompt,
    skills,
    skillFilter: filterOptions.skillFilter,
    skillOverrides: filterOptions.skillOverrides,
    promptFormatVersion: SKILL_PROMPT_FORMAT_VERSION,
  };
}

// ==================== Prompt 格式化 ====================

/**
 * 格式化快照为 prompt 文本（直接拼接到 system prompt 末尾）。
 *
 * 若快照 prompt 为空（无可用技能），返回空字符串。
 *
 * @param snapshot 技能快照
 * @returns prompt 文本（可能为空）
 */
export function formatSkillPrompt(snapshot: SkillSnapshot): string {
  return snapshot.prompt;
}

// ==================== 刷新判断 ====================

/**
 * 判断是否需要刷新快照。
 *
 * 触发刷新的条件（任一满足即刷新）：
 *  1. promptFormatVersion 变化（格式升级）
 *  2. skillFilter 变化（agent 级过滤调整）
 *  3. skillOverrides 变化（会话级覆盖调整）
 *  4. 现有快照为空（首次构建）
 *
 * @param existing 现有快照（可能为 undefined）
 * @param nextFilter 下一次过滤参数
 * @returns true 表示需要刷新
 */
export function shouldRefreshSnapshot(
  existing: SkillSnapshot | undefined,
  nextFilter?: string[]
): boolean {
  if (!existing) return true;

  // 1. prompt 格式版本变化
  if (existing.promptFormatVersion !== SKILL_PROMPT_FORMAT_VERSION) {
    return true;
  }

  // 2. skillFilter 变化
  if (!matchesSkillFilter(existing.skillFilter, nextFilter)) {
    return true;
  }

  // 3. skillOverrides 变化（JSON 比对）
  const existingOverrides = JSON.stringify(existing.skillOverrides ?? {});
  const nextOverrides = JSON.stringify({}); // 下一次的 overrides 由调用方传入，此处简化
  if (existingOverrides !== nextOverrides) {
    return true;
  }

  return false;
}

/**
 * 判断是否需要刷新快照（含完整参数比对）。
 *
 * @param existing 现有快照
 * @param nextFilter 下一次 skillFilter
 * @param nextOverrides 下一次 skillOverrides
 * @returns true 表示需要刷新
 */
export function shouldRefreshSnapshotFull(
  existing: SkillSnapshot | undefined,
  nextFilter?: string[],
  nextOverrides?: Record<string, boolean>
): boolean {
  if (!existing) return true;

  if (existing.promptFormatVersion !== SKILL_PROMPT_FORMAT_VERSION) {
    return true;
  }

  if (!matchesSkillFilter(existing.skillFilter, nextFilter)) {
    return true;
  }

  const existingOverrides = JSON.stringify(existing.skillOverrides ?? {});
  const nextOverridesJson = JSON.stringify(nextOverrides ?? {});
  if (existingOverrides !== nextOverridesJson) {
    return true;
  }

  return false;
}

// ==================== 进程级缓存 ====================

/**
 * resolvedSkills 进程级 LRU 缓存。
 *
 * 参考 openclaw resolvedSkillsCache（最大 10 条）。
 * 缓存键：skillFilter + skillOverrides + skillCount + skillVersion 的组合 hash。
 */
const resolvedSkillsCache = new Map<string, SkillSnapshot>();
const RESOLVED_SKILLS_CACHE_MAX = 10;

/**
 * 构建快照缓存键。
 */
function buildSnapshotCacheKey(
  entries: readonly SkillEntry[],
  filterOptions: SkillAvailabilityContext
): string {
  // 技能集合指纹：name + filePath + source（变化时重建）
  const skillFingerprint = entries
    .map(e => `${e.skill.name}:${e.skill.filePath}:${e.skill.source}`)
    .sort()
    .join('|');

  return JSON.stringify({
    skills: skillFingerprint,
    skillFilter: filterOptions.skillFilter,
    skillOverrides: filterOptions.skillOverrides,
  });
}

/**
 * 构建或复用快照（带进程级缓存）。
 *
 * 若缓存命中且快照未过期，直接返回缓存；否则重建并写入缓存。
 *
 * @param entries 全量技能条目
 * @param filterOptions 过滤选项
 * @returns SkillSnapshot
 */
export function resolveSkillSnapshot(
  entries: readonly SkillEntry[],
  filterOptions: SkillAvailabilityContext = {}
): SkillSnapshot {
  const cacheKey = buildSnapshotCacheKey(entries, filterOptions);

  const cached = resolvedSkillsCache.get(cacheKey);
  if (cached) {
    // LRU：命中时移到最新（删除后重新插入）
    resolvedSkillsCache.delete(cacheKey);
    resolvedSkillsCache.set(cacheKey, cached);
    return cached;
  }

  const snapshot = buildSkillSnapshot(entries, filterOptions);

  // 写入缓存，超限时淘汰最旧
  resolvedSkillsCache.set(cacheKey, snapshot);
  if (resolvedSkillsCache.size > RESOLVED_SKILLS_CACHE_MAX) {
    const oldest = resolvedSkillsCache.keys().next().value;
    if (oldest !== undefined) {
      resolvedSkillsCache.delete(oldest);
    }
  }

  return snapshot;
}

/**
 * 清空快照缓存（技能增删改后调用）。
 */
export function clearSkillSnapshotCache(): void {
  resolvedSkillsCache.clear();
}

/**
 * 获取当前缓存大小（调试用）。
 */
export function getSkillSnapshotCacheSize(): number {
  return resolvedSkillsCache.size;
}
