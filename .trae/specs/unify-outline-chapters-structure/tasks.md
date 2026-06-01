# Tasks

- [x] Task 1: 验证并清理类型定义 - 确保 writing.types.ts 仅使用 outline.chapters 作为章节数据源
  - [x] SubTask 1.1: 检查 GeneratedOutline.chapters 是否为唯一的章节数据定义
  - [x] SubTask 1.2: 确认 WritingProject 接口不包含冗余的 chapters 字段
  - [x] SubTask 1.3: 移除类型定义中所有与兼容性相关的注释或字段

- [x] Task 2: 清理 WritingStorageService 中的兼容性代码
  - [x] SubTask 2.1: 检查 loadProject() 方法，移除数据迁移或格式转换逻辑
  - [x] SubTask 2.2: 检查 saveProject() 方法，确保仅操作 outline.chapters
  - [x] SubTask 2.3: 检查 computeProjectMetadata() 方法，确保仅使用 outline.chapters

- [x] Task 3: 清理 writingHandlers.ts 中的兼容性代码
  - [x] SubTask 3.1: 检查所有 IPC handler，确保仅操作 outline.chapters
  - [x] SubTask 3.2: 移除任何同步 outline.chapters 到其他位置代码

- [x] Task 4: 清理 writingProjectStore 中的兼容性代码
  - [x] SubTask 4.1: 检查 updateOutline() 方法，确保仅更新 outline.chapters
  - [x] SubTask 4.2: 移除任何数据同步相关代码

- [x] Task 5: 清理大纲生成服务中的兼容性代码
  - [x] SubTask 5.1: 检查 OutlineGenerator.ts，确保仅生成 outline.chapters
  - [x] SubTask 5.2: 移除任何同步到其他位置代码

- [x] Task 6: 验证 UI 组件和 hooks 仅使用 outline.chapters
  - [x] SubTask 6.1: 检查所有 WritingMode 组件，确保使用 outline.chapters
  - [x] SubTask 6.2: 检查所有 hooks，确保使用 outline.chapters
  - [x] SubTask 6.3: 移除任何兼容性访问代码

- [x] Task 7: 编译验证和测试
  - [x] SubTask 7.1: 运行 TypeScript 编译，确保无错误
  - [x] SubTask 7.2: 验证大纲生成功能正常
  - [x] SubTask 7.3: 验证章节编辑功能正常

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 1]
- [Task 5] depends on [Task 1]
- [Task 6] depends on [Task 2, Task 3, Task 4, Task 5]
- [Task 7] depends on [Task 6]
