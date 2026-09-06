# 修复"以当前用户人设生成对话回复"按钮回显上一条消息 Spec

## Why

对话功能中"AI回复"按钮（Tooltip：以当前用户人设生成对话回复）存在 bug：点击后输入框被填入**对话中上一条消息的原文**，而非基于用户人设生成的新回复。

**根因（有运行时日志实证，logs/ai-handler/ai-handler_20260827_210504.log req-bc4fe8539372）**：`generateUserReply` 将对话历史作为 messages 数组直接传给引擎，而对话自然以角色（assistant 角色）的消息结尾。OpenAI 兼容后端（尤其 llama.cpp 本地后端）将"末尾 assistant 消息"视为**续写前缀（prefill）**——模型直接回显该消息内容而非生成新回复。日志显示模型仅预测 1 个 token（`predicted_n: 1`）即命中停止序列，返回内容与上一条 assistant 消息逐字一致（864 字符）。

**既有先例**：`polishInput` 曾因完全相同的问题（以 assistant 结尾的历史触发 AI 续写本能）通过 spec `fix-polish-context-isolation` 修复——将对话历史格式化为文本嵌入系统提示的"## 对话历史参考"段落，`engine.sendMessage` 仅发送单条 user 请求消息。`generateUserReply` 是该修复的孪生函数但从未同步修复。

## What Changes

- `PromptBuilder.ts`：`buildUserReplySystemPrompt` 新增可选参数 `conversationHistory?: ChatMessage[]`，传入时格式化为"## 对话历史"段落嵌入系统提示（`${userName}` / `${charName}` 作为说话人标注）
- `CharacterDialogueChat.hooks.ts` 的 `generateUserReply`：
  - 先构建不含历史的 preliminary 系统提示用于 token 计数（镜像 polishInput 模式）
  - 保留现有上下文裁剪逻辑（仍对真实 contextMessages 操作）
  - 裁剪后构建含历史的最终系统提示
  - `engine.sendMessage` 的 messages 数组改为**单条 user 角色请求消息**（"请以 {userName} 的身份，直接输出下一句回复内容本身"），不再传对话历史数组
- 修复后消息结构为 `[system(人设+历史+约束), user(生成请求)]`，以 user 结尾触发 assistant 补全，从根本上消除 trailing-assistant prefill 回显

## Impact

- Affected specs: `fix-polish-context-isolation`（复用其修复模式）、`add-ai-user-reply-button`（原始功能 spec）
- Affected code:
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（扩展 `buildUserReplySystemPrompt`）
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（`generateUserReply` L2017-L2212）
  - `docs/FIX_RECORDS.md`（重点标记此 bug 修复记录）

## ADDED Requirements

### Requirement: 用户回复生成的上下文隔离
The system SHALL embed the conversation history into the user-reply system prompt as text (not as the engine messages array), and send a single user-role request message to the engine, preventing trailing-assistant prefill echo.

#### Scenario: 消除上一条消息回显
- **WHEN** 用户点击"AI回复"按钮且对话最后一条消息为角色（assistant）消息
- **THEN** 发送给 AI 的 messages 数组为 `[system(含人设+对话历史+约束), user(生成请求)]`，以 user 消息结尾
- **AND** AI 生成基于用户人设的新回复内容，而非回显上一条消息

#### Scenario: 历史嵌入系统提示
- **WHEN** `buildUserReplySystemPrompt` 接收非空 `conversationHistory`
- **THEN** 输出包含"## 对话历史"段落，user 消息标注为 `[${userName}]:`，assistant 消息标注为 `[${charName}]:`
- **WHEN** `conversationHistory` 为空或未传
- **THEN** 段落显示"（无历史对话）"，行为与现状兼容

#### Scenario: token 裁剪保持生效
- **WHEN** 启用 Token 管理且对话历史超限
- **THEN** 裁剪仍作用于真实 contextMessages（与 polishInput 的裁剪模式一致），裁剪后的历史嵌入最终系统提示

## MODIFIED Requirements

### Requirement: 用户回复专用系统提示（原 add-ai-user-reply-button spec）
`buildUserReplySystemPrompt(characterInfo, persona, person?, userInstruction?, conversationHistory?)` 函数签名扩展：
- 新增第 5 个可选参数 `conversationHistory`
- 输出在"## 对方角色上下文"之后、"## 任务要求"之前新增"## 对话历史"段落
- 其余段落（用户人设、用户指令、任务要求、人称约束）保持不变
