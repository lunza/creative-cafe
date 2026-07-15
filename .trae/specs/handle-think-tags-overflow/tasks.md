# Tasks

- [x] Task 1: 扩展 `AIParameterConfig` 接口，新增 `strip_think_tags` 字段
  - [x] SubTask 1.1: 在 `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` 的 `AIParameterConfig` 接口中，紧跟 `emoji_enhanced?: boolean;` 之后新增 `strip_think_tags?: boolean;` 字段，附 JSDoc 说明（默认开启语义、针对 deepseek3.2、AI 回复 / 润色后剥离）

- [x] Task 2: 在 `requestAIResponse.onComplete` 中应用剥离
  - [x] SubTask 2.1: 在 `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` 的 `requestAIResponse` 中导入 `stripThinkingTags`（来自 `./utils/messageProcessor`）
  - [x] SubTask 2.2: 在 `displayContent = finalContent;` 赋值前（约 line 1084 附近，位于 tableEdit 剥离逻辑之前），增加判断：当 `characterConfig?.customParameters?.strip_think_tags !== false` 时，对 `finalContent` 调用 `stripThinkingTags` 并重新赋值 `finalContent = stripThinkingTags(finalContent)`
  - [x] SubTask 2.3: 确认 `finalContent` 被剥离后，后续 `displayContent`、`saveChatToStore`、向量化、回传上下文、长度诊断均使用剥离后内容

- [x] Task 3: 在 `polishInput.onComplete` 中应用剥离
  - [x] SubTask 3.1: 在 `polishInput` 函数内（约 line 1948 附近）的 `engine.onComplete` 回调中，在 `resolve(finalContent)` 之前增加判断：当 `characterConfig?.customParameters?.strip_think_tags !== false` 时，执行 `finalContent = stripThinkingTags(finalContent)`
  - [x] SubTask 3.2: 验证润色返回给调用方的文本不再含 think 标签（代码审查确认 `resolve(finalContent)` 使用剥离后的 `finalContent`）

- [x] Task 4: 在 `ParameterPanel` 新增 Switch UI
  - [x] SubTask 4.1: 在 `ParameterPanel.tsx` 的 props 接口中新增 `stripThinkTags: boolean;` 与 `onStripThinkTagsToggle: (enabled: boolean) => void;`
  - [x] SubTask 4.2: 在 "Emoji 增强模式" Switch 区块之后、"自定义停止序列" 区块之前，插入新的 "Think 标签处理" Switch 区块，完全复用 emoji 区块的样式（dashed borderTop、label-group、Tooltip + QuestionCircleOutlined、Switch size="small"）
  - [x] SubTask 4.3: Tooltip 文案："开启后，AI 完成回复或润色后自动剥离 think、thinking、thought 等推理标签内容（针对 deepseek3.2 等老模型）。默认开启。剥离发生在写入存储前，避免污染历史与上下文。"

- [x] Task 5: 在 `ConfigPanel` 透传 props
  - [x] SubTask 5.1: 在 `ConfigPanel.tsx` 的 props 接口中新增 `stripThinkTags` / `onStripThinkTagsToggle`
  - [x] SubTask 5.2: 将这两个 props 透传给内部渲染的 `ParameterPanel`

- [x] Task 6: 在 `CharacterDialogueChat.tsx` 接入状态与 props 传递
  - [x] SubTask 6.1: 在 `CharacterDialogueChat.tsx` 渲染 `ConfigPanel` 处，新增 `stripThinkTags={characterConfig?.customParameters?.strip_think_tags !== false}` 与 `onStripThinkTagsToggle={(enabled) => handleParameterChange({ strip_think_tags: enabled })}`（沿用 `emojiEnhanced` 的写法）

- [x] Task 7: 验证与回归
  - [x] SubTask 7.1: 类型检查通过（`npm run typecheck` 或等价命令），确认未引入新 TS 错误（输出中无 CharacterDialogueChat.types.ts / hooks.ts / tsx / ParameterPanel.tsx / ConfigPanel.tsx 相关错误，剩余均为预存错误）
  - [ ] SubTask 7.2: 手动验证：默认状态下 Switch 显示为开启；切换为关闭后刷新页面仍保持关闭状态（localStorage 持久化生效）——需用户手动验证
  - [ ] SubTask 7.3: 手动验证：使用会返回 think 标签的模型（或 mock）发送 AI 请求，确认开启时存储的 `messages.json` 不含 think 标签；关闭时存储仍含标签但渲染干净——需用户手动验证
  - [ ] SubTask 7.4: 手动验证：润色一段含 think 标签的文本，确认开启时返回结果已剥离；关闭时返回原始文本——需用户手动验证
  - [x] SubTask 7.5: 确认流式渲染过程不受影响（代码审查确认 `onStream` 回调未做剥离，仅 `onComplete` 时剥离）

# Task Dependencies
- Task 2、Task 3 依赖 Task 1（接口字段）
- Task 4 独立，可与 Task 2/3 并行
- Task 5 依赖 Task 4
- Task 6 依赖 Task 5
- Task 7 依赖全部
