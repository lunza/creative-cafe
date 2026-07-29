# Checklist

## AIService 扩展（不破坏现有）
- [x] `ChatMessage.role` 新增 `'tool'`，新增可选 `tool_calls`/`tool_call_id`/`name` 字段
- [x] `buildRequest` 新增可选 `tools`/`tool_choice` 参数，不传时请求体与现有完全一致
- [x] 新增 `callChatWithTools` 返回完整响应（含 tool_calls），复用 buildRequest
- [x] 现有 `streamChatAPI`/`callChatAPI`/`buildRequest` 行为无回归

## 智能体引擎核心
- [x] `agentTypes.ts` 定义全部类型（AgentTool/ToolCallRequest/ToolCallResult/AgentLoopResult/AgentLoopCallbacks/AgentToolContext/ToolCallEvent/AgentToolGroup）
- [x] `toolRegistry.ts` 支持 register/registerGroup/getTool/getTools/hasTool，同名防重复
- [x] `toolProtocolAdapter.ts` 的 buildToolsParam/parseToolCalls/buildToolResultMessage 三方法实现
- [x] parseToolCalls 兼容 OpenAI `tool_calls` 数组与旧版 `function_call`
- [x] arguments JSON 字符串解析有容错

## 智能体循环
- [x] `runAgentLoop` 主函数实现
- [x] 入口降级检查（supportsToolCalling=false → streamChatAPI 纯文本）
- [x] 循环体：callChatWithTools → parseToolCalls → 并行执行 handler → 回填 tool 消息 → 重发
- [x] maxIterations=8 硬上限 + stoppedReason 判定
- [x] 同工具+同参数去重缓存
- [x] 每 handler try-catch，失败返回 {success:false,error} 不崩循环
- [x] onToolCall 回调 + IPC 事件推送
- [x] 最终轮可选流式（onFinalChunk）
- [x] 支持 abortSignal 取消

## 验证用真实工具
- [x] `searchWorldbook` 复用 worldBookService + WorldBookKeywordMatcher
- [x] `searchChatHistory` 复用 ChatVectorizationService
- [x] `searchEntries` 复用 ChatVectorizationService 语义检索
- [x] `readOutline` 占位工具
- [ ] 工具按组注册到 toolRegistry（dialogue/worldbook/writing）
- [x] 工具 parameters 为严格 JSONSchema

## IPC 与 preload
- [x] `ai:runAgentTurn` 通道注册
- [x] `ai:agentToolCall` 事件通道注册
- [x] preload 暴露 `ai.runAgentTurn()` 与 `ai.onAgentToolCall(callback)`
- [x] electron.d.ts 类型声明完整
- [x] agentHandlers 在 IPC 注册入口挂载

## 验证
- [ ] `npx tsc --noEmit` 无新增错误
- [x] ChatMessage 扩展不破坏现有编译
- [x] toolRegistry 注册/查询逻辑正确
- [x] toolProtocolAdapter 两种格式解析正确
- [x] agentLoop 降级路径正确
- [x] IPC + preload + 类型声明完整
- [x] 真实工具 handler 签名与现有服务匹配

## 文档
- [ ] CHANGELOG.md 新增条目
- [ ] CODE_WIKI.md 新增「工具调用智能体引擎」条目
- [ ] PROJECT_DOCUMENTATION_NEW.md 新增小节
