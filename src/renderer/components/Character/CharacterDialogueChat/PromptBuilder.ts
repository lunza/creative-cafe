/**
 * 【Phase 3 / L1 - conversation-mode-optimization-report】PromptBuilder 拆分为 barrel 文件。
 *
 * 原 2050 行单体文件按职责拆分为 9 个域文件（单文件 < 400 行），本文件仅做聚合导出，
 * 所有原 `import { ... } from './PromptBuilder'` 的引用点零改动。
 *
 * 域文件分工：
 * - promptTypes.ts          类型定义与共享常量（DEFAULT_USER_NAME + 3 个接口）
 * - dialogueRules.ts        底层对话规则工具（stop sequences / 角色锚点 / 辅助模式 / 精简指令集）
 * - userReplyPrompts.ts     用户回复与润色系统提示
 * - promptCore.ts           角色上下文与核心提示词（buildPromptCore 等）
 * - promptAssembly.ts       提示词装配（buildDialoguePrompt / buildSystemPrompt 等）
 * - tableOrganizePrompts.ts 异步表格整理指令
 * - emotionPromptMaps.ts    情绪预置与 SD 提示词映射（EMOTION_PRESETS / EMOTION_PROMPT_MAP）
 * - expressionPrompts.ts    表情约束与 NL 表情提示
 * - assetPromptTemplates.ts 素材生成提示词模板（NUDE_FIXED_TAGS / buildAssetPromptTemplate）
 */

export * from './promptTypes';
export * from './dialogueRules';
export * from './userReplyPrompts';
export * from './promptCore';
export * from './promptAssembly';
export * from './tableOrganizePrompts';
export * from './emotionPromptMaps';
export * from './expressionPrompts';
export * from './assetPromptTemplates';
