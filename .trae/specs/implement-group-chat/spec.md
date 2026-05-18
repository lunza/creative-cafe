# 群聊模式功能规范

## Why
当前 Creative Café 仅支持 1v1 单角色对话模式，无法满足多角色互动创作场景（如角色扮演故事、多角色讨论等）的需求。需要参考 SillyTavern 群聊功能的设计理念，独立开发一套全新的群聊模式，同时严格保持现有单聊功能的完整性和稳定性。

## What Changes
- 新增 `src/shared/types/groupChat.types.ts` - 群聊独立类型定义
- 新增 `src/main/services/GroupChat/` - 群聊后端存储服务（独立目录）
- 新增 `src/main/ipc/handlers/groupHandlers.ts` - 群组管理 IPC
- 新增 `src/main/ipc/handlers/groupChatHandlers.ts` - 群聊消息 IPC
- 新增 `src/renderer/types/groupChat.types.ts` - 渲染进程类型定义
- 新增 `src/renderer/components/GroupChat/` - 群聊 UI 组件（独立目录）
- 新增 `src/renderer/stores/groupChatStore.ts` - 群聊 Zustand 状态管理
- 新增 `src/renderer/hooks/useGroupDialogueChat.ts` - 群聊业务逻辑 Hook
- 新增 `src/renderer/hooks/useGroupActivation.ts` - 角色激活策略 Hook
- 新增 `src/renderer/hooks/useGroupGeneration.ts` - 生成模式 Hook
- 修改 `src/main/ipc/index.ts` - 仅新增一行注册调用（不修改现有 handler）
- 安装新依赖：`write-file-atomic`, `uuid`, `fuse.js`, `eventemitter3`

## Impact
- **新增能力**: 群聊模式（群组管理、多角色激活策略、多角色生成模式、群聊消息存储与加载）
- **不受影响**: 现有单聊模块（`ChatStorageService`、`characterChatStore`、`CharacterDialogueChat` 等）完全不受影响
- **依赖变更**: 新增 4 个 npm 包

## ADDED Requirements

### Requirement: 群组管理
系统 SHALL 提供完整的群组 CRUD 操作，包括创建、编辑、删除、查询群组。

#### Scenario: 创建新群组
- **WHEN** 用户输入群组名称并选择成员角色
- **THEN** 系统创建群组定义文件（JSON 格式），生成唯一 ID（时间戳）
- **AND** 群组文件存储在独立目录 `data/groups/`

#### Scenario: 编辑群组
- **WHEN** 用户修改群组配置（名称、成员、激活策略等）
- **THEN** 系统更新群组定义文件并返回成功状态

#### Scenario: 删除群组
- **WHEN** 用户确认删除群组
- **THEN** 系统删除群组定义文件及其关联的所有聊天文件

### Requirement: 群聊消息存储
系统 SHALL 使用 JSONL 格式存储群聊消息，第一行为 ChatHeader（包含完整性校验 UUID），后续行为 ChatMessage。

#### Scenario: 保存群聊消息
- **WHEN** 用户发送消息或 AI 生成回复
- **THEN** 系统追加消息到 JSONL 文件
- **AND** 使用原子写入防止数据损坏
- **AND** 自动生成备份到 `data/backups/group-chats/`

#### Scenario: 加载群聊消息
- **WHEN** 用户打开群组聊天
- **THEN** 系统读取 JSONL 文件并解析为消息数组
- **AND** 提取 ChatHeader 中的完整性校验 UUID

### Requirement: 角色激活策略
系统 SHALL 支持三种激活策略：NATURAL（自然激活）、LIST（列表顺序）、POOLED（池化随机）。

#### Scenario: NATURAL 模式激活
- **WHEN** 用户输入消息且激活策略为 NATURAL
- **THEN** 系统检测输入中是否提及角色名称
- **AND** 根据角色 talkativeness 属性进行概率激活
- **AND** 确保至少一个角色发言（保底机制）

#### Scenario: LIST 模式激活
- **WHEN** 用户输入消息且激活策略为 LIST
- **THEN** 系统按成员列表顺序激活所有成员

#### Scenario: POOLED 模式激活
- **WHEN** 用户输入消息且激活策略为 POOLED
- **THEN** 系统从上次用户发言后未发言的角色中随机选择

### Requirement: 生成模式
系统 SHALL 支持三种生成模式：SWAP（角色切换）、APPEND（追加合并）、APPEND_DISABLED（禁用追加）。

#### Scenario: SWAP 模式生成
- **WHEN** 激活角色后且生成模式为 SWAP
- **THEN** 系统为每个角色独立构建上下文并调用 AI 生成
- **AND** 每次生成使用当前角色的完整角色卡

#### Scenario: APPEND 模式生成
- **WHEN** 激活角色后且生成模式为 APPEND
- **THEN** 系统将所有角色的角色卡合并为统一上下文
- **AND** 使用 Join Prefix/Suffix 模板分隔各角色信息

### Requirement: 群聊 UI
系统 SHALL 提供完整的群聊用户界面，包括群组选择器、消息列表、输入框（含 @提及）、成员列表、配置面板。

#### Scenario: 打开群聊对话框
- **WHEN** 用户在创作中心选择群聊模式
- **THEN** 系统显示群组选择面板
- **AND** 用户选择群组后加载群聊消息

#### Scenario: 群聊消息显示
- **WHEN** 群聊消息加载完成
- **THEN** 每条消息显示发言角色的头像和名称
- **AND** 用户消息与 AI 消息样式区分

### Requirement: 完整性校验
系统 SHALL 使用 UUID 进行完整性校验，防止并发写入导致的数据丢失。

#### Scenario: 完整性校验通过
- **WHEN** 保存群聊消息时
- **THEN** 系统验证文件的当前 integrity UUID 与加载时一致
- **AND** 一致则允许保存

#### Scenario: 完整性校验失败
- **WHEN** 保存群聊消息时 integrity UUID 不一致
- **THEN** 系统拒绝保存并提示用户
- **AND** 提供强制保存选项（需确认）

### Requirement: 现有功能保护
系统 SHALL 确保群聊模块与现有单聊模块完全隔离，不得修改任何现有聊天相关代码。

#### Scenario: 代码审查
- **WHEN** 群聊功能开发完成后
- **THEN** 验证现有单聊模块文件未被修改
- **AND** 单聊功能回归测试通过

## MODIFIED Requirements

### Requirement: IPC 路由注册
**File**: `src/main/ipc/index.ts`

系统 SHALL 在 IPC 路由注册中新增群聊相关 handler 的调用，但不修改现有 handler 的调用逻辑。

#### Scenario: IPC 注册
- **WHEN** 应用启动时
- **THEN** 系统注册 `registerGroupHandlers` 和 `registerGroupChatHandlers`
- **AND** 不影响现有 `registerCharacterChatHandlers` 等功能

## REMOVED Requirements

无。现有功能全部保留，群聊为新增独立模块。
