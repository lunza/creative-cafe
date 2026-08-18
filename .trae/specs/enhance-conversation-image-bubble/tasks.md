# Tasks

- [x] Task 1: 数据模型重构 — 类型定义与迁移基础 ✅
  - [x] SubTask 1.1: 在 `CharacterDialogueChat.types.ts` 新增 `ImageHistoryItem` 接口（`{ assetId: string; createdAt: number }`）
  - [x] SubTask 1.2: 新增 `ImageAttachment` 接口（`{ currentAssetId: string; emotion: string; createdAt: number; history: ImageHistoryItem[]; currentIndex: number; status?: 'generating' | 'idle' | 'error'; phase?: 'tag-generating' | 'tag-auditing' | 'image-generating' | 'error'; errorMessage?: string }`）
  - [x] SubTask 1.3: `ChatMessage` 接口新增 `imageAttachment?: ImageAttachment` 字段；`generatedImage`/`isImageMessage` 字段添加 `@deprecated` JSDoc 注释（保留以支持迁移）
  - [x] SubTask 1.4: 更新 `characterChatStore.ts` 的 `safeMessages` 映射，增加 `imageAttachment` 字段透传（两处：正常分支 + 循环引用兜底分支），同时保留 `generatedImage`/`isImageMessage` 透传（迁移依赖）
  - [x] SubTask 1.5: 更新 `CharacterDialogueChat.hooks.ts` 的 `messagesToSave` 映射，增加 `imageAttachment` 字段透传

- [x] Task 2: 旧数据迁移逻辑 ✅
  - [x] SubTask 2.1: 在 `CharacterDialogueChat.hooks.ts` 新增 `migrateLegacyImageMessages(messages: ChatMessage[]): ChatMessage[]` 纯函数：遍历消息，对每个 `isImageMessage: true` 的消息，定位前一条 assistant 非图片消息，将其 `generatedImage` 转换为父消息的 `imageAttachment`（history=[{assetId, createdAt}], currentIndex=0, emotion=父消息emotion||'default', status='idle'），并从列表移除该图片消息
  - [x] SubTask 2.2: 无前一条文本消息时跳过迁移并 `addLog` 警告（不丢失数据）
  - [x] SubTask 2.3: 在聊天记录加载后（messages 初始化处）调用 `migrateLegacyImageMessages`，若发生迁移则 `saveChatToStore` 持久化新格式
  - [x] SubTask 2.4: 迁移函数添加单元测试覆盖：正常迁移、无前驱消息兜底、连续多个图片消息、已迁移数据幂等

- [x] Task 3: IPC 进度事件 — `ai:traitPromptProgress` ✅
  - [x] SubTask 3.1: 在 `characterTraitAIHandlers.ts`（非 aiHandlers.ts，spec 路径有误已修正）的 `ai:generateTraitPrompts` handler 中，调用 service 前推送 `{ phase: 'tag-generating' }`，service 返回后推送 `{ phase: 'tag-auditing' }`（方案 b 最小改动，service 不支持进度回调）
  - [x] SubTask 3.2: 在 `preload.ts` 新增 `ai.onTraitPromptProgress` / `ai.offTraitPromptProgress`
  - [x] SubTask 3.3: 在 `electron.d.ts` 新增 `onTraitPromptProgress` / `offTraitPromptProgress` 类型声明
  - [x] SubTask 3.4: 验证进度事件不影响现有 `ai:generateTraitPrompts` 返回值和错误处理（推送与 return 独立，isDestroyed 守卫 + try/catch 兜底）

- [x] Task 4: ChatMessageBubble 嵌套图片渲染重写 ✅
  - [x] SubTask 4.1: 重写图片渲染分支：当 `message.imageAttachment` 存在时，在文本内容（MessageRenderer）下方、同一 `chat-msg-bubble` 容器内渲染图片区域（`chat-msg-image-attachment`）
  - [x] SubTask 4.2: 图片区域结构：左侧立绘（复用父消息 expressionImage，但通过 `imageAttachment.emotion` 解析）+ 中间图片/占位 + 右侧操作按钮
  - [x] SubTask 4.3: 移除原 `message.isImageMessage && message.generatedImage` 独立图片消息渲染分支（迁移后不应出现，但保留兜底：若仍出现独立图片消息则按旧逻辑渲染避免白屏）
  - [x] SubTask 4.4: 图片加载逻辑从 `message.generatedImage` 改为 `message.imageAttachment.currentAssetId`（assetId 异步加载路径不变：asset:getImagePath + file:readAsBase64）；data URL 兜底路径保留
  - [x] SubTask 4.5: 新增 `ChatMessageBubble.css` 样式：`chat-msg-image-attachment`（嵌套容器）、`chat-msg-image-display`（图片本体）、`chat-msg-image-placeholder`（阶段状态占位）、`chat-msg-image-nav`（左右导航按钮）、`chat-msg-image-counter`（计数）、`chat-msg-image-actions`（删除+重生成按钮）；阶段切换 `transition: opacity 0.3s ease`

- [x] Task 5: 分阶段状态占位 UI ✅
  - [x] SubTask 5.1: 当 `imageAttachment.status === 'generating'` 时渲染占位区域（`chat-msg-image-placeholder`），显示 `imageAttachment.phase` 对应文案：「标签生成中…」/「标签审核中…」/「图片生成中…」+ LoadingOutlined 动画
  - [x] SubTask 5.2: 当 `imageAttachment.status === 'error'` 时显示错误状态 + 错误信息 + 重试按钮
  - [x] SubTask 5.3: 占位区域阶段文案切换使用 CSS opacity/transform transition 实现平滑过渡
  - [x] SubTask 5.4: 生成完成（status→idle）时占位淡出、图片淡入（chat-msg-image-fade-in 关键帧 + opacity transition）

- [x] Task 6: 删除按钮 + 二次确认 ✅
  - [x] SubTask 6.1: 图片区域新增删除按钮（DeleteOutlined），点击触发 `Modal.confirm`（标题「删除图片」，内容「确定删除此图片？将同时删除磁盘文件和生成历史，不可恢复。」，确认按钮「确认删除」danger）
  - [x] SubTask 6.2: 确认后调用 `onDeleteImage(message.id)` 回调
  - [x] SubTask 6.3: 删除按钮在 `imageAttachment.status === 'generating'` 时禁用

- [x] Task 7: 历史导航按钮 ✅
  - [x] SubTask 7.1: 当 `imageAttachment.history.length > 1` 时，图片左侧渲染「上一张」按钮（LeftOutlined，currentIndex===0 时禁用），右侧渲染「下一张」按钮（RightOutlined，currentIndex===history.length-1 时禁用）
  - [x] SubTask 7.2: 图片下方显示 `{currentIndex + 1} / {history.length}` 计数
  - [x] SubTask 7.3: 点击导航按钮调用 `onNavigateImage(message.id, direction: 'prev' | 'next')` 回调
  - [x] SubTask 7.4: 导航后 `loadedImageUrl` 重新加载对应 assetId（useEffect 依赖 currentAssetId）

- [x] Task 8: 重新生成按钮 ✅
  - [x] SubTask 8.1: 图片区域下方新增「重新生成」按钮（ReloadOutlined + 文案），与文本气泡的「生成图片」按钮分离
  - [x] SubTask 8.2: 点击调用 `onRegenerateImage(message.id)` 回调
  - [x] SubTask 8.3: 生成中（status==='generating'）时按钮显示 LoadingOutlined 并禁用
  - [x] SubTask 8.4: 文本气泡的「生成图片」按钮逻辑调整：当 `message.imageAttachment` 已存在时隐藏该按钮（图片区域内有「重新生成」入口）

- [x] Task 9: handleGenerateImage 重构 — 区分首次/重生成 + 阶段状态 ✅
  - [x] SubTask 9.1: `handleGenerateImage` 拆分为 `handleGenerateImage(messageId)`（首次生成）和 `handleRegenerateImage(messageId)`（重新生成），共享核心生成逻辑抽取为 `executeImageGeneration(messageId, isRegenerate: boolean)`
  - [x] SubTask 9.2: 在 `executeImageGeneration` 中管理阶段状态：开始时在父消息 imageAttachment 上设 `status='generating', phase='tag-generating'`；调用 `ai.generateTraitPrompts` 前 phase 不变；返回后通过 `onTraitPromptProgress` 事件接收 `phase='tag-auditing'` 并更新；调用 `sd.generateTxt2Img` 前设 `phase='image-generating'`
  - [x] SubTask 9.3: 首次生成时先在父消息创建 `imageAttachment` 占位（status='generating'），再执行生成；成功后写入 currentAssetId/emotion/history/currentIndex，status='idle'
  - [x] SubTask 9.4: 重新生成时不创建新占位，复用已有 imageAttachment（status='generating'）；成功后追加 history 项，更新 currentIndex 和 currentAssetId
  - [x] SubTask 9.5: 生成失败时设 `status='error', errorMessage`，保留占位供重试
  - [x] SubTask 9.6: 情绪快照：生成时 `imageAttachment.emotion = 父消息.emotion || 'default'`
  - [x] SubTask 9.7: 在组件挂载时订阅 `ai.onTraitPromptProgress`，卸载时 `ai.offTraitPromptProgress`；回调中根据当前生成中的 messageId 更新对应消息的 phase

- [x] Task 10: hooks 新增 attachImageToMessage / regenerateImage / deleteImageAttachment / navigateImageHistory ✅
  - [x] SubTask 10.1: 新增 `updateImageAttachment(messageId, updater: (prev) => ImageAttachment)` 通用工具函数：读取消息、应用 updater、dispatch UPDATE_MESSAGES、saveChatToStore
  - [x] SubTask 10.2: 用 `updateImageAttachment` 实现阶段状态更新（供 handleGenerateImage 调用）— 函数已导出，Task 9 直接调用
  - [x] SubTask 10.3: 新增 `deleteImageAttachment(messageId)`：遍历 `imageAttachment.history` 逐个调用 `asset:delete`（characterCardId, 'general', assetId），清空 `imageAttachment=undefined`，dispatch + save
  - [x] SubTask 10.4: 新增 `navigateImageHistory(messageId, direction)`：计算新 currentIndex，更新 currentAssetId = history[newIndex].assetId，dispatch + save
  - [x] SubTask 10.5: 移除或 deprecated 标记 `addImageMessage`（被 `updateImageAttachment` 替代，但保留函数体供迁移兜底）

- [x] Task 11: ChatMessageBubble props 扩展 + CharacterDialogueChat 接线 ✅
  - [x] SubTask 11.1: ChatMessageBubble props 新增：`onDeleteImage?: (messageId: string) => void`、`onRegenerateImage?: (messageId: string) => void`、`onNavigateImage?: (messageId: string, direction: 'prev' | 'next') => void`、`resolveExpressionImage?: (emotion: string) => string | undefined`（用于按 attachment.emotion 解析立绘）— **提前在 Task 4-8 合并实施中完成**
  - [x] SubTask 11.2: CharacterDialogueChat.tsx 传递新 props；图片区域的左侧立绘通过 `resolveExpressionImage(message.imageAttachment.emotion)` 解析（ChatMessageBubble 内已实现 effectiveExpressionImage 派生逻辑，待 Task 11 接线传入 resolveExpressionImage 函数）
    - 实施位置：`CharacterDialogueChat.tsx` `renderMessageBubble` 内 ChatMessageBubble 渲染处（约 L767-783）
    - 已接 props：`onDeleteImage={deleteImageAttachment}` / `onRegenerateImage={handleRegenerateImage}` / `onNavigateImage={navigateImageHistory}`（Task 9 已完成）；本次新增 `resolveExpressionImage` 接线
    - 【重点标记 - TS 签名不兼容问题】store 的 `resolveExpressionImage` 签名为 `(emotionKey: string | undefined | null) => string | null`（`expressionStore.ts`），而 ChatMessageBubble prop 签名为 `(emotion: string) => string | undefined`（`ChatMessageBubble.tsx` L44），直接传递触发 TS2322。Task 9 阶段因此遗留未接，本次 Task 11.2 通过包装解决：`(emotion: string) => resolveExpressionImage(emotion) ?? undefined`，将 `null` 转为 `undefined` 以匹配 prop 类型
    - 仅在 `msg.imageAttachment` 存在时传递该 prop（无图片时传 `undefined`），避免无谓的解析调用；ChatMessageBubble 内 `effectiveExpressionImage` 派生逻辑（ChatMessageBubble.tsx L156-164）会优先用 `resolveExpressionImage(attachment.emotion || message.emotion)`，未传时回退到父级 `expressionImage` prop
    - 验证：`npx tsc --noEmit` 全量输出中无任何 `resolveExpressionImage` 相关错误（Task 9 遗留 TS2322 已消除）
  - [x] SubTask 11.3: 检查 `expressionImage` prop 的图片消息回退逻辑（`CharacterDialogueChat.tsx` `renderMessageBubble` 内约 L746-751）— **经分析无需修改**
    - 现有逻辑：`msg.role === 'assistant' && !(isStreaming && isLastMessage) ? resolveExpressionImage(msg.emotion || 'default') ?? undefined : undefined`
    - 图片消息已迁移为 `imageAttachment`（不再有独立 `isImageMessage` 消息），故此段逻辑无需为图片消息特判
    - 若迁移遗漏导致仍有独立图片消息（`isImageMessage=true`），这些消息没有 `emotion` 字段会回退到 `'default'` 表情 —— 属可接受的兜底行为，不修改

- [x] Task 12: 端到端验证 + 技术文档更新 ✅
  - [x] SubTask 12.1: `npx tsc --noEmit` 检查所有修改文件无新增错误 — 验证通过：所有 spec 新增代码零新增 TypeScript 错误，全部为预存错误（详见技术文档 6.1 章节）
  - [ ] SubTask 12.2: 手动验证清单：首次生成（占位→三阶段→图片显示）、重新生成（覆盖+历史追加）、历史导航（上一张/下一张+计数）、删除（确认弹窗+磁盘文件删除+恢复纯文本）、关闭重开（图片恢复+历史恢复）、旧数据迁移（独立图片消息→嵌套） — 待手动运行时验证（已在 checklist.md 标记）
  - [ ] SubTask 12.3: 边界测试：生成失败重试、无前驱消息的迁移兜底、history 仅 1 项无导航、连续多次重生成、删除后再次首次生成 — 部分单元测试覆盖（迁移函数），运行时边界待手动验证（已在 checklist.md 标记）
  - [x] SubTask 12.4: 更新根目录技术文档（`.trae/documents/技术文档.md`），记录本次架构变更（数据模型 BREAKING、嵌套 UI、阶段状态 IPC 事件），标注迁移逻辑为重点 — 已追加 Task 2/3/10/11/12 综合章节，含 BREAKING 数据模型对比表、7 大链路一致性验证表、修改文件清单

# Task Dependencies

- Task 1（类型定义）独立，最高优先级，其他任务依赖此
- Task 2（迁移）depends on Task 1
- Task 3（IPC 进度事件）独立，可与 Task 1/2 并行
- Task 4（嵌套渲染）depends on Task 1
- Task 5（阶段状态 UI）depends on Task 4
- Task 6（删除按钮）depends on Task 4
- Task 7（历史导航）depends on Task 4
- Task 8（重生成按钮）depends on Task 4
- Task 9（handleGenerateImage 重构）depends on Task 1, 3, 10
- Task 10（hooks）depends on Task 1
- Task 11（props 接线）depends on Task 4, 6, 7, 8, 9, 10
- Task 12（验证+文档）depends on 全部

# 并行化建议

- **第一批并行**：Task 1（类型）+ Task 3（IPC 进度事件）
- **第二批并行**（Task 1 完成后）：Task 2（迁移）+ Task 4（嵌套渲染）+ Task 10（hooks）
- **第三批并行**（Task 4 完成后）：Task 5（阶段 UI）+ Task 6（删除）+ Task 7（导航）+ Task 8（重生成按钮）
- **第四批**：Task 9（handleGenerateImage 重构，依赖 Task 3 + 10）→ Task 11（接线）→ Task 12（验证）
