# 添加 AI 用户回复生成按钮 Spec

## Why

对话模式中，用户每次都需要手动输入回复，体验单调且容易卡壳。当用户希望快速推进剧情或不知道如何回应角色时，缺少"AI 代入用户人设生成回复"的辅助能力。本 spec 在 ChatInputBar 的 Send Message 按钮左侧新增"AI回复"按钮，点击后以当前用户人设为基准，结合对话历史与角色上下文，自动生成一段符合用户人设的对话内容填入输入框（用户可编辑后再发送）。

## What Changes

### UI 层
- 在 `ChatInputBar.tsx` 的 Send Message 按钮**左侧**新增"AI回复"按钮（`RobotOutlined` 图标），与 Send 按钮同一行布局
- 按钮三态：正常（紫色渐变）、生成中（loading 旋转图标 + 禁用）、禁用（流式生成中 / 整理中 / 无有效人设 / 无活动 AI 引擎）
- Tooltip 提示："以当前用户人设生成对话回复"
- 点击后**仅填充输入框**，不自动发送——用户可编辑后再点 Send

### 业务逻辑层
- 在 `useCharacterDialogueChat` hook 中新增 `generateUserReply(): Promise<string>` 方法
  - 复用 `getEffectiveParams()`、`getActiveEngineConfig()`、`ChatEngineFactory` 等现有基础设施
  - 复用 `ContextTruncator` 进行上下文裁剪（避免长对话超出 token 限制）
  - 流式接收 AI 回复，临时累积到 ref，完成后返回完整字符串
  - 生成过程中设置 `isGeneratingUserReply` 状态（用于 UI loading 显示和 Send 按钮禁用）
- 新增 `isGeneratingUserReply` 状态暴露给外部组件

### 提示词层
- 在 `PromptBuilder.ts` 新增 `buildUserReplySystemPrompt(characterInfo, persona)` 函数：
  - 系统角色：让 AI 扮演"用户人设模拟器"，**仅**生成用户侧的下一句回复
  - 包含 `selectedPersona.name` 与 `selectedPersona.description`（用户人设）
  - 包含 `characterInfo.characterCardName` 与简短 `characterCardContent`/`personality`（对方角色上下文）
  - 明确约束："只输出 {{user}} 的下一句回复，不要输出 {{char}} 的回复，不要解释，不要引号包裹"
  - 复用现有的 `buildLengthGuidancePrompt` 反向约束——此次反而要约束**上限**（用户回复通常较短，建议 50-200 字），避免生成超长内容
- 在 `PromptBuilder.ts` 新增 `buildStopSequencesForUserReply(charName, customStops?)` 函数：
  - 与现有 `buildStopSequences` 对称——此次以**角色名变体**为停止序列，防止 AI 越权生成角色回复
  - 返回 `[\n\n{{char}}:, \n\n{{char}}：, \n\n${charName}:, \n\n${charName}：, \n{{char}}:, \n{{char}}：, \n${charName}:, \n${charName}：]`（双换行优先 + 单换行兜底，与 Task 6 风格一致）

### 状态机
- `isGeneratingUserReply=true` 时：
  - "AI回复"按钮显示 loading 图标并禁用
  - Send Message 按钮禁用
  - textarea 禁用（避免用户在生成中输入造成冲突）
  - cancelRequest 可终止生成
- 生成完成后：
  - 释放上述禁用
  - 自动聚焦 textarea，光标定位到末尾，便于用户立即编辑

## Impact

- **Affected specs**: 无直接冲突；与 `optimize-chat-ai-intelligence`、`fix-ai-response-length-degradation` 共享 AI 引擎调用与提示词构建基础设施
- **Affected code**:
  - `src/renderer/components/Character/CharacterDialogueChat/ChatInputBar.tsx`（新增按钮 + 接收填充文本的 prop）
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx`（透传 `onGenerateUserReply` / `isGeneratingUserReply` / `cancelRequest`）
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（新增 `generateUserReply` 函数 + `isGeneratingUserReply` 状态 + `generateUserReplyAbortRef`）
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（新增 `buildUserReplySystemPrompt` + `buildStopSequencesForUserReply`）

## ADDED Requirements

### Requirement: AI 用户回复生成按钮
系统 SHALL 在 ChatInputBar 的 Send Message 按钮**左侧**提供"AI回复"按钮，点击后调用 AI 模型以当前用户人设为基准生成下一句用户侧对话内容，并填充到消息输入框中（不自动发送）。

#### Scenario: 正常生成用户回复
- **WHEN** 用户点击"AI回复"按钮且当前未在流式生成 / 未在整理表格 / 已配置活动 AI 引擎 / 已选择用户人设
- **THEN** 按钮显示 loading 旋转图标，Send 按钮与 textarea 进入禁用状态
- **AND** 系统以 `buildUserReplySystemPrompt` 构建的系统提示调用 AI 模型，流式接收回复
- **AND** 生成完成后，将完整文本填入 textarea，自动聚焦并将光标置于文本末尾
- **AND** 释放 Send 按钮 / textarea 的禁用状态

#### Scenario: 缺少前置条件
- **WHEN** 用户点击"AI回复"但未选择用户人设（`selectedPersona` 为 null）
- **THEN** 显示 `message.warning('请先在右侧面板选择用户人设')` 提示，不发起 AI 请求
- **WHEN** 用户点击"AI回复"但无活动 AI 引擎
- **THEN** 显示 `message.warning('请先在设置中配置AI引擎')` 提示，不发起 AI 请求

#### Scenario: 生成中取消
- **WHEN** `isGeneratingUserReply=true` 时用户点击"AI回复"按钮（按钮此时为停止态）
- **THEN** 调用 `engine.cancelRequest()` 终止当前生成
- **AND** 已累积的部分文本**不**填入 textarea（避免半截回复），恢复按钮为正常态

#### Scenario: 流式生成中禁用
- **WHEN** `state.isStreaming=true`（AI 角色回复生成中）或 `isOrganizing=true`（表格整理中）
- **THEN** "AI回复"按钮显示为禁用态，点击无响应

### Requirement: 用户回复专用系统提示
系统 SHALL 通过 `buildUserReplySystemPrompt(characterInfo, persona)` 函数构建专用系统提示，明确指示 AI 仅生成用户侧的下一句回复。

#### Scenario: 系统提示内容
- **WHEN** 调用 `buildUserReplySystemPrompt`
- **THEN** 输出包含以下段落：
  - 角色定义："你是对话模拟器，需要扮演用户 **{{user}}** 生成下一句回复"
  - 用户人设：`selectedPersona.name` + `selectedPersona.description`
  - 对方角色上下文：`characterCardName` + 简短 `personality`（如存在）
  - 明确约束："只输出 {{user}} 的回复，不要输出 {{char}} 的回复，不要解释、不要引号、不要前缀"
  - 长度约束：50-200 字（用户回复通常较短）

### Requirement: 用户回复专用停止序列
系统 SHALL 通过 `buildStopSequencesForUserReply(charName, customStops?)` 函数构建停止序列，使用角色名变体防止 AI 越权生成角色回复。

#### Scenario: 默认停止序列
- **WHEN** 调用 `buildStopSequencesForUserReply('艾莉')` 无 customStops
- **THEN** 返回 8 项数组：4 项 `\n\n` 双换行前缀（`\n\n艾莉:`, `\n\n艾莉：`, `\n\n{{char}}:`, `\n\n{{char}}：`）+ 4 项 `\n` 单换行前缀
- **AND** 双换行优先匹配段落分隔，单换行作为兜底（与 `buildStopSequences` 风格一致）

### Requirement: 生成状态可见性
系统 SHALL 通过 `isGeneratingUserReply` 状态向 UI 暴露用户回复生成进度。

#### Scenario: 状态切换
- **WHEN** `generateUserReply()` 调用开始
- **THEN** `isGeneratingUserReply=true`，触发 ChatInputBar 按钮态切换
- **WHEN** 生成完成（成功或失败）
- **THEN** `isGeneratingUserReply=false`，恢复按钮态

## MODIFIED Requirements

### Requirement: ChatInputBar 组件接口
`ChatInputBar` 新增以下可选 props：
- `onGenerateUserReply?: () => void`：点击"AI回复"按钮的回调
- `isGeneratingUserReply?: boolean`：是否正在生成用户回复（控制按钮 loading 态）
- `generatedReplyText?: string`：从外部填入 textarea 的文本（用于生成完成后填充）
- `onGeneratedReplyTextConsumed?: () => void`：通知父组件已消费填充文本（避免重复填充）

按钮布局调整：在 Send Message 按钮**左侧**新增"AI回复"按钮（与 Send 按钮同一条件分支，即非 streaming/非 organizing 态下显示）。生成中时该按钮变为"停止生成"态（与 Send 按钮 streaming 态对称）。
