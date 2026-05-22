# 剧情检查报告自动修正功能 Spec

## Why
当前剧情检查功能能够识别章节中的各类问题，但用户发现问题后需要手动返回编辑器进行修改，操作流程割裂且效率低下。需要为报告中的每个问题条目提供"自动修正"功能，实现一键修复，提升用户体验和创作效率。

## What Changes
- 在 PlotCheckIssue 类型中添加 `fixable` 和 `fixed` 字段
- 新增 IPC 通道 `writing:autoFixIssue` 用于调用 AI 修正问题
- 新增 AI 修正服务方法 `autoFixPlotIssue` 
- 在 PlotCheckReportModal 组件中为每个问题添加"自动修正"按钮
- 修正过程中展示加载状态，修正成功后更新报告状态并同步修改编辑器内容

## Impact
- Affected specs: add-plot-check
- Affected code:
  - `src/shared/types/writing.types.ts` (修改 - 添加修正相关字段)
  - `src/main/services/writing/PlotCheckerService.ts` (修改 - 新增修正方法)
  - `src/main/ipc/handlers/writingHandlers.ts` (修改 - 新增修正 handler)
  - `src/main/preload.ts` (修改 - 暴露修正 API)
  - `src/renderer/components/Creative/WritingMode/PlotCheckReportModal.tsx` (修改 - 添加修正按钮)
  - `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx` (修改 - 处理修正回调)

## ADDED Requirements

### Requirement: 自动修正按钮
系统 SHALL 在剧情检查报告中每个可修正的问题条目下方提供一个"自动修正"按钮，用户可以点击触发针对该问题的定向修复操作。

#### Scenario: 显示修正按钮
- **WHEN** 报告展示且问题条目存在
- **THEN** 每个问题条目下方都显示"自动修正"按钮

#### Scenario: 点击修正按钮
- **WHEN** 用户点击"自动修正"按钮
- **THEN** 按钮显示加载状态，开始调用 AI 进行问题修正
- **AND** 原有报告内容保持完全不变（问题描述、格式排版、非问题部分文本等）

#### Scenario: 修正成功
- **WHEN** AI 修正成功返回修复后的内容
- **THEN** 按钮变为"已修正"状态并显示成功标识
- **AND** 问题条目的 `fixed` 字段标记为 true
- **AND** 编辑器内容自动更新为修正后的版本
- **AND** 报告结构保持完整，仅该问题状态更新

#### Scenario: 修正失败
- **WHEN** AI 修正失败或返回空结果
- **THEN** 按钮恢复为可点击状态
- **AND** 展示错误提示信息
- **AND** 报告内容完全不变

### Requirement: AI 智能修正
系统 SHALL 根据问题的类型、描述、建议以及章节原文，使用 AI 生成针对性的修正内容，仅修复标识的问题部分，保持其他内容不变。

#### Scenario: AI 修正流程
- **WHEN** 调用修正接口
- **THEN** 系统将问题描述、建议、当前章节内容传递给 AI
- **AND** AI 返回修正后的完整章节内容
- **AND** 修正仅针对标识的问题进行定向修改

### Requirement: 修正状态追踪
系统 SHALL 追踪每个问题的修正状态，已修正的问题应在视觉上与未修正的问题有所区分。

#### Scenario: 修正状态展示
- **WHEN** 问题已被修正
- **THEN** 该问题条目显示"已修正"标签或视觉标识
- **AND** 修正按钮变为禁用状态或显示"已修正"

## MODIFIED Requirements

### Requirement: PlotCheckIssue 类型
在 `PlotCheckIssue` 接口中添加以下可选字段：
- `fixable?: boolean` - 是否可自动修正（默认 true）
- `fixed?: boolean` - 是否已修正
- `fixResult?: string` - 修正后的内容片段（可选）

### Requirement: 修正 API 接口
新增 IPC 通道 `writing:autoFixIssue`，请求参数包含：
- `projectId` - 项目 ID
- `chapterIndex` - 章节索引
- `content` - 当前章节完整内容
- `issue` - 问题对象（包含 dimension, severity, description, suggestion, position 等）
- `modelConfig` - 模型配置（可选）

返回结果包含：
- `success` - 是否成功
- `fixedContent` - 修正后的完整章节内容
- `error` - 错误信息（失败时）

### Requirement: 报告组件交互
PlotCheckReportModal 组件 SHALL 支持修正状态管理和修正回调：
- 接收 `onAutoFix` 回调函数
- 修正成功后更新内部问题状态
- 保持报告所有原有内容完全不变
