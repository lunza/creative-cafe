# Checklist

## Bug 2 修复：润色目标正确定位（`CharacterDialogueChat.hooks.ts`）

- [x] `polishInput` 函数中，token 裁剪逻辑完成后、`engine.sendMessage` 调用前，向 `contextMessages` 追加合成 user 消息
- [x] 合成消息的 `id` 以 `polish-target-` 前缀开头（含 `Date.now()` 后缀）
- [x] 合成消息的 `role` 为 `'user'`
- [x] 合成消息的 `content` 等于 `originalText`（待润色的原始草稿文本）
- [x] 合成消息的 `timestamp` 为 `Date.now()`（number 类型）
- [x] 合成消息的 `status` 为 `'sent'`
- [x] 合成消息**不**写入 `messagesRef.current`
- [x] 合成消息**不**触发 `setState`
- [x] 合成消息**不**调用 `saveChatToStore`
- [x] 合成消息**不**显示在对话界面（仅作为局部变量传给 `engine.sendMessage`）
- [x] 追加位置在 `if (tokenManagementEnabled) { ... }` 块**之后**，确保不被裁剪
- [x] `addLog` 日志中的 `context=N msgs` 反映追加后的总数
- [x] 润色完成后 `messagesRef.current` 长度不变（合成消息不污染对话历史）

## Bug 1 修复：润色操作可撤销（`ChatInputBar.tsx`）

- [x] `generatedReplyText` useEffect 中**移除**直接 `setInput(generatedReplyText)` 同步调用作为主路径
- [x] useEffect 中将 `generatedReplyText` 暂存到局部常量 `textToInsert`（防止 `onGeneratedReplyTextConsumed?.()` 清空后闭包失效）
- [x] `onGeneratedReplyTextConsumed?.()` 仍在 setTimeout 之前即时调用
- [x] setTimeout 回调中按顺序执行：`focus()` → `select()` → `execCommand('insertText', false, textToInsert)` → fallback `setInput` → `setSelectionRange(len, len)`
- [x] `execCommand('insertText')` 调用包裹在 try/catch 中，异常时 `inserted = false`
- [x] `execCommand` 返回 `false` 或抛异常时，回退到 `setInput(textToInsert)` 保证功能可用
- [x] `execCommand` 成功时不调用 `setInput`（由 textarea 的 `onChange` 事件自动同步 React state）
- [x] 光标定位到末尾（`setSelectionRange(len, len)`）在两条路径后均执行
- [x] useEffect 上方有注释说明 undo stack 注册机制与服务的三条填充路径（AI回复 / 润色 / 卷回）

## 正向副作用验证

- [x] AI回复按钮填入文本后，Ctrl+Z 可回退（共享 `generatedReplyText` 填充路径）
- [x] 卷回按钮填入文本后，Ctrl+Z 可回退（共享 `generatedReplyText` 填充路径）
- [x] 上述两条路径无需额外代码改动，由 Task 2 的 useEffect 重构自动覆盖

## 测试

- [x] `__tests__/polishInputTargetFix.test.ts` 存在并通过
- [x] 测试覆盖：对话历史为空时合成消息为唯一消息
- [x] 测试覆盖：对话历史以 AI 回复结尾时合成消息追加到末尾
- [x] 测试覆盖：对话历史以 user 消息结尾时合成消息仍追加到末尾
- [x] 测试覆盖：合成消息的 id / role / content / timestamp 字段正确
- [x] `__tests__/chatInputBarUndo.test.ts` 存在并通过（采用纯函数提取测试策略）
- [x] 测试覆盖：`generatedReplyText` 非空时最终 input 等于该文本
- [x] 测试覆盖：`onGeneratedReplyTextConsumed` 被调用一次（通过 `shouldFillGeneratedText` 入口判断测试覆盖）
- [x] 测试覆盖：`generatedReplyText` 为空时不触发填充
- [x] `npm test` 全部通过（1021 通过，含新增 17 个），无新增编译错误

## 文档同步

- [x] `doc/04b-character-dialogue-chat-module.md` 中"润色输入按钮"章节新增"Bug 修复记录"小节（line 361 Bug 1 + line 483 Bug 2）
- [x] 文档说明 Bug 1 根因（setInput 不注册 undo stack）与修复方案（execCommand + fallback）
- [x] 文档说明 Bug 2 根因（contextMessages 以 AI 回复结尾）与修复方案（追加合成 user 消息）
- [x] 文档标注正向副作用（AI回复 / 卷回 获得 undo 支持）
- [x] 文档中本次修复以**重点标记**形式呈现（两处均用【重点标记】前缀，便于后续追溯）
