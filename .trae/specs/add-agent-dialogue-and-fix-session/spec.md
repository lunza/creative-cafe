# 智能体对话与世界书会话修复 Spec

## Why
AgentCenter 当前仅为智能体配置管理中心，缺乏直接对话入口。用户无法在智能体中心直接与智能体进行流式对话交互。同时，世界书编写智能体的"提交回答"功能因 sessionId 时序缺陷导致"无活跃会话，无法提交回答"错误，阻碍世界书编写流程。

## What Changes
- 在 AgentList 表格操作列新增"对话"按钮，所有智能体均可点击打开流式对话窗口
- 新建 AgentDialogueModal 组件，支持多轮流式对话（复用 `agent:run` IPC + `agent:token` 事件流）
- 新建 useAgentDialogue hook，管理对话消息列表、流式接收、会话取消
- 修复世界书编写 sessionId 时序问题：在 `AuthoringProgressEvent` 新增 `sessionId` 字段，服务端创建会话后立即通过 progress 事件推送 sessionId，前端从 progress 事件中提取 sessionId 而非等待 IPC 返回

## Impact
- Affected specs: `implement-worldbook-authoring-agent`（sessionId 时序修复）, `add-agent-mode-management-and-center`（对话入口）
- Affected code:
  - `src/renderer/components/AgentCenter/AgentList.tsx` — 新增"对话"按钮
  - `src/renderer/components/AgentCenter/AgentCenter.tsx` — 集成对话 Modal
  - `src/renderer/components/AgentCenter/AgentDialogueModal.tsx` — 新建对话组件
  - `src/renderer/components/AgentCenter/hooks/useAgentDialogue.ts` — 新建对话 hook
  - `src/shared/types/worldbook-authoring.types.ts` — AuthoringProgressEvent 新增 sessionId 字段
  - `src/main/services/agent/worldbook/worldbookAuthoringService.ts` — progress 事件携带 sessionId
  - `src/renderer/components/WorldBook/hooks/useWorldBookAuthoring.ts` — 从 progress 事件提取 sessionId

## ADDED Requirements

### Requirement: 智能体中心对话入口
The system SHALL provide a "对话" button in the AgentList for every agent (both system and user-defined), enabling users to open a streaming dialogue modal directly from the AgentCenter.

#### Scenario: 打开对话窗口
- **WHEN** user clicks the "对话" button on any agent row
- **THEN** a dialogue modal opens with the agent's name/emoji in the header and an empty message list

#### Scenario: 发送消息并接收流式响应
- **WHEN** user types a message and clicks send (or presses Enter)
- **THEN** the user message appears in the chat list, an assistant placeholder appears, and tokens stream in real-time via `agent:token` events until the response completes

#### Scenario: 多轮对话
- **WHEN** the assistant finishes responding and the user sends another message
- **THEN** the full conversation history (all prior user+assistant messages) is sent to `agent:run` as context, maintaining multi-turn continuity

#### Scenario: 取消正在进行的响应
- **WHEN** user clicks the "停止" button while the agent is streaming
- **THEN** `agent:cancel` IPC is called, streaming stops, and the partial response is preserved in the chat list

#### Scenario: 关闭对话窗口
- **WHEN** user closes the dialogue modal
- **THEN** any in-flight agent run is cancelled, message history is cleared, and the modal is unmounted

### Requirement: 世界书编写 sessionId 时序修复
The system SHALL emit the sessionId via progress events immediately after session creation, so the frontend can submit clarification answers before the blocking `worldbookAgent:run` IPC returns.

#### Scenario: 提交澄清回答
- **WHEN** the agent enters PLANNING phase and asks clarification questions
- **AND** user fills in answers and clicks "提交回答"
- **THEN** the answers are submitted successfully using the sessionId from the progress event (not from the IPC return value)
- **AND** the agent continues planning with the user's answers

## MODIFIED Requirements

### Requirement: AuthoringProgressEvent 事件结构
`AuthoringProgressEvent` 新增可选字段 `sessionId?: string`，服务端在会话创建后发送的第一个 progress 事件中携带 sessionId。后续 progress 事件也应携带 sessionId 以便前端关联。前端 `handleProgressEvent` 回调从事件中提取 sessionId 并更新 `state.sessionId`。

### Requirement: useWorldBookAuthoring sessionId 管理
`handleProgressEvent` 回调函数修改为：当 progress 事件携带 `sessionId` 字段时，将其写入 `state.sessionId`。这确保在 `worldbookAgent:run` IPC 阻塞期间（如 PLANNING 阶段等待澄清回答），前端已有可用的 sessionId 供 `submitAnswers` 使用。
