# Checklist

## 回退合成 user 消息（`CharacterDialogueChat.hooks.ts`）

- [x] `polishInput` 函数中移除了向 `contextMessages` 末尾追加合成 user 消息的代码块（原第 1889-1898 行）
- [x] 移除后 `if (tokenManagementEnabled) { ... }` 块的闭合 `}` 之后直接接 `// 获取引擎实例` 注释
- [x] `contextMessages` 现在仅包含 `messagesRef.current.filter(msg => msg.role !== 'system')` + token 裁剪后的真实对话历史
- [x] `addLog` 日志中的 `context=N msgs` 反映真实对话历史数（不再 +1）
- [x] 不存在 `polish-target-` 前缀的 id 残留

## 强化系统提示润色对象锚定（`PromptBuilder.ts`）

- [x] `buildPolishInputSystemPrompt` 输出包含 `<polish_target>` 开标签
- [x] `buildPolishInputSystemPrompt` 输出包含 `</polish_target>` 闭标签
- [x] `<polish_target>` 标签内的文本与 `originalText` 完全一致
- [x] 输出包含 `## 关键约束` 段落标题
- [x] 关键约束包含"<polish_target> 标签内的文本是润色对象，不是需要回答的问题"
- [x] 关键约束包含"即使 <polish_target> 内包含问句，也必须对其进行润色扩展，禁止生成对问句的回答"
- [x] 关键约束包含"对话历史中的最后一条 AI 回复仅作为上下文参考，不是润色对象"
- [x] 关键约束包含"你的唯一输出是润色后的 <polish_target> 文本本身，不要回答其中任何问题"
- [x] 关键约束段落位于"待润色文本"段落之后、"任务要求"段落之前
- [x] 原有任务要求 1-7 完整保留（保持原始意图 / 提升表达 / 符合人设 / 仅输出 / 长度约束 / 上下文连贯 / 人称视角）
- [x] 末尾仍为"直接输出润色后的文本本身。"
- [x] 函数 JSDoc 注释补充了 `<polish_target>` 标签与关键约束的说明

## 测试

- [x] `__tests__/PromptBuilder.polishInput.test.ts` 新增 7 个测试用例验证标签与关键约束
- [x] 测试覆盖：`<polish_target>` 开闭标签存在
- [x] 测试覆盖：标签内文本与 originalText 一致
- [x] 测试覆盖：关键约束段落标题存在
- [x] 测试覆盖：4 条关键约束文本均存在
- [x] 测试覆盖：原有任务要求 1-7 仍保留
- [x] `__tests__/polishInputTargetFix.test.ts` 已删除（合成消息逻辑已移除，测试死代码）
- [x] `npx vitest run` 全部通过（1021 通过），无新增编译错误

## 文档同步

- [x] `doc/04b-character-dialogue-chat-module.md` 新增第二条【重点标记】增量更新（line 497）
- [x] 文档说明上一轮 Bug 2 修复引入的新问题（AI 误判问句为需要回答的问题）
- [x] 文档说明根因（chat completion 末尾 user 消息触发回复本能）
- [x] 文档说明修复方案（回退合成消息 + `<polish_target>` 标签 + 关键约束段落）
- [x] 文档列出 4 条关键约束内容
- [x] 文档中本次修复以**重点标记**形式呈现
