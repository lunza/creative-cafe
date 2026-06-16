# 整理单个表格功能 Spec

## Why

当前表格整理功能（organizeTable）会处理模板中的所有 sheet（表格页签）。但用户有时只想整理特定表格（如"时空表格"或"角色表格"），而不需要重新整理其他表格。添加单表格整理功能可以让用户定向整理指定表格，节省时间和 API 调用次数。

## What Changes

- 在 `WritingStorageService.ts` 中新增 `organizeSingleSheet` 方法，只处理指定的单个 sheet
- 新增 `buildSingleSheetOrganizePrompt` 方法，构建只包含所选表格信息的提示词
- 在 `writingHandlers.ts` 中新增 IPC handler `writing:table:organizeSingleSheet`
- 在 `preload.ts` 中新增 `organizeSingleSheet` 接口
- 在 `WritingModeRightPanel.tsx` 中添加"整理单个表格"按钮和表格选择界面

## Impact

- 受影响的文件：
  - `WritingStorageService.ts` — 新增 `organizeSingleSheet` 方法和 `buildSingleSheetOrganizePrompt`
  - `writingHandlers.ts` — 新增 IPC handler
  - `preload.ts` — 新增接口
  - `WritingModeRightPanel.tsx` — 新增按钮和选择界面

## ADDED Requirements

### Requirement: 整理单个表格
系统 SHALL 提供整理单个表格的功能，仅对用户选择的特定表格进行整理。

#### Scenario: 选择表格并整理
- **WHEN** 用户点击"整理单个表格"按钮
- **THEN** 显示表格选择界面（列出当前绑定的模板包含的所有 sheet 名称和描述）
- **WHEN** 用户选择一个 sheet 并点击"开始整理"
- **THEN** 系统仅对该 sheet 进行整理，其他 sheet 不受影响

#### Scenario: 单表格整理的提示词
- **WHEN** 调用 AI 整理单个表格
- **THEN** 提示词中仅包含所选表格的上下文信息（sheet 名称、字段定义、现有数据）
- **THEN** 提示词中明确说明只处理该表格

### Requirement: 视觉风格一致
"整理单个表格"按钮应与现有"整理全部表格"按钮在视觉风格上保持一致。

## MODIFIED Requirements

### Requirement: organizeTable 方法
`organizeTable` 方法保持不变，继续处理所有 sheet。新增的 `organizeSingleSheet` 方法是独立的新功能。

## REMOVED Requirements

无。
