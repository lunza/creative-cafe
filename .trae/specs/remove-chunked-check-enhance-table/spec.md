# 移除分片检查 & 增强表格整理 Spec

## Why
分片检查功能已经不再需要，需要彻底移除以保持代码库整洁。同时表格整理功能需要增强，添加"模板绑定"和"开始整理"按钮，使其具备完整的模板管理和数据整理能力，与聊天模式的表格整理体验保持一致。

## What Changes
- 删除 ChunkedCheckPanel.tsx 和 ChunkedCheckService.ts 两个文件
- 从 ContentWorkspace.tsx 中移除分片检查相关代码（import、state、按钮、JSX）
- 从 preload.ts 中移除 6 个分片检查 IPC API
- 从 writingHandlers.ts 中移除分片检查相关 import 和 6 个 IPC handler
- 在 WritingTablePreviewModal 底部操作栏添加"模板绑定"和"开始整理"按钮
- "模板绑定"按钮触发模板选择对话框，绑定后创建表格结构
- "开始整理"按钮调用后端整理逻辑对当前章节内容进行表格数据提取

## Impact
- Affected specs: refactor-chunked-check-to-table（该 spec 的遗留影响需要清理）、writing-mode-table-organizer
- Affected code:
  - **删除**: `src/renderer/components/Creative/WritingMode/ChunkedCheckPanel.tsx`
  - **删除**: `src/main/services/writing/ChunkedCheckService.ts`
  - **修改**: `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx`
  - **修改**: `src/main/preload.ts`
  - **修改**: `src/main/ipc/handlers/writingHandlers.ts`
  - **修改**: `src/renderer/components/Creative/WritingMode/WritingTablePreviewModal.tsx`
  - **修改**: `src/main/services/WritingStorageService.ts`（扩展整理相关方法）
  - **修改**: `src/renderer/types/electron.d.ts`（添加整理相关 API 类型）

## ADDED Requirements

### Requirement: 模板绑定按钮
系统 SHALL 在 WritingTablePreviewModal 底部操作栏提供"模板绑定"按钮。

#### Scenario: 模板绑定成功
- **WHEN** 用户点击"模板绑定"按钮
- **THEN** 弹出模板选择对话框，列出所有可用模板
- **WHEN** 用户选择一个模板并确认
- **THEN** 系统调用 `associateTableTemplate(projectId, templateId, templateName)` 创建表格结构
- **THEN** 刷新表格数据，显示新创建的表格

### Requirement: 开始整理按钮
系统 SHALL 在 WritingTablePreviewModal 底部操作栏提供"开始整理"按钮。

#### Scenario: 开始整理
- **WHEN** 用户点击"开始整理"按钮
- **THEN** 系统对当前项目的所有章节内容调用 AI 整理
- **THEN** 整理进度以 Modal 进度条形式展示
- **WHEN** 整理完成
- **THEN** 表格数据自动更新
- **THEN** 弹出完成提示消息

## MODIFIED Requirements

### Requirement: ContentWorkspace 移除分片检查
**修改原因**: 分片检查功能不再需要

```
从 ContentWorkspace 中彻底移除分片检查功能:
- 删除 ChunkedCheckPanel import
- 删除 showChunkedCheckModal 相关 state
- 删除 chunkedCheckResources 等配置变量
- 删除"分片检查"按钮
- 删除 ChunkedCheckPanel JSX 渲染
```

### Requirement: 后端移除分片检查
**修改原因**: 分片检查功能不再需要

```
从后端彻底移除分片检查功能:
- 删除 ChunkedCheckService.ts 文件
- 从 writingHandlers.ts 移除 chunkedCheckService import
- 移除 6 个 IPC handler (startChunkedCheck, pauseChunkedCheck, resumeChunkedCheck, stopChunkedCheck, getChunkedCheckProgress, getChunkedCheckSummary)
- 从 preload.ts 移除对应的 6 个 API 暴露
```

## REMOVED Requirements

### Requirement: 分片检查功能
**Reason**: 功能不再需要，代码库需要保持简洁
**Migration**: 无迁移路径，该功能被完全移除
