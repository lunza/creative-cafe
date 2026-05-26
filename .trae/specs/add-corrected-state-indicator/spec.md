# 修正后问题状态管理功能 Spec

## Why
当前系统在用户应用快速修正或自动修正后，问题条目仍然显示修正按钮，容易造成重复修正操作。需要实现一个机制来标记问题为"已修正"状态，显示修正后的内容，并隐藏修正按钮以防止重复操作。

## What Changes
- 修改 `PlotCheckIssue` 和 `LogicCheckIssue` 接口，添加 `correctedText` 字段存储修正后的文本
- 修改 `PlotCheckReportModal` 组件，实现问题的已修正状态显示
- 添加视觉指示器标识问题已被修正
- 在问题修正后显示修正后的文本内容
- 隐藏快速修正和自动修正按钮以防止重复修正
- 修正状态在会话期间持续存在

## Impact
- Affected specs: add-plot-check, add-quick-fix
- Affected code:
  - `src/shared/types/writing.types.ts`（修改 - 添加 correctedText 字段）
  - `src/renderer/components/Creative/WritingMode/PlotCheckReportModal.tsx`（修改 - 实现已修正状态显示）
  - `src/renderer/components/Creative/WritingMode/hooks/usePlotCheck.ts`（修改 - 更新问题修正状态）
  - `src/main/services/writing/PlotCheckerService.ts`（修改 - 自动修正时更新问题状态）

## ADDED Requirements

### Requirement: 问题修正状态标识
系统 SHALL 在问题被修正后，将该问题标记为"已修正"状态，并在UI上提供清晰的视觉指示。

#### Scenario: 问题修正后标记为已修正
- **WHEN** 用户应用快速修正或自动修正后
- **THEN** 问题条目应显示"已修正"标签或其他视觉指示器
- **AND** 问题条目应突出显示修正后的文本内容

#### Scenario: 修正后文本显示
- **WHEN** 问题处于已修正状态
- **THEN** 在问题描述区域下方显示修正后的文本内容
- **AND** 修正后文本应以显著样式展示（如绿色边框或背景）

### Requirement: 隐藏修正按钮
系统 SHALL 在问题被修正后，隐藏快速修正和自动修正按钮以防止重复操作。

#### Scenario: 修正按钮隐藏
- **WHEN** 问题处于已修正状态
- **THEN** 快速修正和自动修正按钮不应显示
- **AND** 不应允许用户再次对同一问题执行修正操作

#### Scenario: 修正按钮显示条件
- **WHEN** 问题未被修正且存在修正建议
- **THEN** 修正按钮应正常显示
- **AND** 用户应能够执行修正操作

### Requirement: 修正状态持久化
系统 SHALL 在会话期间保持问题的修正状态，直到用户通过其他方式显式修改。

#### Scenario: 修正状态持久化
- **WHEN** 用户修正问题后
- **THEN** 修正状态应在当前会话中持续存在
- **AND** 即使用户关闭并重新打开报告模态框，修正状态也应保留

## MODIFIED Requirements

### Requirement: PlotCheckIssue / LogicCheckIssue 类型
在 `PlotCheckIssue` 和 `LogicCheckIssue` 接口中添加以下字段：
- `correctedText?: string` - 记录问题修正后的文本内容
- `corrected?: boolean` - 标记问题是否已被修正（默认 false）

### Requirement: 修正操作后状态更新
在 `handleAcceptFix` 和 `handleAcceptQuickFix` 操作完成后，系统应：
- 将对应问题的 `corrected` 字段设为 true
- 将 `correctedText` 字段设为修正后的文本内容
- 触发UI更新以反映新的状态

### Requirement: 修正报告模态框UI更新
`PlotCheckReportModal` 组件应根据问题的 `corrected` 状态调整UI：
- 显示已修正的视觉指示器
- 显示 `correctedText` 内容
- 隐藏修正按钮
- 保持问题的可读性
