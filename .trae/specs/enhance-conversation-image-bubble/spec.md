# 对话图片气泡增强 Spec

## Why

`add-conversation-image-generation` 实现的图片气泡作为独立消息插入对话流，存在四类体验问题：(1) 图片气泡左侧立绘显示默认表情而非触发消息的情绪；(2) 图片与文本消息无主从关联，视觉割裂；(3) 无法删除/重新生成/查看历史图片；(4) 生成过程无阶段反馈，用户长时间等待无感知。本次优化将图片重构为文本消息的附属嵌套内容，并补齐管理、重生成、阶段状态三大能力。

## What Changes

- **BREAKING — 数据模型重构**：废弃独立图片消息（`isImageMessage: true` 的独立 ChatMessage），改为在父文本消息上新增 `imageAttachment?: ImageAttachment` 字段，图片作为文本气泡内部的附属区域渲染
- **BREAKING — 旧数据迁移**：加载聊天记录时检测旧的独立图片消息（`isImageMessage: true`），将其转换为前一条 assistant 文本消息的 `imageAttachment`，并删除该独立图片消息
- **情绪继承**：生成图片时快照父消息 `emotion` 字段存入 `ImageAttachment.emotion`，图片气泡左侧立绘使用该情绪加载表情图（非 default）
- **嵌套 UI**：图片渲染在文本气泡内部（文本内容下方、同一气泡容器内），左侧立绘共享父消息的表情图
- **删除功能**：图片气泡内新增删除按钮，二次确认后调用 `asset:delete` 删除磁盘文件 + manifest 条目，并清空父消息的 `imageAttachment` 字段
- **重新生成**：图片气泡下方新增「重新生成」专用按钮（与文本气泡的「生成图片」按钮分离），点击后在原位置覆盖生成新图片，旧图片 assetId 保留到 `history` 数组
- **历史导航**：图片左右两侧新增「上一张」「下一张」按钮，切换查看 `history` 中的过往生成结果，显示 `当前/总数` 计数
- **分阶段状态**：生成过程中在图片占位区域显示实时阶段状态（「标签生成中…」「标签审核中…」「图片生成中…」），带进度动画和平滑过渡
- **BREAKING — IPC 进度事件**：`ai:generateTraitPrompts` IPC 新增进度事件推送（`ai:traitPromptProgress`），主进程在 LLM 生成完成、进入 L0-L5 审核时推送阶段变更，渲染进程据此切换状态文案

## Impact

- Affected specs: `add-conversation-image-generation`（数据模型 BREAKING 变更）、`fix-conversation-image-generation-bugs`（加载逻辑重写）
- Affected code:
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.types.ts` — 新增 `ImageAttachment` / `ImageHistoryItem` 类型，ChatMessage 新增 `imageAttachment` 字段，`generatedImage`/`isImageMessage` 标记为 deprecated
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.tsx` — 重写图片渲染逻辑（嵌套渲染 + 删除按钮 + 历史导航 + 阶段状态占位 + 重新生成按钮）
  - `src/renderer/components/Character/CharacterDialogueChat/ChatMessageBubble.css` — 新增嵌套图片区域样式
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.tsx` — `handleGenerateImage` 重构（区分新增 vs 重生成 + 阶段状态管理 + 情绪快照）
  - `src/renderer/components/Character/CharacterDialogueChat/CharacterDialogueChat.hooks.ts` — `addImageMessage` 改为 `attachImageToMessage`（写入父消息 imageAttachment）；新增 `regenerateImage`/`deleteImageAttachment`/`navigateImageHistory`；旧数据迁移逻辑
  - `src/renderer/stores/characterChatStore.ts` — `safeMessages` 映射增加 `imageAttachment` 字段透传，移除 `generatedImage`/`isImageMessage`（迁移后无独立图片消息）
  - `src/main/ipc/handlers/aiHandlers.ts` — `ai:generateTraitPrompts` handler 新增 `webContents.send('ai:traitPromptProgress', ...)` 进度事件推送
  - `src/main/preload.ts` — 新增 `ai.onTraitPromptProgress` 事件订阅 API + `ai.offTraitPromptProgress` 取消订阅
  - `src/renderer/types/electron.d.ts` — 新增 `onTraitPromptProgress`/`offTraitPromptProgress` 类型声明

## ADDED Requirements

### Requirement: 图片作为文本消息附属嵌套内容

系统 SHALL 将生成的图片作为父文本消息的 `imageAttachment` 字段存储，并在文本气泡内部（文本内容下方、同一气泡容器内）渲染图片区域，而非作为独立消息插入对话流。

#### Scenario: 生成图片后嵌套渲染
- **WHEN** 用户点击 AI 文本消息的「生成图片」按钮并成功生成
- **THEN** 图片存入该文本消息的 `imageAttachment` 字段（含 currentAssetId / emotion / history / currentIndex）
- **AND** 文本气泡内部、文本内容下方渲染图片区域（非独立气泡）
- **AND** 图片区域左侧立绘使用 `imageAttachment.emotion` 加载对应表情图（非 default）
- **AND** 对话流中不出现新的独立图片消息

#### Scenario: 图片区域左侧立绘情绪继承
- **WHEN** 图片区域渲染时
- **THEN** 左侧立绘（expressionImage）使用 `imageAttachment.emotion` 解析表情图
- **AND** 若 emotion 为空则回退到父消息的 `emotion` 字段
- **AND** 若仍为空则回退到 default 表情

### Requirement: 图片删除功能

系统 SHALL 在每个图片区域提供删除按钮，点击后弹出二次确认，确认后彻底删除图片气泡、磁盘文件和历史记录。

#### Scenario: 删除确认
- **WHEN** 用户点击图片区域的删除按钮
- **THEN** 弹出确认对话框（Modal.confirm），提示「确定删除此图片？将同时删除磁盘文件和生成历史，不可恢复。」
- **AND** 对话框包含「取消」和「确认删除」按钮

#### Scenario: 确认删除后清理
- **WHEN** 用户点击「确认删除」
- **THEN** 系统遍历 `imageAttachment.history` 中所有 assetId，逐个调用 `asset:delete` IPC 删除磁盘 PNG 文件 + manifest 条目
- **AND** 清空父文本消息的 `imageAttachment` 字段（设为 undefined）
- **AND** 更新对话记录持久化
- **AND** 文本气泡恢复为无图片的纯文本状态（与生成图片前一致）

#### Scenario: 取消删除
- **WHEN** 用户点击「取消」或关闭对话框
- **THEN** 图片区域保持不变，无任何副作用

### Requirement: 图片重新生成（覆盖 + 历史）

系统 SHALL 在图片区域下方提供「重新生成」专用按钮，点击后在原位置生成新图片覆盖当前显示，旧图片保留到历史记录。

#### Scenario: 重新生成覆盖
- **WHEN** 用户点击图片区域下方的「重新生成」按钮
- **THEN** 系统在图片占位区域显示分阶段状态（同首次生成）
- **AND** 生成完成后，新图片的 assetId 追加到 `imageAttachment.history` 数组末尾
- **AND** `currentIndex` 更新为 history 最后一项的索引
- **AND** `currentAssetId` 更新为新 assetId
- **AND** 图片区域显示新图片
- **AND** 旧图片的磁盘文件保留（不删除，供历史查看）

#### Scenario: 重新生成时情绪更新
- **WHEN** 重新生成图片
- **THEN** `imageAttachment.emotion` 更新为当前父消息的 emotion 快照（父消息 emotion 可能在对话过程中变化）

### Requirement: 历史图片导航

系统 SHALL 在图片区域左右两侧提供「上一张」「下一张」按钮，允许用户查看重新生成历史中的过往图片。

#### Scenario: 历史导航显示
- **WHEN** `imageAttachment.history.length > 1`
- **THEN** 图片左侧显示「上一张」按钮（currentIndex > 0 时可点击，否则禁用）
- **AND** 图片右侧显示「下一张」按钮（currentIndex < history.length - 1 时可点击，否则禁用）
- **AND** 图片下方显示 `{currentIndex + 1} / {history.length}` 计数

#### Scenario: 切换历史图片
- **WHEN** 用户点击「上一张」
- **THEN** `currentIndex` 减 1
- **AND** `currentAssetId` 更新为 `history[currentIndex].assetId`
- **AND** 图片区域加载并显示该历史图片
- **AND** 计数更新

#### Scenario: 单张图片无导航
- **WHEN** `imageAttachment.history.length <= 1`
- **THEN** 不显示「上一张」「下一张」按钮和计数

### Requirement: 分阶段实时状态提示

系统 SHALL 在图片生成过程中（首次生成和重新生成）于图片占位区域内显示实时阶段状态，包含三个阶段。

#### Scenario: 标签生成阶段
- **WHEN** 系统开始调用 `ai:generateTraitPrompts` IPC
- **THEN** 图片占位区域显示「标签生成中…」文案 + 加载动画
- **AND** 占位区域位于文本气泡内部（图片将出现的位置）

#### Scenario: 标签审核阶段
- **WHEN** 主进程 `ai:generateTraitPrompts` 完成 LLM 生成、进入 L0-L5 审核链时
- **THEN** 主进程通过 `ai:traitPromptProgress` 事件推送 `{ phase: 'auditing' }`
- **AND** 渲染进程接收事件后，占位区域文案切换为「标签审核中…」
- **AND** 阶段切换有平滑过渡效果（CSS transition opacity/transform）

#### Scenario: 图片生成阶段
- **WHEN** 标签审核完成，系统开始调用 `sd:generateTxt2Img` IPC
- **THEN** 占位区域文案切换为「图片生成中…」+ 加载动画
- **AND** 阶段切换有平滑过渡效果

#### Scenario: 生成完成
- **WHEN** SD 生成成功
- **THEN** 占位区域淡出，图片淡入显示
- **AND** 阶段状态清除

#### Scenario: 生成失败
- **WHEN** 任一阶段失败
- **THEN** 占位区域显示错误状态 + 错误信息
- **AND** 提供重试按钮（点击重新触发生成流程）

### Requirement: 重新生成按钮与生成图片按钮分离

系统 SHALL 将文本气泡的「生成图片」按钮（首次生成）与图片区域的「重新生成」按钮（覆盖生成）分离为两个独立入口。

#### Scenario: 无图片时
- **WHEN** 文本消息无 `imageAttachment`
- **THEN** 文本气泡操作区显示「生成图片」按钮（PictureOutlined）
- **AND** 图片区域不显示（无图片无占位）

#### Scenario: 有图片时
- **WHEN** 文本消息有 `imageAttachment`
- **THEN** 文本气泡操作区不再显示「生成图片」按钮（或禁用）
- **AND** 图片区域下方显示「重新生成」按钮（ReloadOutlined）
- **AND** 图片区域同时显示删除按钮和历史导航（如适用）

## MODIFIED Requirements

### Requirement: 对话图片生成流程

系统 SHALL 在 `handleGenerateImage` 中区分「首次生成」与「重新生成」两种模式，并管理分阶段状态。

#### Scenario: 首次生成
- **WHEN** 用户点击文本气泡的「生成图片」按钮（父消息无 imageAttachment）
- **THEN** 系统进入生成流程，在父消息上创建 imageAttachment 占位（status: generating）
- **AND** 分阶段状态在占位区域显示
- **AND** 生成成功后写入 currentAssetId / emotion / history / currentIndex

#### Scenario: 重新生成
- **WHEN** 用户点击图片区域的「重新生成」按钮（父消息已有 imageAttachment）
- **THEN** 系统进入生成流程，复用已有 imageAttachment 占位
- **AND** 分阶段状态在占位区域显示
- **AND** 生成成功后追加到 history，更新 currentIndex 和 currentAssetId

### Requirement: 图片持久化与加载

系统 SHALL 将图片 attachment 数据完整持久化到聊天记录，加载时恢复图片显示。

#### Scenario: 持久化
- **WHEN** 图片生成/删除/导航后
- **THEN** `characterChatStore.safeMessages` 映射包含 `imageAttachment` 字段透传
- **AND** `handleSendMessage` 的 messagesToSave 映射包含 `imageAttachment` 字段透传

#### Scenario: 加载恢复
- **WHEN** 用户重新打开对话
- **THEN** 文本消息的 `imageAttachment.currentAssetId` 通过 `asset:getImagePath` + `file:readAsBase64` 加载为 data URL
- **AND** 图片在文本气泡内部正确显示
- **AND** 历史导航和计数正确恢复

### Requirement: 旧数据迁移

系统 SHALL 在加载聊天记录时检测并迁移旧的独立图片消息格式。

#### Scenario: 迁移独立图片消息
- **WHEN** 加载消息列表中存在 `isImageMessage: true` 的独立消息
- **THEN** 系统定位其前一条 assistant 文本消息（非图片消息）
- **AND** 将独立图片消息的 `generatedImage`（assetId）转换为 `ImageAttachment`（history 含 1 项，currentIndex=0，emotion 取父消息 emotion）
- **AND** 写入父文本消息的 `imageAttachment` 字段
- **AND** 从消息列表中删除该独立图片消息
- **AND** 迁移后持久化新格式

#### Scenario: 无前一条文本消息的兜底
- **WHEN** 独立图片消息前无 assistant 文本消息（边界情况）
- **THEN** 跳过迁移，保留该消息原样（不丢失数据）
- **AND** 记录警告日志

## REMOVED Requirements

### Requirement: 独立图片消息

**Reason**: 图片重构为文本消息的附属嵌套内容，不再作为独立消息存在。
**Migration**: 加载时通过迁移逻辑将旧 `isImageMessage` 消息转换为父消息的 `imageAttachment` 字段；`isImageMessage`/`generatedImage` 字段标记 deprecated 但保留（迁移逻辑依赖）。
