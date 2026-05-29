# 修复章节数据重复结构和 Index 重复问题 Spec

## Why
project.json 中存在两级 chapters 数据重复（outline.chapters 和 project.chapters 内容一致），且章节 index 值存在重复（第一章和第二章 index 均为 1），导致数据冗余、维护困难和查找错误。

## What Changes
- 统一使用 `project.chapters` 作为章节数据的唯一来源
- 移除 `handleConfirmOutline` 中对 `outline.chapters` 的写入，改为仅写入 `project.chapters`
- 修复 `ManualOutlineEditor` 中 `addChapter` 的 index 计算错误（改为基于最大 index + 1）
- 修复 `addSubChapter` 中的 index 计算逻辑
- 更新 `WritingStorageService` 中所有 `project.chapters` 引用改为 `project.outline.chapters` 或统一使用 `project.chapters`
- 更新 `writing.types.ts` 类型定义
- 更新所有依赖文件（usePlotCheck, useChapterGeneration, useChapterStructure, useVersionManagement, WritingModeEntry, WritingProgressDashboard）

## Impact
- **BREAKING**: project.json 结构变更，移除冗余的 `outline.chapters` 和 `project.chapters` 重复
- Affected specs: 章节数据持久化、大纲编辑功能、章节内容生成、版本管理
- Affected code:
  - src/shared/types/writing.types.ts
  - src/renderer/components/Creative/WritingMode/OutlineEditor.tsx
  - src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx
  - src/renderer/components/Creative/WritingMode/OutlineEditPanel.tsx
  - src/main/services/WritingStorageService.ts
  - src/renderer/components/Creative/WritingMode/hooks/usePlotCheck.ts
  - src/renderer/components/Creative/WritingMode/hooks/useChapterGeneration.ts
  - src/renderer/components/Creative/WritingMode/hooks/useChapterStructure.ts
  - src/renderer/components/Creative/WritingMode/hooks/useVersionManagement.ts
  - src/renderer/components/Creative/WritingMode/WritingModeEntry.tsx
  - src/renderer/components/Creative/WritingMode/WritingProgressDashboard.tsx

## ADDED Requirements
### Requirement: 单一数据源
系统 SHALL 仅使用 `project.chapters` 作为章节数据的唯一来源。`outline.chapters` SHALL 被移除。

#### Scenario: 保存大纲
- **WHEN** 用户确认大纲
- **THEN** 章节数据仅写入 `project.chapters`，不再写入 `outline.chapters`

### Requirement: 章节 index 唯一性
所有章节的 index 值 SHALL 唯一且连续递增。新增章节的 index SHALL 基于当前最大 index + 1 计算。

#### Scenario: 添加新章节
- **WHEN** 用户添加新章节
- **THEN** 新章节的 index = 当前最大 index + 1

## MODIFIED Requirements
### Requirement: WritingProject 接口
移除 `WritingProject.outline.chapters`，统一使用 `WritingProject.chapters`。`GeneratedOutline` 接口移除 `chapters` 字段。

### Requirement: ManualOutlineEditor index 计算
`addChapter` 和 `addSubChapter` 中的 index 计算 SHALL 基于当前最大 index 值 + 1，而非数组长度。

### Requirement: OutlineEditor 数据结构
`OutlineEditor` 和 `ManualOutlineEditor` SHALL 直接使用 `project.chapters`，不再依赖 `outline.chapters`。

## REMOVED Requirements
### Requirement: outline.chapters 冗余字段
**Reason**: `project.chapters` 已包含所有必要的章节信息（包括 outline 属性），`outline.chapters` 造成数据重复
**Migration**: 所有引用 `outline.chapters` 的代码改为使用 `project.chapters`。现有项目数据在加载时自动兼容。

### Requirement: GeneratedOutline.chapters
**Reason**: 与 `WritingProject.chapters` 重复
**Migration**: `GeneratedOutline` 类型移除 `chapters` 字段
