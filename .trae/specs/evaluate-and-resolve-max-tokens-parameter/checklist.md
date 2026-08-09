# Checklist

- [x] `characterAIUtils.ts` 不再将 `engine.max_tokens` 作为 API `max_tokens` 发送
- [x] `AIService.ts` `getEngineConfig` 不再要求 `max_tokens` 必须配置
- [x] `useWorldBookAIOperations.ts` 中所有 `void maxTokens;` 和 `void maxTokensVal;` 已移除
- [x] `useWorldBookAIOperations.ts` 日志中不再引用已删除的 `maxTokens` 变量
- [x] `useWorldBookAIOperations.ts` 截断检测不再引用 `maxTokens` 变量
- [x] `useCreativeAI.ts` 中 `void maxTokens;` 已移除
- [x] `settingStore.ts` 连通性测试使用固定 `max_tokens: 1`
- [x] `npx tsc --noEmit` 无新增类型错误
- [x] 全局 Grep 验证：`void maxTokens` 零匹配
- [x] 全局 Grep 验证：`characterAIUtils.ts` 中不包含 `maxTokens: engine.max_tokens`
- [x] 技术文档 `CODE_WIKI.md` 已更新
- [x] 技术文档 `CHANGELOG.md` 已更新
