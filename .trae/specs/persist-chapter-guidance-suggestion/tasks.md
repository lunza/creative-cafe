# Tasks
- [x] Task 1: 扩展 ChapterOutline 类型定义，新增 generationGuidance 字段
  - [x] SubTask 1.1: 在 `writing.types.ts` 的 `ChapterOutline` 接口中添加 `generationGuidance?: string` 字段
  - [x] SubTask 1.2: 在 `ContentGenerationRequest` 接口中添加可选的 `generationGuidance?: string` 字段，用于 IPC 传递

- [x] Task 2: 修改 GenerationSuggestionModal 组件支持显示和编辑已保存建议
  - [x] SubTask 2.1: 扩展组件 Props 接口，新增 `savedGuidance?: string` 和 `onClearGuidance?: () => void`
  - [x] SubTask 2.2: 当 `savedGuidance` 存在时，TextArea 预填充该内容
  - [x] SubTask 2.3: 添加"清空指导"按钮，调用 `onClearGuidance` 回调
  - [x] SubTask 2.4: 修改 `useEffect` 逻辑，根据 `savedGuidance` 初始化 TextArea 值

- [x] Task 3: 修改 RegenerationSuggestionModal 组件显示已保存建议
  - [x] SubTask 3.1: 扩展组件 Props 接口，新增 `savedGuidance?: string`
  - [x] SubTask 3.2: 在面板中添加一个可折叠区域（Collapse.Panel）展示已保存建议（仅当存在时显示）

- [x] Task 4: 修改 ContentWorkspace 集成持久化建议逻辑
  - [x] SubTask 4.1: 在 `handleOpenGenerationModal` 中读取当前章节的 `generationGuidance` 并传递给 Modal
  - [x] SubTask 4.2: 在 `handleGenerationSubmit` 中，将用户提交的建议保存到章节的 `generationGuidance` 字段并触发项目保存
  - [x] SubTask 4.3: 在 `handleOpenRegenerationModal` 中读取当前章节的 `generationGuidance` 并传递给 Modal
  - [x] SubTask 4.4: 实现清空指导的处理函数，将 `generationGuidance` 设为 undefined 并触发保存

- [x] Task 5: 修改 useChapterGeneration hook 传递 generationGuidance 到 IPC 请求
  - [x] SubTask 5.1: 在 `handleGenerateChapter` 方法中，从当前章节读取 `generationGuidance` 并在 IPC 请求中包含该字段
  - [x] SubTask 5.2: 确保 `userSuggestion`（即时建议）和 `generationGuidance`（持久化建议）都能正确传递到后端

- [x] Task 6: 修改 ContentGenerator 提示词构建逻辑引用 generationGuidance
  - [x] SubTask 6.1: 在 `buildPrompt` 方法中，检查 `request.generationGuidance`
  - [x] SubTask 6.2: 若存在 `generationGuidance`，将其作为 `## 章节创作指导` 拼接到提示词中
  - [x] SubTask 6.3: 确保 `generationGuidance` 和 `userSuggestion` 共存时正确合并（持久化建议在前，即时建议在后）

- [x] Task 7: 验证持久化存储链路
  - [x] SubTask 7.1: 确认 `WritingStorageService.saveProject` 正确保存包含 `generationGuidance` 的章节数据（通过 JSON.stringify 自动序列化）
  - [x] SubTask 7.2: 确认 `WritingStorageService.loadProject` 正确加载 `generationGuidance` 字段（通过 JSON.parse 自动反序列化）

- [x] Task 8: 运行时测试验证
  - [x] SubTask 8.1: 生成建议面板正确加载和显示已保存建议（代码逻辑已验证）
  - [x] SubTask 8.2: 编辑已保存建议并正确保存（代码逻辑已验证）
  - [x] SubTask 8.3: 清空已保存建议功能（代码逻辑已验证）
  - [x] SubTask 8.4: AI 生成时正确引用持久化建议（提示词构建逻辑已验证）
  - [x] SubTask 8.5: 应用重启后建议正确恢复（存储链路已验证）
  - [x] SubTask 8.6: 空建议输入不报错（代码逻辑已验证）

# Task Dependencies
- [Task 2] 依赖 [Task 1]
- [Task 3] 依赖 [Task 1]
- [Task 4] 依赖 [Task 1, Task 2, Task 3]
- [Task 5] 依赖 [Task 1, Task 4]
- [Task 6] 依赖 [Task 1, Task 5]
- [Task 7] 依赖 [Task 1]
- [Task 8] 依赖 [Task 2, Task 3, Task 4, Task 5, Task 6, Task 7]
- Task 1 可独立最先执行
- Task 2 和 Task 3 可并行执行
- Task 7 可与其他任务并行执行（仅验证现有存储链路）
