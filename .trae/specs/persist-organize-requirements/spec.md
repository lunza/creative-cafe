# 持久化保存表格整理要求 Spec

## Why

当前整理要求输入框的内容在页面刷新或关闭后会丢失，用户需要每次重新输入。将整理要求持久化保存到表格配置中，可以在下次打开时自动加载，提升用户体验。

## What Changes

- 在 `WritingTableConfig` 类型中新增 `organizeRequirements` 字段
- 整理要求输入框失去焦点时自动保存到表格配置
- 页面加载时从表格配置加载已保存的整理要求
- 整理时默认使用保存的要求，用户可临时修改
- 在表格配置面板显示当前保存的整理要求

## Impact

- 受影响的类型：`writing.types.ts` - `WritingTableConfig` 增加 `organizeRequirements` 字段
- 受影响的组件：`WritingModeRightPanel.tsx` - 输入框加载/保存逻辑
- 受影响的 IPC：`writingHandlers.ts` - 可能需要新增保存要求的接口（或复用 saveTableConfig）
- 受影响的存储：`WritingStorageService.ts` - `saveTableConfig` / `getTableConfig`

## ADDED Requirements

### Requirement: 持久化保存整理要求
系统 SHALL 将用户输入的整理要求持久化保存到表格配置中。

#### Scenario: 输入后自动保存
- **WHEN** 用户在整理要求输入框中输入内容并失去焦点（或按 Enter）
- **THEN** 系统将内容保存到表格配置的 `organizeRequirements` 字段
- **THEN** 显示保存成功的轻量提示（不阻断用户操作）

#### Scenario: 页面加载时恢复
- **WHEN** 用户进入表格整理面板
- **THEN** 系统从表格配置加载 `organizeRequirements`
- **THEN** 输入框显示已保存的要求

### Requirement: 整理时使用保存的要求
系统 SHALL 在开始整理时默认使用保存的整理要求。

#### Scenario: 使用保存的要求整理
- **WHEN** 用户点击"开始整理"且输入框不为空
- **THEN** 使用当前输入框中的内容作为整理要求

#### Scenario: 保存的要求为空
- **WHEN** 用户点击"开始整理"且保存的要求为空
- **THEN** 正常执行整理（向后兼容）

## MODIFIED Requirements

### Requirement: WritingTableConfig 数据结构
原 `WritingTableConfig` 包含 `enabled`, `autoOrganize`, `organizeMode`, `associatedTemplateId`, `associatedTemplateName`。修改为增加 `organizeRequirements?: string` 字段。

## REMOVED Requirements

无。
