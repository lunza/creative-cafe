# Tasks
- [x] Task 1: 修改 AI 检查提示词
  - [x] Step 1.1: 在 buildCheckPrompt 的 JSON 格式示例中为 issue 增加 title 字段
  - [x] Step 1.2: 在提示词中强化 quickFixSuggestion.originalText 的说明，强调包含标点符号
  - [x] Step 1.3: 为逻辑问题 (logic_issues) 的格式也增加 title 字段说明
- [x] Task 2: 添加 issue title 的 fallback 逻辑
  - [x] Step 2.1: 在 parseCheckResponse 中，当 issue 没有 title 时从 description 截取前20个字符生成默认标题
- [x] Task 3: 编译验证

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1, Task 2]
