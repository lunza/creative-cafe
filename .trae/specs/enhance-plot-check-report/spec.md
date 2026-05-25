# 剧情检查报告引用增强与批量一键修复 Spec

## Why
当前剧情检查报告的问题描述缺乏相关原文片段和资料引用标注，用户难以快速定位问题在章节中的具体位置。同时，自动修正功能仅支持逐个问题修复，当存在多个问题时操作效率低下。需要增强报告的引用标注能力并实现批量一键修复。

## What Changes
- 在 PlotCheckIssue 类型中添加 `originalText`（相关原文片段）和 `references`（参考资料引用）字段
- 在 PlotCheckReport 类型中添加 `batchFixed` 字段用于批量修正状态
- 在 PlotCheckReportModal 中为每个问题展示原文片段和引用来源
- 在 PlotCheckReportModal 中添加复选框勾选机制和"一键修复选中问题"按钮
- 新增 IPC 通道 `writing:batchFixIssues` 用于批量修正
- 新增 AI 批量修正方法 `batchFixIssues`，将多个问题结构化拼接后通过单次 API 请求发送给 AI
- AI 在保持未涉及问题内容完全不变的前提下，仅对勾选问题涉及的部分进行精准替换

## Impact
- Affected specs: add-plot-check-auto-fix（扩展）
- Affected code:
  - `src/shared/types/writing.types.ts` (修改 - 添加引用和批量修正相关字段)
  - `src/main/services/writing/PlotCheckerService.ts` (修改 - 新增批量修正方法，增强问题检测以提取原文片段)
  - `src/main/ipc/handlers/writingHandlers.ts` (修改 - 新增批量修正 handler)
  - `src/main/preload.ts` (修改 - 暴露批量修正 API)
  - `src/renderer/components/Creative/WritingMode/PlotCheckReportModal.tsx` (修改 - 添加引用展示、复选框、批量修复按钮)
  - `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx` (修改 - 处理批量修正回调)

## ADDED Requirements

### Requirement: 原文片段引用
系统 SHALL 为每个检查出的问题附加相关原文片段，帮助用户快速定位问题在章节中的具体位置。原文片段应：
1. 包含问题出现位置前后若干字符的上下文
2. 在问题出现的具体文字处使用标注（如高亮或下划线）
3. 当问题涉及多个位置时，展示所有相关的原文片段

#### Scenario: 问题包含原文片段
- **WHEN** 剧情检查报告生成
- **THEN** 每个问题条目都包含 `originalText` 字段，记录问题相关的原文片段
- **AND** 原文片段准确对应问题出现的具体位置

#### Scenario: 前端展示原文片段
- **WHEN** 用户在 PlotCheckReportModal 中查看问题详情
- **THEN** 在问题描述下方展示原文片段引用
- **AND** 原文片段以代码块或引用块形式展示，问题位置有高亮标注

### Requirement: 资料引用
系统 SHALL 为每个问题附加参考资料引用，清晰标注引用的来源信息。参考资料引用应：
1. 标识引用来源类型（世界书条目、角色卡、前序章节等）
2. 包含来源的名称和关键信息摘要
3. 当问题涉及多个参考资料时，列出所有相关的引用

#### Scenario: 问题包含资料引用
- **WHEN** 剧情检查报告生成
- **THEN** 每个问题条目都包含 `references` 字段，记录相关的参考资料
- **AND** 每个引用包含来源类型、名称和内容摘要

#### Scenario: 前端展示资料引用
- **WHEN** 用户在 PlotCheckReportModal 中查看问题详情
- **THEN** 在原文片段下方展示参考资料引用列表
- **AND** 每个引用以标签或列表项形式展示，标注来源类型

### Requirement: 批量问题勾选
系统 SHALL 允许用户在剧情检查报告中勾选多个问题，支持全选、反选和单选操作。

#### Scenario: 勾选问题
- **WHEN** 用户查看剧情检查报告
- **THEN** 每个问题条目前方显示复选框
- **AND** 用户可点击复选框勾选或取消勾选该问题
- **AND** 提供"全选"和"取消全选"操作按钮

#### Scenario: 批量修复按钮
- **WHEN** 用户勾选了至少一个问题
- **THEN** 在报告顶部或底部显示"一键修复选中问题(N)"按钮
- **AND** 按钮显示当前选中的问题数量
- **AND** 当未勾选任何问题时，按钮禁用或隐藏

### Requirement: 批量一键修复
系统 SHALL 支持用户触发一键修复所有选中的问题。触发批量修复时：
1. 将所有选中问题的详细信息（问题描述、原文片段、资料引用、修复建议）进行结构化拼接
2. 通过单次 API 请求发送给 AI
3. AI 仅对选中问题涉及的章节原文进行精准替换，保持其他内容完全不变
4. 返回修复后的完整章节内容和每个问题的修复结果

#### Scenario: 执行批量修复
- **WHEN** 用户点击"一键修复选中问题"按钮
- **THEN** 系统将选中问题的结构化信息通过 `writing:batchFixIssues` 接口发送给 AI
- **AND** 批量修复过程中展示加载状态
- **AND** AI 在单次 API 请求中处理所有问题

#### Scenario: 批量修复成功
- **WHEN** 批量修复成功返回
- **THEN** 编辑器内容更新为修复后的版本
- **AND** 报告中所有选中问题标记为"已修复"状态
- **AND** 展示批量修复结果摘要（成功修复数量、部分修复数量、失败数量）

#### Scenario: 批量修复部分失败
- **WHEN** 批量修复中部分问题修复失败
- **THEN** 成功修复的问题标记为"已修复"
- **AND** 失败的问题保持原状态并展示错误信息
- **AND** 编辑器内容更新为部分修复后的版本
- **AND** 展示修复结果摘要

#### Scenario: 批量修复全部失败
- **WHEN** 批量修复全部失败
- **THEN** 所有问题保持原状态
- **AND** 编辑器内容不变
- **AND** 展示错误提示信息

### Requirement: 批量修复 API 接口
新增 IPC 通道 `writing:batchFixIssues`，请求参数包含：
- `projectId` - 项目 ID
- `chapterIndex` - 章节索引
- `content` - 当前章节完整内容
- `issues` - 问题对象数组（包含 dimension, severity, description, suggestion, originalText, references, position 等）
- `modelConfig` - 模型配置（可选）

返回结果包含：
- `success` - 是否成功
- `fixedContent` - 修复后的完整章节内容
- `results` - 每个问题的修复结果数组（包含 issue index, success, error）
- `error` - 错误信息（失败时）

## MODIFIED Requirements

### Requirement: PlotCheckIssue 类型
在 `PlotCheckIssue` 接口中添加以下可选字段：
- `originalText?: { snippet: string; start: number; end: number }[]` - 相关原文片段数组，包含片段内容、起始位置和结束位置
- `references?: { type: string; name: string; summary: string }[]` - 参考资料引用数组，包含来源类型、名称和内容摘要
- `fixable?: boolean` - 是否可自动修正（默认 true）
- `fixed?: boolean` - 是否已修正

### Requirement: PlotCheckReport 类型
在 `PlotCheckReport` 接口中添加以下可选字段：
- `batchFixed?: boolean` - 是否经过批量修复

### Requirement: 修正 API 接口
扩展 `writing:autoFixIssue` 的返回结果，添加 `fixedIssue` 字段标记已修复的问题状态。

### Requirement: 报告组件交互
PlotCheckReportModal 组件 SHALL 支持：
- 问题复选框勾选状态管理
- 批量修复回调 `onBatchFix`
- 引用信息展示（原文片段 + 资料引用）
- 批量修复结果摘要展示
