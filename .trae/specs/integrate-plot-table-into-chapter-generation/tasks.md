# Tasks
- [x] Task 1: 扩展 ContentGenerationRequest 类型
  - [x] SubTask 1.1: 在 writing.types.ts 的 ContentGenerationRequest 接口中添加 writingTableData 字段

- [x] Task 2: 在 ContentGenerator 中添加 buildTableContextForPrompt 方法
  - [x] SubTask 2.1: 参考 PlotCheckerService 的 buildTableContextForPrompt 实现，在 ContentGenerator 中添加相同的表格格式化方法
  - [x] SubTask 2.2: 在 buildPrompt 方法中调用 buildTableContextForPrompt 并整合到 userPrompt 的 context 中

- [x] Task 3: 在 IPC handler 中传递表格数据给 ContentGenerator
  - [x] SubTask 3.1: 在 writing:generateChapter handler 中读取表格数据并添加到 ContentGenerationRequest
  - [x] SubTask 3.2: 在 writing:generateContentStream handler 中读取表格数据并添加到 ContentGenerationRequest

- [x] Task 4: 构建并验证
  - [x] SubTask 4.1: 运行构建命令 - 构建成功无错误
  - [x] SubTask 4.2: 验证类型定义与代码一致性

- [x] Task 5: 测试验证
  - [x] SubTask 5.1: 用户手动测试章节生成是否包含表格数据上下文

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 1 and Task 2
- Task 4 depends on Task 3
- Task 5 depends on Task 4
