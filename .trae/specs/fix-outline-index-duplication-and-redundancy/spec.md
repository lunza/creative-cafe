# 修复大纲索引重复和数据结构冗余问题 Spec

## Why
当前写作功能存在两个关键问题：
1. 大纲索引值重复问题：当AI生成大纲内容后，再次点击"生成大纲"按钮时，系统在project.json文件的project.outline.chapters节点中产生了索引值异常，如第一章和第二章的index值均为1。
2. 数据结构冗余问题：当前代码中project.chapters与project.outline.chapters的内容基本完全一致，这种数据结构冗余会导致后期代码维护困难，增加数据同步风险和存储空间浪费。

## What Changes
- **移除冗余结构**：统一使用`project.chapters`作为唯一的章节数据存储结构，废弃`project.outline.chapters`
- **修复索引分配逻辑**：确保章节索引正确递增且唯一，避免重复分配
- **统一数据访问**：所有章节相关的访问和修改操作都通过`project.chapters`进行
- **更新API接口**：修改所有涉及章节操作的API接口以使用新的数据结构

## Impact
- **受影响规格**：写作模式相关功能、大纲生成与编辑、章节内容生成
- **受影响代码**：
  - src/main/services/WritingStorageService.ts
  - src/main/ipc/handlers/writingHandlers.ts
  - src/renderer/stores/writingProjectStore.ts
  - src/renderer/components/Creative/WritingMode/*
  - src/shared/types/writing.types.ts

## ADDED Requirements
### Requirement: 统一章节数据存储
系统应当使用单一的数据结构`project.chapters`来存储所有章节信息，避免数据冗余。

#### Scenario: 章节数据更新
- **WHEN** 用户更新大纲或生成新章节时
- **THEN** 系统应当同步更新`project.chapters`，而不是分别维护`project.chapters`和`project.outline.chapters`

### Requirement: 索引唯一性
系统应当确保章节索引值的唯一性和连续性。

#### Scenario: 生成新大纲
- **WHEN** AI生成新大纲时
- **THEN** 章节索引应当从1开始连续递增，不得出现重复索引

## MODIFIED Requirements
### Requirement: 章节数据访问
**原要求**：章节数据可通过`project.chapters`和`project.outline.chapters`两种方式访问
**修改为**：章节数据仅通过`project.chapters`访问，`project.outline.chapters`不再用于数据存储

### Requirement: 大纲更新操作
**原要求**：大纲更新仅影响`project.outline.chapters`
**修改为**：大纲更新同时影响`project.outline`（用于显示）和`project.chapters`（用于实际数据）

## REMOVED Requirements
### Requirement: 双重数据存储
**原因**：为了解决数据冗余和同步问题
**迁移方案**：将所有依赖`project.outline.chapters`的代码迁移到使用`project.chapters`