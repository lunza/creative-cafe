# 处理 think 标签溢出 Spec

## Why
当对话模式调用 deepseek3.2 等老模型时，AI 回复（含润色结果）会内` 推理标签。现有 `stripThinkingTags` 工具仅在渲染时清理，存储 / 上下文回传 / RAG 向量化仍保留原始标签，造成历史污染与无效 token 累积。用户需要 AI 参数配置区域提供一个默认开启的开关，在 AI 完成回复后即剥离 think 标签内容。

## What Changes
- 在 `AIParameterConfig` 新增 `strip_think_tags?: boolean` 字段，`undefined` / `true` 视为开启（默认开启语义，与 `emoji_enhanced` 一致）
- 在 `requestAIResponse.onComplete` 计算最终 `displayContent` 前，按开关对 `finalContent` 应用 `stripThinkingTags`，确保存入 chat history / RAG / context 的内容已无 think 标签
- 在 `polishInput.onComplete` 返回前同样按开关剥离 think 标签，避免润色结果污染输入框
- 在 `ParameterPanel` 新增 "Think 标签处理" Switch（沿用 `emoji_enhanced` 的 UI 模式：标题 + Tooltip + Switch）
- 在 `ConfigPanel` 透传 `stripThinkTags` / `onStripThinkTagsToggle` props
- 在 `CharacterDialogueChat.tsx` 接入状态：读取 `characterConfig?.customParameters?.strip_think_tags !== false`，写回 `handleParameterChange({ strip_think_tags: enabled })`
- 保留 `processMessage` 内的渲染时剥离作为防御性兜底（处理历史已保存的脏数据），不删除
- **不在**流式 `onStream` 阶段剥离（避免标签未闭合时误删正文；保留流式渲染自然过渡）

## Impact
- Affected specs: `optimize-chat-ai-intelligence`（参数面板扩展）、`fix-ai-response-length-degradation`（`min_response_chars` 诊断计数将基于剥离后内容，需确认计数时机）
- Affected code:
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — `AIParameterConfig` 接口扩展
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — `requestAIResponse`、`polishInput` 两处后处理
  - `src/renderer/components/Character/CharacterDialogueChat/ParameterPanel.tsx` — 新增 Switch UI
  - `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` — props 透传
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — 状态绑定与 props 传递
  - `src/renderer/components/Character/CharacterDialogueChat/utils/messageProcessor.ts` — 复用现有 `stripThinkingTags`，无需改动

## ADDED Requirements

### Requirement: think 标签后处理开关
The system SHALL provide a per-character-session boolean option `strip_think_tags` in `AIParameterConfig.customParameters`, exposed via a Switch in the AI parameter configuration panel, defaulting to enabled (undefined or true means enabled).

#### Scenario: 默认开启剥离
- **WHEN** 用户未显式配置 `strip_think_tags`（字段为 `undefined`）
- **THEN** Switch UI 显示为开启状态
- **AND** AI 回复 / 润色结果在写入存储前自动剥离 think 标签内容

#### Scenario: 显式关闭剥离
- **WHEN** 用户在参数面板将 Switch 切换为关闭
- **THEN** `characterConfig.customParameters.strip_think_tags` 被写为 `false` 并持久化到 `localStorage['character-session-<cardId>']`
- **AND** AI 原始回复（含 think 标签）直接存入 chat history
- **AND** 渲染时仍由 `processMessage` 内的 `stripThinkingTags` 兜底剥离（保持显示干净，但存储 / RAG / context 仍含标签）

#### Scenario: AI 回复后剥离
- **WHEN** AI 回复完成（`requestAIResponse` 的 `onComplete` 触发）
- **AND** `strip_think_tags !== false`
- **THEN** 在 `displayContent` 被赋值前对 `finalContent` 调用 `stripThinkingTags`
- **AND** 剥离后的内容写入 `finalMessages`、`saveChatToStore`、向量化管线与回传上下文

#### Scenario: 润色结果剥离
- **WHEN** 润色任务完成（`polishInput` 的 `onComplete` 触发）
- **AND** `strip_think_tags !== false`
- **THEN** 在 `resolve(finalContent)` 前对 `finalContent` 调用 `stripThinkingTags`
- **AND** 返回给调用方的润色文本不再含 think 标签

#### Scenario: 流式渲染不受影响
- **WHEN** AI 正在流式输出（`onStream` 回调累计 chunk）
- **THEN** `streamContentRef.current` 保留原始累计内容（含未闭合 think 标签）
- **AND** 仅在 `onComplete` 时做一次性剥离，避免流式过程中误删未闭合标签后的正文

## MODIFIED Requirements

### Requirement: AI 参数配置面板
在 "Emoji 增强模式" Switch 与 "自定义停止序列" 区块之间，新增 "Think 标签处理" Switch 区块，结构与样式与 `emoji_enhanced` 保持一致（标题 + QuestionCircleOutlined Tooltip + Switch）。Tooltip 说明："开启后，AI 完成回复或润色后自动剥离 `<think>` 等推理标签内容（针对 deepseek3.2 等老模型）。默认开启。剥离发生在写入存储前，避免污染历史与上下文。"
