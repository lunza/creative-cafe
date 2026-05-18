# Checklist

- [x] 1. electron.d.ts 包含完整的 writing API 类型定义，无 any 类型滥用
- [x] 2. ContentGenerator.generateStream 方法能正确构建 prompt（有 buildPrompt 方法）
- [x] 3. OutlineEditor 编辑章节时，输入框显示的是 editedOutline 的数据而非原始 outline
- [x] 4. ContentWorkspace 中不再引用 ChapterOutline 中不存在的 content 字段
- [x] 5. WritingResourceManager 使用顶层 import 而非动态 require 加载 characterService
- [x] 6. writingProjectStore.updateProject 不会导致竞态条件（saveProject 异步处理）
- [x] 7. 所有写作模式组件支持暗色主题
- [x] 8. ContentWorkspace 对 outline 为 null 的情况有完善的空状态处理
- [x] 9. npm run build 构建无错误、无警告
- [x] 10. 所有章节生成流程（单章、连续）中 pauseRef/isPausedRef/stopRef 被正确使用
- [x] 11. WritingModeEntry 中 handleContinueProject 正确恢复项目状态
- [x] 12. WritingConfigPanel 表单校验覆盖 PRD 中规定的所有边界值
- [x] 13. OutlineGenerator 的 JSON 解析降级策略能处理多种异常格式
- [x] 14. WritingStorageService.exportAsTxt 和 exportAsMarkdown 在 chapter.content 为空时不崩溃
- [x] 15. ContentWorkspace 的流式响应事件监听器在组件卸载时正确清理
