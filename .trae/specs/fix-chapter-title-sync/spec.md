# Fix Chapter Title Sync Issue Spec

## Why
在章节属性编辑界面中，修改章节名称后左侧章节列表未同步更新显示新名称，且切换到其他章节后再返回时，章节名称会还原为修改前的值。这是因为 Form 组件的 initialValues 不会响应 selectedChapter 的变化，且 requestAnimationFrame 导致的时序问题可能造成数据覆盖。

## What Changes
- 为 Form 组件添加基于 selectedChapter 标识的 key 属性，确保切换章节时表单正确重置
- 移除 requestAnimationFrame，直接同步设置表单值
- 确保 treeData 能正确响应 chapters 变化并触发 Tree 组件更新

## Impact
- Affected specs: 大纲编辑功能
- Affected code: src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx

## ADDED Requirements
### Requirement: 章节标题同步更新
系统 SHALL 在用户修改章节名称后，立即在左侧章节列表中显示更新后的名称，并在切换章节后保持修改后的值。

#### Scenario: 修改章节名称并切换章节
- **WHEN** 用户修改章节名称后切换到其他章节，再返回原章节
- **THEN** 原章节名称应保持修改后的值，不会还原

## MODIFIED Requirements
### Requirement: 章节编辑界面表单管理
现有的表单数据管理需要优化，确保在切换章节时能正确加载和显示章节数据。

## REMOVED Requirements
### Requirement: None
没有需求被移除。