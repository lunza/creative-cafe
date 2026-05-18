# 聊天记录版本管理功能 Spec

## Why
当前系统在与角色卡对话时，每次AI回复后不会自动保存版本记录。用户无法回溯到历史对话状态，也无法从特定版本重新生成回复。需要引入版本管理机制，让用户能够查看、编辑和回退到历史对话版本。

## What Changes
- 新增聊天记录版本自动创建机制：AI回复完成后自动保存版本文件
- 版本文件存储结构变更：在原有聊天记录目录下新增 versions 子目录
- ChatMessageBubble 组件修改：根据版本信息动态显示不同操作按钮
- CharacterDialogueChat hooks 新增版本管理逻辑
- ChatManager 编辑界面新增版本下拉选择控件

## Impact
- Affected specs: 聊天记录存储、对话气泡操作按钮、记忆管理-聊天记录编辑
- Affected code:
  - `src/main/services/ChatVersionService.ts` (新增)
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx`
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts`
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx`
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts`
  - `src/renderer/components/MemoryChat/ChatManager.tsx`
  - `src/main/ipc/handlers/memoryHandlers.ts`
  - `src/main/ipc/handlers/characterChatHandlers.ts`
  - `src/renderer/types/memory.ts`

## ADDED Requirements

### Requirement: 版本自动创建
系统 SHALL 在AI回复完成后自动创建聊天记录版本。

#### Scenario: AI回复完成自动创建版本
- **WHEN** AI回复完成且消息状态变为 'sent'
- **THEN** 系统自动将当前完整聊天记录保存为版本文件
- **AND** 版本文件命名格式为：`{序号}_{角色卡名称}_{时间戳}.json`
- **AND** 版本文件存储在 `{characterCardName}/versions/` 目录下

#### Scenario: 版本数量限制
- **WHEN** 版本数量超过19个历史版本
- **THEN** 系统自动删除最早创建的版本文件
- **AND** 再生成新的版本文件
- **AND** 始终保持最多20个版本（19历史 + 1最新）

### Requirement: 操作按钮显示规则
系统 SHALL 根据版本信息动态显示不同的操作按钮。

#### Scenario: 最新版本显示完整操作按钮组
- **WHEN** 对话气泡对应最新版本的AI回复
- **THEN** 显示功能操作按钮组（继续对话、编辑内容、重新生成）

#### Scenario: 历史版本仅显示重新生成按钮
- **WHEN** 对话气泡对应非最新版本的AI回复
- **THEN** 仅显示重新生成按钮
- **AND** 不显示继续对话和编辑内容按钮

#### Scenario: 版本信息删除后不显示操作按钮
- **WHEN** 聊天记录的版本信息被删除
- **THEN** 对应对话气泡下的所有操作按钮均不显示

### Requirement: 历史版本重新生成
系统 SHALL 支持从历史版本触发重新生成。

#### Scenario: 点击历史版本的重新生成按钮
- **WHEN** 用户点击非最新版本的重新生成按钮
- **THEN** 系统自动将聊天记录回退到该版本状态
- **AND** 触发AI重新生成回复内容
- **AND** 执行与当前重新生成逻辑一致的后续处理流程

### Requirement: 版本下拉选择控件
系统 SHALL 在记忆管理的聊天记录编辑界面提供版本选择功能。

#### Scenario: 编辑界面显示版本下拉控件
- **WHEN** 用户导航至记忆管理 > 聊天记录管理 > 编辑聊天记录
- **THEN** 编辑界面新增版本下拉选择控件
- **AND** 下拉控件列出该聊天记录的所有可用版本
- **AND** 用户可选择查看或编辑对应版本内容
