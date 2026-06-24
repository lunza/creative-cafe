# Tasks
- [x] Task 1: 在 messageProcessor.ts 中实现 stripThinkingTags 函数
  - [x] SubTask 1.1: 实现 stripThinkingTags 函数，支持匹配 `<think>`, `<thinking>`, `<Thought>` 等变体（不区分大小写）
  - [x] SubTask 1.2: 处理未闭合标签场景（流式输出中间状态，从 `<think` 到文本末尾全部移除）
  - [x] SubTask 1.3: 处理自闭合标签 `<think />` 等边缘情况
  - [x] SubTask 1.4: 将 stripThinkingTags 集成到 processMessage 和 preprocessForMarkdown 函数中（在模板替换之后、引号规范化之前调用）

- [x] Task 2: 为 stripThinkingTags 添加单元测试
  - [x] SubTask 2.1: 在 messageProcessor.test.ts 中添加 stripThinkingTags 的独立测试用例（标准标签、变体标签、大小写、多个标签、未闭合、嵌套内容、空内容等边界情况）
  - [x] SubTask 2.2: 在 messageProcessor.test.ts 中添加 processMessage 集成测试，验证过滤在管道中正确执行
  - [x] SubTask 2.3: 在 MessageRenderer.test.tsx 中添加渲染层测试，验证包含思考标签的消息在 UI 中正确隐藏

- [x] Task 3: 运行测试验证所有功能正常
  - [x] SubTask 3.1: 运行 vitest 确保新增测试全部通过
  - [x] SubTask 3.2: 确认现有测试不受影响

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
