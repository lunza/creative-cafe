# Tasks

- [x] Task 1: 类型定义与提示词构建函数
  - [x] SubTask 1.1: 在 `CharacterDialogueChat.types.ts` 的 `AIParameterConfig` 接口中添加 `assist_mode?: boolean` 字段，添加注释说明默认关闭
  - [x] SubTask 1.2: 在 `ChatMessage` 接口中添加 `suggestedOptions?: string[]` 字段，用于存储 AI 生成的推荐选项
  - [x] SubTask 1.3: 在 `PromptBuilder.ts` 中新增 `buildAssistModePrompt(charName: string): string` 函数，生成辅助模式系统提示词约束，要求 AI 在回复正文末尾以 `<!-- <suggestedOptions>` 格式输出 3 个推荐选项

- [x] Task 2: 配置面板开关 UI
  - [x] SubTask 2.1: 在 `ParameterPanel.tsx` 中添加 `assistMode` 和 `onAssistModeToggle` props 声明与解构
  - [x] SubTask 2.2: 在 `ParameterPanel.tsx` 的自定义停止序列区块之后添加"辅助模式"开关 UI，复用现有 Switch 布局模式（参考 Emoji 增强模式开关），包含 Tooltip 说明文字
  - [x] SubTask 2.3: 在 `ConfigPanel.tsx` 中添加 `assistMode` 和 `onAssistModeToggle` props 声明、解构，并透传给 ParameterPanel
  - [x] SubTask 2.4: 在 `CharacterDialogueChat.tsx` 的 ConfigPanel 调用处添加 `assistMode={characterConfig?.customParameters?.assist_mode === true}` 和 `onAssistModeToggle` 回调（通过 handleParameterChange 传递 `{ assist_mode: enabled }`）

- [x] Task 3: 提示词注入与选项解析
  - [x] SubTask 3.1: 在 `CharacterDialogueChat.hooks.ts` 的 `requestAIResponse` 函数中，Emoji 增强模式注入之后，当 `assist_mode === true` 时调用 `buildAssistModePrompt` 并拼接到 effectiveSystemPrompt 末尾
  - [x] SubTask 3.2: 在 `CharacterDialogueChat.hooks.ts` 的 `engine.onComplete` 回调中，Think 标签剥离之后、表格整理命令检测之前，添加选项解析逻辑：用正则匹配 `<!-- <suggestedOptions>([\s\S]*?)</suggestedOptions> -->` 格式的选项块
  - [x] SubTask 3.3: 解析选项块内容，按行分割提取 3 个选项文本（去除编号前缀如 "1. "、"2. " 等），存入局部变量 `suggestedOptions: string[]`
  - [x] SubTask 3.4: 从 `displayContent` / `finalContent` 中剥离选项块（用户不可见），确保正文无残留标记
  - [x] SubTask 3.5: 在最终 setState 更新消息时，将 `suggestedOptions` 写入 AI 消息对象的 `suggestedOptions` 字段

- [x] Task 4: 选项渲染与交互
  - [x] SubTask 4.1: 在 `ChatMessageBubble.tsx` 的 Props 中添加 `onSelectOption?: (optionText: string) => void` 回调
  - [x] SubTask 4.2: 在 `ChatMessageBubble.tsx` 中，AI 消息的 MessageRenderer 之后、流式光标之后，当 `message.suggestedOptions` 非空且非流式状态时，渲染选项按钮列表（卡片式布局，带编号标识）
  - [x] SubTask 4.3: 选项按钮点击时调用 `onSelectOption(optionText)`，由父组件处理填入输入框逻辑
  - [x] SubTask 4.4: 在 `CharacterDialogueChat.tsx` 中实现 `handleSelectOption` 回调，将选项文本通过 `generatedReplyText` 机制填入输入框（复用现有机制）
  - [x] SubTask 4.5: 在 `CharacterDialogueChat.tsx` 消息列表渲染处将 `onSelectOption` 传递给 ChatMessageBubble

- [x] Task 5: 样式实现
  - [x] SubTask 5.1: 在 `ChatMessageBubble.css` 中添加推荐选项按钮的样式类（`.suggested-options-container`、`.suggested-option-item` 等），采用卡片式设计，与消息正文有明显视觉区分，支持响应式布局

# Task Dependencies
- [Task 2] 依赖 [Task 1]（类型定义需先完成）
- [Task 3] 依赖 [Task 1]（提示词函数和类型需先完成）
- [Task 4] 依赖 [Task 1]（ChatMessage 类型需先完成）和 [Task 3]（选项数据需先解析存储）
- [Task 5] 与 [Task 4] 可并行，但 [Task 4] 完成后需验证 [Task 5] 样式效果
