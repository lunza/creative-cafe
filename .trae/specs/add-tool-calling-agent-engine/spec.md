# 工具调用智能体引擎（方向 0）实现 Spec

## Why

分析型 Spec `analyze-multimodal-model-feature-upgrades` 已确认：项目 `supportsToolCalling` 能力已检测但全项目未使用，三模式（对话/写作/世界书）所有 AI 操作均为用户触发、一次性、fire-and-forget。本 Spec 实现方向 0——**工具调用智能体引擎**，作为三模式智能体化的共享底座。

引擎建立在现有 `AIService` 基础上：复用 `callChatAPI`（非流式，用于工具调用轮次获取完整 tool_calls）、`streamChatAPI`（流式，用于最终回复）、`buildRequest`（请求构建）。不破坏现有调用路径，纯增量扩展。

## What Changes

- **新增** `src/main/services/ai/agent/` 目录，含 4 个核心文件：
  - `agentTypes.ts` — 智能体核心类型（AgentTool / ToolCallRequest / ToolCallResult / AgentLoopResult / AgentToolGroup）
  - `toolRegistry.ts` — 工具注册中心（按模式分组注册/查询）
  - `toolProtocolAdapter.ts` — 厂商协议适配（统一 tool_calls 解析 + tools 请求体构建）
  - `agentLoop.ts` — 核心循环（发送→执行 tool_calls→回填→重发→直到最终文本）
- **新增** `src/main/services/ai/agent/tools/` 目录，含验证用真实工具集：
  - `dialogueTools.ts` — `searchWorldbook`（复用 worldBookService）、`searchChatHistory`（复用 ChatVectorizationService）
  - `worldbookTools.ts` — `searchEntries`（复用 ChatVectorizationService）
  - `writingTools.ts` — `readOutline`（占位，方向 B 完善）
- **修改** `src/main/services/AIService.ts`：
  - 扩展 `ChatMessage`：role 新增 `'tool'`，新增可选 `tool_calls`/`tool_call_id`/`name` 字段
  - 扩展 `buildRequest`：接受可选 `tools`/`tool_choice` 参数注入请求体
  - 新增 `callChatWithTools(messages, tools, options)`：返回完整响应（含 `tool_calls`），供 agentLoop 使用
- **新增** Agent 模式全局开关（增量开发，零影响现有功能）：
  - `AppSetting` 新增 `enableAgentMode: boolean`（默认 `false`）
  - `defaultSetting` 新增 `enableAgentMode: false`
  - Settings UI 新增 Switch 开关（antd Switch），默认关闭
  - Agent 模式启用需同时满足：开关为 true **且** 当前引擎 `capabilities.supportsToolCalling === true`；否则降级为现有纯文本生成模式
- **新增** IPC + preload：`ai:agentToolCall` 事件通道（工具调用过程可观测性）+ `ai:runAgentTurn` 调用入口（供验证与未来前端调用）
- **修改** `src/renderer/types/electron.d.ts` + `src/main/preload.ts`：暴露类型与 API
- **更新** 技术文档（CHANGELOG.md / CODE_WIKI.md / PROJECT_DOCUMENTATION_NEW.md）

## Impact

- Affected specs: `analyze-multimodal-model-feature-upgrades`（方向 0 落地）、`add-model-capability-detection-and-image-recognition`（复用 supportsToolCalling 判定降级）
- Affected code:
  - 修改：`src/main/services/AIService.ts`（ChatMessage 扩展 + buildRequest 扩展 + 新增 callChatWithTools）
  - 修改：`src/main/preload.ts`（暴露 runAgentTurn + onAgentToolCall）
  - 修改：`src/renderer/types/electron.d.ts`（类型声明）
  - 新增：`src/main/services/ai/agent/` 全目录
  - 新增：`src/main/ipc/handlers/agentHandlers.ts`（IPC 通道注册）

## 技术方案

### 核心架构

```
调用方（未来：ChatEngine / WritingAgentService / WorldBookAgent）
    ↓ runAgentLoop({messages, toolGroups, callbacks})
agentLoop.ts
    ├─ 1. toolRegistry.getTools(toolGroups) → tools[]
    ├─ 2. toolProtocolAdapter.buildToolsParam(tools) → 请求体 tools 字段
    ├─ 3. aiService.callChatWithTools(messages, tools, opts) → 响应（含 tool_calls?）
    ├─ 4. 若有 tool_calls：
    │      ├─ toolProtocolAdapter.parseToolCalls(response) → 统一 ToolCallRequest[]
    │      ├─ 并行执行 toolRegistry.getTool(name).handler(args) → ToolCallResult[]
    │      │    （每 handler try-catch，失败返回 {error}，不崩循环）
    │      ├─ 追加 assistant{tool_calls} + 多条 role:'tool'{tool_call_id, content} 到 messages
    │      └─ 回到步骤 3（maxIterations=8 防死循环，同工具+同参数去重缓存）
    └─ 5. 无 tool_calls：返回最终文本（可选 streamChatAPI 流式输出最终回复）
```

### 关键类型（agentTypes.ts）

```typescript
// 工具组枚举
export type AgentToolGroup = 'dialogue' | 'writing' | 'worldbook';

// 工具定义
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSONSchema
  handler: (args: Record<string, any>, context?: AgentToolContext) => Promise<ToolCallResult>;
}

// 执行上下文（传递角色卡ID/项目ID/会话ID等，供工具定位数据）
export interface AgentToolContext {
  characterId?: string;
  projectId?: string;
  chatId?: string;
  [key: string]: any;
}

// 模型发起的工具调用（统一内部格式）
export interface ToolCallRequest {
  id: string;            // 工具调用ID（用于回填 tool_call_id）
  name: string;          // 工具名
  arguments: Record<string, any>; // 已解析参数
  raw?: any;             // 原始响应片段（调试）
}

// 工具执行结果
export interface ToolCallResult {
  success: boolean;
  data?: any;            // 成功时数据
  error?: string;        // 失败时错误信息
}

// agentLoop 最终结果
export interface AgentLoopResult {
  finalContent: string;       // 最终文本回复
  toolCallHistory: ToolCallEvent[]; // 工具调用轨迹（可观测性）
  iterations: number;         // 实际循环次数
  stoppedReason: 'completed' | 'max_iterations' | 'aborted' | 'error';
  error?: string;
}

// 工具调用事件（推送给前端）
export interface ToolCallEvent {
  iteration: number;
  toolName: string;
  arguments: Record<string, any>;
  result: ToolCallResult;
  durationMs: number;
}

// 回调
export interface AgentLoopCallbacks {
  onToolCall?: (event: ToolCallEvent) => void;      // 每次工具调用后
  onFinalChunk?: (chunk: string) => void;           // 最终回复流式 chunk
  onIteration?: (iteration: number) => void;        // 每轮循环
}
```

### ChatMessage 扩展（AIService.ts）

```typescript
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';  // 新增 'tool'
  content: string | Array<...>;                      // 不变
  // 新增可选字段（仅工具调用协议使用）
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string }; // arguments 为 JSON 字符串
  }>;
  tool_call_id?: string;  // role:'tool' 时必填，关联 assistant 的 tool_calls[].id
  name?: string;          // role:'tool' 时的工具名
}
```

### buildRequest 扩展

```typescript
buildRequest(options: {
  messages: ChatMessage[];
  model: string;
  temperature: number;
  maxTokens: number;
  stream: boolean;
  config: AIConfig;
  tools?: any[];          // 新增：工具定义数组
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }; // 新增
}): { headers; requestBody }
```

### callChatWithTools（新增方法）

返回完整响应对象（非流式），含 `content` 与 `tool_calls`：

```typescript
async callChatWithTools(
  messages: ChatMessage[],
  tools: any[],
  options: CallOptions & { model; temperature; maxTokens; tool_choice? }
): Promise<{ content: string; tool_calls?: any[]; finish_reason: string; model: string }>
```

### toolProtocolAdapter 职责

- `buildToolsParam(tools: AgentTool[])` → OpenAI tools 请求体格式 `[{type:'function', function:{name, description, parameters}}]`
- `parseToolCalls(response)` → 统一 `ToolCallRequest[]`，兼容：
  - OpenAI `message.tool_calls` 数组（arguments 为 JSON 字符串需解析）
  - 旧版 `message.function_call`（单工具，转成单元素数组）
- `buildToolResultMessage(toolCallId, result)` → `role:'tool'` 消息（content 为 JSON 字符串）

### 降级策略

- `runAgentLoop` 入口检查 `engineConfig.capabilities?.supportsToolCalling`
- 若 `false`：直接调用 `streamChatAPI`（不带 tools），返回纯文本结果，`toolCallHistory=[]`，`stoppedReason='completed'`
- 调用方无感知，现有体验完全不变

### 验证用真实工具（最小集，证明引擎端到端可用）

- `searchWorldbook(query, context)` — 调 `worldBookService` + `WorldBookKeywordMatcher.matchWorldBookKeywords`，返回 top-K 条目摘要
- `searchChatHistory(query, context)` — 调 `ChatVectorizationService` 向量检索历史对话，返回相关片段
- `searchEntries(query, context)` — 世界书语义检索（复用 ChatVectorizationService）

这三个工具复用现有服务，无需新建数据通路，能真实跑通"模型调用工具→拿到结果→继续生成"闭环。

## ADDED Requirements

### Requirement: 工具注册与分组
系统 SHALL 提供工具注册中心，支持按模式（dialogue/writing/worldbook）分组注册与查询工具。

#### Scenario: 按组查询工具
- **WHEN** agentLoop 以 `toolGroups: ['dialogue']` 启动
- **THEN** toolRegistry 返回对话组所有工具的定义
- **AND** 不返回其他组的工具

### Requirement: 智能体循环
系统 SHALL 实现工具调用循环：发送含 tools 的请求→执行 tool_calls→回填结果→重发，直到模型返回最终文本或达到 maxIterations。

#### Scenario: 模型调用工具后给出最终回复
- **WHEN** 模型响应含 tool_calls
- **THEN** 系统并行执行所有 tool_calls
- **AND** 将结果以 role:'tool' 消息回填
- **AND** 重新发送请求
- **AND** 模型返回最终文本时循环结束

#### Scenario: 达到最大迭代
- **WHEN** 循环次数达到 maxIterations（默认 8）仍未返回最终文本
- **THEN** 循环停止
- **AND** 返回 stoppedReason='max_iterations' 与已积累的内容

#### Scenario: 工具执行失败
- **WHEN** 某工具 handler 抛错
- **THEN** 该工具返回 `{success:false, error}` 给模型
- **AND** 不影响其他工具执行
- **AND** 循环继续（模型可据此降级）

### Requirement: 协议适配
系统 SHALL 兼容 OpenAI `tool_calls` 数组与旧版 `function_call` 两种响应格式。

#### Scenario: 解析 OpenAI 格式
- **WHEN** 响应 `message.tool_calls` 为数组
- **THEN** 每个 tool_call 的 arguments（JSON 字符串）被解析为对象
- **AND** 返回统一 ToolCallRequest[]

### Requirement: 降级兼容
系统 SHALL 在引擎不支持工具调用时降级为纯文本生成。

#### Scenario: 引擎不支持工具调用
- **WHEN** `supportsToolCalling === false`
- **THEN** runAgentLoop 直接调用 streamChatAPI（不带 tools）
- **AND** 返回 toolCallHistory=[] 的纯文本结果
- **AND** 不抛错

### Requirement: Agent 模式全局开关（增量零影响）
系统 SHALL 提供全局 Agent 模式开关，默认关闭，确保现有功能零影响。Agent 模式生效需同时满足开关开启且引擎支持工具调用。

#### Scenario: 开关默认关闭
- **WHEN** 用户未主动开启 Agent 模式（`enableAgentMode === false`）
- **THEN** 所有 AI 调用走现有纯文本生成路径
- **AND** 工具调用引擎完全不介入
- **AND** 现有功能行为与升级前完全一致

#### Scenario: 开关开启但模型不支持工具调用
- **WHEN** `enableAgentMode === true` 但当前引擎 `supportsToolCalling === false`
- **THEN** 降级为现有纯文本生成路径
- **AND** 不抛错
- **AND** 可提示用户「当前模型不支持工具调用，已降级为文本模式」

#### Scenario: 开关开启且模型支持工具调用
- **WHEN** `enableAgentMode === true` 且 `supportsToolCalling === true`
- **THEN** 走工具调用智能体循环
- **AND** IPC handler 计算有效标志 `effectiveSupportsToolCalling = enableAgentMode && supportsToolCalling` 传入 runAgentLoop

### Requirement: 可观测性
系统 SHALL 通过 IPC 事件推送工具调用过程。

#### Scenario: 前端订阅工具调用
- **WHEN** agentLoop 执行一次工具调用
- **THEN** 通过 `ai:agentToolCall` 事件推送 ToolCallEvent
- **AND** 含工具名、参数、结果、耗时

## MODIFIED Requirements

### Requirement: ChatMessage 类型（AIService 扩展）
`ChatMessage.role` 新增 `'tool'`，新增可选 `tool_calls`/`tool_call_id`/`name` 字段以支持 OpenAI 工具调用协议。现有不使用这些字段的所有调用方行为不变（字段可选）。

### Requirement: buildRequest（AIService 扩展）
`buildRequest` 新增可选 `tools`/`tool_choice` 参数，存在时注入请求体。不传时请求体与现有完全一致。

## REMOVED Requirements

无。
