/**
 * SKILL.md 加载链 —— 适配 openclaw loading/workspace.ts + bundled-dir.ts
 *
 * 来源：参考 openclaw src/skills/loading/workspace.ts + bundled-dir.ts
 * 决策：自研（openclaw 依赖 workspace 同步/符号链接/clawhub 远程安装，
 *       本项目首期仅支持内置技能目录 + 工作区目录扫描）。
 *
 * 职责：
 *  1. loadSkillFile：读取单个 SKILL.md 文件并解析为 SkillEntry
 *  2. loadSkillsFromDir：扫描目录下的所有 SKILL.md（递归一层子目录）
 *  3. loadBuiltinSkills：加载内置技能（builtin-skills/* 目录）
 *  4. loadWorkspaceSkills：加载工作区技能（用户自定义，可选）
 *
 * 设计约束：
 *  - 内置技能目录：src/main/services/agent/skills/builtin-skills/
 *  - 每个技能一个子目录：builtin-skills/<skill-name>/SKILL.md
 *  - 工作区技能目录：用户数据目录下 skills/（可选，首期可为空）
 *  - 加载失败的单个技能不中断整体加载（仅 warn 日志）
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { parseSkillMd } from './skillContract';
import type { SkillEntry, SkillSource } from './types';

// ==================== 单文件加载 ====================

/**
 * 读取并解析单个 SKILL.md 文件。
 *
 * @param filePath SKILL.md 文件绝对路径
 * @param source 技能来源（builtin / workspace / unknown）
 * @returns SkillEntry，解析失败返回 undefined
 */
export async function loadSkillFile(
  filePath: string,
  source: SkillSource
): Promise<SkillEntry | undefined> {
  try {
    const content = await fsp.readFile(filePath, 'utf-8');
    const entry = parseSkillMd(content, filePath, source);
    if (!entry) {
      console.warn(`[SkillLoader] Failed to parse SKILL.md (missing name/description): ${filePath}`);
      return undefined;
    }
    return entry;
  } catch (err) {
    console.warn(`[SkillLoader] Failed to load skill file ${filePath}:`, err);
    return undefined;
  }
}

// ==================== 目录扫描加载 ====================

/**
 * 扫描目录下的所有 SKILL.md 文件。
 *
 * 目录结构约定：
 *  <dir>/
 *    <skill-name-1>/SKILL.md
 *    <skill-name-2>/SKILL.md
 *    ...
 *
 * 也支持 <dir>/SKILL.md（单技能直接放在目录下）。
 *
 * @param dir 目录路径
 * @param source 技能来源
 * @returns 加载成功的 SkillEntry 列表（加载失败的被跳过）
 */
export async function loadSkillsFromDir(
  dir: string,
  source: SkillSource
): Promise<SkillEntry[]> {
  const entries: SkillEntry[] = [];

  let dirExists = false;
  try {
    await fsp.access(dir);
    dirExists = true;
  } catch {
    dirExists = false;
  }

  if (!dirExists) {
    return entries;
  }

  let items: import('fs').Dirent[];
  try {
    items = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[SkillLoader] Failed to read directory ${dir}:`, err);
    return entries;
  }

  for (const item of items) {
    if (item.isDirectory()) {
      // 子目录：查找其中的 SKILL.md
      const skillFile = path.join(dir, item.name, 'SKILL.md');
      try {
        await fsp.access(skillFile);
        const entry = await loadSkillFile(skillFile, source);
        if (entry) entries.push(entry);
      } catch {
        // 子目录无 SKILL.md，跳过
      }
    } else if (item.isFile() && item.name === 'SKILL.md') {
      // 直接放在目录下的 SKILL.md
      const skillFile = path.join(dir, item.name);
      const entry = await loadSkillFile(skillFile, source);
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

// ==================== 内置技能加载 ====================

/**
 * 内置技能目录（编译时确定，运行时为源码路径）。
 *
 * 开发环境：src/main/services/agent/skills/builtin-skills/
 * 生产环境：打包后路径可能变化，通过 __dirname 定位。
 */
function getBuiltinSkillsDir(): string {
  // __dirname 在 ESM 中不可用，但本项目为 CJS（Electron main），__dirname 可用
  // builtin-skills 与本文件同级
  return path.join(__dirname, 'builtin-skills');
}

/**
 * 加载所有内置技能。
 *
 * 内置技能位于 `src/main/services/agent/skills/builtin-skills/<skill-name>/SKILL.md`。
 * 首期内置 5 个写作组技能（plot-check/outline-generate/chapter-write/description-polish/table-organize）。
 *
 * @returns 内置 SkillEntry 列表
 */
export async function loadBuiltinSkills(): Promise<SkillEntry[]> {
  const dir = getBuiltinSkillsDir();
  const entries = await loadSkillsFromDir(dir, 'builtin');
  console.log(`[SkillLoader] Loaded ${entries.length} builtin skills from ${dir}`);
  return entries;
}

// ==================== 工作区技能加载 ====================

/**
 * 加载工作区（用户自定义）技能。
 *
 * 工作区技能目录约定：用户数据目录下 `skills/`。
 * 首期可为空（用户未自定义技能时返回空数组）。
 *
 * @param userDataPath 用户数据目录
 * @returns 工作区 SkillEntry 列表
 */
export async function loadWorkspaceSkills(userDataPath: string): Promise<SkillEntry[]> {
  const dir = path.join(userDataPath, 'skills');
  const entries = await loadSkillsFromDir(dir, 'workspace');
  if (entries.length > 0) {
    console.log(`[SkillLoader] Loaded ${entries.length} workspace skills from ${dir}`);
  }
  return entries;
}

// ==================== 全量加载 ====================

/**
 * 加载全部技能（内置 + 工作区）。
 *
 * 加载顺序：先内置，后工作区。同名技能工作区覆盖内置（工作区优先）。
 *
 * @param userDataPath 用户数据目录（可选，不传则仅加载内置）
 * @returns 合并后的 SkillEntry 列表（去重，工作区优先）
 */
export async function loadAllSkills(userDataPath?: string): Promise<SkillEntry[]> {
  const builtin = await loadBuiltinSkills();
  const workspace = userDataPath ? await loadWorkspaceSkills(userDataPath) : [];

  // 工作区覆盖同名内置技能
  const byName = new Map<string, SkillEntry>();
  for (const entry of builtin) {
    byName.set(entry.skill.name, entry);
  }
  for (const entry of workspace) {
    byName.set(entry.skill.name, entry);
  }

  return Array.from(byName.values());
}

// ==================== 同步变体（启动期） ====================

/**
 * 同步加载单个 SKILL.md 文件（启动期或测试用）。
 *
 * 优先使用异步版本 loadSkillFile。仅在初始化路径必须同步时使用。
 */
export function loadSkillFileSync(
  filePath: string,
  source: SkillSource
): SkillEntry | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const content = fs.readFileSync(filePath, 'utf-8');
    const entry = parseSkillMd(content, filePath, source);
    if (!entry) {
      console.warn(`[SkillLoader] Failed to parse SKILL.md (missing name/description): ${filePath}`);
      return undefined;
    }
    return entry;
  } catch (err) {
    console.warn(`[SkillLoader] Failed to load skill file ${filePath}:`, err);
    return undefined;
  }
}

/**
 * 同步扫描目录加载技能（启动期或测试用）。
 */
export function loadSkillsFromDirSync(
  dir: string,
  source: SkillSource
): SkillEntry[] {
  const entries: SkillEntry[] = [];
  if (!fs.existsSync(dir)) return entries;

  let items: string[];
  try {
    items = fs.readdirSync(dir);
  } catch (err) {
    console.warn(`[SkillLoader] Failed to read directory ${dir}:`, err);
    return entries;
  }

  for (const name of items) {
    const fullPath = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      const skillFile = path.join(fullPath, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        const entry = loadSkillFileSync(skillFile, source);
        if (entry) entries.push(entry);
      }
    } else if (stat.isFile() && name === 'SKILL.md') {
      const entry = loadSkillFileSync(fullPath, source);
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

/**
 * 同步加载所有内置技能（启动期用）。
 */
export function loadBuiltinSkillsSync(): SkillEntry[] {
  const dir = getBuiltinSkillsDir();
  const entries = loadSkillsFromDirSync(dir, 'builtin');
  console.log(`[SkillLoader] Loaded ${entries.length} builtin skills (sync) from ${dir}`);
  return entries;
}
