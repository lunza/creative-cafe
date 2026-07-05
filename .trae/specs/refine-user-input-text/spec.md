# 润色输入按钮 Spec

## Why

对话模式中用户手动输入的草稿文本可能表达不够精准、不符合当前角色场景的语境，或缺乏角色人设特征。现有"AI回复"按钮只能从零生成全新回复，无法在用户已有草稿基础上进行润色优化。本 spec 新增"润色"按钮，接收用户当前输入框中的草稿文本，结合对话历史、角色信息与人设设置进行上下文感知的润色，输出更贴合场景的精炼文本替换原输入（用户可继续编辑后发送）。

## What Changes

### UI 层
- 在 `ChatInputBar.tsx` 中"AI回复"按钮与 Send Message 按钮**之间**新增"润色"按钮（`HighlightOutlined` 图标）
  - 配色：青色渐变（`linear-gradient(135deg, #14b8a6 0%, #06b6d4 100%)`），区别于 AI回复（紫色）与 Send（蓝紫色）
  - 三态：正常（青色渐变）、润色中（红色渐变 + `LoadingOutlined`，点击触发取消）、禁用（输入框为空 / streaming / organizing / generatingUserReply / polishingInput）
  - Tooltip：`润色当前输入文本（结合对话上下文与角色人设）`
- 润色完成后在 textarea 上播放短暂的边框高亮动画（青色 `box-shadow` 闪现 600ms），作为视觉反馈
- 润色完成时显示 `message.success('已润色')` 提示

### 业务逻辑层
- 在 `useCharacterDialogueChat` hook 中新增 `polishInput(originalText: string): Promise<string>` 方法
  - 复用 `getEffectiveParams()`、`getActiveEngineConfig()`、`ChatEngineFactory`、`ContextTruncator` 等现有基础设施（与 `generateUserReply` 相同的引擎调用链路）
  - 流式接收 AI 回复，临时累积到 ref，完成后返回完整字符串
  - 生成过程中设置 `isPolishingInput` 状态（控制按钮 loading 态与禁用）
- 新增 `isPolishingInput` 状态暴露给外部组件
- `cancelRequest` 函数追加润色中断逻辑（与 `generateUserReply` 取消机制对称）

### 提示词层
- 在 `PromptBuilder.ts` 新增 `buildPolishInputSystemPrompt(characterInfo, persona, originalText, person?)` 函数：
  - 系统角色：让 AI 作为"文本润色器"，基于对话上下文优化用户草稿
  - 包含 `selectedPersona.name` + `selectedPersona.description`（用户人设）
  - 包含 `characterInfo.characterCardName` + 简短 `personality` / `characterCardContent`（对方角色上下文）
  - 包含 `originalText`（待润色的原始文本）
  - 明确约束：
    - 保持用户原始意图与核心信息不变
    - 提升表达精准度与场景适配度
    - 符合用户人设的说话方式
    - 仅输出润色后的文本，不解释、不引号包裹、不添加前缀
    - 润色后长度不应大幅偏离原文（建议 ±50% 以内）
  - 支持 `person` 参数（与 `buildUserReplySystemPrompt` 一致的人称视角约束）
- 复用 `buildStopSequencesForUserReply(charName, customStops?)` 作为停止序列（防止 AI 越权生成角色回复）

### 状态机
- `isPolishingInput=true` 时：
  - "润色"按钮显示 loading 图标并变为停止态
  - Send Message 按钮禁用
  - AI回复按钮禁用
  - textarea 禁用（避免用户在润色中输入造成冲突）
  - 人称选择器禁用
  - cancelRequest 可终止润色
- 润色完成后：
  - 释放上述禁用
  - 润色文本替换输入框内容
  - 自动聚焦 textarea，光标定位到末尾
  - textarea 边框播放青色高亮动画
  - 显示 `message.success('已润色')` 提示

## Impact

- **Affected specs**: `add-ai-user-reply-button`（共享 AI 引擎调用与停止序列基础设施）、`add-person-attribute-to-ai-reply`（复用人称属性配置）
- **Affected code**:
  - `src/renderer/components/Character/CharacterDialogueChat/PromptBuilder.ts`（新增 `buildPolishInputSystemPrompt` 函数）
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（新增 `polishInput` 函数 + `isPolishingInput` 状态 + ref + 取消逻辑）
  - `src/renderer/components/Character/CharacterDialogueChat/ChatInputBar.tsx`（新增润色按钮 + props + 视觉反馈动画）
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx`（透传 `onPolishInput` / `isPolishingInput` / `polishFlash` 等 props）

## ADDED Requirements

### Requirement: 润色输入按钮
系统 SHALL 在 ChatInputBar 的"AI回复"按钮与 Send Message 按钮**之间**提供"润色"按钮，点击后以当前输入框文本为输入，调用 AI 模型结合对话上下文与人设进行润色，将润色后的文本替换输入框内容。

#### Scenario: 正常润色
- **WHEN** 用户在输入框中输入文本后点击"润色"按钮，且当前未在流式生成 / 未在整理表格 / 未在生成用户回复 / 未在润色 / 已配置活动 AI 引擎 / 已选择用户人设
- **THEN** 按钮显示 loading 旋转图标，Send 按钮 / AI回复按钮 / textarea / 人称选择器进入禁用状态
- **AND** 系统以 `buildPolishInputSystemPrompt` 构建的系统提示调用 AI 模型，流式接收润色后的回复
- **AND** 生成完成后，将润色文本替换输入框内容，自动聚焦并将光标置于文本末尾
- **AND** textarea 边框播放青色高亮动画（600ms）
- **AND** 显示 `message.success('已润色')` 提示
- **AND** 释放所有禁用状态

#### Scenario: 空输入错误处理
- **WHEN** 用户点击"润色"按钮但输入框为空或仅含空白字符
- **THEN** 显示 `message.warning('请先输入需要润色的文本')` 提示，不发起 AI 请求

#### Scenario: 缺少前置条件
- **WHEN** 用户点击"润色"但未选择用户人设（`selectedPersona` 为 null）
- **THEN** 显示 `message.warning('请先在右侧面板选择用户人设')` 提示，不发起 AI 请求
- **WHEN** 用户点击"润色"但无活动 AI 引擎
- **THEN** 显示 `message.warning('请先在设置中配置AI引擎')` 提示，不发起 AI 请求

#### Scenario: 润色中取消
- **WHEN** `isPolishingInput=true` 时用户点击"润色"按钮（按钮此时为停止态）
- **THEN** 调用 `engine.cancelRequest()` 终止当前润色
- **AND** 已累积的部分文本**不**替换输入框内容（避免半截润色），恢复按钮为正常态

#### Scenario: 流式生成中禁用
- **WHEN** `state.isStreaming=true` 或 `isOrganizing=true` 或 `isGeneratingUserReply=true`
- **THEN** "润色"按钮显示为禁用态，点击无响应

#### Scenario: 润色失败处理
- **WHEN** AI 润色请求失败（网络错误 / API 错误 / 超时）
- **THEN** 显示 `message.error('润色失败：...')` 提示，保留原输入框内容不变
- **AND** 释放所有禁用状态，恢复按钮为正常态

### Requirement: 润色专用系统提示
系统 SHALL 通过 `buildPolishInputSystemPrompt(characterInfo, persona, originalText, person?)` 函数构建专用系统提示，明确指示 AI 在保持用户原始意图的基础上润色文本。

#### Scenario: 系统提示内容
- **WHEN** 调用 `buildPolishInputSystemPrompt`
- **THEN** 输出包含以下段落：
  - 角色定义："你是文本润色器，需要基于对话上下文优化用户草稿文本"
  - 用户人设：`selectedPersona.name` + `selectedPersona.description`
  - 对方角色上下文：`characterCardName` + 简短 `personality`（如存在）
  - 原始文本：`originalText`（待润色内容）
  - 任务要求：保持原始意图 / 提升表达精准度 / 符合人设说话方式 / 仅输出润色后文本 / 长度不大幅偏离原文
  - 人称视角约束（如传入 `person` 参数）

#### Scenario: 人称视角支持
- **WHEN** 调用 `buildPolishInputSystemPrompt(characterInfo, persona, originalText, 'third')`
- **THEN** 系统提示包含第三人称视角约束，确保润色后的文本也遵循人称设置

#### Scenario: 防御性返回
- **WHEN** `persona` 为空或 `persona.name` 为空或 `originalText` 为空
- **THEN** 返回空串，由调用方做前置校验

### Requirement: 润色状态可见性
系统 SHALL 通过 `isPolishingInput` 状态向 UI 暴露润色进度。

#### Scenario: 状态切换
- **WHEN** `polishInput()` 调用开始
- **THEN** `isPolishingInput=true`，触发 ChatInputBar 按钮态切换 + 禁用 AI回复按钮 / Send 按钮 / textarea / 人称选择器
- **WHEN** 润色完成（成功或失败）
- **THEN** `isPolishingInput=false`，恢复所有按钮态

### Requirement: 润色完成视觉反馈
系统 SHALL 在润色完成并替换输入框内容后提供视觉反馈。

#### Scenario: 边框高亮动画
- **WHEN** 润色成功完成，润色文本已替换输入框内容
- **THEN** textarea 边框播放青色 `box-shadow` 高亮动画，持续约 600ms 后消失
- **AND** 显示 `message.success('已润色')` 提示

## MODIFIED Requirements

### Requirement: ChatInputBar 组件接口
`ChatInputBar` 新增以下可选 props：
- `onPolishInput?: (text: string) => void`：点击"润色"按钮的回调，传入当前输入框文本
- `isPolishingInput?: boolean`：是否正在润色（控制按钮 loading 态 + 禁用其他控件）
- `polishFlashKey?: number`：润色完成触发器（值变化时触发的 textarea 边框高亮动画）

按钮布局调整：在"AI回复"按钮与 Send Message 按钮**之间**新增"润色"按钮。润色中时该按钮变为"停止润色"态（与 AI回复按钮生成态对称）。

### Requirement: cancelRequest 函数
`cancelRequest` 函数追加润色中断逻辑：若 `isPolishingInputRef.current` 为 true，则设置 `isPolishingInputAbortRef.current = true` 并调用 `engine.cancelRequest()`。
