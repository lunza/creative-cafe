# 修复章节内容刷新后丢失 Spec

## Why
用户报告：完成章节内容生成并保存后，刷新页面或重新进入内容创作功能时，已生成的章节内容消失（大纲保留，内容丢失）。经过代码分析，根本原因是 `loadProjects` IPC 处理器只加载 `projects-index.json` 索引文件，该文件仅包含元数据（标题、字数、章节数），不包含章节实际内容。章节内容存储在独立的 `project.json` 和 `chapter-*.md` 文件中，需要在进入项目时从磁盘重新加载。

## What Changes
- 修改 `loadProjects` IPC handler，在加载项目列表后，为每个项目调用 `loadProject()` 从磁盘加载完整的章节内容
- 修改 `writingProjectStore.loadProjects` 确保接收包含完整章节内容的项目数据
- 修改 `useChapterGeneration` 初始化逻辑，确保在刷新页面后能正确从加载的项目数据中恢复章节内容
- 增强 `WritingStorageService.loadProject` 的数据验证，确保章节内容恢复的可靠性
- 添加必要的错误处理和日志记录

## Impact
- Affected specs: 写作模式章节内容持久化
- Affected code:
  - `src/main/ipc/handlers/writingHandlers.ts` (loadProjects handler)
  - `src/renderer/stores/writingProjectStore.ts` (loadProjects)
  - `src/renderer/components/Creative/WritingMode/hooks/useChapterGeneration.ts` (初始化)
  - `src/main/services/WritingStorageService.ts` (loadProject)

## MODIFIED Requirements
### Requirement: 项目加载时恢复章节内容
系统 SHALL 在加载项目列表时，从磁盘完整加载每个项目的所有章节内容，确保刷新页面后已保存的内容不会丢失。

#### Scenario: 刷新页面后恢复内容
- **WHEN** 用户在章节内容生成并保存后刷新页面
- **THEN** 所有已保存的章节内容应从磁盘正确恢复并显示在编辑器中

### Requirement: 章节内容存储与加载一致性
系统 SHALL 确保保存的章节内容与加载的章节内容完全一致，包括文本内容和元数据（字数、状态等）。

#### Scenario: 内容一致性验证
- **WHEN** 用户保存章节内容后重新加载项目
- **THEN** 加载的章节内容应与保存的内容完全一致
