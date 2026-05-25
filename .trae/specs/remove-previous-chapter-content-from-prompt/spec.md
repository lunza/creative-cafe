# 移除章节生成中前序章节内容 Prompt Spec

## Why
当前章节生成流程中，前序章节内容（fullContent 截断文本）被拼接进 AI 提示词，消耗大量 token。由于已引入历史剧情表格数据作为前序剧情的完整结构化参考，前序章节的原始文本已成为冗余上下文。移除后可显著优化 token 使用效率，同时让模型更专注于当前章节生成。

## What Changes
- 从 `ContentGenerator` 中移除 `buildRecentChapters` 方法及其调用
- 从 `PromptBuilder.buildContentPrompt` 中移除前序章节内容的拼接逻辑
- 从 `useChapterGeneration.ts` 中移除构建 `previousChapters` 的逻辑
- `ContentGenerationRequest.previousChapters` 字段保留但不使用（向后兼容）

## Impact
- Affected specs: integrate-plot-table-into-chapter-generation（历史剧情表格已提供完整前序参考）
- Affected code:
  - `src/main/services/writing/ContentGenerator.ts`
  - `src/main/services/writing/PromptBuilder.ts`
  - `src/renderer/components/Creative/WritingMode/hooks/useChapterGeneration.ts`
  - `test/PromptBuilder.tableContext.test.ts`

## MODIFIED Requirements

### Requirement: 章节生成提示词构建
系统 SHALL 在构建章节生成提示词时，不再包含前序章节原文内容。历史剧情表格数据（tableContext）已替代其作为前序剧情参考。

#### Scenario: 提示词构建不包含前序章节原文
- **WHEN** 章节生成请求被处理
- **THEN** 提示词中不包含 `## 前序章节内容` 部分
- **AND** 提示词中包含 `## 历史剧情表格数据` 部分（如果存在表格数据）
- **AND** 提示词中保留 `## 所有章节概要` 部分作为章节级别参考

### Requirement: ContentGenerator.buildPrompt
`buildPrompt` 方法 SHALL 不再将 `recentChapters` 传入 `promptBuilder.buildContentPrompt`。

## REMOVED Requirements

### Requirement: 前序章节内容拼接
**Reason**: 历史剧情表格数据已提供完整的结构化前序剧情参考，原始章节文本冗余且消耗过多 token
**Migration**: 前序剧情信息通过 `tableContext`（历史剧情表格数据）提供，章节级别概要通过 `chapterSummaries` 提供
