# Tasks

## Task 1: 创建统一 AI HTTP 调用工具函数
创建 `src/main/services/ai/aiHttpClient.ts`，提供 `callAIAPIWithFetch` 函数，统一两条整理路径的 AI 调用。

- [x] SubTask 1.1: 创建 `aiHttpClient.ts`，实现 `callAIAPIWithFetch` 函数
  - 使用 `fetch` API 替代 Node.js http/https
  - 支持 chat_completion 和 text_completion 两种 API 模式
  - 鉴权：Bearer token 构建（支持 `apiKeyTransmission: 'header' | 'body'`）
  - 超时控制：300s
  - 重试逻辑：指数退避 1s→2s→4s，最多 3 次，仅对 5xx 和网络错误重试
  - 响应解析：兼容 `choices[0].message.content` 和 `choices[0].text`
- [x] SubTask 1.2: 为 `aiHttpClient.ts` 编写单元测试（24 个测试全部通过）

## Task 2: 修复 AIConfigProvider.buildApiEndpoint URL 拼接逻辑
修正 `AIConfigProvider.ts` 中 `buildApiEndpoint` 方法的 URL 拼接逻辑，避免重复追加 API 路径。

- [x] SubTask 2.1: 修改 `buildApiEndpoint` 方法
  - 检查 `api_url` 是否已包含 `/v1/chat/completions` 或 `/v1/completions`
  - 已包含 → 直接使用；未包含 → 追加 `/v1/chat/completions`
  - 保留原 `apiMode` 的 `chat_completion`/`text_completion` 分支
- [ ] SubTask 2.2: 更新 `AIConfigProvider` 的单元测试（无现有测试文件，跳过）

## Task 3: 升级写作模式 TableOrganizeService.callAIAPI
将 `TableOrganizeService.ts` 中的私有 `callAIAPI` 方法从 Node.js http/https 替换为 `aiHttpClient` 共享工具。

- [x] SubTask 3.1: 替换 `callAIAPI` 实现为 `callAIAPIWithFetch`
  - 移除 `require('http')`/`require('https')`
  - 保留原有 payload 结构和参数传递方式
  - 保留原有日志记录
- [x] SubTask 3.2: 为 `TableOrganizeService` 添加引擎配置前置校验
  - 在 `organizeTable`/`organizeSingleSheet`/`reorganizeRow` 入口处校验 apiKey/apiUrl/modelName
  - 缺失配置时返回明确错误信息

## Task 4: 修复对话模式同步整理（sync mode）
修复 `organizeOrchestrator.ts` 和 `aiClient.ts` 中同步整理的问题。

- [x] SubTask 4.1: 对齐 `aiClient.ts/callAIAPI` 与 `aiHttpClient` 实现
  - 内部委托给 `aiHttpClient.callAIAPIWithFetch`
  - 保持导出签名不变
- [x] SubTask 4.2: 修复 `processChatProgressive` 断点续传边界条件
  - 当 `existingProgress.totalMessages > targetMessages.length` 时，重置为从头开始
  - 添加日志记录断点续传决策
- [x] SubTask 4.3: 统一 `getEngineAIParams` 配置读取逻辑
  - 从引擎配置中获取完整参数集（temperature/max_tokens/top_p/frequency_penalty/presence_penalty）
  - 缺失参数时使用合理默认值（temperature=0.7, max_tokens=4096, top_p=0.9, frequency_penalty=0, presence_penalty=0）

## Task 5: 修复对话模式异步整理（async mode）
修复 `PromptBuilder.ts` 和 `CharacterDialogueChat.hooks.ts` 中异步整理的问题。

- [x] SubTask 5.1: 增强 `buildAsyncTableOrganizeInstructions` 的回退提示词健壮性
  - 回退指令与当前 `tableEdit` 协议格式对齐
  - 添加动态表格结构不存在时的处理
- [x] SubTask 5.2: 增强异步整理 `tableEdit` 标签检测逻辑
  - 在 `CharacterDialogueChat.hooks.ts` 中增加更多正则变体格式（共 8 种）
  - 添加 `tableEdit` 解析失败后的降级处理（日志记录、不阻塞 UI）
  - 修复 `rawCommandsText` 为空时的处理逻辑
- [x] SubTask 5.3: 修复异步整理模式下的 `memoryTableDataRef` 刷新时机
  - 确保 `executeTableEditCommands` 成功后立即刷新表格数据
  - 添加 `let` 声明修复（`let refreshedData` 替代原 `const`）

## Task 6: 增强 IPC 事件安全性
为写作模式和对话模式的 IPC 事件发送添加安全性守卫。

- [x] SubTask 6.1: 为 `writingTableHandlers.ts` 的进度事件添加 `sender.isDestroyed()` 守卫
- [x] SubTask 6.2: 为 `memorySessionHandlers.ts` 的进度事件添加 `sender.isDestroyed()` 守卫

## Task 7: 全面测试验证
对修复和升级后的功能进行全面测试。

- [x] SubTask 7.1: 编写/更新 `aiHttpClient` 单元测试（24 个测试全部通过）
- [ ] SubTask 7.2: 编写/更新 `AIConfigProvider` 单元测试（无现有测试文件，跳过）
- [ ] SubTask 7.3: 手动测试写作模式整理（全项目/单章节/单表格/单行）
- [ ] SubTask 7.4: 手动测试对话模式同步整理
- [ ] SubTask 7.5: 手动测试对话模式异步整理

# Task Dependencies
- [Task 1] 无依赖（基础工具）✅
- [Task 2] 无依赖（独立修改）✅
- [Task 3] 依赖 [Task 1]（需要 aiHttpClient）✅
- [Task 4] 依赖 [Task 1]（需要 aiHttpClient）✅
- [Task 5] 依赖 [Task 3]（间接依赖，但主要修改在渲染进程，可并行）✅
- [Task 6] 依赖 [Task 3] 和 [Task 4]（需要确认修改后的 IPC 路径）✅
- [Task 7] 依赖 [Task 1]~[Task 6]（所有修改完成后验证）🔄