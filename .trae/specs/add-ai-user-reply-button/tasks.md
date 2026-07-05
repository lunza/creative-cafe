# Tasks

## 提示词与停止序列构建

- [x] Task 1: 在 PromptBuilder.ts 中新增用户回复专用构建函数
  - [x] SubTask 1.1: 新增 `buildUserReplySystemPrompt(characterInfo: CharacterInfoForPrompt, persona: UserPersona): string` 函数——构建系统提示，明确指示 AI 仅生成用户侧下一句回复
    - 包含：用户人设（`persona.name` + `persona.description`）、对方角色上下文（`characterCardName` + 简短 `personality`/`characterCardContent`）、明确约束（"只输出 {{user}} 的回复，不要输出 {{char}} 的回复，不要解释、不要引号、不要前缀"）、长度约束（50-200 字）
    - 在文件中紧跟 `buildLengthGuidancePrompt` 之后定义，沿用相同的代码风格与 JSDoc 注释格式
  - [x] SubTask 1.2: 新增 `buildStopSequencesForUserReply(charName: string, customStops?: string[]): string[]` 函数——返回角色名变体停止序列
    - 默认返回 8 项数组：4 项 `\n\n` 双换行前缀（`\n\n${charName}:`、`\n\n${charName}：`、`\n\n{{char}}:`、`\n\n{{char}}：`）+ 4 项 `\n` 单换行前缀
    - 复用 `buildStopSequences` 的合并去重逻辑（`pushIfValid` 模式），支持 customStops 参数
    - 用户名缺省/空白时回退到 `'Character'`
  - [x] SubTask 1.3: 在 `PromptBuilder.ts` 头部导出两个新函数（确保 `usePromptBuilder.ts` 和 `hooks.ts` 可导入）

## Hook 业务逻辑

- [x] Task 2: 在 `useCharacterDialogueChat` hook 中新增 `generateUserReply` 函数
  - [x] SubTask 2.1: 在 `CharacterDialogueChat.hooks.ts` 顶部导入新函数：`buildUserReplySystemPrompt`、`buildStopSequencesForUserReply`（从 `./PromptBuilder`）
  - [x] SubTask 2.2: 在 `useCharacterDialogueChat` hook 中新增 state：`const [isGeneratingUserReply, setIsGeneratingUserReply] = useState(false)`，并暴露到 hook 返回值
  - [x] SubTask 2.3: 新增 ref：`const generatedReplyAccumulatedRef = useRef<string>('')`（用于流式累积）、`const isGeneratingUserReplyAbortRef = useRef<boolean>(false)`（用于取消控制）
  - [x] SubTask 2.4: 实现 `generateUserReply` useCallback 函数：
    - 前置校验：`selectedPersona` 为空时 `message.warning('请先在右侧面板选择用户人设')` 并 return；`getActiveEngineConfig()` 为空时 `message.warning('请先在设置中配置AI引擎')` 并 return；`state.isStreaming` 或 `isOrganizing` 或 `isGeneratingUserReply` 为 true 时 return（避免并发）
    - 设置 `setIsGeneratingUserReply(true)`、重置 `generatedReplyAccumulatedRef.current = ''`、`isGeneratingUserReplyAbortRef.current = false`
    - 调用 `getEffectiveParams()` 获取参数；调用 `getActiveEngineConfig()` 获取引擎配置
    - 调用 `buildUserReplySystemPrompt(characterInfo, selectedPersona)` 构建系统提示
    - 取最近 N 条对话历史作为 `contextMessages`（参考现有 `requestAIResponse` 中的取数逻辑，避免重复造轮子——可复用 `messagesRef.current` 或 `state.messages`）
    - 调用 `ContextTruncator` 进行上下文裁剪（如启用 token 管理），传入 `engineConfigWithParams` 配置（参考现有 `requestAIResponse` 的裁剪调用）
    - 构造 `engineConfigWithParams`：复用 `requestAIResponse` 中相同的参数注入模式，但 `stopSequences` 改用 `buildStopSequencesForUserReply(characterInfo.characterCardName, customStopSequences)`
    - 通过 `ChatEngineFactory.getInstance().getOrCreateDefaultEngine(engineConfigWithParams)` 获取引擎实例
    - 注册 `engine.onStream` 回调：累积 chunk 到 `generatedReplyAccumulatedRef.current`
    - 注册 `engine.onComplete` 回调：返回完整文本（通过 Promise resolve）
    - 注册 `engine.onError` 回调：`message.error(...)`、Promise reject
    - 调用 `engine.sendMessage(contextMessages, systemPrompt, engineConfigWithParams)`
    - finally 块中：`setIsGeneratingUserReply(false)`
  - [x] SubTask 2.5: 暴露 `generateUserReply` 函数到 hook 返回值
  - [x] SubTask 2.6: 在 `cancelRequest` 函数中追加：若 `isGeneratingUserReplyRef.current` 为 true，则同时设置 `isGeneratingUserReplyAbortRef.current = true` 并调用 `engine.cancelRequest()`，确保取消按钮也能中断用户回复生成

## ChatInputBar UI

- [x] Task 3: 在 ChatInputBar.tsx 中新增"AI回复"按钮
  - [x] SubTask 3.1: 扩展 `ChatInputBarProps` 接口，新增可选 props：
    - `onGenerateUserReply?: () => void`
    - `isGeneratingUserReply?: boolean`
    - `generatedReplyText?: string`
    - `onGeneratedReplyTextConsumed?: () => void`
  - [x] SubTask 3.2: 在组件内解构新 props，新增 useEffect 监听 `generatedReplyText`：当其非空时，`setInput(generatedReplyText)` 填充 textarea，并调用 `onGeneratedReplyTextConsumed?.()` 通知父组件；同时异步聚焦 textarea 并将光标置于末尾（`textareaRef.current?.focus()` + `textareaRef.current?.setSelectionRange(text.length, text.length)`）
  - [x] SubTask 3.3: 在 Send Message 按钮（`else` 分支，第 138-166 行）**左侧**新增"AI回复"按钮：
    - 用 `<Tooltip title="以当前用户人设生成对话回复">` 包裹
    - 图标使用 `RobotOutlined`（从 `@ant-design/icons` 导入）
    - 按钮形态：圆形（与 Send 按钮一致，`width: 44px, height: 44px, borderRadius: '50%'`）
    - 配色：紫色渐变（`background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)`），区别于 Send 按钮的蓝紫色
    - 当 `isGeneratingUserReply === true`：按钮显示 `<LoadingOutlined />` 图标，禁用 Send 按钮，禁用 textarea（`disabled={disabled || isGeneratingUserReply}`）；点击此按钮触发取消（调用 `onCancel?.()`）
    - 当 `isGeneratingUserReply === false`：按钮可点击，调用 `onGenerateUserReply?.()`
    - 当 `disabled` 或 `isStreaming` 或 `isOrganizing`：按钮进入禁用态（与 Send 按钮一致的禁用条件）
  - [x] SubTask 3.4: 调整 textarea 的 disabled 条件：`disabled={(disabled && !isStreaming) || isGeneratingUserReply}`
  - [x] SubTask 3.5: 调整 Send 按钮的 disabled 条件：`disabled={!input.trim() || disabled || isGeneratingUserReply}`

## 父组件透传

- [x] Task 4: 在 CharacterDialogueChat.tsx 中连接 ChatInputBar 与 hook
  - [x] SubTask 4.1: 从 `useCharacterDialogueChat` 解构新返回值：`generateUserReply`、`isGeneratingUserReply`
  - [x] SubTask 4.2: 新增 state：`const [generatedReplyText, setGeneratedReplyText] = useState('')`，用于在 hook 完成后暂存生成文本，再通过 prop 传给 ChatInputBar
  - [x] SubTask 4.3: 实现 `handleGenerateUserReply` 回调：调用 `generateUserReply()` 并 await；成功时 `setGeneratedReplyText(text)`，失败时已被 hook 内 `message.error` 处理（无需重复）
  - [x] SubTask 4.4: 实现 `handleGeneratedReplyTextConsumed` 回调：`setGeneratedReplyText('')` 清空暂存
  - [x] SubTask 4.5: 在 `<ChatInputBar>` JSX 中传入新 props：
    - `onGenerateUserReply={handleGenerateUserReply}`
    - `isGeneratingUserReply={isGeneratingUserReply}`
    - `generatedReplyText={generatedReplyText}`
    - `onGeneratedReplyTextConsumed={handleGeneratedReplyTextConsumed}`

## 测试与验证

- [x] Task 5: 单元测试（已完成 2026-07-04）
  - [x] SubTask 5.1: 在 `__tests__/PromptBuilder.userReply.test.ts`（新建）中验证：
    - `buildUserReplySystemPrompt` 输出包含用户人设 name/description
    - 包含对方角色 characterCardName
    - 包含"只输出"和"不要输出 {{char}}"等约束字眼
    - 包含长度约束（50-200 字）
    - **⚠️ 实现与 spec 差异（重点标记）**：spec 原文使用"只输出"，但 `PromptBuilder.ts` 实际实现使用"**仅输出**"（`仅输出 ${userName} 的下一句回复内容`）。本测试以实际实现为准，断言 `"仅输出"`。后续若需对齐 spec 文案，应同步修改 `buildUserReplySystemPrompt` 实现。
    - **⚠️ 额外发现（重点标记）**：`persona.description` 缺失时的 fallback 文案实际为 `'（未提供用户描述）'`（全角括号），spec 未明确文案；测试以实际实现为准。
  - [x] SubTask 5.2: 在 `__tests__/buildStopSequencesForUserReply.test.ts`（新建）中验证：
    - `buildStopSequencesForUserReply('艾莉')` 返回 8 项数组
    - 前 4 项以 `\n\n` 开头，后 4 项以 `\n` 开头（非 `\n\n`）
    - 包含 `\n\n艾莉:`、`\n\n艾莉：`、`\n\n{{char}}:`、`\n\n{{char}}：` 等
    - customStops 合并与去重逻辑正确
    - 用户名缺省时回退到 `'Character'`
    - **⚠️ 测试任务描述与实现差异（重点标记）**：任务描述称"`safeCharName='Character'` matches the fallback default 会触发去重，长度小于 8"，但实际实现中 `'Character'` 与 `'{{char}}'` 是不同字符串字面量，不会去重；真正的去重仅在 `charName='{{char}}'` 时发生（见 `PromptBuilder.ts` 源码注释）。本测试新增 `'{{char}}'` 用例验证去重（结果 4 项），并新增 `'Character'` 用例验证不去重（结果 8 项），以实际实现为准。
  - [x] SubTask 5.3: 运行 `npm test` 确认全部测试通过，无新增编译错误
    - 全量测试结果：23 个测试文件 / 420 个测试全部通过（含新增 52 个：32 + 20）
    - TypeScript 编译：新增测试文件无编译错误（仓库预存在的与本次任务无关的 TS 错误未受影响）

# Task Dependencies

- Task 2 依赖 Task 1（使用 `buildUserReplySystemPrompt` 与 `buildStopSequencesForUserReply`）
- Task 4 依赖 Task 2 和 Task 3（需要 hook 函数和 ChatInputBar 新 props 都就绪）
- Task 5 依赖 Task 1（测试 PromptBuilder 新函数）
- Task 1、Task 3 相互独立，可并行实施
