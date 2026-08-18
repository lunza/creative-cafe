# 表格整理功能修复与升级 Spec

## Why

表格整理功能在写作模式和对话模式之间经历了多次迭代，但两套独立的 AI 调用路径（`TableOrganizeService.callAIAPI` vs `aiClient.ts/callAIAPI`）存在版本兼容性差异，导致对话模式下的同步/异步整理功能因 AI 引擎接口变更而不可用。核心问题包括：`TableOrganizeService` 使用 Node.js http/https 原生模块进行 AI 调用缺乏现代 API 兼容性；对话模式同步整理使用 `aiClient.ts` 但未与统一 AI 配置对齐；异步整理正则匹配 `<tableEdit>` 标签的检测逻辑脆弱；两条路径的提示词构建、错误处理、模型参数传递标准不一致。

## What Changes

### 对话模式修复
- 修复同步整理（sync mode）主进程调用路径，对齐 `aiClient.ts` 配置读取与 `AIConfigProvider` 统一配置
- 修复异步整理（async mode）`tableEdit` 标签检测的健壮性，支持更多 AI 变体输出格式
- 修复异步整理模式下 `AI 响应中 tableEdit 标签解析失败` 问题，增强解析容错
- 统一对话模式同步/异步整理的引擎配置加载方式，从 `setting.aiEngines` 读取完整参数
- 修复 `processChatProgressive` 断点续传逻辑在消息数量变化时的边界条件

### 版本兼容性升级
- 将 `TableOrganizeService.callAIAPI` 从 Node.js http/https 原生模块替换为 `fetch` API，对齐现代 AI 引擎接口规范
- 修复 `AIConfigProvider.buildApiEndpoint` 的 URL 拼接逻辑，避免重复追加 `/v1/chat/completions` 路径
- 为 `TableOrganizeService` 和 `aiClient.ts` 添加模型能力感知（thinking、tools 等）的兼容性层
- 统一 `ModelConfig` 参数传递，确保 `temperature`/`maxTokens` 等参数在两条路径中语义一致

### 代码结构优化
- 抽取 `TableOrganizeService.callAIAPI` 和 `aiClient.ts/callAIAPI` 中重复的请求构建、鉴权、响应解析逻辑为共享工具函数
- 为 `TableOrganizeService` 添加 `callAIAPI` 重试机制（指数退避，最多 3 次）
- 为 `aiClient.ts` 添加请求超时和响应校验增强
- 优化 `buildAsyncTableOrganizeInstructions` 的硬编码回退提示词，使其与当前模板系统对齐

### 错误处理增强
- 为整理全流程添加 `try-catch` 边界，确保单个章节/sheet 失败不影响整体流程
- 添加引擎配置校验前置检查，在整理开始前验证必要参数
- 为 IPC 进度事件添加 `sender.isDestroyed()` 守卫，防止窗口关闭后的事件异常
- 为异步整理添加 `tableEdit` 解析失败后的降级处理（不阻塞 UI 更新）

## Impact

- Affected specs: `redesign-dialogue-pipeline-architecture`（AsyncTableOrganizeProvider）、`optimize-chat-ai-intelligence`（同步整理编排）
- Affected code:
  - `src/main/services/writing/TableOrganizeService.ts`（核心逻辑、AI 调用、prompt 构建）
  - `src/main/services/ai/AIConfigProvider.ts`（API 端点构建）
  - `src/main/services/memory/aiClient.ts`（对话模式 AI 调用）
  - `src/main/services/memory/organizeOrchestrator.ts`（同步整理编排）
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（异步整理指令构建）
  - `src/renderer/components/Character/CharacterDialogueChat/pipeline/providers/AsyncTableOrganizeProvider.ts`
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（异步整理标签检测与同步整理触发）
  - `src/renderer/components/Character/CharacterDialogueChat/useTableOrganize.ts`（写作模式整理 hook）
  - `src/main/ipc/handlers/writing/writingTableHandlers.ts`（IPC 事件处理）
  - `src/main/ipc/handlers/memory/memorySessionHandlers.ts`（对话整理 IPC 处理）

## ADDED Requirements

### Requirement: 统一 AI 调用工具函数
The system SHALL extract a shared AI HTTP call utility (`src/main/services/ai/aiHttpClient.ts`) that provides:
- `callAIAPIWithFetch(prompt, config, options)` - 统一 fetch-based AI 调用
- 鉴权（Bearer token 构建）
- 超时控制（300s）
- 重试逻辑（指数退避，最多 3 次）
- 响应解析（chat_completion / text_completion 兼容）

#### Scenario: 统一调用覆盖两条路径
- **WHEN** `TableOrganizeService` 调用 AI API
- **THEN** 使用 `aiHttpClient.callAIAPIWithFetch` 替代原生 http/https 模块
- **AND** 行为与 `aiClient.ts` 保持一致，响应格式解析兼容

#### Scenario: 重试机制生效
- **WHEN** AI API 返回 5xx 错误或网络超时
- **THEN** 自动重试，间隔 1s → 2s → 4s 指数退避
- **AND** 重试 3 次后仍失败则抛出明确错误

### Requirement: 对话模式整理引擎配置对齐
The system SHALL ensure dialogue mode sync/async organize uses the same engine config loading as writing mode, reading `setting.aiEngines` with full parameter set.

#### Scenario: 同步整理使用完整引擎配置
- **WHEN** 触发同步整理
- **THEN** `processChatProgressive` 从引擎配置中获取 `temperature`/`max_tokens`/`top_p`/`frequency_penalty`/`presence_penalty`
- **AND** 使用 `AIConfigProvider` 统一获取 API 端点信息

#### Scenario: 异步整理指令构建健壮
- **WHEN** `creative-chat.async-table-instructions` 模板获取失败
- **THEN** 使用硬编码回退指令，且回退指令与当前表格结构对齐
- **AND** 异步整理 `tableEdit` 检测支持 5 种以上 AI 变体格式

### Requirement: 增强错误处理
The system SHALL add comprehensive error handling for the entire organize workflow.

#### Scenario: 引擎配置缺失前置检查
- **WHEN** 开始整理前缺少必要引擎配置（apiKey / apiUrl / modelName）
- **THEN** 返回明确错误信息，不发起 AI 调用

#### Scenario: 单章节失败不影响整体
- **WHEN** 全项目整理中某个章节 AI 调用失败
- **THEN** 记录错误到 `errors[]`，继续处理后续章节
- **AND** 最终返回 `errorCount > 0` 但 `success = true`（部分成功）

#### Scenario: 窗口关闭后进度事件安全
- **WHEN** IPC 发送进度事件时 `sender.isDestroyed()` 为 true
- **THEN** 跳过事件发送，不抛出异常

## MODIFIED Requirements

### Requirement: 写作模式表格整理 AI 调用升级
**变更**：`TableOrganizeService.callAIAPI` 从 Node.js http/https 替换为 `fetch` 调用
- 移除 `require('http')`/`require('https')` 依赖
- 使用 `aiHttpClient` 共享工具函数
- 保留原有 payload 结构（`model`/`temperature`/`max_tokens`/`messages`）
- 保留原有 `apiKeyTransmission` 支持（header/body）

### Requirement: API 端点构建修正
**变更**：`AIConfigProvider.buildApiEndpoint` 的 URL 拼接逻辑
- 如果 `api_url` 已经包含 `/v1/chat/completions` 或 `/v1/completions`，不再重复追加
- 如果 `api_url` 仅包含基础 URL（如 `https://api.openai.com`），自动追加 `/v1/chat/completions`
- 保留 `apiMode` 的 `chat_completion`/`text_completion` 分支

## REMOVED Requirements

### Requirement: 旧的 http/https 原生 AI 调用
**Reason**: 已由 `aiHttpClient` 统一替代，消除重复实现和兼容性问题。
**Migration**: 所有调用方迁移到 `callAIAPIWithFetch`，原有 `TableOrganizeService.callAIAPI` 私有方法移除，`aiClient.ts/callAIAPI` 保持导出但内部委托给 `aiHttpClient`。