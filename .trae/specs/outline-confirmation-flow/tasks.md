# Tasks

- [x] Task 1: 在 writing.types.ts 中新增 WritingModeView.CONTENT_GENERATION 枚举值
  - [x] SubTask 1.1: 在 WritingModeView 枚举中添加 CONTENT_GENERATION = 'content_generation'

- [x] Task 2: 修复 WritingModeEntry 的视图渲染逻辑，添加 CONTENT_GENERATION 分支
  - [x] SubTask 2.1: 在 WritingModeEntry 的 switch 语句中添加 CONTENT_GENERATION case
  - [x] SubTask 2.2: 渲染 ContentWorkspace 组件，传入 outline、projectId 和 onBack 回调

- [x] Task 3: 修复大纲生成和确认的完整流程
  - [x] SubTask 3.1: 修改 WritingConfigPanel.handleGenerateOutline：生成成功后仅保存到 store 的 tempOutline，不调用 onConfirm
  - [x] SubTask 3.2: 修改 WritingModeEntry：当 tempOutline 存在时，显示 OutlineEditor 而非切换到 OUTLINE_EDITING 视图
  - [x] SubTask 3.3: 修改 OutlineEditor 的 onConfirm：创建 project（带 outline 和 outlineRaw），设置状态为 IN_PROGRESS，回调 Entry 切换到 CONTENT_GENERATION
  - [x] SubTask 3.4: 确保 OutlineEditor 有"调整参数"按钮，点击后返回配置页面

- [x] Task 4: 在 OutlineEditor 中添加"调整参数"按钮
  - [x] SubTask 4.1: 在 OutlineEditor header 区域添加"调整参数"按钮
  - [x] SubTask 4.2: 点击后回调 onBack 返回配置页面

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 3]
