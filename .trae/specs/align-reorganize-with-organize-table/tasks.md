# Tasks
- [x] Task 1: 修改 reorganizeRow 方法签名，增加 modelConfig 参数
  - [x] SubTask 1.1: 在 `WritingStorageService.ts` 中给 `reorganizeRow` 增加 `modelConfig: ModelConfig` 参数
  - [x] SubTask 1.2: 移除 `getActiveEngine()` 和手动构建 modelConfig 的逻辑
  - [x] SubTask 1.3: 使用 `this.buildApiEndpoint(modelConfig)` 和 `this.callAIAPI(prompt, modelConfig, apiEndpoint)` 调用 AI

- [x] Task 2: 修改 IPC handler 传递 modelConfig
  - [x] SubTask 2.1: 在 `writingHandlers.ts` 中给 `writing:table:reorganizeRow` handler 增加 modelConfig 参数
  - [x] SubTask 2.2: 将 modelConfig 传递给 `writingStorageService.reorganizeRow`

- [x] Task 3: 修改 preload.ts 接口
  - [x] SubTask 3.1: 在 `preload.ts` 中给 `reorganizeRow` 增加 modelConfig 参数

- [x] Task 4: 修改前端调用传递 modelConfig
  - [x] SubTask 4.1: 在 `WritingModeRightPanel.tsx` 中从项目或引擎配置获取 modelConfig
  - [x] SubTask 4.2: 将 modelConfig 传递给 `writing:table:reorganizeRow`

# Task Dependencies
- [Task 2] 依赖 [Task 1]
- [Task 3] 依赖 [Task 1]
- [Task 4] 依赖 [Task 2] 和 [Task 3]
