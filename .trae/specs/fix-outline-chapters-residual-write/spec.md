# 二次修复：彻底移除project.chapters根级别写入 Spec

## Why
前期已完成对 `project.chapters` 到 `project.outline.chapters` 的迁移重构，但用户验证发现新生成的项目 `project.json` 文件中仍然同时存在根级别的 `chapters` 字段和 `outline.chapters` 字段。这是因为在前端组件的 `updateProject` 调用中，错误地同时传递了 `chapters` 和 `outline` 两个字段到 updates 对象中，由于 zustand store 使用 spread 合并（`{ ...p, ...updates }`），导致根级别 `chapters` 被写入并持久化到文件中。

## What Changes
- **修复 useChapterStructure.ts 中 handleSplitConfirm 的 updateProject 调用**：移除 `{ chapters: newProjectChapters, outline: newOutline }` 中的 `chapters` 字段，仅传递 `{ outline: newOutline }`
- **修复 useChapterStructure.ts 中 handleMergeConfirm 的 updateProject 调用**：同上，移除 `chapters` 字段，仅传递 `{ outline: newOutline }`
- **全面验证**：确保所有 `updateProject` 调用不再同时传递 `chapters` 和 `outline` 两个独立字段

## Impact
- **受影响规格**：写作模式 - 章节拆分、章节合并
- **受影响代码**：
  - `src/renderer/components/Creative/WritingMode/hooks/useChapterStructure.ts` - 章节拆分/合并确认处理
  - `src/renderer/stores/writingProjectStore.ts` - updateProject 方法（验证）

## MODIFIED Requirements
### Requirement: updateProject 调用规范
**原要求**：拆分/合并章节时，updateProject 同时传递 `chapters` 和 `outline` 字段
**修改为**：仅传递 `outline` 字段，章节数据完全包含在 `outline.chapters` 中，不在根级别维护独立的 `chapters` 字段

### Requirement: 项目数据结构
**原要求**：项目JSON文件中可能同时存在 `chapters` 和 `outline.chapters`
**修改为**：项目JSON文件中仅存在 `outline.chapters`，不存在根级别 `chapters` 字段

## REMOVED Requirements
### Requirement: 根级别chapters字段的写入
**原因**：这是前期重构遗留的bug，导致用户验证失败
**迁移方案**：移除所有 updateProject 调用中对 `chapters` 字段的传递
