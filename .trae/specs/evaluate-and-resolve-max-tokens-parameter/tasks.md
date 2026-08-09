# Tasks

- [x] Task 1: 修复 `characterAIUtils.ts` 遗漏路径 — 不再将 `engine.max_tokens` 作为 API `max_tokens` 发送
  - [x] SubTask 1.1: 移除 `buildCharacterAIRequest` 中 `maxTokens` 字段对 `engine.max_tokens` 的读取，改为不设置 `maxTokens`

- [x] Task 2: 修复 `AIService.ts` 配置校验 — 不再要求 `max_tokens` 必须配置
  - [x] SubTask 2.1: `getEngineConfig` 方法移除 `max_tokens` 必填校验（第 182-184 行），返回 `maxTokens: undefined`

- [x] Task 3: 清理 `useWorldBookAIOperations.ts` 技术债务
  - [x] SubTask 3.1: 移除 15 处 `void maxTokens;` 无用语句
  - [x] SubTask 3.2: 移除 1 处 `void maxTokensVal;` 无用语句
  - [x] SubTask 3.3: 日志保留 `MaxTokens=${maxTokens}` 引用（变量仍存在，用于显示用户配置值）
  - [x] SubTask 3.4: 修复截断检测逻辑（第 2095-2099 行）— 移除对 `maxTokens` 变量的引用，改为通用截断提示
  - [x] SubTask 3.5: 函数签名保持兼容（`maxTokens` 参数仍接受但不在请求体中使用，避免大面积改动）

- [x] Task 4: 清理 `useCreativeAI.ts` 技术债务
  - [x] SubTask 4.1: 移除 `const maxTokens = ...; void maxTokens;` 无用变量声明

- [x] Task 5: 修复 `settingStore.ts` 连通性测试
  - [x] SubTask 5.1: 连通性测试请求体 `max_tokens` 使用固定值 `1`，不再读取 `activeEngine.max_tokens`

- [x] Task 6: TypeScript 编译验证
  - [x] SubTask 6.1: 运行 `npx tsc --noEmit` 确认无新增类型错误

- [x] Task 7: 更新技术文档
  - [x] SubTask 7.1: 更新 `CODE_WIKI.md` 记录 max_tokens 参数治理决策和清理内容
  - [x] SubTask 7.2: 更新 `CHANGELOG.md` 新增条目

# Task Dependencies
- Task 6 依赖 Task 1-5 全部完成
- Task 7 依赖 Task 6 通过
