# Checklist

- [x] `reorganizeRow` 方法签名包含 `modelConfig: ModelConfig` 参数
- [x] `reorganizeRow` 内部使用 `buildApiEndpoint(modelConfig)` 和 `callAIAPI(prompt, modelConfig, apiEndpoint)`
- [x] `reorganizeRow` 移除了 `getActiveEngine()` 和手动构建 modelConfig 的逻辑
- [x] IPC handler `writing:table:reorganizeRow` 接收 modelConfig 参数
- [x] `preload.ts` 中 `reorganizeRow` 接口包含 modelConfig 参数
- [x] 前端调用 `reorganizeRow` 时传递 modelConfig
- [x] 重新整理功能与 organizeTable 使用相同的 AI 调用链路
