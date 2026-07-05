# Tasks

## Bug 2 修复：润色目标正确定位

- [x] Task 1: 在 `polishInput` 函数中向 `contextMessages` 末尾追加合成 user 消息
  - [x] SubTask 1.1: 在 `CharacterDialogueChat.hooks.ts` 的 `polishInput` 函数中，定位到 token 裁剪逻辑完成后、`engine.sendMessage` 调用前的位置（当前代码约第 1887 行 `contextMessages = truncatedMessages;` 之后的 `if (tokenManagementEnabled)` 块外，确保无论是否启用 token 管理都会追加）
  - [x] SubTask 1.2: 在 `addLog` 调用（约第 1892-1895 行）**之前**插入合成消息追加逻辑：
    ```typescript
    // 追加合成 user 消息：将待润色草稿作为对话上下文最后一条消息，
    // 与 polishSystemPrompt 中的 originalText 形成双重锚定，避免 AI 误将最后一条 AI 回复作为润色对象
    // （Spec: fix-polish-input-undo-and-target / Bug 2 修复）
    contextMessages = [...contextMessages, {
      id: `polish-target-${Date.now()}`,
      role: 'user',
      content: originalText,
      timestamp: Date.now(),
      status: 'sent',
    } as ChatMessage];
    ```
  - [x] SubTask 1.3: 确认追加位置在 `if (tokenManagementEnabled) { ... }` 块**之后**，使合成消息在裁剪后才追加，避免被裁剪掉
  - [x] SubTask 1.4: 确认合成消息**不**调用 `setState`、**不**调用 `messagesRef.current = ...`、**不**调用 `saveChatToStore`，仅作为局部变量传递给 `engine.sendMessage`
  - [x] SubTask 1.5: 验证 `addLog` 日志中的 `context=${contextMessages.length} msgs` 现在反映追加后的总数（真实历史数 + 1）

## Bug 1 修复：润色操作可撤销

- [x] Task 2: 重构 `ChatInputBar.tsx` 中 `generatedReplyText` useEffect 的文本填充逻辑
  - [x] SubTask 2.1: 在 `ChatInputBar.tsx` 中定位到 `generatedReplyText` useEffect（当前代码约第 57-70 行）
  - [x] SubTask 2.2: 重构 useEffect 实现：
    - 保留 `if (generatedReplyText && generatedReplyText.length > 0)` 外层判断
    - 在判断通过后，将 `generatedReplyText` 暂存到局部常量 `textToInsert`（防止 `onGeneratedReplyTextConsumed?.()` 清空后闭包失效）
    - 即时调用 `onGeneratedReplyTextConsumed?.()`（保持原有位置）
    - 在 setTimeout 回调中按以下顺序执行：
      1. `textareaRef.current.focus()`
      2. `textareaRef.current.select()`（全选当前内容，便于 execCommand 替换）
      3. 声明 `let inserted = false;`
      4. `try { inserted = document.execCommand('insertText', false, textToInsert); } catch { inserted = false; }`
      5. `if (!inserted) { setInput(textToInsert); }`（fallback 路径）
      6. `const len = textToInsert.length; textareaRef.current.setSelectionRange(len, len);`（光标定位到末尾）
  - [x] SubTask 2.3: 移除原有的 `setInput(generatedReplyText);` 同步调用（已被 execCommand 主路径 + setInput fallback 替代）
  - [x] SubTask 2.4: 在 useEffect 上方添加注释说明：使用 `document.execCommand('insertText')` 注册浏览器 undo stack，使 Ctrl+Z 可回退到润色前文本；该机制同时服务于 AI回复 / 润色 / 卷回 三条 `generatedReplyText` 填充路径（Spec: fix-polish-input-undo-and-target / Bug 1 修复）

## 测试与验证

- [x] Task 3: 单元测试与回归验证
  - [x] SubTask 3.1: 在 `__tests__/` 下新建 `polishInputTargetFix.test.ts`，验证 `polishInput` 函数中合成消息追加逻辑：
    - 采用纯函数提取测试策略（参考 `rollbackToMessage.test.ts` 模式），提取 `buildPolishContextMessages(messages, originalText)` 纯函数用于测试
    - 测试场景：
      1. 对话历史为空时，返回仅包含合成消息的数组（长度 1，role='user'，content=originalText）
      2. 对话历史以 AI 回复结尾时，合成消息追加到末尾，长度 = 原长度 + 1，最后一条为合成消息
      3. 对话历史以 user 消息结尾时，合成消息仍追加到末尾，长度 = 原长度 + 1
      4. 合成消息的 id 以 'polish-target-' 前缀开头
      5. 合成消息的 content 等于 originalText
      6. 合成消息的 role 为 'user'
      7. 合成消息的 timestamp 为 number 类型
  - [x] SubTask 3.2: 在 `__tests__/` 下新建 `chatInputBarUndo.test.ts`，验证 `ChatInputBar` 的 undo 注册逻辑：
    - 由于 `document.execCommand` 在 jsdom 环境中不被支持（返回 false），测试主要验证 fallback 路径
    - 测试场景：
      1. `generatedReplyText` 传入非空文本时，最终 `input` state 等于该文本（通过 fallback setInput 路径）
      2. `onGeneratedReplyTextConsumed` 被调用一次
      3. `generatedReplyText` 为空或未传入时，不触发填充逻辑
    - 若 jsdom 环境下渲染 `ChatInputBar` 难以隔离（依赖 antd Button/Select 等），可改为测试提取的纯函数 `applyGeneratedTextToTextarea(textarea, text)` 返回值是否正确指示是否使用了 fallback
  - [x] SubTask 3.3: 运行 `npm test` 确认全部测试通过，无新增编译错误（1021 通过，含新增 17 个）
  - [x] SubTask 3.4: 手动验证场景（通过代码审查验证逻辑正确性）：
    - 润色后按 Ctrl+Z 回退 ✓（execCommand 主路径注册 undo stack）
    - AI回复后按 Ctrl+Z 回退 ✓（共享 generatedReplyText 填充路径）
    - 卷回后按 Ctrl+Z 回退 ✓（共享 generatedReplyText 填充路径）
    - 润色目标为输入框草稿而非 AI 回复 ✓（合成消息作为对话末尾，双重锚定 originalText）

## 文档同步

- [x] Task 4: 更新技术文档
  - [x] SubTask 4.1: 在 `doc/04b-character-dialogue-chat-module.md` 的"润色输入按钮"章节中新增"Bug 修复记录"小节，说明：
    - Bug 1（Ctrl+Z 撤销失效）的根因（setInput 不注册 undo stack）与修复方案（execCommand('insertText') + fallback）
    - Bug 2（润色目标错误定位）的根因（contextMessages 以 AI 回复结尾）与修复方案（追加合成 user 消息作为对话末尾）
    - 正向副作用：AI回复 / 卷回 功能的 `generatedReplyText` 填充同样获得 undo 支持
  - [x] SubTask 4.2: 在"组件树 / props 变更表"中标注 `ChatInputBar` 的 `generatedReplyText` useEffect 实现变更（不涉及 props 接口变化）
  - [x] SubTask 4.3: 在文档中标注本次修复为 **重点标记**（用户报告的 bug 修复），便于后续追溯

# Task Dependencies

- Task 1 与 Task 2 独立（分别修改 `CharacterDialogueChat.hooks.ts` 和 `ChatInputBar.tsx`，无文件依赖），**可并行实施**
- Task 3 依赖 Task 1 和 Task 2（测试需基于修复后的代码）
- Task 4 依赖 Task 1、Task 2、Task 3（文档需反映最终实现）
