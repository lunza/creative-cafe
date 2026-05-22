# 自动修正反馈增强 Spec

## Why
当前自动修正功能在点击"自动修正"按钮后，仅显示一条简短的 `message.success('问题已自动修正，编辑器内容已更新')` 提示，用户无法看到具体修改了哪些内容、原始问题内容与修正后内容的对比，也不清楚修正操作的实际效果。

## What Changes
- 在 PlotCheckReportModal 中添加修正结果展示区域，显示修正前后对比
- 添加修正详情弹窗，展示原始问题片段、修正后片段和修改位置
- 在 ContentWorkspace 的 handleContentUpdated 中增加修正反馈通知
- 增强 PlotCheckIssue 和 LogicCheckIssue 类型，添加原始位置标记

## Impact
- Affected specs: add-plot-check-auto-fix（扩展）
- Affected code:
  - `src/renderer/components/Creative/WritingMode/PlotCheckReportModal.tsx`（修改 - 添加修正结果展示）
  - `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx`（修改 - 增强反馈）
  - `src/shared/types/writing.types.ts`（修改 - 增强类型定义）

## ADDED Requirements

### Requirement: 修正结果展示
系统 SHALL 在修正完成后向用户展示以下信息：
1. 修正操作的成功/失败状态（明确标识）
2. 原始问题内容与修正后内容的对比
3. 具体问题已被替换及替换结果

### Requirement: 修正详情弹窗
系统 SHALL 提供修正详情弹窗，包含：
- 问题标题和类型
- 原始问题内容片段（高亮显示）
- 修正后的内容片段
- 修改位置（如果有）
- 接受/拒绝修正的选项
