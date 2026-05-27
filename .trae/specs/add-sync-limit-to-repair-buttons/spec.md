# 自动修复按钮同步限制功能 Spec

## Why
当前系统允许多个自动修复按钮同时被点击，可能导致同时发起多个AI请求，造成资源竞争和潜在的冲突。需要实现一个同步机制，确保同一时间只有一个修复按钮处于活动状态，避免并发问题。

## What Changes
- 修改 `PlotCheckReportModal` 组件，添加全局修复状态管理
- 实现按钮同步逻辑，确保同时只能有一个修复操作在进行
- 修改自动修复和快速修复按钮的行为，添加全局禁用状态
- 更新UX以提供清晰的反馈给用户

## Impact
- Affected specs: add-plot-check, add-quick-fix
- Affected code:
  - `src/renderer/components/Creative/WritingMode/PlotCheckReportModal.tsx`（修改 - 添加全局修复状态管理）
  - `src/renderer/components/Creative/WritingMode/hooks/usePlotCheck.ts`（修改 - 可能需要调整状态管理）

## ADDED Requirements

### Requirement: 修复按钮同步机制
系统 SHALL 确保在同一时间只能有一个修复按钮处于活动状态（进行修复操作）。

#### Scenario: 修复按钮互斥
- **WHEN** 用户点击某个修复按钮开始修复操作
- **THEN** 所有其他修复按钮（包括自动修复和快速修复）应被禁用
- **AND** 用户不能同时启动多个修复操作

#### Scenario: 修复操作完成
- **WHEN** 当前修复操作完成（成功或失败）
- **THEN** 其他修复按钮应恢复为可用状态
- **AND** 用户可以点击其他修复按钮开始新的修复操作

### Requirement: 用户体验反馈
系统 SHALL 为用户提供清晰的反馈，指示哪个按钮正在进行修复操作。

#### Scenario: 修复操作状态指示
- **WHEN** 某个修复按钮正在进行修复操作
- **THEN** 该按钮应显示加载状态
- **AND** 其他修复按钮应显示禁用状态
- **AND** 应有视觉指示器表明当前有修复操作在进行

## MODIFIED Requirements

### Requirement: 修复按钮状态管理
`PlotCheckReportModal` 组件 SHOULD 管理全局修复状态，跟踪当前是否有修复操作在进行中。

### Requirement: 修复函数接口
修复函数（`handleAutoFix`, `handleQuickFix`）SHOULD 在开始修复操作前设置全局状态，在修复完成后清除状态。