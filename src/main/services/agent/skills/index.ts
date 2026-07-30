/**
 * skills/ 模块统一导出
 *
 * spec §二 Task 14：技能管理平台（SkillPlatform）
 *
 * 模块结构：
 *  - types.ts: 类型契约（SkillEntry / SkillExposure / SkillInvocationPolicy / SkillSnapshot）
 *  - skillContract.ts: SKILL.md 解析 + formatSkillsForPrompt
 *  - skillAvailability.ts: 声明式可用性 + 可见性过滤
 *  - skillLoader.ts: 加载链（内置 + 工作区）
 *  - skillSnapshot.ts: 会话快照 + 进程级缓存
 *  - skillInvoker.ts: 调用分发（kind=tool → ToolRegistry）
 *  - skillRegistry.ts: ISkillRegistry 实现（register/get/list/buildSnapshot/invoke）
 *  - builtin-skills/: 内置写作组 SKILL.md
 */

export type {
  Skill,
  SkillEntry,
  SkillSource,
  SkillMetadata,
  SkillInvocationPolicy,
  SkillExposure,
  SkillCommandSpec,
  SkillCommandDispatchSpec,
  SkillSnapshot,
} from './types';
export { SKILL_PROMPT_FORMAT_VERSION } from './types';

export {
  extractFrontmatter,
  parseSkillMd,
  resolveSkillInvocationPolicy,
  resolveSkillExposure,
  resolveSkillCommandSpec,
  formatSkillsForPrompt,
  truncateSkillBody,
  resolveSkillKey,
  normalizeSkillName,
} from './skillContract';

export {
  evaluateSkillAvailability,
  isSkillPromptVisible,
  isSkillUserInvocable,
  isSkillRuntimeVisible,
  filterPromptVisibleSkills,
  filterUserInvocableSkills,
  filterRuntimeVisibleSkills,
  filterAvailableSkills,
  matchesSkillFilter,
  type SkillAvailabilityContext,
} from './skillAvailability';

export {
  loadSkillFile,
  loadSkillsFromDir,
  loadBuiltinSkills,
  loadWorkspaceSkills,
  loadAllSkills,
  loadSkillFileSync,
  loadSkillsFromDirSync,
  loadBuiltinSkillsSync,
} from './skillLoader';

export {
  buildSkillSnapshot,
  formatSkillPrompt,
  shouldRefreshSnapshot,
  shouldRefreshSnapshotFull,
  resolveSkillSnapshot,
  clearSkillSnapshotCache,
  getSkillSnapshotCacheSize,
} from './skillSnapshot';

export {
  invokeSkill,
  invokeSkillsBatch,
  type SkillInvokeSource,
  type SkillInvokeResult,
} from './skillInvoker';

export {
  SkillRegistry,
  getSkillRegistry,
  resetSkillRegistry,
} from './skillRegistry';
