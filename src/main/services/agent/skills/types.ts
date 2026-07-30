/**
 * 技能类型契约 —— 适配 openclaw src/skills/types.ts
 *
 * 来源：g:\AI\creative-cafe\sillytavern-source\openclaw-main\src\skills\types.ts
 * 决策：适配（spec §三）。SkillEntry/SkillExposure/SkillInvocationPolicy 直接用；
 *       SkillInstallSpec 简化（本项目无需 brew/go/uv 多语言安装）。
 *
 * 职责：
 *  1. 定义 SKILL.md 技能的元数据结构（frontmatter + body）
 *  2. 定义三层可见性（includeInRuntimeRegistry / includeInAvailableSkillsPrompt / userInvocable）
 *  3. 定义双调用策略（userInvocable + disableModelInvocation）
 *  4. 定义会话快照（SkillSnapshot，注入 prompt）
 *
 * 设计约束（参考 openclaw SKILL.md 契约）：
 *  - 技能由 SKILL.md 文件定义（frontmatter + markdown body）
 *  - 三层可见性控制技能在何处生效（运行时注册 / prompt 注入 / 用户命令面板）
 *  - 双调用策略：用户可手动调用 / 模型可自主调用（可分别禁用）
 */

// ==================== 技能元数据 ====================

/**
 * 技能来源标识。
 */
export type SkillSource = 'builtin' | 'workspace' | 'unknown';

/**
 * 内置技能元数据（从 SKILL.md frontmatter 解析）。
 *
 * 适配 openclaw OpenClawSkillMetadata，简化 requires.install（本项目无需多语言安装）。
 */
export interface SkillMetadata {
  /** 是否常驻（always-on，不需要触发条件） */
  always?: boolean;
  /** 技能键名（可与 name 不同，用于配置过滤） */
  skillKey?: string;
  /** 主要环境变量依赖（用于诊断） */
  primaryEnv?: string;
  /** emoji 图标（UI 展示） */
  emoji?: string;
  /** 主页 URL */
  homepage?: string;
  /** 操作系统限制 */
  os?: string[];
  /** 依赖声明 */
  requires?: {
    /** 必须存在的可执行文件 */
    bins?: string[];
    /** 任一存在即可的可执行文件 */
    anyBins?: string[];
    /** 必须存在的环境变量 */
    env?: string[];
    /** 必须存在的配置项 */
    config?: string[];
  };
}

// ==================== 调用策略 ====================

/**
 * 技能调用策略（双调用策略）。
 *
 * - userInvocable: 用户可通过命令面板手动调用
 * - disableModelInvocation: 禁止模型自主调用（仅用户触发）
 *
 * 默认：userInvocable=true, disableModelInvocation=false
 * （用户可调用 + 模型可自主调用）
 */
export interface SkillInvocationPolicy {
  userInvocable: boolean;
  disableModelInvocation: boolean;
}

// ==================== 可见性 ====================

/**
 * 技能三层可见性。
 *
 * 参考 openclaw SKILL.md 契约：
 *  1. includeInRuntimeRegistry: 是否注册到运行时（可被 invoke）
 *  2. includeInAvailableSkillsPrompt: 是否注入到「可用技能」prompt（模型可见）
 *  3. userInvocable: 是否在用户命令面板可见
 */
export interface SkillExposure {
  includeInRuntimeRegistry: boolean;
  includeInAvailableSkillsPrompt: boolean;
  userInvocable: boolean;
}

// ==================== 技能命令规格 ====================

/**
 * 技能命令分发规格。
 *
 * openclaw 支持 tool / prompt-template 等多种分发；
 * 本项目首期仅支持 tool 分发（调用指定工具）。
 */
export interface SkillCommandDispatchSpec {
  kind: 'tool';
  /** 要调用的工具名（对应 IToolProvider 中的工具） */
  toolName: string;
  /** 参数转发模式：raw = 原样转发用户输入字符串 */
  argMode?: 'raw';
}

/**
 * 技能命令规格（对应 openclaw SkillCommandSpec）。
 */
export interface SkillCommandSpec {
  /** 命令名（用户输入的命令） */
  name: string;
  /** SKILL.md 文件路径（用于生命周期追踪） */
  skillFile?: string;
  /** 所属技能名 */
  skillName: string;
  /** 命令描述（用户可见） */
  description: string;
  /** 模型是否可见（是否注入 available-skills prompt） */
  modelVisible?: boolean;
  /** 技能来源标识 */
  skillSource?: SkillSource;
  /** 分发行为 */
  dispatch?: SkillCommandDispatchSpec;
}

// ==================== 技能条目 ====================

/**
 * SKILL.md 解析后的技能对象（简化版，替代 openclaw 的 Skill 类型）。
 */
export interface Skill {
  /** 技能名（frontmatter name，唯一标识） */
  name: string;
  /** 技能描述（frontmatter description，模型可见） */
  description: string;
  /** SKILL.md body 内容（使用说明，注入 prompt 时可能截断） */
  body: string;
  /** SKILL.md 文件路径 */
  filePath: string;
  /** 来源 */
  source: SkillSource;
}

/**
 * 技能注册条目（skillRegistry 的存储单元）。
 *
 * 适配 openclaw SkillEntry，去除 syncSourceDir/syncDirName（本项目无工作区同步）。
 */
export interface SkillEntry {
  /** 技能对象 */
  skill: Skill;
  /** frontmatter 原始解析结果 */
  frontmatter: Record<string, string>;
  /** 元数据（从 frontmatter 解析的结构化字段） */
  metadata?: SkillMetadata;
  /** 调用策略 */
  invocation?: SkillInvocationPolicy;
  /** 可见性配置 */
  exposure?: SkillExposure;
  /** 是否禁用命令分发（仅注入 prompt，不注册为可调用命令） */
  disableCommandDispatch?: boolean;
}

// ==================== 会话快照 ====================

/**
 * 技能会话快照（注入 prompt 的可用技能列表）。
 *
 * 适配 openclaw SkillSnapshot，简化 resolvedSkills（首期无需在快照中携带完整 Skill）。
 */
export interface SkillSnapshot {
  /** 注入 prompt 的技能描述文本 */
  prompt: string;
  /** 快照中包含的技能列表（精简信息） */
  skills: Array<{
    name: string;
    skillKey?: string;
    primaryEnv?: string;
    requiredEnv?: string[];
  }>;
  /** agent 级过滤（undefined 表示无过滤） */
  skillFilter?: string[];
  /** 会话级覆盖（按技能名启用/禁用） */
  skillOverrides?: Record<string, boolean>;
  /** prompt 格式版本 */
  promptFormatVersion?: number;
}

export const SKILL_PROMPT_FORMAT_VERSION = 1;
