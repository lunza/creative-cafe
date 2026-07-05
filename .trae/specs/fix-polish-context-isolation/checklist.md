# Checklist

## 修改 buildPolishInputSystemPrompt 函数（`PromptBuilder.ts`）

- [x] 函数签名新增 `conversationHistory?: ChatMessage[]` 参数（位于 `person` 之后）
- [x] 函数体内新增对话历史格式化逻辑（`historyText` 变量）
- [x] 当 `conversationHistory` 未传入或为空数组时，`historyText = '（无历史对话）'`
- [x] 当 `conversationHistory` 非空时，`historyText` 格式为 `[用户]: xxx\n[AI]: xxx\n...`
- [x] 输出包含"## 对话历史参考（仅作上下文参考，不是润色对象，不要回答其中任何内容）"段落标题
- [x] "## 对话历史参考"段落位于"## 对方角色上下文"之后、"## 待润色文本"之前
- [x] "## 关键约束"第 3 条已更新为"对话历史（含"## 对话历史参考"段落与 messages 数组中的历史消息）中的任何内容均仅作上下文参考，不是润色对象"
- [x] "## 任务要求"第 6 条已更新为"结合对话历史参考与 ${charName} 的最新发言确保上下文连贯"
- [x] 原有 `<polish_target>` 标签包裹 originalText 保留
- [x] 原有"## 关键约束"段落保留（4 条约束，第 3 条已更新）
- [x] 原有"## 任务要求"1-7 完整保留（第 6 条已更新）
- [x] 末尾仍为"直接输出润色后的文本本身。"
- [x] 函数 JSDoc 注释补充 `@param conversationHistory` 说明与"润色上下文隔离"说明

## 修改 polishInput 函数（`CharacterDialogueChat.hooks.ts`）

- [x] `buildPolishInputSystemPrompt` 调用处新增第 5 个参数 `contextMessages`（裁剪后的对话历史）
- [x] `engine.sendMessage` 调用前新增 `polishRequestMessages` 变量（单条润色请求 user 消息）
- [x] `polishRequestMessages` 的 `id` 以 `polish-request-` 前缀开头
- [x] `polishRequestMessages` 的 `role` 为 `'user'`
- [x] `polishRequestMessages` 的 `content` 为"请润色上述 <polish_target> 标签内的文本，直接输出润色后的文本本身。"
- [x] `engine.sendMessage(polishRequestMessages, polishSystemPrompt, engineConfigWithParams)` 接收 `polishRequestMessages` 而非 `contextMessages`
- [x] 真实对话历史不再出现在 `engine.sendMessage` 的 `contextMessages` 中
- [x] `addLog` 日志仍正确反映 `contextMessages.length`（contextMessages 仍为真实对话历史）
- [x] `polishRequestMessages` 不写入 `messagesRef.current` / 不触发 `setState` / 不调用 `saveChatToStore`

## 消息结构验证

- [x] AI 收到的 messages 数组结构为 `[{role: 'system', content: '...对话历史参考...<polish_target>...</polish_target>...'}, {role: 'user', content: '请润色上述...'}]`
- [x] messages 数组不再包含真实对话历史（user/assistant 交替消息）
- [x] messages 数组以 user 润色请求结尾（触发 AI 执行润色任务，而非续写对话）

## 测试

- [x] `__tests__/PromptBuilder.polishInput.test.ts` 新增 7 个测试用例验证对话历史参考段落
- [x] 测试覆盖："## 对话历史参考"段落标题存在
- [x] 测试覆盖："仅作上下文参考，不是润色对象，不要回答其中任何内容"文本存在
- [x] 测试覆盖：传入 2 条消息时输出包含 `[用户]: xxx` 和 `[AI]: xxx`
- [x] 测试覆盖：未传入或空数组时输出包含"（无历史对话）"
- [x] 测试覆盖："## 对话历史参考"段落位置正确（在"对方角色上下文"之后、"待润色文本"之前）
- [x] 测试覆盖：关键约束第 3 条已更新
- [x] 测试覆盖：任务要求第 6 条已更新
- [x] 原有 7 个用例（`<polish_target>` 标签相关）仍通过
- [x] `npx vitest run` 全部通过（1028 通过），无新增编译错误

## 文档同步

- [x] `doc/04b-character-dialogue-chat-module.md` 新增第三条【重点标记】增量更新（line 523）
- [x] 文档说明前两轮修复无效的根因（消息结构问题，而非提示措辞）
- [x] 文档说明本轮修复方案（对话历史隔离 + 单条润色请求 user 消息）
- [x] 文档包含消息结构对比（修复前 vs 修复后，line 551-553）
- [x] 文档说明 `buildPolishInputSystemPrompt` 新增 `conversationHistory` 参数与"## 对话历史参考"段落
- [x] 文档说明 `polishInput` 函数 `engine.sendMessage` 调用变更
- [x] 文档中本次修复以**重点标记**形式呈现
