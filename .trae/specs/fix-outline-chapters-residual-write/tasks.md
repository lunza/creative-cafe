# Tasks

- [x] Task 1: 修复所有 updateProject 调用中的 chapters 字段残留
  - [x] SubTask 1.1: 修复 useChapterStructure.ts handleSplitConfirm 函数(原133行)，移除 `chapters: newProjectChapters`，仅传递 `{ outline: newOutline }`
  - [x] SubTask 1.2: 修复 useChapterStructure.ts handleMergeConfirm 函数(原206行)，移除 `chapters: newProjectChapters`，仅传递 `{ outline: newOutline }`
  - [x] SubTask 1.3: 修复 useChapterGeneration.ts handleEditorChange 函数(原163行)，将 `chapters: ...` 改为 `outline: { ...project.outline, chapters: ... }`
  - [x] SubTask 1.4: 修复 useChapterGeneration.ts onStreamComplete 回调(原228行)，同上修复
  - [x] SubTask 1.5: 修复 useChapterGeneration.ts handleSaveChapter 函数(原473行)，同上修复
  - [x] SubTask 1.6: 修复 useChapterGeneration.ts handleClearChapter 函数(原503行)，同上修复
  - [x] SubTask 1.7: 修复 usePlotCheck.ts handleAutoFix 函数(原180行)，同上修复
  - [x] SubTask 1.8: 修复 usePlotCheck.ts handleContentUpdated 函数(原216行)，同上修复
  - [x] SubTask 1.9: 修复 usePlotCheck.ts handleRejectFix 函数(原288行)，同上修复
  - [x] SubTask 1.10: 修复 usePlotCheck.ts handleAcceptQuickFix 函数(原339行)，同上修复
  - [x] SubTask 1.11: 修复 usePlotCheck.ts handleBatchFix 函数(原498行)，同上修复
  - [x] SubTask 1.12: 修复 OutlineEditor.tsx handleConfirmOutline 函数(原90行)，移除 `chapters: ...` 字段

- [x] Task 2: 全局搜索验证所有 updateProject 调用
  - [x] SubTask 2.1: 搜索所有 `updateProject` 调用，确认没有地方在根级别同时传递 `chapters` 和 `outline` 字段
  - [x] SubTask 2.2: 确保所有章节数据更新仅通过 `outline.chapters` 进行

- [x] Task 3: 编译验证
  - [x] SubTask 3.1: 运行 TypeScript 编译，确认无新增错误（所有错误为重构前已存在）

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
