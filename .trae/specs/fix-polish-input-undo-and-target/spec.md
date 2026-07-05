# 修复润色功能撤销与目标定位 Spec

## Why

对话模式的润色功能（`refine-user-input-text` spec 引入）当前存在两个关键缺陷，严重影响用户体验与功能正确性：

1. **Ctrl+Z 撤销失效**：润色完成后，用户无法通过 Ctrl+Z 快捷键回退到润色前的原始文本。根因在于 `ChatInputBar.tsx` 中 `generatedReplyText` 的 useEffect 使用 `setInput(generatedReplyText)` 直接设置 React state，该方式不会向浏览器原生 undo stack 注册历史项，导致 textarea 的 undo 栈中不存在"润色前文本"这一快照。

2. **润色目标错误定位**：系统错误地将对话链条中最后一条消息（即 AI 的最新回复内容）作为润色对象，而非用户在输入框中已输入但尚未发送的草稿文本。根因在于 `CharacterDialogueChat.hooks.ts` 中 `polishInput` 函数将 `messagesRef.current.filter(msg => msg.role !== 'system')` 的全部对话历史作为 `contextMessages` 传给引擎，对话历史以 AI 回复结尾，AI 引擎在生成续写时倾向于"接着最后一条消息继续"，从而将最后一条 AI 回复误作为润色对象——尽管 `polishSystemPrompt` 中已包含 `originalText`，但对话上下文末尾消息的影响力远大于系统提示中的文本片段。

## What Changes

### Bug 1 修复：注册浏览器 undo stack（`ChatInputBar.tsx`）

- 重构 `generatedReplyText` useEffect 的文本填充逻辑：
  - **废弃**直接调用 `setInput(generatedReplyText)` 作为主路径（保留为 fallback）
  - **改用** `textareaRef.current.focus()` + `textareaRef.current.select()` + `document.execCommand('insertText', false, textToInsert)` 三步法
  - `execCommand('insertText')` 会向浏览器原生 undo stack 注册一次可撤销的文本插入操作，Ctrl+Z 即可回退到选区被替换前的状态（即润色前的原始文本或空文本）
  - 当 `execCommand` 返回 `false` 或抛出异常时（极少数不支持的环境），回退到 `setInput(textToInsert)` 保证功能可用（但无 undo 支持）
  - `execCommand` 成功后，textarea 的 `onChange` 事件会被触发，React state 通过 `setInput(e.target.value)` 自动同步，无需额外处理
- 保留 `onGeneratedReplyTextConsumed?.()` 的即时调用（在 setTimeout 之前），防止重复触发
- 保留 setTimeout 异步聚焦机制（确保 textarea 已渲染后再执行 select + execCommand）

### Bug 2 修复：润色目标正确定位（`CharacterDialogueChat.hooks.ts`）

- 在 `polishInput` 函数中，于 `engine.sendMessage` 调用前，向 `contextMessages` 末尾追加一条合成的 user 消息：
  ```typescript
  contextMessages = [...contextMessages, {
    id: 'polish-target-' + Date.now(),
    role: 'user',
    content: originalText,
    timestamp: Date.now(),
    status: 'sent',
  }];
  ```
- 该合成消息**仅用于 AI 上下文**，**不**写入 `messagesRef.current`，**不**持久化到 chat store，**不**显示在对话界面
- 追加时机：在 token 裁剪逻辑**之后**、`engine.sendMessage` **之前**。原因：
  - 裁剪逻辑针对真实对话历史操作，避免合成消息干扰裁剪分析
  - 合成消息的 token 开销极小（单条用户草稿，通常 < 200 tokens），由 `reservedForResponse` 缓冲吸收
  - 确保合成消息始终是 `contextMessages` 数组的最后一条，AI 引擎看到对话以"用户的草稿文本"结尾，与 `polishSystemPrompt` 中的 `originalText` 形成双重锚定
- 该修复同步应用于 `generateUserReply` 的对称检查（经审查，`generateUserReply` 不存在此问题，因为其目标是"生成新回复"而非"润色草稿"，AI 续写最后一条消息即为期望行为，无需修改）

## Impact

- **Affected specs**: `refine-user-input-text`（润色功能的原始 spec，本 spec 为其 bug 修复）、`add-ai-user-reply-button`（共享 `generatedReplyText` 填充机制，Bug 1 修复同步影响 AI回复按钮的文本填充路径——AI回复按钮的填入同样会注册 undo stack，这是正向副作用，不需额外处理）、`rollback-user-message`（共享 `generatedReplyText` 填充机制，卷回填入同样获得 undo 支持）
- **Affected code**:
  - `src/renderer/components/Character/CharacterDialogueChat/ChatInputBar.tsx`（修改 `generatedReplyText` useEffect）
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（修改 `polishInput` 函数的 `contextMessages` 构建逻辑）

## ADDED Requirements

### Requirement: 润色操作可撤销

系统 SHALL 在润色完成并替换输入框内容后，保留浏览器原生 undo 历史，使用户可通过 Ctrl+Z（macOS: Cmd+Z）回退到润色前的原始文本状态。

#### Scenario: 润色后 Ctrl+Z 回退

- **WHEN** 用户在输入框中输入文本 "你好" 后点击"润色"按钮，润色完成后输入框内容被替换为 "您好，很高兴见到你"
- **AND** 用户按下 Ctrl+Z（或 Cmd+Z）
- **THEN** 输入框内容回退到润色前的 "你好"（或润色前的空文本，取决于润色前输入框是否已有内容）

#### Scenario: AI回复填入后 Ctrl+Z 回退（正向副作用）

- **WHEN** 用户点击"AI回复"按钮，生成的回复文本填入输入框
- **AND** 用户按下 Ctrl+Z
- **THEN** 输入框内容回退到生成回复前的状态（空文本或之前的草稿）

#### Scenario: 卷回填入后 Ctrl+Z 回退（正向副作用）

- **WHEN** 用户点击消息气泡上的"卷回"按钮，卷回的文本填入输入框
- **AND** 用户按下 Ctrl+Z
- **THEN** 输入框内容回退到卷回前的状态

#### Scenario: execCommand 不支持时的降级

- **WHEN** 运行环境不支持 `document.execCommand('insertText')`（返回 false 或抛出异常）
- **THEN** 回退到 `setInput(textToInsert)` 直接设置 React state（功能可用但无 undo 支持）
- **AND** 不抛出错误，不显示错误提示

### Requirement: 润色目标正确定位

系统 SHALL 在调用 AI 引擎进行润色时，将用户待润色的草稿文本作为对话上下文的最后一条消息，确保 AI 引擎准确识别润色对象。

#### Scenario: 润色目标为输入框草稿

- **WHEN** 用户在输入框中输入草稿文本 "今天天气不错" 后点击"润色"按钮
- **AND** 对话历史中最后一条消息是 AI 的回复 "是啊，阳光很好"
- **THEN** 传给 AI 引擎的 `contextMessages` 数组末尾追加一条 `{role: 'user', content: '今天天气不错'}` 消息
- **AND** AI 引擎收到的对话上下文以用户草稿结尾，润色输出针对 "今天天气不错" 而非 AI 的 "是啊，阳光很好"

#### Scenario: 合成消息不污染对话历史

- **WHEN** 润色完成后
- **THEN** `messagesRef.current` 中不包含合成的 polish-target 消息
- **AND** 对话界面不显示合成的 polish-target 消息
- **AND** chat store 持久化的消息列表不包含合成的 polish-target 消息

#### Scenario: 空对话历史下的润色

- **WHEN** 对话历史为空（`messagesRef.current` 为空数组）时用户输入草稿并点击"润色"
- **THEN** `contextMessages` 仅包含一条合成的 user 消息（草稿文本）
- **AND** AI 引擎基于 `polishSystemPrompt` + 单条草稿消息进行润色

## MODIFIED Requirements

### Requirement: ChatInputBar generatedReplyText 填充机制

`ChatInputBar` 中 `generatedReplyText` useEffect 的文本填充逻辑修改为：

1. 即时调用 `onGeneratedReplyTextConsumed?.()` 清空父组件暂存
2. 在 setTimeout（异步）中：
   - `textareaRef.current.focus()` 聚焦
   - `textareaRef.current.select()` 全选当前内容
   - 尝试 `document.execCommand('insertText', false, textToInsert)`
   - 若返回 `false` 或抛出异常，回退 `setInput(textToInsert)`
   - `setSelectionRange(len, len)` 定位光标到末尾

该修改适用于所有通过 `generatedReplyText` 填充输入框的路径：AI回复、润色、卷回。

### Requirement: polishInput contextMessages 构建

`polishInput` 函数的 `contextMessages` 构建逻辑修改为：

1. 原有逻辑：`messagesRef.current.filter(msg => msg.role !== 'system')` 取对话历史
2. token 裁剪逻辑保持不变（针对真实对话历史操作）
3. **新增**：在裁剪完成后、`engine.sendMessage` 调用前，向 `contextMessages` 末尾追加合成 user 消息：
   ```typescript
   contextMessages = [...contextMessages, {
     id: `polish-target-${Date.now()}`,
     role: 'user',
     content: originalText,
     timestamp: Date.now(),
     status: 'sent',
   }];
   ```
4. 该合成消息仅存在于 `polishInput` 函数的局部变量中，不写入任何 ref 或 state

### Requirement: addLog 日志增强

`polishInput` 函数的 `addLog` 日志中，context 消息数应反映追加合成消息后的总数，便于调试：

```
[CharacterDialogueChat] polishInput started (charName=..., persona=..., context=N msgs, original=M chars)
```

其中 N 包含合成的 polish-target 消息（即真实对话历史数 + 1）。
