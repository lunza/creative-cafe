# 单章节表格整理功能 Spec

## Why
当前"表格整理"功能会遍历并处理项目中的所有章节，导致处理时间长、无法针对特定章节整理，且存在章节间循环调用的风险。用户需要仅整理当前选中的章节（蓝色高亮显示的章节），提升整理效率和用户体验。

## What Changes
- 修改"表格整理"按钮点击逻辑，将当前选中的章节ID和内容传递给表格预览弹窗
- 修改 `handleStartOrganize` 函数，仅处理单个章节而非遍历所有章节
- 修改后端 `organizeTable` 方法支持单章节处理模式
- 添加章节锁定状态防止整理过程中的章节切换
- 整理完成后自动解锁并返回初始状态

## Impact
- Affected specs: writing-mode-table-organizer
- Affected code:
  - `src/renderer/components/Creative/WritingMode/ContentWorkspace.tsx` - 修改表格整理按钮点击逻辑
  - `src/renderer/components/Creative/WritingMode/WritingTablePreviewModal.tsx` - 修改 handleStartOrganize
  - `src/main/services/WritingStorageService.ts` - 修改 organizeTable 和 processChapterWithAI

## ADDED Requirements

### Requirement: 单章节表格整理
系统 SHALL 支持仅整理当前选中的章节，而非遍历所有项目章节。

#### Scenario: 用户点击表格整理按钮
- **WHEN** 用户点击"表格整理"按钮
- **THEN** 系统打开表格预览弹窗，自动识别并标记当前选中的章节（蓝色高亮）
- **THEN** 点击"开始整理"时，仅处理当前选中章节的内容

#### Scenario: 整理过程中防止章节切换
- **WHEN** 整理任务正在进行中
- **THEN** 系统锁定当前章节选择，防止用户在整理过程中切换到其他章节
- **THEN** 整理完成后自动解除锁定

#### Scenario: 单章节整理完成
- **WHEN** 当前章节整理完成
- **THEN** 系统显示整理结果（成功/失败、处理的行数）
- **THEN** 自动刷新表格数据以反映最新整理结果
- **THEN** 解除章节锁定，允许用户切换到其他章节

## MODIFIED Requirements

### Requirement: 表格整理按钮
**修改原因**: 当前按钮打开弹窗后未传递当前章节信息

```
修改 ContentWorkspace 中的"表格整理"按钮点击逻辑:
- 点击时将当前章节的 index、title 和 content 传递给 WritingTablePreviewModal
- 弹窗通过 props 接收并存储当前章节信息
```

### Requirement: handleStartOrganize 整理逻辑
**修改原因**: 当前逻辑遍历所有项目章节

```
修改 WritingTablePreviewModal 中的 handleStartOrganize:
- 接收当前章节的 index 作为参数
- 调用 IPC API 时传递当前章节信息，而非遍历所有项目章节
- 仅处理单个章节的内容
```

### Requirement: WritingStorageService.organizeTable 方法
**修改原因**: 当前方法处理所有章节

```
修改 WritingStorageService 中的 organizeTable 方法:
- 增加可选参数 chapterIndex: number | undefined
- 当 chapterIndex 有值时，仅处理指定章节
- 当 chapterIndex 为 undefined 时，保留原有遍历所有章节的行为（向后兼容）
```

## REMOVED Requirements

### Requirement: 全项目章节遍历整理
**Reason**: 用户只需要整理当前选中章节，遍历所有章节效率低且容易导致循环调用
**Migration**: 改为单章节整理模式，用户可对任意章节独立执行整理操作
