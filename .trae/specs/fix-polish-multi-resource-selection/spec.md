# 修复 AI 润色多资源选择问题

## Why
用户报告在使用创意 AI 润色功能时，选择多个资源（世界书、角色卡、用户人设）后，系统仅处理最后一个资源。需要添加详细的日志记录、去重机制和边界条件处理，确保所有选中的资源都被正确整合。

## What Changes
- 在资源加载和拼接过程中添加详细的日志记录，便于追踪问题
- 添加资源 ID 去重机制，防止重复选择同一资源
- 添加资源内容为空时的处理逻辑
- 添加无资源选择时的默认行为处理
- 确保资源按用户选择顺序或预设优先级整合

## Impact
- Affected specs: add-creative-description-polish, fix-polish-dialog-and-hardcoded-defaults（追加修改）
- Affected code:
  - `src/main/services/WritingResourceManager.ts` - 添加日志、去重、边界处理
  - `src/main/ipc/handlers/writingHandlers.ts` - 添加资源处理日志
  - `src/renderer/components/Creative/WritingMode/WritingConfigModal.tsx` - 添加资源选择日志

## ADDED Requirements

### Requirement: 资源去重机制
系统 SHALL 对用户选择的资源 ID 进行去重处理，确保同一资源不会被重复加载和处理。

#### Scenario: 重复选择同一资源
- **WHEN** 用户多次选择同一资源 ID
- **THEN** 系统应自动去重，仅加载和处理一次

### Requirement: 资源内容为空处理
系统 SHALL 正确处理资源内容为空的情况，不影响其他资源的整合。

#### Scenario: 资源内容为空
- **WHEN** 某个资源的内容字段为空或 undefined
- **THEN** 系统应跳过该资源的空内容，继续处理其他资源

### Requirement: 无资源选择默认行为
系统 SHALL 在用户未选择任何资源时，仅基于创意描述文本进行润色。

#### Scenario: 无资源选择
- **WHEN** 用户未选择任何世界书、角色卡或用户人设
- **THEN** 系统应正常执行润色，不报错，不添加资源上下文

### Requirement: 详细日志记录
系统 SHALL 在资源加载和拼接过程中记录详细日志，便于问题追踪。

#### Scenario: 资源处理日志
- **WHEN** 系统处理资源选择
- **THEN** 应记录选择的资源 ID 列表、加载的资源数量、拼接的资源上下文长度

## MODIFIED Requirements

### Requirement: 多资源内容有序拼接
系统 SHALL 按照用户选择的顺序整合所有选中资源的内容，确保不遗漏任何资源。

#### Scenario: 选择多个不同类型资源
- **WHEN** 用户同时选择世界书、角色卡和用户人设
- **THEN** 系统应按预设优先级（用户人设 → 角色信息 → 世界观设定）整合所有资源内容

#### Scenario: 选择多个相同类型资源
- **WHEN** 用户选择多个世界书或多个角色卡
- **THEN** 系统应按用户选择顺序依次整合所有同类资源内容
