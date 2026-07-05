# Tasks

## 提示词层

- [x] Task 1: 在 PromptBuilder.ts 中新增 `buildPolishInputSystemPrompt` 函数
  - [x] SubTask 1.1: 新增 `buildPolishInputSystemPrompt(characterInfo: CharacterInfoForPrompt, persona: UserPersona, originalText: string, person?: 'first' | 'second' | 'third'): string` 函数
    - 防御性校验：`persona` 为空 / `persona.name` 为空 / `originalText` 为空时返回空串
    - 输出包含：角色定义（"你是文本润色器"）、用户人设（name + description）、对方角色上下文（characterCardName + personality + characterCardContent 截断 300 字）、原始文本段落、任务要求（6 条约束 + 人称视角约束）、长度约束（±50% 以内）
    - 复用 `buildUserReplySystemPrompt` 的代码风格与 `charContextLines` 构建逻辑
    - 人称视角约束复用 `buildUserReplySystemPrompt` 的 `personConstraint` 逻辑（first/second/third）
    - 在文件中紧跟 `buildUserReplySystemPrompt` 之后定义
  - [x] SubTask 1.2: 在 `PromptBuilder.ts` 头部确认导出（确保 `hooks.ts` 可导入）

## Hook 业务逻辑

- [x] Task 2: 在 `useCharacterDialogueChat` hook 中新增 `polishInput` 函数
  - [x] SubTask 2.1: 在 `CharacterDialogueChat.hooks.ts` 顶部导入新函数：`buildPolishInputSystemPrompt`（从 `./PromptBuilder`）
  - [x] SubTask 2.2: 在 hook 中新增 state：`const [isPolishingInput, setIsPolishingInput] = useState(false)`，并暴露到 hook 返回值
  - [x] SubTask 2.3: 新增 ref：`const polishedAccumulatedRef = useRef<string>('')`（流式累积）、`const isPolishingInputRef = useRef<boolean>(false)`（同步读取取消标志）、`const isPolishingInputAbortRef = useRef<boolean>(false)`（onStream 早返标志）
  - [x] SubTask 2.4: 实现 `polishInput` useCallback 函数（参数 `originalText: string`，返回 `Promise<string>`）：
    - 前置校验：`originalText` 为空或仅空白时 `message.warning('请先输入需要润色的文本')` 并 return；`selectedPersona` 为空时 `message.warning('请先在右侧面板选择用户人设')` 并 return；`getActiveEngineConfig()` 为空时 `message.warning('请先在设置中配置AI引擎')` 并 return；`state.isStreaming` / `isOrganizing` / `isGeneratingUserReply` / `isPolishingInputRef.current` 任一为 true 时 return
    - 设置 `setIsPolishingInput(true)` / `isPolishingInputRef.current = true` / 重置 `polishedAccumulatedRef.current = ''` / `isPolishingInputAbortRef.current = false`
    - 调用 `getEffectiveParams()` + `getActiveEngineConfig()` 获取参数与引擎配置
    - 调用 `buildPolishInputSystemPrompt(characterInfo, selectedPersona, originalText, characterConfig?.userReplyPerson)` 构建系统提示
    - 取最近 N 条对话历史作为 `contextMessages`（复用 `generateUserReply` 的取数逻辑）
    - 调用 `ContextTruncator` 进行上下文裁剪（如启用 token 管理，与 `generateUserReply` 一致，不注入 roleAnchorMessage）
    - 构造 `engineConfigWithParams`：复用 `generateUserReply` 的参数注入模式，`stopSequences` 使用 `buildStopSequencesForUserReply(characterInfo.characterCardName, customStopSequences)`
    - 通过 `ChatEngineFactory.getInstance().getOrCreateDefaultEngine(engineConfigWithParams)` 获取引擎实例
    - 注册 `engine.onStream` 回调：检查 `isPolishingInputAbortRef.current` 早返，否则累积 chunk 到 `polishedAccumulatedRef.current`
    - 注册 `engine.onComplete` 回调：`resolve(response?.content || polishedAccumulatedRef.current)`
    - 注册 `engine.onError` 回调：`message.error(...)` + `reject`
    - 调用 `engine.sendMessage(contextMessages, systemPrompt, engineConfigWithParams)`
    - finally 块中：`setIsPolishingInput(false)` / `isPolishingInputRef.current = false`
  - [x] SubTask 2.5: 暴露 `polishInput` 函数和 `isPolishingInput` 状态到 hook 返回值
  - [x] SubTask 2.6: 在 `cancelRequest` 函数中追加：若 `isPolishingInputRef.current` 为 true，则设置 `isPolishingInputAbortRef.current = true` 并调用 `engine.cancelRequest()`

## ChatInputBar UI

- [x] Task 3: 在 ChatInputBar.tsx 中新增"润色"按钮
  - [x] SubTask 3.1: 扩展 `ChatInputBarProps` 接口，新增可选 props：
    - `onPolishInput?: (text: string) => void`
    - `isPolishingInput?: boolean`
    - `polishFlashKey?: number`
  - [x] SubTask 3.2: 在组件参数解构中新增 `onPolishInput`、`isPolishingInput = false`、`polishFlashKey`
  - [x] SubTask 3.3: 新增 `useState` 控制 textarea 边框高亮动画状态：`const [flashBorder, setFlashBorder] = useState(false)`
  - [x] SubTask 3.4: 新增 `useEffect` 监听 `polishFlashKey`：当其非零变化时，`setFlashBorder(true)` + `setTimeout(() => setFlashBorder(false), 600)` 触发 600ms 青色边框高亮动画
  - [x] SubTask 3.5: 在 `else` 分支中，"AI回复"按钮**之后**、Send 按钮**之前**新增"润色"按钮：
    - 导入 `HighlightOutlined` from `@ant-design/icons`
    - 用 `<Tooltip title={isPolishingInput ? '停止润色' : '润色当前输入文本（结合对话上下文与角色人设）'}>` 包裹
    - 按钮形态：圆形（`width: 44px, height: 44px, borderRadius: '50%'`）
    - 正常态配色：青色渐变 `linear-gradient(135deg, #14b8a6 0%, #06b6d4 100%)`
    - 润色中态配色：红色渐变 `linear-gradient(135deg, #ef4444 0%, #dc2626 100%)` + `<LoadingOutlined />` 图标
    - 图标：`<HighlightOutlined />`（正常态）/ `<LoadingOutlined />`（润色中）
    - `onClick`：润色中时调用 `onCancel?.()`，正常态时调用 `onPolishInput?.(input)`（传入当前输入框文本）
    - `disabled`：`!isPolishingInput && (!input.trim() || disabled || isStreaming || isOrganizing || isGeneratingUserReply)`
    - `marginRight: '4px'`（与 Send 按钮间距）
  - [x] SubTask 3.6: 调整 textarea 的 disabled 条件：`(disabled && !isStreaming) || isGeneratingUserReply || isPolishingInput`
  - [x] SubTask 3.7: 调整 Send 按钮的 disabled 条件：`!input.trim() || disabled || isGeneratingUserReply || isPolishingInput`
  - [x] SubTask 3.8: 调整 AI回复按钮的 disabled 条件：`!isGeneratingUserReply && (disabled || isStreaming || isOrganizing || isPolishingInput)`
  - [x] SubTask 3.9: 调整人称选择器的 disabled 条件：`disabled || isStreaming || isOrganizing || isGeneratingUserReply || isPolishingInput`
  - [x] SubTask 3.10: 在 textarea 的 `style` 中根据 `flashBorder` 状态动态设置 `boxShadow`：`flashBorder ? '0 0 0 2px rgba(20, 184, 166, 0.6)' : （原有 focus/blur 逻辑）`，并添加 `transition: 'border-color 0.2s ease, box-shadow 0.3s ease'`

## 父组件透传

- [x] Task 4: 在 CharacterDialogueChat.tsx 中连接润色功能
  - [x] SubTask 4.1: 从 `useCharacterDialogueChat` 解构新返回值：`polishInput`、`isPolishingInput`
  - [x] SubTask 4.2: 新增 state：`const [polishFlashKey, setPolishFlashKey] = useState(0)`，用于触发 textarea 边框动画
  - [x] SubTask 4.3: 实现 `handlePolishInput` useCallback（参数 `text: string`）：
    - 调用 `await polishInput(text)`
    - 成功时：`setGeneratedReplyText(polishedText)` 复用现有文本填充机制（与 AI回复 按钮共享 `generatedReplyText` state）、`setPolishFlashKey(k => k + 1)` 触发动画、`message.success('已润色')`
    - 失败时：hook 内 `message.error` 已处理，无需重复
  - [x] SubTask 4.4: 在 `<ChatInputBar>` JSX 中传入新 props：
    - `onPolishInput={handlePolishInput}`
    - `isPolishingInput={isPolishingInput}`
    - `polishFlashKey={polishFlashKey}`

## 测试与验证

- [x] Task 5: 单元测试
  - [x] SubTask 5.1: 在 `__tests__/PromptBuilder.polishInput.test.ts`（新建）中验证 `buildPolishInputSystemPrompt`:
    - 输出包含用户人设 name/description
    - 包含对方角色 characterCardName
    - 包含原始文本 `originalText`
    - 包含约束关键词："保持原始意图" / "仅输出" / "不要解释"
    - 包含长度约束（±50%）
    - `originalText` 为空时返回空串
    - `persona` 为空或 `name` 为空时返回空串
    - `person='third'` 时包含第三人称约束
    - `person` 不传时包含第一人称约束（默认）
  - [x] SubTask 5.2: 运行 `npm test` 确认全部测试通过，无新增编译错误

# Task Dependencies

- Task 2 依赖 Task 1（使用 `buildPolishInputSystemPrompt`）
- Task 4 依赖 Task 2 和 Task 3（需要 hook 函数和 ChatInputBar 新 props 都就绪）
- Task 5 依赖 Task 1（测试 PromptBuilder 新函数）
- Task 1、Task 3 相互独立，可并行实施
