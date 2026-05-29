# Fix UI Not Reflecting Backend Saved Changes Spec

## Why
后端日志显示项目保存成功，但前端UI在切换章节后无法反映修改的内容。用户修改章节标题后，切换到其他章节再返回，标题会还原为修改前的状态。这说明前端组件的数据流或状态同步存在缺陷。

## What Changes
- 修复 `ManualOutlineEditor` 组件中 `selectedChapter` 的数据来源问题
- 确保 `handleFormChange` 的数据更新能正确同步到组件的 `chapters` prop
- 修复 `handleSelect` 从正确的数据源读取章节信息

## Impact
- Affected specs: 章节编辑功能、大纲持久化
- Affected code: 
  - src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx
  - src/renderer/components/Creative/WritingMode/OutlineEditPanel.tsx

## ADDED Requirements
### Requirement: 章节切换后保持修改状态
当用户修改章节属性并切换章节后，再次返回该章节时应显示修改后的最新内容。

#### Scenario: 修改章节标题后切换章节
- **WHEN** 用户修改章节1的标题，切换到章节2，再返回章节1
- **THEN** 章节1应显示修改后的标题，而不是原始标题

## MODIFIED Requirements
### Requirement: ManualOutlineEditor 数据同步
`handleFormChange` 更新 `chaptersRef` 后，应确保组件的 `chapters` prop 与实际渲染的数据保持一致。

### Requirement: selectedChapter 数据源
`selectedChapter` 应从最新的 `chaptersRef.current` 读取数据，而不是仅从 prop 读取。

## REMOVED Requirements
### Requirement: None
没有需求被移除。
