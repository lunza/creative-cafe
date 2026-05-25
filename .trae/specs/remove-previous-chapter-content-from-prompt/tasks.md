# Tasks
- [x] Task 1: 从 PromptBuilder 中移除前序章节内容拼接
  - [x] SubTask 1.1: 修改 buildContentPrompt 方法，移除 context.recentChapters 的拼接逻辑
  - [x] SubTask 1.2: 移除 context 接口中的 recentChapters 字段

- [x] Task 2: 从 ContentGenerator 中移除 buildRecentChapters 方法
  - [x] SubTask 2.1: 删除 buildRecentChapters 方法
  - [x] SubTask 2.2: 从 buildPrompt 方法中移除 recentChapters 相关调用

- [x] Task 3: 更新 useChapterGeneration 停止传递 previousChapters
  - [x] SubTask 3.1: 从 handleGenerateChapter 中移除构建 previousChapters 的逻辑
  - [x] SubTask 3.2: 将 request.previousChapters 设为空数组

- [x] Task 4: 更新测试用例
  - [x] SubTask 4.1: 更新 test/PromptBuilder.tableContext.test.ts 中引用 recentChapters/前序章节内容的断言
  - [x] SubTask 4.2: 运行测试验证通过

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 is independent
- Task 4 depends on Task 1 and Task 2
