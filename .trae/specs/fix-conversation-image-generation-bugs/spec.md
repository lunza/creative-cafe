# 修复对话图片生成功能 Bug Spec

## Why
`add-conversation-image-generation` 规范实现后，用户测试发现 5 个问题：样式不一致、LoRA/缺失字段导致角色一致性差、对话场景与角色特征 tag 冲突无法筛选、图片关闭对话后丢失、SD 选项构建未复用已有逻辑。这些问题严重影响了功能可用性，需统一修复。

## What Changes
- **Bug 1（样式）**: 将 ConfigPanel "图片生成设置" 区域从内联样式重构为 CSS 类，与 ParameterPanel 等子面板风格一致（折叠头部 + 卡片背景 + 图标 + Tooltip + 可折叠）
- **Bug 2（LoRA/缺失字段）**: 在 `handleGenerateImage` 的 sdOptions 中补齐 `characterGenderTag`（高分辨率人物数量约束）和 `dynamicCamera`（视角镜头），确保 LoRA 从 store getState 直接读取避免时序问题
- **Bug 3（特征分类筛选）**: 在 ConfigPanel "图片生成设置" 区域新增角色特征分类列表，按 `SYSTEM_TRAIT_CATEGORIES` 分组显示，每个分类支持启用/禁用开关，用户可灵活控制哪些分类的特征参与图片生成
- **Bug 4（图片持久化）**: 将 base64 图片保存到磁盘 via `asset:save` IPC（assetType='general'），消息中存储 `assetId` 而非 data URL；修复 `characterChatStore.saveTestChat` 和 `handleSendMessage` 的消息映射遗漏 `generatedImage`/`isImageMessage` 字段；加载时通过 `asset:getImagePath` + `file:readAsBase64` 恢复图片
- **Bug 5（复用已有功能）**: 将 `AssetGenerateModal.buildSdOptions` 的核心逻辑提取为共享纯函数 `buildSdOptionsFromConfig`，供 `AssetGenerateModal` 和 `handleGenerateImage` 共同复用，消除代码重复

## Impact
- Affected specs: `add-conversation-image-generation`（原始实现修复）、`add-asset-and-trait-management`（特征分类复用、asset IPC 复用）
- Affected code:
  - `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.tsx` — Bug 1 样式重构 + Bug 3 特征分类 UI
  - `src/renderer/components/Character/CharacterDialogueChat/ConfigPanel.css` — Bug 1 新增 CSS 类
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — Bug 2/3/5 handleGenerateImage 重构
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — Bug 4 messagesToSave 修复 + addImageMessage 改为存 assetId
  - `src/renderer/stores/characterChatStore.ts` — Bug 4 safeMessages 修复
  - `src/renderer/components/Character/CharacterDialogueChat/AssetGenerateModal.tsx` — Bug 5 buildSdOptions 提取为共享函数
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` — Bug 4 图片加载逻辑（从 assetId 恢复）
  - 新增 `src/renderer/components/Character/CharacterDialogueChat/buildSdOptions.ts` — Bug 5 共享纯函数

## ADDED Requirements

### Requirement: 图片生成设置区域样式一致性
系统 SHALL 在 ConfigPanel 中以与其他子面板（ParameterPanel 等）一致的 CSS 类和结构渲染"图片生成设置"区域。

#### Scenario: 样式统一
- **WHEN** 用户打开对话右侧控制面板
- **THEN** "图片生成设置"区域使用 CSS 类（非内联样式）渲染
- **AND** 区域包含折叠头部（图标 + 标题 + Tooltip + 折叠箭头）
- **AND** 内容区有卡片背景和边框（与 `parameter-panel-inner` 一致）
- **AND** 区域可折叠/展开，动画与 ParameterPanel 一致

### Requirement: 角色特征分类列表
系统 SHALL 在"图片生成设置"区域中加载当前角色的特征列表，按分类分组显示，并支持按分类启用/禁用特征 tag。

#### Scenario: 特征分类列表显示
- **WHEN** 用户展开"图片生成设置"区域
- **THEN** 系统加载当前角色的特征列表（从 characterTraitStore）
- **AND** 特征按 `SYSTEM_TRAIT_CATEGORIES` + 自定义分类 + 未分类分组显示
- **AND** 每个分类显示分类名称和该分类下的特征 tag
- **AND** 每个分类有启用/禁用开关

#### Scenario: 按分类禁用
- **WHEN** 用户取消勾选某个分类（如"衣物配饰"）
- **THEN** 该分类下所有特征的 `enabled` 状态被设为 false
- **AND** 后续图片生成不携带该分类的特征 tag
- **AND** 变更通过 `characterTraitStore` 同步持久化

#### Scenario: 分类禁用后图片生成
- **WHEN** 用户禁用"衣物配饰"分类后点击"生成图片"
- **THEN** SD 生成选项的 `characterTraits` 不包含 clothing 分类下的特征 tag
- **AND** 仅包含仍启用的分类下的特征 tag + 上下文生成的 tag

### Requirement: 图片持久化到磁盘
系统 SHALL 将对话中生成的图片保存到磁盘文件，并在聊天消息中存储 assetId 而非 base64 数据 URL。

#### Scenario: 图片生成后持久化
- **WHEN** 图片生成成功
- **THEN** 系统通过 `asset:save` IPC 将 base64 图片保存到磁盘（assetType='general'，assetId=`conv_{timestamp}`）
- **AND** 聊天消息的 `generatedImage` 字段存储 assetId（如 `conv_1234567890`）
- **AND** 消息同时保留 `isImageMessage: true` 标记

#### Scenario: 重新打开对话后图片加载
- **WHEN** 用户关闭对话框后重新进入
- **THEN** 图片消息的 `generatedImage` 字段（assetId）通过 `asset:getImagePath` + `file:readAsBase64` 恢复为 data URL
- **AND** 图片正确显示在对话流中（非显示 `[生成图片]` 文本）

## MODIFIED Requirements

### Requirement: 对话图片生成 SD 选项构建
系统 SHALL 在 `handleGenerateImage` 中通过共享纯函数 `buildSdOptionsFromConfig` 构建 SD 选项，确保与 `AssetGenerateModal.buildSdOptions` 字段完全一致。

#### Scenario: SD 选项字段完整
- **WHEN** 用户点击"生成图片"按钮
- **THEN** SD 选项包含 `characterGenderTag`（高分辨率时由 `detectGenderTag` 推断）
- **AND** SD 选项包含 `selectedLoras`（通过 `useCharacterLoraStore.getState().loras` 直接读取，避免时序问题）
- **AND** SD 选项中 `characterTraits` 仅包含未禁用分类下的启用特征

### Requirement: 控制面板图片生成设置
系统 SHALL 在对话右侧控制面板内提供"图片生成设置"配置区域，样式与其他面板一致，并包含特征分类管理功能。

#### Scenario: 配置区域显示
- **WHEN** 用户打开对话界面的右侧控制面板
- **THEN** 在 ParameterPanel 下方显示"图片生成设置"区域
- **AND** 区域使用 CSS 类渲染（非内联样式），风格与 ParameterPanel 一致
- **AND** 区域包含"是否开启图片生成"开关、"图片大小"下拉选择、角色特征分类列表
- **AND** 区域可折叠/展开

### Requirement: 对话流中展示生成结果
系统 SHALL 在图片生成完成后，将生成的图片保存到磁盘并以 assetId 引用，在对话流中展示时从磁盘加载。

#### Scenario: 生成成功
- **WHEN** SD 引擎返回生成结果
- **THEN** 系统通过 `asset:save` 将图片保存到磁盘
- **AND** 在当前 AI 消息下方插入一条图片消息（`isImageMessage: true`，`generatedImage` 存储 assetId）
- **AND** ChatMessageBubble 从 assetId 加载图片并展示
