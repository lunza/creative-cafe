# Tasks
- [x] Task 1: 在 writing.types.ts 中为 ChapterOutline 添加 importantSpans 字段
  - [x] SubTask 1.1: 在 ChapterOutline 接口中添加 `importantSpans?: string[]` 字段

- [x] Task 2: 在 PromptBuilder 中添加 importantSpans 的提示词指导
  - [x] SubTask 2.1: 修改 buildOutlinePrompt 的 JSON 结构示例，为每个章节添加 importantSpans 字段
  - [x] SubTask 2.2: 在大纲生成要求中添加 importantSpans 使用说明（何时标记、标记什么内容）

- [x] Task 3: 在创作配置 UI 中添加额外要求提示文字
  - [x] SubTask 3.1: 修改 WritingConfigPanel.tsx，在"额外要求"输入框下方添加提示文字
  - [x] SubTask 3.2: 修改 WritingConfigModal.tsx，在"额外要求"输入框下方添加相同的提示文字

- [x] Task 4: 在前端大纲渲染中处理 importantSpans 加粗显示
  - [x] SubTask 4.1: 修改 OutlineEditor.tsx，渲染章节概要和关键情节点时高亮 importantSpans 内容
  - [x] SubTask 4.2: 确保向后兼容（旧数据无 importantSpans 不影响显示）

- [x] Task 5: 验证构建
  - [x] SubTask 5.1: 运行 TypeScript 编译验证无错误

# Task Dependencies
- Task 2 和 Task 3 可并行
- Task 4 依赖 Task 1（需要类型定义）
- Task 5 依赖所有上述任务
