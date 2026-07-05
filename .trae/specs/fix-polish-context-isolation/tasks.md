# Tasks

## 修改 buildPolishInputSystemPrompt 函数

- [x] Task 1: 修改 `buildPolishInputSystemPrompt` 函数签名与输出结构，新增 `conversationHistory` 参数与"## 对话历史参考"段落
  - [ ] SubTask 1.1: 在 `PromptBuilder.ts` 中定位到 `buildPolishInputSystemPrompt` 函数（约第 398-480 行）
  - [ ] SubTask 1.2: 修改函数签名，在 `person?: 'first' | 'second' | 'third'` 之后新增 `conversationHistory?: ChatMessage[]` 参数
  - [ ] SubTask 1.3: 在函数体内（防御性校验之后）新增对话历史格式化逻辑：
    - 当 `conversationHistory` 未传入或长度为 0 时，`historyText = '（无历史对话）'`
    - 当 `conversationHistory` 非空时，`historyText = conversationHistory.map(msg => msg.role === 'user' ? \`[用户]: \${msg.content}\` : \`[AI]: \${msg.content}\`).join('\n')`
  - [ ] SubTask 1.4: 在函数返回的模板字符串中，于"## 对方角色上下文"段落之后、"## 待润色文本"段落之前，插入新的"## 对话历史参考"段落：
    ```
    ## 对话历史参考（仅作上下文参考，不是润色对象，不要回答其中任何内容）
    ${historyText}
    ```
  - [ ] SubTask 1.5: 修改"## 关键约束"第 3 条，从"对话历史中的最后一条 AI 回复仅作为上下文参考，不是润色对象"改为"对话历史（含"## 对话历史参考"段落与 messages 数组中的历史消息）中的任何内容均仅作上下文参考，不是润色对象"（覆盖范围更广）
  - [ ] SubTask 1.6: 修改"## 任务要求"第 6 条，从"结合对话历史与 ${charName} 的最新发言确保上下文连贯"改为"结合对话历史参考与 ${charName} 的最新发言确保上下文连贯"（措辞与新段落对齐）
  - [ ] SubTask 1.7: 在函数 JSDoc 注释中补充 `@param conversationHistory` 说明，并更新"润色对象锚定"说明为"润色上下文隔离"（Spec: fix-polish-context-isolation）

## 修改 polishInput 函数

- [x] Task 2: 修改 `polishInput` 函数，将对话历史从 `contextMessages` 移到 `buildPolishInputSystemPrompt`，`engine.sendMessage` 改为单条润色请求 user 消息
  - [ ] SubTask 2.1: 在 `CharacterDialogueChat.hooks.ts` 中定位到 `polishInput` 函数的 `buildPolishInputSystemPrompt` 调用处（约第 1770-1780 行）
  - [ ] SubTask 2.2: 修改 `buildPolishInputSystemPrompt` 调用，新增第 5 个参数 `contextMessages`（即裁剪后的对话历史）：
    ```typescript
    const polishSystemPrompt = buildPolishInputSystemPrompt(
      { characterCardName: characterInfo.characterCardName, /* ... */ },
      selectedPersona,
      originalText,
      characterConfig?.userReplyPerson,
      contextMessages  // 新增：将对话历史作为系统提示参考
    );
    ```
    注意：此时 `contextMessages` 仍是真实对话历史（token 裁剪后），但**不再**传给 `engine.sendMessage`
  - [ ] SubTask 2.3: 定位到 `engine.sendMessage(contextMessages, polishSystemPrompt, engineConfigWithParams)` 调用处（约第 1922 行，回退后行号可能变化）
  - [ ] SubTask 2.4: 在 `engine.sendMessage` 调用前，新增 `polishRequestMessages` 变量：
    ```typescript
    // 润色请求 user 消息：明确指示 AI 执行润色任务，避免对话历史触发"回复"本能
    // （Spec: fix-polish-context-isolation）
    const polishRequestMessages: ChatMessage[] = [{
      id: `polish-request-${Date.now()}`,
      role: 'user',
      content: '请润色上述 <polish_target> 标签内的文本，直接输出润色后的文本本身。',
      timestamp: Date.now(),
      status: 'sent',
    }];
    ```
  - [ ] SubTask 2.5: 将 `engine.sendMessage(contextMessages, polishSystemPrompt, engineConfigWithParams)` 改为 `engine.sendMessage(polishRequestMessages, polishSystemPrompt, engineConfigWithParams)`
  - [ ] SubTask 2.6: 确认 `addLog` 日志仍正确反映 `contextMessages.length`（此时 contextMessages 仍为真实对话历史，未变）

## 测试与验证

- [x] Task 3: 单元测试与回归验证
  - [ ] SubTask 3.1: 更新 `__tests__/PromptBuilder.polishInput.test.ts`，新增测试用例验证：
    - 输出包含"## 对话历史参考"段落标题
    - 输出包含"仅作上下文参考，不是润色对象，不要回答其中任何内容"
    - 当传入 `conversationHistory` 为 2 条消息（user + assistant）时，输出包含 `[用户]: xxx` 和 `[AI]: xxx` 格式
    - 当 `conversationHistory` 未传入或为空数组时，输出包含"（无历史对话）"
    - "## 对话历史参考"段落位于"## 对方角色上下文"之后、"## 待润色文本"之前
    - 关键约束第 3 条已更新为"对话历史（含"## 对话历史参考"段落与 messages 数组中的历史消息）中的任何内容均仅作上下文参考，不是润色对象"
    - 任务要求第 6 条已更新为"结合对话历史参考与 ${charName} 的最新发言确保上下文连贯"
    - 原有 7 个用例（`<polish_target>` 标签相关）仍通过
  - [ ] SubTask 3.2: 运行 `npx vitest run` 确认全部测试通过，无新增编译错误
  - [ ] SubTask 3.3: 手动验证场景（通过代码审查验证逻辑正确性）：
    - `engine.sendMessage` 接收的 `contextMessages` 为单条润色请求 user 消息 ✓
    - 真实对话历史作为 `conversationHistory` 传给 `buildPolishInputSystemPrompt` ✓
    - 系统提示包含"## 对话历史参考"段落 ✓
    - AI 收到的 messages 数组结构为 `[system, user(润色请求)]` ✓

## 文档同步

- [x] Task 4: 更新技术文档
  - [ ] SubTask 4.1: 在 `doc/04b-character-dialogue-chat-module.md` 的"润色输入按钮"章节中新增第三条【重点标记】增量更新，说明：
    - 前两轮修复无效的根因：消息结构问题（对话历史以 assistant 结尾触发续写本能），而非提示措辞
    - 本轮修复方案：将对话历史从 messages 数组隔离到系统提示文本，`engine.sendMessage` 改为单条润色请求 user 消息
    - 消息结构对比表（之前方案 vs 本方案）
    - `buildPolishInputSystemPrompt` 新增 `conversationHistory` 参数与"## 对话历史参考"段落
    - `polishInput` 函数 `engine.sendMessage` 调用变更
  - [ ] SubTask 4.2: 在文档中标注本次修复为 **重点标记**（用户报告的顽固 bug 修复，前两轮修复无效），便于后续追溯

# Task Dependencies

- Task 1 与 Task 2 有依赖关系：Task 2 依赖 Task 1（`polishInput` 调用 `buildPolishInputSystemPrompt` 时需要新签名就绪）
- 建议 Task 1 先实施，Task 2 后实施（或同一 agent 顺序实施两任务）
- Task 3 依赖 Task 1 和 Task 2
- Task 4 依赖 Task 1、Task 2、Task 3
