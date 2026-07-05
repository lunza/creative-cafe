# Checklist

## Hook 业务逻辑

- [x] `useCharacterDialogueChat` hook 暴露 `rollbackToMessage` 函数
- [x] `rollbackToMessage` 参数为 `messageId: string`，返回 `string`
- [x] `rollbackToMessage` 通过 `messagesRef.current` 查找目标消息（避免闭包陈旧）
- [x] `rollbackToMessage` 校验：messageId 不存在时返回空串
- [x] `rollbackToMessage` 校验：目标消息 `role !== 'user'` 时返回空串
- [x] `rollbackToMessage` 读取目标消息 `content` 作为返回值
- [x] `rollbackToMessage` 在 `state.isStreaming` 为 true 时调用 `cancelRequest()`
- [x] `rollbackToMessage` 截取 `slice(0, messageIndex)` 移除目标消息及所有后续消息
- [x] `rollbackToMessage` 同步更新 `messagesRef.current`
- [x] `rollbackToMessage` 调用 `setState` 更新 `messages` / `isStreaming: false` / `isLoading: false` / `error: null`
- [x] `rollbackToMessage` 调用 `saveChatToStore(updatedMessages)` 持久化
- [x] `rollbackToMessage` 调用 `addLog` 记录卷回操作
- [x] `rollbackToMessage` 依赖数组包含 `[state.isStreaming, cancelRequest, saveChatToStore, addLog]`

## ChatMessageBubble UI

- [x] `ChatMessageBubbleProps` 接口新增 `onRollback?: (messageId: string) => void` 可选 prop
- [x] 组件参数解构新增 `onRollback`
- [x] import 列表追加 `RollbackOutlined`（from `@ant-design/icons`）
- [x] `userEditButton` 区域：原 `EditOutlined` 编辑按钮已移除
- [x] `userEditButton` 区域：新增 `RollbackOutlined` 卷回按钮
- [x] 卷回按钮 Tooltip："卷回到输入框"
- [x] 卷回按钮 `onClick` 调用 `onRollback?.(message.id)`
- [x] 卷回按钮 `disabled` 条件：`isStreaming && !isLastMessage`
- [x] 卷回按钮配色：默认 `var(--chat-action-text, #9ca3af)`，hover 时 `var(--primary-color, #6366f1)`
- [x] 卷回按钮 hover 时背景变为 `var(--chat-action-hover, rgba(255, 255, 255, 0.1))`
- [x] 卷回按钮样式与原编辑按钮一致（圆形/方形、padding、font-size、border-radius、transition）
- [x] 内联编辑机制（`isEditing` / `editContent` / `handleEditStart` 等）保留未删除
- [x] 助手消息 `actionButtons` 中的 `EditOutlined` 编辑按钮保留未删除
- [x] `onEdit` prop 保留未删除

## 父组件透传

- [x] `CharacterDialogueChat.tsx` 从 hook 解构 `rollbackToMessage`
- [x] 新增 `handleRollback` useCallback（参数 `messageId: string`）
- [x] `handleRollback` 调用 `rollbackToMessage(messageId)` 获取回退内容
- [x] `handleRollback` 成功时调用 `setGeneratedReplyText(content)` 填充输入框
- [x] `handleRollback` 成功时调用 `message.success('已卷回到输入框')`
- [x] `handleRollback` 内容为空时调用 `message.warning('卷回失败：未找到目标消息')`
- [x] `handleRollback` 依赖数组为 `[rollbackToMessage]`
- [x] `<ChatMessageBubble>` JSX 传入 `onRollback={handleRollback}`

## 测试

- [x] `rollbackToMessage` 单元测试：卷回最后一条用户消息正确移除并返回内容
- [x] `rollbackToMessage` 单元测试：卷回中间轮次用户消息正确移除后续所有消息
- [x] `rollbackToMessage` 单元测试：messageId 不存在时返回空串
- [x] `rollbackToMessage` 单元测试：目标消息 role 非 'user' 时返回空串
- [x] `npm test` 全部通过，无新增编译错误（1004 tests passed）

## 行为验证

- [x] 最后一条用户消息卷回（非流式态）：消息移除、内容填入输入框、成功提示（代码审查验证）
- [x] 最后一条用户消息卷回（流式生成中）：先取消流式、再移除消息、内容填入输入框（代码审查验证）
- [x] 中间轮次用户消息卷回：移除该消息及所有后续消息（代码审查验证）
- [x] 流式生成中点击非最后一轮的卷回按钮：按钮 disabled 不响应（代码审查验证）
- [x] 输入框已有内容时卷回：输入框内容被覆盖（复用 generatedReplyText 机制覆盖）
- [x] 卷回后刷新页面：消息列表为卷回后状态（saveChatToStore 持久化）

## 文档同步

- [x] `doc/04b-character-dialogue-chat-module.md` 新增"用户消息卷回按钮"章节
- [x] 文档说明卷回按钮 UI 位置、图标、Tooltip、配色
- [x] 文档说明 `rollbackToMessage` hook 函数签名与行为
- [x] 文档说明与 `generatedReplyText` 输入框填充机制的复用关系
- [x] 文档说明与 Trae "回退到本轮对话发起前" 的行为对比
- [x] 文档标注移除原用户消息编辑按钮
- [x] 文档更新 `ChatMessageBubbleProps` 变更表（新增 `onRollback`）
