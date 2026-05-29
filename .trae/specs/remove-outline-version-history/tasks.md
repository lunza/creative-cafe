# Tasks
- [x] Task 1: 清理 writingProjectStore 中的版本历史代码
  - [x] SubTask 1.1: 移除 outlineHistory、outlineHistoryIndex 状态
  - [x] SubTask 1.2: 移除 undoOutline、redoOutline、canUndo、canRedo 方法
  - [x] SubTask 1.3: 移除 updateOutline 中的历史版本推送逻辑
- [x] Task 2: 清理 ManualOutlineEditor 中的撤销/重做功能
  - [x] SubTask 2.1: 移除 undo/redo 按钮及相关状态
  - [x] SubTask 2.2: 移除 handleUndo、handleRedo 处理函数
- [x] Task 3: 清理 OutlineEditPanel 中的版本历史入口
  - [x] SubTask 3.1: 移除版本历史按钮
  - [x] SubTask 3.2: 移除 VersionHistoryPanel 组件引用
- [x] Task 4: 删除 VersionHistoryPanel.tsx 文件
- [x] Task 5: 清理 writingHandlers.ts 中的 outlineHistory 相关代码
- [x] Task 6: 清理 writing.types.ts 中的 outlineHistory 类型

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 5] depends on [Task 1]
- [Task 6] depends on [Task 1]
- [Task 4] can run in parallel
