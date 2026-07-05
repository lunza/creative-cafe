# Checklist

## 提示词层

- [x] `PromptBuilder.ts` 中存在 `buildPolishInputSystemPrompt(characterInfo, persona, originalText, person?)` 导出函数
- [x] 系统提示输出包含用户人设 `name` 与 `description`
- [x] 系统提示输出包含对方角色 `characterCardName` 与简短 `personality`/`characterCardContent`
- [x] 系统提示输出包含原始文本 `originalText`
- [x] 系统提示输出包含约束："保持原始意图" / "仅输出" / "不要解释" / "不要引号包裹"
- [x] 系统提示输出包含长度约束（±50% 以内）
- [x] `originalText` 为空时返回空串
- [x] `persona` 为空或 `name` 为空时返回空串
- [x] `person='third'` 时包含第三人称约束
- [x] `person` 不传时包含第一人称约束（默认）

## Hook 业务逻辑

- [x] `useCharacterDialogueChat` hook 暴露 `polishInput` 函数
- [x] hook 暴露 `isPolishingInput` 状态
- [x] `polishInput` 前置校验：`originalText` 为空时显示 `message.warning('请先输入需要润色的文本')` 并 return
- [x] `polishInput` 前置校验：`selectedPersona` 为空时显示 `message.warning('请先在右侧面板选择用户人设')` 并 return
- [x] `polishInput` 前置校验：无活动 AI 引擎时显示 `message.warning('请先在设置中配置AI引擎')` 并 return
- [x] `polishInput` 前置校验：`state.isStreaming`/`isOrganizing`/`isGeneratingUserReply`/`isPolishingInput` 为 true 时 return
- [x] `polishInput` 复用 `getEffectiveParams()` 和 `getActiveEngineConfig()`
- [x] `polishInput` 复用 `ContextTruncator` 进行上下文裁剪
- [x] `polishInput` 调用 `buildPolishInputSystemPrompt` 构建系统提示（含 `userReplyPerson` 参数）
- [x] `polishInput` 使用 `buildStopSequencesForUserReply` 注入停止序列
- [x] `polishInput` 通过 `engine.onStream` 累积流式回复到 ref
- [x] `polishInput` 通过 `engine.onComplete` 返回完整文本（Promise resolve）
- [x] `polishInput` 通过 `engine.onError` 显示错误并 Promise reject
- [x] `polishInput` finally 块中调用 `setIsPolishingInput(false)`
- [x] `cancelRequest` 函数能中断润色（设置 abort ref + 调用 `engine.cancelRequest()`）

## ChatInputBar UI

- [x] `ChatInputBarProps` 接口新增 `onPolishInput?`、`isPolishingInput?`、`polishFlashKey?` 三个可选 props
- [x] "润色"按钮位于"AI回复"按钮与 Send Message 按钮**之间**（同一 `else` 分支内）
- [x] 按钮使用 `HighlightOutlined` 图标
- [x] 按钮形态为圆形（44x44px，`borderRadius: '50%'`）
- [x] 按钮配色为青色渐变（`linear-gradient(135deg, #14b8a6 0%, #06b6d4 100%)`）
- [x] Tooltip 提示："润色当前输入文本（结合对话上下文与角色人设）"
- [x] `isPolishingInput=true` 时按钮显示 `<LoadingOutlined />` 图标并变为停止态（调用 `onCancel`）
- [x] `isPolishingInput=true` 时 Send 按钮禁用
- [x] `isPolishingInput=true` 时 AI回复按钮禁用
- [x] `isPolishingInput=true` 时 textarea 禁用
- [x] `isPolishingInput=true` 时人称选择器禁用
- [x] 输入框为空时润色按钮禁用
- [x] `polishFlashKey` 变化时触发 textarea 边框青色高亮动画（600ms）
- [x] textarea 的 disabled 条件包含 `isPolishingInput`
- [x] Send 按钮的 disabled 条件包含 `isPolishingInput`
- [x] AI回复按钮的 disabled 条件包含 `isPolishingInput`
- [x] 人称选择器的 disabled 条件包含 `isPolishingInput`

## 父组件透传

- [x] `CharacterDialogueChat.tsx` 从 hook 解构 `polishInput` 和 `isPolishingInput`
- [x] 新增 `polishFlashKey` state 用于触发动画
- [x] 实现 `handlePolishInput` 回调（await `polishInput(text)`，成功时 `setGeneratedReplyText` + `setPolishFlashKey` + `message.success`）
- [x] `<ChatInputBar>` JSX 中传入 `onPolishInput`、`isPolishingInput`、`polishFlashKey` 三个新 props

## 测试

- [x] `buildPolishInputSystemPrompt` 输出包含用户人设、角色上下文、原始文本、约束关键词
- [x] `buildPolishInputSystemPrompt` 防御性返回正确（originalText 空 / persona 空 / name 空）
- [x] `buildPolishInputSystemPrompt` 人称参数支持正确
- [x] `npm test` 全部通过，无新增编译错误

## 文档同步

- [x] 更新 `doc/04b-character-dialogue-chat-module.md` 中"AI 回复按钮与用户回复生成"章节，新增润色按钮说明
