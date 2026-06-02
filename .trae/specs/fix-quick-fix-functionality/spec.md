# 修复快速修复功能 Bug

## Why
用户在写作模式中点击"剧情检查"→"快速修复"→"接受修正"后，系统提示"修正成功"，但返回章节后问题文本仍然存在。快速修复功能未能正确将修正内容应用到章节文本中。

## What Changes
- 修复 `handleAcceptQuickFix` 使用过时内容快照的Bug，改为使用当前编辑器最新内容
- 修复 `ContentWorkspace` 中传递空函数 `() => {}` 替代 `setChapterContents` 的问题
- 修复 `QuickFixSuggestionModal` 关闭按钮未正确调用 `onComplete` 回调的问题
- 补充 `handleAcceptQuickFix` 的 `useCallback` 依赖项
- 确保快速修复时正确处理 `pendingQuickFixType` 状态

## Impact
- Affected specs: 剧情检查与快速修复功能
- Affected code: 
  - `src/renderer/components/Creative/WritingMode/hooks/usePlotCheck.ts`
  - `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx`
  - `src/renderer/components/Creative/WritingMode/QuickFixSuggestionModal.tsx`
  - `src/renderer/components/Creative/WritingMode/PlotCheckReportModal.tsx`
  - `src/renderer/components/Creative/WritingMode/hooks/useChapterGeneration.ts`

## ADDED Requirements
### Requirement: 快速修复使用最新内容
系统 SHALL 在用户点击"接受修正"时使用编辑器当前的最新内容作为修复基础，而非使用用户点击"快速修复"时捕获的内容快照。

#### Scenario: 用户编辑后接受修正
- **WHEN** 用户点击"快速修复"后，在编辑器中修改了内容，然后点击"接受修正"
- **THEN** 修正应基于用户修改后的最新内容应用，而不是基于之前捕获的快照

### Requirement: setChapterContents 正确传递
系统 SHALL 在调用 `handleAcceptQuickFix` 时传递正确的 `setChapterContents` setter，确保章节内容更新能够正确持久化。

#### Scenario: 接受修正后内容更新
- **WHEN** 用户点击"接受修正"按钮
- **THEN** 章节内容应被正确更新并保存到项目存储中

### Requirement: 关闭按钮行为正确
系统 SHALL 在用户点击模态框关闭按钮或X按钮时正确清理快速修复状态，不触发不必要的拒绝操作。

#### Scenario: 用户点击关闭按钮
- **WHEN** 用户在快速修复建议模态框中点击"关闭"按钮或X按钮
- **THEN** 模态框关闭，快速修复状态被正确清理
