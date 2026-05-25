# 快速修正功能重构 Spec（一次AI请求返回修正建议）

## Why
当前快速修正实现需要用户点击按钮后再发起一次AI请求，效率低下。实际需求是：**在剧情检查的一次AI请求中，就同时返回评分报告和每个问题的修正建议**。用户点击"快速修正"时直接使用已返回的建议进行替换，无需再次调用AI。

## What Changes
- 修改 `PlotCheckerService.analyzeChapter` 的AI提示词，要求AI在返回报告时每个问题附带 `quickFixSuggestion`
- 修改 `QuickFixSuggestion` 类型定义（保持原有结构）
- 在 `PlotCheckIssue` 和 `LogicCheckIssue` 中的 `quickFixSuggestion` 字段在检查时直接填充
- 移除 `quickFixIssue` IPC通道和服务方法（不再需要单独的请求）
- 修改 `PlotCheckReportModal` 中快速修正按钮点击行为：直接使用已缓存的建议
- 修改 `QuickFixSuggestionModal` 数据来源：从已缓存的 `issue.quickFixSuggestion` 获取

## Impact
- Affected specs: add-plot-check, add-quick-fix（重构）
- Affected code:
  - `src/main/services/writing/PlotCheckerService.ts`（修改 - 提示词要求返回修正建议）
  - `src/renderer/components/Creative/WritingMode/PlotCheckReportModal.tsx`（修改 - 快速修正按钮直接使用缓存建议）
  - `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx`（修改 - 快速修正回调简化）
  - `src/renderer/components/Creative/WritingMode/hooks/usePlotCheck.ts`（修改 - 移除handleQuickFix异步请求）
  - `src/main/ipc/handlers/writingHandlers.ts`（修改 - 移除writing:quickFixIssue handler）
  - `src/main/preload.ts`（修改 - 移除quickFixIssue API）
  - `src/renderer/components/Creative/WritingMode/QuickFixSuggestionModal.tsx`（保持 - 数据来源变化）
  - `src/shared/types/writing.types.ts`（保持 - 类型定义不变）

## ADDED Requirements

### Requirement: 剧情检查报告包含修正建议
系统 SHALL 在剧情检查AI返回的报告中，每个问题条目中直接包含快速修正建议（`quickFixSuggestion`），包含：
- `originalText` - 需要被替换的原文片段
- `fixedText` - AI建议的修改后文本
- `reason` - 修正理由说明

#### Scenario: AI返回修正建议
- **WHEN** AI返回剧情检查报告
- **THEN** 每个问题的 `quickFixSuggestion` 字段已填充
- **AND** 用户点击"快速修正"按钮时直接使用缓存建议展示弹窗

### Requirement: 快速修正按钮点击行为
用户点击"快速修正"按钮时，系统 SHALL 直接使用问题对象中已缓存的 `quickFixSuggestion` 展示修正建议弹窗，无需再次调用AI。

#### Scenario: 点击快速修正按钮
- **WHEN** 用户点击"快速修正"按钮
- **THEN** 系统直接弹出快速修正建议弹窗（使用已缓存的 `issue.quickFixSuggestion`）
- **AND** 不发起任何新的AI请求

## MODIFIED Requirements

### Requirement: PlotCheckerService.analyzeChapter
`analyzeChapter` 方法的AI提示词 SHALL 要求AI在返回的报告JSON中，每个问题条目包含 `quickFixSuggestion` 字段，格式为：
```json
{
  "dimension": "...",
  "severity": "...",
  "title": "...",
  "description": "...",
  "suggestion": "...",
  "quickFixSuggestion": {
    "originalText": "需要替换的原文片段",
    "fixedText": "修改后的文本",
    "reason": "修正理由"
  }
}
```

### Requirement: 快速修正相关IPC通道
**移除** `writing:quickFixIssue` IPC通道，因为修正建议已在剧情检查时返回。
