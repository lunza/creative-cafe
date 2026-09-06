# 移动端对话交互缺陷修复（对齐 PC 端）Spec

## Why

移动端对话界面经 UI 重设计（redesign-mobile-chat-ui）后，存在多项与 PC 端交互不一致的功能缺陷：头像不可点击查看、气泡样式偏离 PC 端 CSS 基准、「卷回/重新生成」按钮缺失、辅助模式选项点击即发送而非填入输入框。本 spec 以 PC 端（`src/renderer/components/Character/CharacterDialogueChat/`）实现为基准，系统性修复这些缺陷。

## PC 端基准（调研结论）

| 功能 | PC 端行为 | 移动端现状（缺陷） |
| --- | --- | --- |
| 头像查看 | ImagePreviewModal 全尺寸预览：黑遮罩、点击关闭 | 头像无 onPress，无查看器 |
| 气泡样式 | 用户 `radius 18/18/4/18`（右下小角 4px）、indigo→violet 渐变、白字、`padding 12px 16px`；AI `radius 18/18/18/4`（左下小角 4px）、深色半透明 `rgba(30,30,46,0.8)` + 边框、`#e2e8f0` 字 | 小角在**顶角**且为 6dp、圆角 20、padding 14/10、无名字行/情绪标签/序号徽章、文本不可选中 |
| 卷回按钮 | 用户消息操作区「卷回到输入框」→ `rollbackToMessage`：删除该消息及之后全部消息并持久化 → 内容填入输入框 → toast「已卷回到输入框」 | 完全缺失 |
| 重新生成按钮 | AI 消息操作区 → `retryMessage`：保留用户消息，重新生成 AI 回复（含去重检测） | 完全缺失（仅有失败重试） |
| 辅助模式 | 点击推荐选项 → `setGeneratedReplyText(optionText)` 填入输入框，用户可编辑后发送 | `onPress={() => doSend(opt)}` 直接发送 |
| 消息操作区 | AI 消息：复制/编辑/重新生成/生成图片/继续对话 | 仅「生成图片」胶囊 |

## What Changes

- **服务端**：LAN API 新增 `POST /api/chats/:characterId/rollback`（body `{ messageId }`）——加载 chatStorage 历史，定位 user 消息，截断其后全部消息并持久化，返回 `{ content, removedCount }`
- **客户端 API**：`client.ts` 新增 `rollbackChat(baseUrl, characterId, messageId)` 封装
- **新增组件 AvatarViewer**：全屏图片查看器（黑遮罩 Modal），支持双指捏合缩放（1x–4x）、双击切换 1x/2.5x、放大后单指拖拽平移、单击关闭、右上角关闭按钮
- **ChatScreen 气泡对齐 PC**：圆角/小角位置/内边距/配色对齐 PC CSS 基准；补消息名字行（用户名/角色名 + 情绪标签 + AI 序号徽章 `#n`）；气泡文本开启 `selectable`
- **头像点击查看**：AI 头像/立绘点击 → AvatarViewer 查看当前立绘或头像原图；用户头像尝试加载当前 persona 头像（sessionConfig.selectedPersonaId → `/api/personas/:id/avatar`），有图显示图片并支持点击查看，无图保持文字圈（点击轻提示）
- **消息操作按钮行**：AI 气泡下方增加「复制/重新生成」小图标按钮（生成图片入口保留）；用户气泡下方增加「卷回到输入框」小图标按钮；卷回成功后内容填入输入框 + Snackbar
- **重新生成逻辑**：调 rollback 接口回退至最后一条 user 消息（含删除）→ 以相同内容重新 `doSend`（SSE 管线会重新写入 user + 新 AI 消息，最终存储与 PC retryMessage 等价）
- **辅助模式修复**：选项 onPress 改为 `setInput(opt)` + Snackbar 提示「已填入输入框，可编辑后发送」

### 不在本轮范围（需单独 spec）

- 消息**编辑**与**继续对话（续写）**按钮：PC 端有，但移动端表单交互与管线改造工作量较大，本批不实现，测试报告中明示差异
- 卷回时**表格快照回退**（PC 端 versionIndex 联动恢复）：LAN 侧需移植 memoryTableHandlers 逻辑，本批 rollback 仅截断消息，表格快照回退留作后续增强

## Impact

- Affected specs: fix-android-chat-feature-parity（对话功能补齐的延续）、redesign-mobile-chat-ui（气泡视觉基准将被本 spec 的 PC 对齐样式覆盖）
- Affected code:
  - 服务端：`src/main/services/lanapiserver/server.ts`（新增 rollback 路由 + handler）
  - 客户端：`android-client/src/api/client.ts`、`android-client/src/screens/ChatScreen.tsx`、新增 `android-client/src/components/AvatarViewer.tsx`
  - 文档：`docs/android-client.md`、`CHANGELOG.md`、`FIX_RECORDS.md`

## ADDED Requirements

### Requirement: 头像全屏查看器

系统 SHALL 提供点击对话消息头像弹出全尺寸图片的功能，支持缩放控制与关闭。

#### Scenario: 点击 AI 头像查看立绘
- **WHEN** 用户点击 AI 消息头像/立绘
- **THEN** 弹出全屏查看器显示当前立绘（或头像）原图，黑遮罩背景

#### Scenario: 缩放控制
- **WHEN** 查看器内双指捏合张开、或双击图片
- **THEN** 图片在 1x–4x 间平滑缩放；双击在 1x/2.5x 间切换；放大后单指拖拽可平移

#### Scenario: 关闭查看器
- **WHEN** 单击遮罩任意处或点击右上角关闭按钮（或系统返回键）
- **THEN** 查看器关闭，回到对话界面

#### Scenario: 用户头像查看
- **WHEN** 会话配置了 persona 且该 persona 有头像
- **THEN** 用户消息头像显示 persona 头像图片，点击可全屏查看；无头像时保持文字圈，点击提示「当前人设未设置头像」

### Requirement: 卷回消息

系统 SHALL 支持用户消息「卷回到输入框」，行为与 PC 端 rollbackToMessage 一致。

#### Scenario: 卷回成功
- **WHEN** 用户点击某条用户消息下方的「卷回到输入框」按钮
- **THEN** 该消息及其后全部消息从服务端存储中删除，本地列表同步截断，消息内容填入输入框，Snackbar 提示「已卷回到输入框」

#### Scenario: 卷回最后一条消息
- **WHEN** 历史仅剩问候语与一条用户消息时卷回
- **THEN** 卷回后列表仅剩问候语（或空态），输入框填入该消息内容

### Requirement: 重新生成回复

系统 SHALL 提供 AI 消息「重新生成」按钮，效果与 PC 端 retryMessage 等价。

#### Scenario: 重新生成成功
- **WHEN** 用户点击最后一条 AI 消息下方的「重新生成」按钮（非流式、非失败态）
- **THEN** 该 AI 消息及其前置 user 消息被回退，以相同内容重新发起 SSE 生成，完成后历史为「…user 消息 + 新 AI 回复」，不产生重复 user 消息

#### Scenario: 流式期间禁用
- **WHEN** 正在流式输出时
- **THEN** 重新生成/卷回按钮禁用，避免并发请求

### Requirement: 服务端 rollback 接口

LAN API SHALL 提供 `POST /api/chats/:characterId/rollback`。

#### Scenario: 正常卷回
- **WHEN** POST `{ messageId }` 且 messageId 对应历史中的 user 消息
- **THEN** 返回 200 `{ success, content, removedCount }`，存储中该消息及之后的消息被删除

#### Scenario: 异常输入
- **WHEN** messageId 不存在、或对应 assistant 消息、或角色不存在
- **THEN** 返回 404/400 结构化错误（`MESSAGE_NOT_FOUND` / `NOT_USER_MESSAGE` / `CHARACTER_NOT_FOUND`），存储不变

### Requirement: 辅助模式选项填入输入框

系统 SHALL 在辅助模式下点击推荐选项时将文本填入输入框而非直接发送。

#### Scenario: 点击选项
- **WHEN** 辅助模式推荐选项展示后用户点击某选项
- **THEN** 选项文本填入输入框（可编辑），Snackbar 提示「已填入输入框，可编辑后发送」，不触发发送

## MODIFIED Requirements

### Requirement: 对话气泡样式（原 redesign-mobile-chat-ui V4 玻璃态气泡）

气泡视觉基准由「中性暖色玻璃态」修改为「对齐 PC 端 ChatMessageBubble.css」：

- 用户气泡：`borderRadius 18/18/4/18`（右下小角 4）、indigo `#6366f1` → violet `#8b5cf6` 135° 渐变、白字、紫色投影
- AI 气泡：`borderRadius 18/18/18/4`（左下小角 4）、`rgba(30,30,46,0.8)` 半透明深色 + `rgba(255,255,255,0.06)` 边框、`#e2e8f0` 字（暗色主题沿用 AI 深色气泡；亮色主题 AI 气泡用等价的浅色玻璃底，保持可读性）
- 内边距：水平 16 / 垂直 12
- 每条消息上方显示名字行：用户名（用户侧）/ 角色名（AI 侧）+ 情绪标签（AI）+ 序号徽章 `#n`（AI，非图片消息计数）
- 气泡文本 `selectable`（长按可复制）

#### Scenario: 气泡渲染一致
- **WHEN** 渲染任意对话
- **THEN** 用户气泡右下小角、AI 气泡左下小角、圆角 18、内边距 16/12、配色符合上表，名字行/情绪标签/序号徽章正确显示

#### Scenario: 主题适配
- **WHEN** 亮/暗主题切换
- **THEN** 气泡均保持 PC 基准形状与用户侧渐变主色，AI 侧在亮色下可读（浅色玻璃底 + 深字）

## REMOVED Requirements

（无）
