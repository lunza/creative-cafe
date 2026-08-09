# 修复远程引擎 400 Bad Request 错误 Spec

## Why

用户选择远程引擎（如 DeepSeek 官方 API）时，ai-handler 模块返回 400 Bad Request 错误，导致所有远程引擎功能不可用。根因是多个 AI 调用路径在请求体中无条件注入了 vLLM/Qwen3 专有参数（`extra_body`、`chat_template_kwargs`、`enable_thinking`）和 `stop: null`，而 DeepSeek 等标准 OpenAI 兼容 API 不识别这些字段，直接返回 400。此外，渲染进程与主进程的 `api_key_transmission` 默认值不一致（渲染进程默认 `'body'`，主进程默认 `'header'`），可能导致 DeepSeek 收不到认证信息。

## What Changes

- **移除/条件化非标准参数**：`useWorldBookAIOperations.ts`（11 处）、`AIService.ts`（2 处）、`aiClient.ts`（1 处）中无条件注入的 `extra_body` / `chat_template_kwargs` / `enable_thinking` 参数，改为基于引擎能力感知的条件注入（与 `ChatEngine.ts` 已有的双条件守卫模式对齐）
- **移除 `stop: null`**：`useWorldBookAIOperations.ts` 中 5 处 `stop: null` 改为不设置 `stop` 字段（`undefined`）
- **统一 `api_key_transmission` 默认值为 `'header'`**：将渲染进程所有路径的默认值从 `'body'` 改为 `'header'`，与主进程保持一致，确保标准 OpenAI 兼容 API 能正确收到 Bearer 认证
- **移除不必要的 `n: 1`**：`useWorldBookAIOperations.ts` 中硬编码的 `n: 1` 参数，改为仅在引擎配置了 `n` 且 `n > 1` 时才注入

## Impact

- Affected specs: `upgrade-ai-handler-multimodal-compatibility`（已建立的能力感知模式，本 Spec 将其推广到所有调用路径）
- Affected code:
  - 修改：`src/renderer/components/WorldBook/hooks/useWorldBookAIOperations.ts` — 11 处请求体移除非标准参数 + 5 处 `stop: null` + `n: 1` + `api_key_transmission` 默认值
  - 修改：`src/main/services/AIService.ts` — 2 处 `enable_thinking` 改为条件注入 + `buildRequest` 中认证默认值
  - 修改：`src/main/services/memory/aiClient.ts` — 1 处 `extra_body` 移除
  - 修改：`src/renderer/components/Creative/hooks/useCreativeAI.ts` — `api_key_transmission` 默认值
  - 修改：`src/renderer/stores/settingStore.ts` — 连通性测试中 `api_key_transmission` 默认值

## ADDED Requirements

### Requirement: 能力感知的非标准参数注入

系统在向远程 AI API 发送请求时，对于非标准 OpenAI API 参数（`extra_body`、`chat_template_kwargs`、`enable_thinking`），必须基于引擎能力探测结果（`capabilities.supportsThinking`）和用户配置（`enable_chain_of_thought`）进行双条件守卫注入，而非无条件注入。当引擎不支持思维链或用户未启用时，不得在请求体中包含这些字段。

#### Scenario: DeepSeek 等标准 OpenAI 兼容 API
- **WHEN** 用户选择 DeepSeek 引擎（`supportsThinking=false`）
- **AND** 调用世界书 AI 操作（翻译/审核/生成等）
- **THEN** 请求体中不包含 `extra_body`、`chat_template_kwargs`、`enable_thinking` 字段
- **AND** API 返回 200 成功

#### Scenario: Qwen3 等 vLLM 后端
- **WHEN** 用户选择 Qwen3 引擎（`supportsThinking=true`）
- **AND** 用户启用了 `enable_chain_of_thought`
- **THEN** 请求体中包含 `enable_thinking: true`（或通过 `extra_body` 包裹，取决于后端约定）
- **AND** API 正常处理思维链请求

### Requirement: 统一的 API Key 传输默认值

系统所有 AI 请求路径（渲染进程和主进程）的 `api_key_transmission` 默认值必须统一为 `'header'`，确保标准 OpenAI 兼容 API（如 DeepSeek）能通过 `Authorization: Bearer <key>` header 正确接收认证信息。

#### Scenario: 用户未设置 api_key_transmission
- **WHEN** 引擎配置中 `api_key_transmission` 字段为空或未设置
- **AND** 用户调用任意 AI 功能（聊天/世界书/创意/连通性测试）
- **THEN** API key 通过 `Authorization: Bearer <key>` header 传输
- **AND** 远程 API 正确识别认证信息

## MODIFIED Requirements

### Requirement: AI 请求体构建

所有 AI 调用路径构建请求体时：
1. 不得包含 `stop: null`（不需要 stop 序列时省略该字段）
2. 不得无条件包含 `n: 1`（仅在用户配置 `n > 1` 时注入）
3. 非标准参数必须通过能力感知守卫注入
4. `api_key_transmission` 默认值为 `'header'`

## REMOVED Requirements

### Requirement: 无条件注入 enable_thinking
**Reason**: `enable_thinking` 是 Qwen3 系列专有参数，标准 OpenAI 兼容 API 不识别，无条件注入导致 400 错误
**Migration**: 改为基于 `capabilities.supportsThinking` + `enable_chain_of_thought` 双条件守卫注入

### Requirement: 无条件注入 extra_body / chat_template_kwargs
**Reason**: 这些是 vLLM 后端专有参数传递机制，标准 API 不识别
**Migration**: 移除，思维链控制通过顶层 `enable_thinking` 字段（在能力感知守卫通过时注入）

### Requirement: stop: null
**Reason**: 显式发送 `null` 值可能被部分 API 视为无效参数
**Migration**: 不需要 stop 序列时省略该字段
