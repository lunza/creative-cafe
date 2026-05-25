# Tasks
- [x] Task 1: 修改PlotCheckerService - 提示词要求AI返回修正建议
  - [x] SubTask 1.1: 修改 `analyzeChapter` 的系统提示词，要求AI在每个问题中返回 `quickFixSuggestion`
  - [x] SubTask 1.2: 修改 `parseCheckResponse` 方法，解析 `quickFixSuggestion` 字段
  - [x] SubTask 1.3: 验证原文本在章节中的存在性并设置 `position` 字段
  - [x] SubTask 1.4: 添加 `validateQuickFixSuggestion` 方法验证修正建议

- [x] Task 2: 移除不再需要的IPC通道和服务方法
  - [x] SubTask 2.1: 从 `PlotCheckerService` 中移除 `quickFixIssue` 方法
  - [x] SubTask 2.2: 从 `writingHandlers.ts` 中移除 `writing:quickFixIssue` handler
  - [x] SubTask 2.3: 从 `preload.ts` 中移除 `quickFixIssue` API

- [x] Task 3: 修改快速修正按钮行为 - 直接使用缓存建议
  - [x] SubTask 3.1: 修改 `PlotCheckReportModal` 中 `handleQuickFix` 函数：直接使用 `issue.quickFixSuggestion`
  - [x] SubTask 3.2: 修改 `usePlotCheck` hook：快速修正逻辑简化为同步操作
  - [x] SubTask 3.3: 修改 `ContentWorkspace` 中 `handleQuickFix`：直接传递缓存建议给弹窗

- [x] Task 4: 构建并验证
  - [x] SubTask 4.1: 运行构建命令 - 构建成功无错误
  - [ ] SubTask 4.2: 验证剧情检查返回的报告中每个问题包含 `quickFixSuggestion`
  - [ ] SubTask 4.3: 验证快速修正按钮点击时直接使用缓存建议展示弹窗
  - [ ] SubTask 4.4: 验证接受修正后执行字符串替换并重新评分

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 1 and Task 2
- Task 4 depends on Task 3
