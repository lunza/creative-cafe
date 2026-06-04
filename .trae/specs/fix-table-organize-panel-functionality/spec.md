# 修复辅助面板表格整理功能 Spec

## Why
辅助面板中的表格整理页签（`TableOrganizePanelContent`）内容为空或缺少核心功能，原有的 `WritingTablePreviewModal` 包含完整的关联模板、整理表格等功能，但迁移到辅助面板时只实现了数据显示，遗漏了核心操作功能。

## What Changes
- 在 `TableOrganizePanelContent` 中完整迁移 `WritingTablePreviewModal` 的所有核心功能
- 保持原有样式和操作逻辑不变，仅从弹窗形式改为页签形式
- 更新 `ContentWorkspace` 向 `WritingModeRightPanel` 传递必要的 props

## Impact
- 受影响的组件：`WritingModeRightPanel.tsx`（`TableOrganizePanelContent`）
- 受影响的组件：`ContentWorkspace.tsx`（传递更多 props）
- 受影响的类型：`WritingModeRightPanelProps` 接口扩展

## ADDED Requirements

### Requirement: 表格整理功能完整性
系统 SHALL 在辅助面板的表格整理页签中提供与原来弹窗完全相同的功能。

#### Scenario: 关联模板
- **WHEN** 用户点击"绑定模板"按钮
- **THEN** 弹出模板选择对话框，显示所有可用模板
- **THEN** 用户选择并绑定模板后，创建对应的表格结构

#### Scenario: 开始整理
- **WHEN** 用户点击"开始整理"按钮
- **THEN** 系统检查是否已绑定模板，未绑定则提示
- **THEN** 调用AI引擎对当前章节内容进行表格整理
- **THEN** 显示整理进度条和状态信息
- **THEN** 整理完成后刷新表格数据

#### Scenario: 保存和导出
- **WHEN** 用户编辑表格内容后点击"保存修改"
- **THEN** 表格数据持久化到存储
- **WHEN** 用户点击"导出CSV"
- **THEN** 下载当前表格的CSV文件

#### Scenario: 清空数据
- **WHEN** 用户点击"清空当前表格"或"清空所有表格"
- **THEN** 弹出确认对话框
- **THEN** 确认后清空对应数据

### Requirement: 视觉和操作一致性
系统 SHALL 保持原有的按钮样式、布局和操作方式。

#### Scenario: 按钮布局
- **WHEN** 查看表格整理页签
- **THEN** 操作按钮排列在顶部工具栏区域
- **THEN** 按钮样式、图标、文字与原弹窗一致
