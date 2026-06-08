# 表格整理面板 - 完整表格查看与编辑模态框 Spec

## Why

右侧辅助面板的表格整理页签中，表格显示限制为前20行（`dataSource.slice(0, pageSize)`，pageSize 默认20），超出部分仅显示"显示前 20 行，共 X 行"的提示文字，用户无法查看或编辑超出部分的数据。对于行数较多的表格，用户需要完整的查看和编辑能力。

## What Changes

- 在表格整理面板的操作按钮区域新增"查看全部数据"按钮
- 创建一个新的模态框组件 `FullTableModal`，展示完整表格数据
- 模态框内支持：分页浏览全部数据、搜索/筛选、行编辑、添加新行、删除行
- 数据修改后自动同步到主表格并持久化保存

## Impact

- 受影响的组件：`WritingModeRightPanel.tsx`（`TableOrganizePanelContent` 新增按钮和模态框）
- 受影响的 IPC API：`writing.table.updateRowInTable`、`writing.table.saveTableData`（已有）
- 无新增 IPC 接口，复用现有表格操作 API

## ADDED Requirements

### Requirement: 完整表格查看按钮
系统 SHALL 在表格整理面板的操作按钮区域提供"查看全部数据"按钮，当存在表格数据时可用。

#### Scenario: 点击查看全部数据
- **WHEN** 用户在表格整理面板中点击"查看全部数据"按钮
- **THEN** 弹出模态框，展示当前 sheet 的完整表格数据（不限行数）
- **THEN** 模态框标题显示当前 sheet 名称和总行数

#### Scenario: 无数据时按钮禁用
- **WHEN** 表格无数据时
- **THEN** "查看全部数据"按钮显示为禁用状态

### Requirement: 模态框内完整数据浏览
系统 SHALL 在模态框内以 Ant Design Table 组件展示全部数据，支持分页、排序。

#### Scenario: 分页浏览
- **WHEN** 模态框打开且数据超过一页
- **THEN** 表格底部显示分页器，默认每页20行，支持切换每页10/20/50/100行
- **THEN** 用户可通过分页器浏览所有数据行

### Requirement: 模态框内搜索筛选
系统 SHALL 提供搜索框，支持在当前 sheet 的所有列中搜索匹配的文字。

#### Scenario: 搜索过滤
- **WHEN** 用户在搜索框中输入文字
- **THEN** 表格实时过滤，仅显示包含搜索文字的行的任意单元格匹配该文字
- **WHEN** 用户清空搜索框
- **THEN** 表格恢复显示全部数据

### Requirement: 模态框内单元格编辑
系统 SHALL 支持双击单元格进入编辑模式，编辑完成后同步到存储。

#### Scenario: 编辑单元格
- **WHEN** 用户双击表格中的单元格
- **THEN** 单元格变为可编辑的输入框
- **WHEN** 用户按 Enter 或输入框失去焦点
- **THEN** 保存修改并调用 IPC API 同步到存储
- **WHEN** 保存成功
- **THEN** 显示"已同步"提示，更新同步时间

### Requirement: 模态框内添加新行
系统 SHALL 提供"新增行"按钮，允许用户在当前 sheet 末尾添加空白数据行。

#### Scenario: 添加新行
- **WHEN** 用户点击"新增行"按钮
- **THEN** 在表格末尾添加一行空白数据，各字段初始化为空字符串
- **WHEN** 用户编辑新行的单元格后保存
- **THEN** 新行数据同步到存储

### Requirement: 模态框内删除行
系统 SHALL 支持删除指定数据行，删除前弹出确认对话框。

#### Scenario: 删除行
- **WHEN** 用户点击某行的删除按钮
- **THEN** 弹出确认对话框："确定删除第 N 行？"
- **WHEN** 用户确认删除
- **THEN** 该行从表格中移除，调用 IPC API 同步到存储
- **WHEN** 删除成功
- **THEN** 显示删除成功提示

### Requirement: 模态框内保存全部
系统 SHALL 提供"保存全部"按钮，将模态框内所有修改同步到存储。

#### Scenario: 保存全部
- **WHEN** 用户在模态框内编辑多个单元格后点击"保存全部"
- **THEN** 将当前 sheet 的所有数据保存到存储
- **WHEN** 保存成功
- **THEN** 显示保存成功提示

### Requirement: 模态框内导出 CSV
系统 SHALL 提供"导出CSV"按钮，导出当前 sheet 全部数据。

#### Scenario: 导出 CSV
- **WHEN** 用户点击"导出CSV"按钮
- **THEN** 下载当前 sheet 全部数据的 CSV 文件

### Requirement: Sheet 切换
系统 SHALL 在模态框顶部显示 sheet 切换标签，与面板内的 sheet 切换保持一致。

#### Scenario: 切换 sheet
- **WHEN** 用户在模态框内切换 sheet
- **THEN** 表格显示对应 sheet 的数据
- **THEN** 面板内的 sheet 也同步切换

## MODIFIED Requirements

### Requirement: TableOrganizePanelContent 表格区域显示
原 `TableOrganizePanelContent` 中表格区域限制显示前 `pageSize` 行。保持不变，但在下方增加"查看全部数据"按钮入口，引导用户进入完整编辑模态框。

### Requirement: 数据同步状态
模态框内每次编辑保存后，需同步更新面板主区域的 `allSheetData` 状态和 `lastSynced` 时间，确保两处显示一致。

## REMOVED Requirements

无。
