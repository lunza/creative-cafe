# 辅助模式（Assist Mode）Spec

## Why
当前对话模式下，用户每次需要手动输入全部内容，缺乏对话推进的引导性。添加"辅助模式"开关后，AI 在常规回答之外额外生成 3 个推荐选项（类似 Galgame 剧情选项），用户可一键选择或在此基础上润色，降低输入负担并引导对话向有意义的方向发展。

## What Changes
- 在 AI 参数配置面板（ParameterPanel）中新增"辅助模式"开关，默认关闭
- 开启后，系统提示词末尾注入辅助模式约束，要求 AI 在回复正文后以结构化格式输出 3 个推荐选项
- AI 回复完成后，自动解析并剥离选项块，存入 `ChatMessage.suggestedOptions` 字段
- ChatMessageBubble 在 AI 消息下方渲染推荐选项按钮，视觉风格区别于正文（Galgame 风格卡片式按钮）
- 用户点击选项后，选项文本填入输入框（复用 generatedReplyText 机制），用户可润色后发送

## Impact
- Affected specs: 无直接影响的已有 spec
- Affected code:
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — 类型定义
  - `src/renderer/components/Character/CharacterDialogueChat/ParameterPanel.tsx` — 开关 UI
  - `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` — Props 透传
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — Props 传递 + 选项点击处理
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — 提示词注入 + 选项解析
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts` — 辅助模式提示词构建函数
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` — 选项渲染 + 点击交互
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.css` — 选项样式
  - `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.css` — 开关样式（如需）

## ADDED Requirements

### Requirement: 辅助模式开关
系统 SHALL 在对话模式的 AI 参数配置面板中提供一个名为"辅助模式"的开关按钮，默认关闭。

#### Scenario: 开启辅助模式
- **WHEN** 用户打开"辅助模式"开关
- **THEN** 系统立即激活对话辅助功能，后续每次 AI 响应均包含 3 个推荐选项
- **AND** 开关状态持久化到 localStorage（通过 customParameters.assist_mode）

#### Scenario: 关闭辅助模式
- **WHEN** 用户关闭"辅助模式"开关
- **THEN** 系统恢复标准对话模式，AI 响应不包含推荐选项
- **AND** 已有消息中的历史选项仍然保留显示

### Requirement: AI 推荐选项生成
系统 SHALL 在辅助模式开启时，通过系统提示词约束 AI 在回复正文后以结构化格式输出恰好 3 个推荐选项。

#### Scenario: AI 正常生成选项
- **WHEN** 辅助模式开启且 AI 正常完成回复
- **THEN** AI 回复正文后附带 3 个与当前对话上下文高度相关的推荐选项
- **AND** 选项内容具有明确的对话导向性，引导对话流程分支
- **AND** 选项以清晰编号标识（1/2/3）

#### Scenario: AI 未生成选项或格式异常
- **WHEN** 辅助模式开启但 AI 回复中未包含有效选项块
- **THEN** 系统静默处理，不显示选项区域，不影响正常回复展示

### Requirement: 选项解析与存储
系统 SHALL 在 AI 回复完成后，自动从回复内容中解析选项块并剥离，将纯文本选项存入消息对象。

#### Scenario: 成功解析选项
- **WHEN** AI 回复包含符合格式的选项块
- **THEN** 系统从回复内容中剥离选项块（用户不可见），将正文内容存入 message.content
- **AND** 将解析出的 3 个选项文本存入 message.suggestedOptions 数组
- **AND** 剥离后的正文不包含任何选项标记残留

### Requirement: 选项渲染与交互
系统 SHALL 在 AI 消息气泡下方渲染推荐选项按钮，并提供点击填入输入框的交互。

#### Scenario: 渲染选项
- **WHEN** AI 消息的 suggestedOptions 字段非空
- **THEN** 在消息正文下方渲染 3 个选项按钮，采用卡片式布局
- **AND** 选项按钮与正文有明确视觉区分（边框、背景色、编号标识）
- **AND** 选项按编号顺序纵向排列，清晰有序

#### Scenario: 用户点击选项
- **WHEN** 用户点击某个推荐选项
- **THEN** 选项文本填入输入框，用户可进一步编辑或直接发送
- **AND** 输入框获得焦点，便于用户立即润色

#### Scenario: 流式生成中
- **WHEN** AI 正在流式生成回复（isStreaming=true）
- **THEN** 不显示推荐选项，仅在回复完成后展示
