# Tasks

## 阶段一：核心类型与 AIService 扩展（地基，耦合单元）

- [x] Task 1: 扩展 AIService 的 ChatMessage 与 buildRequest，新增 callChatWithTools
  - [x] SubTask 1.1: 扩展 `ChatMessage` 接口——role 新增 `'tool'`，新增可选 `tool_calls`/`tool_call_id`/`name` 字段
  - [x] SubTask 1.2: 扩展 `buildRequest`——接受可选 `tools`/`tool_choice` 参数，存在时注入 requestBody
  - [x] SubTask 1.3: 新增 `callChatWithTools(messages, tools, options)` 方法——非流式，返回 `{content, tool_calls?, finish_reason, model}`，复用 buildRequest + fetch 逻辑
  - [x] SubTask 1.4: 确保现有 `streamChatAPI`/`callChatAPI`/`buildRequest` 行为不变（新字段可选，无回归）

## 阶段二：智能体引擎核心（依赖 Task 1）

- [x] Task 2: 新增 `agentTypes.ts` 核心类型
  - [x] SubTask 2.1: 定义 AgentToolGroup / AgentTool / AgentToolContext / ToolCallRequest / ToolCallResult / ToolCallEvent / AgentLoopResult / AgentLoopCallbacks
  - [x] SubTask 2.2: 类型从 AIService 导入 ChatMessage 复用（不重复定义）

- [x] Task 3: 新增 `toolRegistry.ts` 工具注册中心
  - [x] SubTask 3.1: ToolRegistry 类——`register(tool)` / `registerGroup(group, tools)` / `getTool(name)` / `getTools(groups)` / `hasTool(name)` / `listAll()`
  - [x] SubTask 3.2: 导出单例 `toolRegistry`
  - [x] SubTask 3.3: 防重复注册校验（同名工具抛错或 warn）

- [x] Task 4: 新增 `toolProtocolAdapter.ts` 协议适配
  - [x] SubTask 4.1: `buildToolsParam(tools: AgentTool[])` → OpenAI `[{type:'function', function:{name,description,parameters}}]`
  - [x] SubTask 4.2: `parseToolCalls(response)` → 统一 `ToolCallRequest[]`，兼容 OpenAI `tool_calls` 数组与旧版 `function_call`
  - [x] SubTask 4.3: `buildToolResultMessage(toolCallId, name, result)` → `role:'tool'` 消息（content 为 JSON 字符串）
  - [x] SubTask 4.4: arguments JSON 字符串解析容错（解析失败保留原始字符串）

## 阶段二b：Agent 模式全局开关（增量零影响，可与 Task 5/6 并行）

- [x] Task 4b: 新增 `enableAgentMode` 设置字段 + Settings UI Switch 开关
  - [x] SubTask 4b.1: `src/renderer/types/setting.ts` 的 `AppSetting` 接口新增 `enableAgentMode: boolean` 字段
  - [x] SubTask 4b.2: `src/shared/settings.ts` 的 `defaultSetting` 新增 `enableAgentMode: false`（默认关闭，零影响）
  - [x] SubTask 4b.3: Settings UI（`AIEngineSettingsPanel.tsx` 或对应 AI 设置区）新增 antd `Switch` 开关，绑定 `enableAgentMode`，默认关闭，附说明文案「启用 Agent 模式（需模型支持工具调用，否则自动降级为文本模式）」
  - [x] SubTask 4b.4: 开关变更时通过 settingStore 持久化（参考现有 Switch 开关写法）
  - [x] SubTask 4b.5: 确认现有设置读写逻辑不破坏（新字段可选，旧配置无该字段时按 false 处理）

## 阶段三：智能体循环（依赖 Task 2/3/4）

- [x] Task 5: 新增 `agentLoop.ts` 核心循环
  - [x] SubTask 5.1: `runAgentLoop({messages, toolGroups, context, options, callbacks})` 主函数
  - [x] SubTask 5.2: 入口降级检查——`supportsToolCalling=false` 时直接 `streamChatAPI` 返回纯文本
  - [x] SubTask 5.3: 循环体——callChatWithTools → parseToolCalls → 若有则并行执行 handler → 回填 tool 消息 → 重发
  - [x] SubTask 5.4: maxIterations=8 硬上限 + stoppedReason 判定
  - [x] SubTask 5.5: 同工具+同参数去重缓存（缓存命中直接返回上次结果）
  - [x] SubTask 5.6: 每 handler try-catch，失败返回 `{success:false, error}` 给模型
  - [x] SubTask 5.7: 工具调用后触发 `callbacks.onToolCall` 与 IPC 事件推送
  - [x] SubTask 5.8: 最终轮可选流式（onFinalChunk）——无 tool_calls 时用 streamChatAPI 流式输出
  - [x] SubTask 5.9: 支持 abortSignal 取消

## 阶段四：验证用真实工具（依赖 Task 2/3，可与 Task 5/4b 并行）

- [x] Task 6: 新增 `tools/dialogueTools.ts` 与 `tools/worldbookTools.ts` 与 `tools/writingTools.ts`
  - [x] SubTask 6.1: `searchWorldbook(query)` — 复用 worldBookService + WorldBookKeywordMatcher，返回 top-K 条目摘要
  - [x] SubTask 6.2: `searchChatHistory(query)` — 复用 ChatVectorizationService 向量检索历史对话
  - [x] SubTask 6.3: `searchEntries(query)` — 世界书语义检索（复用 ChatVectorizationService）
  - [x] SubTask 6.4: `readOutline()` — 占位工具（返回"writing mode not connected"，方向 B 完善）
  - [x] SubTask 6.5: 在模块入口注册到 toolRegistry（dialogue 组 / worldbook 组 / writing 组）
  - [x] SubTask 6.6: 工具 parameters 严格 JSONSchema（类型/描述/required）

## 阶段五：IPC 与 preload（依赖 Task 5 + Task 4b）

- [x] Task 7: 新增 `agentHandlers.ts` IPC 通道 + preload 暴露
  - [x] SubTask 7.1: `ai:runAgentTurn` 通道——接收 `{messages, toolGroups, context, options}`，返回 AgentLoopResult
  - [x] SubTask 7.2: `ai:agentToolCall` 事件通道——工具调用过程推送 ToolCallEvent
  - [x] SubTask 7.3: preload 暴露 `ai.runAgentTurn()` 与 `ai.onAgentToolCall(callback)`
  - [x] SubTask 7.4: `electron.d.ts` 类型声明
  - [x] SubTask 7.5: 在 IPC 注册入口（如 `src/main/ipc/index.ts` 或对应注册文件）挂载 agentHandlers
  - [x] SubTask 7.6: handler 读取全局 `enableAgentMode` 设置 + 当前引擎 `capabilities.supportsToolCalling`，计算 `effectiveSupportsToolCalling = enableAgentMode && supportsToolCalling` 传入 runAgentLoop（开关关或模型不支持→降级纯文本）

## 阶段六：验证与文档

- [x] Task 8: 验证
  - [x] SubTask 8.1: `npx tsc --noEmit` 无新增错误（agent 目录零错误，worldbookTools TS2305 已修复）
  - [x] SubTask 8.2: ChatMessage 扩展不破坏现有编译（所有引用处兼容）
  - [x] SubTask 8.3: toolRegistry 注册/查询逻辑正确（同名防重复）
  - [x] SubTask 8.4: toolProtocolAdapter 两种格式解析正确
  - [x] SubTask 8.5: agentLoop 降级路径正确（supportsToolCalling=false 时走 streamChatAPI）
  - [x] SubTask 8.6: IPC 通道 + preload + 类型声明完整
  - [x] SubTask 8.7: 真实工具（searchWorldbook/searchChatHistory）handler 签名与现有服务匹配

- [x] Task 9: 更新技术文档
  - [x] SubTask 9.1: CHANGELOG.md 新增条目
  - [x] SubTask 9.2: CODE_WIKI.md 新增「工具调用智能体引擎」条目
  - [x] SubTask 9.3: PROJECT_DOCUMENTATION_NEW.md 新增小节（引擎架构 + 工具组 + 降级 + 可观测性）

# Task Dependencies
- Task 1（AIService 扩展）— 地基，最先
- Task 2/3/4（types/registry/adapter）依赖 Task 1，可并行
- Task 4b（Agent 模式开关）独立，可与 Task 5/6 并行
- Task 5（agentLoop）依赖 Task 2+3+4
- Task 6（真实工具）依赖 Task 2+3，可与 Task 5/4b 并行
- Task 7（IPC）依赖 Task 5 + Task 4b（读取开关与能力计算降级）
- Task 8（验证）依赖 Task 1-7 + 4b
- Task 9（文档）依赖 Task 8
