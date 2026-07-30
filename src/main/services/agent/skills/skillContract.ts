/**
 * SKILL.md 解析契约 —— 自研（spec §三）
 *
 * 来源：参考 openclaw src/skills/loading/frontmatter.ts + skill-contract.ts
 * 决策：自研（openclaw 用 marked + yaml + 多包依赖，本项目同栈自研精简解析器）。
 *
 * 职责：
 *  1. 从 SKILL.md 文件内容解析 frontmatter（YAML 子集）+ markdown body
 *  2. 解析 frontmatter 为 SkillEntry（含 metadata / invocation / exposure）
 *  3. formatSkillsForPrompt：将可用技能格式化为 XML 块注入 system prompt
 *
 * SKILL.md 格式：
 *  ---
 *  name: skill-name
 *  description: 技能描述（模型可见）
 *  user-invocable: true
 *  disable-model-invocation: false
 *  always: false
 *  skill-key: alias-key
 *  emoji: ✨
 *  ---
 *  # Skill Name
 *  使用说明正文（markdown）...
 *
 * 设计约束（openclaw SKILL.md 契约）：
 *  - frontmatter 为 YAML 子集（仅支持 string/boolean/number/list，不支持嵌套对象）
 *  - name 与 description 必填；其余可选
 *  - body 为 markdown，注入 prompt 时可截断
 *  - 三层可见性 + 双调用策略由 frontmatter 布尔字段控制
 */

import type {
  Skill,
  SkillEntry,
  SkillExposure,
  SkillInvocationPolicy,
  SkillMetadata,
  SkillSource,
  SkillCommandSpec,
  SkillCommandDispatchSpec,
} from './types';
import { SKILL_PROMPT_FORMAT_VERSION } from './types';

// ==================== Frontmatter 解析 ====================

/**
 * 从 SKILL.md 内容提取 frontmatter 块与 body。
 *
 * frontmatter 由首行 `---` 开始，到下一个 `---` 结束。
 * 若文件不以 `---` 开头，则整体作为 body，frontmatter 为空对象。
 *
 * @param content SKILL.md 文件内容
 * @returns { frontmatter: Record<string, string>, body: string }
 */
export function extractFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const trimmed = content.replace(/^\uFEFF/, ''); // 去 BOM
  // 必须以 `---\n` 开头才视为有 frontmatter
  if (!/^---\s*\r?\n/.test(trimmed)) {
    return { frontmatter: {}, body: trimmed.trim() };
  }

  // 找第二个 `---` 行
  const lines = trimmed.split(/\r?\n/);
  let endLine = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) {
      endLine = i;
      break;
    }
  }

  if (endLine === -1) {
    // 未闭合的 frontmatter，整体作为 body
    return { frontmatter: {}, body: trimmed.trim() };
  }

  const frontmatterText = lines.slice(1, endLine).join('\n');
  const body = lines.slice(endLine + 1).join('\n').trim();
  const frontmatter = parseYamlSubset(frontmatterText);
  return { frontmatter, body };
}

/**
 * 解析 YAML 子集为 Record<string, string>。
 *
 * 仅支持：
 *  - `key: value`（value 为 string / boolean / number）
 *  - `key:` 后跟缩进列表（`  - item`）
 *  - 引号字符串（单引号/双引号）
 *
 * 不支持嵌套对象、锚点、多行字符串等复杂 YAML。
 * 列表值以 `\n` 分隔的字符串形式存储（调用方按需 split）。
 */
function parseYamlSubset(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // 空行或注释
    if (!line.trim() || /^\s*#/.test(line)) {
      i++;
      continue;
    }

    // key: value
    const kvMatch = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      const value = rawValue.trim();

      if (value === '') {
        // 可能是列表（后续缩进行）
        const listItems: string[] = [];
        let j = i + 1;
        while (j < lines.length && /^\s+-\s+/.test(lines[j])) {
          const itemMatch = lines[j].match(/^\s+-\s+(.*)$/);
          if (itemMatch) {
            listItems.push(stripQuotes(itemMatch[1].trim()));
          }
          j++;
        }
        if (listItems.length > 0) {
          result[key] = listItems.join('\n');
          i = j;
        } else {
          result[key] = '';
          i++;
        }
      } else {
        result[key] = stripQuotes(value);
        i++;
      }
    } else {
      i++;
    }
  }

  return result;
}

/**
 * 去除字符串两端的引号（单引号或双引号）。
 */
function stripQuotes(s: string): string {
  if (s.length >= 2) {
    if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/**
 * 将 frontmatter 字符串值解析为布尔（默认值 fallback）。
 */
function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === 'yes' || v === '1') return true;
  if (v === 'false' || v === 'no' || v === '0') return false;
  return defaultValue;
}

/**
 * 将 frontmatter 字符串值解析为字符串列表。
 */
function parseStringList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// ==================== SkillEntry 构造 ====================

/**
 * 从 SKILL.md 内容解析为 SkillEntry。
 *
 * @param content SKILL.md 文件内容
 * @param filePath 文件绝对路径
 * @param source 来源（builtin / workspace / unknown）
 * @returns SkillEntry，若必填字段缺失则返回 undefined
 */
export function parseSkillMd(
  content: string,
  filePath: string,
  source: SkillSource
): SkillEntry | undefined {
  const { frontmatter, body } = extractFrontmatter(content);

  const name = frontmatter['name']?.trim();
  const description = frontmatter['description']?.trim();
  if (!name || !description) {
    return undefined;
  }

  const skill: Skill = {
    name,
    description,
    body,
    filePath,
    source,
  };

  const metadata = resolveSkillMetadata(frontmatter);
  const invocation = resolveSkillInvocationPolicy(frontmatter);
  const exposure = resolveSkillExposure(frontmatter, invocation);

  return {
    skill,
    frontmatter,
    metadata,
    invocation,
    exposure,
    disableCommandDispatch: parseBool(frontmatter['disable-command-dispatch'], false),
  };
}

/**
 * 解析 SkillMetadata（always / skillKey / primaryEnv / emoji / requires）。
 */
function resolveSkillMetadata(frontmatter: Record<string, string>): SkillMetadata | undefined {
  const always = frontmatter['always'];
  const skillKey = frontmatter['skill-key'];
  const primaryEnv = frontmatter['primary-env'];
  const emoji = frontmatter['emoji'];
  const homepage = frontmatter['homepage'];

  const requiresBins = parseStringList(frontmatter['requires-bins']);
  const requiresAnyBins = parseStringList(frontmatter['requires-any-bins']);
  const requiresEnv = parseStringList(frontmatter['requires-env']);
  const requiresConfig = parseStringList(frontmatter['requires-config']);
  const os = parseStringList(frontmatter['os']);

  const hasMetadata =
    always !== undefined ||
    skillKey !== undefined ||
    primaryEnv !== undefined ||
    emoji !== undefined ||
    homepage !== undefined ||
    requiresBins.length > 0 ||
    requiresAnyBins.length > 0 ||
    requiresEnv.length > 0 ||
    requiresConfig.length > 0 ||
    os.length > 0;

  if (!hasMetadata) return undefined;

  const metadata: SkillMetadata = {};
  if (always !== undefined) metadata.always = parseBool(always, false);
  if (skillKey !== undefined) metadata.skillKey = skillKey;
  if (primaryEnv !== undefined) metadata.primaryEnv = primaryEnv;
  if (emoji !== undefined) metadata.emoji = emoji;
  if (homepage !== undefined) metadata.homepage = homepage;
  if (os.length > 0) metadata.os = os;

  if (requiresBins.length > 0 || requiresAnyBins.length > 0 || requiresEnv.length > 0 || requiresConfig.length > 0) {
    metadata.requires = {};
    if (requiresBins.length > 0) metadata.requires.bins = requiresBins;
    if (requiresAnyBins.length > 0) metadata.requires.anyBins = requiresAnyBins;
    if (requiresEnv.length > 0) metadata.requires.env = requiresEnv;
    if (requiresConfig.length > 0) metadata.requires.config = requiresConfig;
  }

  return metadata;
}

/**
 * 解析调用策略（双调用策略）。
 *
 * - user-invocable: 用户可手动调用（默认 true）
 * - disable-model-invocation: 禁止模型自主调用（默认 false）
 */
export function resolveSkillInvocationPolicy(
  frontmatter: Record<string, string>
): SkillInvocationPolicy {
  return {
    userInvocable: parseBool(frontmatter['user-invocable'], true),
    disableModelInvocation: parseBool(frontmatter['disable-model-invocation'], false),
  };
}

/**
 * 解析三层可见性。
 *
 * 默认：
 *  - includeInRuntimeRegistry: true（注册到运行时）
 *  - includeInAvailableSkillsPrompt: !disableModelInvocation（模型可见）
 *  - userInvocable: invocation.userInvocable（用户可调用）
 *
 * 可被 frontmatter 显式覆盖：
 *  - include-in-runtime-registry
 *  - include-in-available-skills-prompt
 */
export function resolveSkillExposure(
  frontmatter: Record<string, string>,
  invocation: SkillInvocationPolicy
): SkillExposure {
  const explicitRuntime = frontmatter['include-in-runtime-registry'];
  const explicitPrompt = frontmatter['include-in-available-skills-prompt'];

  return {
    includeInRuntimeRegistry: explicitRuntime !== undefined ? parseBool(explicitRuntime, true) : true,
    includeInAvailableSkillsPrompt:
      explicitPrompt !== undefined
        ? parseBool(explicitPrompt, true)
        : !invocation.disableModelInvocation,
    userInvocable: invocation.userInvocable,
  };
}

/**
 * 解析技能命令规格（用于命令分发）。
 *
 * frontmatter 可定义 `command-name` 与 `command-tool` 来注册为可调用命令：
 *  ---
 *  command-name: /plot-check
 *  command-tool: plotCheck
 *  ---
 */
export function resolveSkillCommandSpec(
  entry: SkillEntry
): SkillCommandSpec | undefined {
  const commandName = entry.frontmatter['command-name'];
  if (!commandName) return undefined;

  const toolName = entry.frontmatter['command-tool'];
  const dispatch: SkillCommandDispatchSpec | undefined = toolName
    ? { kind: 'tool', toolName, argMode: 'raw' }
    : undefined;

  return {
    name: commandName,
    skillFile: entry.skill.filePath,
    skillName: entry.skill.name,
    description: entry.skill.description,
    modelVisible: entry.exposure?.includeInAvailableSkillsPrompt ?? true,
    skillSource: entry.skill.source,
    dispatch,
  };
}

// ==================== Prompt 格式化 ====================

/**
 * XML 转义（与 openclaw formatSkillsForPrompt 对齐）。
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 将可用技能列表格式化为 XML 块，注入 system prompt。
 *
 * 适配 openclaw formatSkillsForPrompt 格式，便于模型理解技能位置与版本：
 *
 * <available_skills>
 *   <skill>
 *     <name>plot-check</name>
 *     <description>...</description>
 *     <location>/path/to/SKILL.md</location>
 *     <version>1</version>
 *   </skill>
 * </available_skills>
 *
 * @param skills 可用技能列表（已过滤可见性）
 * @returns XML 格式的可用技能块（空列表返回空字符串）
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return '';
  }

  const lines: string[] = [
    '',
    '',
    'The following skills provide specialized instructions for specific tasks.',
    "Use the read tool to load a skill's file when the task matches its description.",
    "If a skill's <version> differs from a previous turn, re-read its SKILL.md before using it.",
    'When a skill file references a relative path, resolve it against the skill directory.',
    '',
    '<available_skills>',
  ];

  for (const skill of skills) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push(`    <version>${SKILL_PROMPT_FORMAT_VERSION}</version>`);
    lines.push('  </skill>');
  }

  lines.push('</available_skills>');
  return lines.join('\n');
}

/**
 * 截断 body 内容到指定长度（防止过长 prompt）。
 *
 * @param body SKILL.md body 内容
 * @param maxChars 最大字符数（默认 4000）
 * @returns 截断后的 body（末尾追加 `... [truncated]` 提示）
 */
export function truncateSkillBody(body: string, maxChars: number = 4000): string {
  if (body.length <= maxChars) return body;
  return body.substring(0, maxChars) + '\n\n... [truncated]';
}

// ==================== 辅助：技能键解析 ====================

/**
 * 解析技能键（用于配置过滤）。
 *
 * 优先使用 metadata.skillKey，否则使用 skill.name。
 */
export function resolveSkillKey(entry: SkillEntry): string {
  return entry.metadata?.skillKey ?? entry.skill.name;
}

/**
 * 标准化技能名（用于过滤与命令匹配，参考 openclaw normalizeSkillIndexName）。
 */
export function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}
