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
import { getUserDataPath } from '../../../utils/appPath';
import * as https from 'https';
import * as http from 'http';
import { execSync } from 'child_process';
import * as os from 'os';

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

// ==================== 技能导入/卸载 ====================

/**
 * 从本地目录导入技能。
 *
 * 将源目录（包含 SKILL.md）复制到工作区技能目录 `<userDataPath>/skills/<dirName>/`。
 * 使用 fsp.cp 递归复制目录。
 *
 * @param srcDir 源目录路径（包含 SKILL.md）
 * @returns 加载后的 SkillEntry（source 设为 'workspace'），失败返回 null
 */
export async function importSkillFromDir(srcDir: string): Promise<SkillEntry | null> {
  try {
    const dirName = path.basename(srcDir);
    const workspaceSkillsDir = path.join(getUserDataPath(), 'skills');
    const targetDir = path.join(workspaceSkillsDir, dirName);

    // 确保工作区技能目录存在
    await fsp.mkdir(workspaceSkillsDir, { recursive: true });

    // 如果目标目录已存在，先删除（覆盖导入）
    try {
      await fsp.access(targetDir);
      await fsp.rm(targetDir, { recursive: true, force: true });
    } catch {
      // 目标目录不存在，无需删除
    }

    // 递归复制目录
    await fsp.cp(srcDir, targetDir, { recursive: true });

    // 加载复制后的技能
    const skillFile = path.join(targetDir, 'SKILL.md');
    const entry = await loadSkillFile(skillFile, 'workspace');
    if (!entry) {
      console.error(`[SkillLoader] importSkillFromDir: failed to parse SKILL.md after copy: ${skillFile}`);
      return null;
    }
    return entry;
  } catch (err) {
    console.error(`[SkillLoader] importSkillFromDir failed for ${srcDir}:`, err);
    return null;
  }
}

/**
 * 从 URL 下载并导入技能。
 *
 * 下载 zip 归档到临时文件，解压后找到包含 SKILL.md 的目录，
 * 复制到工作区技能目录 `<userDataPath>/skills/<skillName>/`。
 *
 * @param url 技能归档的下载 URL
 * @returns 加载后的 SkillEntry（source 设为 'workspace'），失败返回 null
 */
export async function importSkillFromUrl(url: string): Promise<SkillEntry | null> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-import-'));
  const tmpZip = path.join(tmpDir, 'skill-archive');

  try {
    // 1. 下载到临时文件
    await downloadFile(url, tmpZip);

    // 2. 解压到临时目录
    const extractDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });

    if (process.platform === 'win32') {
      execSync(`powershell -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${extractDir}' -Force"`);
    } else {
      execSync(`tar -xf '${tmpZip}' -C '${extractDir}'`);
    }

    // 3. 查找包含 SKILL.md 的目录
    const skillDir = findSkillDir(extractDir);
    if (!skillDir) {
      console.error(`[SkillLoader] importSkillFromUrl: no SKILL.md found in extracted archive from ${url}`);
      return null;
    }

    // 4. 复制到工作区技能目录
    const skillName = path.basename(skillDir);
    const workspaceSkillsDir = path.join(getUserDataPath(), 'skills');
    const targetDir = path.join(workspaceSkillsDir, skillName);

    await fsp.mkdir(workspaceSkillsDir, { recursive: true });

    // 如果目标目录已存在，先删除（覆盖导入）
    try {
      await fsp.access(targetDir);
      await fsp.rm(targetDir, { recursive: true, force: true });
    } catch {
      // 目标目录不存在
    }

    await fsp.cp(skillDir, targetDir, { recursive: true });

    // 5. 加载技能
    const skillFile = path.join(targetDir, 'SKILL.md');
    const entry = await loadSkillFile(skillFile, 'workspace');
    if (!entry) {
      console.error(`[SkillLoader] importSkillFromUrl: failed to parse SKILL.md after copy: ${skillFile}`);
      return null;
    }
    return entry;
  } catch (err) {
    console.error(`[SkillLoader] importSkillFromUrl failed for ${url}:`, err);
    return null;
  } finally {
    // 清理临时文件
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响主流程
    }
  }
}

/**
 * 卸载（删除）工作区技能。
 *
 * 内置技能不允许卸载（返回 false）。
 * 工作区技能：删除 `<userDataPath>/skills/<skillName>/` 目录。
 *
 * @param skillName 技能名
 * @returns 是否成功删除
 */
export async function uninstallSkill(skillName: string): Promise<boolean> {
  try {
    // 检查是否为内置技能
    const builtinSkills = loadBuiltinSkillsSync();
    const isBuiltin = builtinSkills.some(entry => entry.skill.name === skillName);
    if (isBuiltin) {
      console.warn(`[SkillLoader] uninstallSkill: cannot uninstall builtin skill '${skillName}'`);
      return false;
    }

    // 删除工作区技能目录
    const skillDir = path.join(getUserDataPath(), 'skills', skillName);
    try {
      await fsp.access(skillDir);
      await fsp.rm(skillDir, { recursive: true, force: true });
      return true;
    } catch {
      // 目录不存在，视为卸载失败
      console.warn(`[SkillLoader] uninstallSkill: skill directory not found: ${skillDir}`);
      return false;
    }
  } catch (err) {
    console.error(`[SkillLoader] uninstallSkill failed for '${skillName}':`, err);
    return false;
  }
}

// ==================== 技能创建/编辑 ====================

/**
 * 技能表单数据（创建/编辑通用）。
 */
export interface SkillFormData {
  name: string;
  description: string;
  emoji?: string;
  body: string;
}

/**
 * 组装 SKILL.md 文件内容。
 *
 * 格式：
 *  ---
 *  name: <技能名>
 *  description: "<描述>"
 *  emoji: <emoji>
 *  user-invocable: true
 *  disable-model-invocation: false
 *  ---
 *  <正文内容>
 */
function assembleSkillMd(params: SkillFormData): string {
  const lines: string[] = ['---'];
  lines.push(`name: ${params.name}`);
  // 描述中可能包含特殊字符，用双引号包裹并转义内部双引号
  const escapedDesc = params.description.replace(/"/g, '\\"');
  lines.push(`description: "${escapedDesc}"`);
  if (params.emoji) {
    lines.push(`emoji: ${params.emoji}`);
  }
  lines.push('user-invocable: true');
  lines.push('disable-model-invocation: false');
  lines.push('---');
  lines.push('');
  lines.push(params.body);
  return lines.join('\n');
}

/**
 * 创建工作区技能（写入 SKILL.md）。
 *
 * 在 <userDataPath>/skills/<name>/ 目录下创建 SKILL.md 文件。
 * 校验技能名格式（仅小写字母/数字/连字符）和目录唯一性。
 *
 * @param params 技能表单数据
 * @returns 加载后的 SkillEntry，失败返回 null
 */
export async function createSkill(params: SkillFormData): Promise<SkillEntry | null> {
  // 校验技能名格式
  if (!/^[a-z0-9-]+$/.test(params.name)) {
    console.error(`[SkillLoader] createSkill: invalid skill name '${params.name}' (only lowercase letters, digits, and hyphens allowed)`);
    return null;
  }

  const workspaceSkillsDir = path.join(getUserDataPath(), 'skills');
  const targetDir = path.join(workspaceSkillsDir, params.name);
  const skillFile = path.join(targetDir, 'SKILL.md');

  // 检查目录唯一性
  try {
    await fsp.access(targetDir);
    console.error(`[SkillLoader] createSkill: skill directory already exists: ${targetDir}`);
    return null;
  } catch {
    // 目录不存在，继续创建
  }

  try {
    // 创建目录
    await fsp.mkdir(targetDir, { recursive: true });

    // 组装并写入 SKILL.md
    const content = assembleSkillMd(params);
    await fsp.writeFile(skillFile, content, 'utf-8');

    // 加载写入的技能
    const entry = await loadSkillFile(skillFile, 'workspace');
    if (!entry) {
      console.error(`[SkillLoader] createSkill: failed to parse SKILL.md after write: ${skillFile}`);
      return null;
    }
    return entry;
  } catch (err) {
    console.error(`[SkillLoader] createSkill failed for '${params.name}':`, err);
    return null;
  }
}

/**
 * 编辑工作区技能（更新 SKILL.md）。
 *
 * 读取已有 SKILL.md，更新 description/emoji/body，写回文件。
 * 内置技能不可编辑（拒绝操作）。
 *
 * @param params 技能表单数据（name 用于定位目录，不可修改）
 * @returns 加载后的 SkillEntry，失败返回 null
 */
export async function editSkill(params: SkillFormData): Promise<SkillEntry | null> {
  // 检查是否为内置技能
  const builtinSkills = loadBuiltinSkillsSync();
  const isBuiltin = builtinSkills.some(entry => entry.skill.name === params.name);
  if (isBuiltin) {
    console.error(`[SkillLoader] editSkill: cannot edit builtin skill '${params.name}'`);
    return null;
  }

  const skillFile = path.join(getUserDataPath(), 'skills', params.name, 'SKILL.md');

  // 检查文件是否存在
  try {
    await fsp.access(skillFile);
  } catch {
    console.error(`[SkillLoader] editSkill: SKILL.md not found: ${skillFile}`);
    return null;
  }

  try {
    // 组装并写入 SKILL.md（保留 frontmatter 中的高级字段在此简化为覆盖）
    const content = assembleSkillMd(params);
    await fsp.writeFile(skillFile, content, 'utf-8');

    // 加载更新后的技能
    const entry = await loadSkillFile(skillFile, 'workspace');
    if (!entry) {
      console.error(`[SkillLoader] editSkill: failed to parse SKILL.md after update: ${skillFile}`);
      return null;
    }
    return entry;
  } catch (err) {
    console.error(`[SkillLoader] editSkill failed for '${params.name}':`, err);
    return null;
  }
}

// ==================== 导入辅助函数 ====================

/**
 * 下载文件到指定路径（使用 Node.js 内置 http/https 模块，支持重定向）。
 */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    const request = protocol.get(url, (response) => {
      // 处理重定向（3xx）
      if (
        response.statusCode === 301 ||
        response.statusCode === 302 ||
        response.statusCode === 307 ||
        response.statusCode === 308
      ) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          response.resume();
          downloadFile(redirectUrl, dest).then(resolve).catch(reject);
          return;
        }
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }
      const fileStream = fs.createWriteStream(dest);
      response.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
      fileStream.on('error', reject);
    });
    request.on('error', reject);
  });
}

/**
 * 在指定目录中查找包含 SKILL.md 的目录。
 * 优先查找一级子目录，然后查找根目录本身。
 */
function findSkillDir(searchDir: string): string | null {
  // 检查一级子目录
  try {
    const items = fs.readdirSync(searchDir);
    for (const item of items) {
      const itemPath = path.join(searchDir, item);
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) {
        const skillFile = path.join(itemPath, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          return itemPath;
        }
      }
    }
  } catch {
    // 读取目录失败
  }

  // 检查根目录是否有 SKILL.md
  const rootSkillFile = path.join(searchDir, 'SKILL.md');
  if (fs.existsSync(rootSkillFile)) {
    return searchDir;
  }

  return null;
}
