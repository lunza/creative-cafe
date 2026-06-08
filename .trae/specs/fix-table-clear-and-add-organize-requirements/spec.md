# 修复表格清空功能及优化开始整理 Spec

## Why

1. "清空所有表格"和"清空当前表格"按钮点击后虽然调用了清空 API，但 `loadTableData()` 仅在响应有数据时更新状态，没有清空本地 state（sheets、allSheetData、tableData 等），导致 UI 仍显示旧数据。
2. "开始整理"按钮缺少用户输入整理要求的输入框，AI 无法获取用户的整理侧重点，整理质量受限。

## What Changes

- 修复 `handleClearCurrentSheet` 和 `handleClearAll` 清空后正确重置本地状态
- 在"开始整理"按钮上方添加多行文本输入框，用于输入整理要求
- 修改 IPC 接口和后端 `organizeTable` 方法，支持接收用户整理要求参数
- 整理提示词中引用用户输入的要求

## Impact

- Affected code:
  - `WritingModeRightPanel.tsx` - 清空函数修复 + 新增整理要求输入框
  - `writingHandlers.ts` - `organizeTable` IPC handler 增加 requirements 参数
  - `WritingStorageService.ts` - `organizeTable` 方法增加 requirements 参数
  - `TableOrganizer.ts` - 提示词构建引用用户要求

## ADDED Requirements

### Requirement: 整理要求输入框
系统 SHALL 在"开始整理"按钮上方提供多行文本输入框，用于输入表格整理的侧重点和具体要求。

#### Scenario: 输入整理要求
- **WHEN** 用户在输入框中输入文字
- **THEN** 输入框显示占位提示："请输入表格整理的侧重点和要求，例如：重点关注角色关系、战斗数据等"
- **THEN** 输入框支持多行文本，高度约80px，可滚动

#### Scenario: 点击开始整理
- **WHEN** 用户点击"开始整理"按钮
- **THEN** 系统将输入框中的要求传递给 AI 整理接口
- **THEN** 如果输入框为空，整理接口正常执行（向后兼容）

### Requirement: 清空当前表格功能修复
系统 SHALL 在清空当前表格后正确重置所有相关本地状态。

#### Scenario: 清空当前表格
- **WHEN** 用户确认清空当前表格
- **THEN** 调用 `saveTableData(projectId, currentSheet, [])` 清空存储中的表格数据
- **THEN** 重置本地 state：`allSheetData` 中对应 sheet 设为空数组、`tableData` 设为空数组
- **THEN** 显示成功提示

### Requirement: 清空所有表格功能修复
系统 SHALL 在清空所有表格后正确重置所有相关本地状态。

#### Scenario: 清空所有表格
- **WHEN** 用户确认清空所有表格
- **THEN** 调用 `clearTableData(projectId)` 清空存储中的所有表格数据
- **THEN** 重置本地 state：`sheets` 设为空数组、`allSheetData` 设为空对象、`tableData` 设为空数组、`currentSheet` 设为空字符串
- **THEN** 显示成功提示

## MODIFIED Requirements

### Requirement: organizeTable IPC 接口
原 `writing:table:organizeTable` handler 接受 `(projectId, modelConfig, chapterIndex)` 参数。修改为接受 `(projectId, modelConfig, chapterIndex, requirements?)` 参数，其中 `requirements` 为可选的字符串，描述用户整理的侧重点。

### Requirement: WritingStorageService.organizeTable 方法
原方法签名为 `(projectId, modelConfig, chapterIndex?, onProgress?)`。修改为 `(projectId, modelConfig, chapterIndex?, onProgress?, requirements?)`。

### Requirement: TableOrganizer 提示词构建
原提示词仅包含模板信息和章节内容。修改为在提示词中增加"用户整理要求"部分（当 requirements 不为空时），使 AI 按照用户的侧重点进行整理。

## REMOVED Requirements

无。
