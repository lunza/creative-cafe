# 记忆表格手动整理按钮 Spec

## Why

对话功能的记忆表格支持"实时整理"（每轮对话后自动触发），但用户关闭该选项后，对话期间积累的记录不会被整理，且没有任何手动补救入口。需要一个手动触发表格整理的按钮，让用户在未启用实时整理时也能对未整理的对话记录执行一次性整理。

## What Changes

- 在记忆表格设置面板（`MemoryTablePanel.tsx`）中新增"手动整理表格"按钮
- 按钮仅当 `enabled && !autoOrganize`（已启用记忆表格且未启用实时整理）时显示
- 点击按钮调用与现有同步整理完全相同的 IPC（`memory.processChatProgressive`，`continueFromLast: true`），保证整理算法与规则一致
- 整理执行期间按钮显示 loading 状态并禁用，完成后通过 message 反馈结果（成功/失败/无可用引擎）
- 按钮配有文字说明与 Tooltip，明确其为"手动触发表格整理"、是实时整理功能的手动替代方案
- 新增 props 传递链：hooks（`handleManualOrganize` + `manualOrganizing` 状态）→ `CharacterDialogueChat.tsx` → `ConfigPanel.tsx` → `MemoryTablePanel.tsx`

## Impact

- Affected specs: `fix-and-upgrade-table-organize`（复用其修复后的 `processChatProgressive` 路径，不修改该路径）
- Affected code:
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（新增手动整理回调与状态）
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx`（透传新 props）
  - `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx`（扩展 props 接口并透传）
  - `src/renderer/components/Character/CharacterDialogueChat/MemoryTablePanel.tsx`（新增按钮 UI）
  - `docs/user-manual.md`（增量更新记忆表格章节说明）

## ADDED Requirements

### Requirement: 手动触发表格整理按钮
The system SHALL provide a manual organize button in the memory table settings panel that triggers table organization for unorganized dialogue records on demand.

#### Scenario: 按钮展示条件
- **WHEN** 记忆表格已启用（`enabled === true`）且实时整理未启用（`autoOrganize === false`）
- **THEN** 按钮显示在"是否实时整理表格"开关行下方的显眼位置
- **WHEN** 记忆表格未启用，或实时整理已启用
- **THEN** 按钮不显示

#### Scenario: 整理算法与实时整理一致
- **WHEN** 用户点击手动整理按钮
- **THEN** 系统使用与同步整理完全相同的调用方式：`window.electronAPI.memory.processChatProgressive(chatId, '', engineConfig, { continueFromLast: true, minInterval: 3000 })`
- **AND** 引擎配置同样来自 `getActiveEngineConfig()`
- **AND** `continueFromLast: true` 确保仅处理上次整理位置之后的未整理对话记录

#### Scenario: 加载状态反馈
- **WHEN** 整理执行期间
- **THEN** 按钮显示 loading 图标并禁用，防止重复触发
- **AND** 使用 `isOrganizingRef` 防并发守卫，与自动整理互斥

#### Scenario: 结果反馈
- **WHEN** 整理成功完成
- **THEN** 显示成功提示（含处理条数 `processedCount`）
- **WHEN** 无可用 AI 引擎或整理失败
- **THEN** 显示对应的错误提示，按钮恢复可点击状态

#### Scenario: 用户提示文案
- **WHEN** 按钮渲染
- **THEN** 按钮带说明文字表明其功能为"手动触发表格整理"，是实时整理的手动替代方案（按钮文案 + Tooltip 详细说明）
