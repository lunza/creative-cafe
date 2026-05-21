# Tasks

- [x] 任务 1: 更新类型定义
  - [x] 步骤 1.1: 在 WritingParameters 中添加 includeEnding、chapterRangeStart、chapterRangeEnd 字段
  - [x] 步骤 1.2: 在 WorkInfo 中添加 isComplete 字段
  - [x] 步骤 1.3: 验证类型定义无编译错误

- [x] 任务 2: 修改 PromptBuilder 支持新参数
  - [x] 步骤 2.1: 修改 buildOutlinePrompt 方法，根据 includeEnding 参数调整提示词
  - [x] 步骤 2.2: 添加章节范围参数到 Prompt 中
  - [x] 步骤 2.3: 验证 Prompt 生成逻辑

- [x] 任务 3: 修改 OutlineGenerator 支持章节范围
  - [x] 步骤 3.1: 修改 generateOutline 方法，支持章节范围过滤
  - [x] 步骤 3.2: 在未包含结局时正确设置 resolution 为"待定"
  - [x] 步骤 3.3: 在 WorkInfo 中设置 isComplete 标识
  - [x] 步骤 3.4: 验证大纲生成逻辑

- [x] 任务 4: 更新 WritingConfigPanel UI
  - [x] 步骤 4.1: 添加"是否包含结局"复选框
  - [x] 步骤 4.2: 添加章节范围选择器（起始章节、结束章节）
  - [x] 步骤 4.3: 添加章节范围选择的联动逻辑（范围不能超过总章节数）
  - [x] 步骤 4.4: 更新 handleGenerateOutline 传递新参数

- [x] 任务 5: 更新 WritingConfigModal UI
  - [x] 步骤 5.1: 在模态框配置表单中添加"是否包含结局"复选框
  - [x] 步骤 5.2: 在模态框配置表单中添加章节范围选择器
  - [x] 步骤 5.3: 更新 handleGenerateOutline 传递新参数

- [x] 任务 6: 更新 OutlineEditor 显示未完结标识
  - [x] 步骤 6.1: 根据 isComplete 状态在 UI 上显示"未完结"标识
  - [x] 步骤 6.2: 验证未完结大纲的显示效果

- [x] 任务 7: 更新 IPC 处理（如需要）
  - [x] 步骤 7.1: 检查 writingHandlers.ts 是否需要传递新参数
  - [x] 步骤 7.2: 确保 OutlineGenerationRequest 包含新字段

- [x] 任务 8: 验证构建通过
  - [x] 步骤 8.1: 运行类型检查
  - [x] 步骤 8.2: 确认无编译错误

# Task Dependencies
- [任务 2] 依赖于 [任务 1]
- [任务 3] 依赖于 [任务 1] 和 [任务 2]
- [任务 4] 依赖于 [任务 1]
- [任务 5] 依赖于 [任务 1]
- [任务 6] 依赖于 [任务 1] 和 [任务 3]
- [任务 7] 依赖于 [任务 1]
- [任务 8] 依赖于所有其他任务
