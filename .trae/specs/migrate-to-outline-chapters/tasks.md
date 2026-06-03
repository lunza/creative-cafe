# Tasks

## 清理 project.chapters 残留引用

- [x] Task 8: 清理 WritingStorageService 中剩余的 project.chapters 引用
  - [x] SubTask 8.1: 移除 loadProject() 中调试日志对 project.chapters 的引用
  - [x] SubTask 8.2: 移除 loadProject() 中将根级别 chapters 合并到 outline.chapters 的兼容性逻辑

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 1]
- [Task 5] depends on [Task 2, Task 3]
- [Task 6] depends on [Task 2]
- [Task 7] depends on [Task 5, Task 6]
- [Task 8] depends on [Task 2]