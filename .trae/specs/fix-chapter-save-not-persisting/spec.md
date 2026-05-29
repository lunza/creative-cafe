# Fix Chapter Save - Chapters Not Persisting to project.json Spec

## Why
用户报告点击"保存当前章节信息"按钮后，project.json 文件中的章节数据没有更新。后端日志显示保存成功，但磁盘上的文件内容仍然是旧数据。需要深入排查数据流中所有章节更新路径是否都正确同步了章节数据到持久化层。

## What Changes
- 修复 `ManualOutlineEditor` 中所有章节操作方法（addChapter, addSubChapter, deleteChapter, moveChapter, mergeChapters, splitChapter）未同步更新 `chaptersRef` 的问题
- 确保 `updateOutline` 在 Zustand store 中正确更新后，数据能立即同步到自动保存流程
- 增强 `handleFormChange` 的数据更新逻辑，确保深拷贝后的数据正确传播

## Impact
- Affected specs: 章节保存持久化、大纲编辑功能
- Affected code:
  - src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx
  - src/renderer/stores/writingProjectStore.ts

## MODIFIED Requirements
### Requirement: 所有章节操作同步更新 chaptersRef
`ManualOutlineEditor` 中的所有章节操作方法（添加、删除、移动、合并、分割）SHALL 在调用 `onChange` 之前同步更新 `chaptersRef.current`，确保 `handleSave` 始终读取到最新数据。

### Requirement: updateOutline 数据正确持久化
`updateOutline` 方法 SHALL 确保更新后的 chapters 数据正确写入 Zustand store，并通过 `triggerAutoSave` 立即触发保存到磁盘。

## REMOVED Requirements
### Requirement: None
没有需求被移除。
