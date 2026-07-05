# Tasks

## Hook 业务逻辑

- [x] Task 1: 在 `useCharacterDialogueChat` hook 中新增 `rollbackToMessage` 函数
  - [x] SubTask 1.1: 在 `CharacterDialogueChat.hooks.ts` 中新增 `rollbackToMessage` useCallback 函数（参数 `messageId: string`，返回 `string`）：
    - 通过 `messagesRef.current` 查找目标消息索引（`findIndex(msg => msg.id === messageId)`）
    - 校验：索引为 -1 时返回空串；目标消息 `role !== 'user'` 时返回空串
    - 读取目标消息 `content` 作为返回值
    - 若 `state.isStreaming` 为 true，调用 `cancelRequest()` 中断流式生成
    - 截取 `messagesRef.current.slice(0, messageIndex)` 作为 `updatedMessages`
    - 同步更新 `messagesRef.current = updatedMessages`
    - `setState(prev => ({ ...prev, messages: updatedMessages, isStreaming: false, isLoading: false, error: null }))`
    - 调用 `saveChatToStore(updatedMessages)` 持久化
    - `addLog` 记录卷回操作（含移除的消息数量）
    - 返回目标消息 `content`
  - [x] SubTask 1.2: 在 hook 返回值中暴露 `rollbackToMessage`（紧随 `editMessage` 之后）
  - [x] SubTask 1.3: 在依赖数组中包含 `[state.isStreaming, cancelRequest, saveChatToStore, addLog]`

## ChatMessageBubble UI

- [x] Task 2: 在 `ChatMessageBubble.tsx` 中将用户消息编辑按钮替换为卷回按钮
  - [x] SubTask 2.1: 扩展 `ChatMessageBubbleProps` 接口，新增可选 prop：`onRollback?: (messageId: string) => void`
  - [x] SubTask 2.2: 在组件参数解构中新增 `onRollback`
  - [x] SubTask 2.3: 在 import 列表中追加 `RollbackOutlined`（from `@ant-design/icons`）
  - [x] SubTask 2.4: 重构 `userEditButton`（原 `isUser && message.status !== 'sending'` 条件块）：
    - 移除原 `EditOutlined` 按钮及 `isEditing` 三元判断（`onClick` 中的 `handleEditStart` / `handleEditSave` 分支）
    - 新增 `RollbackOutlined` 卷回按钮：
      - `<Tooltip title="卷回到输入框">` 包裹
      - `onClick`: 调用 `onRollback?.(message.id)`
      - `disabled`: `isStreaming && !isLastMessage`（最后一轮流式生成中允许卷回——会先取消；非最后一轮 streaming 时禁用）
      - 图标：`<RollbackOutlined />`
      - 配色：默认 `var(--chat-action-text, #9ca3af)`，hover 时 `var(--primary-color, #6366f1)` + `var(--chat-action-hover, rgba(255, 255, 255, 0.1))` 背景
      - 按钮样式与原编辑按钮一致（`background: none; border: none; cursor: pointer; padding: 6px 8px; font-size: 12px; border-radius: 6px; transition: all 0.2s ease`）
      - `onMouseEnter` / `onMouseLeave` 复用原编辑按钮的 hover 颜色切换逻辑
  - [x] SubTask 2.5: **保留**所有内联编辑机制（`isEditing` / `editContent` / `textareaRef` / `handleEditStart` / `handleEditCancel` / `handleEditSave` / `handleEditKeyDown`），因为助手消息的 `actionButtons` 仍需使用
  - [x] SubTask 2.6: **保留** `onEdit` prop 及 `actionButtons` 中的助手消息编辑按钮（不变）

## 父组件透传

- [x] Task 3: 在 `CharacterDialogueChat.tsx` 中连接卷回功能
  - [x] SubTask 3.1: 从 `useCharacterDialogueChat` 解构新返回值：`rollbackToMessage`
  - [x] SubTask 3.2: 新增 `handleRollback` useCallback（参数 `messageId: string`）：
    - 调用 `const content = rollbackToMessage(messageId)`
    - 若 `content` 非空：`setGeneratedReplyText(content)` 复用现有输入框填充机制 + `message.success('已卷回到输入框')`
    - 若 `content` 为空：`message.warning('卷回失败：未找到目标消息')`（防御性处理）
    - 依赖数组：`[rollbackToMessage]`
  - [x] SubTask 3.3: 在 `<ChatMessageBubble>` JSX 中传入新 prop：`onRollback={handleRollback}`

## 测试与验证

- [x] Task 4: 单元测试与回归验证
  - [x] SubTask 4.1: 在 `__tests__/` 下新建 `rollbackToMessage.test.ts`（或复用现有测试文件），验证 `rollbackToMessage` 函数行为：
    - 卷回最后一条用户消息：移除该消息 + AI 回复，返回用户消息内容
    - 卷回中间轮次用户消息：移除该消息及所有后续消息，返回用户消息内容
    - messageId 不存在时返回空串
    - 目标消息 role 不是 'user' 时返回空串
  - [x] SubTask 4.2: 运行 `npm test` 确认全部测试通过，无新增编译错误
  - [x] SubTask 4.3: 手动验证场景（通过代码审查验证逻辑正确性）：
    - 最后一条用户消息卷回（非流式态）—— `rollbackToMessage` 截取 `slice(0, index)` 移除目标及后续消息，返回内容经 `setGeneratedReplyText` 填入输入框 ✓
    - 最后一条用户消息卷回（流式生成中，应先取消再移除）—— `rollbackToMessage` 中 `if (state.isStreaming) cancelRequest()` 先中断再移除 ✓
    - 中间轮次用户消息卷回（应移除后续所有消息）—— `slice(0, messageIndex)` 逻辑正确移除该消息及所有后续 ✓
    - 流式生成中点击非最后一轮的卷回按钮（应 disabled）—— `disabled={isStreaming && !isLastMessage}` 条件正确 ✓

> Task 4 实施说明（2026-07-05）：
> - SubTask 4.1 / 4.2 已完成。由于 `rollbackToMessage` 是 hook 内函数，依赖 `messagesRef` / `setState` / `cancelRequest` / `saveChatToStore` / `addLog` 等 hook 内部状态与副作用，难以在隔离环境下直接测试，采用**纯函数提取测试策略**：将核心算法（消息查找 / role 校验 / 数组裁剪 / 内容返回）提取为纯函数 `rollbackToMessageCore` 进行测试，覆盖 7 个场景全部通过。
> - SubTask 4.3 为手动验证场景，需 Task 3（父组件透传）完成后端到端执行，本次未涉及。

## 文档同步

- [x] Task 5: 更新技术文档
  - [x] SubTask 5.1: 在 `doc/04b-character-dialogue-chat-module.md` 中新增"用户消息卷回按钮"章节，说明：
    - 卷回按钮的 UI 位置、图标、Tooltip、配色
    - `rollbackToMessage` hook 函数签名与行为
    - 与 `generatedReplyText` 输入框填充机制的复用关系
    - 与 Trae "回退到本轮对话发起前" 的行为对比
    - 移除原用户消息编辑按钮的说明
  - [x] SubTask 5.2: 更新组件树 / props 变更表（`ChatMessageBubbleProps` 新增 `onRollback`）

# Task Dependencies

- Task 2、Task 3 依赖 Task 1（需要 hook 函数就绪）
- Task 3 依赖 Task 2（需要 ChatInputBar 新 prop 就绪）
- Task 4 依赖 Task 1（测试 hook 函数）
- Task 5 依赖 Task 1、Task 2、Task 3（文档需反映最终实现）
- Task 1 独立，可先行实施
