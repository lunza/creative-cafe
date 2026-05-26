# Tasks
- [x] Task 1: 扩展类型定义 - 添加 correctedText 和 corrected 字段
  - [x] SubTask 1.1: 在 `writing.types.ts` 中的 `PlotCheckIssue` 接口添加 `corrected` 和 `correctedText` 字段
  - [x] SubTask 1.2: 在 `writing.types.ts` 中的 `LogicCheckIssue` 接口添加 `corrected` 和 `correctedText` 字段

- [x] Task 2: 修改 PlotCheckReportModal 组件 - 实现已修正状态显示
  - [x] SubTask 2.1: 添加已修正问题的视觉指示器（标签或图标）
  - [x] SubTask 2.2: 实现在问题已修正时显示修正后的文本内容
  - [x] SubTask 2.3: 实现隐藏快速修正和自动修正按钮的逻辑
  - [x] SubTask 2.4: 确保修正状态正确传递和显示

- [x] Task 3: 修改 usePlotCheck Hook - 更新问题修正状态
  - [x] SubTask 3.1: 在 `handleAcceptFix` 函数中更新对应问题的 `corrected` 状态
  - [x] SubTask 3.2: 在 `handleAcceptQuickFix` 函数中更新对应问题的 `corrected` 状态
  - [x] SubTask 3.3: 在修正完成后设置 `correctedText` 为修正后的文本

- [x] Task 4: 构建并验证功能
  - [x] SubTask 4.1: 运行构建命令验证无错误
  - [x] SubTask 4.2: 测试快速修正后问题状态正确更新
  - [x] SubTask 4.3: 测试自动修正后问题状态正确更新
  - [x] SubTask 4.4: 验证修正按钮在问题修正后正确隐藏

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 1
- Task 4 depends on Task 2 and Task 3