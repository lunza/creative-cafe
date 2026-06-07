# 任务列表

## 任务 1: 添加剥离 <think> 标签的辅助函数
- [x] 任务 1.1: 在 ContentGenerator.ts 中添加 `stripThinkTags(content: string): string` 辅助方法
  - [x] 使用正则表达式匹配并移除所有 `<think>` 和 `</think>` 标签及其之间的内容
  - [x] 处理多行内容，包括跨行标签
  - [x] 保留标签外的正文内容
  - [x] 清理多余的空行

## 任务 2: 在 buildPrompt 中应用标签剥离
- [x] 任务 2.1: 修改 buildPrompt 方法，在拼接 previousChapterContent 前调用 stripThinkTags
  - [x] 将 request.previousChapterContent 通过 stripThinkTags 处理后再拼接到提示词
  - [x] 确保仅在重新生成模式（regenerationSuggestion 存在）时应用此逻辑

## 任务 3: 验证
- [x] 任务 3.1: TypeScript 编译验证
- [x] 任务 3.2: IDE 诊断验证（无新增错误）

## 任务依赖关系
- 任务 2 依赖于任务 1
