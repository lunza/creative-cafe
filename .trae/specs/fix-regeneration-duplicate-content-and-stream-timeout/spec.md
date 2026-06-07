# 修复重新生成内容重复和流中断问题 Spec

## Why

重新生成功能存在两个关键问题：
1. **内容重复**：上次生成内容中的 `<think>...</think>` 标签被完整传递给 AI 作为参考，导致模型将思考过程当作正文内容复制输出，造成生成内容重复
2. **流中断（timeout）**：`<think>` 思考过程通常包含大量文字，显著增加了提示词的总长度，加上长文本生成本身耗时较长，容易触发 API 超时导致流中断

## What Changes

- 在 ContentGenerator 的 `buildPrompt` 方法中，将 `previousChapterContent` 中的 `<think>` 标签及其内容剥离后再拼接到提示词
- 添加 `stripThinkTags()` 辅助函数，移除 `<think>` 和 `</think>` 标签及之间的所有内容

## Impact

- Affected specs: 重新生成建议面板（add-generation-suggestion-panel）
- Affected code: `ContentGenerator.ts` 中的 `buildPrompt` 方法

## ADDED Requirements

### Requirement: 剥离思考标签
系统 SHALL 在重新生成时将上次内容中的 `<think>` 标签及内容移除，仅保留正文内容作为参考。

#### Scenario: 上次内容包含 <think> 标签
- **WHEN** 用户重新生成章节，上次生成内容包含 `<think>...</think>` 标签
- **THEN** 系统自动移除所有 `<think>` 标签及其之间的内容，仅将正文部分拼接到提示词

#### Scenario: 上次内容不包含 <think> 标签
- **WHEN** 用户重新生成章节，上次生成内容不包含 `<think>` 标签
- **THEN** 系统按原样传递内容（不受影响）
