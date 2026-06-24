# 过滤模型思考标签 Spec

## Why
当前对话模式下，部分模型会输出 `<think>...</think>` 等思考标签包裹的推理过程内容。前端未对这些标签进行过滤，导致用户直接看到模型的内部思考内容，影响用户体验。

## What Changes
- 在 `messageProcessor.ts` 中新增 `stripThinkingTags` 函数，在内容渲染前移除所有思考标签及其内容
- 将 `stripThinkingTags` 集成到 `processMessage` 和 `preprocessForMarkdown` 处理管道中
- 在 `MessageRenderer.test.tsx` 和 `messageProcessor.test.ts` 中添加单元测试

## Impact
- Affected specs: 无（新增功能）
- Affected code:
  - `src/renderer/components/Character/CharacterDialogueChat/utils/messageProcessor.ts` — 新增过滤函数并集成到处理管道
  - `src/renderer/components/Character/CharacterDialogueChat/utils/__tests__/messageProcessor.test.ts` — 新增单元测试
  - `src/renderer/components/Character/CharacterDialogueChat/MessageRenderer/__tests__/MessageRenderer.test.tsx` — 新增渲染层测试

## ADDED Requirements

### Requirement: 思考标签内容过滤
系统 SHALL 在消息内容渲染到用户界面之前，移除所有思考标签及其包含的内容。

#### Scenario: 标准 think 标签过滤
- **WHEN** 消息内容包含 `<think>思考内容</think>正常内容`
- **THEN** 渲染结果仅显示 `正常内容`，`<think>` 标签及其内容完全不可见

#### Scenario: thinking 变体标签过滤
- **WHEN** 消息内容包含 `<thinking>思考内容</thinking>正常内容`
- **THEN** 渲染结果仅显示 `正常内容`

#### Scenario: 大小写变体标签过滤
- **WHEN** 消息内容包含 `<Think>内容</Think>` 或 `<THINK>内容</THINK>`
- **THEN** 渲染结果中这些标签及其内容均被移除

#### Scenario: 多个思考标签过滤
- **WHEN** 消息内容包含多段 `<think>...</think>` 标签
- **THEN** 所有思考标签及其内容均被移除

#### Scenario: 未闭合标签过滤
- **WHEN** 消息内容包含 `<think>思考内容` 但没有闭合标签（流式输出中间状态）
- **THEN** 从 `<think>` 开始到末尾的内容均被移除

#### Scenario: 仅包含思考标签的内容
- **WHEN** 消息内容全部为 `<think>...</think>` 标签
- **THEN** 渲染结果为空或仅显示空白

#### Scenario: 思考标签内嵌套其他标签
- **WHEN** 消息内容包含 `<think>内含 **加粗** 和 *斜体* 的思考内容</think>正常内容`
- **THEN** 整个思考标签及内容被移除，仅显示 `正常内容`

### Requirement: 不影响正常内容显示
系统 SHALL 确保过滤过程不影响正常对话内容的格式和完整性。

#### Scenario: 正常内容保持不变
- **WHEN** 消息内容不包含任何思考标签
- **THEN** 内容显示与过滤前完全一致，包括 Markdown 格式、HTML 标签等

#### Scenario: 思考标签前后的内容完整保留
- **WHEN** 消息内容为 `前文<think>思考</think>后文`
- **THEN** 渲染结果同时显示 `前文` 和 `后文`，格式不受影响
