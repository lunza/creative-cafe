# 迁移章节数据到outline.chapters Spec

## Why
当前代码中存在 `project.chapters` 和 `project.outline.chapters` 双重数据结构，导致数据同步风险和维护复杂度。为简化架构并消除不一致风险，决定将所有章节数据操作统一迁移到 `project.outline.chapters`，并彻底移除 `project.chapters`。

## What Changes
- **BREAKING**: 移除 `WritingProject` 接口中的 `chapters` 字段，仅保留 `outline.chapters` 作为唯一的章节数据存储
- 将所有读取 `project.chapters` 的代码迁移为读取 `project.outline.chapters`
- 将所有写入 `project.chapters` 的代码迁移为写入 `project.outline.chapters`
- 重构大纲生成功能，使其仅生成 `project.outline.chapters` 结构
- 调整章节内容存储和加载逻辑，使其基于 `project.outline.chapters`
- 更新所有相关组件、hooks、服务层代码

## Impact
- **受影响规格**：写作模式、大纲生成、章节生成、章节编辑、章节拆分/合并
- **受影响代码**：
  - `src/shared/types/writing.types.ts` - WritingProject接口定义
  - `src/main/services/WritingStorageService.ts` - 项目存储和加载
  - `src/main/ipc/handlers/writingHandlers.ts` - IPC处理器
  - `src/renderer/stores/writingProjectStore.ts` - 状态管理
  - `src/renderer/components/Creative/WritingMode/` - 所有写作模式组件
  - `src/renderer/components/Creative/WritingMode/hooks/` - 所有写作模式hooks
  - `src/main/services/writing/` - 大纲和章节生成服务

## ADDED Requirements
### Requirement: 统一使用outline.chapters
系统应当仅使用 `project.outline.chapters` 作为章节数据的唯一存储位置。

#### Scenario: 读取章节数据
- **WHEN** 需要读取章节列表时
- **THEN** 应当从 `project.outline.chapters` 中获取

#### Scenario: 写入章节数据
- **WHEN** 需要更新章节信息时
- **THEN** 应当写入 `project.outline.chapters`

### Requirement: 大纲生成仅生成outline.chapters
系统生成新大纲时，应当仅生成 `project.outline.chapters` 结构。

#### Scenario: AI生成大纲
- **WHEN** AI生成新大纲时
- **THEN** 结果应存储在 `project.outline.chapters` 中，不再生成 `project.chapters`

## MODIFIED Requirements
### Requirement: WritingProject接口
**原要求**：WritingProject包含 `chapters: Chapter[]` 和 `outline?: GeneratedOutline` 两个独立字段
**修改为**：移除 `chapters` 字段，仅保留 `outline` 字段，章节数据存储在 `outline.chapters` 中

### Requirement: 章节内容存储
**原要求**：章节内容通过 `project.chapters[i].content` 访问
**修改为**：章节内容通过 `project.outline.chapters[i].content` 访问（需扩展ChapterOutline类型以支持content字段）

## REMOVED Requirements
### Requirement: project.chapters双重存储
**原因**：消除数据冗余和同步风险
**迁移方案**：所有对 `project.chapters` 的操作迁移到 `project.outline.chapters`，移除 `WritingProject.chapters` 字段定义
