# 大纲重要内容标记 JSON-safe 实现 Spec

## Why
用户希望"重要内容加粗显示"，但 AI 使用 `**加粗**` 等 Markdown 标记会破坏 JSON 格式。需要一个 JSON-safe 的标记方案，既能让 AI 标记重要内容，又不会导致 JSON 解析失败，且前端能识别并渲染为加粗效果。

## What Changes
- 在大纲 JSON schema 中为每个章节新增 `importantSpans` 数组字段，AI 以纯文本标记方式声明需要加粗的内容片段
- 在 `PromptBuilder.buildOutlinePrompt` 的大纲结构示例和生成要求中添加 `importantSpans` 的使用说明
- 在前端渲染大纲时，将 `importantSpans` 中的内容以加粗样式显示
- 在创作配置面板的"额外要求"输入框下方添加提示文字，引导用户使用系统支持的标记方式而非 Markdown 格式
- **BREAKING**: 大纲 JSON schema 新增 `importantSpans` 字段（向后兼容，旧数据无此字段不影响显示）

## Impact
- Affected specs: 新增功能
- Affected code:
  - `src/main/services/writing/PromptBuilder.ts` — 大纲生成提示词
  - `src/shared/types/writing.types.ts` — ChapterOutline 类型定义
  - `src/renderer/components/Creative/WritingMode/WritingConfigPanel.tsx` — 额外要求提示
  - `src/renderer/components/Creative/WritingMode/WritingConfigModal.tsx` — 额外要求提示
  - `src/renderer/components/Creative/WritingMode/OutlineViewer.tsx` — 大纲展示渲染
  - `src/main/services/writing/OutlineGenerator.ts` — `stripMarkdownFromValues` 已存在，可清理残留 markdown

## ADDED Requirements
### Requirement: 大纲章节重要内容标记字段
The system SHALL add an `importantSpans` field to each chapter in the outline JSON schema. This field is an array of strings listing text fragments that should be displayed in bold.

#### Scenario: 大纲生成包含 importantSpans
- **WHEN** AI 生成章节大纲
- **THEN** 每个章节对象包含 `importantSpans` 数组
- **THEN** 数组内容为需要在前端加粗显示的文本片段（纯文本，不含 Markdown 标记）
- **AND** JSON 能正常解析

#### Scenario: 前端渲染重要内容
- **WHEN** 前端渲染大纲章节概要或关键情节点
- **THEN** 若文本内容与 `importantSpans` 中某一项完全匹配
- **THEN** 该文本片段以加粗样式显示

### Requirement: 额外要求输入框提示
系统 SHALL 在"额外要求"输入框下方显示提示文字，告知用户如何使用系统支持的标记方式。

#### Scenario: 用户查看额外要求输入框
- **WHEN** 用户打开创作配置面板或配置弹窗
- **THEN** "额外要求"输入框下方显示灰色提示文字
- **THEN** 提示文字内容为"提示：如需加粗重要内容，请直接在「额外要求」中说明（如'重要金额、物品名称加粗显示'），系统会自动处理格式，无需输入Markdown标记"

### Requirement: 提示词中包含 importantSpans 指导
The outline generation prompt SHALL include clear instructions about the `importantSpans` field and how to use it.

#### Scenario: 提示词包含 importantSpans 说明
- **WHEN** 大纲生成提示词被构建
- **THEN** JSON 结构示例中每个章节包含 `importantSpans` 字段示例
- **THEN** 生成要求中说明何时使用 importantSpans（金额、重要物品、人物关系变化、剧情推动点等）

## MODIFIED Requirements
### Requirement: 大纲章节类型定义
The `ChapterOutline` type in `writing.types.ts` SHALL have an optional `importantSpans: string[]` field.
