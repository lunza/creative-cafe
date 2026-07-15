# 修复 think 标签剥离导致内容保护检查误触发 Spec

## Why
在 `strip_think_tags` 开关默认开启后，`onComplete` 回调会对 AI 回复执行 `stripThinkingTags`，剥离后的 `displayContent` 长度小于流式渲染时累积的 `existingContent`（后者含 think 标签），触发 [hooks.ts:1305](file:///g:/AI/creative-cafe/src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts#L1305) 的内容保护检查，导致 `return prev`，消息状态永远停留在 `'sending'`，UI 卡死在"正在生成中"。

## What Changes
- 在 think 标签剥离处（`hooks.ts` 约 line 1089-1095）增加 `thinkTagsStripped` 标志位
- 在内容保护检查（`hooks.ts` 约 line 1305）增加 `&& !thinkTagsStripped` 条件，跳过 think 标签剥离导致的合法缩短

## Impact
- Affected specs: `handle-think-tags-overflow`（think 标签后处理开关的配套修复，没有此修复则该功能开关启用时必然导致 UI 卡死）
- Affected code: `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（`requestAIResponse` 的 `onComplete` 回调内两处修改）

## MODIFIED Requirements

### Requirement: 内容保护检查
`onComplete` 回调中的内容保护检查（防止 AI 回复内容意外丢失）需要排除"think 标签剥离导致的合法缩短"场景。当 `strip_think_tags` 开启且实际剥离了 think 标签内容时，`displayContent.length < existingContent.length` 是预期行为，不应触发保护。

#### Scenario: think 标签剥离后内容变短
- **WHEN** `strip_think_tags !== false`（默认开启）
- **AND** `stripThinkingTags(finalContent)` 实际剥离了 think 标签内容（`finalContent.length` 变化）
- **THEN** 设置 `thinkTagsStripped = true` 标志
- **AND** 内容保护检查跳过（`!thinkTagsStripped` 条件不满足）
- **AND** 状态正常更新为 `'sent'` / `isStreaming: false` / `isLoading: false`

#### Scenario: 未剥离 think 标签时保护仍生效
- **WHEN** `strip_think_tags === false`（用户关闭开关）
- **OR** `stripThinkingTags(finalContent)` 未改变长度（无 think 标签可剥离）
- **THEN** `thinkTagsStripped` 保持 `false`
- **AND** 内容保护检查正常执行（若 displayContent 变短仍触发保护）
