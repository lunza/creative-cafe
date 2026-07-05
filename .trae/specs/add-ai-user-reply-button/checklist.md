# Checklist

## 提示词与停止序列

- [x] `PromptBuilder.ts` 中存在 `buildUserReplySystemPrompt(characterInfo, persona)` 导出函数
- [x] 系统提示输出包含用户人设 `name` 与 `description`
- [x] 系统提示输出包含对方角色 `characterCardName` 与简短 `personality`/`characterCardContent`
- [x] 系统提示输出包含明确约束："只输出 {{user}} 的回复"、"不要输出 {{char}} 的回复"、"不要解释"、"不要引号"、"不要前缀"
  - **⚠️ 实现差异（重点标记）**：spec 文案为"只输出"，实际 `PromptBuilder.ts:349-351` 实现为"**仅输出**"。功能等价，文案以实现为准。
- [x] 系统提示输出包含长度约束（50-200 字）
- [x] `PromptBuilder.ts` 中存在 `buildStopSequencesForUserReply(charName, customStops?)` 导出函数
- [x] 默认返回 8 项数组（4 项 `\n\n` 双换行前缀 + 4 项 `\n` 单换行前缀）
- [x] 包含 `\n\n${charName}:`、`\n\n${charName}：`、`\n\n{{char}}:`、`\n\n{{char}}：` 等
- [x] customStops 合并去重逻辑正确（与 `buildStopSequences` 一致）
- [x] 用户名缺省/空白时回退到 `'Character'`

## Hook 业务逻辑

- [x] `useCharacterDialogueChat` hook 暴露 `generateUserReply` 函数
- [x] hook 暴露 `isGeneratingUserReply` 状态
- [x] `generateUserReply` 前置校验：`selectedPersona` 为空时显示 `message.warning('请先在右侧面板选择用户人设')` 并 return
- [x] `generateUserReply` 前置校验：无活动 AI 引擎时显示 `message.warning('请先在设置中配置AI引擎')` 并 return
- [x] `generateUserReply` 前置校验：`state.isStreaming`/`isOrganizing`/`isGeneratingUserReply` 为 true 时 return（避免并发）
- [x] `generateUserReply` 复用 `getEffectiveParams()` 获取 AI 参数（temperature/max_tokens/freq_pen/pres_pen 等）
- [x] `generateUserReply` 复用 `getActiveEngineConfig()` 获取引擎配置
- [x] `generateUserReply` 复用 `ContextTruncator` 进行上下文裁剪（如启用 token 管理）
- [x] `generateUserReply` 调用 `buildUserReplySystemPrompt` 构建系统提示
- [x] `generateUserReply` 使用 `buildStopSequencesForUserReply` 注入停止序列（而非 `buildStopSequences`）
- [x] `generateUserReply` 通过 `engine.onStream` 累积流式回复到 ref
- [x] `generateUserReply` 通过 `engine.onComplete` 返回完整文本（Promise resolve）
- [x] `generateUserReply` 通过 `engine.onError` 显示错误并 Promise reject
- [x] `generateUserReply` finally 块中调用 `setIsGeneratingUserReply(false)`
- [x] `cancelRequest` 函数能中断用户回复生成（设置 abort ref + 调用 `engine.cancelRequest()`）

## ChatInputBar UI

- [x] `ChatInputBarProps` 接口新增 4 个可选 props：`onGenerateUserReply`、`isGeneratingUserReply`、`generatedReplyText`、`onGeneratedReplyTextConsumed`
- [x] "AI回复"按钮位于 Send Message 按钮**左侧**（同一 `else` 分支内）
- [x] 按钮使用 `RobotOutlined` 图标
- [x] 按钮形态为圆形（44x44px，`borderRadius: '50%'`）
- [x] 按钮配色为紫色渐变（`linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)`），区别于 Send 按钮的蓝紫色
- [x] Tooltip 提示："以当前用户人设生成对话回复"
- [x] `isGeneratingUserReply=true` 时按钮显示 `<LoadingOutlined />` 图标并变为可点击的"停止生成"态（调用 `onCancel`）
- [x] `isGeneratingUserReply=true` 时 Send 按钮禁用
- [x] `isGeneratingUserReply=true` 时 textarea 禁用
- [x] `disabled` 或 `isStreaming` 或 `isOrganizing` 时 AI回复按钮禁用
- [x] useEffect 监听 `generatedReplyText`：非空时 `setInput(generatedReplyText)` + 调用 `onGeneratedReplyTextConsumed?.()` + 聚焦 textarea + 光标置末尾
- [x] textarea 的 disabled 条件包含 `isGeneratingUserReply`：`(disabled && !isStreaming) || isGeneratingUserReply`
- [x] Send 按钮的 disabled 条件包含 `isGeneratingUserReply`：`!input.trim() || disabled || isGeneratingUserReply`

## 父组件透传

- [x] `CharacterDialogueChat.tsx` 从 hook 解构 `generateUserReply` 和 `isGeneratingUserReply`
- [x] 新增 `generatedReplyText` state 用于暂存生成文本
- [x] 实现 `handleGenerateUserReply` 回调（await `generateUserReply()`，成功时 `setGeneratedReplyText`）
- [x] 实现 `handleGeneratedReplyTextConsumed` 回调（清空 `generatedReplyText`）
- [x] `<ChatInputBar>` JSX 中传入 4 个新 props

## 测试

- [x] `buildUserReplySystemPrompt` 输出包含用户人设 name/description、对方角色 characterCardName、约束字眼、长度约束
- [x] `buildStopSequencesForUserReply('艾莉')` 返回 8 项数组（4 双换行 + 4 单换行）
- [x] `buildStopSequencesForUserReply` 包含 `\n\n艾莉:`、`\n\n{{char}}:` 等
- [x] `buildStopSequencesForUserReply` customStops 合并去重逻辑正确
- [x] `buildStopSequencesForUserReply` 用户名缺省时回退到 `'Character'`
- [x] `npm test` 全部通过，无新增编译错误

## 文档同步

- [x] 更新 `doc/04b-character-dialogue-chat-module.md` 中关于 ChatInputBar 与 AI 调用流程的描述（新增"AI回复"按钮与 `generateUserReply` 函数说明）
- [x] 在 `doc/04b-character-dialogue-chat-module.md` 的"对话增强机制"表格中新增"用户回复生成"行
