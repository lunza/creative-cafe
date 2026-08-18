# 对话消息回退时表格跟随回退 Spec

## Why

用户在进行对话消息回退（点击"卷回到输入框"或"从版本重新生成"）后，记忆表格的内容没有跟随回退到对应版本，导致表格数据与对话上下文不一致。虽然系统中已有 `VersionLinkerService` 支持联动版本（聊天版本 + 表格快照），但尚未在保存对话时自动创建表格快照，卷回和重新生成时也未恢复表格数据。

## What Changes

### 联动版本自动创建
- 在 `saveCharacterTestChat` 保存对话时，除创建聊天版本外，同步创建联动版本（聊天版本 + 表格快照）
- 限制联动版本最多保留 10 个，超出时删除最旧版本

### 卷回到输入框时表格回退
- 在 `rollbackToMessage` 中，根据被卷回消息的时间戳找到对应的联动版本
- 如果该版本存在表格快照，将表格数据恢复到快照状态

### 从版本重新生成时表格回退
- 在 `retryMessageFromVersion` 中，恢复消息后也恢复对应版本的表格快照

### IPC 层
- 新增 `memory:restoreTableFromSnapshot` IPC handler，用于将表格数据恢复到指定版本快照

## Impact

- Affected specs: `rollback-user-message`（卷回逻辑）、`fix-and-upgrade-table-organize`（表格整理）
- Affected code:
  - `src/main/ipc/handlers/characterChatHandlers.ts`（保存对话时创建联动版本）
  - `src/main/ipc/handlers/memory/memoryTableHandlers.ts`（新增表格恢复 IPC）
  - `src/main/services/ChatVersionService.ts`（调整版本上限为 10）
  - `src/main/services/VersionLinkerService.ts`（新增版本上限管理）
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`（卷回/重新生成时恢复表格）

## ADDED Requirements

### Requirement: 对话保存时自动创建联动版本
系统 SHALL 在每次保存对话时自动创建联动版本（聊天版本 + 表格快照），联动版本数量上限为 10 个。

#### Scenario: 保存对话时创建联动版本
- **WHEN** 用户发送新消息或 AI 回复完成，触发 `saveCharacterTestChat`
- **THEN** 系统保存聊天版本，同时读取当前表格数据，调用 `createLinkedVersion` 创建联动版本
- **AND** 联动版本数超过 10 个时，删除最旧的联动版本（含聊天版本文件和表格快照文件）

#### Scenario: 联动版本数量控制
- **WHEN** 联动版本数量达到 10 个上限
- **THEN** 自动删除最旧的联动版本（包括聊天版本文件和表格快照文件）
- **AND** 更新版本索引（version-index.json）和变更日志（change-log.json）

### Requirement: 卷回到输入框时表格回退
系统 SHALL 在用户点击"卷回到输入框"时，将表格数据恢复到被卷回消息对应版本的快照状态。

#### Scenario: 卷回时找到对应版本并恢复表格
- **WHEN** 用户点击用户消息的卷回按钮
- **THEN** `rollbackToMessage` 通过被卷回消息的时间戳，在 `versionIndexRef` 中查找匹配的联动版本
- **AND** 如果找到且存在表格快照，调用 `memory:restoreTableFromSnapshot` 恢复表格数据
- **AND** 调用 `fetchMemoryTableData` 刷新内存中的 `memoryTableDataRef`
- **AND** 如果未找到对应版本或表格快照不存在，仅记录日志，不阻塞卷回流程

### Requirement: 从版本重新生成时表格回退
系统 SHALL 在用户点击"从此版本重新生成"时，将表格数据恢复到该版本对应的快照状态。

#### Scenario: 重新生成时恢复表格
- **WHEN** 用户点击助手消息的"从此版本重新生成"按钮
- **THEN** `retryMessageFromVersion` 恢复消息后，通过 `versionLinkId` 查找对应的表格快照
- **AND** 如果存在表格快照，调用 `memory:restoreTableFromSnapshot` 恢复表格数据
- **AND** 调用 `fetchMemoryTableData` 刷新内存中的 `memoryTableDataRef`

### Requirement: 新增表格恢复 IPC
系统 SHALL 提供 `memory:restoreTableFromSnapshot` IPC handler，用于将记忆表格数据恢复到指定快照。

#### Scenario: 成功恢复表格
- **WHEN** 调用 `memory:restoreTableFromSnapshot` 传入 `chatId` 和 `versionLinkId`
- **THEN** 从 `versions/table/{versionLinkId}.json` 读取快照数据
- **AND** 将快照数据写入当前表格数据文件（`chatlog/{chatId}.json`）
- **AND** 返回 `{ success: true, sheets, headers, data }`

## MODIFIED Requirements

### Requirement: 版本数量上限调整
**变更**：`ChatVersionService.MAX_VERSIONS` 从 20 调整为 10，与联动版本上限一致。

### Requirement: VersionLinkerService 版本上限管理
**变更**：`VersionLinkerService.createLinkedVersion` 方法新增版本上限控制，当 `version-index.json` 中的版本数达到 `MAX_LINKED_VERSIONS = 10` 时，删除最旧的联动版本（聊天版本文件 + 表格快照文件 + 索引记录）。

## REMOVED Requirements

无。