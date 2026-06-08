# 表格行重新整理功能 Spec

## Why

在完整表格编辑模态框中，用户可能希望对某条特定数据记录进行单独调整，而无需重新整理整个章节。当前表格操作栏只有删除按钮，缺少对单行数据的重新整理能力。添加"重新整理"按钮可以让用户针对特定行输入整理要求，由 AI 智能优化该行数据。

## What Changes

- 在完整表格模态框操作栏新增"重新整理"按钮（SyncOutlined 图标）
- 点击后弹出输入框对话框，用户输入整理要求
- 调用新增的 IPC 接口 `writing:table:reorganizeRow` 对单行进行 AI 整理
- 整理过程中显示加载状态，完成后更新表格数据
- 后端新增单行整理逻辑，保持唯一 ID 不变

## Impact

- 受影响的组件：`WritingModeRightPanel.tsx`（FullTableModal 操作栏新增按钮 + 输入弹窗 + 重新整理逻辑）
- 受影响的 IPC：新增 `writing:table:reorganizeRow` 接口
- 受影响的 IPC Handler：`writingHandlers.ts` 新增 handler
- 受影响的类型：`preload.ts` 新增接口定义

## ADDED Requirements

### Requirement: 重新整理按钮
系统 SHALL 在完整表格模态框每条记录的操作栏提供"重新整理"按钮。

#### Scenario: 显示按钮
- **WHEN** 用户查看完整表格模态框
- **THEN** 每条记录的操作栏显示"重新整理"按钮（刷新图标）和"删除"按钮
- **THEN** 按钮尺寸与删除按钮一致，提供悬停状态反馈

#### Scenario: 点击按钮
- **WHEN** 用户点击某行的"重新整理"按钮
- **THEN** 弹出输入框对话框，标题为"重新整理第 N 行"
- **THEN** 对话框包含 TextArea 输入整理要求，带有占位提示文字
- **THEN** 对话框包含"确定"和"取消"按钮

#### Scenario: 提交整理
- **WHEN** 用户输入整理要求并点击"确定"
- **THEN** 如果输入为空，提示用户输入要求
- **THEN** 调用 AI 整理接口对该行进行重新整理
- **THEN** 整理过程中该行的"重新整理"按钮显示加载状态
- **THEN** 整理完成后更新该行数据并刷新显示
- **THEN** 显示成功提示，包含整理结果说明

#### Scenario: 整理失败
- **WHEN** AI 整理失败
- **THEN** 显示错误提示
- **THEN** 原数据保持不变

### Requirement: 单行重新整理 IPC 接口
系统 SHALL 提供 `writing:table:reorganizeRow` IPC 接口，用于单行数据的 AI 重新整理。

#### Scenario: 调用接口
- **WHEN** 前端调用 `writing:table:reorganizeRow(projectId, sheet, rowIndex, rowData, requirements)`
- **THEN** 后端接收参数并调用 AI 服务
- **THEN** 返回整理后的行数据

### Requirement: 单行重新整理后端逻辑
系统 SHALL 在后端实现单行重新整理逻辑，保持唯一 ID 不变。

#### Scenario: AI 整理单行
- **WHEN** 后端收到单行重新整理请求
- **THEN** 构建提示词，包含模板信息、当前行数据、用户整理要求
- **THEN** 调用 AI 服务生成新的行数据
- **THEN** 保持行数据中的唯一 ID 字段不变
- **THEN** 将新数据更新到存储并返回

## MODIFIED Requirements

### Requirement: 操作栏布局
原操作栏只有删除按钮。修改为包含"重新整理"和"删除"两个按钮。

## REMOVED Requirements

无。
