# 用户消息卷回按钮 Spec

## Why

对话模式中用户消息气泡上当前仅存在一个编辑按钮（`EditOutlined`），点击后进入内联编辑模式，保存时仅原地更新消息内容（`editMessage`）——**不会重新触发 AI 回复**，导致编辑后的用户消息与原有 AI 回复语义脱节、上下文不连贯，用户反馈体验不佳。

参照 Trae IDE "回退到本轮对话发起前" 的交互范式，将用户消息的编辑按钮**重构为卷回按钮**：点击后把该用户消息内容完整回退到对话输入框供用户修改重发，同时移除该用户消息及其对应的 AI 回复（以及之后的所有消息），使对话状态回到该轮发起前。用户修改后重新发送时，AI 将基于新的用户消息生成全新回复，保证语义连贯。

## What Changes

### UI 层（`ChatMessageBubble.tsx`）
- **移除**用户消息气泡上的 `EditOutlined` 编辑按钮及对应的内联编辑触发逻辑（`userEditButton` 区域）
- **新增** `RollbackOutlined` 卷回按钮（替代原编辑按钮位置），Tooltip："卷回到输入框"
- 按钮配色：使用青色/蓝紫色渐变（与现有按钮风格一致），hover 时高亮
- `disabled` 条件：`isStreaming && isLastMessage`（最后一轮正在流式生成时允许卷回——会先取消流式再回退；非最后一轮的卷回在 streaming 期间禁用以避免状态冲突）
- **保留**助手消息气泡上的编辑按钮（`actionButtons` 中的 `EditOutlined`）与全部内联编辑机制（`isEditing` / `editContent` / `handleEditStart` 等），仅替换用户消息侧

### 业务逻辑层（`CharacterDialogueChat.hooks.ts`）
- **新增** `rollbackToMessage(messageId: string): string` hook 函数：
  - 通过 `messagesRef.current` 查找目标消息索引，校验 `role === 'user'`
  - 读取用户消息内容作为返回值
  - 若 `state.isStreaming` 为 true，调用 `cancelRequest()` 中断当前流式生成
  - 截取 `messages[0..messageIndex)` 作为更新后的消息列表（移除目标用户消息及所有后续消息）
  - `setState` 更新 `messages` / `isStreaming: false` / `isLoading: false` / `error: null`
  - 同步更新 `messagesRef.current`
  - 调用 `saveChatToStore(updatedMessages)` 持久化
  - 返回用户消息内容（供父组件填入输入框）
- **暴露** `rollbackToMessage` 到 hook 返回值

### 父组件层（`CharacterDialogueChat.tsx`）
- 从 hook 解构 `rollbackToMessage`
- **新增** `handleRollback` useCallback 回调：
  - 调用 `rollbackToMessage(messageId)` 获取回退内容
  - 若内容非空，通过 `setGeneratedReplyText(content)` 复用现有输入框填充机制（与 AI回复 / 润色按钮共享）
  - 显示 `message.success('已卷回到输入框')` 提示
- 在 `<ChatMessageBubble>` JSX 中传入 `onRollback={handleRollback}` 新 prop

### 接口层（`ChatMessageBubble.tsx` props）
- `ChatMessageBubbleProps` **新增** `onRollback?: (messageId: string) => void` 可选 prop
- `ChatMessageBubbleProps` **保留** `onEdit` prop（助手消息编辑仍需使用）

## Impact

- **Affected specs**: 
  - `add-ai-user-reply-button`（共享 `generatedReplyText` 输入框填充机制）
  - `refine-user-input-text`（共享 `generatedReplyText` 输入框填充机制）
- **Affected code**:
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx`（替换用户消息编辑按钮为卷回按钮）
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（新增 `rollbackToMessage` 函数）
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx`（新增 `handleRollback` 透传）
  - `doc/04b-character-dialogue-chat-module.md`（增量更新文档）

## ADDED Requirements

### Requirement: 用户消息卷回按钮
系统 SHALL 在每条已发送（`status !== 'sending'`）的用户消息气泡下方显示一个"卷回"按钮（`RollbackOutlined` 图标），点击后将该用户消息内容回退到对话输入框，并移除该消息及其后所有消息。

#### Scenario: 卷回最后一条用户消息（非流式态）
- **WHEN** 用户点击最后一条用户消息的卷回按钮，且当前未在流式生成
- **THEN** 该用户消息与其对应的 AI 回复从消息列表中移除，用户消息内容填入输入框，显示成功提示

#### Scenario: 卷回最后一条用户消息（流式生成中）
- **WHEN** 用户点击最后一条用户消息的卷回按钮，且 AI 正在流式生成
- **THEN** 系统先调用 `cancelRequest()` 中断流式生成，再移除该用户消息与正在生成的 AI 回复，用户消息内容填入输入框

#### Scenario: 卷回中间轮次的用户消息
- **WHEN** 用户点击非最后一条用户消息的卷回按钮
- **THEN** 该用户消息、其 AI 回复、以及之后的所有消息均从列表中移除，用户消息内容填入输入框，对话状态回到该轮发起前（类似 Trae "回退到本轮对话发起前"）

#### Scenario: 流式生成中点击非最后一轮的卷回按钮
- **WHEN** AI 正在流式生成，用户点击非最后一条用户消息的卷回按钮
- **THEN** 按钮处于 disabled 状态，不响应点击（避免与正在进行的流式生成产生状态冲突）

#### Scenario: 输入框已有内容时卷回
- **WHEN** 用户点击卷回按钮时输入框已有未发送内容
- **THEN** 输入框内容被卷回的用户消息内容覆盖（与 Trae 行为一致）

### Requirement: 卷回状态持久化
系统 SHALL 在卷回操作完成后通过 `saveChatToStore` 持久化更新后的消息列表，确保刷新页面后对话状态一致。

#### Scenario: 卷回后刷新页面
- **WHEN** 用户卷回某轮对话后刷新页面
- **THEN** 消息列表显示卷回后的状态（不含被移除的消息），输入框为空（输入框内容不持久化，与 Trae 行为一致）

## MODIFIED Requirements

### Requirement: 用户消息操作按钮区
用户消息气泡下方的操作按钮区原含一个 `EditOutlined` 编辑按钮（触发内联编辑模式）。现**替换**为 `RollbackOutlined` 卷回按钮（触发卷回逻辑）。原内联编辑机制（`isEditing` / `editContent` / `handleEditStart` / `handleEditCancel` / `handleEditSave` / `handleEditKeyDown`）**保留**用于助手消息编辑，不删除。

## REMOVED Requirements

### Requirement: 用户消息内联编辑按钮
**Reason**: 内联编辑仅原地更新消息内容，不触发 AI 重新生成，导致用户消息与 AI 回复语义脱节，用户体验不佳。
**Migration**: 用户需使用"卷回到输入框 → 修改 → 重新发送"的工作流替代原"内联编辑 → 保存"工作流。重新发送后 AI 将基于新内容生成全新回复，保证语义连贯。
