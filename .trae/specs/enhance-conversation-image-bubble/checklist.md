# Checklist

## 数据模型与迁移
- [x] `ImageHistoryItem` 接口已定义（assetId + createdAt）
- [x] `ImageAttachment` 接口已定义（currentAssetId / emotion / createdAt / history / currentIndex / status / phase / errorMessage）
- [x] `ChatMessage.imageAttachment` 字段已新增；`generatedImage`/`isImageMessage` 标记 @deprecated 但保留
- [x] `characterChatStore.safeMessages` 映射包含 `imageAttachment` 透传（正常分支 + 循环引用兜底分支）
- [x] `CharacterDialogueChat.hooks.ts` 的 `messagesToSave` 映射包含 `imageAttachment` 透传
- [x] `migrateLegacyImageMessages` 函数实现：独立图片消息 → 父消息 imageAttachment
- [x] 迁移函数处理「无前驱消息」边界（跳过 + 警告日志，不丢失数据）
- [x] 迁移函数幂等（对已迁移数据不再处理）
- [x] 迁移后新格式持久化到 store

## IPC 进度事件
- [x] `ai:generateTraitPrompts` handler 在进入 L0-L5 审核前推送 `ai:traitPromptProgress` 事件
- [x] `preload.ts` 暴露 `ai.onTraitPromptProgress` / `ai.offTraitPromptProgress`
- [x] `electron.d.ts` 包含 `onTraitPromptProgress` / `offTraitPromptProgress` 类型声明
- [x] 进度事件不影响 `ai:generateTraitPrompts` 返回值和错误处理

## 嵌套渲染（ChatMessageBubble）
- [x] 图片渲染在文本内容下方、同一 `chat-msg-bubble` 容器内（非独立气泡）
- [x] 图片区域左侧立绘使用 `imageAttachment.emotion` 解析表情图（非 default）— `effectiveExpressionImage` 派生 + `resolveExpressionImage` prop
- [x] 立绘情绪回退链：attachment.emotion → 父消息.emotion → default — 通过 `expressionImage` prop 兜底
- [x] 图片加载从 `imageAttachment.currentAssetId` 异步加载（asset:getImagePath + file:readAsBase64）
- [x] data URL 兜底路径保留（assetId 加载失败时）
- [x] 旧独立图片消息渲染分支保留兜底（避免迁移遗漏导致白屏）
- [x] CSS 样式：嵌套容器 / 图片本体 / 占位 / 导航 / 计数 / 操作按钮

## 分阶段状态
- [x] `status='generating'` 时渲染占位区域 + 阶段文案 + LoadingOutlined
- [x] 三阶段文案：「标签生成中…」/「标签审核中…」/「图片生成中…」
- [x] 阶段切换使用 CSS opacity/transform transition 平滑过渡
- [x] `status='error'` 时显示错误信息 + 重试按钮
- [x] 生成完成占位淡出、图片淡入（chat-msg-image-fade-in 关键帧）

## 删除功能
- [x] 删除按钮（DeleteOutlined）存在于图片区域
- [x] 点击删除弹出 `Modal.confirm` 二次确认
- [x] 确认对话框文案明确提示「删除磁盘文件和生成历史，不可恢复」
- [x] 确认后遍历 history 逐个 `asset:delete` 删除磁盘文件 + manifest — Task 10 hooks 实现
- [x] 清空父消息 `imageAttachment` 字段 — Task 10 hooks 实现
- [x] 删除后文本气泡恢复纯文本状态 — 依赖 Task 10 hooks 实现（Task 11 接线后端到端验证）
- [x] 生成中（status='generating'）删除按钮禁用
- [x] 取消删除无副作用（Modal.confirm 默认行为）

## 历史导航
- [x] `history.length > 1` 时显示上一张/下一张按钮
- [x] 上一张按钮在 currentIndex===0 时禁用
- [x] 下一张按钮在 currentIndex===history.length-1 时禁用
- [x] 显示 `{currentIndex + 1} / {history.length}` 计数
- [x] 导航后图片重新加载对应 assetId（useEffect 依赖 currentAssetId 自动触发）
- [x] `history.length <= 1` 时不显示导航按钮和计数

## 重新生成
- [x] 图片区域下方有「重新生成」专用按钮（与文本气泡「生成图片」分离）
- [x] 重新生成在原位置覆盖，旧图片 assetId 保留到 history — Task 9 + Task 10 实现
- [x] 重新生成时 emotion 更新为当前父消息 emotion 快照 — Task 9 实现
- [x] 生成中按钮显示 LoadingOutlined 并禁用
- [x] 文本气泡「生成图片」按钮在已有 imageAttachment 时隐藏（`{!message.imageAttachment && (...)}`）

## 生成流程（handleGenerateImage 重构）
- [x] 首次生成（handleGenerateImage）与重新生成（handleRegenerateImage）分离
- [x] 共享核心逻辑抽取为 `executeImageGeneration(messageId, isRegenerate)`
- [x] 首次生成先创建 imageAttachment 占位（status='generating'）
- [x] 重新生成复用已有 imageAttachment 占位
- [x] 阶段状态管理：tag-generating → tag-auditing（IPC 事件）→ image-generating
- [x] 订阅 `ai.onTraitPromptProgress` 更新 phase；卸载时取消订阅
- [x] 生成失败设 status='error' + errorMessage，保留占位供重试
- [x] 情绪快照写入 imageAttachment.emotion

## hooks 函数
- [x] `updateImageAttachment(messageId, updater)` 通用工具函数
- [x] `deleteImageAttachment(messageId)` 删除磁盘文件 + 清空字段
- [x] `navigateImageHistory(messageId, direction)` 切换 currentIndex + currentAssetId
- [x] 阶段状态更新通过 `updateImageAttachment` 实现

## Props 接线
- [x] ChatMessageBubble props 新增 onDeleteImage / onRegenerateImage / onNavigateImage / resolveExpressionImage（Task 4-8 合并实施提前完成）
- [x] CharacterDialogueChat.tsx 传递新 props 并绑定 hooks 函数 — Task 11 接线
- [x] 图片区域立绘通过 resolveExpressionImage(attachment.emotion) 解析（ChatMessageBubble 内 effectiveExpressionImage 派生实现）

## 持久化与加载
- [x] 图片生成/删除/导航后持久化 imageAttachment
- [x] 重新打开对话后图片从 currentAssetId 恢复显示
- [x] 历史导航和计数恢复正确

## 验证
- [x] `npx tsc --noEmit` 所有修改文件无新增错误
- [ ] 首次生成端到端：占位→三阶段→图片显示 — 待手动运行时验证
- [ ] 重新生成端到端：覆盖+历史追加+导航查看 — 待手动运行时验证
- [ ] 删除端到端：确认弹窗+磁盘删除+恢复纯文本 — 待手动运行时验证
- [ ] 关闭重开：图片+历史恢复 — 待手动运行时验证
- [x] 旧数据迁移：独立图片消息→嵌套 attachment — 单元测试 `__tests__/migrateLegacyImageMessages.test.ts` 覆盖
- [ ] 边界：生成失败重试 / 无前驱消息迁移兜底 / history 1 项无导航 / 连续多次重生成 / 删除后再次首次生成 — 部分单元测试覆盖，运行时待验证
- [x] 技术文档已更新（数据模型 BREAKING + 迁移逻辑重点标记）
