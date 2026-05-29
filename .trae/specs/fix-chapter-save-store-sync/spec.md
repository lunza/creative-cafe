# Fix Chapter Save - Stale Closure Issue Spec

## Why
用户反馈章节信息无法保存。经过完整代码审查发现真正的根本原因：`handleSave` 函数中的 `chapters` 变量存在闭包陈旧（stale closure）问题。虽然 `handleFormChange` 通过深拷贝和 `onChange` 更新了 `writingModeStore`，但 `handleSave` 是在 `useCallback` 中闭包捕获的初始 `chapters` 引用。由于父组件没有重新渲染（outline 作为 prop 传入且未被正确订阅），`handleSave` 始终使用最初渲染时的 `chapters` 数据，导致点击保存时传递的是未修改的原始数据。

## What Changes
- 修改 `handleSave` 从 `writingModeStore` 动态获取最新的章节数据，而不是使用闭包捕获的 `chapters` prop
- 或者使用 `chaptersRef` 获取最新的章节数据引用
- 确保保存操作读取的是最新的、已修改的章节数据

## Impact
- Affected specs: 大纲编辑功能、章节数据持久化
- Affected code: src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx

## ADDED Requirements
### Requirement: 保存时读取最新数据
系统 SHALL 在用户点击"保存当前章节信息"按钮时，从最新数据源（ref 或 store）读取当前章节数据并持久化。

#### Scenario: 编辑并保存章节名称
- **WHEN** 用户修改章节名称并点击"保存当前章节信息"按钮
- **THEN** 修改后的章节名称被正确持久化，左侧列表立即显示新名称

## MODIFIED Requirements
### Requirement: 保存按钮数据处理
`handleSave` 需要使用 `chaptersRef.current` 获取最新数据，而非使用闭包中陈旧的 `chapters` prop。

## REMOVED Requirements
### Requirement: None
没有需求被移除。