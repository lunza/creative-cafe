# Fix Chapter Title Persistence - Deep Copy Issue Spec

## Why
上一轮修复后，用户反馈修改完全无效。深入分析发现真正的问题在于：`handleFormChange` 直接修改了 `result.chapter` 对象（即原始 `chapters` 数组中的对象引用），然后仅对 `chapters` 进行浅拷贝 `[...chapters]`。由于数组内部的对象引用未改变，React 无法检测到数据变化，导致左侧章节列表不更新，且 `updateOutline` 保存时使用的也是被直接修改的原始对象，无法正确触发持久化。

## What Changes
- 修改 `handleFormChange` 使用深拷贝创建新的章节对象，而不是直接修改原始对象
- 确保 onChange 传递的是包含全新对象引用的章节数组
- 添加调试日志以追踪数据流

## Impact
- Affected specs: 大纲编辑功能
- Affected code: src/renderer/components/Creative/WritingMode/ManualOutlineEditor.tsx

## ADDED Requirements
### Requirement: 深拷贝章节数据
系统 SHALL 在编辑章节时使用深拷贝创建新的章节对象，确保原始数据不被直接修改，React 能正确检测到变化。

#### Scenario: 编辑章节名称
- **WHEN** 用户修改章节名称并触发 onChange
- **THEN** 左侧章节列表立即显示新名称，保存按钮能正确持久化新名称

## MODIFIED Requirements
### Requirement: 表单数据变更处理
现有的 `handleFormChange` 需要改用深拷贝方式处理数据变更。

## REMOVED Requirements
### Requirement: None
没有需求被移除。