# Fix Plot Check Issue Title and Quick Fix Prompt

## Why
AI 返回剧情检查结果时存在两个问题：1) 每个维度的 issue 缺少 `title` 字段，导致前端始终显示"未知问题"；2) `quickFixSuggestion` 返回 `null`，导致快速修复按钮不显示。需要修改 AI 提示词，明确要求 AI 为每个 issue 提供 `title` 字段，并在 `quickFixSuggestion` 中返回包含标点符号和特殊符号的完整原文。

## What Changes
- 修改 `buildCheckPrompt` 中的 AI 提示词，在输出格式要求中为每个 issue 增加必填的 `title` 字段
- 在提示词中强化 `quickFixSuggestion.originalText` 的说明，强调必须包含标点符号和特殊符号
- 在 `parseCheckResponse` 中为缺失 `title` 的 issue 提供从 `description` 生成默认 title 的 fallback 逻辑
- 确保前端能正确显示问题标题和快速修复按钮

## Impact
- Affected specs: plot-checker
- Affected code: src/main/services/writing/PlotCheckerService.ts

## MODIFIED Requirements
### Requirement: AI Check Output Format
The system SHALL ensure AI returns a `title` field for every issue, and the `quickFixSuggestion.originalText` includes all punctuation and special characters for exact matching.

#### Scenario: AI returns issue without title
- **WHEN** AI returns an issue without a title field
- **THEN** parseCheckResponse shall generate a default title from the first 20 characters of description

#### Scenario: AI returns quickFixSuggestion
- **WHEN** a fixable issue is detected
- **THEN** quickFixSuggestion.originalText shall be the exact text from the chapter content, including all punctuation
