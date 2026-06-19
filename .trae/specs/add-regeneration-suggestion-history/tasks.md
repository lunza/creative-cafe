# Tasks
- [ ] Task 1: 扩展类型定义，新增建议历史和综合建议相关字段
  - [ ] SubTask 1.1: 在 `writing.types.ts` 中新增 `SuggestionRecord` 接口，包含 `timestamp`、`chapterIndex`、`chapterTitle`、`suggestion: RegenerationSuggestion` 字段
  - [ ] SubTask 1.2: 在 `ChapterOutline` 接口中新增 `suggestionHistory?: SuggestionRecord[]` 字段
  - [ ] SubTask 1.3: 在项目级别类型（如 `WritingProject` 或 `WorkInfo`）中新增 `consolidatedSuggestions?: string` 字段
  - [ ] SubTask 1.4: 在 `ContentGenerationRequest` 接口中新增 `consolidatedSuggestions?: string` 字段，用于 IPC 传递

- [ ] Task 2: 实现建议整合的 AI 调用接口
  - [ ] SubTask 2.1: 在 main 进程中新增 `consolidate-suggestions` IPC handler，接收所有 `suggestionHistory` 记录，调用 AI 生成综合建议
  - [ ] SubTask 2.2: 在 `preload.ts` 中暴露 `consolidateSuggestions` 接口供渲染进程调用
  - [ ] SubTask 2.3: 实现建议整合的提示词构建逻辑，将历史建议结构化后请求 AI 合并优化

- [ ] Task 3: 修改 RegenerationSuggestionModal 组件
  - [ ] SubTask 3.1: 新增 `suggestionHistoryCount?: number` prop，显示当前章节建议历史条数
  - [ ] SubTask 3.2: 新增 `consolidatedSuggestions?: string` prop，在可折叠区域展示综合建议
  - [ ] SubTask 3.3: 新增"建议整理"按钮，点击时触发 `onConsolidateSuggestions` 回调
  - [ ] SubTask 3.4: 按钮添加 loading 状态，整合期间禁用重复点击
  - [ ] SubTask 3.5: 无历史建议时禁用"建议整理"按钮并显示提示

- [ ] Task 4: 修改 ContentWorkspace 集成建议历史逻辑
  - [ ] SubTask 4.1: 在 `handleRegenerationSubmit` 中，将本次提交的结构化建议追加到当前章节的 `suggestionHistory` 并触发项目保存
  - [ ] SubTask 4.2: 实现 `handleConsolidateSuggestions` 处理函数，收集所有章节的 `suggestionHistory`，调用 AI 整合接口，将结果保存到项目级别并触发保存
  - [ ] SubTask 4.3: 将 `consolidatedSuggestions` 和建议历史条数传递给 `RegenerationSuggestionModal`
  - [ ] SubTask 4.4: 将 `consolidatedSuggestions` 传递到 `useChapterGeneration` hook，用于 IPC 请求

- [ ] Task 5: 修改 useChapterGeneration hook
  - [ ] SubTask 5.1: 在 `handleGenerateChapter` 方法中，从项目数据读取 `consolidatedSuggestions` 并在 IPC 请求中包含该字段
  - [ ] SubTask 5.2: 确保 `consolidatedSuggestions` 能正确传递到主进程

- [ ] Task 6: 修改 ContentGenerator 提示词构建逻辑
  - [ ] SubTask 6.1: 在 `buildPrompt` 方法中，检查 `request.consolidatedSuggestions`
  - [ ] SubTask 6.2: 若存在，将其作为 `## 综合创作要求` 拼接到提示词中，位于基础提示词之后、章节特定指导之前
  - [ ] SubTask 6.3: 确保 `consolidatedSuggestions`、`generationGuidance`、`userSuggestion`、`regenerationSuggestion` 共存时正确合并

- [ ] Task 7: 验证存储链路
  - [ ] SubTask 7.1: 确认 `WritingStorageService.saveProject` 正确保存包含 `suggestionHistory` 的章节数据和 `consolidatedSuggestions` 项目数据
  - [ ] SubTask 7.2: 确认 `WritingStorageService.loadProject` 正确加载新字段

- [ ] Task 8: 运行时测试验证
  - [ ] SubTask 8.1: 重新生成提交后建议正确追加到 `suggestionHistory`
  - [ ] SubTask 8.2: "建议整理"按钮正确触发 AI 整合并显示结果
  - [ ] SubTask 8.3: 综合建议正确注入到后续章节生成的提示词中
  - [ ] SubTask 8.4: 应用重启后建议历史和综合建议正确恢复
  - [ ] SubTask 8.5: 无历史建议时"建议整理"按钮正确禁用

# Task Dependencies
- [Task 1] 可独立最先执行
- [Task 2] 依赖 [Task 1]
- [Task 3] 依赖 [Task 1]
- [Task 4] 依赖 [Task 1, Task 2, Task 3]
- [Task 5] 依赖 [Task 1, Task 4]
- [Task 6] 依赖 [Task 1, Task 5]
- [Task 7] 依赖 [Task 1]
- [Task 8] 依赖 [Task 2, Task 3, Task 4, Task 5, Task 6, Task 7]
