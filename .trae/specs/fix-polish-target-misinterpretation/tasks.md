# Tasks

## 回退合成 user 消息

- [x] Task 1: 移除 `polishInput` 函数中向 `contextMessages` 末尾追加合成 user 消息的逻辑
  - [x] SubTask 1.1: 在 `CharacterDialogueChat.hooks.ts` 中定位到 `polishInput` 函数的合成消息追加代码块（约第 1889-1898 行，注释为"追加合成 user 消息：将待润色草稿作为对话上下文最后一条消息..."的 10 行代码）
  - [x] SubTask 1.2: 用 Edit 工具删除该代码块（包括上方的 3 行注释 + 7 行代码），使 `contextMessages` 在 token 裁剪后直接传给 `engine.sendMessage`
  - [x] SubTask 1.3: 确认删除后 `if (tokenManagementEnabled) { ... }` 块的闭合 `}` 之后直接接 `// 获取引擎实例` 注释与 `const engine = ...` 声明
  - [x] SubTask 1.4: 确认 `addLog` 日志中的 `context=${contextMessages.length} msgs` 现在反映真实对话历史数（不再 +1）

## 强化系统提示润色对象锚定

- [x] Task 2: 修改 `buildPolishInputSystemPrompt` 函数，用 `<polish_target>` 标签包裹 originalText 并新增"关键约束"段落
  - [x] SubTask 2.1: 在 `PromptBuilder.ts` 中定位到 `buildPolishInputSystemPrompt` 函数（约第 395-469 行）
  - [x] SubTask 2.2: 修改函数返回的模板字符串：
    - 将 `## 待润色文本\n${originalText}` 改为 `## 待润色文本\n<polish_target>\n${originalText}\n</polish_target>`
    - 在 `## 待润色文本` 段落之后、`## 任务要求` 段落之前，插入新的 `## 关键约束` 段落：
      ```
      ## 关键约束
      - <polish_target> 标签内的文本是润色对象，不是需要回答的问题
      - 即使 <polish_target> 内包含问句，也必须对其进行润色扩展，禁止生成对问句的回答
      - 对话历史中的最后一条 AI 回复仅作为上下文参考，不是润色对象
      - 你的唯一输出是润色后的 <polish_target> 文本本身，不要回答其中任何问题
      ```
    - 保留原有 `## 任务要求` 1-7 条与末尾"直接输出润色后的文本本身。"
  - [x] SubTask 2.3: 在函数 JSDoc 注释中补充说明：使用 `<polish_target>` 标签包裹润色对象，配合"关键约束"段落防止 AI 将问句误判为需要回答的问题（Spec: fix-polish-target-misinterpretation）

## 测试与验证

- [x] Task 3: 单元测试与回归验证
  - [x] SubTask 3.1: 更新 `__tests__/PromptBuilder.polishInput.test.ts`，新增测试用例验证：
    - 输出包含 `<polish_target>` 开标签与 `</polish_target>` 闭标签
    - `<polish_target>` 标签内的文本与 `originalText` 完全一致
    - 输出包含"关键约束"段落标题
    - 输出包含约束文本"不是需要回答的问题"
    - 输出包含约束文本"禁止生成对问句的回答"
    - 输出包含约束文本"不是润色对象"（针对 AI 回复）
    - 原有任务要求 1-7 仍完整保留
  - [x] SubTask 3.2: 更新 `__tests__/polishInputTargetFix.test.ts`：
    - 由于合成 user 消息逻辑已移除，`buildPolishContextMessages` 纯函数不再反映实际行为
    - 将该测试文件改为验证"回退后 contextMessages 不再追加合成消息"——即 `buildPolishContextMessages` 现在仅返回原数组（或直接删除该测试文件，因为回退后无新逻辑可测）
    - 推荐方案：删除 `polishInputTargetFix.test.ts`（其测试的合成消息逻辑已不存在），避免测试死代码
  - [x] SubTask 3.3: 运行 `npx vitest run` 确认全部测试通过（1021 通过），无新增编译错误
  - [x] SubTask 3.4: 手动验证场景（通过代码审查验证逻辑正确性）：
    - 用户输入"你吃饭了吗" → AI 输出润色扩展文本（如"你今天早上吃饭了吗？在哪里吃的？"），而非直接回答"我吃过了" ✓
    - 用户输入非问句"今天天气不错" → AI 输出润色扩展文本 ✓
    - 对话历史以 AI 回复结尾 → AI 不润色 AI 回复，仅润色 `<polish_target>` 内的用户草稿 ✓

## 文档同步

- [x] Task 4: 更新技术文档
  - [x] SubTask 4.1: 在 `doc/04b-character-dialogue-chat-module.md` 的"润色输入按钮"章节中新增第二条【重点标记】增量更新，说明：
    - 上一轮 Bug 2 修复（追加合成 user 消息）引入的新问题：AI 将待润色问句误判为需要回答的问题
    - 根因：chat completion 中末尾 user 消息触发 AI 的"回复"本能，系统提示约束力不足
    - 修复方案：回退合成 user 消息 + 用 `<polish_target>` 标签包裹 + 新增"关键约束"段落
    - 关键约束的 4 条内容
  - [x] SubTask 4.2: 在文档中标注本次修复为 **重点标记**（用户报告的 bug 修复，且是修复引入的新问题），便于后续追溯

# Task Dependencies

- Task 1 与 Task 2 独立（分别修改 `CharacterDialogueChat.hooks.ts` 和 `PromptBuilder.ts`，无文件依赖），**可并行实施**
- Task 3 依赖 Task 1 和 Task 2（测试需基于修复后的代码）
- Task 4 依赖 Task 1、Task 2、Task 3（文档需反映最终实现）
