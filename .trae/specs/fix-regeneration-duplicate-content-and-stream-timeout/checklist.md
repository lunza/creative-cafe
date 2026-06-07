# 检查清单

- [x] stripThinkTags 辅助函数正确实现（正则匹配并移除 <think> 标签及内容）
- [x] buildPrompt 中 previousChapterContent 在拼接前经过 stripThinkTags 处理
- [x] 仅重新生成模式（regenerationSuggestion 存在）时应用此逻辑
- [x] TypeScript 编译无错误
- [x] IDE 诊断无新增错误
- [ ] 重新生成章节时不会出现重复的 <think> 标签内容（需运行时测试）
