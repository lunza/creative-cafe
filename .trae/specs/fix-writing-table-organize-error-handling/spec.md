# 修复写作模式表格整理AI调用错误处理

## Why
写作模式点击"表格整理"按钮后，虽然日志显示"AI未返回有效响应"，但系统仍然返回 `processedCount: 1, errorCount: 0`，错误未被正确计数。原因是 `processChapterWithAI` 方法在AI返回空响应或解析失败时仅 `return void`，不抛出异常，导致调用方无法感知错误。

## What Changes
- 修改 `WritingStorageService.processChapterWithAI()` 返回类型从 `Promise<void>` 改为 `Promise<boolean>`，返回处理是否成功
- 当AI返回空响应时，记录错误并返回 `false`
- 当tableEdit解析失败时，记录错误并返回 `false`
- 修改 `organizeTable()` 根据返回值正确累加 `errorCount`
- 添加详细的 `addLog` 日志，与聊天模式保持一致
- 添加进度保存和通知机制

## Impact
- Affected specs: 写作模式表格整理
- Affected code: `src/main/services/WritingStorageService.ts`

## MODIFIED Requirements
### Requirement: 表格整理错误处理
**原因**: 当前错误处理不完善，AI返回空响应时不计数为错误

#### Scenario: AI返回空响应
- **WHEN** AI API 返回空字符串或无有效内容
- **THEN** 应记录错误到 `errors` 数组，累加 `errorCount`，并继续处理下一章节

#### Scenario: tableEdit解析失败
- **WHEN** AI响应中未解析到有效的 tableEdit 命令
- **THEN** 应记录错误到 `errors` 数组，累加 `errorCount`，并继续处理下一章节

#### Scenario: 章节处理成功
- **WHEN** AI返回有效响应且成功解析并执行tableEdit命令
- **THEN** `errorCount` 不变，`processedCount` 正确累加

## REMOVED Requirements
### Requirement: 静默返回
**原因**: 原 `processChapterWithAI` 在AI返回空响应时静默 `return void`，导致错误不被记录
**迁移**: 改为返回 `false` 并记录错误信息
