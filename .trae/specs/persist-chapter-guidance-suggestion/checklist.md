# Checklist

- [x] `ChapterOutline` 接口新增 `generationGuidance?: string` 字段
- [x] `ContentGenerationRequest` 接口新增 `generationGuidance?: string` 字段
- [x] `GenerationSuggestionModal` 组件支持 `savedGuidance` prop 并预填充 TextArea
- [x] `GenerationSuggestionModal` 组件新增"清空指导"按钮
- [x] `RegenerationSuggestionModal` 组件支持显示已保存建议（可折叠区域）
- [x] `ContentWorkspace` 在打开生成建议面板时读取并传递当前章节的 `generationGuidance`
- [x] `ContentWorkspace` 在提交建议时将建议保存到章节 `generationGuidance` 并触发项目保存
- [x] `ContentWorkspace` 支持清空章节 `generationGuidance` 并触发保存
- [x] `ContentWorkspace` 在打开重新生成建议面板时读取并传递当前章节的 `generationGuidance`
- [x] `useChapterGeneration` hook 在 IPC 请求中包含 `generationGuidance` 字段
- [x] `ContentGenerator.buildPrompt` 将 `generationGuidance` 作为 `## 章节创作指导` 拼接到提示词
- [x] 提示词构建逻辑正确处理 `generationGuidance` 和 `userSuggestion` 共存的情况
- [x] `WritingStorageService.saveProject` 正确保存包含 `generationGuidance` 的章节（通过 JSON.stringify 自动序列化）
- [x] `WritingStorageService.loadProject` 正确加载 `generationGuidance` 字段（通过 JSON.parse 自动反序列化）
- [x] 空建议输入时不触发错误，正确清除字段
- [x] 保存失败时向用户显示提示信息
