# Checklist

- [x] `useWorldBookAIOperations.ts` 中所有 11 处 `extra_body` / `chat_template_kwargs` / `enable_thinking` 已移除或改为条件注入
- [x] `useWorldBookAIOperations.ts` 中所有 5 处 `stop: null` 已移除
- [x] `useWorldBookAIOperations.ts` 中硬编码的 `n: 1` 已改为条件注入（仅 `n > 1` 时发送）
- [x] `useWorldBookAIOperations.ts` 中 `api_key_transmission` 默认值已改为 `'header'`
- [x] `AIService.ts` 中 `callChatAPI`（第 416 行）的 `enable_thinking` 改为双条件守卫注入
- [x] `AIService.ts` 中 `streamChatAPI`（第 506 行）的 `enable_thinking` 改为双条件守卫注入
- [x] `aiClient.ts` 中 `extra_body: { enable_thinking: false }` 已移除
- [x] `useCreativeAI.ts` 中 `api_key_transmission` 默认值已改为 `'header'`
- [x] `settingStore.ts` 中连通性测试的 `api_key_transmission` 默认值已改为 `'header'`
- [x] `Settings.tsx` 中表单初始化和 handleSave 的 `api_key_transmission` 默认值已改为 `'header'`
- [x] `useAIEngineSettings.ts` 中 `api_key_transmission` 默认值已改为 `'header'`
- [x] `npx tsc --noEmit` 无新增类型错误
- [x] 请求体中不再包含标准 OpenAI API 不识别的字段（`extra_body`、`chat_template_kwargs`、`enable_thinking`、`stop: null`）
- [x] 所有 AI 调用路径的 `api_key_transmission` 默认值统一为 `'header'`
- [x] 技术文档 `CODE_WIKI.md` 已更新
- [x] 技术文档 `CHANGELOG.md` 已更新
