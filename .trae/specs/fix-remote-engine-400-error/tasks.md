# Tasks

- [x] Task 1: 修复 `useWorldBookAIOperations.ts` 中的非标准参数注入
  - [x] SubTask 1.1: 移除 11 处 `extra_body` / `chat_template_kwargs` / `enable_thinking` 无条件注入，改为基于引擎能力感知的条件注入
  - [x] SubTask 1.2: 移除 5 处 `stop: null`（改为不设置 stop 字段）
  - [x] SubTask 1.3: 移除硬编码的 `n: 1`（改为仅在 `n > 1` 时注入）
  - [x] SubTask 1.4: 将 `api_key_transmission` 默认值从 `'body'` 改为 `'header'`（第 3057 行等）

- [x] Task 2: 修复 `AIService.ts` 中的 `enable_thinking` 无条件注入
  - [x] SubTask 2.1: `callChatAPI`（第 416 行）— `requestBody.enable_thinking = config.enableChainOfThought === true` 改为双条件守卫（`enableChainOfThought === true && supportsThinking === true`）
  - [x] SubTask 2.2: `streamChatAPI`（第 506 行）— 同上修改

- [x] Task 3: 修复 `aiClient.ts`（记忆整理服务）中的 `extra_body` 注入
  - [x] SubTask 3.1: 移除第 139-141 行 `extra_body: { enable_thinking: false }` 无条件注入

- [x] Task 4: 统一渲染进程 `api_key_transmission` 默认值为 `'header'`
  - [x] SubTask 4.1: `useCreativeAI.ts` 第 64 行 — `|| 'body'` 改为 `|| 'header'`
  - [x] SubTask 4.2: `settingStore.ts` 连通性测试中 — `|| 'body'` 改为 `|| 'header'`
  - [x] SubTask 4.3: `Settings.tsx` 第 57、100 行 — `|| 'body'` 改为 `|| 'header'`（表单初始化 + handleSave）
  - [x] SubTask 4.4: `useAIEngineSettings.ts` 第 189 行 — `|| 'body'` 改为 `|| 'header'`

- [x] Task 5: TypeScript 编译验证
  - [x] SubTask 5.1: 运行 `npx tsc --noEmit` 确认无新增类型错误

- [x] Task 6: 更新技术文档
  - [x] SubTask 6.1: 更新 `CODE_WIKI.md` 新增章节记录此 Bug 修复
  - [x] SubTask 6.2: 更新 `CHANGELOG.md` 新增条目

# Task Dependencies
- Task 5 依赖 Task 1-4 全部完成
- Task 6 依赖 Task 5 通过
